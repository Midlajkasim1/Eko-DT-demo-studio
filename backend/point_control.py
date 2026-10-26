"""
Point control policy: which FIN points the dashboard may write, and how a requested value
becomes a Zinc literal. The policy is config.json `point_control`.
"""

import math
import re
from typing import Any, Optional

# Most specific first: an MAHU or FAHU also carries the letters AHU
EQUIPMENT_CLASSES = ("mahu", "fahu", "vav", "fcu", "ahu")
# The type leads the name ("FCU-L3-02", "MAHU-ANC09-BF-01"); a meter named PMU03_MAHU_... is not an MAHU
EQUIPMENT_NAME_RE = re.compile(r"^(MAHU|FAHU|AHU|FCU|VAV)(?=[^A-Z]|$)")
ZINC_UNIT_RE = re.compile(r"^[A-Za-z%_/$\u0080-\uffff]+$")
LIFE_SAFETY_RE = re.compile(r"fire|smoke|life|emergency", re.IGNORECASE)
NUMBER_RE = re.compile(r"-?\d+(?:\.\d+)?")


def fold(name: Any) -> str:
    return re.sub(r"[^a-z0-9]", "", str(name or "").lower())


def number_of(value: Any) -> Optional[float]:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value) if math.isfinite(value) else None
    match = NUMBER_RE.search(str(value))
    return float(match.group()) if match else None


def equipment_class(name: str, tags: list, policy: dict) -> Optional[str]:
    """fcu, vav, ahu, mahu or fahu when the policy lets that class be written, else None."""
    allowed = {str(k).lower() for k in (policy.get("equipment") or {})}
    tagset = {str(t).lower() for t in tags or []}
    for cls in EQUIPMENT_CLASSES:
        if cls in allowed and cls in tagset:
            return cls
    match = EQUIPMENT_NAME_RE.search(str(name or "").upper())
    cls = match.group(1).lower() if match else None
    return cls if cls in allowed else None


def point_role(point: dict, roles: list, policy: dict) -> Optional[str]:
    """setpoint or status when the point is one of those and its equipment class allows it."""
    name = str(point.get("navName") or "")
    if not point.get("writable") or LIFE_SAFETY_RE.search(name):
        return None
    folded = fold(name)
    kind = point.get("pointKind")
    status_names = {fold(n) for n in policy.get("status_points") or []}
    if "status" in roles and kind == "Bool" and folded in status_names:
        return "status"
    if "setpoint" in roles and kind == "Number" and (point.get("sp") or folded.endswith("sp")):
        return "setpoint"
    return None


def control_for(point: dict, eq_class: Optional[str], policy: dict) -> Optional[dict]:
    """What the dashboard may change on this point, or None. Setpoints need a known safe range."""
    if not eq_class or not policy.get("enabled", False):
        return None
    roles = [str(r).lower() for r in (policy.get("equipment") or {}).get(eq_class) or []]
    role = point_role(point, roles, policy)
    if not role:
        return None
    level = int(policy.get("write_level") or 8)
    manual = number_of(point.get("writeLevel")) == level
    if role == "status":
        enum = point.get("enum")
        words = [w.strip() for w in enum.split(",")] if isinstance(enum, str) else []
        if len(words) != 2 or not all(words):
            words = ["Off", "On"]
        return {"role": "status", "options": [{"value": False, "label": words[0]}, {"value": True, "label": words[1]}],
                "level": level, "manual": manual}
    unit = str(point.get("unit") or "")
    preset = (policy.get("setpoint_ranges") or {}).get(unit) or {}
    own_low, own_high = number_of(point.get("minVal")), number_of(point.get("maxVal"))
    site_low, site_high = number_of(preset.get("min")), number_of(preset.get("max"))
    own = own_low is not None and own_high is not None and own_low < own_high
    if site_low is not None and site_high is not None:
        # The site range is the outer limit: a point's own minVal/maxVal narrows it, never widens it
        low, high = site_low, site_high
        if own and max(own_low, site_low) < min(own_high, site_high):
            low, high = max(own_low, site_low), min(own_high, site_high)
    elif own:
        low, high = own_low, own_high
    else:
        return None
    step = number_of(preset.get("step")) or 1.0
    return {"role": "setpoint", "unit": unit, "min": low, "max": high, "step": step, "level": level, "manual": manual}


def encode_value(control: dict, value: Any) -> str:
    """The Zinc literal for a requested value; ValueError when the policy does not allow it."""
    if control.get("role") == "status":
        if not isinstance(value, bool):
            raise ValueError("Status takes one of its two states.")
        return "T" if value else "F"
    number = number_of(value) if not isinstance(value, str) or value.strip() else None
    if number is None:
        raise ValueError("Enter a number.")
    low, high, unit = control["min"], control["max"], control.get("unit") or ""
    if number < low or number > high:
        raise ValueError(f"Enter a value from {low:g} to {high:g} {unit}".rstrip() + ".")
    literal = format(number, "g")
    return literal + unit if unit and ZINC_UNIT_RE.match(unit) else literal
