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
# the verbs that ask for a list ("read the equipment list", "view all assets"), and the words that may sit between verb and noun
LISTV = r"(?:show(?: me)?|list|display|get|give me|read|view|see|fetch|print|pull up|bring up)"
FILLER = r"(?:(?:all|the|every|complete|full|entire|whole|available|installed|current|existing) )*"
# words that can stand before "equipment" without being an equipment type: no type filter is made from them
NOT_KIND_WORDS = {"the", "all", "a", "an", "my", "our", "this", "that", "these", "those", "every", "each", "any", "some", "other",
                  "critical", "warning", "info", "faulty", "broken", "offline", "online", "running", "stopped", "active", "open",
                  "alarm", "alarming", "unhealthy", "available", "installed", "current", "existing", "total", "overall",
                  "complete", "full", "entire", "whole", "list", "register", "inventory", "latest", "recent", "new",
                  "energy", "power", "water", "gas", "electricity", "temperature", "humidity", "load", "demand", "consumption", "usage",
                  "carbon", "cost", "emission", "building", "site", "project", "floor", "room", "space", "ppm",
                  "iaq", "comfort", "air", "quality", "weather", "temp", "alert", "alarm", "notification", "reading", "metric", "status"}
HERE = r"(?: (?:in|of|for|from) (?:this|the|our|your)(?: (?:currently selected|selected|current|open|active))? (?:project|building|site))?"
ASK = r"(?:(?:give me|tell me|show me|what is|what's) )?"
PROJ = r"(?: (?:for|in|about))?(?: (?:this|the|my|our))?(?: (?:project|building|site))?"

# (rule id, intent, anchored pattern). <eq> stands for the one explicit equipment id in the question.
RULES: list[tuple[str, str, re.Pattern]] = [(rid, intent, re.compile("^" + pat + "$")) for rid, intent, pat in [
    # current open alarms (optionally one severity)
    ("alarms.latest", "get_alarms",
     SHOW + r"(?:the )?" + LATEST + N + SEV + r"(?P<noun>alarms?|alerts?)" + NOW),
    ("alarms.list", "get_alarms",
     SHOW + r"(?:all )?(?:the )?" + OPEN + SEV + ALARMS + r"(?: (?:that are |which are )?(?:open|active))?" + NOW),
    ("alarms.list.singular", "get_alarms",
     SHOW + r"(?:the )?" + OPEN + SEV + r"(?:alarm|alert)" + NOW),                 # "show alarm": the same question, one alarm word
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
    # current power / load is get_energy period=now (METRIC_RULES): one live point with its unit, not every live point of the snapshot
    # equipment currently in alarm / the equipment list
    ("equipment.in_alarm", "find_equipment",
     r"(?:what|which) equipment (?:is|are) (?:currently )?in alarm" + NOW),
    ("equipment.in_alarm.list", "find_equipment",
     SHOW + r"(?:all )?(?:the )?equipment (?:that is |that are |which is |which are )?(?:currently )?in alarm" + NOW),
    ("equipment.in_alarm.has", "find_equipment",
     r"(?:what|which) " + ASSETS + r" (?:has|have) (?:any )?" + OPEN + ALARMS + NOW),
    ("equipment.in_alarm.count", "find_equipment",
     r"how many (?:equipment|assets?|(?P<kind>[a-z]{2,8}?)s?) (?:are|is) (?:currently )?in alarm" + NOW),
    ("equipment.in_alarm.count.has", "find_equipment",
     r"how many (?:equipment|assets?|(?P<kind>[a-z]{2,8}?)s?) (?:have|has) (?:any )?" + OPEN + ALARMS + NOW),
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
    ("notifications.unread.count", "get_notifications",
     r"(?:" + SHOW + r"(?:the |my )?unread (?:notifications? )?count|how many (?P<noun>notifications?) (?:are|do i have) (?:still )?(?:unread|new))"),
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
    # a class written out in full next to the noun: "list electrical equipment", "show all the HVAC assets", "how many electrical assets".
    # The type is the word the user wrote (never one this code or a model picked); NOT_KIND_WORDS are not types, so those go on
    # to the model instead of becoming a filter that matches nothing.
    ("equipment.kind.list", "find_equipment",
     LISTV + r" " + FILLER + r"(?P<kind>[a-z][a-z-]{1,19}) " + ASSETS + r"(?: list)?" + HERE),
    ("equipment.kind.count", "find_equipment",
     r"how many (?P<kind>[a-z][a-z-]{1,19}) " + ASSETS + r"(?: (?:are |is )?(?:there|available|installed|do we have))*" + HERE),
]]

# Whole-inventory questions: every item of the open project, no filter. Tried even for a question the "complex" test would refuse,
# because "total" there means the count of everything ("total assets"), not a sum or a ranking. Whole-question templates like RULES.
INVENTORY_RULES: list[tuple[str, str, re.Pattern]] = [(rid, intent, re.compile("^" + pat + "$")) for rid, intent, pat in [
    ("equipment.list.read", "find_equipment",
     LISTV + r" " + FILLER + ASSETS + r"(?: (?:list|register|inventory))?" + HERE),
    ("equipment.list.noun", "find_equipment",
     FILLER + ASSETS + r" (?:list|register|inventory)" + HERE),
    ("equipment.list.of", "find_equipment",
     r"(?:" + LISTV + r" )?(?:me )?(?:a |the )?list of " + FILLER + ASSETS + HERE),
    ("equipment.count.total", "find_equipment",
     r"(?:what(?:'s| is) )?(?:the )?(?:total|overall) (?:(?:number|count) of )?" + FILLER + ASSETS + r"(?: count)?" + HERE),
    ("equipment.count.noun", "find_equipment",
     r"(?:what(?:'s| is) )?(?:the )?(?:" + ASSETS + r" count|(?:number|count) of " + FILLER + ASSETS + r")" + HERE),
    ("equipment.count.verb", "find_equipment",
     r"count " + FILLER + ASSETS + HERE),
    ("equipment.count.howmany", "find_equipment",
     r"how many " + ASSETS + r"(?: (?:are |is )?(?:there|do we have|we have))? (?:in total|altogether|overall)" + HERE),
    # the count of one class written as a word: "total number of AHUs", "total FCUs", "AHU count", "count the ahus"
    ("equipment.kind.count.number", "find_equipment",
     ASK + r"(?:the )?(?:total )?(?:number|count) of (?:all )?(?:the )?(?P<kind>[a-z]{2,8}?)s?" + HERE),
    ("equipment.kind.count.total", "find_equipment",
     ASK + r"(?:the )?total (?P<kind>[a-z]{2,8}?)s?" + HERE),
    ("equipment.kind.count.noun", "find_equipment",
     ASK + r"(?:the )?(?P<kind>[a-z]{2,8}?)s? count" + HERE),
    ("equipment.kind.count.verb", "find_equipment",
     r"count (?:all )?(?:the )?(?P<kind>[a-z]{2,8}?)s?" + HERE),
    # what the assistant can do for this project (answered from the project's own mappings, see eko_chat.get_capabilities)
    ("capabilities.overview", "get_capabilities",
     r"(?:what|which) (?:can|could) (?:you|eko) (?:do|answer|help(?: me)? with|tell me|show me|support)" + PROJ),
    ("capabilities.overview.tell", "get_capabilities",
     r"tell me what (?:you|eko) (?:can|could) (?:do|answer|help(?: me)? with)" + PROJ),
    ("capabilities.overview.tell2", "get_capabilities",
     r"tell me what (?:can|could) (?:you|eko) (?:do|answer|help(?: me)? with)" + PROJ),
    ("capabilities.overview.ask", "get_capabilities",
     r"what (?:can|could) i (?:ask|do|see|know)(?: you)?(?: about| for)?" + PROJ),
    ("capabilities.overview.kinds", "get_capabilities",
     r"what (?:questions|things|kinds of questions) (?:can|could) i ask(?: you)?(?: about)?" + PROJ),
    ("capabilities.overview.data", "get_capabilities",
     r"(?:what|which) (?:data|information|capabilities|features) (?:is|are|do you have|do you support|can you (?:show|access|read|see))"
     r"(?: available| mapped| supported)?(?: for| in| about)?" + PROJ),
    ("capabilities.overview.help", "get_capabilities",
     r"(?:help|capabilities|features|what do you support|what do you know|what are your capabilities|what are you able to do|"
     r"what are your features|(?:show|list|give me) (?:me )?(?:the |your )?(?:capabilities|features|supported questions))"),
    ("capabilities.overview.mapped", "get_capabilities",
     r"what is (?:mapped|available)" + PROJ),
    # what is NOT available for this project (not mapped, or not supported): the same tool, narrowed to those
    ("capabilities.unavailable", "get_capabilities",
     r"(?:what|which) (?:information|data|capabilities|features|things|questions|functions?|items|metrics|readings) "
     r"(?:is|are|do(?:es)? not|aren't|isn't) ?(?:not |un|n't )?(?:available|mapped|supported|accessible|configured|answerable|covered)(?: yet)?" + PROJ),
    ("capabilities.unavailable.what", "get_capabilities",
     r"(?:what|which)(?: [a-z]+)? (?:is|are|isn't|aren't) (?:not |un|currently not )(?:available|mapped|supported|accessible|configured|covered)(?: yet)?" + PROJ),
    ("capabilities.unavailable.missing", "get_capabilities",
     r"(?:what|which) (?:information|data|capabilities|features|things|metrics|readings|mappings)? ?(?:is|are) (?:missing|lacking|not set up)" + PROJ),
    ("capabilities.unavailable.what_missing", "get_capabilities",
     r"what(?:'s| is) missing" + PROJ),
    ("capabilities.unavailable.cannot", "get_capabilities",
     r"what (?:can't|cannot|can not|couldn't|could not) (?:you )?(?:access|read|see|do|answer|show|help(?: me)? with|support|know|tell me)" + PROJ),
    ("capabilities.unavailable.dont", "get_capabilities",
     r"what (?:don't you|do you not|do you lack) (?:support|access|know|have|cover)" + PROJ),
    ("capabilities.unavailable.show", "get_capabilities",
     r"(?:show|list|give me|display|tell me)(?: me)? (?:the |all )?(?:unavailable|unmapped|unsupported|missing|not mapped|not supported|not available)"
     r"(?: (?:capabilities|features|data|information|items|questions|metrics|readings|mappings))?" + PROJ),
    ("capabilities.unavailable.any", "get_capabilities",
     r"(?:are there |is there |do we have )?(?:any )?(?:unavailable|unmapped|unsupported|missing) (?:capabilities|features|data|information|mappings)" + PROJ),
    ("capabilities.unavailable.limits", "get_capabilities",
     r"what (?:are )?(?:the )?(?:limits|limitations)" + PROJ),
]]

# what the question names but nothing answers yet: (capability id, pattern on the normalised question). NOT used by route(): a question like this
# still goes to the model when there is one. Only where a question would otherwise end as "unsupported" (no model, or the model did not answer)
# does eko_chat.topic_reply say which capability it is and why it is not available, from get_capabilities(about=id).
UNSUPPORTED_TOPICS: list[tuple[str, re.Pattern]] = [(cid, re.compile(pat)) for cid, pat in [
    ("environment.outdoor_temperature", r"\b(?:outdoors?|outside|ambient|external|exterior)\b.*\b(?:temperature|temp)\b|"
                                         r"\b(?:temperature|temp)\b.*\b(?:outdoors?|outside)\b"),
    ("environment.supply_air_temperature", r"\b(?:supply|discharge)[ -]?air\b.*\btemp(?:erature)?\b|\bsupply[ -]?(?:air )?temp(?:erature)?\b|"
                                            r"\btemp(?:erature)? of (?:the )?supply\b"),
    ("studio.theme", r"\b(?:dark|light|auto) (?:mode|theme)\b|\btheme\b|\bappearance\b"),
    ("studio.navigate", r"^(?:open|go to|goto|navigate to|take me to|switch to|bring up) (?:the )?[a-z ]{2,40}? (?:page|dashboard|module|screen|view|tab)$"),
    ("studio.filter", r"^(?:filter|sort|group)\b|\b(?:apply|set|clear|reset) (?:a |the )?filters?\b"),
    ("control.write", r"^(?:turn|switch|power) (?:on|off)\b|^(?:start|stop|restart|reset|set|change|adjust|raise|lower|increase|decrease|"
                      r"acknowledge|ack|silence|mute|disable|enable|delete|remove|edit|update|write|override)\b"),
    ("energy.compare", r"\b(?:compare|compared|comparison|versus|vs)\b.*\b(?:energy|power|consumption|usage)\b|"
                       r"\b(?:energy|power|consumption|usage)\b.*\b(?:compare|compared|comparison|versus|vs)\b"),
    ("energy.trend", r"\b(?:energy|power|consumption|usage)\b.*\b(?:trend|trends|weekly|monthly|last week|last month|this week|over time|history)\b"),
    # the current readings of points are aggregated; their stored history is not read (FIN's hourly series are mapped for energy only)
    ("analytics.point_history", r"\b(?:temperatures?|temp|humidity|co2|co₂|carbon dioxide)\b.*\b(?:last week|last month|this week|yesterday|trends?|history|historical|over time|"
                                r"last \d+ (?:hours|days|weeks)|past \w+ (?:hours|days|weeks))\b|"
                                r"\b(?:trends?|history|historical)\b.*\b(?:temperatures?|temp|humidity|co2|co₂|carbon dioxide)\b"),
    ("alarms.history_summary", r"\b(?:alarm|alert)s? history\b|\b(?:alarm|alert)s?\b.*\b(?:history|historical|trend|per day|by day|each day|last week|last month|this week)\b"),
    ("utilities.water_gas", r"\b(?:water|gas)\b.*\b(?:consumption|usage|use|meter|reading)\b"),
    ("maintenance.workorders", r"\b(?:work ?orders?|maintenance (?:jobs?|tasks?|requests?|schedule)|cmms)\b"),
    ("documents.om", r"\b(?:warranty|warranties|o&m|o and m|manuals?|documents?)\b"),
    ("meters.power", r"\b(?:power meters?|meter readings?|meters?|pmu|voltage|power factor)\b"),
]]


# A question the words of which fit more than one reading: asked back in one short sentence instead of guessed. (pattern on the normalised
# question, the question to ask). Used where a question would otherwise end as "unsupported", like UNSUPPORTED_TOPICS.
CLARIFICATIONS: list[tuple[re.Pattern, str]] = [(re.compile(pat), ask) for pat, ask in [
    (r"^(?:(?:what is|what's|show|get|check|tell me|read)(?: me)? )?(?:the )?(?:current |present |live )?(?:temperature|temp)(?: reading| level)?" + NOW + "$",
     "Which temperature do you mean? I can read this project's average indoor (zone) temperature: ask \"what is the indoor temperature\". "
     "Outdoor and supply-air temperatures are not read."),
    (r"^compare (?:the )?(?:(?:current|live|latest) )?(?:(?:status|state|readings) )?(?:of )?(?:the )?(?:two|2|both|several|some|all) (?:[a-z]{2,8}?)s?$",
     "Name the two units to compare, exactly as they are written in the equipment list, for example \"compare AHU-01 and AHU-02\"."),
]]


def clarification_for(question: Any) -> Optional[str]:
    """The short question to ask back when the wording fits more than one reading, or None."""
    if not isinstance(question, str) or not question.strip() or len(question) > MAX_MESSAGE_CHARS or UNSAFE.search(question):
        return None
    text = _normalize(question)
    for pattern, ask in CLARIFICATIONS:
        if pattern.match(text):
            return ask
    return None


def unsupported_topic(question: Any, only: Optional[set] = None) -> Optional[str]:
    """The capability id a question asks for that nothing answers (UNSUPPORTED_TOPICS), or None. `only` limits the search to those ids."""
    if not isinstance(question, str) or not question.strip() or len(question) > MAX_MESSAGE_CHARS or UNSAFE.search(question):
        return None
    text = _normalize(question)
    for cid, pattern in UNSUPPORTED_TOPICS:
        if (only is None or cid in only) and pattern.search(text):
            return cid
    return None


# Metric questions (indoor environment, energy over a period, HVAC online state). Whole-question templates like RULES, but tried
# before the "complex question" test: they name a period ("today", "this month") or a ranking ("the most") that test would refuse.
# (rule id, intent, fixed parameters, anchored pattern). <p> is the period, <kind> an equipment class.
LEAD = r"(?:(?:what is|what's|what are|what was|show(?: me)?|get|give me|tell me|check|display|how is) )?(?:the )?"
CUR = r"(?:(?:current|latest|live|present|actual) )?"
EN = r"(?:energy|electricity|electrical energy|power)"
USE = r"(?:consumption|usage|use|consumed|used)"
AFTER = r"(?:for |so far )?(?P<p>today|yesterday|this week|the week so far|week to date|this month|the month so far|month to date|month-to-date)(?: so far)?"
POSS = r"(?P<p>today's|yesterday's|this week's|this month's)"
ONLY = r"(?:energy|electricity|electrical energy)"      # not "power": "the power today" does not ask for a day's energy
LEAD_C = r"(?:(?:what is|what's|what are|show(?: me)?|get|give me|tell me|check|display|compare|how is) )?(?:the )?"
LIVE_ADJ = r"(?:(?:current|live|present|latest|real[- ]time|actual) )+"
LOADS = r"(?:power(?: consumption| usage| demand| draw)?|electrical load|electricity(?: consumption| usage)?|energy(?: consumption| usage)?|load|demand)"
NOW_REQ = r" (?:right now|now|currently|at the moment|at present)"
CLOCK = r"(?P<h{n}>\d{{1,2}})(?::00)? ?(?P<a{n}>[ap]\.?m\.?)?"
RANGE = r"between " + CLOCK.format(n=1) + r" and " + CLOCK.format(n=2) + r"(?: (?:on )?(?P<p>today|yesterday))?"
BD_WORD = {"hourly": "hour", "hour": "hour", "daily": "day", "day": "day", "weekly": "week", "week": "week", "day by day": "day", "day-by-day": "day"}
CONSUMING = r"(?:equipment|system|systems|asset|assets|board|boards|load|loads|unit|units|panel|panels)"
ONLINE = r"(?:running|online|on|operating|working|active)"
PERIOD = {"today": "today", "today's": "today", "yesterday": "yesterday", "yesterday's": "yesterday", "this month": "month",
          "this month's": "month", "the month so far": "month", "month to date": "month", "month-to-date": "month",
          "this week": "week", "this week's": "week", "the week so far": "week", "week to date": "week"}
METRIC_RULES: list[tuple[str, str, dict, re.Pattern]] = [(rid, intent, fixed, re.compile("^" + pat + "$")) for rid, intent, fixed, pat in [
    ("env.iaq", "get_environment", {"metric": "iaq"},
     LEAD + CUR + r"(?:iaq(?: index| level| score| value| reading)?|indoor air quality(?: index| level| score)?|air quality(?: index)?)" + NOW),
    ("env.co2", "get_environment", {"metric": "co2"},
     LEAD + CUR + r"(?:indoor |average |building |room )?(?:co2|co₂|carbon dioxide)(?: level| levels| reading| concentration| value)?" + NOW),
    ("env.temperature", "get_environment", {"metric": "temperature"},
     LEAD + CUR + r"(?:(?:indoor|average|mean|zone|building|room) ){1,2}temperature(?: level| reading| value)?" + NOW),   # a bare "temperature" could be outdoor or supply air
    ("env.humidity", "get_environment", {"metric": "humidity"},
     LEAD + CUR + r"(?:indoor |average |building |room |relative )?humidity(?: level| reading| value)?" + NOW),
    ("env.comfort", "get_environment", {"metric": "comfort"},
     LEAD + CUR + r"comfort(?: index| compliance| level| score)" + NOW),
    # the current power reading (kW): its own live point, never today's total
    ("energy.live", "get_energy", {"period": "now"}, LEAD + LIVE_ADJ + r"(?:building |site |total )?" + LOADS + r"(?: readings?| values?| levels?)?" + NOW),
    ("energy.live.now", "get_energy", {"period": "now"}, LEAD + r"(?:building |site )?" + LOADS + r"(?: readings?| values?| levels?)?" + NOW_REQ),
    ("energy.live.using", "get_energy", {"period": "now"}, r"how much (?:power|electricity|energy) (?:are we|is the building|is the site) (?:using|consuming|drawing)" + NOW),
    # energy over a period (kWh): today and yesterday, this week, this month; by hour, day or week; between two clock hours
    ("energy.breakdown", "get_energy", {},
     LEAD_C + r"(?:(?P<bd1>hourly|daily|weekly|day[- ]by[- ]day) )?" + ONLY + r"(?: " + USE + r")?(?: (?:by|per|for each|each) (?P<bd2>hour|day|week))?"
     r"(?: (?:in|during|over|of))? " + AFTER),
    ("energy.range.howmuch", "get_energy", {},
     r"how much " + ONLY + r" (?:was|were|did we|did the building|have we|has the building|is) (?:consumed|used|consume|use)(?: so far)? " + RANGE),
    ("energy.range", "get_energy", {}, LEAD_C + r"(?:total )?" + ONLY + " " + USE + " " + RANGE),
    ("energy.period", "get_energy", {}, LEAD + r"(?:total )?" + EN + " " + USE + " " + AFTER),
    ("energy.period.short", "get_energy", {}, LEAD + r"(?:total )?" + ONLY + " " + AFTER),
    ("energy.period.poss", "get_energy", {}, LEAD + POSS + r" (?:total )?" + EN + " " + USE),
    ("energy.period.poss.short", "get_energy", {}, LEAD + POSS + r" (?:total )?" + ONLY),
    ("energy.period.howmuch", "get_energy", {},
     r"how much " + EN + r" (?:have we|did we|are we|has the building|did the building|has the site|have we all|has been|was|is) "
     r"(?:used|use|consumed|consume|using|consuming)(?: so far)? " + AFTER),
    ("energy.top", "get_energy", {"by": "board", "period": "today"},
     r"(?:which|what)(?: " + CONSUMING + r")? (?:is|are) (?:consuming|using) the most (?:energy|power|electricity)(?: today)?"),
    ("energy.top.uses", "get_energy", {"by": "board", "period": "today"},
     r"(?:which|what)(?: " + CONSUMING + r")? (?:uses|consumes|has) the most (?:energy|power|electricity)(?: today)?"),
    ("energy.top.consumer", "get_energy", {"by": "board", "period": "today"},
     r"(?:what is|what's) the (?:biggest|largest|highest|top|main) (?:energy |power |electricity )?(?:consumer|user)(?: today)?"),
    ("hvac.count", "get_hvac_status", {},
     r"how many (?:hvac )?(?:systems|units|equipment) (?:are|is) (?:currently )?" + ONLINE + NOW),
    ("hvac.count.kind", "get_hvac_status", {},
     r"how many (?P<kind>[a-z]{2,8}?)s? (?:are|is) (?:currently )?" + ONLINE + NOW),
    ("hvac.which", "get_hvac_status", {},
     r"(?:which|what) (?:(?P<kind>[a-z]{2,8}?)s?|hvac (?:systems|units)) (?:are|is) (?:currently )?" + ONLINE + NOW),
    ("hvac.status", "get_hvac_status", {},
     LEAD + CUR + r"(?:status|state|condition|health) of the (?:hvac|air conditioning|mechanical)(?: system| systems)?" + NOW),
    ("hvac.status.short", "get_hvac_status", {}, r"(?:current )?hvac (?:status|state|summary|overview)" + NOW),
]]
NOT_HVAC_KIND = NOT_A_TYPE | {"hvac", "system", "unit"}


def _clock(hour: str, ap: Optional[str]) -> int:
    """A clock hour as 0-23 ("2 pm" is 14, "12 am" is 0); without am/pm the number is the 24-hour clock."""
    n = int(hour)
    return n % 12 + (12 if ap[0] == "p" else 0) if ap else n


def _metric(text: str) -> Optional[dict]:
    """The decision for a metric question, or None."""
    for rid, intent, fixed, pattern in METRIC_RULES:
        m = pattern.match(text)
        if not m:
            continue
        gd = m.groupdict()
        params = dict(fixed)
        if gd.get("p"):
            params["period"] = PERIOD[gd["p"]]
        if rid == "energy.breakdown":
            bd = BD_WORD.get(gd.get("bd1") or gd.get("bd2") or "")
            if not bd:
                continue                     # no hour/day/week named: the plain period rules answer it
            params["breakdown"] = bd
        if rid.startswith("energy.range"):
            if (gd["a1"] is None) != (gd["a2"] is None):
                return _fallback("unsupported_or_ambiguous")       # "between 10 and 2 pm": which 10, which 2?
            lo, hi = _clock(gd["h1"], gd["a1"]), _clock(gd["h2"], gd["a2"]) or 24
            if not 0 <= lo < hi <= 24:
                return _fallback("invalid_parameters")
            params.update(period=params.get("period", "today"), from_hour=lo, to_hour=hi)
        kind = (gd.get("kind") or "").lower()
        if kind in NOT_HVAC_KIND:
            kind = ""
        if kind:
            params["type"] = kind
        if _validate(params, TOOLS[intent]["parameters"]):
            return _fallback("invalid_parameters")
        return {"route": "direct", "intent": intent, "parameters": params, "confidence": "high", "rule": rid}
    return None


# ─── Phase 2: comparison, point search, analytics and alarm records ──────────
# Whole-question templates like the rules above. Tried after them, so a question the existing rules answer ("average humidity") keeps its answer.
# Nothing here reads FIN: it only chooses one of the Phase 2 tools and its parameters, which are checked against that tool's own schema.
METRIC_WORD = {"temperature": "temperature", "temperatures": "temperature", "temp": "temperature", "humidity": "humidity", "co2": "co2", "co₂": "co2",
               "carbon dioxide": "co2", "power": "power"}
MET = r"(?P<m>temperatures?|temp|humidity|co2|co₂|carbon dioxide|power)"
READ = r"(?: (?:readings?|levels?|values?))?"
ANY_UNIT = r"(?:equipment|assets?|units?|systems?)"
KIND = r"(?P<kind>[a-z]{2,8}?)s"
ORD = {"highest": "highest", "maximum": "highest", "max": "highest", "lowest": "lowest", "minimum": "lowest", "min": "lowest"}
OPS = {"highest": "max", "maximum": "max", "max": "max", "lowest": "min", "minimum": "min", "min": "min", "average": "average", "mean": "average",
       "avg": "average", "total": "sum", "sum": "sum"}
TOP_N = {"two": 2, "three": 3, "four": 4, "five": 5, "ten": 10}
CMP = r"(?:compare|comparison of|contrast)(?: the)?(?: (?:current|live|latest))?(?: (?:status|state|readings|points|values))?(?: of)?"
COMPARE_RULES: list[tuple[str, re.Pattern]] = [(rid, re.compile("^" + pat + "$")) for rid, pat in [
    ("compare.equipment", CMP + r" <eq1> (?:and|with|to|vs\.?|versus|against) <eq2>(?: (?:status|state|readings|points|values))?" + NOW),
    ("compare.vs", r"<eq1> (?:vs\.?|versus|compared (?:to|with|against)) <eq2>" + NOW),
    ("compare.difference", r"(?:what(?:'s| is) )?(?:the )?(?:difference|differences) between <eq1> and <eq2>" + NOW),
    ("compare.how", r"how (?:does|do|is) <eq1> compare(?:d)? (?:to|with|against) <eq2>" + NOW),
    ("compare.show", r"(?:show|give me|get)(?: me)? (?:a )?comparison (?:of|between) <eq1> and <eq2>" + NOW),
]]
HISTORY_PERIOD = {"today": "today", "yesterday": "yesterday", "this month": "this_month", "the last 7 days": "last_7_days", "the last seven days": "last_7_days",
                  "the latest 7 days": "last_7_days", "the past 7 days": "last_7_days", "the past seven days": "last_7_days", "the last week": "last_7_days",
                  "the last 30 days": "last_30_days", "the last thirty days": "last_30_days", "the latest 30 days": "last_30_days", "the past 30 days": "last_30_days",
                  "the past thirty days": "last_30_days"}
_PERIODS = "|".join(re.escape(k) for k in sorted(HISTORY_PERIOD, key=len, reverse=True))
RAISED = r"(?:raised|triggered|recorded|logged|generated|reported|occurred)"
HISTORY_RULES: list[tuple[str, re.Pattern]] = [(rid, re.compile("^" + pat + "$")) for rid, pat in [
    ("alarmhist.summary", SHOW + r"(?:the )?alarm (?:history|summary|statistics|stats|breakdown)(?: by severity)?(?: (?:for|in|during|over|from) (?P<p>" + _PERIODS + "))?" + NOW),
    ("alarmhist.count", r"how many alarms (?:were |have been |had been )?" + RAISED + r"(?: (?:in|during|over|on))?(?: (?P<p>" + _PERIODS + "))?" + NOW),
    ("alarmhist.raised", SHOW + r"(?:the )?alarms " + RAISED + r" (?P<p>" + _PERIODS + ")"),
]]
ANALYTIC_RULES: list[tuple[str, str, re.Pattern]] = [(rid, intent, re.compile("^" + pat + "$")) for rid, intent, pat in [
    # which unit has the highest / lowest reading
    ("analytics.which", "calculate_metric",
     r"(?:which|what) (?:(?P<kind>[a-z]{2,8}?)s?|" + ANY_UNIT + r") (?P<verb>has|have|is|are|shows?|reads?|records?) the (?P<ord>highest|lowest|maximum|minimum|max|min) " + MET + READ + NOW),
    # the top N by a metric
    ("analytics.top", "calculate_metric",
     r"(?:show |list |give me |get |what are )?(?:me )?(?:the )?top (?P<n>\d{1,2}|two|three|four|five|ten) " + KIND + r" (?:by|for|with the highest) " + MET + READ + NOW),
    ("analytics.rank", "calculate_metric", r"rank (?:the )?(?:all )?" + KIND + r" by " + MET + READ + NOW),
    # an operation over a metric, building-wide or over one class
    ("analytics.agg", "calculate_metric",
     LEAD + r"(?P<op>highest|lowest|maximum|minimum|max|min|average|mean|avg|total|sum) " + MET + READ
     + r"(?: (?:of|across|in|for|on|among) (?:all )?(?:the )?(?:" + KIND + r"|" + ANY_UNIT + r"))?" + NOW),
    # which equipment has points for a metric
    ("points.search", "search_points",
     r"(?:find|list|show|which|what|get)(?: me)?(?: all)?(?: the)? (?:" + KIND + r"|" + ANY_UNIT + r")(?: that| which)? (?:has|have|with|having|reporting|report) "
     r"(?:any )?" + MET + r" (?:readings?|measurements?|points?|sensors?|values?)" + NOW),
    ("points.search.count", "search_points",
     r"how many (?:" + KIND + r"|" + ANY_UNIT + r"(?: items)?) (?:has|have|with|report|reporting) (?:any )?" + MET + r" (?:readings?|measurements?|points?|sensors?|values?)" + NOW),
]]


def _kind_of(gd: dict) -> str:
    kind = (gd.get("kind") or "").lower()
    return "" if {kind, kind + "s"} & (NOT_A_TYPE | NOT_KIND_WORDS) else kind


def _analytic(text: str) -> Optional[dict]:
    """The decision for a Phase 2 point-analytics or point-search question, or None."""
    for rid, intent, pattern in ANALYTIC_RULES:
        m = pattern.match(text)
        if not m:
            continue
        gd = m.groupdict()
        params: dict = {"metric": METRIC_WORD[gd["m"]]}
        if rid == "analytics.agg":
            params["op"] = OPS[gd["op"]]
        elif intent == "calculate_metric":
            params["op"] = "top"
            params["order"] = ORD[gd["ord"]] if gd.get("ord") else "highest"
            if rid == "analytics.which" and gd["verb"] in ("has", "is", "shows", "show", "reads", "read", "records", "record"):
                params["limit"] = 1
            elif gd.get("n"):
                params["limit"] = TOP_N.get(gd["n"]) or int(gd["n"])
        kind = _kind_of(gd)
        if kind:
            params["type"] = kind
        if params.get("op") == "sum" and not kind:
            continue          # a building-wide sum would add meters that meter other meters: asked for one class only
        if _validate(params, TOOLS[intent]["parameters"]):
            return _fallback("invalid_parameters")
        return {"route": "direct", "intent": intent, "parameters": params, "confidence": "high", "rule": rid}
    return None


def _history(text: str) -> Optional[dict]:
    """The decision for a question about the alarm records of FIN's latest read (not the open alarms), or None."""
    for rid, pattern in HISTORY_RULES:
        m = pattern.match(text)
        if not m:
            continue
        params = {"period": HISTORY_PERIOD[m.group("p")]} if m.group("p") else {}
        if _validate(params, TOOLS["get_alarm_history"]["parameters"]):
            return _fallback("invalid_parameters")
        return {"route": "direct", "intent": "get_alarm_history", "parameters": params, "confidence": "high", "rule": rid}
    return None


def _compare(question: str, ids: list) -> Optional[dict]:
    """The decision for a comparison of the two named equipment items in the question, or None."""
    order = {name: f"<eq{i}>" for i, name in enumerate(ids, 1)}
    text = _normalize(EQUIPMENT_ID.sub(lambda m: order.get(m.group(1), m.group(1)), question))
    for rid, pattern in COMPARE_RULES:
        if pattern.match(text):
            params = {"equipment_a": ids[0], "equipment_b": ids[1]}
            if _validate(params, TOOLS["compare_equipment"]["parameters"]):
                return _fallback("invalid_parameters")
            return {"route": "direct", "intent": "compare_equipment", "parameters": params, "confidence": "high", "rule": rid}
    return None


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
    if len(ids) == 2:        # two named items: a comparison is the one question that takes two
        return _compare(question, ids) or _fallback("multiple_equipment")
    if len(ids) > 2:
        return _fallback("multiple_equipment")
    equipment = ids[0] if ids else None
    text = question if equipment is None else question.replace(equipment, "<eq>")
    text = _normalize(text)
    complex_q = bool(text.count("?") or text.count(",") or COMPLEX.search(text))
    for rid, intent, pattern in ([] if complex_q else RULES) + INVENTORY_RULES:
        m = pattern.match(text)
        if not m:
            continue
        gd = m.groupdict()
        kind = (gd.get("kind") or "").lower()
        both = {kind, kind + "s"}     # the pattern takes a trailing "s" as a plural: "gas" is read as "ga" + s, "status" as "statu" + s
        if both & NOT_A_TYPE or (rid.startswith(("equipment.kind.", "equipment.type.")) and both & NOT_KIND_WORDS):
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
        if rid.startswith("capabilities.unavailable"):
            params["show"] = "unavailable"
        if rid in ("notifications.unread", "notifications.unread.count"):
            params["view"] = "unread"
        if _validate(params, TOOLS[intent]["parameters"]):
            return _fallback("invalid_parameters")
        return {"route": "direct", "intent": intent, "parameters": params, "confidence": "high", "rule": rid}
    metric = _metric(text)
    if metric:
        return metric
    for found in (_history(text), _analytic(text)):
        if found:
            return found
    return _fallback("complex_question" if complex_q else "unsupported_or_ambiguous")


# ─── Several questions in one message ────────────────────────────────────────
# split_parts / plan_parts turn "How many assets are there and how many AHUs are in alarm?" into its questions, each one routed by the SAME route() as a
# single question. Nothing here runs a tool or reads FIN: it is text only. A message is split only when every piece is either routed by a rule or is
# plainly a question or request of its own that no rule knows (so the caller can say so); anything else is not a compound message and is left whole.
MAX_PARTS = 4
# a sentence ends at . ? ! followed by a space (not 3.5, not "e.g."), or at a line break
_SENTENCE_END = re.compile(r"(?<=[?!.\u061f])(?<!e\.g\.)(?<!i\.e\.)(?<!etc\.)(?<!vs\.)\s+(?=\S)|\s*\n+\s*")
# inside a sentence: a comma (not in 1,000), and / then / also / plus / as well as / & / + between whole words
_CONNECTOR = re.compile(r"\s*(?<!\d)[,\u060c](?!\d)\s*(?:(?:and|then|also|plus)\s+)?|\s+(?:and\s+then|and\s+also|as\s+well\s+as|and|then|also|plus)\s+|\s*[&+]\s*", re.I)
_LEADING = re.compile(r"^(?:(?:and\s+then|and\s+also|as\s+well\s+as|after\s+that|and|then|also|plus|next|finally)\b[\s,]*)+", re.I)
_ARABIC = re.compile(r"[\u0600-\u06ff]")
_NUMBERING = re.compile(r"^\s*\d{1,2}[.)]\s+")
# the verb a list shares: "Show notifications, humidity and CO2" is show notifications, show humidity, show CO2
_LEAD = re.compile(r"^(show me|show|list|display|get me|get|give me|read|view|see|tell me|what is|what's|what are|check)\b", re.I)
# a piece no rule knows is kept (and reported) only when it is a question or a request of its own
_SELF_STANDING = re.compile(r"^(?:what|which|who|where|when|why|how|is|are|do|does|did|can|could|will|would|should|have|has|show|list|display|get|give|read|view|see|"
                            r"tell|check|find|compare|explain|open|go|change|switch|turn|set|start|stop|count|acknowledge|ack|silence|mute|enable|disable|delete|"
                            r"remove|edit|update|reset)\b", re.I)
# values that only narrow another phrase ("critical and warning alarms", "unread, today"): a split that leaves one of these on its own is not a split
_MODIFIERS = {"critical", "warning", "warnings", "info", "high", "medium", "low", "open", "closed", "active", "all", "unread", "read", "new", "latest", "recent",
              "today", "yesterday", "current", "currently", "live", "only", "both", "each", "every", "any", "the", "a", "an", "of", "in", "on", "for", "to", "please",
              "now", "right", "total", "overall", "average", "by", "floor", "type", "severity", "state", "status"}


def _clean_piece(text: str) -> str:
    t = _NUMBERING.sub("", text.strip())
    t = _LEADING.sub("", t)
    return re.sub(r"\s+", " ", t.strip(" \t,;:.!?\u060c\u061f")).strip()


def _routes(text: str) -> Optional[dict]:
    """The direct decision route() gives this text, or None."""
    d = route(text)
    return d if d["route"] == "direct" else None


# "compare X and Y", "difference between X and Y": the "and" between the two names belongs to the question, so it is held back from the splitter
_ID = r"[A-Za-z]{1,8}[0-9]*(?:[-_][A-Za-z0-9]+)+"
_COMPARE_PAIR = re.compile(r"\b(?:compare|comparison|difference|differences|between|contrast)\b[^,;]*?(?<![\w-])" + _ID + r"\s+and\s+" + _ID + r"(?![\w-])", re.I)
_HOLD = "\x00"
# "list their alarms" / "show its alarms": the equipment the part just before it named (compare X and Y -> their; status of X -> its)
_ANAPHORIC_ALARMS = re.compile(r"^(?:show|list|display|get|give me|what are)(?: me)? (?P<who>their|its|both) (?:(?:open|current|active) )?(?:alarms|alerts)$")
# a metric written on its own after an operation ("the highest temperature and humidity"): the operation is shared
_BARE_METRIC = re.compile(r"^(?:the )?(?:temperatures?|temp|humidity|co2|co₂|carbon dioxide|power)$")
_METRIC_WORD = re.compile(r"temperatures?|temp|humidity|co2|co₂|carbon dioxide|power", re.I)


def _protect(text: str) -> str:
    return _COMPARE_PAIR.sub(lambda m: re.sub(r"\s+and\s+", _HOLD, m.group(0)), text)


def _restore(text: str) -> str:
    return text.replace(_HOLD, " and ")


def _alarms_of_previous(text: str, previous: Optional[dict]) -> tuple[Optional[dict], Optional[str]]:
    """(decision, interpreted_as) for "list their alarms" / "list its alarms" after a part that named the equipment, else (None, None).
    Their is the two items of a comparison; its is the one item of a status or alarm question. Nothing is guessed: no such part before it, no answer."""
    m = _ANAPHORIC_ALARMS.match(_normalize(text))
    d = previous.get("decision") if isinstance(previous, dict) else None
    if not m or not d:
        return None, None
    params = d.get("parameters") or {}
    if d.get("intent") == "compare_equipment" and m.group("who") in ("their", "both"):
        new = {"equipment_a": params["equipment_a"], "equipment_b": params["equipment_b"], "focus": "alarms"}
        rule, intent, said = "compare.alarms", "compare_equipment", f"list alarms on {params['equipment_a']} and {params['equipment_b']}"
    elif m.group("who") == "its" and d.get("intent") in ("get_equipment_status", "get_alarms") and params.get("equipment"):
        new = {"equipment": params["equipment"]}
        rule, intent, said = "alarms.equipment.ref", "get_alarms", f"list alarms on {params['equipment']}"
    else:
        return None, None
    if _validate(new, TOOLS[intent]["parameters"]):
        return None, None
    return {"route": "direct", "intent": intent, "parameters": new, "confidence": "high", "rule": rule}, said


def split_parts(message: Any) -> list[str]:
    """The pieces of a message: its sentences, and inside each sentence the parts a comma or and / then / also / plus / & separates. The
    pieces are unchecked text; plan_parts decides whether the split is real."""
    if not isinstance(message, str):
        return []
    out = []
    for sentence in _SENTENCE_END.split(message.strip()):
        out += [c for c in (_clean_piece(_restore(x)) for x in _CONNECTOR.split(_protect(sentence or ""))) if c and not re.fullmatch(r"\d{1,2}", c)]
    return out


def plan_parts(message: Any) -> Optional[dict]:
    """The questions of a compound message, each with its own routing decision, or None when the message is not compound.

      {"parts": [{"text": <the user's words>, "decision": <route() decision> | None, "interpreted_as": <text routed, when a shared verb was added> | None}],
       "overflow": [<the questions beyond MAX_PARTS>]}

    A decision of None is a question or request of its own that no rule knows: the caller reports it, it is never dropped. A single question, and a
    message whose pieces do not each stand as a question or a rule match (a modifier like "warnings" left alone), is not compound: None."""
    if not isinstance(message, str) or not message.strip() or len(message) > MAX_MESSAGE_CHARS or UNSAFE.search(message):
        return None
    pieces: list[dict] = []

    def push(text: str, decision: Optional[dict], said: Optional[str] = None) -> None:
        if decision is None:                           # "list their alarms" means the equipment of the part before it, and only that
            decision, said = _alarms_of_previous(text, pieces[-1] if pieces else None)
        pieces.append({"text": text, "decision": decision, "interpreted_as": said if decision else None})

    for sentence in _SENTENCE_END.split(message.strip()):
        whole = _clean_piece(sentence or "")
        if not whole or re.fullmatch(r"\d{1,2}", whole):
            continue
        decision = _routes(whole)
        if decision:                                   # a sentence a rule answers as it is stays whole ("and" and commas inside it included)
            push(whole, decision)
            continue
        subs = [c for c in (_clean_piece(_restore(x)) for x in _CONNECTOR.split(_protect(whole))) if c]
        lead = _LEAD.match(subs[0]) if subs else None
        op_text = None                                 # the last part that was an operation over a metric ("the highest temperature")
        for i, sub in enumerate(subs):
            if op_text and _BARE_METRIC.match(sub.lower()):
                shared = _METRIC_WORD.sub(re.sub(r"^the ", "", sub, flags=re.I), op_text, count=1)
                d = _routes(shared)
                if d and d["intent"] == "calculate_metric":
                    push(sub, d, shared)
                    continue
            d = _routes(sub)
            if d:
                op_text = sub if d.get("rule") == "analytics.agg" else None
                push(sub, d)
                continue
            op_text = None
            shared = f"{lead.group(1)} {sub}" if lead and i > 0 else None
            d = _routes(shared) if shared else None
            push(sub, d, shared)
    if len(pieces) < 2 or not any(p["decision"] for p in pieces):
        return None
    for p in pieces:
        words = re.findall(r"[a-z]+", p["text"].lower())
        if p["decision"] is None:
            known = unsupported_topic(p["text"]) or clarification_for(p["text"])
            own = _SELF_STANDING.match(p["text"]) or _ARABIC.search(p["text"])
            if not known and (len(p["text"].split()) < 3 or not own):
                return None                            # a fragment, not a question of its own: this was not a list of questions
        elif p["interpreted_as"] and words and set(words) <= _MODIFIERS:
            return None
    return {"parts": pieces[:MAX_PARTS], "overflow": [p["text"] for p in pieces[MAX_PARTS:]]}


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
    "tool_error": "This data could not be read right now.",       # never the exception's name or text
}


def _names(items: list, limit: int = MAX_NAMES) -> str:
    # no count of the rest: a number worked out here is in no tool result, and the grounding check would reject the answer
    names = [str(n) for n in items[:limit]]
    return ", ".join(names) + (" and others" if len(items) > len(names) else "")


def _g(value: float) -> str:
    """A reading as FIN gave it, rounded to one decimal, without an exponent or trailing zeros."""
    return f"{value:.1f}".rstrip("0").rstrip(".")


def _shown(r: dict) -> str:
    """" Showing 20 of 120." when a list is cut; both numbers are the tool result's own."""
    return f" Showing {r.get('returned', 0)} of {r.get('total', 0)}." if r.get("truncated") else ""


_DATA_KIND = {"live": "a current FIN read", "historical": "FIN's hourly history", "stored": "Eko-DT's own notification store"}
_READ_STATE = {"stale": "is stale (older than the allowed age)", "not_read": "has not been read from FIN yet"}


def _partial_text(rows: list) -> str:
    """" Partly available: A, B (the limit); C (its limit)." The same limit is said once, with every capability it applies to."""
    from eko_chat_capabilities import PARTIAL
    by_limit: dict = {}
    for x in rows:
        if x.get("status") == PARTIAL:
            for m in x.get("limitations") or [""]:
                by_limit.setdefault(m, []).append(x["label"])
    if not by_limit:
        return ""
    return " Partly available: " + "; ".join(f"{', '.join(labels)} ({m})" if m else ", ".join(labels) for m, labels in by_limit.items()) + "."


def _capabilities_text(r: dict) -> str:
    """What the assistant can do for this project, in words, copied from the get_capabilities result."""
    from eko_chat_capabilities import AVAILABLE, NOT_SUPPORTED, PARTIAL, UNMAPPED, where
    project = (r.get("project") or {}).get("name") or "this project"
    a = r.get("about")
    if a:
        label, status = a.get("label"), a.get("status")
        if status == NOT_SUPPORTED:
            if a.get("reason") == "read_only":
                return f"{a.get('note') or label + ' is not something Eko-Chat does.'}"
            return f"{label} is not supported yet." + (f" {a['note']}" if a.get("note") else "") + " Ask \"what can you do\" for what is available."
        if status == UNMAPPED:
            need = "; ".join(where(m) for m in a.get("missing") or [])
            return f"{label} is not available for {project}: nothing is mapped for it. Map {need}."
        if status == PARTIAL:
            return (f"{label} is partly available for {project}, from {_DATA_KIND.get(a.get('data'), 'the project data')}."
                    + "".join(" " + m for m in a.get("limitations") or []) + (f" {a['note']}" if a.get("note") else "")
                    + (f" For example: \"{a['examples'][0]}\"." if a.get("examples") else ""))
        text = f"{label} is available for {project}, from {_DATA_KIND.get(a.get('data'), 'the project data')}."
        if a.get("examples"):
            text += f" For example: \"{a['examples'][0]}\"."
        if a.get("read") in _READ_STATE:
            text += f" Its data {_READ_STATE[a['read']]}."
        return text + "".join(" " + m for m in a.get("limitations") or []) + (f" {a['note']}" if a.get("note") else "")
    rows = r.get("capabilities") or []
    counts = r.get("counts") or {}
    if r.get("show") == "unavailable":
        return _unavailable_text(r, project, rows, counts)
    by_area = [f"{x['label']} ({x.get('available', 0)})" for x in r.get("areas") or [] if x.get("available")]
    text = (f"For {project} I can answer {counts.get(AVAILABLE, 0)} kinds of question, read-only from its FIN data: " + ", ".join(by_area) + ".")
    text += _partial_text(rows)
    unmapped = [x for x in rows if x.get("status") == UNMAPPED]
    if unmapped:
        text += " Not available because nothing is mapped for this project: " + "; ".join(
            f"{x['label']} (needs {', '.join(m['key'] or m['mapping'] for m in x['missing'])})" for x in unmapped) + "."
    todo = [x["label"] for x in rows if x.get("status") == NOT_SUPPORTED and x.get("reason") == "planned"]
    if todo:
        text += " Not supported yet: " + ", ".join(todo) + "."
    limits = sorted({m for x in rows if x.get("status") == AVAILABLE for m in x.get("limitations") or []})
    if limits:
        text += " Limits: " + " ".join(limits)
    odd = [f"{k} {_READ_STATE[v['state']]}" for k, v in (r.get("reads") or {}).items() if v.get("state") in _READ_STATE]
    if odd:
        text += " Data state: " + "; ".join(odd) + "."
    return text


def _unavailable_text(r: dict, project: str, rows: list, counts: dict) -> str:
    """What this project cannot answer, from the get_capabilities(show=unavailable) result: not mapped (and what to map), not supported yet, never."""
    from eko_chat_capabilities import UNMAPPED, where
    unmapped = [x for x in rows if x.get("status") == UNMAPPED]
    planned = [x for x in rows if x.get("status") != UNMAPPED and x.get("reason") == "planned"]
    never = [x for x in rows if x.get("status") != UNMAPPED and x.get("reason") == "read_only"]
    partial = _partial_text(rows)
    if unmapped:
        text = (f"In {project}, {counts.get('unmapped', 0)} things the assistant can answer are not available because nothing is mapped for them: "
                + "; ".join(f"{x['label']} (map {'; '.join(where(m) for m in x.get('missing') or [])})" for x in unmapped) + ".")
    else:
        text = f"In {project}, nothing the assistant can answer is missing a mapping."
    text += partial
    if planned:
        text += " Not supported yet: " + ", ".join(x["label"] for x in planned) + "."
    if never:
        text += " Never done by Eko-Chat (it is read-only): " + ", ".join(x["label"] for x in never) + "."
    if r.get("limitations"):
        text += " Limits on what is available: " + " ".join(r["limitations"])
    odd = [f"{k} {_READ_STATE[v['state']]}" for k, v in (r.get("reads") or {}).items() if v.get("state") in _READ_STATE]
    if odd:
        text += " Data state: " + "; ".join(odd) + "."
    return text


def _n(count: int, one: str, many: Optional[str] = None) -> str:
    return f"{count} {one if count == 1 else (many or one + 's')}"


def _reasons(counts: dict) -> str:
    return ", ".join(f"{n} {k.replace('_', ' ')}" for k, n in counts.items())


_OPS_LEAD = {"average": "Average", "min": "Lowest", "max": "Highest", "sum": "Total"}
# no digits in these: the grounding check accepts only numbers the tool result holds
_PERIOD_TEXT = {"today": " for today", "yesterday": " for yesterday", "last_7_days": " for the last seven days", "last_30_days": " for the last thirty days",
                "this_month": " for this month"}


def _metric_text(r: dict) -> str:
    label, kind = r.get("label"), (r.get("scope") or {}).get("type")
    scope = f" for {kind}" if kind else ""
    basis = f"from {_n(r['samples'], 'reading')} on {_n(r['equipment_count'], 'equipment item')} (latest FIN read {r.get('as_of')})"
    if r.get("op") == "top":
        ranked = "; ".join(f"{i['rank']}. {i['equipment']} {_g(i['value'])}{(' ' + i['unit']) if i.get('unit') else ''} ({i['point']})" for i in r.get("items") or [])
        text = f"{'Highest' if r.get('order') == 'highest' else 'Lowest'} {label}{scope} by equipment, each by its own reading: {ranked}, {basis}."
    elif r.get("op") == "count":
        text = f"Usable {label} readings{scope}: {r['value']}, {basis}."
    else:
        at = f" at {r['at']['equipment']} ({r['at']['point']})" if r.get("at") else ""
        text = f"{_OPS_LEAD[r['op']]} {label}{scope}: {_g(r['value'])}{(' ' + r['unit']) if r.get('unit') else ''}{at}, {basis}."
    text += " Readings are a point in time; no history is available."
    if r.get("op") == "top" and r.get("truncated"):
        text += f" Showing {len(r['items'])} of {r['ranked_equipment']} equipment items."
    if r.get("note"):
        text += " " + r["note"]
    other = r.get("other_units") or {}
    left = {k: v for k, v in (r.get("excluded") or {}).items() if not (k == "unit_mismatch" and other)}
    if left:
        text += f" Left out: {_reasons(left)}."
    if other:
        text += " In another unit, not combined: " + ", ".join(f"{n} in {u}" for u, n in other.items()) + "."
    if r.get("stale_points"):
        text += f" Stale: {', '.join(r['stale_points'])}."
    if r.get("assumed_unit"):
        text += f" {r['assumed_unit']} points carry no unit; {r.get('unit') or 'the metric unit'} is taken from the metric."
    return text


def _compare_text(r: dict, params: dict) -> str:
    if not r.get("found"):
        if r.get("reason") == "same_equipment":
            return f"{params.get('equipment_a')} and {params.get('equipment_b')} are the same equipment item, so there is nothing to compare."
        said = []
        for u in r.get("unfound") or []:
            said.append((f"More than one equipment item matches {u['equipment']}." if u.get("reason") == "ambiguous" else f"No equipment named {u['equipment']} was found.")
                        + (f" Close matches: {_names(u['candidates'])}." if u.get("candidates") else ""))
        return " ".join(said) + " Nothing was compared."
    a, b = (e.get("name") for e in r["equipment"])
    al = r.get("alarms") or {}
    if r.get("focus") == "alarms":
        def side(name: str, s: dict) -> str:
            msgs = "; ".join(str(x.get("message")) for x in (s.get("items") or [])[:3])
            return f"{name}: {_n(s['open'], 'open alarm')}" + (f" ({msgs})" if msgs else "")
        return side(a, al["a"]) + "; " + side(b, al["b"]) + "."
    c = r.get("comparison") or {}
    text = f"{a} compared with {b}: {_n(c.get('compared', 0), 'common numeric point')}."
    rank = sorted(c.get("items") or [], key=lambda i: -abs(i["percent_difference"] if i.get("percent_difference") is not None else i["difference"]))[:3]
    shown = []
    for i in rank:
        unit = f" {i['unit']}" if i.get("unit") else ""
        gap = f", {_g(i['percent_difference'])}%" if i.get("percent_difference") is not None else "; no percentage, the second value is zero"
        shown.append(f"{i['point']} {_g(i['a'])} vs {_g(i['b'])}{unit} (difference {_g(i['difference'])}{gap})")
    if shown:
        text += " Largest differences first, first item minus second: " + "; ".join(shown) + "."
    if c.get("truncated"):
        text += f" Showing {c['returned']} of {c['compared']}."
    if c.get("not_comparable_total"):
        text += (f" {_n(c['not_comparable_total'], 'common point')} could not be compared ("
                 + ", ".join(sorted({x['reason'].replace('_', ' ') for x in c.get('not_comparable') or []})) + ").")
    for key, name in (("only_in_a", a), ("only_in_b", b)):
        if c.get(key):
            text += f" Only on {name}: {_names(c[key])}."
    return text + f" Open alarms: {a} {al['a']['open']}, {b} {al['b']['open']}."


def _history_text(r: dict) -> str:
    cov = r.get("coverage")
    if cov is None:
        return r["coverage_note"]
    text = (f"Alarm records in FIN's latest read{_PERIOD_TEXT.get(r.get('period'), '')}: {r['total']} ({r['open']} open, {r['cleared']} cleared).")
    if r.get("by_severity"):
        s = r["by_severity"]
        text += f" By severity: {s['critical']} critical, {s['warning']} warning, {s['info']} info."
    elif r.get("severity_note"):
        text += " " + r["severity_note"]
    if cov.get("from"):
        text += f" The read covers {cov['from']} to {cov['to']}."
    if r.get("coverage_note"):
        text += " " + r["coverage_note"]
    if cov.get("may_be_truncated"):
        text += f" The read holds {cov['records_in_read']} records, the most that are kept, so older ones may be missing."
    if cov.get("undated"):
        text += f" {_n(cov['undated'], 'record')} carry no date."
    return text + " This is not an archive."


def _phase2_text(intent: str, r: dict, params: dict) -> str:
    """The answer sentence of the Phase 2 tools; every number in it is a field of the tool result."""
    if intent == "calculate_metric":
        return _metric_text(r)
    if intent == "get_alarm_history":
        return _history_text(r)
    if intent == "compare_equipment":
        return _compare_text(r, params)
    kind = (r.get("scope") or {}).get("type")
    total = r.get("total", 0)
    if not total:
        live = r.get("mapping") or {}
        tail = f" The live point {live['live_point']} is not mapped for this project either." if live.get("live_point") and live.get("mapped") is False else ""
        return f"No equipment point name matches {r.get('label')}{f' on {kind} equipment' if kind else ''}. Equipment checked: {r.get('equipment_scanned', 0)}." + tail
    text = (f"{total} equipment items have" if total != 1 else "1 equipment item has") + f" {r.get('label')} points{f' of type {kind}' if kind else ''}, " \
           f"{r.get('with_readings', 0)} with a usable reading. Including {_names([i.get('name') for i in r.get('items') or []])}.{_shown(r)}"
    if r.get("points_without_reading"):
        text += f" {r['points_without_reading']} of {r['points_matched']} matching points have no usable reading ({_reasons(r.get('excluded') or {})})."
    return text


def _gaps(r: dict) -> str:
    """The data-quality warning of an hourly-energy result, in one or two sentences ("" when every hour expected was read)."""
    out = []
    if r.get("complete") is False or r.get("missing_hours") or r.get("invalid_hours"):
        miss = r.get("missing_hours") or []
        out.append("Data is incomplete. Some hourly readings are missing" + (f" ({', '.join(miss)})" if 0 < len(miss) <= 6 else "") + ".")
    if r.get("invalid_hours"):
        out.append(f"A negative sample was not counted ({', '.join(r['invalid_hours'][:6])}).")
    if r.get("days_without_data"):
        out.append(f"{r['days_without_data']} of {r['days']} days have no data.")
    if r.get("history_from"):
        out.append(f"The hourly history starts on {r['history_from']}, so earlier days cannot be read.")
    return " ".join(out)


def _energy_text(r: dict) -> str:
    """The energy answers: the figure first, the data-quality warning after it, no metadata the user did not ask for. Every number is a field of the result."""
    period = r.get("period")
    when = {"now": "now", "today": "today", "yesterday": "yesterday", "week": "this week", "month": "this month"}[period]
    if period == "now":
        if r.get("quantity") == "power":
            what = f"Current power is {_g(r['value'])} {r['unit']}."
        elif r.get("quantity") == "energy":
            what = (f"No live power (kW) reading is available for this project. Its live consumption point reports the energy of the current hour: "
                    f"{_g(r['value'])} {r['unit']}.")
        else:
            what = (f"The live consumption point returned {_g(r['value'])}, but FIN sent no unit for it, so it cannot be called power (kW) or energy (kWh).")
        return f"{what}\n\nLast read from FIN at {r.get('as_of')}."
    if r.get("boards") is not None:
        top = r["boards"][0]
        ranked = "; ".join(f"{b['name']} {_g(b['value'])} {r['unit']}" for b in r["boards"][:3])
        gap = f" No data: {', '.join(r['boards_without_data'])}." if r.get("boards_without_data") else ""
        return (f"Highest energy {when} by distribution board: {top['name']} ({_g(top['value'])} {r['unit']}). Top boards: {ranked}.{gap} "
                f"{r['note']} Updated {r.get('as_of')}.")
    if period == "month" and r.get("entries") is None:
        return f"This month's energy consumption is {_g(r['value'])} {r['unit']} so far (FIN's month-to-date reading)."
    gaps = _gaps(r)
    if r.get("entries") is not None:
        label = lambda e: e["from"] if e["from"] == e["to"] else f"{e['from']} to {e['to']}"      # noqa: E731
        rows = [f"- {label(e)}: " + (f"{_g(e['value'])} {r['unit']}" if e["value"] is not None else "no data")
                + (f" (incomplete: {e['hours_reported']} of {e['hours_expected']} hours)" if e["value"] is not None and not e["complete"] else "") for e in r["entries"]]
        by = {"day": "day", "week": "week"}.get(r.get("breakdown"), "day")
        head = f"{'This week' if period == 'week' else 'This month'}'s energy consumption ({r['from']} to {r['to']}) is {_g(r['value'])} {r['unit']}, by {by}:"
        return head + "\n" + "\n".join(rows) + (f"\n\n{gaps}" if gaps else "")
    if r.get("hourly") is not None:
        rows = [f"- {h['hour']}: " + (f"{_g(h['value'])} {r['unit']}" if h["value"] is not None else "no reading" if h["status"] == "missing" else "negative sample, not counted")
                for h in r["hourly"]]
        return f"Hourly energy consumption {when} totals {_g(r['value'])} {r['unit']}:\n" + "\n".join(rows) + (f"\n\n{gaps}" if gaps else "")
    if r.get("from_hour"):
        head = f"Energy consumed {when} between {r['from_hour']} and {r['to_hour']} is {_g(r['value'])} {r['unit']}."
    else:
        head = f"{'Today' if period == 'today' else 'Yesterday'}'s energy consumption is {_g(r['value'])} {r['unit']}."
    return head + (f"\n\n{gaps}" if gaps else "")


def direct_text(out: dict, rule: str = "") -> str:
    """The answer sentence for an execute() result."""
    intent, params, r = out.get("intent"), out.get("parameters") or {}, out.get("result") or {}
    if not r.get("available"):
        return _UNAVAILABLE.get(r.get("reason")) or r.get("message") or "This data could not be read right now."
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
        note = f" {r['grading_note']}" if r.get("grading_note") else ""
        if not total:
            recorded = r.get("equipment_record_open_alarms")
            if recorded:
                return (f"The equipment list shows {recorded} open alarms for {params.get('equipment')}, but the latest FIN alarm read holds no alarm record "
                        "that could be matched to it, so their descriptions and severities cannot be shown." + note)
            return f"There are no open{sev} alarms{where}." + note
        c = r.get("counts") or {}
        text = f"Open{sev} alarms{where}: {total}"
        text += "." if sev else f" ({c.get('critical', 0)} critical, {c.get('warning', 0)} warning, {c.get('info', 0)} info)."
        shown = [f"{a.get('source')} ({a.get('severity')}): {a.get('message')}" for a in (r.get("alarms") or [])[:3]]
        return text + (" " + "; ".join(shown) + "." if shown else "") + note
    if intent == "find_equipment":
        total, names = r.get("total", 0), [i.get("name") for i in r.get("items") or []]
        if params.get("in_alarm"):
            of_type = f" of type {params['type']}" if params.get("type") else ""
            return (f"Equipment{of_type} currently in alarm ({total}): {_names(names)}.{_shown(r)}" if total
                    else f"No equipment{of_type} is currently in alarm.")
        kind = params.get("type")
        if kind and not total:
            return f"No equipment of type {kind} was found in this project's data."
        lead = f"Equipment of type {kind}: {total}." if kind else f"Equipment items: {total}."
        untyped = (" No equipment types are mapped for this project (Dashboard Settings > Data Mapping > Equipment Classes), so the type shows other for "
                   "every item; each item's own FIN tags are listed instead." if r.get("types_mapped") is False and total else "")
        return lead + (f" Including {_names(names)}." if names else "") + _shown(r) + untyped
    if intent in ("search_points", "calculate_metric", "compare_equipment", "get_alarm_history"):
        return _phase2_text(intent, r, params)
    if intent == "get_capabilities":
        return _capabilities_text(r)
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
    if intent == "get_environment":
        parts = [f"{x['name']}: {_g(x['value'])}" + (f" {x['unit']}" if x.get("unit") else "")
                 + (f" (average of {x['points']} points, {_g(x['min'])} to {_g(x['max'])})" if x.get("points") else "") for x in r.get("readings") or []]
        text = "; ".join(parts) + f". Updated {r.get('as_of')}."
        if r.get("unavailable"):
            text += " Not available: " + "; ".join(m["message"] for m in r["unavailable"]) + "."
        if r.get("metric") == "iaq":
            text += " " + r["status_note"]
        return text
    if intent == "get_energy":
        return _energy_text(r)
    if intent == "get_hvac_status":
        kind = f" {params['type']}" if params.get("type") else ""
        if not r.get("total"):
            return f"No{kind} systems are recorded in this project's data."
        if rule == "hvac.which" or kind:
            return (f"Online{kind}: {r['online_count']} of {r['total']}. " + (f"Online: {_names(r['online'], 15)}. " if r["online"] else "")
                    + (f"Offline: {_names(r['offline'], 15)}. " if r["offline"] else "") + r["definition"] + f" Updated {r.get('as_of')}.")
        alarms = f" Open alarms: {r['open_alarms']}." if r.get("open_alarms") is not None else ""
        return (f"HVAC systems online: {r['online_count']} of {r['total']}; {r['in_alarm']} in alarm.{alarms} "
                + (f"Offline: {_names(r['offline'], 15)}. " if r["offline"] else "") + r["definition"] + f" Updated {r.get('as_of')}.")
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


def rules_answer(text: str) -> bool:
    """True when the fixed rules answer this text: one rule matches it, or every part of a compound message has a rule. (eko_chat_spelling asks this
    before it lets a corrected word stand.)"""
    if route(text)["route"] == "direct" or clarification_for(text):
        return True
    plan = plan_parts(text)
    return bool(plan) and all(p["decision"] for p in plan["parts"])


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
