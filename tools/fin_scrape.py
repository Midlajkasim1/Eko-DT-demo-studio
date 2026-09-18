#!/usr/bin/env python3
"""
fin_scrape.py — Run this on ANY machine that can reach the FIN server.
No external pip installs needed (uses only stdlib).

Usage:
    python fin_scrape.py

Prompts for server URL, project name, username, password.
Output: fin_dump.json — paste this back for point mapping.

Auth: exact SCRAM-SHA-256 flow used by the project's fin_client.py
      (auth to /user/auth, session cookie, then Zinc text/zinc requests)
"""

import base64
import getpass
import hashlib
import hmac
import json
import re
import secrets
import ssl
import sys
import urllib.parse
import urllib.request
import urllib.error
from http.cookiejar import CookieJar
from datetime import datetime


# ─── Base64 helpers (URL-safe, no padding) ────────────────────────────────────

def b64_urlencode(data: bytes) -> str:
    """URL-safe base64, no padding — exactly what FIN SCRAM expects."""
    return base64.b64encode(data).decode().replace('=', '').replace('+', '-').replace('/', '_')


def b64_urldecode(s: str) -> bytes:
    """Decode URL-safe base64 with padding restored."""
    s = s.replace('-', '+').replace('_', '/')
    pad = 4 - len(s) % 4
    if pad != 4:
        s += '=' * pad
    return base64.b64decode(s)


def hmac_sha256(key: bytes, msg: bytes) -> bytes:
    return hmac.new(key, msg, hashlib.sha256).digest()


def xor_bytes(a: bytes, b: bytes) -> bytes:
    return bytes(x ^ y for x, y in zip(a, b))


def generate_nonce(length: int = 24) -> str:
    chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
    return ''.join(secrets.choice(chars) for _ in range(length))


# ─── HTTP helpers ──────────────────────────────────────────────────────────────

def make_opener(verify_ssl: bool = False):
    """Build an opener with cookie support and optional SSL ignore."""
    jar = CookieJar()
    if not verify_ssl:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        https = urllib.request.HTTPSHandler(context=ctx)
        opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar), https)
    else:
        opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    return opener


def do_get(opener, url, headers=None, timeout=30):
    req = urllib.request.Request(url)
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        resp = opener.open(req, timeout=timeout)
        return resp.status, dict(resp.headers), resp.read().decode('utf-8', errors='replace')
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read().decode('utf-8', errors='replace')
    except Exception as e:
        return 0, {}, str(e)


# ─── SCRAM-SHA-256 auth ────────────────────────────────────────────────────────

def authenticate(opener, base_url, username, password):
    """
    Exact replica of fin_client.py FinScramClient.authenticate().
    Returns (True, auth_header) on success or (False, '') on failure.
    """
    auth_url = f"{base_url}/user/auth"

    # Init session cookie
    do_get(opener, f"{base_url}/user/login")

    # Step 1: HELLO
    u64 = b64_urlencode(username.encode())
    hello_header = f"HELLO username={u64}"
    status, resp_headers, _ = do_get(opener, auth_url, {"Authorization": hello_header})

    if status == 200:
        print("      Server accepted HELLO directly (no SCRAM needed)")
        return True, hello_header

    if status != 401:
        print(f"      HELLO returned unexpected {status}")
        return False, ""

    # Parse WWW-Authenticate from HELLO response
    www_auth = resp_headers.get("Www-Authenticate") or resp_headers.get("WWW-Authenticate") or ""
    params = {}
    clean = re.sub(r'(?i)^scram\s+', '', www_auth)
    for pair in clean.split(','):
        if '=' in pair:
            k, v = pair.split('=', 1)
            params[k.strip().lower()] = v.strip().strip('"')

    h_token = params.get("handshaketoken")

    # Step 2: Client First Message
    c_nonce = generate_nonce(24)
    c1_bare = f"n={username},r={c_nonce}"
    c1_msg  = f"n,,{c1_bare}"
    c1_data = b64_urlencode(c1_msg.encode())

    scram_hdr = f"scram data={c1_data}"
    if h_token:
        scram_hdr += f", handshakeToken={h_token}"

    status, resp_headers, _ = do_get(opener, auth_url, {"Authorization": scram_hdr})
    if status != 401:
        print(f"      Step 2 returned unexpected {status}")
        return False, ""

    # Parse Server First Message
    s_www_auth = resp_headers.get("Www-Authenticate") or resp_headers.get("WWW-Authenticate") or ""
    s_match = re.search(r'data=([^,]+)', s_www_auth)
    h_match = re.search(r'handshakeToken=([^, ]+)', s_www_auth)
    if not s_match:
        print("      No data= in server first message")
        return False, ""

    s1_msg  = b64_urldecode(s_match.group(1)).decode()
    s1_data = dict(p.split('=', 1) for p in s1_msg.split(',') if '=' in p)
    salt       = base64.b64decode(s1_data["s"])
    iterations = int(s1_data["i"])
    s_nonce    = s1_data["r"]

    # Step 3: Compute proof
    c2_no_proof = f"c=biws,r={s_nonce}"
    auth_msg    = f"{c1_bare},{s1_msg},{c2_no_proof}"

    salted_pwd = hashlib.pbkdf2_hmac('sha256', password.encode(), salt, iterations, 32)
    client_key = hmac_sha256(salted_pwd, b"Client Key")
    stored_key = hashlib.sha256(client_key).digest()
    client_sig = hmac_sha256(stored_key, auth_msg.encode())
    proof      = base64.b64encode(xor_bytes(client_key, client_sig)).decode()

    c2_msg  = f"{c2_no_proof},p={proof}"
    c2_data = b64_urlencode(c2_msg.encode())

    final_header = f"scram data={c2_data}"
    final_h_token = h_match.group(1) if h_match else h_token
    if final_h_token:
        final_header += f", handshakeToken={final_h_token}"

    # Step 4: Send final proof
    status, _, _ = do_get(opener, auth_url, {"Authorization": final_header})
    if status == 200:
        return True, final_header

    print(f"      Final proof rejected ({status})")
    return False, ""


# ─── Zinc parser ──────────────────────────────────────────────────────────────

def parse_zinc(text: str) -> list[dict]:
    """
    Parse FIN's text/zinc response into a list of plain dicts.
    Handles the common grid format: meta row, col row, data rows.
    """
    if not text:
        return []

    # Collapse <<...>> metadata blocks
    text = re.sub(r'<<.*?>>', '"[META]"', text, flags=re.DOTALL)

    lines = text.strip().split('\n')

    # Find header line (first line containing comma-separated column names)
    header_idx = -1
    for i, line in enumerate(lines):
        stripped = line.strip()
        if not stripped or stripped.startswith('ver:') or stripped.startswith('#'):
            continue
        # Skip meta lines
        if stripped.startswith('dis:') or stripped.startswith('empty'):
            continue
        if ',' in stripped:
            header_idx = i
            break
    if header_idx < 0:
        return []

    headers = [h.strip().strip('"') for h in lines[header_idx].split(',')]
    rows = []

    for line in lines[header_idx + 1:]:
        line = line.strip()
        if not line:
            continue

        # Split respecting quotes
        parts = []
        in_q  = False
        cur   = []
        for ch in line:
            if ch == '"' :
                in_q = not in_q
            elif ch == ',' and not in_q:
                parts.append(''.join(cur).strip().strip('"'))
                cur = []
                continue
            cur.append(ch)
        parts.append(''.join(cur).strip().strip('"'))

        row = {}
        for i, h in enumerate(headers):
            val = parts[i] if i < len(parts) else ''

            # Ref  @project:r:xxxx-yyyy  →  keep as string
            if val.startswith('@'):
                row[h] = val
            # Number with unit  e.g. 42.6kW
            elif re.match(r'^-?[\d.]+[a-zA-Z%°/]+$', val):
                m = re.match(r'^(-?[\d.]+)(.+)$', val)
                if m:
                    try:
                        row[h] = {"val": float(m.group(1)), "unit": m.group(2)}
                    except ValueError:
                        row[h] = val
                else:
                    row[h] = val
            # Plain number
            elif re.match(r'^-?[\d.]+$', val):
                try:
                    row[h] = float(val)
                except ValueError:
                    row[h] = val
            # Marker (empty string for a marker tag means it's present)
            elif val == 'M':
                row[h] = True
            elif val in ('', 'N'):
                row[h] = None
            else:
                # Decode FIN unicode escapes  uXXXX
                val = re.sub(r'u([0-9a-fA-F]{4})', lambda m2: chr(int(m2.group(1), 16)), val)
                row[h] = val

        rows.append(row)

    return rows


# ─── Fetch wrappers ───────────────────────────────────────────────────────────

def fin_read(opener, base_url, project, auth_hdr, fin_filter, limit=5000):
    """readAll using the read endpoint."""
    url = f"{base_url}/api/{project}/read?filter={urllib.parse.quote(fin_filter)}&limit={limit}"
    status, _, body = do_get(opener, url, {
        "Authorization": auth_hdr,
        "Accept": "text/zinc",
    }, timeout=60)
    if status != 200:
        print(f"  [warn] read({fin_filter}) → {status}")
        return []
    return parse_zinc(body)


def fin_eval(opener, base_url, project, auth_hdr, axon_expr, timeout=90):
    """Evaluate an Axon expression via the eval endpoint."""
    url = f"{base_url}/api/{project}/eval?expr={urllib.parse.quote(axon_expr)}"
    status, _, body = do_get(opener, url, {
        "Authorization": auth_hdr,
        "Accept": "text/zinc",
    }, timeout=timeout)
    if status != 200:
        print(f"  [warn] eval({axon_expr[:70]}) → {status}")
        return []
    return parse_zinc(body)


# ─── Scrape ───────────────────────────────────────────────────────────────────

def scrape(base_url, project, username, password):
    base_url = base_url.rstrip('/')
    opener   = make_opener(verify_ssl=False)   # ignore self-signed cert (localhost)

    print(f"\n[1/6] Authenticating to {base_url} project='{project}' ...")
    ok, auth_hdr = authenticate(opener, base_url, username, password)
    if not ok:
        print("      ✗ Authentication failed — check URL, project, credentials.")
        sys.exit(1)
    print("      ✓ SCRAM-SHA-256 OK")

    dump = {
        "_meta": {
            "scraped_at": datetime.utcnow().isoformat() + "Z",
            "server": base_url,
            "project": project,
        }
    }

    # Site record
    print("[2/6] Reading site record ...")
    dump["site"] = fin_read(opener, base_url, project, auth_hdr, "site")

    # Equipment
    print("[3/6] Reading all equipment ...")
    equip = fin_read(opener, base_url, project, auth_hdr, "equip")
    dump["equipment"] = equip
    print(f"      {len(equip)} equipment records")

    # Points — full grid
    print("[4/6] Reading all points (may take 30–60 s on large sites) ...")
    points = fin_eval(
        opener, base_url, project, auth_hdr,
        "readAll(point or sensor or cmd or sp)",
        timeout=120,
    )
    if not points:
        # fallback simpler filter
        points = fin_read(opener, base_url, project, auth_hdr, "point", limit=10000)
    dump["points"] = points
    print(f"      {len(points)} point records")

    # Current values snapshot
    print("[5/6] Snapping live curVal for all points ...")
    cur_vals = fin_eval(
        opener, base_url, project, auth_hdr,
        "readAll(point and curVal != null)",
        timeout=60,
    )
    dump["current_values"] = cur_vals
    print(f"      {len(cur_vals)} points with live value")

    # Alarms
    print("[6/6] Reading active alarms ...")
    alarms = fin_eval(
        opener, base_url, project, auth_hdr,
        "readAll(alarm and active == true)",
        timeout=30,
    )
    if not alarms:
        alarms = fin_eval(
            opener, base_url, project, auth_hdr,
            "readAll(equip or point).alarms(today)",
            timeout=30,
        )
    dump["alarms"] = alarms
    print(f"      {len(alarms)} active alarms")

    return dump


# ─── Entry point ──────────────────────────────────────────────────────────────

def main():
    print("=" * 60)
    print("  FIN / Haystack Full Scraper  (no pip installs needed)")
    print("  Output: fin_dump.json — paste back for point mapping.")
    print("=" * 60)

    base_url = input("\nFIN server URL  (e.g. https://192.168.1.100): ").strip()
    project  = input("Project name    (e.g. marsaAlArab):           ").strip()
    username = input("Username:                                      ").strip()
    password = getpass.getpass("Password:                                      ")

    dump = scrape(base_url, project, username, password)

    out = "fin_dump.json"
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(dump, f, indent=2, ensure_ascii=False, default=str)

    import os
    size_kb = os.path.getsize(out) // 1024
    print(f"\n✓ Saved → {out}  ({size_kb} KB)")
    print(f"  site      : {len(dump.get('site', []))}")
    print(f"  equipment : {len(dump.get('equipment', []))}")
    print(f"  points    : {len(dump.get('points', []))}")
    print(f"  curVal    : {len(dump.get('current_values', []))}")
    print(f"  alarms    : {len(dump.get('alarms', []))}")
    print("\nCopy fin_dump.json and paste it back — we'll build the mapping.")


if __name__ == "__main__":
    main()

