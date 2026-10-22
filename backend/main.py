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
import sqlite3
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from typing import Any, Optional
from urllib.parse import quote, unquote

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from fin_client import (
    PROJECT_ID_RE,
    FinScramClient,
    aggregate_and_restructure,
    bool_state,
    bool_text,
    clip_decimals,
    display_cur_val,
    open_alarm_rows,
    parse_custom_response,
    parse_fin_projects,
    parse_zinc_csv,
    safe_get,
)
from point_control import control_for, encode_value, equipment_class, number_of
from workorders import error_payload, live_payload, norm_id, orders_by_equipment
import notifications

# ─── Load Config ─────────────────────────────────────────────────────────────

CONFIG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.json")

with open(CONFIG_PATH, "r") as f:
    BASE_CONFIG = json.load(f)

# CONFIG is what the polling loops and parsers read. It starts as the file defaults and is
# replaced by BASE_CONFIG overlaid with the open project's settings (see below). Whether
# config.json's FIN mappings are a fallback depends on who supplied the settings: see
# apply_project_settings.
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


def merge_project_settings(base: dict, settings: Optional[dict], isolated: bool = False) -> dict:
    """Overlay a project's apiSettings onto the config.json defaults.

    A project value replaces the default whole (never a key-by-key merge, so one
    site's point IDs cannot leak into another's). With `isolated`, the five FIN mapping
    blocks start empty instead of from config.json: a block the project did not set is
    not configured, and config.json's own site mappings are never used for it.
    """
    merged = copy.deepcopy(base)
    if isolated:
        for key in PROJECT_DICT_SETTINGS.values():
            merged[key] = {}
        # config.json's work-order query reads its own site's table (workOrderMarsa)
        merged["workorder_expr"] = ""
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
# True while a Studio project is served: its mappings are only its own (no config.json fallback)
ACTIVE_ISOLATED = False

# Per-project ("dynamic") FIN mappings from a Studio project's apiSettings. Off for now, by client
# decision: a project on config.json's own site is served config.json's standard mappings.
# True restores per-project mappings for it too. Other FIN projects are always per-project.
PROJECT_MAPPINGS_DYNAMIC = False

# The Studio project this session verified as config.json's own site (_serves_standard_site: its
# FIN project holds config.json's records on the server signed in to), or None. Only then does the
# backend serve it config.json's mappings, so only then are config.json's keys that project's keys.
STANDARD_VERIFIED: Optional[dict] = None


def apply_studio_settings(settings: dict, project_id: Optional[str], standard: bool) -> None:
    """A Studio project's settings. `standard` (see _serves_standard_site): its FIN name and interval
    apply but the mappings are config.json's, so a saved, partial or empty block cannot replace them.
    Otherwise the project's own mappings are the only ones."""
    global STANDARD_VERIFIED
    if standard:
        apply_project_settings({k: v for k, v in settings.items() if k not in PROJECT_DICT_SETTINGS}, project_id)
        STANDARD_VERIFIED = {"project_id": project_id, "project_name": BASE_CONFIG.get("project_name")}
    else:
        apply_project_settings(settings, project_id, isolated=True)
        STANDARD_VERIFIED = None


def apply_project_settings(settings: Optional[dict], project_id: Optional[str] = None,
                           isolated: bool = False) -> None:
    """Make `settings` the active configuration; None restores the config.json defaults.

    Two runtimes, kept apart on purpose:
    * Studio (isolated=True): the settings come from an Eko-DT project's project.json, sent by
      the Studio at sign-in or on a project switch. That project's mappings are the only ones;
      a block it did not save is not configured (see apply_studio_settings for config.json's site).
    * Standalone / exported backend and the plain default site (isolated=False): config.json is
      the site's own configuration, and it fills any block the bundled project.json leaves out.
    """
    global CONFIG, PROJECT_NAME, FIN_SERVER_URL, ACTIVE_PROJECT_ID, ACTIVE_OVERRIDES, ACTIVE_ISOLATED
    CONFIG = merge_project_settings(BASE_CONFIG, settings, isolated)
    ACTIVE_ISOLATED = isolated
    PROJECT_NAME = CONFIG["project_name"]
    FIN_SERVER_URL = CONFIG.get("fin_server_url", "https://localhost")
    ACTIVE_PROJECT_ID = project_id or None
    ACTIVE_OVERRIDES = sorted(project_overrides(settings))


def _block_source(key: str) -> str:
    """Where the active value of a mapping block comes from (config.json key)."""
    if key in ACTIVE_OVERRIDES:
        return "project"
    return "not_configured" if ACTIVE_ISOLATED else "default"


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


def _ref_project(ref: str) -> Optional[str]:
    """The FIN project a record ref belongs to: "@p:marsaAlArab:r:..." -> "marsaAlArab"."""
    m = re.match(r"@p:([^:]+):r:", ref or "")
    return m.group(1) if m else None


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
    """Re-read the catalog each call so an edit shows up on the next poll.

    A manual is a record of ONE FIN project, so only the active project's are listed: another
    project's equipment is never matched to this site's manuals."""
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
        had_doc = False
        for kind in ("om", "warranty"):
            doc = fam.get(kind)
            if not isinstance(doc, dict) or not doc.get("ref"):
                continue
            ref = str(doc["ref"])
            had_doc = True
            if _ref_project(ref) != PROJECT_NAME:
                continue
            item[kind] = {
                "name": str(doc.get("name") or ""),
                "nameAr": str(doc.get("nameAr") or ""),
                "ref": ref,
                "url": _viewer_file_url(ref),
            }
        if had_doc and "om" not in item and "warranty" not in item:
            continue   # every manual of this family belongs to another FIN project
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
cached_workorders: dict = {}


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
            await refresh_workorders()
            _compute_sensor_averages(realtime)
            cached_fdd_summary = _build_fdd_summary(realtime)
            cached_meter_data = _extract_meters(realtime, CONFIG.get("meter_profile", {}))
            cached_alarm_data = _flatten_alarms(client.last_alarm_rows, CONFIG.get("severity_bands", {}))
            _note_critical_alarms(client.project_name, cached_alarm_data["alarms"],
                                  getattr(client, "last_alarm_read_ok", False))
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
        buckets = floor_data.values() if isinstance(floor_data, dict) else []
        for items in buckets:
            if not isinstance(items, list):
                continue
            for eq in items:
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

    A threshold that is not configured never matches: with no bands at all every alarm is
    "info", rather than being graded against one site's numbers.
    """
    if not isinstance(priority, (int, float)):
        return "info"
    crit = bands.get("critical")
    warn = bands.get("warning")
    crit = crit if isinstance(crit, (int, float)) and not isinstance(crit, bool) else None
    warn = warn if isinstance(warn, (int, float)) and not isinstance(warn, bool) else None
    if str(bands.get("order", "desc")).lower() == "asc":
        # low number = most urgent; thresholds are inclusive upper bounds
        if crit is not None and priority <= crit:
            return "critical"
        return "warning" if warn is not None and priority <= warn else "info"
    # high number = most urgent; thresholds are inclusive lower bounds
    if crit is not None and priority >= crit:
        return "critical"
    return "warning" if warn is not None and priority >= warn else "info"


def _flatten_alarms(rows: list, bands: dict) -> dict:
    alarms = []
    counts = {"critical": 0, "warning": 0, "info": 0}

    for row in open_alarm_rows(rows):   # one per logical alarm: a re-issued FIN record is not a second alarm
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
            # FIN's own record id, as sent (None when FIN sends none: never made up)
            "id": safe_get(row.get("id"), "val") or None,
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
                    "equipId": eq.get("equipId") or "",
                    "points": _with_control(eq_name, tags, eq.get("points", [])),
                })
    return equip_list


def _with_control(eq_name: str, tags: list, points: list) -> list:
    """Stamp each point with what the dashboard may change on it (point_control in config.json)."""
    policy = CONFIG.get("point_control") or {}
    eq_class = equipment_class(eq_name, tags, policy)
    for point in points:
        point["control"] = control_for(point, eq_class, policy)
    return points


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
    # a deployment setting, never a project's: projects cannot point the history elsewhere
    notifications.configure(BASE_CONFIG.get("notification_db_path"))
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
    global cached_facility, cached_workorders
    cached_equip_data = {}
    cached_power_data = {}
    cached_building_data = {}
    cached_sensor_avg = {"temp": None, "humidity": None, "co2": None}
    cached_power_history = {}
    cached_fdd_summary = []
    cached_meter_data = {}
    cached_alarm_data = {}
    cached_facility = {}
    cached_workorders = {}


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
    # No cross-origin browser access by default: every page this backend serves is same-origin, and
    # the Studio reaches it through its dev proxy. "*" let any web page read FIN data through the
    # shared session; a deployment that needs another origin lists it in config.json.
    allow_origins=[o for o in (BASE_CONFIG.get("cors_allow_origins") or []) if isinstance(o, str) and o != "*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Eko-Project"],
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


async def _serves_standard_site(c) -> bool:
    """Whether this signed-in session reads config.json's own site, so its standard mappings apply.
    Not by server address (the FIN server's IP/URL changes): the session's FIN project must be
    config.json's project_name AND a record config.json maps must exist in it on this server.
    FIN record IDs are per database, so another server's project of the same name has none."""
    if PROJECT_MAPPINGS_DYNAMIC or not c.project_name or c.project_name != BASE_CONFIG.get("project_name"):
        return False
    ref = next((v for k, v in (BASE_CONFIG.get("live_point_ids") or {}).items()
                if not str(k).startswith("_") and isinstance(v, str) and ":r:" in v), None)
    if not ref:
        return False
    pid = ref.replace("{project}", c.project_name)
    found = (await _point_results(c, [pid]))[pid]["status"] == "valid"
    if not found:
        print(f"[FIN] {c.project_name} on this server does not hold config.json's points: project mappings used")
    return found


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
    global client, FIN_SERVER_URL, PROJECT_NAME, PROJECT_CHECK, TYPED_NAME, STANDARD_VERIFIED
    STANDARD_VERIFIED = None   # a new session proves the standard site again (below), or not at all

    # Settings sent with the login belong to the Studio project being opened, and only they
    # configure it. Without them the configuration already active (bundled project or
    # config.json) stays in force
    managed = req.settings is not None
    typed = (req.project_name or "").strip()
    if managed:
        # its own mappings until the signed-in session proves it reads config.json's site (below)
        apply_studio_settings(req.settings, req.project_id, standard=False)

    server_url = req.server_url or FIN_SERVER_URL
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
        if managed and await _serves_standard_site(client):
            apply_studio_settings(req.settings, req.project_id, standard=True)
            FIN_SERVER_URL, PROJECT_NAME = server_url, project   # the session's, not config.json's
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

    # A project without its own FIN Project Name is unconfigured, except for the name typed at
    # sign-in for this same project. Never the config.json default, never another project's name.
    if TYPED_NAME and TYPED_NAME[0] != (req.project_id or None):
        TYPED_NAME = None
    kept = TYPED_NAME[1] if TYPED_NAME else ""
    apply_studio_settings(req.settings, req.project_id, standard=False)
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
    if PROJECT_NAME and await _serves_standard_site(client):
        apply_studio_settings(req.settings, req.project_id, standard=True)
        FIN_SERVER_URL, PROJECT_NAME = client.base_url, client.project_name

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
    supplies the block, "default" when config.json does (standalone / default site only), and
    "not_configured" when a Studio project has not set it (its config is then empty).
    """
    _require_client()
    blocks = ["live_point_ids", "power_endpoints", "equipment_classes", "meter_profile", "severity_bands"]
    return {
        "project_id": ACTIVE_PROJECT_ID,
        "project_name": PROJECT_NAME,
        "config": {key: CONFIG.get(key) for key in blocks},
        "source": {key: _block_source(key) for key in blocks},
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
    # backend_default: this block is not set by the open project and the backend serves
    # config.json's for it (standalone / default site only, never a Studio project). Reported so
    # the UI can say so; the default itself is never returned.
    key = PROJECT_DICT_SETTINGS[block]
    return {"status": "not_configured", "items": {}, "backend_default": _block_source(key) == "default"}


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

    `id` is the identifier FIN uses in `/api/{id}/...`; `name` is only for display. The request is
    GET /api/sys/eval?expr=secureEval(projs()) with the signed-in session. (The POST the FIN Host
    page makes needs a browser-issued Attest-Key, which a backend session does not have.) The
    endpoint and expression come from config.json `project_discovery`.
    """
    _require_client()
    cfg = CONFIG.get("project_discovery") or {}
    endpoint = str(cfg.get("endpoint") or "").strip()
    expr = str(cfg.get("expr") or "").strip()
    if not endpoint or not expr or str(cfg.get("method") or "GET").upper() != "GET":
        raise HTTPException(
            status_code=503,
            detail="FIN project discovery is not configured (config.json project_discovery: GET endpoint and expr).")
    status, text = await client.get_probe(endpoint, {"expr": expr})
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


@app.get("/api/fin/mapping-schema")
async def get_mapping_schema():
    """The keys each Data Mapping block can have, read from config.json: names only, never values.

    These are Eko-DT's own keys (what the dashboard and this backend read), the same for every
    project. The editor offers them as blank rows; no point ID, endpoint, tag or alias is sent.
    """
    def keys(obj) -> list:
        return [k for k in (obj if isinstance(obj, dict) else {}) if not k.startswith("_")]

    schema = {
        "finLivePoints": keys(BASE_CONFIG.get("live_point_ids")),
        "finEndpoints": keys(BASE_CONFIG.get("power_endpoints")),
        "finEquipmentClasses": keys(BASE_CONFIG.get("equipment_classes")),
        "finMeterProfile": keys((BASE_CONFIG.get("meter_profile") or {}).get("point_map")),
    }
    # config.json's site, by name only: never proof that a project IS that site
    if not PROJECT_MAPPINGS_DYNAMIC and BASE_CONFIG.get("project_name"):
        schema["standardProfile"] = BASE_CONFIG["project_name"]
    # Authoritative: the project this signed-in session verified on this server and serves
    # config.json's mappings (whose keys are then its keys). Absent when nothing was verified, e.g.
    # the same project name on another tenant, no session, or per-project mappings.
    if STANDARD_VERIFIED and client and client.is_authenticated and not PROJECT_MAPPINGS_DYNAMIC:
        schema["standardProject"] = STANDARD_VERIFIED["project_name"]
        schema["standardProjectId"] = STANDARD_VERIFIED["project_id"]
    return schema


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


# The Eko-DT project a data answer was polled for. The Studio swaps the dashboard as soon as a
# project opens, before the backend has switched to it: the stamp lets the dashboard drop an
# answer that still belongs to the previous project.
PROJECT_HEADER = "X-Eko-Project"


def _stamp(response: Response) -> None:
    response.headers[PROJECT_HEADER] = quote(ACTIVE_PROJECT_ID or "", safe="")


def _workorder_state() -> str:
    """off: no query configured; pending: not read yet; error; ok."""
    if not (CONFIG.get("workorder_expr") or "").strip():
        return "off"
    if not cached_workorders:
        return "pending"
    return "error" if cached_workorders.get("error") else "ok"


def _attach_workorders():
    """Copy the live jobs onto each equipment row. The only key is equipId."""
    if isinstance(cached_equip_data, dict):
        cached_equip_data["workOrderError"] = (cached_workorders or {}).get("error") or ""
        cached_equip_data["workOrderState"] = _workorder_state()
    equipment = (cached_equip_data or {}).get("equipment")
    if not isinstance(equipment, list):
        return
    grouped = orders_by_equipment(cached_workorders)
    for eq in equipment:
        equip_id = norm_id(eq.get("equipId"))
        eq["workOrders"] = list(grouped.get(equip_id, []))


CRITICAL_ALARM = "alarm.critical"


def _note_critical_alarms(site: str, alarms: list, read_ok: bool) -> None:
    """Contract trigger "critical alarm": only when the site allows it (config.json
    critical_alarm_sites lists its FIN project) AND the project's alarm.critical toggle is on; both
    are off by default. One row per open critical FIN alarm, keyed by FIN's own id (an alarm with
    no id is not notified), resolved once FIN stops reporting it. A failed or error read changes
    nothing: an answer FIN did not give is not "all clear"."""
    if not read_ok or not site:
        return
    try:
        store = notifications.store()
        open_now = {a["id"]: a for a in alarms if a.get("severity") == "critical" and a.get("id")}
        fields = dict(severity="critical", source_kind="alarm")
        for asset, state in store.active_states(site, CRITICAL_ALARM):   # cleared since the last poll
            if state not in open_now:
                store.condition(site, CRITICAL_ALARM, False, asset_id=asset, state=state, source_ref=state, **fields)
        allowed = site in [s for s in (BASE_CONFIG.get("critical_alarm_sites") or []) if isinstance(s, str)]
        if not allowed or not store.wants(notifications.project_recipient(site), CRITICAL_ALARM, default=False):
            return
        for fin_id, a in open_now.items():
            store.condition(site, CRITICAL_ALARM, True, asset_id=a.get("source") or None, state=fin_id,
                            source_ref=fin_id, params={"asset": a.get("source") or "", "message": a.get("message") or "",
                                                       "occurred": a.get("occurred") or "", "priority": a.get("priority")},
                            **fields)
    except (notifications.StoreError, sqlite3.Error, ValueError) as exc:
        print(f"[notifications] critical alarms not recorded: {exc.__cause__ or exc}")


def _note_workorder_sync(error: str) -> None:
    """Contract trigger "integration sync failed": one row while the FIN work-order read fails,
    resolved by the next good read. The site is the FIN project this session reads."""
    notifications.condition(client.project_name, "int.sync_failed", bool(error), severity="warning",
                            source_kind="integration", source_ref="fin-workorders",
                            params={"system": "FIN", "reason": error} if error else None)


async def refresh_workorders():
    """Eval workorder_expr from config, the same session as equipment and alarms."""
    global cached_workorders
    expr = (CONFIG.get("workorder_expr") or "").strip()
    if not client or not client.is_authenticated or not expr:
        return
    try:
        text = await client.fetch_api(
            f"/api/{client.project_name}/eval?expr={quote(expr, safe='')}",
            is_text=True,
        )
    except Exception as exc:
        print(f"[FIN] work order fetch error: {exc}")
        cached_workorders = error_payload(str(exc))
        _attach_workorders()
        _note_workorder_sync(cached_workorders["error"])
        return
    cached_workorders = live_payload(text or "")
    _attach_workorders()
    err = cached_workorders.get("error") or ""
    _note_workorder_sync(err)
    count = len(cached_workorders.get("orders") or [])
    print(f"[FIN] work orders: {err or str(count) + ' rows'}")


# ─── Notifications API (project-scoped) ─────────────────────────────────────
# The site is the FIN project this backend's own session serves and FIN validated; a browser
# cannot pick it. X-Eko-Project names the Eko-DT project the browser shows: it must equal the one
# the backend serves, so a dashboard left on another project is refused rather than served this
# one, and being a custom header it forces a CORS preflight that foreign origins fail.
# ponytail: read/dismissed/preference state belongs to the PROJECT (one shared recipient), not to a
# person: there is no per-user FIN identity yet. Upgrade to per-user recipients with sign-in identity.

NOTIF_BASE = "/api/notifications/v1"


class NotificationApiError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


@app.exception_handler(NotificationApiError)
async def _notification_error(request: Request, exc: NotificationApiError):
    """The contract's error shape; never a stack trace or a database message."""
    return JSONResponse(status_code=exc.status,
                        content={"error": {"code": exc.code, "message": exc.message, "details": {}}},
                        headers={PROJECT_HEADER: quote(ACTIVE_PROJECT_ID or "", safe="")})


def _notification_scope(request: Request) -> tuple[str, str]:
    """(recipient, site) for this request, taken only from the backend's own session."""
    if not client or not client.is_authenticated:
        raise NotificationApiError(401, "unauthenticated", "The backend is not signed in to FIN.")
    asked = request.headers.get(PROJECT_HEADER)
    if not asked:
        raise NotificationApiError(400, "project_required", f"The {PROJECT_HEADER} header is required.")
    if not ACTIVE_PROJECT_ID or unquote(asked) != ACTIVE_PROJECT_ID:
        raise NotificationApiError(409, "project_mismatch", "The backend is serving a different project.")
    site = client.project_name or ""
    if not notifications.SITE_RE.match(site) or PROJECT_CHECK.get("validated") is not True:
        raise NotificationApiError(409, "project_not_validated", "The open project is not validated on FIN.")
    return notifications.project_recipient(site), site


def _notif_call(op):
    """Run op(store): bad input is a 400, a storage fault a 500 with the fixed message only."""
    try:
        return op(notifications.store())
    except ValueError as exc:
        raise NotificationApiError(400, "invalid_input", str(exc))
    except notifications.StoreError:
        raise NotificationApiError(500, "storage_failed", notifications.STORE_FAILED)


def _found(item):
    if item is None:
        raise NotificationApiError(404, "not_found", "No such notification for this project.")
    return item


@app.get(NOTIF_BASE + "/notifications")
async def notifications_list(request: Request, response: Response, view: str = "all",
                             type_: Optional[str] = Query(None, alias="type"), severity: Optional[str] = None,
                             asset_id: Optional[str] = None, q: Optional[str] = None,
                             limit: str = str(notifications.PAGE_DEFAULT), cursor: Optional[str] = None):
    who, site = _notification_scope(request)
    _stamp(response)
    page = _notif_call(lambda s: s.list_notifications(
        who, site, view=view, type_=type_, severity=severity, asset_id=asset_id, q=q,
        limit=int(limit) if limit.lstrip("-").isdigit() else limit, cursor=cursor))
    page["unread_count"] = _notif_call(lambda s: s.unread_count(who, site))
    page["scope"] = "project"   # state shared by everyone viewing this project
    return page


@app.get(NOTIF_BASE + "/notifications/{notification_id}")
async def notifications_get(notification_id: str, request: Request, response: Response):
    who, site = _notification_scope(request)
    _stamp(response)
    return _found(_notif_call(lambda s: s.get_notification(who, site, notification_id)))


@app.post(NOTIF_BASE + "/notifications/{notification_id}/opened")
async def notifications_opened(notification_id: str, request: Request, response: Response):
    who, site = _notification_scope(request)
    _stamp(response)
    return _found(_notif_call(lambda s: s.mark_opened(who, site, notification_id)))


@app.post(NOTIF_BASE + "/notifications/{notification_id}/dismiss")
async def notifications_dismiss(notification_id: str, request: Request, response: Response):
    who, site = _notification_scope(request)
    _stamp(response)
    return _found(_notif_call(lambda s: s.dismiss(who, site, notification_id)))


@app.delete(NOTIF_BASE + "/notifications/{notification_id}/dismiss")
async def notifications_undismiss(notification_id: str, request: Request, response: Response):
    who, site = _notification_scope(request)
    _stamp(response)
    return _found(_notif_call(lambda s: s.undismiss(who, site, notification_id)))


@app.post(NOTIF_BASE + "/notifications/opened-all")
async def notifications_opened_all(request: Request, response: Response):
    who, site = _notification_scope(request)
    _stamp(response)
    return {"updated": _notif_call(lambda s: s.mark_all_opened(who, site))}


@app.post(NOTIF_BASE + "/notifications/dismiss-opened")
async def notifications_dismiss_opened(request: Request, response: Response):
    who, site = _notification_scope(request)
    _stamp(response)
    return {"updated": _notif_call(lambda s: s.dismiss_opened(who, site))}


@app.get(NOTIF_BASE + "/preferences")
async def notifications_preferences(request: Request, response: Response):
    who, site = _notification_scope(request)
    _stamp(response)
    return _notif_call(lambda s: s.get_preferences(who))


@app.put(NOTIF_BASE + "/preferences")
async def notifications_preferences_update(request: Request, response: Response):
    who, site = _notification_scope(request)
    _stamp(response)
    try:
        body = await request.json()
    except ValueError:
        raise NotificationApiError(400, "invalid_input", "The body must be JSON.")
    if not isinstance(body, dict) or set(body) - {"master_enabled", "types"}:
        raise NotificationApiError(400, "invalid_input", "Only master_enabled and types can be set.")
    return _notif_call(lambda s: s.update_preferences(
        who, master_enabled=body.get("master_enabled"), types=body.get("types")))


@app.get("/api/fin/workorders")
async def get_workorders(response: Response):
    """Live PPM rows. Empty until the FIN read succeeds."""
    if not client or not client.is_authenticated:
        raise HTTPException(status_code=401, detail="Not authenticated")
    _stamp(response)
    return {**(cached_workorders or {"timestamp": None, "source": "fin", "orders": [], "error": ""}), "state": _workorder_state()}


@app.get("/api/fin/equip-live")
async def get_equip_live(response: Response):
    """Get live equipment data (floor-wise with points and alarms)."""
    if not client or not client.is_authenticated:
        raise HTTPException(status_code=401, detail="Not authenticated")
    _stamp(response)
    if cached_equip_data:
        _attach_workorders()
    return cached_equip_data or {"timestamp": None, "equipment": []}


@app.get("/api/fin/power-live")
async def get_power_live(response: Response):
    """Get live power/energy/sensor data."""
    if not client or not client.is_authenticated:
        raise HTTPException(status_code=401, detail="Not authenticated")
    _stamp(response)
    return cached_power_data or {}


@app.get("/api/fin/power-history")
async def get_power_history(response: Response):
    """Get the historian series. Refreshed once per realtime cycle, not per live poll."""
    if not client or not client.is_authenticated:
        raise HTTPException(status_code=401, detail="Not authenticated")
    _stamp(response)
    return cached_power_history or {}


@app.get("/api/fin/pmu-live")
async def get_meter_live(response: Response):
    """Get power-meter equipment metrics keyed by meter name."""
    if not client or not client.is_authenticated:
        raise HTTPException(status_code=401, detail="Not authenticated")
    _stamp(response)
    return cached_meter_data


@app.get("/api/fin/alarms")
async def get_alarms(response: Response):
    """Get the flat active-alarm list with counts by severity."""
    if not client or not client.is_authenticated:
        raise HTTPException(status_code=401, detail="Not authenticated")
    _stamp(response)
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


# ─── Point control ───────────────────────────────────────────────────────────
# The only write path to FIN. What may be written is decided here from the live equipment data and
# config.json point_control, never from the request: the dashboard only names a point and a value.

class PointWriteRequest(BaseModel):
    point_id: str
    action: str = "set"   # "set" writes the value at the manual level; "auto" clears that level
    value: Any = None


def _controlled_point(point_id: str) -> tuple[dict, dict]:
    for eq in (cached_equip_data or {}).get("equipment") or []:
        for point in eq.get("points") or []:
            if point.get("id") == point_id:
                return eq, point
    raise HTTPException(status_code=404, detail="This point is not in the live equipment data.")


def _write_landed(record: dict, control: dict, literal: Optional[str], action: str) -> bool:
    """Whether FIN's record shows the request: the value reported back, or the manual level cleared."""
    held = number_of(record.get("writeLevel")) == control["level"]
    if action == "auto":
        return not held
    if control["role"] == "status":
        return held and bool_state(record.get("curVal")) == (literal == "T")
    current, wanted = number_of(record.get("curVal")), number_of(literal)
    return held and current is not None and wanted is not None and abs(current - wanted) < 1e-6


async def _read_back(point_id: str, control: dict, literal: Optional[str], action: str) -> tuple[dict, bool]:
    """FIN applies a write at once; the equipment reports it after its next poll, so re-read a few times."""
    record: dict = {}
    for attempt in range(6):
        record = await client.read_point(point_id) or record
        if record and _write_landed(record, control, literal, action):
            return record, True
        if attempt < 5:
            await asyncio.sleep(1)
    return record, False


@app.post("/api/fin/point-write")
async def write_point(req: PointWriteRequest):
    """Change a setpoint or status the point_control policy allows, then read it back from FIN."""
    _require_client()
    point_id = req.point_id.lstrip("@")
    if not POINT_ID_RE.match(point_id):
        raise HTTPException(status_code=400, detail="Invalid point id")
    if req.action not in ("set", "auto"):
        raise HTTPException(status_code=400, detail="action is set or auto")
    eq, point = _controlled_point(point_id)
    control = point.get("control")
    if not control:
        raise HTTPException(status_code=403, detail=f"{point.get('navName')} on {eq.get('name')} cannot be changed from the dashboard.")
    try:
        literal = encode_value(control, req.value) if req.action == "set" else None
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    ok, error = await client.write_point(point_id, control["level"], literal, f"EKO Digital Twin ({client.username})")
    print(f"[FIN] point write {eq.get('name')} {point.get('navName')} {req.action} {literal or ''}: {'sent' if ok else error}")
    if not ok:
        raise HTTPException(status_code=502, detail=error)

    record, confirmed = await _read_back(point_id, control, literal, req.action)
    cur = record.get("curVal")
    shown, _ = display_cur_val(cur, str(point.get("navName") or "").lower(), str(point.get("unit") or "")) if cur is not None else ("—", "Null")
    state = bool_state(cur)
    point.update({
        "currentValue": shown,
        "bool": state,
        "text": bool_text(point, state),
        "writeLevel": record.get("writeLevel"),
        "control": {**control, "manual": number_of(record.get("writeLevel")) == control["level"]},
    })
    return {
        "pointId": point_id,
        "confirmed": confirmed,
        "currentValue": point["currentValue"],
        "text": point["text"],
        "bool": state,
        "control": point["control"],
    }


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
async def get_alarm_history(response: Response, days: int = 30):
    """Alarm counts by day and severity. Empty when FIN retains no history.

    Defaults to 30 days: at Marsa a 7-day window catches 4 of 343 retained
    alarms and hides the 6 July cooling-valve event (196 alarms) entirely.
    """
    _require_client()
    _stamp(response)
    days = max(1, min(int(days), 90))
    start = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")
    expr = f"readAll(equip or point).alarms({start}..today())"
    text = await client.fetch_api(
        f"/api/{client.project_name}/eval?expr={quote(expr, safe='')}", is_text=True
    )
    if text is None:
        raise HTTPException(status_code=502, detail="FIN request failed")
    # ── TEMP-DIAG alarm-history: remove after investigation ──
    parsed_rows = parse_zinc_csv(text)
    print(
        "[TEMP-DIAG alarm-history]",
        {
            "raw_chars": len(text),
            "parsed_rows": len(parsed_rows),
            "columns": sorted(   # names only: parse_zinc_csv can take an error grid's text as its header
                {key for row in parsed_rows for key in row.keys() if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key)}
            ),
            "alarm_types": sorted(
                {type(row.get("alarm")).__name__ for row in parsed_rows}
            ),
            "alarm_true_count": sum(
                row.get("alarm") is True for row in parsed_rows
            ),
        },
    )
    # Response shape, names and flags only: quoted values are blanked and unquoted values dropped.
    # HTTP status is 200 by construction (fetch_api returns text only for 200).
    from fin_client import _split_zinc_csv, collapse_metadata_blocks
    _lines = [l.strip() for l in collapse_metadata_blocks(text.lstrip("\ufeff")).splitlines() if l.strip()]
    _first = _lines[0] if _lines else ""
    _zinc = _first.startswith("ver:")
    _bare = re.sub(r'"(?:\\.|[^"\\])*"', '""', _first) if _zinc else ""
    _ident = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
    _meta = sorted({t.split(":", 1)[0] for t in _bare.split()[1:] if _ident.match(t.split(":", 1)[0])})
    _cols = ([c for c in (x.strip().split(" ", 1)[0] for x in _split_zinc_csv(_lines[1])) if _ident.match(c)]
             if _zinc and len(_lines) > 1 else [])
    print(
        "[TEMP-DIAG alarm-history shape]",
        {
            "lines": len(_lines),
            "zinc_grid": _zinc,
            "starts_as": ("blank" if not _first else "zinc" if _zinc else "html" if _first[0] == "<"
                          else "json" if _first[0] in "{[" else "other"),
            "error_grid": _zinc and "err" in _meta,
            "grid_meta_names": _meta,
            "column_names": _cols,
            "data_lines": max(0, len(_lines) - 2) if _zinc else None,
            # Numeric counts only; never print the pollHandle value.
            "counts": {
                n: float(m.group(1))
                for n in ("resultCount", "totalRecordCount")
                if (
                    m := re.search(
                        rf"(?:^|\s){n}:(-?\d+(?:\.\d+)?)(?=\s|$)",
                        _bare,
                    )
                )
            },
            "poll_handle_present": "pollHandle" in _meta,
        },
    )
    # ── end TEMP-DIAG alarm-history ──

    bands = CONFIG.get("severity_bands", {})
    by_day: dict[str, dict] = {}
    last24 = [0] * 24
    try:
        from zoneinfo import ZoneInfo
        now = datetime.now(ZoneInfo("Asia/Dubai")).replace(tzinfo=None)
    except Exception:
        now = datetime.utcnow() + timedelta(hours=4)

    for row in parse_zinc_csv(text):
        if row.get("alarm") is not True:
            continue
        occurred = row.get("occurred") or row.get("created") or ""
        stamp = str(occurred)[:10]
        if stamp:
            priority = row.get("priority") if isinstance(row.get("priority"), (int, float)) else None
            day = by_day.setdefault(stamp, {"critical": 0, "warning": 0, "info": 0})
            day[severity_for(priority, bands)] += 1
        match = re.search(r"(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})", str(occurred))
        if match:
            try:
                when = datetime.strptime(
                    f"{match.group(1)} {match.group(2)}:{match.group(3)}:{match.group(4)}",
                    "%Y-%m-%d %H:%M:%S",
                )
                age_h = (now - when).total_seconds() / 3600.0
                if 0 <= age_h < 24:
                    last24[23 - int(age_h)] += 1
            except ValueError:
                pass

    return {
        "days": days,
        "retained": bool(by_day),
        "byDay": [{"date": d, **counts} for d, counts in sorted(by_day.items())],
        "last24": last24,
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
    global client, PROJECT_CHECK, STANDARD_VERIFIED
    STANDARD_VERIFIED = None
    _cancel_polling()
    if client:
        await client.close()
        client = None
    PROJECT_CHECK = {"validated": None, "source": None}
    return {"status": "disconnected"}


@app.get("/api/fin/documents")
async def get_documents(response: Response):
    """O&M and warranty manuals. Each link stays on this server."""
    _stamp(response)
    return load_documents()


@app.get("/api/fin/file")
async def get_fin_file(ref: str, download: int = 0):
    """Stream a catalog PDF through the FIN session that is already signed in."""
    if not client or not client.is_authenticated:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if not re.fullmatch(r"@p:[A-Za-z0-9_]+:r:[0-9a-fA-F-]+", ref or ""):
        raise HTTPException(status_code=404, detail="Unknown document")
    doc = _catalog_doc(ref) if _ref_project(ref) == client.project_name else None
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
        return FileResponse(
            viewer_path,
            media_type="text/html",
            headers={"Cache-Control": "no-store, must-revalidate"},
        )
    return {"error": "Viewer not found. Make sure static/ folder is present."}


if os.path.exists(STATIC_DIR):
    app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
