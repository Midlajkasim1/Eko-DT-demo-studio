"""Eko-Chat: the sentences the CODE writes, in Arabic, for a request that asks for Arabic.

The planner writes its own answers through the model, but some replies are written by code from the tool results: the reply of a request that ran out of
time, a partial answer (deadline, planning limit, model stopped) that reports what had already been read, and the fixed replies for a model that is down or
not understood. For a request in English these are eko_chat_router.direct_text and the texts in eko_chat_context / eko_chat_llm. For a request that asks for
Arabic they are these, with the same rules:

  * every value, equipment ID and unit is the tool result's own (AHU_01, 24 °C, 600 ppm, 3.5 kW): nothing is translated, converted or rounded differently
  * the grounding rule holds: every number in a sentence is a field of the result it describes
  * text that comes from FIN (an alarm message, a point name, a capability label) is quoted as it is

Pure text: no FIN, no network, no model.
"""
from __future__ import annotations

from typing import Any, Optional

HELP_AR = ("يمكنني الإجابة عن هذه الأسئلة من بيانات FIN الحية لهذا المشروع: المعدات (قائمتها وعددها وحالة معدة بالاسم)، والتنبيهات (المفتوحة والحرجة وتلك "
           "الخاصة بمعدة بالاسم)، والإشعارات. اطرح سؤالًا واحدًا في كل مرة واذكر اسم المعدة، مثل \"حالة AHU-01\". اكتب \"ماذا يمكنك أن تفعل\" لمعرفة المتاح "
           "لهذا المشروع.")
LLM_DOWN_AR = "النموذج اللغوي غير متاح حاليًا، لذا يمكنني الإجابة عن الأسئلة القياسية فقط. "
NOT_UNDERSTOOD_AR = "لم أستطع تحديد المطلوب البحث عنه من هذا السؤال. "
DEFAULT_DEADLINE_S = 90

METRIC = {"temperature": "درجة الحرارة", "humidity": "الرطوبة", "co2": "ثاني أكسيد الكربون", "power": "القدرة الكهربائية", "iaq": "مؤشر جودة الهواء",
          "comfort": "مؤشر الراحة"}
OP = {"average": "المتوسط", "min": "الأدنى", "max": "الأعلى", "sum": "المجموع", "count": "عدد القراءات"}
SEVERITY = {"critical": "حرج", "warning": "تحذير", "info": "معلومة"}
WHEN = {"today": "اليوم", "yesterday": "أمس", "month": "هذا الشهر"}
STATUS = {"available": "متاحة", "partial": "متاحة جزئيًا", "unmapped": "غير مربوطة", "not_supported": "غير مدعومة"}
NOTE = {"stale": "آخر قراءة لهذه البيانات قديمة جدًا ولا تُعرض كبيانات حالية.", "no_data_yet": "لم تُقرأ هذه البيانات من FIN بعد.",
        "fin_not_connected": "لا توجد جلسة FIN مصادَق عليها.", "no_active_project": "لا يوجد مشروع FIN نشط.",
        "no_sensors": "لا توجد نقاط تبلّغ بقراءات صالحة لهذا المقياس.", "not_additive": "لا يمكن جمع هذه القراءات.",
        "unit_conflict": "القراءات بوحدات مختلفة ولا يمكن جمعها."}


# ─── The fixed replies and prefixes ──────────────────────────────────────────

def timeout_text(deadline: Any) -> str:
    n = f"{deadline.seconds:g}" if deadline is not None else str(DEFAULT_DEADLINE_S)
    return f"لم تتم الإجابة عن السؤال خلال {n} ثانية، لذا تم إيقافه. يرجى المحاولة مرة أخرى أو طرح سؤال واحد في كل مرة."


def partial_prefix(kind: str, n: Any = 0) -> str:
    """The start of a partial answer: the time limit was reached (n seconds), the planning limit was (n rounds), or the model stopped answering."""
    if kind == "limit":
        why = f"تم بلوغ حد التخطيط ({n} جولات)."
    elif kind == "stopped":
        why = "توقف النموذج اللغوي عن الإجابة."
    else:
        why = f"تم بلوغ المهلة الزمنية ({float(n):g} ثانية)."
    return f"هذه الإجابة غير مكتملة: {why} ما قُرئ من FIN حتى ذلك الحين: "


def rounds_text(n: int) -> str:
    return f"لم يُنهِ النموذج الخطة خلال {n} جولات. "


# ─── A tool result in Arabic ─────────────────────────────────────────────────

def _g(value: Any) -> str:
    from eko_chat_router import _g as one_decimal          # imported here: the router imports eko_chat
    return one_decimal(value)


def _unit(unit: Any) -> str:
    return f" {unit}" if unit else ""


def _names(items: list, limit: int = 5) -> str:
    names = [str(n) for n in items[:limit]]
    return "، ".join(names) + (" وغيرها" if len(items) > len(names) else "")


def unavailable_ar(r: dict) -> str:
    """What could not be read, in Arabic: the reason, and the Data Mapping entries to map (names only), from the result."""
    from eko_chat import _clean_missing
    keys = [m.get("key") for m in _clean_missing(r.get("missing") or []) if m.get("key")]
    base = NOTE.get(r.get("reason")) or "هذه البيانات غير متاحة لهذا المشروع أو تعذّرت قراءتها."
    if keys and r.get("reason") not in NOTE:
        base += f" المطلوب ربطه في إعدادات ربط البيانات: {', '.join(keys)}."
    return base


def _alarms(p: dict, r: dict) -> str:
    on = f" على {p['equipment']}" if p.get("equipment") else ""
    shown = "؛ ".join(f"{a.get('source')} ({SEVERITY.get(a.get('severity'), a.get('severity'))}): {a.get('message')}" for a in (r.get("alarms") or [])[:3])
    if p.get("history"):
        if not r.get("total"):
            return f"لا توجد سجلات تنبيهات{on} في آخر قراءة من FIN. هذا ما أعادته تلك القراءة فقط وليس أرشيفًا كاملًا."
        return f"آخر سجلات التنبيهات{on}، مفتوحة أو مُغلقة، في قراءة FIN الأخيرة: {r.get('total')}. {shown}. وهذا ليس أرشيفًا كاملًا للتنبيهات."
    if not r.get("total"):
        return f"لا توجد تنبيهات مفتوحة{on}."
    c = r.get("counts") or {}
    text = f"التنبيهات المفتوحة{on}: {r.get('total')} ({c.get('critical', 0)} حرجة، {c.get('warning', 0)} تحذيرية، {c.get('info', 0)} معلوماتية)."
    return text + (f" {shown}." if shown else "")


def _equipment(p: dict, r: dict) -> str:
    names = [i.get("name") for i in r.get("items") or []]
    total = r.get("total", 0)
    if p.get("in_alarm"):
        return f"المعدات التي في حالة إنذار حاليًا ({total}): {_names(names)}." if total else "لا توجد معدات في حالة إنذار حاليًا."
    kind = p.get("type")
    if kind and not total:
        return f"لا توجد معدات من النوع {kind} في بيانات هذا المشروع."
    lead = f"عدد المعدات من النوع {kind}: {total}." if kind else f"عدد المعدات: {total}."
    return lead + (f" من بينها: {_names(names)}." if names else "")


def _status(p: dict, r: dict) -> str:
    if not r.get("found"):
        cands = r.get("candidates") or []
        lead = (f"هناك أكثر من معدة تطابق الاسم {p.get('equipment')}." if r.get("reason") == "ambiguous" else f"لم يتم العثور على معدة باسم {p.get('equipment')}.")
        return lead + (f" أقرب النتائج: {_names(cands)}." if cands else "")
    eq, pts, health = r.get("equipment") or {}, r.get("points") or {}, r.get("health_facts") or {}
    text = f"{eq.get('name')}: التنبيهات المفتوحة {health.get('open_alarms', 0)}؛ النقاط المبلِّغة {pts.get('reporting', 0)} من {pts.get('total', 0)}."
    own = (r.get("alarms") or {}).get("on_equipment_record") or []
    return text + (" " + "؛ ".join(str(a.get("message")) for a in own[:3]) + "." if own else "")


def _environment(p: dict, r: dict) -> str:
    name = METRIC.get(r.get("metric") or p.get("metric"), "القراءة")
    parts = [f"{name}: {_g(x['value'])}{_unit(x.get('unit'))}" + (f" (متوسط {x['points']} نقاط، من {_g(x['min'])} إلى {_g(x['max'])})" if x.get("points") else "")
             for x in r.get("readings") or []]
    return "؛ ".join(parts) + f". آخر تحديث {r.get('as_of')}."


def _energy(p: dict, r: dict) -> str:
    when = WHEN.get(r.get("period"), "")
    if r.get("boards") is not None:
        top = r["boards"][0]
        return f"أعلى استهلاك للطاقة {when} بحسب لوحة التوزيع: {top['name']} ({_g(top['value'])} {r['unit']})."
    if r.get("period") == "month":
        return f"استهلاك الطاقة {when} ({r['month']}): {_g(r['value'])} {r['unit']}، وهي قراءة FIN نفسها لما تراكم منذ بداية الشهر."
    return f"استهلاك الطاقة {when} ({r['date']}): {_g(r['value'])} {r['unit']}، {r['hours_reported']} من {r['hours_expected']} ساعات مُبلَّغة."


def _hvac(p: dict, r: dict) -> str:
    kind = f" من النوع {p['type']}" if p.get("type") else ""
    if not r.get("total"):
        return f"لا توجد أنظمة{kind} في بيانات هذا المشروع."
    return f"الأنظمة{kind} المتصلة: {r['online_count']} من {r['total']}؛ {r['in_alarm']} منها في حالة إنذار."


def _notifications(p: dict, r: dict) -> str:
    return f"الإشعارات المعروضة: {r.get('total', 0)}، منها {r.get('unread', 0)} غير مقروءة."


def _capabilities(p: dict, r: dict) -> str:
    a = r.get("about")
    if a:
        return f"{a.get('label')}: {STATUS.get(a.get('status'), 'غير مدعومة')}."
    c = r.get("counts") or {}
    return (f"الإمكانيات المتاحة: {c.get('available', 0)}، المتاحة جزئيًا: {c.get('partial', 0)}، غير المربوطة: {c.get('unmapped', 0)}، "
            f"غير المدعومة: {c.get('not_supported', 0)}.")


def _snapshot(p: dict, r: dict) -> str:
    parts = []
    counts = (r.get("alarms") or {}).get("counts")
    if counts:
        parts.append(f"التنبيهات المفتوحة {counts.get('total', 0)}")
    fac = r.get("facility_services") or {}
    if fac.get("systems_online") is not None and fac.get("systems_total") is not None:
        parts.append(f"الأنظمة المتصلة {fac['systems_online']} من {fac['systems_total']}")
    return "نظرة عامة على المبنى: " + ("؛ ".join(parts) if parts else "لا توجد أقسام بيانات حالية") + "."


def _search(p: dict, r: dict) -> str:
    name = METRIC.get(p.get("metric"), "")
    kind = f" من النوع {p['type']}" if p.get("type") else ""
    if not r.get("total"):
        return f"لا توجد نقاط {name}{kind} في معدات هذا المشروع."
    text = f"عدد المعدات{kind} التي لها نقاط {name}: {r['total']}، منها {r.get('with_readings', 0)} لها قراءة صالحة."
    names = [i.get("name") for i in r.get("items") or []]
    return text + (f" من بينها: {_names(names)}." if names else "")


def _metric(p: dict, r: dict) -> str:
    name = METRIC.get(r.get("metric") or p.get("metric"), "")
    basis = f"من {r['samples']} قراءة على {r['equipment_count']} معدة (آخر قراءة من FIN {r.get('as_of')}). القراءات لحظية ولا يوجد سجل تاريخي."
    if r.get("op") == "top":
        order = "الأعلى" if r.get("order") == "highest" else "الأدنى"
        ranked = "؛ ".join(f"{i['rank']}. {i['equipment']} {_g(i['value'])}{_unit(i.get('unit'))} ({i['point']})" for i in r.get("items") or [])
        return f"{name} - الترتيب من {order}: {ranked}. {basis}"
    if r.get("op") == "count":
        return f"عدد قراءات {name} الصالحة: {r['value']}. {basis}"
    at = f" عند {r['at']['equipment']} ({r['at']['point']})" if r.get("at") else ""
    return f"{OP.get(r.get('op'), '')} {name}: {_g(r['value'])}{_unit(r.get('unit'))}{at}. {basis}"


def _compare(p: dict, r: dict) -> str:
    if not r.get("found"):
        if r.get("reason") == "same_equipment":
            return "الاسمان يشيران إلى المعدة نفسها، فلا توجد مقارنة."
        said = [(f"هناك أكثر من معدة تطابق الاسم {u['equipment']}." if u.get("reason") == "ambiguous" else f"لم يتم العثور على معدة باسم {u['equipment']}.")
                for u in r.get("unfound") or []]
        return "لم تتم المقارنة. " + " ".join(said)
    a, b = (e.get("name") for e in r["equipment"])
    al = r.get("alarms") or {}
    if r.get("focus") == "alarms":
        return f"{a}: التنبيهات المفتوحة {al['a']['open']}؛ {b}: التنبيهات المفتوحة {al['b']['open']}."
    c = r.get("comparison") or {}
    text = f"{a} مقارنةً بـ {b}: {c.get('compared', 0)} نقطة رقمية مشتركة."
    rank = sorted(c.get("items") or [], key=lambda i: -abs(i["percent_difference"] if i.get("percent_difference") is not None else i["difference"]))[:3]
    shown = []
    for i in rank:
        gap = f"، {_g(i['percent_difference'])}%" if i.get("percent_difference") is not None else "؛ لا نسبة مئوية لأن القيمة الثانية صفر"
        shown.append(f"{i['point']} {_g(i['a'])} مقابل {_g(i['b'])}{_unit(i.get('unit'))} (الفرق {_g(i['difference'])}{gap})")
    if shown:
        text += " أكبر الفروق أولًا، الأولى ناقص الثانية: " + "؛ ".join(shown) + "."
    return text + f" التنبيهات المفتوحة: {a} {al['a']['open']}، {b} {al['b']['open']}."


def _history(p: dict, r: dict) -> str:
    cov = r.get("coverage")
    if cov is None:
        return "قراءة FIN الأخيرة لا تحتوي على سجلات تنبيهات، لذا لا يمكن إعطاء عدد لأي فترة."
    text = f"سجلات التنبيهات في قراءة FIN الأخيرة: {r['total']} ({r['open']} مفتوحة، {r['cleared']} مُغلقة)."
    if r.get("by_severity"):
        s = r["by_severity"]
        text += f" حسب الخطورة: {s['critical']} حرجة، {s['warning']} تحذيرية، {s['info']} معلوماتية."
    if cov.get("from"):
        text += f" تغطي القراءة الفترة من {cov['from']} إلى {cov['to']}."
    return text + " وهذا ليس أرشيفًا."


_RENDER = {"get_alarms": _alarms, "find_equipment": _equipment, "get_equipment_status": _status, "get_environment": _environment, "get_energy": _energy,
           "get_hvac_status": _hvac, "get_notifications": _notifications, "get_capabilities": _capabilities, "get_building_snapshot": _snapshot,
           "search_points": _search, "calculate_metric": _metric, "compare_equipment": _compare, "get_alarm_history": _history}


def direct_text_ar(out: dict) -> str:
    """The Arabic sentence for an execute()-shaped result {"intent", "parameters", "result"}."""
    r = out.get("result") or {}
    params = out.get("parameters") or {}
    if not r.get("available"):
        return unavailable_ar(r)
    render = _RENDER.get(out.get("intent"))
    return render(params, r) if render else "تمت قراءة البيانات."
