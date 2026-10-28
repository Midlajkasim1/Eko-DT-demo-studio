"""Eko-Chat fast query router (speed phase 1): deterministic, no LLM.

route(question) decides whether a question is one of a few simple, current-data questions that an
existing typed tool answers on its own. It is pure text matching: no model, no network, no FIN.

  {"route": "direct", "intent": <tool>, "parameters": {...}, "confidence": "high", "rule": <rule id>}
  {"route": "llm_fallback", "reason": "empty" | "unsafe_content" | "complex_question" |
                                      "multiple_equipment" | "invalid_parameters" | "unsupported_or_ambiguous"}

A question is routed directly only when a whole-question template matches (anchored, after removing
polite filler); anything with a time window, comparison, ranking, cause, several parts or more than one
equipment item goes to llm_fallback. The intent is always one of the four existing tools and the
parameters are checked against that tool's own schema.

execute(decision, view) answers a direct decision with the existing run_tool() and build_card() over the
same DataView the tools already read, so nothing here touches FIN or adds a query of its own.

Speed phase 2: POST /api/chat routes every question here first (unless chat.fast_router is false). A
direct question is answered by execute() plus direct_text() without building a model adapter; an
llm_fallback question continues to the unchanged converse() / stream_chat().
"""
from __future__ import annotations

import re
from typing import Any, Optional

from eko_chat import MAX_MESSAGE_CHARS, TOOLS, DataView, _validate, build_card, run_tool

SEVERITY_WORDS = {"critical": "critical", "warning": "warning", "warnings": "warning", "info": "info"}

# An explicit equipment id: letters, then at least one "-" or "_" separated part, with a digit somewhere
# (FCU-ANC09-GF-02, EQ-1, AHU_01). Plain words ("built-in") and floors ("L1") are not ids.
EQUIPMENT_ID = re.compile(r"(?<![\w-])([A-Za-z]{1,8}[0-9]*(?:[-_][A-Za-z0-9]+)+)(?![\w-])")

# Raw FIN / Zinc / Axon, SQL, shell, URLs or markup: never routed, whatever else the question says
UNSAFE = re.compile(
    r"readall|readbyid|hisread|hiswrite|pointwrite|commit\s*\(|eval\s*\(|@p:|\bp:\w+:r:|"
    r"\bselect\b.+\bfrom\b|\bdrop\s+table\b|\binsert\s+into\b|\bdelete\s+from\b|\bupdate\s+\w+\s+set\b|"
    r"https?://|\bfile:|\bftp:|`|\$\(|;|&&|\|\||\brm\s+-|<\s*/?\s*[a-z]+[^>]*>|\{\{|\}\}",
    re.I)

# Words that make a question more than "read the current value": time windows, comparisons, rankings,
# causes, advice, predictions and joins of several questions
COMPLEX = re.compile(
    r"\b(why|cause[sd]?|causing|reason|reasons|root|compare[sd]?|comparing|comparison|versus|vs|trend|trends|"
    r"trending|history|historical|yesterday|today|tonight|week|weeks|weekly|month|months|monthly|year|years|"
    r"daily|hour|hours|last|previous|past|since|until|between|ago|most|least|top|highest|lowest|worst|best|"
    r"more|fewer|less|average|avg|mean|total|sum|rank|ranking|predict|prediction|forecast|expect|should|"
    r"recommend|recommendation|suggest|fix|improve|could|might|will|if|and|or|also|then|after|before|"
    r"times|often|frequently|usually|deviation|anomal\w*)\b")

POLITE_PREFIX = re.compile(r"^(?:(?:hi|hey|hello)(?: eko)?[, ]+|eko[, ]+|please |kindly |can you |could you |would you |"
                           r"can i see |i want to see |i want to know |i would like to see |let me see )+")
POLITE_SUFFIX = re.compile(r"(?: please| thanks| thank you)+$")
NOW = r"(?: (?:right now|now|currently|at the moment|at present))?"
SEV = r"(?:(?P<sev>critical|warnings?|info) )?"
SHOW = r"(?:what are |what is |what's |which are |show(?: me)? |list |get |give me |display |check )?"
ALARMS = r"(?:alarms|alerts)"                       # "alerts" is the everyday word for FIN alarms
# "latest alarms" are the newest alarm RECORDS (open or cleared); only "latest open/active alarms" is the open list
OPEN = r"(?:(?:current|currently|active|open|live|ongoing|(?:latest|recent|newest)(?= (?:open|active)\b)) )*"
LATEST = r"(?:latest|recent|newest) "
N = r"(?:(?P<n>\d{1,2}|a|an|one|two|three|four|five|ten|single) )?"   # "one recent notification", "latest 5 alarms"
NUMBER_WORDS = {"a": 1, "an": 1, "one": 1, "single": 1, "two": 2, "three": 3, "four": 4, "five": 5, "ten": 10}
# words that follow "what ... do we have" / "show ..." but are not an equipment type
NOT_A_TYPE = {"alarm", "alert", "notification", "equipment", "asset", "item", "system", "unit", "thing", "point", "all",
              "one", "other", "help", "reading", "value", "metric", "fault", "problem", "status", "option"}
ASSETS = r"(?:equipment|assets?|equipment assets?)"
HERE = r"(?: (?:in|of|for|from) (?:this|the|our|your)(?: (?:currently selected|selected|current|open|active))? (?:project|building|site))?"

# (rule id, intent, anchored pattern). <eq> stands for the one explicit equipment id in the question.
RULES: list[tuple[str, str, re.Pattern]] = [(rid, intent, re.compile("^" + pat + "$")) for rid, intent, pat in [
    # current open alarms (optionally one severity)
    ("alarms.latest", "get_alarms",
     SHOW + r"(?:the )?" + LATEST + N + SEV + r"(?P<noun>alarms?|alerts?)" + NOW),
    ("alarms.list", "get_alarms",
     SHOW + r"(?:all )?(?:the )?" + OPEN + SEV + ALARMS + r"(?: (?:that are |which are )?(?:open|active))?" + NOW),
    ("alarms.any", "get_alarms",
     r"(?:are there |is there |do we have |do i have )?any " + OPEN + SEV + ALARMS + r"(?: (?:open|active))?" + NOW),
    ("alarms.which", "get_alarms",
     r"(?:what|which) " + SEV + ALARMS + r" (?:are|is) (?:open|active|on|raised)" + NOW),
    ("alarms.count", "get_alarms",
     r"how many " + OPEN + SEV + ALARMS + r"(?: (?:are there|are open|are active|do we have|are raised))?" + NOW),
    # alarms on one explicit equipment item
    ("alarms.equipment", "get_alarms",
     SHOW + r"(?:any |the )?" + OPEN + ALARMS + r" (?:on|for|of) <eq>" + NOW),
    ("alarms.equipment.has", "get_alarms",
     r"(?:does|has) <eq> (?:have |got )?(?:any )?" + OPEN + ALARMS + NOW),
    # building snapshot / status
    ("snapshot.status", "get_building_snapshot",
     SHOW + r"(?:the )?(?:(?:current|overall|live) )*(?:building|site) (?:status|overview|snapshot|summary|state)" + NOW),
    ("snapshot.status_of", "get_building_snapshot",
     SHOW + r"(?:the )?(?:current |overall )?(?:status|overview|snapshot|summary|state) of the (?:building|site)" + NOW),
    # current power / load: answered by the snapshot's configured live points
    ("snapshot.power", "get_building_snapshot",
     SHOW + r"(?:the )?(?:(?:current|live|present) )+(?:building |site )?(?:power(?: consumption| usage| demand| draw)?|electrical load|load|demand)" + NOW),
    ("snapshot.power_now", "get_building_snapshot",
     SHOW + r"(?:the )?(?:building |site )?(?:power(?: consumption| usage| demand| draw)?|electrical load) (?:right now|now|currently|at the moment)"),
    # equipment currently in alarm / the equipment list
    ("equipment.in_alarm", "find_equipment",
     r"(?:what|which) equipment (?:is|are) (?:currently )?in alarm" + NOW),
    ("equipment.in_alarm.list", "find_equipment",
     SHOW + r"(?:all )?(?:the )?equipment (?:that is |that are |which is |which are )?(?:currently )?in alarm" + NOW),
    ("equipment.in_alarm.has", "find_equipment",
     r"(?:what|which) " + ASSETS + r" (?:has|have) (?:any )?" + OPEN + ALARMS + NOW),
    ("equipment.list", "find_equipment",
     r"(?:show(?: me)? |list |display |get |give me )(?:all )?(?:the )?(?:(?:available|installed) )?" + ASSETS + HERE),
    ("equipment.available", "find_equipment",
     r"(?:what|which) " + ASSETS + r"(?: is| are| do we have)(?: available)?" + HERE),
    ("equipment.count", "find_equipment",
     r"how many " + ASSETS + r"(?: items)?(?: (?:are |is )?(?:there|available|do we have))*" + HERE + r"(?: (?:are |is )?(?:there|available))*"),
    # no per-item online flag is published: the backend's own online count of systems answers this
    ("equipment.online", "get_building_snapshot",
     r"(?:(?:what|which) " + ASSETS + r"|how many " + ASSETS + r"|how many systems) (?:is|are) (?:currently )?(?:online|running|connected)" + NOW),
    # the signed-in user's notifications; Eko-DT records no acknowledgement, so those questions get the read state
    ("notifications.ack", "get_notifications",
     SHOW + r"(?:the )?(?:un)?acknowledged notifications"),
    ("notifications.ack.which", "get_notifications",
     r"(?:what|which) notifications (?:have been|are|were|have not been|are not|were not) (?:un)?acknowledged"),
    ("notifications.unread", "get_notifications",
     r"(?:" + SHOW + r"(?:the )?|(?:do i have |are there )(?:any )?|how many )" + N + r"(?:unread|new) (?P<noun>notifications?)"),
    ("notifications.list", "get_notifications",
     SHOW + r"(?:the |all |my )*(?:(?:recent|latest|newest|current) )*" + N + r"(?:(?:recent|latest|newest) )*(?P<noun>notifications?)"),
    # status / information of one explicit equipment item
    ("equipment.status_of", "get_equipment_status",
     SHOW + r"(?:the )?(?:(?:current|live|latest) )*(?:status|state|condition|details|information|info|readings|points) (?:of|for|on) <eq>" + NOW),
    ("equipment.status", "get_equipment_status",
     SHOW + r"(?:the )?<eq>(?:'s)?(?: (?:current|live|latest))? (?:status|state|condition|details|information|info|readings|points)" + NOW),
    ("equipment.how", "get_equipment_status",
     r"how(?: is|'s) <eq>(?: (?:doing|running|performing|working))?" + NOW),
    ("equipment.is", "get_equipment_status",
     r"is <eq> (?:ok|okay|fine|running|working|online|healthy|in alarm|alarming)" + NOW),
    ("equipment.named", "get_equipment_status",
     r"(?:show(?: me)? |find |get |look up |lookup |display |check )?(?:the )?(?:equipment|asset|unit|item) (?:named|called|with (?:the )?name|with id|id) <eq>" + NOW),
    ("equipment.about", "get_equipment_status",
     r"(?:tell me about |show(?: me)? |check |look up |lookup |find )?(?:(?:the )?(?:equipment|asset) )?<eq>"),
    # a whole class by its abbreviation: "what AHUs do we have", "list all FCUs", "how many EF are there"
    ("equipment.type", "find_equipment",
     r"(?:what|which) (?P<kind>[a-z]{2,8}?)s? (?:do we have|are there|is there|are available|are installed|exist)" + HERE),
    ("equipment.type.list", "find_equipment",
     r"(?:show(?: me)? |list |display |get |give me )(?:all )?(?:the )?(?:(?:available|installed) )?(?P<kind>[a-z]{2,8}?)s?" + HERE),
    ("equipment.type.count", "find_equipment",
     r"how many (?P<kind>[a-z]{2,8}?)s?(?: (?:are there|do we have|are available|are installed|exist))?" + HERE),
]]


def _fallback(reason: str) -> dict:
    return {"route": "llm_fallback", "reason": reason}


def _normalize(text: str) -> str:
    t = text.strip().lower()
    t = re.sub(r"[?!.]+$", "", t).strip()
    t = re.sub(r"\s+", " ", t)
    t = re.sub(r"\bmost recent\b", "latest", t)
    t = re.sub(r"\blast (?=(?:\d+|one|two|three|four|five|ten) )", "latest ", t)
    t = POLITE_PREFIX.sub("", t)
    t = POLITE_SUFFIX.sub("", t)
    return t.strip(" ,")


def route(question: Any) -> dict:
    """The routing decision for one question. Deterministic; never raises."""
    if not isinstance(question, str) or not question.strip():
        return _fallback("empty")
    if len(question) > MAX_MESSAGE_CHARS:
        return _fallback("unsupported_or_ambiguous")
    if UNSAFE.search(question):
        return _fallback("unsafe_content")
    ids = list(dict.fromkeys(m.group(1) for m in EQUIPMENT_ID.finditer(question) if re.search(r"\d", m.group(1))))
    if len(ids) > 1:
        return _fallback("multiple_equipment")
    equipment = ids[0] if ids else None
    text = question if equipment is None else question.replace(equipment, "<eq>")
    text = _normalize(text)
    if text.count("?") or text.count(",") or COMPLEX.search(text):
        return _fallback("complex_question")
    for rid, intent, pattern in RULES:
        m = pattern.match(text)
        if not m:
            continue
        gd = m.groupdict()
        kind = (gd.get("kind") or "").lower()
        if kind in NOT_A_TYPE:
            continue
        params: dict = {}
        if "<eq>" in pattern.pattern:
            params["equipment"] = equipment
        if kind:
            params["type"] = kind
        sev = gd.get("sev")
        if sev:
            params["severity"] = SEVERITY_WORDS[sev]
        if gd.get("n"):
            params["limit"] = NUMBER_WORDS.get(gd["n"]) or int(gd["n"])
        elif gd.get("noun") in ("notification", "alarm", "alert"):
            params["limit"] = 1                      # "the latest notification" is one
        if rid.startswith("alarms.latest"):
            params["history"] = True
        if rid.startswith("equipment.in_alarm"):
            params["in_alarm"] = True
        if rid == "notifications.unread":
            params["view"] = "unread"
        if _validate(params, TOOLS[intent]["parameters"]):
            return _fallback("invalid_parameters")
        return {"route": "direct", "intent": intent, "parameters": params, "confidence": "high", "rule": rid}
    return _fallback("unsupported_or_ambiguous")


def execute(decision: dict, view: DataView) -> dict:
    """Answer a direct decision from the backend's own data: the existing tool and card, nothing else.

    Returns {"route": "direct", "intent", "parameters", "result", "card"}, or {"route": "rejected",
    "reason"} for anything that is not a valid direct decision (unknown tool, bad parameters)."""
    if not isinstance(decision, dict) or decision.get("route") != "direct":
        return {"route": "rejected", "reason": "not_direct"}
    intent, params = decision.get("intent"), decision.get("parameters")
    if intent not in TOOLS:
        return {"route": "rejected", "reason": "unknown_tool"}
    if not isinstance(params, dict) or _validate(params, TOOLS[intent]["parameters"]):
        return {"route": "rejected", "reason": "invalid_parameters"}
    result = run_tool(intent, params, view)
    return {"route": "direct", "intent": intent, "parameters": params, "result": result,
            "card": build_card(intent, params, result)}


def answer(question: str, view: DataView) -> Optional[dict]:
    """route() then execute(): the direct answer, or None when the question needs the model."""
    decision = route(question)
    return execute(decision, view) if decision["route"] == "direct" else None


# ─── Direct answer text (speed phase 2) ──────────────────────────────────────
# One or two plain sentences written by code from the tool result; every value in them is copied from
# that result. The card next to it is build_card()'s, unchanged.

MAX_NAMES = 5
_UNAVAILABLE = {
    "notifications_unavailable": "Notifications are not available for this session.",
    "notifications_failed": "Notifications could not be read right now.",
    "fin_not_connected": "There is no authenticated FIN session, so live building data is not available.",
    "no_active_project": "No FIN project is active, so live building data is not available.",
    "no_data_yet": "The backend has not read this data from FIN yet. Please try again shortly.",
    "stale": "The latest reading of this data is too old to be shown as current.",
}


def _names(items: list) -> str:
    # no count of the rest: a number worked out here is in no tool result, and the grounding check would reject the answer
    names = [str(n) for n in items[:MAX_NAMES]]
    return ", ".join(names) + (" and others" if len(items) > len(names) else "")


def _shown(r: dict) -> str:
    """" Showing 20 of 120." when a list is cut; both numbers are the tool result's own."""
    return f" Showing {r.get('returned', 0)} of {r.get('total', 0)}." if r.get("truncated") else ""


def direct_text(out: dict, rule: str = "") -> str:
    """The answer sentence for an execute() result."""
    intent, params, r = out.get("intent"), out.get("parameters") or {}, out.get("result") or {}
    if not r.get("available"):
        return _UNAVAILABLE.get(r.get("reason"), "This data could not be read right now.")
    if intent == "get_alarms" and params.get("history"):
        sev = f" {params['severity']}" if params.get("severity") else ""
        where = f" on {params['equipment']}" if params.get("equipment") else ""
        if not r.get("total"):
            return (f"FIN's latest alarm read holds no{sev} alarm records{where}. "
                    "This is only what that read returned, not a full alarm archive.")
        shown = [f"{a.get('source')} ({a.get('severity')}, {'open' if a.get('open') else 'cleared'}): {a.get('message')}" for a in (r.get("alarms") or [])[:3]]
        return (f"Latest{sev} alarm records{where}, open or cleared, from FIN's latest read: {r.get('total', 0)}. "
                + "; ".join(shown) + f".{_shown(r)} This is not a full alarm archive.")
    if intent == "get_alarms":
        sev = f" {params['severity']}" if params.get("severity") else ""
        where = f" on {params['equipment']}" if params.get("equipment") else ""
        total = r.get("total", 0)
        if not total:
            return f"There are no open{sev} alarms{where}."
        c = r.get("counts") or {}
        text = f"Open{sev} alarms{where}: {total}"
        text += "." if sev else f" ({c.get('critical', 0)} critical, {c.get('warning', 0)} warning, {c.get('info', 0)} info)."
        shown = [f"{a.get('source')} ({a.get('severity')}): {a.get('message')}" for a in (r.get("alarms") or [])[:3]]
        return text + (" " + "; ".join(shown) + "." if shown else "")
    if intent == "find_equipment":
        total, names = r.get("total", 0), [i.get("name") for i in r.get("items") or []]
        if params.get("in_alarm"):
            return f"Equipment currently in alarm ({total}): {_names(names)}.{_shown(r)}" if total else "No equipment is currently in alarm."
        kind = params.get("type")
        if kind and not total:
            return f"No equipment of type {kind} was found in this project's data."
        lead = f"Equipment of type {kind}: {total}." if kind else f"Equipment items: {total}."
        return lead + (f" Including {_names(names)}." if names else "") + _shown(r)
    if intent == "get_equipment_status":
        if not r.get("found"):
            cands = r.get("candidates") or []
            lead = (f"More than one equipment item matches {params.get('equipment')}." if r.get("reason") == "ambiguous"
                    else f"No equipment named {params.get('equipment')} was found.")
            return lead + (f" Close matches: {_names(cands)}." if cands else "")
        eq, pts, health = r.get("equipment") or {}, r.get("points") or {}, r.get("health_facts") or {}
        text = (f"{eq.get('name')}: open alarms {health.get('open_alarms', 0)}; "
                f"points reporting {pts.get('reporting', 0)} of {pts.get('total', 0)}.")
        own = (r.get("alarms") or {}).get("on_equipment_record") or []
        if own:
            text += " " + "; ".join(str(a.get("message")) for a in own[:3]) + "."
        return text
    if intent == "get_notifications":
        total, read, unread = r.get("total", 0), r.get("read", 0), r.get("unread", 0)
        more = " (more are available)" if r.get("more") else ""
        if rule.startswith("notifications.ack"):
            return ("Eko-DT does not record acknowledgements of notifications, so none can be reported as acknowledged or unacknowledged. "
                    f"Of the {total} notifications listed{more}, {read} have been opened and {unread} are unread.")
        if not total:
            return "You have no unread notifications on this project." if params.get("view") == "unread" else "You have no notifications on this project."
        shown = [f"{n.get('severity')} {n.get('type')}" + (f" on {n['asset']}" if n.get("asset") else "")
                 + (f" ({n['created_at']})" if n.get("created_at") else "") for n in (r.get("items") or [])[:3]]
        return f"Notifications listed: {total}{more}, {unread} unread. Latest: " + "; ".join(shown) + "."
    # get_building_snapshot
    if rule == "equipment.online":
        fac = r.get("facility_services") or {}
        if fac.get("systems_online") is None or fac.get("systems_total") is None:
            return "The number of systems online is not available right now."
        return (f"Systems online: {fac['systems_online']} of {fac['systems_total']}, as counted by the backend. "
                "The backend publishes no per-item online flag, so a list of the online items is not available.")
    live = ((r.get("power") or {}).get("live_points")) or {}
    unit = (r.get("power") or {}).get("unit_hint") or ""
    readings = "; ".join(f"{k} {v}{(' ' + unit) if unit else ''}" for k, v in live.items() if v is not None)
    if rule.startswith("snapshot.power"):
        if "power" in (r.get("sections_unavailable") or {}):
            return "Live power data is not available right now."
        return f"Current live readings: {readings}." if readings else "No live power readings are configured for this project."
    parts = []
    counts = (r.get("alarms") or {}).get("counts")
    if counts:
        parts.append(f"open alarms {counts.get('total', 0)}")
    fac = r.get("facility_services") or {}
    if fac.get("systems_online") is not None and fac.get("systems_total") is not None:
        parts.append(f"systems online {fac['systems_online']} of {fac['systems_total']}")
    if readings:
        parts.append(f"live readings {readings}")
    name = (r.get("project") or {}).get("name") or "the building"
    return f"Building overview for {name}: " + ("; ".join(parts) if parts else "no current data sections are available") + "."


# ─── Route counters ──────────────────────────────────────────────────────────
# Process-wide counts for measuring the router: direct / llm_fallback, per intent and per fallback reason.
# Internal only; nothing serves them to the browser.

ROUTE_STATS: dict[str, int] = {}


def record(decision: dict) -> None:
    keys = [decision["route"]]
    keys.append(f"intent:{decision['intent']}" if decision["route"] == "direct" else f"reason:{decision.get('reason')}")
    for k in keys:
        ROUTE_STATS[k] = ROUTE_STATS.get(k, 0) + 1


def route_stats() -> dict:
    return dict(ROUTE_STATS)
