import csv
import re
from datetime import date, datetime


def norm_id(value):
    """Equipment and work-order numbers, as plain digits."""
    if value is None or value == "":
        return ""
    if isinstance(value, dict):
        value = value.get("dis") or value.get("val") or ""
    if isinstance(value, bool):
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    if isinstance(value, int):
        return str(value)
    text = str(value).strip().strip('"')
    if text in ("", "N", "NA", "null"):
        return ""
    if re.fullmatch(r"\d+\.0+", text):
        return text.split(".", 1)[0]
    return text


def parse_mdy(value):
    text = str(value or "").strip().split(" ")[0]
    if not text:
        return None
    match = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{2,4})$", text)
    if match:
        year = int(match.group(3))
        if year < 100:
            year += 2000
        try:
            return date(year, int(match.group(1)), int(match.group(2)))
        except ValueError:
            return None
    iso = re.match(r"^(\d{4})-(\d{2})-(\d{2})", text)
    if not iso:
        return None
    try:
        return date(int(iso.group(1)), int(iso.group(2)), int(iso.group(3)))
    except ValueError:
        return None


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


def _name(cell):
    token = str(cell or "").strip().split()[0].strip('"')
    return _CANON.get(token.lower(), token)


def _rows(text):
    lines = [line for line in (text or "").splitlines() if line.strip()]
    header_at = None
    headers = []
    for index, line in enumerate(lines):
        if line.lower().startswith("ver"):
            continue
        names = [_name(col) for col in next(csv.reader([line]))]
        if "equipment" in names and "id" in names:
            header_at = index
            headers = names
            break
    if header_at is None:
        return None
    rows = []
    for raw in csv.reader(lines[header_at + 1 :]):
        if not raw or len(raw) < 2:
            continue
        item = {}
        for index, name in enumerate(headers):
            if name and index < len(raw):
                item[name] = raw[index].strip().strip('"')
        rows.append(item)
    return rows


def _fin_error(text):
    if not text:
        return "FIN returned an empty work-order read"
    if "errType" not in text and "Unknown symbol" not in text:
        return ""
    match = re.search(r'dis:"([^"]+)"', text)
    if match:
        return match.group(1)[:240]
    return "FIN work-order read failed"


def parse_workorder_text(text):
    rows = _rows(text)
    if not rows:
        return []
    orders = []
    for item in rows:
        equip = norm_id(item.get("equipment"))
        wo_id = norm_id(item.get("id"))
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


def error_payload(message):
    return {
        "timestamp": datetime.now().isoformat(),
        "source": "fin",
        "orders": [],
        "error": (message or "FIN work-order read failed")[:240],
    }


def live_payload(text):
    orders = parse_workorder_text(text)
    error = "" if orders else _fin_error(text)
    return {
        "timestamp": datetime.now().isoformat(),
        "source": "fin",
        "orders": orders,
        "error": error,
    }


def orders_by_equipment(payload):
    grouped = {}
    for order in (payload or {}).get("orders") or []:
        equip_id = norm_id(order.get("equipment"))
        if equip_id:
            grouped.setdefault(equip_id, []).append(order)
    return grouped
