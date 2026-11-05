"""Eko-Chat capability registry: what the assistant can answer, what each answer needs from the open project, and what it cannot do.

One table (CAPABILITIES) is the inventory of everything Eko-Chat covers across the Studio dashboard and the FIN integration. evaluate()
turns it into the picture for ONE project from the Data Mapping names that project actually has, so the assistant never assumes two
projects carry the same data:

  available      a read-only tool answers it, and the mapping it needs (if any) is present
  partial        a tool answers it, with a stated limit that changes what the answer covers (the alarm records are those of FIN's latest read, not an
                 archive; some of the metrics have no point in this project's equipment); `limitations` says which
  unmapped       a tool answers it, but the project has not mapped what it needs (or its equipment has no point for it); `missing` names what
  not_supported  nothing answers it: `reason` is "planned" (not built yet) or "read_only" (Eko-Chat will never do it)

`data` says what kind of data the answer is: live (a current FIN read), historical (FIN's hourly series), stored (Eko-DT's own notification
store). A cache can also be stale or not yet read; that is reported at run time from the caches (see eko_chat.get_capabilities), not here.

Pure data and logic: no FIN, no network, no import of eko_chat or main. Only mapping NAMES are read (never a point ID).
"""
from __future__ import annotations

from typing import Any, Optional

AVAILABLE, PARTIAL, UNMAPPED, NOT_SUPPORTED = "available", "partial", "unmapped", "not_supported"
LIVE, HISTORICAL, STORED = "live", "historical", "stored"

# Data Mapping block (the apiSettings field) -> what Dashboard Settings > Data Mapping calls it
MAPPING_LABEL = {
    "finLivePoints": "Live Points", "finEndpoints": "Endpoints", "finEquipmentClasses": "Equipment Classes",
    "finMeterProfile": "Meter Profile", "finSeverityBands": "Severity Bands", "power_boards": "Distribution boards",
    "equipmentPoints": "Equipment points in FIN",
}
ENERGY_SERIES = ("Hourly_Energy_Consumption_his", "Total_Power_Consumption_his")   # eko_chat.ENERGY_SERIES (a test keeps the two equal)

AREAS = {
    "equipment": "Equipment", "alarms": "Alarms", "notifications": "Notifications", "environment": "Indoor environment",
    "energy": "Energy", "hvac": "HVAC", "building": "Building", "assistant": "Assistant", "utilities": "Water and gas",
    "meters": "Power meters", "maintenance": "Maintenance", "documents": "Documents", "studio": "Studio controls", "control": "Control",
    "analytics": "Point analytics",
}

# needs: a list of groups; every group must hold, and a group holds when ANY of its alternatives does. Alternatives:
#   ("live", key)       the key is mapped in finLivePoints
#   ("endpoint", key)   the key is mapped in finEndpoints
#   ("boards",)         the project has distribution boards (backend power_boards)
#   ("board_series",)   at least one board's hourly series is mapped in finEndpoints
#   ("equipment_points",) nothing to map: read from the equipment points themselves
# partial: the capability always answers with this limit (a message); status `partial` instead of `available`.
# coverage_metrics: True when the answer needs the project's equipment to have points for the metrics (evaluate()'s `coverage`): a metric with no point
#   makes it partial, no metric with a point makes it unmapped.
# reads: the cache the answer comes from ("equipment", "alarms", "power", "history", "store"), for the stale / not-yet-read report.
# limits: (mapping block, message) pairs: the capability works without that block, but its answer is limited, and says so.
# studio: where the same information lives in the dashboard (module, sub), for the UI actions of a later phase; informational.
_C = dict


CAPABILITIES: list[dict] = [
    # ── answered by a tool ──
    _C(id="equipment.list", area="equipment", label="Equipment list", tool="find_equipment", data=LIVE, reads="equipment",
       examples=["read the equipment list", "show all assets"], studio=_C(module="assets", sub="reg")),
    _C(id="equipment.count", area="equipment", label="Equipment count, total or by type", tool="find_equipment", data=LIVE, reads="equipment",
       examples=["how many assets do we have", "total number of AHUs"], studio=_C(module="assets", sub="reg")),
    _C(id="equipment.status", area="equipment", label="Status of one equipment item", tool="get_equipment_status", data=LIVE, reads="equipment",
       examples=["status of AHU-01"], studio=_C(module="assets", sub="reg")),
    _C(id="equipment.in_alarm", area="equipment", label="Equipment in alarm", tool="find_equipment", data=LIVE, reads="equipment",
       examples=["which equipment is in alarm"], studio=_C(module="assets", sub="reg")),
    _C(id="equipment.compare", area="equipment", label="Compare two equipment items", tool="compare_equipment", data=LIVE, reads="equipment",
       examples=["compare AHU-01 and AHU-02"], studio=_C(module="assets", sub="reg"),
       note="Their open alarms and the difference and percentage difference of the numeric points they share."),
    _C(id="points.search", area="analytics", label="Find equipment by the points it has", tool="search_points", data=LIVE, reads="equipment",
       examples=["find equipment with humidity readings", "list AHUs with CO2 measurements"], coverage_metrics=True,
       note="Searches the point names of this project's equipment for temperature, humidity, CO2 and power."),
    _C(id="analytics.metric", area="analytics", label="Calculations over equipment points", tool="calculate_metric", data=LIVE, reads="equipment",
       examples=["which AHU has the highest temperature", "top 3 AHUs by CO2"], coverage_metrics=True,
       note="Average, minimum, maximum, count and ranking of the current readings, calculated in Python with the sample count; power can also be summed."),
    _C(id="alarms.open", area="alarms", label="Open alarms, by severity or equipment", tool="get_alarms", data=LIVE, reads="alarms",
       examples=["are there any active alarms", "show critical alarms"], studio=_C(module="overview"),
       limits=[("finSeverityBands", "No severity bands are mapped, so every alarm is graded info.")]),
    _C(id="alarms.records", area="alarms", label="Latest alarm records, open or cleared", tool="get_alarms", data=LIVE, reads="alarms",
       examples=["show the latest alarms"], studio=_C(module="overview"),
       limits=[("finSeverityBands", "No severity bands are mapped, so every alarm is graded info.")],
       note="From FIN's latest alarm read, not a full archive."),
    _C(id="notifications.list", area="notifications", label="Notifications, read and unread", tool="get_notifications", data=STORED, reads="store",
       examples=["show recent notifications", "show unread notifications"]),
    _C(id="environment.iaq", area="environment", label="Indoor air quality index", tool="get_environment", data=LIVE, reads="power",
       needs=[[("live", "iaq_index")]], examples=["what is the current IAQ index"]),
    _C(id="environment.co2", area="environment", label="Carbon dioxide", tool="get_environment", data=LIVE, reads="power",
       needs=[[("live", "ra_co2"), ("equipment_points",)]], examples=["what is the CO2 level"],
       note="From the mapped return-air point, or the average of equipment points whose name contains co2."),
    _C(id="environment.temperature", area="environment", label="Average zone temperature", tool="get_environment", data=LIVE, reads="power",
       needs=[[("live", "avg_zone_temp"), ("live", "avg_zone_temp_sp")]], examples=["what is the current temperature"]),
    _C(id="environment.humidity", area="environment", label="Humidity", tool="get_environment", data=LIVE, reads="equipment",
       needs=[[("equipment_points",)]], examples=["what is the humidity"],
       note="The average of equipment points whose name contains humid."),
    _C(id="environment.outdoor_temperature", area="environment", label="Outdoor temperature", status=NOT_SUPPORTED, reason="planned",
       note="Outdoor weather is not read by Eko-Chat; the indoor (zone) temperature is."),
    _C(id="environment.supply_air_temperature", area="environment", label="Supply-air temperature", status=NOT_SUPPORTED, reason="planned",
       note="Supply-air temperature is a point of one air handler: ask for the status of a unit by name, for example \"status of AHU-01\"."),
    _C(id="environment.comfort", area="environment", label="Comfort compliance", tool="get_environment", data=LIVE, reads="power",
       needs=[[("live", "comfort_compliance")]], examples=["what is the comfort compliance"]),
    _C(id="energy.today", area="energy", label="Energy consumption today", tool="get_energy", data=HISTORICAL, reads="history",
       needs=[[("endpoint", k) for k in ENERGY_SERIES]], examples=["what is the energy consumption today"],
       studio=_C(module="energy", sub="power")),
    _C(id="energy.yesterday", area="energy", label="Energy consumption yesterday", tool="get_energy", data=HISTORICAL, reads="history",
       needs=[[("endpoint", k) for k in ENERGY_SERIES]], examples=["energy consumption yesterday"], studio=_C(module="energy", sub="power")),
    _C(id="energy.month", area="energy", label="Energy consumption this month", tool="get_energy", data=LIVE, reads="power",
       needs=[[("live", "current_month")]], examples=["energy consumption this month"], studio=_C(module="energy", sub="power"),
       note="FIN's own month-to-date point."),
    _C(id="energy.boards", area="energy", label="Energy by distribution board, today or yesterday", tool="get_energy", data=HISTORICAL,
       reads="history", needs=[[("boards",)], [("board_series",)]], examples=["which equipment is consuming the most energy"],
       studio=_C(module="energy", sub="power")),
    _C(id="hvac.online", area="hvac", label="HVAC systems online", tool="get_hvac_status", data=LIVE, reads="equipment",
       examples=["which AHUs are online"], studio=_C(module="systems", sub="hvac"),
       limits=[("finEquipmentClasses", "No equipment classes are mapped, so every equipment item counts as a system.")]),
    _C(id="alarms.history_summary", area="alarms", label="Alarm history by day and severity", tool="get_alarm_history", data=LIVE, reads="alarms",
       examples=["alarm history", "how many alarms were raised today"], studio=_C(module="overview"),
       partial="Only the alarm records in FIN's latest alarm read (open and cleared, the newest 200) are counted; it is not an archive, so a period that "
               "read does not reach cannot be summarised.",
       limits=[("finSeverityBands", "No severity bands are mapped, so alarms are not graded and there is no severity breakdown.")]),
    _C(id="building.snapshot", area="building", label="Building overview", tool="get_building_snapshot", data=LIVE, reads="power",
       examples=["show the building status"], studio=_C(module="overview")),
    _C(id="assistant.capabilities", area="assistant", label="What the assistant can answer for this project", tool="get_capabilities",
       data=None, reads=None, examples=["what can you do"]),
    # ── not answered: planned ──
    _C(id="energy.compare", area="energy", label="Compare energy between periods", status=NOT_SUPPORTED, reason="planned",
       examples=["compare today's energy with yesterday"]),
    _C(id="energy.trend", area="energy", label="Energy trends over weeks or months", status=NOT_SUPPORTED, reason="planned"),
    _C(id="analytics.point_history", area="analytics", label="Averages, minimums and maximums of points over a past period", status=NOT_SUPPORTED,
       reason="planned", examples=["average temperature last week"],
       note="Only the current readings of points are calculated: stored point history is not read, and nothing is estimated for a past period."),
    _C(id="utilities.water_gas", area="utilities", label="Water and gas consumption", status=NOT_SUPPORTED, reason="planned"),
    _C(id="meters.power", area="meters", label="Power meter readings", status=NOT_SUPPORTED, reason="planned"),
    _C(id="maintenance.workorders", area="maintenance", label="Work orders", status=NOT_SUPPORTED, reason="planned"),
    _C(id="documents.om", area="documents", label="O&M and warranty documents", status=NOT_SUPPORTED, reason="planned"),
    _C(id="studio.theme", area="studio", label="Change the theme (light, dark or auto)", status=NOT_SUPPORTED, reason="planned",
       examples=["switch to light mode"]),
    _C(id="studio.navigate", area="studio", label="Open Studio pages", status=NOT_SUPPORTED, reason="planned",
       examples=["open the energy page"]),
    _C(id="studio.filter", area="studio", label="Apply dashboard filters", status=NOT_SUPPORTED, reason="planned"),
    # ── not answered: never ──
    _C(id="notifications.ack", area="notifications", label="Acknowledgements of notifications", status=NOT_SUPPORTED, reason="read_only",
       note="Eko-DT does not record acknowledgements of notifications."),
    _C(id="control.write", area="control", label="Change equipment, setpoints, alarms or project settings", status=NOT_SUPPORTED,
       reason="read_only", note="Eko-Chat is read-only: it cannot start, stop or change equipment, acknowledge alarms or change settings."),
]

IDS = [c["id"] for c in CAPABILITIES]
_BY_ID = {c["id"]: c for c in CAPABILITIES}


def get(capability_id: Any) -> Optional[dict]:
    return _BY_ID.get(capability_id) if isinstance(capability_id, str) else None


def mapped_names(mapped: Any, block: str) -> set:
    """The Data Mapping keys a project has in one block (finLivePoints / finEndpoints); notes such as "_comment" are not keys."""
    value = mapped.get(block) if isinstance(mapped, dict) else None
    keys = value if isinstance(value, (dict, list, tuple, set)) else ()
    return {k for k in keys if isinstance(k, str) and not k.startswith("_")}


def _holds(alt: tuple, mapped: dict, boards: list) -> bool:
    kind = alt[0]
    if kind == "live":
        return alt[1] in mapped_names(mapped, "finLivePoints")
    if kind == "endpoint":
        return alt[1] in mapped_names(mapped, "finEndpoints")
    if kind == "boards":
        return any(isinstance(b, dict) and b.get("name") for b in boards or [])
    if kind == "board_series":
        series = mapped_names(mapped, "finEndpoints")
        return any(isinstance(b, dict) and b.get("history") in series for b in boards or [])
    return kind == "equipment_points"


def _missing(alt: tuple) -> dict:
    kind = alt[0]
    if kind == "live":
        return {"mapping": "finLivePoints", "key": alt[1]}
    if kind == "endpoint":
        return {"mapping": "finEndpoints", "key": alt[1]}
    if kind == "boards":
        return {"mapping": "power_boards", "key": None}
    return {"mapping": "power_boards", "key": "history series in finEndpoints"}   # board_series


def _coverage_limits(c: dict, coverage: Optional[dict]) -> tuple[list, list]:
    """(missing, limitations) of a capability that needs equipment points for the metrics, from the points the project's equipment has.
    `coverage` is {"equipment": n, "metrics": {metric: {"label", "points", "with_readings"}}}, or None when the equipment was not read (nothing is claimed)."""
    metrics = coverage.get("metrics") if isinstance(coverage, dict) else None
    if not c.get("coverage_metrics") or not isinstance(metrics, dict) or not metrics:
        return [], []
    none = [(k, v) for k, v in metrics.items() if not v.get("points")]
    if len(none) == len(metrics):
        return [{"mapping": "equipmentPoints", "key": k} for k, _ in none], []
    limits = []
    if none:
        limits.append(f"No equipment point in this project is named like {', '.join(str(v.get('label') or k) for k, v in none)}, so those cannot be calculated.")
    limits += [f"{v.get('label') or k} has points, but none has a usable reading in the latest read." for k, v in metrics.items()
               if v.get("points") and not v.get("with_readings")]
    return [], limits


def evaluate(mapped: Optional[dict], boards: Optional[list] = None, coverage: Optional[dict] = None) -> list[dict]:
    """Every capability as it stands for one project. `mapped` holds the names the project maps (finLivePoints / finEndpoints: key lists;
    finEquipmentClasses / finMeterProfile / finSeverityBands: whether set); `boards` its distribution boards [{"name", "history"}]; `coverage` what its
    equipment points hold for each metric (see _coverage_limits)."""
    mapped = mapped if isinstance(mapped, dict) else {}
    out = []
    for c in CAPABILITIES:
        row = {"id": c["id"], "area": c["area"], "label": c["label"], "tool": c.get("tool"), "data": c.get("data"),
               "reads": c.get("reads"), "examples": list(c.get("examples") or []), "missing": [], "limitations": []}
        if c.get("note"):
            row["note"] = c["note"]
        if c.get("status") == NOT_SUPPORTED:
            row.update(status=NOT_SUPPORTED, reason=c["reason"])
            out.append(row)
            continue
        for group in c.get("needs") or []:
            if not any(_holds(a, mapped, boards or []) for a in group):
                row["missing"] += [_missing(a) for a in group]
        gaps, limits = _coverage_limits(c, coverage)
        row["missing"] += gaps
        row["status"] = UNMAPPED if row["missing"] else AVAILABLE
        if row["status"] == AVAILABLE:
            if c.get("partial"):
                row["status"] = PARTIAL
                row["limitations"].append(c["partial"])
            for block, message in c.get("limits") or []:
                if not mapped.get(block):
                    row["limitations"].append(message)
            row["limitations"] += limits
            if any(m.startswith("No equipment point") for m in limits):
                row["status"] = PARTIAL
        out.append(row)
    return out


def summary(rows: list[dict]) -> dict:
    """Counts by status, and by area: the numbers the answer and the card quote."""
    counts = {AVAILABLE: 0, PARTIAL: 0, UNMAPPED: 0, NOT_SUPPORTED: 0}
    areas: dict = {}
    for r in rows:
        counts[r["status"]] += 1
        a = areas.setdefault(r["area"], {"area": r["area"], "label": AREAS.get(r["area"], r["area"]), AVAILABLE: 0, PARTIAL: 0, UNMAPPED: 0, NOT_SUPPORTED: 0})
        a[r["status"]] += 1
    return {"counts": counts, "areas": list(areas.values())}


def where(missing: dict) -> str:
    """'Dashboard Settings > Data Mapping > Live Points: iaq_index' for one missing entry."""
    block = MAPPING_LABEL.get(missing.get("mapping"), missing.get("mapping"))
    key = missing.get("key")
    if missing.get("mapping") == "equipmentPoints":
        return f"the equipment points in FIN: no point name contains {key}" if key else "the equipment points in FIN"
    if missing.get("mapping") == "power_boards":
        if key:
            return "the distribution boards' hourly series under Dashboard Settings > Data Mapping > Endpoints"
        return "distribution boards (set in the backend's power_boards; a project's own boards are not sent to the backend yet)"
    return f"Dashboard Settings > Data Mapping > {block}" + (f": {key}" if key else "")
