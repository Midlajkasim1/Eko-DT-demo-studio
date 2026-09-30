#!/usr/bin/env python3
"""List Marsa FIN O&M and warranty PDFs and the viewer link for each.

Uses only the Python standard library, so the office venv does not need httpx.
Run it on a machine that can open the FIN server. Credentials stay in the
environment. Nothing is written back to FIN.

  $env:FIN_URL="https://10.10.6.71"
  $env:FIN_USER="your-user"
  $env:FIN_PASS="your-password"
  python backend/scrape_om_warranty.py --out C:\\Temp\\om-warranty.json

The link shape is the one finMobile already uses for a PDF:
  /pod/finStackMobileExt/assets/pdf/pdfview.html#?proj=...&pdf=@p:...
"""

import argparse
import base64
import hashlib
import hmac
import http.cookiejar
import json
import os
import re
import secrets
import ssl
import sys
import urllib.error
import urllib.request
from urllib.parse import quote


QUERIES = ("readAll(file)", "readAll(pdf)", "readAll(doc)")


def kind_of(name):
    folded = name.lower().replace("&", " and ")
    if "warrant" in folded or "guarant" in folded:
        return "warranty"
    if "o and m" in folded or "o&m" in name.lower() or "operation and maintenance" in folded:
        return "om"
    return None


def b64uri(data):
    return base64.b64encode(data).decode().replace("=", "").replace("+", "-").replace("/", "_")


def b64uri_decode(text):
    raw = text.replace("-", "+").replace("_", "/")
    pad = (-len(raw)) % 4
    return base64.b64decode(raw + ("=" * pad))


class FinSession(object):
    """SCRAM login and one GET, with the FIN certificate left unverified."""

    def __init__(self, base_url):
        self.base_url = base_url.rstrip("/")
        self.auth = ""
        jar = http.cookiejar.CookieJar()
        context = ssl._create_unverified_context()
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPSHandler(context=context),
            urllib.request.HTTPCookieProcessor(jar),
        )

    def get(self, url, headers=None):
        request = urllib.request.Request(url, headers=headers or {})
        try:
            response = self.opener.open(request, timeout=120)
            try:
                body = response.read().decode("utf-8", "replace")
                return response.status, response.headers, body
            finally:
                response.close()
        except urllib.error.HTTPError as err:
            body = err.read().decode("utf-8", "replace")
            return err.code, err.headers, body

    def authenticate(self, username, password):
        auth_url = self.base_url + "/user/auth"
        self.get(self.base_url + "/user/login")

        status, headers, _body = self.get(auth_url, {"Authorization": "HELLO username=" + b64uri(username.encode())})
        if status == 200:
            return True
        if status != 401:
            print("HELLO failed: HTTP %s" % status, file=sys.stderr)
            return False

        www = headers.get("WWW-Authenticate", "")
        handshake = ""
        for part in re.sub(r"(?i)^scram\s+", "", www).split(","):
            if "=" in part:
                key, value = part.split("=", 1)
                if key.strip().lower() == "handshaketoken":
                    handshake = value.strip().strip('"')

        nonce = "".join(secrets.choice("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/") for _ in range(24))
        client_first = "n=%s,r=%s" % (username, nonce)
        header = "scram data=" + b64uri(("n,," + client_first).encode())
        if handshake:
            header += ", handshakeToken=" + handshake
        status, headers, _body = self.get(auth_url, {"Authorization": header})
        if status != 401:
            print("SCRAM challenge failed: HTTP %s" % status, file=sys.stderr)
            return False

        www = headers.get("WWW-Authenticate", "")
        data_match = re.search(r"data=([^,\s]+)", www)
        token_match = re.search(r"handshakeToken=([^,\s]+)", www)
        if not data_match:
            print("SCRAM challenge had no data.", file=sys.stderr)
            return False
        server_first = b64uri_decode(data_match.group(1)).decode()
        fields = dict(pair.split("=", 1) for pair in server_first.split(",") if "=" in pair)
        salt = base64.b64decode(fields["s"])
        iterations = int(fields["i"])
        without_proof = "c=biws,r=%s" % fields["r"]
        auth_msg = "%s,%s,%s" % (client_first, server_first, without_proof)
        salted = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, iterations, 32)
        client_key = hmac.new(salted, b"Client Key", hashlib.sha256).digest()
        stored = hashlib.sha256(client_key).digest()
        signature = hmac.new(stored, auth_msg.encode(), hashlib.sha256).digest()
        proof = base64.b64encode(bytes(a ^ b for a, b in zip(client_key, signature))).decode()
        final = "scram data=" + b64uri((without_proof + ",p=" + proof).encode())
        token = token_match.group(1) if token_match else handshake
        if token:
            final += ", handshakeToken=" + token
        status, _headers, _body = self.get(auth_url, {"Authorization": final})
        if status != 200:
            print("SCRAM proof rejected: HTTP %s" % status, file=sys.stderr)
            return False
        self.auth = final
        return True

    def eval_text(self, project, expr):
        url = "%s/api/%s/eval?expr=%s" % (self.base_url, quote(project), quote(expr, safe=""))
        status, _headers, body = self.get(url, {"Authorization": self.auth, "Accept": "text/zinc"})
        if status != 200:
            print("%s -> HTTP %s" % (expr, status), file=sys.stderr)
            return ""
        return body


def parse_zinc(text):
    """Pull id and display name rows out of a FIN zinc grid."""
    if not text:
        return []
    lines = text.replace("\r\n", "\n").strip().split("\n")
    header_at = -1
    for index, line in enumerate(lines):
        if line.startswith("id,") or line.startswith("dis,"):
            header_at = index
            break
    if header_at < 0:
        return []
    headers = [part.strip() for part in lines[header_at].split(",")]
    rows = []
    for line in lines[header_at + 1:]:
        line = line.strip()
        if not line:
            continue
        parts = []
        current = []
        quoted = False
        previous = ""
        for char in line:
            if char == '"' and previous != "\\":
                quoted = not quoted
            elif char == "," and not quoted:
                parts.append("".join(current).strip())
                current = []
                previous = char
                continue
            current.append(char)
            previous = char
        parts.append("".join(current).strip())
        row = {}
        for index, header in enumerate(headers):
            if index < len(parts):
                row[header] = parts[index]
        rows.append(row)
    return rows


def ref_of(row):
    raw = row.get("id") or ""
    if raw.startswith("@"):
        return raw.split(" ", 1)[0]
    return ""


def name_of(row):
    for key in ("dis", "name", "navName", "fileName"):
        value = (row.get(key) or "").strip().strip('"')
        if value and not value.startswith("@"):
            return re.sub(r"u([0-9a-fA-F]{4})", lambda match: chr(int(match.group(1), 16)), value)
    ident = row.get("id") or ""
    if " " in ident:
        return ident.split(" ", 1)[1].strip().strip('"')
    return ""


def viewer_url(base, project, ref):
    pdf = ref if ref.startswith("@") else "@" + ref
    return (
        base + "/pod/finStackMobileExt/assets/pdf/pdfview.html#?proj="
        + quote(project) + "&pdf=" + quote(pdf, safe="@:") + "&page=1&scale=1"
    )


def main():
    parser = argparse.ArgumentParser(description="Scrape FIN O&M and warranty PDF links")
    parser.add_argument("--url", default=os.environ.get("FIN_URL", "https://10.10.6.71"))
    parser.add_argument("--project", default=os.environ.get("FIN_PROJECT", "marsaAlArab"))
    parser.add_argument("--user", default=os.environ.get("FIN_USER", ""))
    parser.add_argument("--password", default=os.environ.get("FIN_PASS", ""))
    parser.add_argument("--out", default="", help="Also write the JSON list to this path")
    args = parser.parse_args()
    if not args.user or not args.password:
        print("Set FIN_USER and FIN_PASS, or pass --user and --password.", file=sys.stderr)
        return 2

    session = FinSession(args.url)
    if not session.authenticate(args.user, args.password):
        print("FIN login failed.", file=sys.stderr)
        return 1

    found = {}
    for expr in QUERIES:
        rows = parse_zinc(session.eval_text(args.project, expr))
        print("%s: %s rows" % (expr, len(rows)), file=sys.stderr)
        for row in rows:
            ref = ref_of(row)
            name = name_of(row)
            kind = kind_of(name)
            if not ref or not kind or ref in found:
                continue
            found[ref] = {
                "name": name,
                "kind": kind,
                "id": ref,
                "url": viewer_url(session.base_url, args.project, ref),
            }

    items = sorted(found.values(), key=lambda item: (item["kind"], item["name"].lower()))
    payload = json.dumps(items, indent=2, ensure_ascii=False)
    print(payload)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as handle:
            handle.write(payload + "\n")
        print("wrote %s links to %s" % (len(items), args.out), file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
