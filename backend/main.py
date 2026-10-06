"""
FIN Connector Backend — FastAPI Server
Template-based: all project-specific values come from config.json.
Exposes REST API for the React frontend to consume.
Also serves the compiled viewer app from the 'static/' directory.
"""

import asyncio
import copy
import json
import mimetypes
import os
import re
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from typing import Optional
from urllib.parse import quote

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, PlainTextResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from fin_client import (
    PROJECT_ID_RE,
    FinScramClient,
    aggregate_and_restructure,
    alarm_is_open,
    clip_decimals,
    parse_custom_response,
    parse_fin_projects,
    parse_zinc_csv,
    safe_get,
    zinc_string_body,
)

# ─── Load Config ─────────────────────────────────────────────────────────────

CONFIG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.json")

with open(CONFIG_PATH, "r") as f:
    BASE_CONFIG = json.load(f)

# CONFIG is what the polling loops and parsers read. It starts as the file defaults and
# is replaced by BASE_CONFIG overlaid with the open project's settings (see below), so
# config.json stays the fallback for anything a project does not set itself.
CONFIG = copy.deepcopy(BASE_CONFIG)

PROJECT_NAME = CONFIG["project_name"]
FIN_SERVER_URL = CONFIG.get("fin_server_url", "https://localhost")

# project.json `apiSettings` key -> config.json key, for settings that replace the value whole
PROJECT_STR_SETTINGS = {
    "finProjectName": "project_name",
    "finBaseUrl": "fin_server_url",
    "finDisplayName": "display_name",
}
PROJECT_DICT_SETTINGS = {
    "finLivePoints": "live_point_ids",
    "finEndpoints": "power_endpoints",
    "finEquipmentClasses": "equipment_classes",
    "finMeterProfile": "meter_profile",
    "finSeverityBands": "severity_bands",
}


def project_overrides(settings: Optional[dict]) -> dict:
    """The config.json keys a project's apiSettings replaces, with the values it supplies.

    Missing, blank or wrongly typed values are left out, so the default stays.
    Only known keys are read: nothing else in apiSettings (weather key, dashboard
    layout) reaches the backend config.
    """
    out: dict = {}
    if not isinstance(settings, dict):
        return out
    for src, dst in PROJECT_STR_SETTINGS.items():
        value = settings.get(src)
        if isinstance(value, str) and value.strip():
            out[dst] = value.strip()
    for src, dst in PROJECT_DICT_SETTINGS.items():
        value = settings.get(src)
        if isinstance(value, dict) and value:
            out[dst] = value
    interval = settings.get("finInterval")
    if isinstance(interval, (int, float)) and not isinstance(interval, bool) and interval > 0:
        out["polling.live_ms"] = interval
    return out


def merge_project_settings(base: dict, settings: Optional[dict]) -> dict:
    """Overlay a project's apiSettings onto the config.json defaults.

    A project value replaces the default whole (never a key-by-key merge, so one
    site's point IDs cannot leak into another's).
    """
    merged = copy.deepcopy(base)
    for key, value in project_overrides(settings).items():
        if key == "polling.live_ms":
            merged["polling"] = {**(merged.get("polling") or {}), "live_ms": value}
        else:
            merged[key] = copy.deepcopy(value)
    return merged


# Which project the active configuration belongs to (None = none identified), and which
# config.json keys that project replaces. Lets a client confirm what the backend is serving.
ACTIVE_PROJECT_ID: Optional[str] = None
ACTIVE_OVERRIDES: list = []


def apply_project_settings(settings: Optional[dict], project_id: Optional[str] = None) -> None:
    """Make `settings` the active configuration; None restores the config.json defaults."""
    global CONFIG, PROJECT_NAME, FIN_SERVER_URL, ACTIVE_PROJECT_ID, ACTIVE_OVERRIDES
    CONFIG = merge_project_settings(BASE_CONFIG, settings)
    PROJECT_NAME = CONFIG["project_name"]
    FIN_SERVER_URL = CONFIG.get("fin_server_url", "https://localhost")
    ACTIVE_PROJECT_ID = project_id or None
    ACTIVE_OVERRIDES = sorted(project_overrides(settings))


def _documents_path() -> str:
    name = CONFIG.get("documents_file") or "om-warranty.json"
    if os.path.isabs(name):
        return name
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), name)


def _viewer_file_url(ref: str) -> str:
    """Same-origin link. The browser never opens the FIN host, so it does not sign in again."""
    return "/api/fin/file?ref=" + quote(ref, safe="")


def _fin_rec_file_url(base: str, project: str, ref: str) -> str:
    """FIN serves a record's bytes at /api/{proj}/rec/{id}/file. The id drops the leading @."""
    rec = ref[1:] if ref.startswith("@") else ref
    return base.rstrip("/") + "/api/" + quote(project, safe="") + "/rec/" + quote(rec, safe=":") + "/file"


def _catalog_doc(ref: str) -> Optional[dict]:
    try:
        with open(_documents_path(), "r", encoding="utf-8") as handle:
            raw = json.load(handle)
    except (OSError, json.JSONDecodeError):
        return None
    for fam in raw.get("families") or []:
        if not isinstance(fam, dict):
            continue
        for kind in ("om", "warranty"):
            doc = fam.get(kind)
            if isinstance(doc, dict) and str(doc.get("ref") or "") == ref:
                return doc
    return None


def _pdf_filename(name: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9 ._-]+", "", name or "").strip() or "document"
    if not cleaned.lower().endswith(".pdf"):
        cleaned += ".pdf"
    return cleaned


def load_documents() -> dict:
    """Re-read the catalog each call so an edit shows up on the next poll."""
    try:
        with open(_documents_path(), "r", encoding="utf-8") as handle:
            raw = json.load(handle)
    except (OSError, json.JSONDecodeError):
        return {"families": []}
    families = []
    for fam in raw.get("families") or []:
        if not isinstance(fam, dict):
            continue
        item = {
            "id": str(fam.get("id") or ""),
            "tags": list(fam.get("tags") or []),
            "codes": list(fam.get("codes") or []),
            "types": list(fam.get("types") or []),
            "names": list(fam.get("names") or []),
        }
        for kind in ("om", "warranty"):
            doc = fam.get(kind)
            if not isinstance(doc, dict) or not doc.get("ref"):
                continue
            ref = str(doc["ref"])
            item[kind] = {
                "name": str(doc.get("name") or ""),
                "nameAr": str(doc.get("nameAr") or ""),
                "ref": ref,
                "url": _viewer_file_url(ref),
            }
        families.append(item)
    return {"families": families}

# ─── Global State ────────────────────────────────────────────────────────────

client: Optional[FinScramClient] = None
polling_tasks: list[asyncio.Task] = []

# Cached data (updated by background polling)
cached_equip_data: dict = {}
cached_power_data: dict = {}
cached_building_data: dict = {}
cached_sensor_avg: dict = {"temp": None, "humidity": None, "co2": None}
cached_power_history: dict = {}
cached_fdd_summary: list = []
cached_meter_data: dict = {}
cached_alarm_data: dict = {}
cached_facility: dict = {}


# ─── Background Polling ─────────────────────────────────────────────────────

async def realtime_loop():
    """Fetch equipment, alarms, histories, and derived summaries."""
    global cached_equip_data, cached_building_data, cached_power_history
    global cached_fdd_summary, cached_meter_data, cached_alarm_data, cached_facility

    rt_endpoints = CONFIG.get("realtime_endpoints", {})
    pw_endpoints = CONFIG.get("power_endpoints", {})
    interval = CONFIG.get("polling", {}).get("realtime_ms", 30000) / 1000

    while client and client.is_authenticated:
        try:
            realtime = await client.fetch_realtime_data(rt_endpoints)
            cached_equip_data = {
                "timestamp": datetime.now().isoformat(),
                "equipment": _flatten_equip(realtime),
            }
            _compute_sensor_averages(realtime)
            cached_fdd_summary = _build_fdd_summary(realtime)
            cached_meter_data = _extract_meters(realtime, CONFIG.get("meter_profile", {}))
            cached_alarm_data = _flatten_alarms(client.last_alarm_rows, CONFIG.get("severity_bands", {}))
            cached_facility = _compute_facility_services(realtime)
            cached_power_history = await client.fetch_power_histories(pw_endpoints)
            cached_building_data = {
                "status": "success",
                "Building_Info": {
                    "timestamp": datetime.now().isoformat(),
                    "Equipments": realtime,
                    "buildingPowerUsageHistory": cached_power_history,
                    "facilityServices": cached_facility,
                },
            }
            await asyncio.sleep(interval)
        except Exception as e:
            print(f"[FIN] realtime loop error: {e}")
            await asyncio.sleep(10)


async def live_loop():
    """Poll configured live points; failed reads stay null, never a fake 0."""
    global cached_power_data

    live_ids = CONFIG.get("live_point_ids", {})
    interval = CONFIG.get("polling", {}).get("live_ms", 5000) / 1000

    while client and client.is_authenticated:
        try:
            values = await asyncio.gather(
                *(client.fetch_live_point(pid) for pid in live_ids.values()),
                return_exceptions=True,
            )
            live_results = {
                key: None if isinstance(val, Exception) else val
                for key, val in zip(live_ids, values)
            }
            cached_power_data = {
                "timestamp": datetime.now().isoformat(),
                **live_results,
                "carbon_emission": live_results.get("carbon"),
                "avg_temp": cached_sensor_avg.get("temp"),
                "avg_hum": cached_sensor_avg.get("humidity"),
                "avg_co2": cached_sensor_avg.get("co2"),
                "unit": "kWh",
                "fdd": cached_fdd_summary,
                "facilityServices": cached_facility,
            }
            await asyncio.sleep(interval)
        except Exception as e:
            print(f"[FIN] live loop error: {e}")
            await asyncio.sleep(interval)


def _build_fdd_summary(realtime: dict) -> list[dict]:
    summary = []
    for floor_name, floor_data in realtime.items():
        for eq in floor_data.get("hvac", []):
            rules = {
                str(pt.get("navName")): str(pt.get("currentValue", "N/A"))
                for pt in eq.get("points", [])
                if str(pt.get("navName") or "").upper().startswith("RULE_")
            }
            if rules:
                summary.append({
                    "equip": eq.get("name", "Unknown"),
                    "floor": floor_name,
                    "alarms": len(eq.get("alarms", [])),
                    "rules": rules,
                })
    return summary


def _extract_meters(realtime: dict, profile: dict) -> dict:
    prefix = str(profile.get("prefix", "")).upper()
    point_map = profile.get("point_map", {})
    if not prefix or not point_map:
        return {}

    meters: dict = {}
    for floor_data in realtime.values():
        for eq in floor_data.get("hvac", []):
            name = str(eq.get("name", ""))
            if not name.upper().startswith(prefix):
                continue
            metrics: dict = {key: None for key in point_map}
            for pt in eq.get("points", []):
                nav = str(pt.get("navName", "")).lower().replace("-", " ").replace("_", " ")
                best_key, best_len = None, -1
                for key, aliases in point_map.items():
                    for alias in aliases:
                        if alias in nav and len(alias) > best_len:
                            best_key, best_len = key, len(alias)
                if not best_key:
                    continue
                match = re.search(r"-?\d+(?:\.\d+)?", str(pt.get("currentValue", "")))
                if match:
                    metrics[best_key] = float(match.group())
            meters[name] = metrics
    return meters


def severity_for(priority, bands: dict) -> str:
    """Map a FIN alarm priority onto critical/warning/info.

    Sites disagree on which direction priority runs. Haystack treats a low
    number as most urgent; Marsa is the opposite — 250 is control-engine FD&D
    output and 50-150 is connector chatter — so `severity_bands.order` declares
    the direction rather than the code assuming one.
    """
    if not isinstance(priority, (int, float)):
        return "info"
    crit = bands.get("critical", 250)
    warn = bands.get("warning", 150)
    if str(bands.get("order", "desc")).lower() == "asc":
        # low number = most urgent; thresholds are inclusive upper bounds
        if priority <= crit:
            return "critical"
        return "warning" if priority <= warn else "info"
    # high number = most urgent; thresholds are inclusive lower bounds
    if priority >= crit:
        return "critical"
    return "warning" if priority >= warn else "info"


def _flatten_alarms(rows: list, bands: dict) -> dict:
    alarms = []
    counts = {"critical": 0, "warning": 0, "info": 0}

    for row in rows or []:
        if not alarm_is_open(row):
            continue
        priority = row.get("priority") if isinstance(row.get("priority"), (int, float)) else None
        severity = severity_for(priority, bands)
        counts[severity] += 1
        source = row.get("sourceRef")
        # "CONTROL" = an FD&D rule tripped and diagnosed a fault; "CONNECTOR" =
        # a point-level limit or comms transition. Only the former is actionable.
        dispatcher = str(row.get("dispatcher") or "").strip().upper() or None
        message = clip_decimals(str(row.get("message") or ""))
        detail = clip_decimals(str(row.get("detail") or "").strip())
        if detail.lower() == message.strip().lower():
            detail = ""
        alarms.append({
            "source": safe_get(source, "dis") or safe_get(source, "val") or "",
            "message": message,
            "detail": detail,
            "priority": priority,
            "severity": severity,
            "dispatcher": dispatcher,
            "diagnosed": dispatcher == "CONTROL",
            "occurred": row.get("occurred") or row.get("created"),
            "state": row.get("state"),
        })

    alarms.sort(key=lambda a: str(a.get("occurred") or ""), reverse=True)
    return {
        "timestamp": datetime.now().isoformat(),
        "alarms": alarms,
        "counts": {**counts, "total": sum(counts.values())},
    }


def _flatten_equip(realtime: dict) -> list[dict]:
    """Flatten floor-wise equipment into a single list for the frontend."""
    classes = CONFIG.get("equipment_classes", {})
    system_tags = set(classes.get("system_tags") or [])
    equip_list = []
    for floor_name, floor_data in realtime.items():
        for category, items in floor_data.items():
            if not isinstance(items, list):
                continue
            for eq in items:
                eq_name = eq.get("name", "")
                if any(x in eq_name.upper() for x in ["ENERGY", "USAGE", "CALC"]):
                    continue
                alarms = eq.get("alarms", [])
                tags = eq.get("tags") or []
                equip_list.append({
                    "name": eq_name,
                    "floor": floor_name,
                    "category": category,
                    "type": _equip_type(tags, classes.get("type_priority") or []),
                    "tags": tags,
                    "isSystem": bool(system_tags & set(tags)) if system_tags else True,
                    "inAlarm": len(alarms) > 0,
                    "alarms": alarms,
                    "bimId": eq.get("bimId", ""),
                    "points": eq.get("points", []),
                })
    return equip_list


def _compute_sensor_averages(realtime: dict):
    """Compute building-wide sensor averages from equipment points."""
    global cached_sensor_avg
    temp_vals, hum_vals, co2_vals = [], [], []

    for floor_data in realtime.values():
        for eq in floor_data.get("hvac", []):
            for pt in eq.get("points", []):
                nav = str(pt.get("navName") or "").lower()
                val_str = pt.get("currentValue", "")
                try:
                    num = float(re.sub(r'[^0-9.\-]', '', str(val_str)))
                except (ValueError, TypeError):
                    continue

                if "temp" in nav and 10 < num < 50:
                    temp_vals.append(num)
                elif "humid" in nav and 5 < num < 100:
                    hum_vals.append(num)
                elif "co2" in nav and 100 < num < 5000:
                    co2_vals.append(num)

    if temp_vals:
        cached_sensor_avg["temp"] = round(sum(temp_vals) / len(temp_vals), 2)
    if hum_vals:
        cached_sensor_avg["humidity"] = round(sum(hum_vals) / len(hum_vals), 2)
    if co2_vals:
        cached_sensor_avg["co2"] = round(sum(co2_vals) / len(co2_vals), 2)


def _equip_type(tags: list, priority: list) -> str:
    """First matching marker tag, in configured priority order."""
    for t in priority:
        if t in (tags or []):
            return t
    return "other"


def _compute_facility_services(realtime: dict) -> dict:
    """Calculate facility services metrics from realtime equipment data.

    'Systems alive' counts plant equipment only (AHU/FCU/pumps per the KPI sheet),
    not meters, panels, lifts or KPI-calculation records.
    """
    classes = CONFIG.get("equipment_classes", {})
    system_tags = set(classes.get("system_tags") or [])
    priority = classes.get("type_priority") or []

    total_alarms = 0
    total_faults = 0
    total_maintenance = 0
    total_equipment = 0
    online_equipment = 0
    all_equipment = 0
    by_type: dict[str, int] = {}

    for floor_name, floor_data in realtime.items():
        if not isinstance(floor_data, dict):
            continue
        hvac_list = floor_data.get('hvac', [])
        for equipment in hvac_list:
            if not isinstance(equipment, dict):
                continue

            all_equipment += 1
            tags = equipment.get('tags') or []
            etype = _equip_type(tags, priority)
            by_type[etype] = by_type.get(etype, 0) + 1
            is_system = bool(system_tags & set(tags)) if system_tags else True
            if is_system:
                total_equipment += 1
            points = equipment.get('points', [])
            equipment_alarms = equipment.get('alarms', [])
            # Alive = at least one point actually reporting a value. Historized
            # points with no current value are kept for charts but are not liveness.
            has_connectivity = any(p.get('reporting') for p in points if isinstance(p, dict))
            is_faulty = False
            
            if isinstance(equipment_alarms, list) and len(equipment_alarms) > 0:
                total_alarms += len(equipment_alarms)
            
            for point in points:
                if not isinstance(point, dict):
                    continue
                p_name = str(point.get('navName', '')).lower()
                p_val = str(point.get('currentValue', '')).lower()
                # No status tag means no fault reported — do not treat it as faulty
                p_status = str(point.get('status') or 'ok').lower()
                
                is_ticket = any(k in p_val for k in ['alarm', 'failure', 'broken', 'stuck', 'slippage', 'seizure', 'fault', 'error'])
                if is_ticket:
                    total_alarms += 1
                    is_faulty = True
                
                is_issue = any(k in p_val for k in ['calibration', 'no response', 'working']) or p_status != 'ok'
                if is_ticket:
                    is_issue = False

                # A single point in fault is a point-quality issue, not a dead
                # system — liveness is "is anything reporting", per the KPI sheet.
                if is_issue:
                    total_faults += 1


                if ('maintenance' in p_val or 'maint' in p_name or 'manual' in p_val) and 'maintaining setpoint' not in p_val:
                    total_maintenance += 1
            
            if is_system and has_connectivity and not is_faulty:
                online_equipment += 1

    uptime = 99.8
    if total_equipment > 0:
        uptime = (online_equipment / total_equipment) * 100


    return {
        'openTickets': total_alarms,
        'openIssues': total_faults,
        'maintenance': total_maintenance,
        'avgUptime': round(uptime, 1),
        'totalEquipment': total_equipment,      # systems only (AHU/FCU/pumps)
        'onlineEquipment': online_equipment,
        'allEquipment': all_equipment,          # every equip record in the project
        'byType': by_type,
    }


# ─── FastAPI App ─────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup/shutdown lifecycle."""
    # An exported project ships its own project.json beside this file; its settings
    # become the active configuration, with config.json as the fallback
    apply_project_settings(*_bundled_project())
    yield
    # Cleanup
    global polling_tasks, client
    _cancel_polling()
    if client:
        await client.close()


def _cancel_polling():
    global polling_tasks
    for task in polling_tasks:
        if not task.done():
            task.cancel()
    polling_tasks = []


def _start_polling():
    global polling_tasks
    polling_tasks = [
        asyncio.create_task(realtime_loop()),
        asyncio.create_task(live_loop()),
    ]


def _reset_caches():
    """Drop data polled under the previous configuration so it is never served for the next."""
    global cached_equip_data, cached_power_data, cached_building_data, cached_sensor_avg
    global cached_power_history, cached_fdd_summary, cached_meter_data, cached_alarm_data
    global cached_facility
    cached_equip_data = {}
    cached_power_data = {}
    cached_building_data = {}
    cached_sensor_avg = {"temp": None, "humidity": None, "co2": None}
    cached_power_history = {}
    cached_fdd_summary = []
    cached_meter_data = {}
    cached_alarm_data = {}
    cached_facility = {}


def _bundled_project() -> tuple[Optional[dict], Optional[str]]:
    """(apiSettings, projectId) from the project.json exported next to this file, if any."""
    try:
        with open(PROJECT_JSON, "r", encoding="utf-8") as handle:
            meta = json.load(handle)
    except (OSError, json.JSONDecodeError):
        return None, None
    if not isinstance(meta, dict):
        return None, None
    settings = meta.get("apiSettings")
    project_id = meta.get("projectId")
    return (settings if isinstance(settings, dict) else None,
            project_id if isinstance(project_id, str) else None)


app = FastAPI(
    title="FIN Connector API",
    description="Template-based FIN Framework connector for the IFC Digital Twin Viewer",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Only the JSON API and the viewer's own text assets. Never /project.json or
# /models/*: those are already-compressed or huge, and deflating them costs
# seconds of the single uvicorn worker for a few percent.
COMPRESSIBLE_PREFIXES = ("/api/", "/assets/")


class PathScopedGZipMiddleware(GZipMiddleware):
    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not scope["path"].startswith(COMPRESSIBLE_PREFIXES):
            await self.app(scope, receive, send)
            return
        await super().__call__(scope, receive, send)


app.add_middleware(PathScopedGZipMiddleware, minimum_size=1024)


# ─── Request/Response Models ────────────────────────────────────────────────

class LoginRequest(BaseModel):
    username: str
    password: str
    server_url: Optional[str] = None
    project_name: Optional[str] = None
    # The open project's apiSettings (point mappings, severity, ...). Never credentials.
    settings: Optional[dict] = None
    project_id: Optional[str] = None


class ProjectSettingsRequest(BaseModel):
    settings: dict
    project_id: Optional[str] = None


class StatusResponse(BaseModel):
    connected: bool
    project_name: str
    server_url: str
    display_name: str
    # None = not checked (no session). The name never comes from FIN, so `project_source` says
    # where it came from: "request" (typed at sign-in), "project" (the open project) or "default" (config.json)
    project_validated: Optional[bool] = None
    project_source: Optional[str] = None
    project_id: Optional[str] = None


class ValidateMappingRequest(BaseModel):
    project_id: Optional[str] = None
    # apiSettings block name -> the block as currently edited (null / empty = not configured)
    blocks: dict


# ─── Project validation ──────────────────────────────────────────────────────

# What the last sign-in / project switch found. FIN does not return a project name, so
# `source` records where the name in use came from.
PROJECT_CHECK: dict = {"validated": None, "source": None}


def _is_error_grid(text: str) -> bool:
    """A Zinc error grid carries the `err` marker in its first (meta) line."""
    first = (text or "").lstrip().split("\n", 1)[0]
    return bool(re.search(r"\berr\b", first))


async def _validate_project(c) -> bool:
    """One project-scoped read of a single equip record: proves the project name resolves
    on this FIN server and the session can read it. Cheap by design, no site scan."""
    status, text = await c.fetch_probe(f"/api/{quote(c.project_name, safe='')}/read?filter=equip&limit=1")
    return status == 200 and text is not None and not _is_error_grid(text)


# (project_id, name) typed at sign-in. Kept for that one project only: it is never saved, so a
# later settings sync of the same project must not drop it, and another project must not get it.
TYPED_NAME: Optional[tuple] = None


def _name_source(requested: bool) -> str:
    """Where the FIN project name in use came from. "unset": the open project has none, and the
    config.json default is deliberately not substituted for a project that is being managed."""
    if not PROJECT_NAME:
        return "unset"
    if requested:
        return "request"
    return "project" if "project_name" in ACTIVE_OVERRIDES else "default"


def _display_name() -> str:
    """A project that was applied but sets no display name shows its own FIN project name,
    never the config.json site label (that belongs to the backend's default site)."""
    if "display_name" in ACTIVE_OVERRIDES or ACTIVE_PROJECT_ID is None:
        return CONFIG.get("display_name", PROJECT_NAME)
    return PROJECT_NAME


# ─── Endpoints ───────────────────────────────────────────────────────────────

@app.post("/api/fin/login")
async def login(req: LoginRequest):
    """Authenticate with FIN server using SCRAM-SHA-256."""
    global client, FIN_SERVER_URL, PROJECT_NAME, PROJECT_CHECK, TYPED_NAME

    # Settings sent with the login belong to the project being opened; without them the
    # configuration already active (bundled project or config.json) stays in force
    managed = req.settings is not None
    if managed:
        apply_project_settings(req.settings, req.project_id)

    server_url = req.server_url or FIN_SERVER_URL
    typed = (req.project_name or "").strip()
    if managed and not typed and "project_name" not in ACTIVE_OVERRIDES:
        project = ""   # this project has no FIN Project Name: unconfigured, not the default site
    else:
        project = typed or PROJECT_NAME
    TYPED_NAME = (req.project_id, typed) if managed and typed else None

    # Update globals if overridden
    FIN_SERVER_URL = server_url
    PROJECT_NAME = project
    name_source = _name_source(bool(typed))

    _cancel_polling()
    _reset_caches()

    # Close existing client
    if client:
        await client.close()

    client = FinScramClient(server_url, project)
    success = await client.authenticate(req.username, req.password)

    if not success:
        raise HTTPException(status_code=401, detail="Authentication failed")

    # Signed in is not the same as usable: the project name must resolve on this server too.
    # With no project name there is nothing to check or poll.
    if project:
        PROJECT_CHECK = {"validated": await _validate_project(client), "source": name_source}
        _start_polling()
    else:
        PROJECT_CHECK = {"validated": None, "source": name_source}

    return {
        "status": "success",
        "message": f"Authenticated to {server_url} as {req.username}",
        "project": project,
        "project_validated": PROJECT_CHECK["validated"],
        "project_source": name_source,
    }


@app.post("/api/fin/project-settings")
async def set_project_settings(req: ProjectSettingsRequest):
    """Switch the live session to another project's FIN configuration, without a new sign-in.

    Needs an authenticated session, since it changes what the shared session polls.
    The FIN server cannot change here — that needs a fresh sign-in, so it is reported.
    """
    global FIN_SERVER_URL, PROJECT_CHECK, PROJECT_NAME, TYPED_NAME
    _require_client()

    apply_project_settings(req.settings, req.project_id)
    # A project without its own FIN Project Name is unconfigured, except for the name typed at
    # sign-in for this same project. Never the config.json default, never another project's name.
    if TYPED_NAME and TYPED_NAME[0] != (req.project_id or None):
        TYPED_NAME = None
    kept = TYPED_NAME[1] if TYPED_NAME else ""
    if "project_name" not in ACTIVE_OVERRIDES:
        PROJECT_NAME = kept
    wanted_url = str(req.settings.get("finBaseUrl") or "").strip().rstrip("/")
    reconnect_required = bool(wanted_url) and wanted_url != client.base_url
    # The session is bound to the server it signed in to; keep reporting that one
    FIN_SERVER_URL = client.base_url
    client.project_name = PROJECT_NAME
    # Rows read for the previous project feed /his-points and the alarm views until the next poll
    client.last_alarm_rows = []
    client.last_point_rows = []
    name_source = _name_source(bool(kept) and "project_name" not in ACTIVE_OVERRIDES)
    PROJECT_CHECK = {
        "validated": await _validate_project(client) if PROJECT_NAME else None,
        "source": name_source,
    }

    _cancel_polling()
    _reset_caches()
    if PROJECT_NAME:
        _start_polling()

    return {
        "status": "success",
        "project": PROJECT_NAME,
        "reconnect_required": reconnect_required,
        "project_validated": PROJECT_CHECK["validated"],
        "project_source": PROJECT_CHECK["source"],
    }


@app.get("/api/fin/project-settings")
async def get_project_settings():
    """The configuration the backend is serving right now, and where each block comes from.

    Needs a session: it returns point IDs. `source` is "project" when the open project
    supplies the block and "default" when config.json does.
    """
    _require_client()
    blocks = ["live_point_ids", "power_endpoints", "equipment_classes", "meter_profile", "severity_bands"]
    return {
        "project_id": ACTIVE_PROJECT_ID,
        "project_name": PROJECT_NAME,
        "config": {key: CONFIG.get(key) for key in blocks},
        "source": {key: "project" if key in ACTIVE_OVERRIDES else "default" for key in blocks},
    }


# ─── Mapping validation ──────────────────────────────────────────────────────
# Checks what the editor sends against the FIN project the session is signed in to. It reads
# FIN and nothing else: it never changes the configuration, never looks at config.json, and
# never invents a mapping, so a default can not be reported as the project's own.

MAX_VALIDATED_POINTS = 300
POINT_REF_RE = re.compile(r"(?:readById|hisRead)\(@([^,)\s]+)")


def _item(status: str, detail: Optional[str] = None) -> dict:
    return {"status": status, **({"detail": detail} if detail else {})}


def _block(items: dict, detail: Optional[str] = None, status: Optional[str] = None) -> dict:
    """Block status from its items: any missing -> not_found, else any unchecked -> cannot_validate."""
    if status is None:
        found = {i["status"] for i in items.values()}
        status = ("not_found" if "not_found" in found
                  else "cannot_validate" if "cannot_validate" in found or not found
                  else "valid")
    return {"status": status, "items": items, **({"detail": detail} if detail else {})}


def _not_configured(block: str) -> dict:
    # backend_default: this block is not set by the open project, so the backend serves its own
    # default for it. Reported so the UI can say so; the default itself is never returned.
    key = {"finLivePoints": "live_point_ids", "finEndpoints": "power_endpoints",
           "finEquipmentClasses": "equipment_classes", "finMeterProfile": "meter_profile",
           "finSeverityBands": "severity_bands"}[block]
    return {"status": "not_configured", "items": {}, "backend_default": key not in ACTIVE_OVERRIDES}


async def _point_results(c, pids: list[str]) -> dict[str, dict]:
    """valid / not_found / cannot_validate per resolved point ID, using FIN only."""
    catalogue = {str(safe_get(r.get("id"), "val") or "").lstrip("@") for r in c.last_point_rows or []}
    sem = asyncio.Semaphore(8)

    async def one(pid: str) -> dict:
        if not c.project_name:
            return _item("cannot_validate", "This project has no FIN Project Name to check against.")
        if pid in catalogue:
            return _item("valid")
        async with sem:
            status, text = await c.fetch_probe(
                f"/api/{quote(c.project_name, safe='')}/eval?expr={quote(f'readById(@{pid})', safe='')}")
        if status is None:
            return _item("cannot_validate", "FIN could not be reached.")
        if status == 404:
            return _item("not_found", "FIN has no such record in this project.")
        if status != 200:
            return _item("cannot_validate", f"FIN answered {status}.")
        if _is_error_grid(text or ""):
            return _item("not_found", "FIN has no such record in this project.")
        lines = (text or "").strip().split("\n")
        return _item("valid") if len(lines) >= 3 and lines[2].strip() else _item(
            "not_found", "FIN has no such record in this project.")

    unique = sorted(set(pids))
    return dict(zip(unique, await asyncio.gather(*(one(p) for p in unique))))


def _meter_items(profile: dict) -> dict:
    realtime = (cached_building_data.get("Building_Info") or {}).get("Equipments") or {}
    prefix = str(profile.get("prefix") or "").strip()
    point_map = profile.get("point_map") if isinstance(profile.get("point_map"), dict) else {}
    if not realtime:
        wait = _item("cannot_validate", "Equipment has not been read from FIN yet. Try again in a moment.")
        return {**({"prefix": wait} if prefix else {}), **{k: wait for k in point_map}}
    meters = _extract_meters(realtime, {"prefix": prefix, "point_map": point_map}) if prefix and point_map else {}
    items: dict = {}
    if prefix:
        found = any(str(eq.get("name", "")).upper().startswith(prefix.upper())
                    for fd in realtime.values() if isinstance(fd, dict)
                    for eq in fd.get("hvac", []) if isinstance(eq, dict))
        items["prefix"] = _item("valid") if found else _item("not_found", f"No equipment name starts with {prefix}.")
    for key in point_map:
        if not meters:
            items[key] = _item("cannot_validate", "No meter matched the prefix to read this metric from.")
        elif any(m.get(key) is not None for m in meters.values()):
            items[key] = _item("valid")
        else:
            items[key] = _item("not_found", "No meter point matches these aliases.")
    return items


@app.post("/api/fin/validate-mapping")
async def validate_mapping(req: ValidateMappingRequest):
    """Check the given mapping blocks against the FIN project this session is signed in to."""
    _require_client()
    # The session serves one project at a time; refuse rather than check another project's mappings
    if req.project_id != ACTIVE_PROJECT_ID:
        raise HTTPException(status_code=409, detail="The backend is serving a different project.")

    def given(name: str) -> Optional[dict]:
        value = req.blocks.get(name)
        return value if isinstance(value, dict) and value else None

    live, endpoints = given("finLivePoints"), given("finEndpoints")
    # (block, key, resolved point id) for everything that names a FIN point
    refs: list[tuple[str, str, Optional[str]]] = []
    for key, value in (live or {}).items():
        refs.append(("finLivePoints", key, str(value).replace("{project}", client.project_name).lstrip("@")
                     if isinstance(value, str) else None))
    for key, value in (endpoints or {}).items():
        match = POINT_REF_RE.search(value) if isinstance(value, str) else None
        refs.append(("finEndpoints", key, match.group(1).replace("{project}", client.project_name)
                     if match else None))

    readable = [pid for _, _, pid in refs if pid and POINT_ID_RE.match(pid)]
    if len(set(readable)) > MAX_VALIDATED_POINTS:
        raise HTTPException(status_code=413, detail=f"More than {MAX_VALIDATED_POINTS} points to check.")
    results = await _point_results(client, readable)

    blocks: dict = {}
    for name in ("finLivePoints", "finEndpoints"):
        if not given(name):
            blocks[name] = _not_configured(name)
            continue
        items = {}
        for block, key, pid in refs:
            if block != name:
                continue
            if pid is None:
                items[key] = _item("cannot_validate", "No FIN point ID found in this value.")
            elif not POINT_ID_RE.match(pid):
                items[key] = _item("cannot_validate", "Not a point ID this check can read.")
            else:
                items[key] = results[pid]
        blocks[name] = _block(items)

    profile = given("finMeterProfile")
    blocks["finMeterProfile"] = _block(_meter_items(profile)) if profile else _not_configured("finMeterProfile")

    # No FIN record backs these: which tags count as plant, and what a priority number means, is site policy
    for name in ("finEquipmentClasses", "finSeverityBands"):
        blocks[name] = (_block({}, "Site policy: FIN holds nothing to check this against.", "cannot_validate")
                        if given(name) else _not_configured(name))

    return {
        "project_id": ACTIVE_PROJECT_ID,
        "project_name": PROJECT_NAME,
        "valid": not any(b["status"] == "not_found" for b in blocks.values()),
        "blocks": blocks,
    }


# ─── FIN project discovery ───────────────────────────────────────────────────
# Which FIN projects exist on the server, and which resources one of them has. Both go through
# the signed-in session, so the browser never holds FIN credentials, and neither changes the
# project the session is serving: the project asked about travels in the request, not the session.

MAX_RESOURCES = 5000


def _fin_failure(status: Optional[int], text: Optional[str], what: str) -> HTTPException:
    """The API error for a FIN answer that is not a usable grid."""
    if status is None:
        return HTTPException(status_code=502, detail="FIN could not be reached.")
    if status in (401, 403):
        # not 401: that would read as "the Eko-DT session ended"
        return HTTPException(status_code=403, detail=f"FIN did not allow this account to read {what}.")
    if status == 404:
        return HTTPException(status_code=404, detail=f"FIN has no such {what}.")
    return HTTPException(status_code=502, detail=f"FIN answered {status} for {what}.")


@app.get("/api/fin/projects")
async def get_fin_projects():
    """The projects on the FIN server: [{"id": "marsaAlArab", "name": "..."}].

    `id` is the identifier FIN uses in `/api/{id}/...`; `name` is only for display. The request
    is the one the FIN Host page makes (POST /api/sys/eval); its expression comes from
    config.json `project_discovery`, so a server that answers differently needs no code change.
    """
    _require_client()
    cfg = CONFIG.get("project_discovery") or {}
    endpoint = str(cfg.get("endpoint") or "").strip()
    expr = str(cfg.get("expr") or "").strip()
    if not endpoint or not expr:
        raise HTTPException(
            status_code=503,
            detail="FIN project discovery is not configured (config.json project_discovery.endpoint and .expr).")
    status, text = await client.post_probe(endpoint, zinc_string_body(expr))
    if status != 200 or text is None:
        raise _fin_failure(status, text, "project list")
    if _is_error_grid(text):
        raise HTTPException(status_code=502, detail="FIN returned an error for the project list.")
    return {"projects": parse_fin_projects(text), "server_url": client.base_url}


@app.get("/api/fin/resources")
async def get_fin_resources(project: str):
    """The points of ONE FIN project, for the Data Mapping pickers.

    Read-only, and keyed by the `project` asked about, never the session's: choosing a project
    in Dashboard Settings loads that project's own points before anything is saved.
    `ref` is the point ID with the project name written as {project}, ready to store in a mapping.
    """
    _require_client()
    if not PROJECT_ID_RE.match(project):
        raise HTTPException(status_code=400, detail="Not a FIN project identifier.")
    template = (CONFIG.get("realtime_endpoints") or {}).get("points")
    if not template:
        raise HTTPException(status_code=503, detail="No point query is configured (realtime_endpoints.points).")
    status, text = await client.fetch_probe(template.replace("{project}", quote(project, safe="")))
    if status != 200 or text is None:
        raise _fin_failure(status, text, "project")
    if _is_error_grid(text):
        raise HTTPException(status_code=404, detail="FIN has no such project.")
    rows = parse_zinc_csv(text)
    items = []
    for row in rows[:MAX_RESOURCES]:
        pid = str(safe_get(row.get("id"), "val") or "").lstrip("@")
        if not pid:
            continue
        equip = safe_get(row.get("equipRef"), "dis")
        items.append({
            "id": pid,
            "ref": pid.replace(f":{project}:", ":{project}:", 1) if f":{project}:" in pid else pid,
            "name": safe_get(row.get("id"), "dis") or row.get("dis") or row.get("navName") or pid,
            "navName": row.get("navName") if isinstance(row.get("navName"), str) else None,
            "equip": equip or None,
            "unit": row.get("unit") if isinstance(row.get("unit"), str) else None,
            "his": row.get("his") is True,
        })
    return {"project": project, "resources": items, "truncated": len(rows) > MAX_RESOURCES}


@app.get("/api/fin/status", response_model=StatusResponse)
async def get_status():
    """Check connection status."""
    return StatusResponse(
        connected=client.is_authenticated if client else False,
        project_name=PROJECT_NAME,
        server_url=FIN_SERVER_URL,
        display_name=_display_name(),
        project_validated=PROJECT_CHECK["validated"] if client and client.is_authenticated else None,
        project_source=PROJECT_CHECK["source"] if client and client.is_authenticated else None,
        project_id=ACTIVE_PROJECT_ID,
    )


@app.get("/api/fin/equip-live")
async def get_equip_live():
    """Get live equipment data (floor-wise with points and alarms)."""
    if not client or not client.is_authenticated:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return cached_equip_data or {"timestamp": None, "equipment": []}


@app.get("/api/fin/power-live")
async def get_power_live():
    """Get live power/energy/sensor data."""
    if not client or not client.is_authenticated:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return cached_power_data or {}


@app.get("/api/fin/power-history")
async def get_power_history():
    """Get the historian series. Refreshed once per realtime cycle, not per live poll."""
    if not client or not client.is_authenticated:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return cached_power_history or {}


@app.get("/api/fin/pmu-live")
async def get_meter_live():
    """Get power-meter equipment metrics keyed by meter name."""
    if not client or not client.is_authenticated:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return cached_meter_data


@app.get("/api/fin/alarms")
async def get_alarms():
    """Get the flat active-alarm list with counts by severity."""
    if not client or not client.is_authenticated:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return cached_alarm_data or {
        "timestamp": None,
        "alarms": [],
        "counts": {"critical": 0, "warning": 0, "info": 0, "total": 0},
    }


READ_ONLY_EXPR = re.compile(r"^\s*(readById|readAll|hisRead)\s*\(")
BLOCKED_EXPR = re.compile(
    r"pointWrite|pointOverride|pointEmergency|pointSetDef|pointAuto"
    r"|ioWrite|invoke|commit|recNew|recEdit|recRemove|eval\s*\(",
    re.IGNORECASE,
)


@app.get("/api/fin/eval")
async def eval_read(expr: str):
    """Read-only Axon passthrough for history charts and trends."""
    if not client or not client.is_authenticated:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if len(expr) > 2000 or not READ_ONLY_EXPR.match(expr) or BLOCKED_EXPR.search(expr):
        raise HTTPException(status_code=400, detail="Only readById, readAll, and hisRead expressions are allowed")
    text = await client.fetch_api(
        f"/api/{client.project_name}/eval?expr={quote(expr, safe='')}", is_text=True
    )
    if text is None:
        raise HTTPException(status_code=502, detail="FIN request failed")
    return PlainTextResponse(text, media_type="text/zinc")


POINT_ID_RE = re.compile(r"^[A-Za-z0-9_:.\-]+$")


def _require_client():
    if not client or not client.is_authenticated:
        raise HTTPException(status_code=401, detail="Not authenticated")


@app.get("/api/fin/his-points")
async def get_his_points():
    """Catalogue of historized points for the History Charts picker."""
    _require_client()
    out = []
    for row in client.last_point_rows or []:
        if row.get("his") is not True:
            continue
        pid = safe_get(row.get("id"), "val")
        if not pid:
            continue
        out.append({
            "id": str(pid).lstrip("@"),
            "dis": safe_get(row.get("id"), "dis") or str(row.get("navName") or ""),
            "navName": str(row.get("navName") or ""),
            "equip": safe_get(row.get("equipRef"), "dis") or "",
            "unit": row.get("unit") or "",
        })
    out.sort(key=lambda p: (p["equip"], p["dis"]))
    return {"timestamp": datetime.now().isoformat(), "points": out}


@app.get("/api/fin/point-history")
async def get_point_history(id: str, days: int = 7):
    """hisRead one point and return the same nested shape as power_history."""
    _require_client()
    pid = id.lstrip("@")
    if not POINT_ID_RE.match(pid):
        raise HTTPException(status_code=400, detail="Invalid point id")
    days = max(1, min(int(days), 365))
    start = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")
    expr = f"hisRead(@{pid},{start}..today(),{{-limit}})"
    text = await client.fetch_api(
        f"/api/{client.project_name}/eval?expr={quote(expr, safe='')}", is_text=True
    )
    if text is None:
        raise HTTPException(status_code=502, detail="FIN request failed")
    parsed = parse_custom_response(text)
    return {
        "id": pid,
        "days": days,
        "unit": parsed.get("unit", ""),
        "curVal": parsed.get("curVal"),
        "samples": len(parsed.get("rows") or []),
        "history": aggregate_and_restructure(parsed.get("rows") or []),
    }


@app.get("/api/fin/alarm-history")
async def get_alarm_history(days: int = 30):
    """Alarm counts by day and severity. Empty when FIN retains no history.

    Defaults to 30 days: at Marsa a 7-day window catches 4 of 343 retained
    alarms and hides the 6 July cooling-valve event (196 alarms) entirely.
    """
    _require_client()
    days = max(1, min(int(days), 90))
    start = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")
    expr = f"readAll(equip or point).alarms({start}..today())"
    text = await client.fetch_api(
        f"/api/{client.project_name}/eval?expr={quote(expr, safe='')}", is_text=True
    )
    if text is None:
        raise HTTPException(status_code=502, detail="FIN request failed")

    bands = CONFIG.get("severity_bands", {})
    by_day: dict[str, dict] = {}

    for row in parse_zinc_csv(text):
        if row.get("alarm") is not True:
            continue
        stamp = str(row.get("occurred") or row.get("created") or "")[:10]
        if not stamp:
            continue
        priority = row.get("priority") if isinstance(row.get("priority"), (int, float)) else None
        day = by_day.setdefault(stamp, {"critical": 0, "warning": 0, "info": 0})
        day[severity_for(priority, bands)] += 1

    return {
        "days": days,
        "retained": bool(by_day),
        "byDay": [{"date": d, **counts} for d, counts in sorted(by_day.items())],
    }


@app.get("/api/fin/building-info")
async def get_building_info():
    """Get full building data with history."""
    if not client or not client.is_authenticated:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return cached_building_data or {}


@app.post("/api/fin/logout")
async def logout():
    """Disconnect from FIN server."""
    global client, PROJECT_CHECK
    _cancel_polling()
    if client:
        await client.close()
        client = None
    PROJECT_CHECK = {"validated": None, "source": None}
    return {"status": "disconnected"}


@app.get("/api/fin/documents")
async def get_documents():
    """O&M and warranty manuals. Each link stays on this server."""
    return load_documents()


@app.get("/api/fin/file")
async def get_fin_file(ref: str, download: int = 0):
    """Stream a catalog PDF through the FIN session that is already signed in."""
    if not client or not client.is_authenticated:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if not re.fullmatch(r"@p:[A-Za-z0-9_]+:r:[0-9a-fA-F-]+", ref or ""):
        raise HTTPException(status_code=404, detail="Unknown document")
    doc = _catalog_doc(ref)
    if not doc:
        raise HTTPException(status_code=404, detail="Unknown document")
    url = _fin_rec_file_url(client.base_url, client.project_name, ref)
    headers = {"Accept": "application/pdf,*/*"}
    auth = (client.auth_headers or {}).get("Authorization")
    if auth:
        headers["Authorization"] = auth
    req = client.client.build_request("GET", url, headers=headers)
    resp = await client.client.send(req, stream=True)
    if resp.status_code in (401, 403):
        await resp.aclose()
        client.is_authenticated = False
        raise HTTPException(status_code=401, detail="FIN session ended")
    ctype = (resp.headers.get("content-type") or "").lower()
    if resp.status_code != 200 or "html" in ctype or ctype.startswith("text/") or "json" in ctype:
        await resp.aclose()
        raise HTTPException(status_code=502, detail="FIN did not return the PDF")

    async def body():
        try:
            async for chunk in resp.aiter_bytes(65536):
                yield chunk
        finally:
            await resp.aclose()

    filename = _pdf_filename(str(doc.get("name") or "document"))
    disposition = "attachment" if download else "inline"
    return StreamingResponse(
        body(),
        media_type="application/pdf",
        headers={"Content-Disposition": f'{disposition}; filename="{filename}"'},
    )


@app.get("/api/fin/config")
async def get_config():
    """Get the current config (without sensitive data)."""
    return {
        "project_id": ACTIVE_PROJECT_ID,
        "project_name": PROJECT_NAME,
        "server_url": FIN_SERVER_URL,
        "display_name": _display_name(),
    }


# ─── Session ─────────────────────────────────────────────────────────────────
# Vendor-neutral aliases used by the bundled sign-in page. The /api/fin/* routes
# above are kept for the studio app, which already calls them.


@app.get("/api/auth/status")
async def auth_status():
    """Session state for the sign-in page. Returns no credentials or point data."""
    return {
        "authenticated": client.is_authenticated if client else False,
        "project": PROJECT_NAME,
        "server_url": FIN_SERVER_URL,
        "display_name": _display_name(),
    }


@app.post("/api/auth/login")
async def auth_login(req: LoginRequest):
    return await login(req)


@app.post("/api/auth/logout")
async def auth_logout():
    return await logout()


# ─── Static Viewer App ────────────────────────────────────────────────────────

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BACKEND_DIR, "static")
MODELS_DIR = os.path.join(BACKEND_DIR, "models")
TEXTURES_DIR = os.path.join(BACKEND_DIR, "textures")
MAP_ASSETS_DIR = os.path.join(BACKEND_DIR, "mapassets")
PROJECT_JSON = os.path.join(BACKEND_DIR, "project.json")
LOGIN_HTML = os.path.join(BACKEND_DIR, "login.html")


@app.get("/login")
async def serve_login():
    """Serve the sign-in page. Never cached, so an updated page takes effect on reload."""
    if os.path.exists(LOGIN_HTML):
        return FileResponse(
            LOGIN_HTML,
            media_type="text/html",
            headers={"Cache-Control": "no-store, must-revalidate"},
        )
    raise HTTPException(status_code=404, detail="login.html not found")


@app.get("/project.json")
async def serve_project_json(request: Request):
    """Serve the project.json for the standalone viewer.

    Deliberately ungated: the viewer starts streaming models while the operator
    is still on the sign-in overlay. Live FIN data stays behind the session.
    """
    if not os.path.exists(PROJECT_JSON):
        raise HTTPException(status_code=404, detail="project.json not found")
    stat = os.stat(PROJECT_JSON)
    etag = f'"{stat.st_mtime_ns:x}-{stat.st_size:x}"'
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers={"ETag": etag})
    return FileResponse(
        PROJECT_JSON,
        media_type="application/json",
        headers={"ETag": etag, "Cache-Control": "private, no-cache"},
    )


@app.get("/thumbnail.webp")
async def serve_thumbnail():
    """Serve the project thumbnail."""
    thumb = os.path.join(BACKEND_DIR, "thumbnail.webp")
    if os.path.exists(thumb):
        return FileResponse(thumb, media_type="image/webp")
    raise HTTPException(status_code=404, detail="thumbnail not found")


def _resolve_within(base: str, filename: str) -> str:
    """Resolve filename under base, refusing anything that escapes it.

    Comparing the joined string against the base is not enough: on Windows
    join(base, "..\\x") still starts with base while resolving outside it.
    """
    root = os.path.realpath(base)
    target = os.path.realpath(os.path.join(root, filename))
    try:
        inside = os.path.commonpath([root, target]) == root
    except ValueError:  # different drive
        inside = False
    if not inside:
        raise HTTPException(status_code=403, detail="Forbidden")
    return target


@app.get("/textures/{filename:path}")
async def serve_texture(filename: str):
    """Serve a material texture. Names are content hashes, so these never change."""
    texture_path = _resolve_within(TEXTURES_DIR, filename)
    if not os.path.exists(texture_path):
        raise HTTPException(status_code=404, detail=f"Texture {filename} not found")
    media, _ = mimetypes.guess_type(texture_path)
    return FileResponse(
        texture_path,
        media_type=media or "application/octet-stream",
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )


@app.get("/mapassets/{filename:path}")
async def serve_map_asset(filename: str):
    """Serve a map render. Names are content hashes, so these never change."""
    asset_path = _resolve_within(MAP_ASSETS_DIR, filename)
    if not os.path.exists(asset_path):
        raise HTTPException(status_code=404, detail=f"Map asset {filename} not found")
    media, _ = mimetypes.guess_type(asset_path)
    return FileResponse(
        asset_path,
        media_type=media or "application/octet-stream",
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )


@app.get("/map/regions/{filename:path}")
async def serve_builtin_map_region(filename: str):
    """Serve bundled satellite renders that ship with the exported viewer."""
    regions_dir = os.path.join(STATIC_DIR, "map", "regions")
    asset_path = _resolve_within(regions_dir, filename)
    if not os.path.exists(asset_path):
        raise HTTPException(status_code=404, detail=f"Map region {filename} not found")
    media, _ = mimetypes.guess_type(asset_path)
    return FileResponse(
        asset_path,
        media_type=media or "image/webp",
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )


@app.get("/models/{filename:path}")
async def serve_model(filename: str, request: Request):
    """Serve model files (.frag / .glb); ungated so they load during sign-in."""
    model_path = _resolve_within(MODELS_DIR, filename)
    if not os.path.exists(model_path):
        raise HTTPException(status_code=404, detail=f"Model {filename} not found")
    stat = os.stat(model_path)
    etag = f'"{stat.st_mtime_ns:x}-{stat.st_size:x}"'
    # A matched ETag turns a 100+ MB transfer into a 304 on every revisit
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers={"ETag": etag})
    media = "model/gltf-binary" if model_path.endswith(".glb") else "application/octet-stream"
    return FileResponse(
        model_path,
        media_type=media,
        headers={"ETag": etag, "Cache-Control": "private, no-cache"},
    )


@app.get("/")
@app.get("/viewer.html")
async def serve_viewer():
    """Serve the viewer SPA; it shows its own sign-in overlay until a session exists."""
    viewer_path = os.path.join(STATIC_DIR, "viewer.html")
    if os.path.exists(viewer_path):
        return FileResponse(viewer_path, media_type="text/html")
    return {"error": "Viewer not found. Make sure static/ folder is present."}


if os.path.exists(STATIC_DIR):
    app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
