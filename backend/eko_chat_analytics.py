"""Eko-Chat analytics: the deterministic calculations behind Eko-Chat's numbers, and the index of point metadata they read.

Python does the arithmetic here, never a model. Every function is pure (no FIN, no network, no import of eko_chat or main) and follows the same rules:

  * a unit is kept, and two units are never combined: a reading in another unit than the metric's is left out and counted, a set that mixes
    units refuses to aggregate (unit_conflict)
  * a value that is missing, not a number, not reporting, stale, faulty or outside the metric's plausible range is left out and counted by
    reason; nothing is estimated, interpolated or filled in
  * a count of samples comes with every result, so the answer can say what it rests on
  * a zero (or vanishing) denominator gives a stated gap (zero_denominator), never a number or an exception
  * ties are broken by name, so the same data always gives the same order

The readings are the current values of equipment points as the backend's last FIN read cached them. They carry no time of their own: the
caller states the time of the read (a point in time), and no history is implied or made up.
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass
from typing import Any, Iterable, Optional, Sequence

OPS = ("sum", "average", "min", "max", "count")
MAX_TOP = 20
TINY = 1e-9                  # a denominator smaller than this is zero
UNIT_MISMATCH = "unit_mismatch"     # why two readings, or a reading and its metric, cannot be combined


@dataclass(frozen=True)
class Reading:
    """One usable value of one point of one equipment item."""
    value: float
    unit: str = ""
    equipment: str = ""
    point: str = ""


# ─── Numbers and units ───────────────────────────────────────────────────────

_UNIT_ALIASES = {"degc": "°C", "°c": "°C", "℃": "°C", "deg c": "°C", "c": "°C", "degf": "°F", "°f": "°F", "℉": "°F", "f": "°F",
                 "%": "%", "%rh": "%", "percent": "%", "pct": "%", "ppm": "ppm", "kw": "kW", "w": "W", "kwh": "kWh"}
_NUMBER = re.compile(r"^([+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\s*(\S.*)?$")
_UNIT_TEXT = re.compile(r"^[A-Za-z°℃℉%µ³²/·._ -]{1,10}$")


def canonical_unit(unit: Any) -> str:
    """The unit written one way ("degC", "℃" and "°C" are one unit), or "" for none. An unknown unit is kept as written."""
    text = str(unit).strip() if isinstance(unit, str) else ""
    return _UNIT_ALIASES.get(text.lower(), text)


def finite(value: Any) -> Optional[float]:
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) else None


def parse_number(raw: Any, unit: Any = "") -> Optional[tuple[float, str]]:
    """(value, unit) of a displayed point value ("21.5°C", "600 ppm", 14), or None when it is not exactly a number with an optional unit.
    A unit written in the value that disagrees with the point's own unit is refused, not guessed."""
    declared = canonical_unit(unit)
    number = finite(raw)
    if number is not None:
        return number, declared
    if not isinstance(raw, str):
        return None
    m = _NUMBER.match(raw.strip())
    if not m:
        return None
    suffix = m.group(2) or ""
    if suffix and not _UNIT_TEXT.match(suffix):
        return None
    written = canonical_unit(suffix)
    if declared and written and declared != written:
        return None
    try:
        value = float(m.group(1))
    except ValueError:
        return None
    return (value, declared or written) if math.isfinite(value) else None


# ─── Aggregates ──────────────────────────────────────────────────────────────

def _usable(readings: Iterable[Any]) -> list[Reading]:
    return [x for x in readings if isinstance(x, Reading) and finite(x.value) is not None]


def _units(rows: Sequence[Reading]) -> dict:
    out: dict = {}
    for x in rows:
        out[canonical_unit(x.unit)] = out.get(canonical_unit(x.unit), 0) + 1
    return out


def _witness(x: Reading) -> dict:
    return {"equipment": x.equipment, "point": x.point}


def aggregate(readings: Iterable[Any], op: str) -> dict:
    """sum, average, min, max or count of readings, in one unit.

    {"ok": True, "op", "value", "unit", "samples"} (min and max add "at": the equipment and point that hold it), or
    {"ok": False, "reason": "no_valid_samples" | "unit_conflict" (with "units": {unit: samples}) | "bad_operation"}.
    A count needs no common unit; it lists the units it saw."""
    if op not in OPS:
        return {"ok": False, "reason": "bad_operation"}
    rows = _usable(readings)
    units = _units(rows)
    if op == "count":
        out = {"ok": True, "op": "count", "value": len(rows), "unit": next(iter(units)) if len(units) == 1 else "", "samples": len(rows)}
        if units:
            out["units"] = units
        return out
    if not rows:
        return {"ok": False, "reason": "no_valid_samples"}
    if len(units) > 1:
        return {"ok": False, "reason": "unit_conflict", "units": units}
    unit = next(iter(units))
    if op in ("min", "max"):
        best = (min if op == "min" else max)(x.value for x in rows)
        witness = min((x for x in rows if x.value == best), key=lambda x: (x.equipment, x.point))
        return {"ok": True, "op": op, "value": round(best, 4), "unit": unit, "samples": len(rows), "at": _witness(witness)}
    total = math.fsum(x.value for x in rows)
    value = total if op == "sum" else total / len(rows)
    return {"ok": True, "op": op, "value": round(value, 4), "unit": unit, "samples": len(rows)}


def top_n(readings: Iterable[Any], n: Any, highest: bool = True) -> dict:
    """The n highest (or lowest) readings, best first: {"ok": True, "items": [{rank, equipment, point, value, unit}], "samples", "unit", "order"},
    or {"ok": False, "reason": "no_valid_samples" | "unit_conflict"}. n is kept within 1..MAX_TOP; ties are ordered by equipment, then point."""
    rows = _usable(readings)
    if not rows:
        return {"ok": False, "reason": "no_valid_samples"}
    units = _units(rows)
    if len(units) > 1:
        return {"ok": False, "reason": "unit_conflict", "units": units}
    count = n if isinstance(n, int) and not isinstance(n, bool) else 1
    count = max(1, min(count, MAX_TOP))
    ranked = sorted(rows, key=lambda x: (-x.value if highest else x.value, x.equipment, x.point))[:count]
    return {"ok": True, "order": "highest" if highest else "lowest", "samples": len(rows), "unit": next(iter(units)),
            "items": [{"rank": i, "equipment": x.equipment, "point": x.point, "value": round(x.value, 4), "unit": canonical_unit(x.unit)}
                      for i, x in enumerate(ranked, 1)]}


def _pair(a: Any, b: Any) -> tuple[Optional[dict], Optional[tuple]]:
    """(error, (a, b)): both sides must be readings with a finite value and the same unit."""
    if not (isinstance(a, Reading) and isinstance(b, Reading)) or finite(a.value) is None or finite(b.value) is None:
        return {"ok": False, "reason": "missing_value"}, None
    if canonical_unit(a.unit) != canonical_unit(b.unit):
        return {"ok": False, "reason": "unit_mismatch"}, None
    return None, (a, b)


def difference(a: Any, b: Any) -> dict:
    """a minus b, in their common unit; {"ok": False, "reason": "missing_value" | "unit_mismatch"} when they cannot be compared."""
    error, pair = _pair(a, b)
    if error:
        return error
    return {"ok": True, "difference": round(pair[0].value - pair[1].value, 4), "unit": canonical_unit(pair[0].unit)}


def percent_difference(a: Any, b: Any) -> dict:
    """How far a is from b as a percentage of b's size ((a - b) / |b| x 100). A b of zero gives zero_denominator, with the plain difference."""
    error, pair = _pair(a, b)
    if error:
        return error
    diff = pair[0].value - pair[1].value
    unit = canonical_unit(pair[0].unit)
    if abs(pair[1].value) < TINY:
        return {"ok": False, "reason": "zero_denominator", "difference": round(diff, 4), "unit": unit}
    return {"ok": True, "percent": round(diff / abs(pair[1].value) * 100, 2), "difference": round(diff, 4), "unit": unit}


# ─── Which points are a metric, and which readings count ─────────────────────

def status_problem(status: Any) -> Optional[str]:
    """None for a good point status; "stale" for a stale reading; "bad_status" for any other FIN status (fault, down, disabled, unknown, remote...)."""
    text = str(status).strip().lower() if isinstance(status, str) else ""
    if text in ("", "ok"):
        return None
    return "stale" if text == "stale" else "bad_status"


def _words(name: Any) -> str:
    """A point name as lower-case words: camelCase and _ - / . are word breaks ("SupplyTemp" and "supply_temp" are "supply temp")."""
    text = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", str(name or ""))
    return re.sub(r"[\s_\-/.]+", " ", text).strip().lower()


_SETPOINT = re.compile(r"\b(?:sp|setpoint|set point|setpt|stpt)\b")


def is_setpoint(point: dict) -> bool:
    """A setpoint is a target, not a measurement: flagged sp by FIN, or named SP / setpoint / set point."""
    return bool(isinstance(point, dict) and (point.get("sp") is True or _SETPOINT.search(_words(point.get("navName")))))


def _spec(label: str, include: str, unit: str, bounds: tuple, additive: bool = False, exclude: Optional[str] = None, units: Optional[set] = None) -> dict:
    return {"label": label, "pattern": re.compile(include), "exclude": re.compile(exclude) if exclude else None, "unit": unit,
            "units": units or {unit}, "bounds": bounds, "additive": additive}


# The metrics a question can name. `bounds` is a sanity limit on one reading (a value outside it is a faulty sensor, not a measurement),
# not a comfort range. Only an additive metric may be summed: temperatures, humidities and CO2 levels do not add up to anything.
METRICS: dict[str, dict] = {
    "temperature": _spec("Temperature", r"\btemp(?:erature)?s?(?![a-z])", "°C", (-50.0, 150.0)),
    "humidity": _spec("Humidity", r"humid", "%", (5.0, 100.0)),
    "co2": _spec("CO2", r"co2|co₂", "ppm", (100.0, 5000.0)),
    "power": _spec("Power", r"\bpower\b|\bkw\b", "kW", (0.0, 1_000_000.0), additive=True, exclude=r"factor|fail|status|cmd|command|enable|limit"),
}


def name_matches(spec: dict, name: Any) -> bool:
    words = _words(name)
    return bool(spec["pattern"].search(words)) and not (spec["exclude"] and spec["exclude"].search(words))


def classify(point: Any, equipment: str, spec: dict) -> tuple[Optional[Reading], Optional[str]]:
    """(reading, why) for one point that matched a metric by name.

    A usable point gives (Reading, None), or (Reading, "assumed_unit") when the point carries no unit and the metric's own unit is taken (the
    project's convention; FIN sends none). A point left out gives (None, reason): setpoint, not_reporting, stale, bad_status, non_numeric,
    unit_mismatch (another unit than the metric's: never converted or mixed in) or out_of_range."""
    if not isinstance(point, dict):
        return None, "non_numeric"
    if is_setpoint(point):
        return None, "setpoint"
    if not point.get("reporting"):
        return None, "not_reporting"
    problem = status_problem(point.get("status"))
    if problem:
        return None, problem
    if point.get("kind") in ("Bool", "Str", "Null"):
        return None, "non_numeric"
    parsed = parse_number(point.get("currentValue"), point.get("unit"))
    if parsed is None:
        return None, "non_numeric"
    value, unit = parsed
    if unit and unit not in spec["units"]:
        return None, UNIT_MISMATCH
    lo, hi = spec["bounds"]
    if not lo <= value <= hi:
        return None, "out_of_range"
    name = str(point.get("navName") or "")
    return Reading(value, unit or spec["unit"], equipment, name), (None if unit else "assumed_unit")


# ─── The point index ─────────────────────────────────────────────────────────
# One pass over an equipment cache classifies every point that a metric names, once. The caches are replaced as a whole by each FIN poll
# (every 30 s), so the index is kept per project for as long as its cache is the same object with the same timestamp; a new read, or the same
# cache seen under another project, builds a new one. At most MAX_INDEXES are held, oldest dropped, so the memo never grows.

MAX_INDEXES = 4


@dataclass(frozen=True)
class PointRow:
    """One point that matched a metric by name: its reading, or why it has none (`why`; "assumed_unit" is a reading whose unit was taken from the
    metric). `detail` is the unit it carried when that unit was another than the metric's."""
    eq: int                      # position in the equipment list
    equipment: str
    point: str
    reading: Optional[Reading]
    why: Optional[str]
    detail: str = ""


class PointIndex:
    def __init__(self, equipment: list, by_metric: dict):
        self.equipment = equipment
        self.by_metric = by_metric


def build_index(equipment: list) -> PointIndex:
    by_metric: dict[str, list] = {m: [] for m in METRICS}
    for i, item in enumerate(equipment):
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "")
        for p in item.get("points") or []:
            if not isinstance(p, dict):
                continue
            for metric, spec in METRICS.items():
                if not name_matches(spec, p.get("navName")):
                    continue
                reading, why = classify(p, name, spec)
                other = ""
                if why == UNIT_MISMATCH:
                    parsed = parse_number(p.get("currentValue"), p.get("unit"))
                    other = parsed[1] if parsed else ""
                by_metric[metric].append(PointRow(i, name, str(p.get("navName") or ""), reading, why, other))
    return PointIndex(equipment, by_metric)


INDEX_MEMO: dict = {}      # project key -> (cache object, its timestamp, equipment count, index)


def index_for(key: Any, cache: Any, equipment: list) -> PointIndex:
    """The index of this project's equipment cache; rebuilt when the cache is not the one it was built from. The cache object itself is held, so its
    identity cannot be reused by another while the entry lives."""
    stamp = cache.get("timestamp") if isinstance(cache, dict) else None
    hit = INDEX_MEMO.get(key)
    if hit and hit[0] is cache and hit[1] == stamp and hit[2] == len(equipment):
        return hit[3]
    index = build_index(equipment)
    INDEX_MEMO.pop(key, None)
    INDEX_MEMO[key] = (cache, stamp, len(equipment), index)
    while len(INDEX_MEMO) > MAX_INDEXES:
        INDEX_MEMO.pop(next(iter(INDEX_MEMO)))
    return index
