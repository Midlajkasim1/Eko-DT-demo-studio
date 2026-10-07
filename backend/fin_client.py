"""
FIN Framework SCRAM-SHA-256 Client & Zinc Parser
Reusable, project-agnostic connector client.
All project-specific values are loaded from config.json.
"""

import asyncio
import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import time
from datetime import datetime
from typing import Any, Optional

import httpx


# ─── Zinc Parsing Utilities ─────────────────────────────────────────────────

def decode_zinc_unicode(text: str) -> str:
    """Decode FIN Zinc uXXXX unicode escapes to real characters."""
    if not text:
        return text
    return re.sub(r'u([0-9a-fA-F]{4})', lambda m: chr(int(m.group(1), 16)), text)


def safe_get(obj: Any, key: str, default: Any = None) -> Any:
    """Safely call .get() on something that might be a boolean or None."""
    if isinstance(obj, dict):
        return obj.get(key, default)
    return default


def collapse_metadata_blocks(text: str) -> str:
    """Replace each << ... >> metadata block with a single quoted placeholder.

    A nested << emits its own placeholder, and an unterminated one drops the rest
    of the text.
    """
    if "<<" not in text:
        return text

    out: list[str] = []
    depth = 0
    i = 0
    n = len(text)
    while i < n:
        open_at = text.find("<<", i)
        if depth == 0:
            if open_at == -1:
                out.append(text[i:])
                break
            out.append(text[i:open_at])
            out.append('"[METADATA_BLOCK]"')
            depth += 1
            i = open_at + 2
            continue
        close_at = text.find(">>", i)
        if open_at == -1 and close_at == -1:
            break
        if close_at == -1 or (open_at != -1 and open_at < close_at):
            out.append('"[METADATA_BLOCK]"')
            depth += 1
            i = open_at + 2
        else:
            depth -= 1
            i = close_at + 2
    return "".join(out)


def parse_zinc_csv(text: str) -> list[dict]:
    """Parse Zinc/CSV formatted response from FIN server into list of dicts."""
    if not text:
        return []

    lines = collapse_metadata_blocks(text).strip().split('\n')

    # Find header line
    header_idx = -1
    for i, line in enumerate(lines):
        if line.startswith('id,') or (',' in line and 'navName' in line) or (',' in line and 'message' in line):
            header_idx = i
            break
    if header_idx == -1:
        return []

    headers = [h.strip() for h in lines[header_idx].split(',')]
    rows = []

    for i in range(header_idx + 1, len(lines)):
        line = lines[i].strip()
        if not line:
            continue

        # Robust CSV split respecting quotes
        parts: list[str] = []
        in_quote = False
        current_part: list[str] = []
        last_char = ''
        for char in line:
            if char == '"' and last_char != '\\':
                in_quote = not in_quote
            elif char == ',' and not in_quote:
                parts.append("".join(current_part).strip())
                current_part = []
                last_char = char
                continue
            current_part.append(char)
            last_char = char
        parts.append("".join(current_part).strip())

        row: dict[str, Any] = {}
        for h_idx, header in enumerate(headers):
            if h_idx < len(parts):
                val = parts[h_idx]
                if val.startswith('@'):
                    val_parts = val.split(' ', 1)
                    ref_id = val_parts[0]
                    dis = decode_zinc_unicode(val_parts[1].strip('"')) if len(val_parts) > 1 else ""
                    row[header] = {"val": ref_id, "dis": dis}
                elif val.startswith('"') and val.endswith('"'):
                    row[header] = decode_zinc_unicode(val.strip('"'))
                elif re.match(r'\d{4}-\d{2}-\d{2}T', val):
                    row[header] = val
                elif val == 'M':
                    row[header] = True
                elif val == '':
                    row[header] = None
                else:
                    try:
                        row[header] = float(val)
                    except ValueError:
                        row[header] = decode_zinc_unicode(val)
        rows.append(row)

    return rows


def clip_decimals(text: str) -> str:
    """Cut a displayed number after two decimal places. 23.3128 stays 23.31."""
    return re.sub(r"(-?)(\d+)\.(\d{3,})", lambda m: f"{m.group(1)}{m.group(2)}.{m.group(3)[:2]}", text)


def trunc2(val: float) -> str:
    """Same cut for a real number, without rounding the third digit up."""
    return clip_decimals(f"{val:.12f}").rstrip("0").rstrip(".")


def alarm_is_open(row: dict) -> bool:
    """A FIN alarm stays on the list only while its active marker is set.

    A cleared record keeps the alarm marker and the message "Return to normal",
    with the active cell empty. A stale active marker with that message is the
    same case.
    """
    if not row or row.get("alarm") is not True or row.get("active") is not True:
        return False
    msg = str(row.get("message") or "").lower()
    return "return to normal" not in msg


def _split_zinc_csv(line: str) -> list[str]:
    parts: list[str] = []
    in_q = False
    cur: list[str] = []
    for ch in line:
        if ch == '"':
            in_q = not in_q
        elif ch == ',' and not in_q:
            parts.append(''.join(cur).strip())
            cur = []
            continue
        cur.append(ch)
    parts.append(''.join(cur).strip())
    return parts


def _alarm_detail_from_table(body: str) -> str:
    """One technical line from a nested name,sourceRef,value block."""
    texts: list[str] = []
    numbers: list[tuple[str, float]] = []
    for line in body.splitlines():
        line = line.strip()
        if not line or line.startswith("ver:") or line.startswith("name,"):
            continue
        parts = _split_zinc_csv(line)
        if len(parts) < 3:
            continue
        name = decode_zinc_unicode(parts[0].strip().strip('"')).replace("_", " ").strip()
        raw = parts[2].strip()
        if raw.startswith('"') and raw.endswith('"'):
            raw = raw[1:-1]
        raw = decode_zinc_unicode(raw).strip()
        if raw in ("", "T", "F", "true", "false", "M"):
            continue
        try:
            numbers.append((name, float(raw)))
        except ValueError:
            texts.append(raw)
    fault = [t for t in texts if not t.lower().rstrip(".").endswith("normal")]
    if fault:
        return clip_decimals(fault[-1])
    if numbers:
        name, val = numbers[0]
        return clip_decimals(f"{name} {trunc2(val)}")
    return clip_decimals(texts[-1]) if texts else ""


def attach_alarm_details(text: str, rows: list[dict]) -> None:
    """Stamp each alarm row with the diagnostic sentence from its metadata block."""
    if not text or not rows:
        return
    details: dict[str, str] = {}
    for chunk in re.split(r"(?m)^(?=@)", text):
        if not chunk.startswith("@"):
            continue
        id_tok = chunk.split(" ", 1)[0].strip()
        found = re.search(r"name,sourceRef,value\s*\n(.*?)\n\s*>>", chunk, re.S)
        if not found or not id_tok:
            continue
        detail = _alarm_detail_from_table(found.group(1))
        if detail:
            details[id_tok] = detail
    for row in rows:
        ref = row.get("id")
        val = ref.get("val") if isinstance(ref, dict) else None
        if val and details.get(val):
            row["detail"] = details[val]


def parse_custom_response(text: str) -> dict:
    """Parse a FIN hisRead Zinc response into rows + curVal + unit."""
    if not text:
        return {"rows": [], "curVal": None, "unit": ""}
    lines = text.split('\n')

    cur_val = None
    unit = ""
    for line in lines[:20]:
        if "curVal:" in line:
            match = re.search(r'curVal:([\d\.-]+)', line)
            if match:
                try:
                    cur_val = float(match.group(1))
                except ValueError:
                    pass
        if 'unit:"' in line:
            match = re.search(r'unit:"([^"]+)"', line)
            if match:
                unit = match.group(1).replace(' Dubai', '')

    data_start = -1
    for i, line in enumerate(lines):
        if re.match(r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}', line):
            data_start = i
            break

    rows = []
    if data_start != -1:
        for i in range(data_start, len(lines)):
            line = lines[i].strip()
            if not line or ',' not in line:
                continue
            parts = line.split(',', 1)
            ts_part = parts[0].replace(' Dubai', '').strip()
            val_str = parts[1].strip()
            try:
                clean_val_str = re.sub(r'[^0-9.-]', '', val_str)
                val = float(clean_val_str)
                dt = datetime.fromisoformat(ts_part.split('.')[0])
                rows.append({"date": dt, "value": val})
            except (ValueError, TypeError):
                continue

    return {"rows": rows, "curVal": cur_val, "unit": unit}


def parse_alarm_fdd_points(alarms_text: str) -> list[dict]:
    """Extract FDD Rule_ diagnostic points from << ... >> alarm metadata blocks."""
    if not alarms_text:
        return []

    fdd_points = []
    seen_ids: set[str] = set()
    segments = alarms_text.split('<<')

    for seg in segments[1:]:
        if '>>' not in seg:
            continue
        block_content, remainder = seg.split('>>', 1)
        eq_m = re.search(r'(@p:[^\"\s,]+)\s+"([^"]+)"', remainder)
        if not eq_m:
            continue
        eq_val = eq_m.group(1)
        eq_dis = eq_m.group(2)

        in_table = False
        for line in block_content.split('\n'):
            line = line.strip()
            if not line:
                continue
            if line.startswith('name,sourceRef,value'):
                in_table = True
                continue
            if not in_table:
                continue

            # Robust CSV split
            parts: list[str] = []
            in_q = False
            cur: list[str] = []
            for ch in line:
                if ch == '"':
                    in_q = not in_q
                elif ch == ',' and not in_q:
                    parts.append(''.join(cur).strip())
                    cur = []
                    continue
                cur.append(ch)
            parts.append(''.join(cur).strip())

            if len(parts) < 3:
                continue

            decoded_name = decode_zinc_unicode(parts[0].strip('"'))
            d_upper = decoded_name.upper()
            if not (d_upper.startswith("RULE_") or d_upper.startswith("FD&D_")):
                continue

            synthetic_id = f"fdd_{eq_val}_{decoded_name}"
            if synthetic_id in seen_ids:
                continue
            seen_ids.add(synthetic_id)

            val_raw = parts[2].strip().strip('"')
            cur_val: Any = decode_zinc_unicode(val_raw)
            kind = "Bool"
            if cur_val in ("T", "true"):
                cur_val = True
            elif cur_val in ("F", "false"):
                cur_val = False
            else:
                try:
                    cur_val = float(cur_val)
                    kind = "Number"
                except ValueError:
                    pass

            fdd_points.append({
                "navName": decoded_name,
                "id": {"val": synthetic_id, "dis": f"{eq_dis} {decoded_name}"},
                "equipRef": {"val": eq_val, "dis": eq_dis},
                "curVal": cur_val,
                "kind": kind
            })

    return fdd_points


# ─── FIN project list ────────────────────────────────────────────────────────

PROJECT_ID_RE = re.compile(r"^[A-Za-z0-9_.\-]+$")
# The project grid FIN returns for secureEval(projs()) has the columns
#   id,type,dis,route,routeStatus,readRoutes,readRouteStatus,created,doc,version,routeErr,backup,
#   name hidden,projMeta hidden,mod hidden
# and `dis` is the display name (`name` is a hidden internal column, never shown). A row whose `dis`
# is empty is listed under its identifier, never a made-up name.
PROJECT_NAME_COLUMNS = ("dis",)


def parse_fin_projects(text: str) -> list[dict]:
    """Project records from a FIN grid: every row whose id is `@p:<projectId>`.

    Returns [{"id": "marsaAlArab", "name": "..."}] sorted by name. `id` is what `/api/{id}/...`
    takes. Rows with any other kind of id are ignored, and an id seen twice is kept once.
    """
    if not text:
        return []
    # a cell can hold a nested grid (projMeta); collapse it so it cannot add or split rows
    text = collapse_metadata_blocks(text)
    lines = [ln for ln in text.replace("\r", "").split("\n") if ln.strip()]
    header: list[str] = []
    first_data = 0
    if lines and lines[0].startswith("ver:"):
        first_data = 1
    # the column names follow the version line; a record row starts with its ref instead
    if first_data < len(lines) and not lines[first_data].lstrip().startswith("@"):
        # a column name may carry Zinc metadata after it (`name dis:"Project"`); only the name counts
        header = [(h.strip().strip('"').split() or [''])[0].lower() for h in _split_zinc_csv(lines[first_data])]
        first_data += 1
    name_cols = [header.index(c) for c in PROJECT_NAME_COLUMNS if c in header]

    found: dict[str, str] = {}
    for ln in lines[first_data:]:
        cells = _split_zinc_csv(ln)
        if not cells:
            continue
        ref, _, ref_dis = cells[0].partition(" ")
        if not ref.startswith("@p:"):
            continue
        pid = ref[3:]
        if not PROJECT_ID_RE.match(pid) or pid in found:
            continue
        name = ""
        for col in name_cols:
            if col < len(cells):
                value = decode_zinc_unicode(cells[col].strip().strip('"')).strip()
                if value and value != "M":
                    name = value
                    break
        if not name:
            name = decode_zinc_unicode(ref_dis.strip().strip('"')).strip()
        found[pid] = name or pid
    return sorted(({"id": pid, "name": name} for pid, name in found.items()),
                  key=lambda p: (p["name"].lower(), p["id"]))


# ─── Time Aggregation ────────────────────────────────────────────────────────

AM_PM_LOOKUP = {
    0: '12 am', 1: '1 am', 2: '2 am', 3: '3 am', 4: '4 am', 5: '5 am',
    6: '6 am', 7: '7 am', 8: '8 am', 9: '9 am', 10: '10 am', 11: '11 am',
    12: '12 pm', 13: '1 pm', 14: '2 pm', 15: '3 pm', 16: '4 pm', 17: '5 pm',
    18: '6 pm', 19: '7 pm', 20: '8 pm', 21: '9 pm', 22: '10 pm', 23: '11 pm'
}

MONTHS_ORDER = [
    'january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december'
]

HOURS_ORDER = [AM_PM_LOOKUP[h] for h in range(24)]


def aggregate_and_restructure(data: list[dict]) -> dict:
    """Aggregate time-series rows into nested year→month→day→hour structure."""
    if not data:
        return {}
    data.sort(key=lambda x: x['date'])
    agg_map: dict[tuple, dict] = {}

    for item in data:
        dt = item['date']
        val = item['value']
        key = (dt.year, dt.month, dt.day, dt.hour)
        if key not in agg_map:
            agg_map[key] = {"sum": 0, "count": 0}
        agg_map[key]["sum"] += val
        agg_map[key]["count"] += 1

    nested: dict = {}
    for key, agg in agg_map.items():
        y, m, d, h = key
        year_str = str(y)
        month_name = MONTHS_ORDER[m - 1]
        day_key = f"{month_name} {d}"
        hour_ampm = AM_PM_LOOKUP[h]
        avg = round(agg["sum"] / agg["count"], 2)

        if year_str not in nested:
            nested[year_str] = {}
        if month_name not in nested[year_str]:
            nested[year_str][month_name] = {}
        if day_key not in nested[year_str][month_name]:
            nested[year_str][month_name][day_key] = {hr: None for hr in HOURS_ORDER}
        nested[year_str][month_name][day_key][hour_ampm] = str(avg)

    return nested


# ─── SCRAM-SHA-256 Client ────────────────────────────────────────────────────

class FinScramClient:
    """Async FIN Framework client with SCRAM-SHA-256 authentication."""

    def __init__(self, base_url: str, project_name: str):
        self.base_url = base_url.rstrip('/')
        self.project_name = project_name
        # readAll(point...) on a full site returns a large grid; 15s was not enough
        self.client = httpx.AsyncClient(verify=False, timeout=60.0)
        self.auth_headers: dict[str, str] = {}
        self.is_authenticated = False
        self.last_alarm_rows: list[dict] = []
        self.last_point_rows: list[dict] = []

    async def authenticate(self, username: str, password: str) -> bool:
        """Perform SCRAM-SHA-256 authentication."""

        def rstr2b64uri(data: bytes) -> str:
            return base64.b64encode(data).decode().replace('=', '').replace('+', '-').replace('/', '_')

        def hmac_sha256(key: bytes, msg_bytes: bytes) -> bytes:
            return hmac.new(key, msg_bytes, hashlib.sha256).digest()

        def xor_bytes(a: bytes, b: bytes) -> bytes:
            return bytes(x ^ y for x, y in zip(a, b))

        def generate_nonce(length: int = 24) -> str:
            chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
            return ''.join(secrets.choice(chars) for _ in range(length))

        auth_url = f"{self.base_url}/user/auth"

        try:
            # Initialize session
            await self.client.get(f"{self.base_url}/user/login")

            # Step 1: HELLO
            u64 = rstr2b64uri(username.encode())
            hello_header = f"HELLO username={u64}"
            resp = await self.client.get(auth_url, headers={"Authorization": hello_header})

            if resp.status_code == 200:
                self.is_authenticated = True
                return True
            if resp.status_code != 401:
                return False

            www_auth = resp.headers.get("WWW-Authenticate", "")
            params: dict[str, str] = {}
            clean_header = re.sub(r'(?i)^scram\s+', '', www_auth)
            for pair in clean_header.split(','):
                if '=' in pair:
                    k, v = pair.split('=', 1)
                    params[k.strip().lower()] = v.strip().strip('"')

            h_token = params.get("handshaketoken")

            # Step 2: Client First Message
            c_nonce = generate_nonce(24)
            c1_bare = f"n={username},r={c_nonce}"
            c1_msg = f"n,,{c1_bare}"
            c1_data = rstr2b64uri(c1_msg.encode())

            scram_header = f"scram data={c1_data}"
            if h_token:
                scram_header += f", handshakeToken={h_token}"

            resp = await self.client.get(auth_url, headers={"Authorization": scram_header})
            if resp.status_code != 401:
                return False

            s_www_auth = resp.headers.get("WWW-Authenticate", "")
            s_match = re.search(r'data=([^,]+)', s_www_auth)
            h_match = re.search(r'handshakeToken=([^, ]+)', s_www_auth)
            if not s_match:
                return False

            # Step 3: Parse Server First Message & compute proof
            raw_data = s_match.group(1).replace('-', '+').replace('_', '/')
            pad = 4 - len(raw_data) % 4
            if pad != 4:
                raw_data += '=' * pad
            s1_msg = base64.b64decode(raw_data).decode()
            s1_data = dict(p.split('=', 1) for p in s1_msg.split(',') if '=' in p)
            salt = base64.b64decode(s1_data["s"])
            iterations = int(s1_data["i"])
            s_nonce = s1_data["r"]

            c2_no_proof = f"c=biws,r={s_nonce}"
            auth_msg = f"{c1_bare},{s1_msg},{c2_no_proof}"

            salted_pwd = hashlib.pbkdf2_hmac('sha256', password.encode(), salt, iterations, 32)
            client_key = hmac_sha256(salted_pwd, b"Client Key")
            stored_key = hashlib.sha256(client_key).digest()
            client_sig = hmac_sha256(stored_key, auth_msg.encode())

            proof = base64.b64encode(xor_bytes(client_key, client_sig)).decode()
            c2_msg = f"{c2_no_proof},p={proof}"
            c2_data = rstr2b64uri(c2_msg.encode())

            final_header = f"scram data={c2_data}"
            final_h_token = h_match.group(1) if h_match else h_token
            if final_h_token:
                final_header += f", handshakeToken={final_h_token}"

            # Step 4: Send Final Proof
            resp = await self.client.get(auth_url, headers={"Authorization": final_header})

            if resp.status_code == 200:
                self.auth_headers = {
                    "Authorization": final_header,
                    "Accept": "text/zinc"
                }
                self.is_authenticated = True
                print(f"[FIN] ✓ Authenticated as '{username}'")
                return True
            return False

        except Exception as e:
            print(f"[FIN] ✗ Auth error: {e}")
            return False

    async def fetch_api(self, endpoint: str, is_text: bool = False) -> Optional[Any]:
        """Fetch a FIN API endpoint. Returns parsed JSON or raw text."""
        url = endpoint if endpoint.startswith("http") else f"{self.base_url}{endpoint}"
        try:
            resp = await self.client.get(url, headers=self.auth_headers)
            if resp.status_code == 200:
                return resp.text if is_text else resp.json()
            if resp.status_code in (401, 403):
                self.is_authenticated = False
                print(f"[FIN] Session expired ({resp.status_code})")
            return None
        except Exception as e:
            print(f"[FIN] Fetch error {url}: {e}")
            return None

    async def fetch_probe(self, endpoint: str) -> tuple[Optional[int], Optional[str]]:
        """GET that reports what FIN answered: (status, text), or (None, None) if FIN is unreachable.

        Unlike fetch_api it never ends the session, so a caller can tell "FIN says this
        record does not exist" from "the request failed".
        """
        url = endpoint if endpoint.startswith("http") else f"{self.base_url}{endpoint}"
        try:
            resp = await self.client.get(url, headers=self.auth_headers)
            return resp.status_code, resp.text
        except Exception as e:
            print(f"[FIN] Probe error {url}: {e}")
            return None, None

    async def get_probe(self, endpoint: str, params: dict[str, str]) -> tuple[Optional[int], Optional[str]]:
        """fetch_probe with query parameters, which httpx URL-encodes: (status, text), or
        (None, None) if FIN is unreachable. The session's auth headers are reused."""
        url = endpoint if endpoint.startswith("http") else f"{self.base_url}{endpoint}"
        try:
            resp = await self.client.get(url, params=params, headers=self.auth_headers)
            return resp.status_code, resp.text
        except Exception as e:
            print(f"[FIN] Probe error {url}: {e}")
            return None, None

    def _resolve_endpoint(self, template: str) -> str:
        """Replace {project} placeholder in endpoint template."""
        return template.replace("{project}", self.project_name)

    def _parse_zinc_value(self, text: Optional[str], tag: str = "Zinc") -> Optional[float]:
        """Parse a single numeric value from a Zinc grid response."""
        if not text:
            return None
        try:
            lines = text.strip().split('\n')
            if len(lines) < 3 or not lines[0].startswith('ver:'):
                return None
            headers = [h.strip() for h in lines[1].split(',')]
            curval_idx = -1
            for col in ['val', 'curVal']:
                if col in headers:
                    curval_idx = headers.index(col)
                    break
            if curval_idx == -1:
                return None
            data_line = lines[2] if len(lines) > 2 else ''
            parts = self._parse_csv_line(data_line)
            if curval_idx < len(parts):
                raw = parts[curval_idx]
                match = re.search(r'-?[\d.]+', raw)
                if match:
                    return float(match.group())
            return None
        except Exception as e:
            print(f"[{tag}] Parse Error: {e}")
            return None

    def _parse_csv_line(self, line: str) -> list[str]:
        """Parse a single CSV line handling escaped quotes."""
        parts: list[str] = []
        current: list[str] = []
        in_quote = False
        i = 0
        while i < len(line):
            c = line[i]
            if c == '\\' and i + 1 < len(line) and line[i + 1] == '"':
                current.append('\\"')
                i += 2
                continue
            elif c == '"':
                in_quote = not in_quote
            elif c == ',' and not in_quote:
                parts.append(''.join(current).strip())
                current = []
                i += 1
                continue
            current.append(c)
            i += 1
        parts.append(''.join(current).strip())
        return parts

    async def fetch_realtime_data(self, endpoints: dict[str, str]) -> dict:
        """Fetch realtime points, equipment, and alarms. Returns floor-wise structure."""
        resolved = {k: self._resolve_endpoint(v) for k, v in endpoints.items()}

        tasks = [self.fetch_api(v, is_text=True) for v in resolved.values()]
        results = await asyncio.gather(*tasks)

        # CPU-bound zinc parsing — off the event loop so file serving stays responsive
        return await asyncio.to_thread(self._build_realtime, *results)

    def _build_realtime(self, points_text: str, equip_text: str, alarms_text: str) -> dict:
        points = parse_zinc_csv(points_text)
        equipment = parse_zinc_csv(equip_text)
        alarms = parse_zinc_csv(alarms_text)
        attach_alarm_details(alarms_text or "", alarms)
        self.last_alarm_rows = alarms
        self.last_point_rows = points

        # Extract FDD points from alarm metadata
        fdd_points = parse_alarm_fdd_points(alarms_text)

        # Merge extracted FDD points into main points list
        for fp in fdd_points:
            fp_nav = fp.get("navName", "").upper()
            fp_eq_id = safe_get(fp.get("equipRef"), "val")
            fp_eq_dis = str(safe_get(fp.get("equipRef"), "dis") or "").upper()

            existing = None
            for p in points:
                p_nav = str(p.get("navName") or "").upper()
                if p_nav == fp_nav:
                    if safe_get(p.get("equipRef"), "val") == fp_eq_id:
                        existing = p
                        break
                    p_id_dis = str(safe_get(p.get("id"), "dis") or "").upper()
                    if fp_eq_dis and fp_eq_dis in p_id_dis:
                        existing = p
                        break

            if existing:
                existing["curVal"] = fp.get("curVal")
                if not existing.get("equipRef"):
                    existing["equipRef"] = fp.get("equipRef")
            else:
                points.append(fp)

        # Build floor-wise equipment data
        floor_wise: dict[str, dict] = {}

        for equip in equipment:
            nav_name = equip.get("navName")
            if not nav_name:
                continue

            equip_id = safe_get(equip.get("id"), "val")
            equip_nav_upper = nav_name.upper()
            nav_norm = equip_nav_upper.replace("-", " ").replace("_", " ").strip()

            def is_match(p: dict) -> bool:
                if safe_get(p.get("equipRef"), "val") == equip_id:
                    return True
                dis = str(safe_get(p.get("id"), "dis") or "").upper().replace("-", " ").replace("_", " ")
                if nav_norm and nav_norm in dis:
                    return True
                p_dis = str(p.get("dis") or "").upper().replace("-", " ").replace("_", " ")
                if nav_norm and nav_norm in p_dis:
                    return True
                return False

            equip_points = [p for p in points if is_match(p)]

            # Filter active alarms
            equip_alarms = []
            for a in alarms:
                if safe_get(a.get("sourceRef"), "val") == equip_id and alarm_is_open(a):
                    equip_alarms.append({
                        "alarm": a.get("message", "N/A"),
                        "priority": a.get("priority", 0),
                    })

            # Format points
            formatted_points = []
            seen_navs: set[str] = set()

            for p in equip_points:
                p_nav = str(p.get("navName") or "")
                if not p_nav or p_nav == "N/A":
                    id_dis = safe_get(p.get("id"), "dis", "") or str(p.get("dis") or "")
                    if id_dis and nav_name:
                        idx = id_dis.upper().find(nav_name.upper())
                        if idx >= 0:
                            after = id_dis[idx + len(nav_name):].strip()
                            if after:
                                p_nav = after
                    if not p_nav or p_nav == "N/A":
                        p_nav = str(p.get("dis") or "N/A")

                p_nav = decode_zinc_unicode(p_nav)
                nav_lower = p_nav.lower().strip()
                if not nav_lower or nav_lower == "n/a":
                    continue

                is_rule = nav_lower.startswith("rule")
                if not is_rule:
                    skip_patterns = ["sensor no response", "metadata", "[metadata_block]",
                                     "cooling valve not maintaining", "not maintaining setpoint"]
                    if any(pat in nav_lower for pat in skip_patterns):
                        continue
                    if nav_lower in ["start/stop", "start_stop", "startstop"]:
                        continue

                val = p.get("curVal")
                if val is None:
                    val = p.get("val")
                if val is None:
                    val = p.get("v0")
                if isinstance(val, dict):
                    val = val.get("dis") or val.get("val")
                if isinstance(val, str):
                    cleaned = val.strip().rstrip("°CcFf%")
                    try:
                        val = float(cleaned)
                    except (ValueError, TypeError):
                        pass
                if val == "T" or val is True:
                    val = True
                elif val == "F" or val is False:
                    val = False

                # A point with no current value is not reporting, but if it is
                # historized we still keep it so its trend stays chartable.
                is_his = p.get("his") is True
                reporting = not (val is None or val == "" or val == "N/A")
                if not reporting:
                    if not is_his:
                        continue
                    val = None

                unit = p.get("unit", "") or ""
                if val is None:
                    display_val = "—"
                elif isinstance(val, bool):
                    display_val = "T" if val else "F"
                elif isinstance(val, (int, float)):
                    if unit == "%" or any(x in nav_lower for x in ["valve", "coil", "demand"]):
                        val = int(val)
                        unit = "%"
                        display_val = f"{val}{unit}"
                    else:
                        display_val = trunc2(float(val))
                        if unit:
                            display_val = f"{display_val}{unit}"
                else:
                    display_val = clip_decimals(str(val))

                nav_key = nav_lower.replace(" ", "_")
                if nav_key in seen_navs:
                    continue
                seen_navs.add(nav_key)

                formatted_points.append({
                    "navName": p_nav,
                    "currentValue": display_val,
                    # A missing/blank status tag means "no fault reported", not a fault
                    "status": p.get("status") or p.get("curStatus") or "ok",
                    "id": str(safe_get(p.get("id"), "val") or "").lstrip("@"),
                    "his": is_his,
                    "reporting": reporting,
                    "unit": unit,
                })

            floor = safe_get(equip.get("floorRef"), "dis", "Unknown Floor")
            type_tag = "cctv" if "cctv" in nav_name.lower() else "hvac"

            # FIN marker tags (ahu, fcu, pump, meter, lift, facp…) classify the
            # equipment; everything was previously lumped into one "hvac" bucket
            tags = [k for k, v in equip.items() if v is True and k not in ("equip", "inAlarm")]

            equip_data = {
                "name": nav_name,
                "bimId": equip.get("bimId") or equip_id or nav_name,
                "alarms": equip_alarms,
                "points": formatted_points,
                "tags": tags,
            }

            if floor not in floor_wise:
                floor_wise[floor] = {"cctv": [], "hvac": []}
            floor_wise[floor][type_tag].append(equip_data)

        return floor_wise

    async def fetch_live_point(self, point_id_template: str) -> Optional[float]:
        """Fetch a single live point value by ID template."""
        point_id = point_id_template.replace("{project}", self.project_name)
        endpoint = f"/api/{self.project_name}/eval?expr=readById(@{point_id})"
        text = await self.fetch_api(endpoint, is_text=True)
        return self._parse_zinc_value(text)

    async def fetch_power_histories(self, endpoints: dict[str, str]) -> dict:
        """Fetch all power history endpoints and aggregate."""
        in_flight = asyncio.Semaphore(8)

        async def fetch_one(endpoint_template: str) -> dict:
            async with in_flight:
                text = await self.fetch_api(
                    self._resolve_endpoint(endpoint_template), is_text=True
                )
            return await asyncio.to_thread(
                lambda: aggregate_and_restructure(parse_custom_response(text)["rows"])
            )

        histories = await asyncio.gather(*(fetch_one(t) for t in endpoints.values()))
        return dict(zip(endpoints, histories))

    async def close(self):
        await self.client.aclose()
