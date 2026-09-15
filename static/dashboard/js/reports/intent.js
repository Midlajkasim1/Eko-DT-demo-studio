/* ============================================================================
   REPORT INTENT (D89 stage 2, D91 stage 4)
   1. suggest(E): the ONE context suggestion — from where the user stands
      (site, route, open asset, alarm surface) and the timeline's window.
   2. parse(E, text): a natural-language ask → { templateId, period, params,
      matched, ambiguous }. Rule-based, on-prem, deterministic; the language
      model never decides a template or a number. The result is ALWAYS shown
      as an editable summary before anything is generated.
   3. isReportRequest(text): lets the Ask EKO bar hand report asks to the
      same engine — one implementation, not two.
   ============================================================================ */
window.EKO_RI = (function(){
  'use strict';
  const R = () => window.EKO_R;
  /* template keyword rules, EN + AR. Order = priority when several match. */
  const RULES = [
    { id:'incident-report',     re:/\bincident\b|حادث/i },
    { id:'executive-monthly',   re:/\bexecutive\b|\bmonthly\b|\bboard pack\b|تنفيذي|شهري/i },
    { id:'pm-compliance',       re:/\bpm\b|preventive|maintenance|compliance|صيانة|امتثال/i },
    { id:'shift-handover',      re:/\bshift\b|handover|hand-over|تسليم|وردية|مناوبة/i },
    { id:'morning-brief',       re:/\bmorning\b|\bbrief\b|صباح|موجز/i },
    { id:'utilities-water-gas', re:/\bwater\b|\bgas\b|utilit|\bleak\b|\btank\b|مياه|غاز|مرافق|تسرب|خزان/i },
    { id:'energy-performance',  re:/\benergy\b|\bpower\b|electric|\bkwh\b|\bload\b|\bcarbon\b|طاقة|كهرباء|حمل|كربون/i },
    { id:'alarm-summary',       re:/\balarms?\b|\balerts?\b|\bfaults?\b|تنبيه|إنذار|أعطال|تنبيهات/i }
  ];
  const ALARM_RE = /\balarms?\b|\balerts?\b|تنبيه|تنبيهات|إنذار/i;
  const ASSET_RE = /\b([A-Z]{2,5}-[A-Z0-9]+(?:-[A-Z0-9]+)*)\b/;
  const REPORT_RE = /\breport\b|\bbrief\b|\bhandover\b|\bsummary\b|تقرير|موجز|ملخص/i;

  function parsePeriod(t){
    let m;
    if(/last month|previous month|الشهر الماضي|الشهر السابق/i.test(t)) return { kind:'prevMonth' };
    if(/this month|month to date|\bmtd\b|هذا الشهر|منذ بداية الشهر/i.test(t)) return { kind:'month' };
    if((m = t.match(/last (\d{1,2}) ?h(?:ours?)?\b|آخر (\d{1,2}) ساع/i))) return { kind:'last', h:+(m[1] || m[2]) };
    if((m = t.match(/last (\d{1,2}) ?days?\b|آخر (\d{1,2}) أيام|آخر (\d{1,2}) يوم/i))) return { kind:'days', n:+(m[1] || m[2] || m[3]) };
    if(/\bshift\b|وردية|مناوبة/i.test(t)) return { kind:'last', h:12 };
    if(/today|اليوم/i.test(t)) return { kind:'today' };
    return null;
  }
  function parse(E, text){
    const t = String(text || '').trim();
    const hits = RULES.filter(r => r.re.test(t)).map(r => r.id);
    const params = {};
    let templateId = null, ambiguous = false;
    const nonAlarm = hits.filter(h => h !== 'alarm-summary');
    if(nonAlarm.length === 1){ templateId = nonAlarm[0]; if(hits.includes('alarm-summary')) params.includeAlarms = true; }
    else if(nonAlarm.length === 0 && hits.includes('alarm-summary')) templateId = 'alarm-summary';
    else if(nonAlarm.length > 1){ ambiguous = true; }
    const am = t.match(ASSET_RE);
    if(am){ const id = am[1].toUpperCase(); const asset = E.data.assets.find(a => a.id === id);
      if(asset){ params.assetId = id; const al = E.data.alarms.find(a => a.asset === id); if(al){ params.alarmId = al.id; if(!templateId && !ambiguous) templateId = 'incident-report'; } } }
    if(templateId === 'incident-report' && !params.alarmId){ const al = E.data.alarms.slice().sort((a, b) => sevRank(b.sev) - sevRank(a.sev))[0]; if(al){ params.alarmId = al.id; params.alarmGuessed = true; } }
    const period = parsePeriod(t);
    return { text:t, templateId, period, params, matched:hits, ambiguous: ambiguous || !templateId };
  }
  const sevRank = s => s === 'critical' ? 3 : s === 'high' ? 2 : 1;
  /* An Ask EKO question is a report ask when it names a report, or when it
     names a subject AND a window AND asks for usage/status rather than a
     why-question ("water usage last month with the leak status"). Anything
     else stays a question for Ask EKO (js/ai/ask.js, D132). */
  const USAGE_RE = /\busage\b|\bconsumption\b|\bstatus\b|\boverview\b|\bfigures\b|\btotals?\b|استهلاك|حالة|إجمالي/i;
  const isReportRequest = text => { const t = String(text || '');
    if(REPORT_RE.test(t)) return true;
    return !!parsePeriod(t) && RULES.some(r => r.re.test(t)) && USAGE_RE.test(t) && !/^\s*(why|how come|what is causing|لماذا)/i.test(t); };

  /* the context suggestion */
  function suggest(E){
    const s = E.state, tl = s.tlRange === '6h' ? { kind:'last', h:6 } : { kind:'today' };
    const mod = s.module, sub = s.sub;
    if(s.assetSel){
      const al = E.data.alarms.find(a => a.asset === s.assetSel);
      if(al) return { templateId:'incident-report', period:{ kind:'today' }, params:{ alarmId:al.id, assetId:s.assetSel }, why:'asset' };
    }
    if(s.dlg === 'alerts') return { templateId:'alarm-summary', period:{ kind:'today' }, params:{}, why:'alerts' };
    if(mod === 'energy' || sub === 'power' || sub === 'anom' || sub === 'bench' || sub === 'fcst') return { templateId:'energy-performance', period:tl, params:{}, why:'route' };
    if(mod === 'utilities' || sub === 'water' || sub === 'gas') return { templateId:'utilities-water-gas', period:{ kind:'today' }, params:{}, why:'route' };
    if(mod === 'systems') return { templateId:'alarm-summary', period:tl, params:{}, why:'route' };
    if(mod === 'assets') return { templateId:'pm-compliance', period:{ kind:'month' }, params:{}, why:'route' };
    if(s.pageId === 'notifications') return { templateId:'shift-handover', period:{ kind:'last', h:12 }, params:{}, why:'route' };
    return { templateId:'morning-brief', period:tl, params:{}, why:'route' };
  }
  /* "Energy performance · Marsa Al Arab · today · include alarms" */
  function summary(E, intent){
    const tpl = R().templates()[intent.templateId];
    const parts = [];
    if(tpl){ const al = intent.params && intent.params.alarmId ? E.data.alarms.find(a => a.id === intent.params.alarmId) : null;
      parts.push(E.t(tpl.titleKey, al ? { asset: al.asset } : {})); }
    else parts.push(E.t('rpAsk.unknown'));
    parts.push(E.lang === 'ar' ? E.data.nameAr : E.data.nameEn);
    const per = R().period(E, intent.period || (tpl && tpl.defaultPeriod));
    parts.push(E.t(per.labelKey, per.params));
    if(intent.params && intent.params.includeAlarms) parts.push(E.t('rpAsk.withAlarms'));
    return parts.join(' · ');
  }
  return { parse, suggest, summary, isReportRequest, RULES };
})();
