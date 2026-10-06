"""
FIN Connector Backend — FastAPI Server
Template-based: all project-specific values come from config.json.
Exposes REST API for the React frontend to consume.
Also serves the compiled viewer app from the 'static/' directory.
"""

import asyncio
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
    FinScramClient,
    aggregate_and_restructure,
    alarm_is_open,
    clip_decimals,
    parse_custom_response,
    parse_zinc_csv,
    safe_get,
)

# ─── Load Config ─────────────────────────────────────────────────────────────

CONFIG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.json")

with open(CONFIG_PATH, "r") as f:
    CONFIG = json.load(f)

PROJECT_NAME = CONFIG["project_name"]
FIN_SERVER_URL = CONFIG.get("fin_server_url", "https://localhost")


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
            if (
                "Hourly_Energy_Consumption_his" in cached_power_history
                and "Total_Power_Consumption_his" not in cached_power_history
            ):
                cached_power_history["Total_Power_Consumption_his"] = cached_power_history[
                    "Hourly_Energy_Consumption_his"
                ]
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

    live_ids = {
        k: v
        for k, v in (CONFIG.get("live_point_ids") or {}).items()
        if not str(k).startswith("_") and isinstance(v, str) and ":r:" in v
    }
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
            if "hourly_energy" in live_results and "total_power" not in live_results:
                live_results["total_power"] = live_results["hourly_energy"]
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
                    "system": str(eq.get("system") or "").strip().lower(),
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


class StatusResponse(BaseModel):
    connected: bool
    project_name: str
    server_url: str
    display_name: str


# ─── Endpoints ───────────────────────────────────────────────────────────────

@app.post("/api/fin/login")
async def login(req: LoginRequest):
    """Authenticate with FIN server using SCRAM-SHA-256."""
    global client, polling_tasks, FIN_SERVER_URL, PROJECT_NAME

    server_url = req.server_url or FIN_SERVER_URL
    project = req.project_name or PROJECT_NAME

    # Update globals if overridden
    FIN_SERVER_URL = server_url
    PROJECT_NAME = project

    _cancel_polling()

    # Close existing client
    if client:
        await client.close()

    client = FinScramClient(server_url, project)
    success = await client.authenticate(req.username, req.password)

    if not success:
        raise HTTPException(status_code=401, detail="Authentication failed")

    polling_tasks = [
        asyncio.create_task(realtime_loop()),
        asyncio.create_task(live_loop()),
    ]

    return {
        "status": "success",
        "message": f"Authenticated to {server_url} as {req.username}",
        "project": project,
    }


@app.get("/api/fin/status", response_model=StatusResponse)
async def get_status():
    """Check connection status."""
    return StatusResponse(
        connected=client.is_authenticated if client else False,
        project_name=PROJECT_NAME,
        server_url=FIN_SERVER_URL,
        display_name=CONFIG.get("display_name", PROJECT_NAME),
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
    global client
    _cancel_polling()
    if client:
        await client.close()
        client = None
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
        "project_name": PROJECT_NAME,
        "server_url": FIN_SERVER_URL,
        "display_name": CONFIG.get("display_name", PROJECT_NAME),
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
        "display_name": CONFIG.get("display_name", PROJECT_NAME),
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
