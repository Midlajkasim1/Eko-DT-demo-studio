"""Work orders from FIN sqlQuery, with the docs dump as the fallback.

The join key is the work-order `equipment` column and the FIN `equipId` tag.
"""

import csv
import os
import re
from datetime import date, datetime

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
WO_FILE = os.path.join(ROOT, "docs", "workorder.txt")
EQUIP_FILE = os.path.join(ROOT, "docs", "equip.txt")

SQL_EXPR = 'sqlQuery(read(sqlConn),"SELECT * FROM workOrderMarsa")'


def norm_id(value):
    if value is None or value == "":
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    if isinstance(value, int):
        return str(value)
    text = str(value).strip().strip('"')
    if text.endswith(".0") and text[:-2].isdigit():
        return text[:-2]
    return text


def parse_mdy(value):
    match = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{2,4})$", str(value or "").strip())
    if not match:
        return None
    year = int(match.group(3))
    if year < 100:
        year += 2000
    try:
        return date(year, int(match.group(1)), int(match.group(2)))
    except ValueError:
        return None


def _header_names(line):
    names = []
    for col in next(csv.reader([line])):
        token = col.strip().split()[0] if col.strip() else ""
        names.append(token)
    return names


def parse_workorder_text(text):
    if not text or "errType" in text or "Unknown symbol" in text:
        return []
    headers, rows = _grid_rows(text)
    if "equipment" not in headers:
        return []
    orders = []
    for item in rows:
        equip = norm_id(item.get("equipment"))
        wo_id = item.get("work_Orders") or ""
        if not equip or not wo_id:
            continue
        due = item.get("due_Date") or ""
        due_day = parse_mdy(due)
        orders.append({
            "id": wo_id,
            "equipment": equip,
            "description": item.get("equipment_Description") or "",
            "organization": item.get("equipment_Organization") or "",
            "position": item.get("position") or "",
            "assetTag": item.get("asset_Tag") or "",
            "type": item.get("work_Order_Type") or "",
            "dueDate": due,
            "dueIso": due_day.isoformat() if due_day else "",
            "period": item.get("period_UOM") or "",
            "pmSchedule": item.get("pm_Schedule") or "",
            "created": item.get("wo_Created_Date") or "",
            "startDate": item.get("schedule_Start_Date") or "",
            "endDate": item.get("schedule_End_Date") or "",
        })
    return orders


def _grid_rows(text):
    lines = [line for line in text.splitlines() if line.strip()]
    start = 1 if lines and lines[0].lower().startswith("ver") else 0
    if start >= len(lines):
        return [], []
    headers = _header_names(lines[start])
    rows = []
    for raw in csv.reader(lines[start + 1 :]):
        if not raw:
            continue
        item = {}
        for index, name in enumerate(headers):
            if name and index < len(raw):
                item[name] = raw[index].strip().strip('"')
        rows.append(item)
    return headers, rows


def equip_ids_from_file():
    """navName -> equipId from the exported equip grid. Live FIN ids win on the client."""
    try:
        text = open(EQUIP_FILE, encoding="utf-8", errors="replace").read()
    except OSError:
        return {}
    mapping = {}
    for row in _grid_rows(text)[1]:
        name = str(row.get("navName") or "").strip()
        equip_id = norm_id(row.get("equipId"))
        if name and equip_id:
            mapping[name] = equip_id
    return mapping


def payload_from_text(text, source):
    return {
        "timestamp": datetime.now().isoformat(),
        "source": source,
        "orders": parse_workorder_text(text) if text else [],
        "equipIds": equip_ids_from_file(),
    }


def file_payload():
    try:
        text = open(WO_FILE, encoding="utf-8", errors="replace").read()
    except OSError:
        text = ""
    return payload_from_text(text, "file")
