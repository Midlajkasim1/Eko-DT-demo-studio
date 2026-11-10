"""
Point control policy: which FIN points the dashboard may write, and how a requested value
becomes a Zinc literal. The policy is config.json `point_control`. A project's
`pointControl` settings can turn a role off for one equipment class and add point names.
"""

import copy
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
# A FIN number written with its unit glued on: 16°C, 800ppm, 250Pa, 30Hz.
MEAS_RE = re.compile(r"^(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)(°C|°F|%RH|ppm|Pa|kPa|Hz|%)$")
GENERIC_SP = frozenset({"sp", "setpoint", "setpt", "stpt"})
ROLES = ("setpoint", "status", "output", "choice")
CLASSES = ("fcu", "vav", "ahu", "mahu", "fahu")


def fold(name: Any) -> str:
    return re.sub(r"[^a-z0-9]", "", str(name or "").lower())


def name_list(value: Any) -> list:
    """Comma, semicolon, or newline separated point names. At most 40, each at most 80 characters."""
    if isinstance(value, str):
        value = re.split(r"[,;\n]+", value)
    if not isinstance(value, list):
        return []
    out = []
    for item in value:
        text = " ".join(str(item).split())
        if not text or len(text) > 80 or text in out:
            continue
        out.append(text)
        if len(out) >= 40:
            break
    return out


def extra_hit(folded: str, words: list) -> bool:
    """A project-added name matches inside the point name. The word `sp` does not."""
    for word in words or []:
        w = fold(word)
        if len(w) < 4 or w in GENERIC_SP:
            continue
        if w in folded:
            return True
    return False


def is_setpoint(name: Any, point: dict, extra: list) -> bool:
    """Haystack `sp`, a Sp / Setpoint / Setpt / Stpt suffix, or a name this project added."""
    if point.get("sp") is True:
        return True
    folded = fold(name)
    if folded.endswith("setpoint") or folded.endswith("setpt") or folded.endswith("stpt") or folded.endswith("sp"):
        return True
    return extra_hit(folded, extra)


def merge_point_control(base: dict, raw: Any) -> dict:
    """The site policy plus one project's switches and extra names. Ranges and the write level stay the site's."""
    policy = copy.deepcopy(base if isinstance(base, dict) else {})
    if not isinstance(raw, dict):
        return policy
    if isinstance(raw.get("enabled"), bool):
        policy["enabled"] = raw["enabled"]
    equip = raw.get("equipment")
    if isinstance(equip, dict):
        policy.setdefault("equipment", {})
        for cls in CLASSES:
            got = equip.get(cls)
            if not isinstance(got, list):
                continue
            kept = []
            for role in got:
                name = str(role).lower()
                if name in ROLES and name not in kept:
                    kept.append(name)
            policy["equipment"][cls] = kept
    policy["setpoint_extra"] = name_list(raw.get("setpoints"))
    policy["status_extra"] = name_list(raw.get("statusPoints"))
    policy["output_extra"] = name_list(raw.get("outputPoints"))
    policy["choice_extra"] = name_list(raw.get("choicePoints"))
    return policy


def canon_unit(unit: Any) -> str:
    """The range-table key for a FIN unit. `degC` and `C` are °C."""
    key = str(unit or "").strip().replace(" ", "").replace("º", "°").replace("˚", "°")
    low = key.lower()
    if key in ("°C", "°c") or low in ("c", "degc", "celsius", "celcius"):
        return "°C"
    if key in ("°F", "°f") or low in ("f", "degf", "fahrenheit"):
        return "°F"
    if key == "%" or low in ("percent", "pct"):
        return "%"
    if low in ("%rh", "rh"):
        return "%RH"
    if low == "ppm":
        return "ppm"
    if low == "pa":
        return "Pa"
    if low == "kpa":
        return "kPa"
    if low == "hz":
        return "Hz"
    return key


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


def _kind(point: dict) -> str:
    """FIN's kind tag, else the display kind. A unit glued on the value is still a number."""
    kind = point.get("pointKind")
    if isinstance(kind, str) and kind:
        return kind.lower()
    if _glued_unit(point.get("curVal")) or _glued_unit(point.get("currentValue")):
        return "number"
    kind = point.get("kind")
    return kind.lower() if isinstance(kind, str) else ""


def _glued_unit(value: Any) -> str:
    if isinstance(value, dict) and value.get("unit"):
        return str(value["unit"])
    match = MEAS_RE.fullmatch(str(value or "").replace(" ", ""))
    return match.group(2) if match else ""


def _unit(point: dict, role: str) -> str:
    """The unit tag, else the unit glued onto the value, else a guess from the point name."""
    unit = canon_unit(point.get("unit"))
    if unit:
        return unit
    for key in ("curVal", "currentValue"):
        found = _glued_unit(point.get(key))
        if found:
            return canon_unit(found)
    folded = fold(point.get("navName"))
    if role == "output":
        if any(part in folded for part in ("damper", "coil", "valve")):
            return "%"
        return ""
    if "temp" in folded:
        return "°C"
    if "co2" in folded:
        return "ppm"
    if "hum" in folded:
        return "%RH"
    if "pressure" in folded:
        return "Pa"
    return ""


def _enum_words(point: dict) -> list:
    enum = point.get("enum")
    words = [w.strip() for w in enum.split(",")] if isinstance(enum, str) else []
    return words if len(words) >= 2 and all(words) else []


def _named(folded: str, policy: dict, exact_key: str, extra_key: str) -> bool:
    exact = {fold(n) for n in policy.get(exact_key) or []}
    return folded in exact or extra_hit(folded, policy.get(extra_key) or [])


def point_role(point: dict, roles: list, policy: dict) -> Optional[str]:
    """setpoint, status, output or choice when the point is one of those and its class allows it."""
    name = str(point.get("navName") or "")
    if not point.get("writable") or LIFE_SAFETY_RE.search(name):
        return None
    folded = fold(name)
    kind = _kind(point)
    if "status" in roles and kind == "bool" and _named(folded, policy, "status_points", "status_extra"):
        return "status"
    if "choice" in roles and kind == "str" and _named(folded, policy, "choice_points", "choice_extra") and _enum_words(point):
        return "choice"
    if "setpoint" in roles and kind == "number" and is_setpoint(name, point, policy.get("setpoint_extra") or []):
        return "setpoint"
    if "output" in roles and kind == "number" and _named(folded, policy, "output_points", "output_extra"):
        return "output"
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
        words = _enum_words(point)
        if len(words) != 2:
            words = ["Off", "On"]
        return {"role": "status", "options": [{"value": False, "label": words[0]}, {"value": True, "label": words[1]}],
                "level": level, "manual": manual}
    if role == "choice":
        return {"role": "choice", "options": [{"value": w, "label": w} for w in _enum_words(point)],
                "level": level, "manual": manual}
    unit = canon_unit(_unit(point, role))
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


def _zinc_str(text: str) -> str:
    return '"' + text.replace("\\", "\\\\").replace('"', '\\"').replace("$", "\\$").replace("\n", "\\n") + '"'


def encode_value(control: dict, value: Any) -> str:
    """The Zinc literal for a requested value; ValueError when the policy does not allow it."""
    if control.get("role") == "status":
        if not isinstance(value, bool):
            raise ValueError("Status takes one of its two states.")
        return "T" if value else "F"
    if control.get("role") == "choice":
        words = [o.get("value") for o in control.get("options") or []]
        match = next((w for w in words if isinstance(w, str) and isinstance(value, str) and w.lower() == value.strip().lower()), None)
        if match is None:
            raise ValueError("Choose one of the point's values.")
        return _zinc_str(match)
    number = number_of(value) if not isinstance(value, str) or value.strip() else None
    if number is None:
        raise ValueError("Enter a number.")
    low, high, unit = control["min"], control["max"], control.get("unit") or ""
    if number < low or number > high:
        raise ValueError(f"Enter a value from {low:g} to {high:g} {unit}".rstrip() + ".")
    literal = format(number, "g")
    return literal + unit if unit and ZINC_UNIT_RE.match(unit) else literal
