"""
FIN project-discovery diagnostic (read-only, development use; not imported by the app).

Signs in with the unmodified FinScramClient.authenticate(), then tries seven ways of listing
the FIN projects and reports what each one returned. Secrets are never printed: not the
password, Authorization / cookie / Attest-Key / Fin-Stack-Auth values, nor any token.

Credentials: FIN_USERNAME / FIN_PASSWORD, or prompted locally (the password is not echoed).

  PowerShell:  $env:FIN_SERVER_URL="https://10.10.6.141"; python fin_discovery_diag.py
  bash:        FIN_SERVER_URL=https://10.10.6.141 python fin_discovery_diag.py
"""

import asyncio
import getpass
import os
import re
import sys

import httpx

from fin_client import FinScramClient

EXPECTED_IDS = ("adnocWarsan", "ellisdonDemo", "khaznaDataCenter", "marsaAlArab")
PREVIEW_CHARS = 1200
SECRET_HEADER_NAMES = ("authorization", "cookie", "attest-key", "fin-stack-auth", "authentication-info")

ZINC_PROJS = 'ver:"3.0"\nexpr\n"{}"\n'

# (label, method, path, query params, POST body)
PROBES = [
    ("A", "POST", "/api/sys/eval", None, ZINC_PROJS.format("secureEval(projs())")),
    ("B", "POST", "/api/sys/eval", None, ZINC_PROJS.format("projs()")),
    ("C", "GET", "/api/sys/eval", {"expr": "secureEval(projs())"}, None),
    ("D", "GET", "/api/sys/eval", {"expr": "projs()"}, None),
    ("E", "GET", "/api/sys/eval", {"expr": "readAll(proj)"}, None),
    ("F", "GET", "/api/sys/read", {"filter": "proj"}, None),
    ("G", "GET", "/api/sys/read", {"filter": "id"}, None),
]


class Redactor:
    """Masks every secret value this process holds, wherever it might show up in output."""

    def __init__(self) -> None:
        self.secrets: set[str] = set()

    def add(self, *values: str | None) -> None:
        for v in values:
            if v and len(v) >= 4:
                self.secrets.add(v)

    def learn_headers(self, headers: dict[str, str]) -> None:
        for k, v in headers.items():
            if k.lower() in SECRET_HEADER_NAMES:
                self.add(v)
                # also the individual parameter values inside e.g. 'scram data=..., handshakeToken=...'
                for part in re.split(r"[,\s]+", v):
                    if "=" in part:
                        self.add(part.split("=", 1)[1].strip('"'))

    def learn_response(self, resp: httpx.Response) -> None:
        for k, v in resp.headers.items():
            if k.lower() in SECRET_HEADER_NAMES:
                self.learn_headers({k: v})
        for c in resp.headers.get_list("set-cookie"):
            first = c.split(";", 1)[0]
            if "=" in first:
                self.add(first.split("=", 1)[1])

    def learn_jar(self, client: httpx.AsyncClient) -> None:
        for c in client.cookies.jar:
            self.add(c.value)

    def clean(self, text: str) -> str:
        for s in sorted(self.secrets, key=len, reverse=True):
            text = text.replace(s, "<redacted>")
        return text


def cookie_names(resp: httpx.Response) -> list[str]:
    return [c.split("=", 1)[0].strip() for c in resp.headers.get_list("set-cookie")]


def auth_info_param_names(resp: httpx.Response) -> list[str]:
    raw = resp.headers.get("authentication-info", "")
    return [p.split("=", 1)[0].strip() for p in raw.split(",") if "=" in p]


async def main() -> int:
    base = os.environ.get("FIN_SERVER_URL", "https://localhost").rstrip("/")
    user = os.environ.get("FIN_USERNAME") or input("FIN username: ").strip()
    password = os.environ.get("FIN_PASSWORD") or getpass.getpass("FIN password: ")
    red = Redactor()
    red.add(password)

    print(f"FIN server: {base}")
    fin = FinScramClient(base, "")
    http = fin.client

    # Record the traffic of the real authenticate(); the method itself is not touched.
    seen: list[tuple[str, httpx.Response]] = []
    real_get = http.get

    async def recording_get(url, **kw):
        resp = await real_get(url, **kw)
        red.learn_response(resp)
        seen.append((str(url), resp))
        return resp

    http.get = recording_get

    # ── final /user/auth response ───────────────────────────────────────────────
    print("\n=== Sign-in (FinScramClient.authenticate) ===")
    ok = await fin.authenticate(user, password)
    red.learn_headers(fin.auth_headers)
    red.learn_jar(http)
    print(f"authenticate() returned: {ok}")
    final = next((r for u, r in reversed(seen) if u.endswith("/user/auth")), None)
    if final is not None:
        print("final /user/auth response:")
        print(f"  status                      : {final.status_code}")
        print(f"  response header names       : {sorted(final.headers.keys())}")
        print(f"  Set-Cookie cookie names     : {cookie_names(final)}")
        print(f"  Authentication-Info params  : {auth_info_param_names(final) or 'none'}")
    print(f"cookie names in client jar    : {sorted({c.name for c in http.cookies.jar})}")
    print(f"headers sent on later requests: {sorted(fin.auth_headers)}")
    if not ok:
        print("\nSign-in failed; no discovery request was made.")
        await fin.close()
        return 1

    # ── discovery probes ────────────────────────────────────────────────────────
    print("\n=== Project discovery probes ===")
    results: dict[str, dict] = {}
    for label, method, path, params, body in PROBES:
        url = base + path
        shown_url = url + ("?" + "&".join(f"{k}={v}" for k, v in params.items()) if params else "")
        headers = dict(fin.auth_headers)
        try:
            if method == "POST":
                headers.update({"Content-Type": "text/zinc; charset=utf-8", "Accept": "text/zinc"})
                resp = await http.post(url, content=body.encode("utf-8"), headers=headers)
            else:
                resp = await real_get(url, params=params, headers=headers)
        except Exception as e:  # network error, TLS, timeout
            print(f"\n[{label}] {method} {shown_url}\n  ERROR: {type(e).__name__}: {red.clean(str(e))}")
            results[label] = {"method": method, "url": shown_url, "status": None, "ids": [], "text": ""}
            continue
        red.learn_response(resp)
        red.learn_jar(http)
        text = resp.text
        found = [pid for pid in EXPECTED_IDS if pid in text]
        results[label] = {"method": method, "url": shown_url, "status": resp.status_code,
                          "ids": found, "text": text}
        print(f"\n[{label}] {method} {shown_url}")
        print(f"  status       : {resp.status_code}")
        print(f"  content type : {resp.headers.get('content-type', '-')}")
        print(f"  project ids  : " + ", ".join(f"{pid}={'YES' if pid in found else 'no'}" for pid in EXPECTED_IDS))
        print(f"  response (first {PREVIEW_CHARS} chars):")
        print("    " + red.clean(text[:PREVIEW_CHARS]).replace("\n", "\n    "))

    # ── summary ─────────────────────────────────────────────────────────────────
    def names(pred) -> str:
        hit = [f"{k} ({v['method']} {v['url'].replace(base, '')})" for k, v in results.items() if pred(v)]
        return ", ".join(hit) if hit else "none"

    returned = lambda v: v["status"] == 200 and bool(v["ids"])
    get_ok = [k for k, v in results.items() if v["method"] == "GET" and returned(v)]
    post_ok = [k for k, v in results.items() if v["method"] == "POST" and returned(v)]
    post_attest = [k for k, v in results.items() if v["method"] == "POST" and v["status"] == 400
                   and "attest" in v["text"].lower()]

    print("\n=== Summary ===")
    print(f"Returned the project list        : {names(returned)}")
    print(f"Returned 400                     : {names(lambda v: v['status'] == 400)}")
    print(f"Returned 401/403                 : {names(lambda v: v['status'] in (401, 403))}")
    print(f"Other / unreachable              : "
          f"{names(lambda v: v['status'] not in (200, 400, 401, 403) or (v['status'] == 200 and not v['ids']))}")
    print(f"Does GET discovery work?         : {'YES via ' + ', '.join(get_ok) if get_ok else 'NO'}")
    if post_ok:
        print("Does POST need Attest-Key?       : NO, POST worked with this session "
              f"({', '.join(post_ok)})")
    elif post_attest:
        print(f"Does POST need Attest-Key?       : YES, FIN answered 400 mentioning Attest-Key "
              f"({', '.join(post_attest)})")
    else:
        print("Does POST need Attest-Key?       : not determined (POST neither worked nor mentioned Attest-Key)")

    print("Smallest production change       : ", end="")
    if get_ok:
        c = results[get_ok[0]]
        print(f"send discovery as {c['method']} {c['url'].replace(base, '')} instead of the POST: "
              "add a GET-with-query-params probe to FinScramClient and have get_fin_projects "
              "in main.py use it, with the method/expr kept in config.json project_discovery.")
    elif post_ok:
        print("none to authentication; the existing POST in main.py already works with this session.")
    elif post_attest:
        print("GET did not list projects, so POST must send Attest-Key. authenticate() would have to "
              "obtain the server-issued attest value (see the header/cookie names printed above) and "
              "post_probe send it; if no attest-related name appears above, the key is only obtainable "
              "from the browser app's page and needs FIN-side guidance.")
    else:
        print("undetermined: no probe returned projects; check the 401/403 and other results above.")

    await fin.close()
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
