import csv
import re
from datetime import date, datetime


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


# FIN spells the same columns in more than one way.
_CANON = {
    "work_orders": "id",
    "workorders": "id",
    "work_order": "id",
    "wonum": "id",
    "equipment": "equipment",
    "equipment_description": "description",
    "equipment_organization": "organization",
    "position": "position",
    "asset_tag": "assetTag",
    "work_order_type": "type",
    "due_date": "dueDate",
    "period_uom": "period",
    "pm_schedule": "pmSchedule",
    "wo_created_date": "created",
    "schedule_start_date": "startDate",
    "schedule_end_date": "endDate",
}


def _canon(name):
    token = name.strip().split()[0].lower() if name and name.strip() else ""
    return _CANON.get(token, token)


def _header_names(line):
    return [_canon(col) for col in next(csv.reader([line]))]


def _grid_rows(text):
    lines = [line for line in text.splitlines() if line.strip()]
    header_at = None
    headers = []
    for index, line in enumerate(lines):
        if line.lower().startswith("ver"):
            continue
        names = _header_names(line)
        if "equipment" in names and "id" in names:
            header_at = index
            headers = names
            break
    if header_at is None:
        return [], []
    rows = []
    for raw in csv.reader(lines[header_at + 1 :]):
        if not raw:
            continue
        item = {}
        for index, name in enumerate(headers):
            if name and index < len(raw):
                item[name] = raw[index].strip().strip('"')
        rows.append(item)
    return headers, rows


def parse_workorder_text(text):
    if not text or "errType" in text or "Unknown symbol" in text:
        return []
    headers, rows = _grid_rows(text)
    if "equipment" not in headers or "id" not in headers:
        return []
    orders = []
    for item in rows:
        equip = norm_id(item.get("equipment"))
        wo_id = norm_id(item.get("id")) or str(item.get("id") or "").strip()
        if not equip or not wo_id:
            continue
        due = item.get("dueDate") or ""
        due_day = parse_mdy(due)
        orders.append({
            "id": wo_id,
            "equipment": equip,
            "description": item.get("description") or "",
            "organization": item.get("organization") or "",
            "position": item.get("position") or "",
            "assetTag": item.get("assetTag") or "",
            "type": item.get("type") or "",
            "dueDate": due,
            "dueIso": due_day.isoformat() if due_day else "",
            "period": item.get("period") or "",
            "pmSchedule": item.get("pmSchedule") or "",
            "created": item.get("created") or "",
            "startDate": item.get("startDate") or "",
            "endDate": item.get("endDate") or "",
        })
    return orders


def live_payload(text):
    return {
        "timestamp": datetime.now().isoformat(),
        "source": "fin",
        "orders": parse_workorder_text(text),
    }


def orders_by_equipment(payload):
    grouped = {}
    for order in (payload or {}).get("orders") or []:
        equip_id = norm_id(order.get("equipment"))
        if equip_id:
            grouped.setdefault(equip_id, []).append(order)
    return grouped
