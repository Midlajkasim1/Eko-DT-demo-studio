/* ============================================================================
   THE BRIEF (D137 → D139) — "Your Brief".

   The live glance of what CHANGED while you were away. It is not a report:
   Reports are documents you generate and keep (the Morning report among
   them); the Brief greets you, every line is a delta, and nothing is kept.

   THE LAW (shared with reports/narrate.js and ai/ask.js): the PLATFORM
   computes every delta, ranks them and picks the one recommendation; the
   model returns only the HEADLINE (the most important change, in plain
   language — an insight, never a count) and the recommendation's wording. A number the
   platform did not supply rejects the narration (EKO_RN.offending), one
   regeneration, then the computed items with a note. No model reachable →
   the computed items, narrationAvailable false.

   PRODUCTION vs PROTOTYPE. handoff/brief.md is the server contract: lastSeen
   per user per site on the server, the trigger endpoint, the delta query over
   the indexed event sources, the ranking rule and the payload. THIS FILE
   MOCKS that server in the browser: lastSeen lives in localStorage, and the
   event sources are data.alarms plus data.eventLog. payload() builds exactly
   the documented shape, and the card renders from it, so the endpoint can
   replace payload() without touching the render.

   WHAT IT NEVER DOES. It never restates the ribbon (state); it states change.
   It never renders on the control-room wall — nobody arrives at a wall.

   Internal names: the i18n keys are `cu.*` and the classes `.cu*` — the
   feature's working name was "catch-up". They are private; the public names
   are EKO_BRIEF, data.brief and the payload fields.
   ============================================================================ */
window.EKO_BRIEF = (function(){
  'use strict';
  const C = () => window.EKO_C, RN = () => window.EKO_RN, LLM = () => window.EKO_LLM;
  const esc = s => C().esc(s);
  const icon = (n, s) => C().icon(n, s);
  let E = null;
  const LSV = 'eko-visit-v1', LSD = 'eko-brief-dismissed-v1', LSS = 'eko-brief-sched-v1';
  /* module state: the visit this load opened with, the on-demand window, the dismissal */
  const S = { visit: null, forced: false, winKind: null, dismissed: null, touchedAt: 0, pending: {}, schedTimer: null, arrival: null, replay: false, mem: null, loadAt: 0, fit: 0,
    /* D150: the ribbon's selected segment, a scroll owed to it, the feed's scroll position, the archive */
    seg: null, scrollSeg: false, onScreen: false, feedTop: 0, showArch: false, arch: null, archFor: null, geom: null,
    /* D152: false = the Brief (the shift log), true = the full log (the timeline) */
    full: false,
    /* D154: the reader's own placement {l, t, w, h}, or null = the Brief places itself */
    box: null, boxFor: null };
  /* narration cache: hash of the delta payload (+ language) → { status, summary, reco } */
  const NARR = new Map();

  /* D150: the PRIMARY window — what the headline, the recommendation and the sources line are
     written for: since your last visit, or since shift start (a handover, or no visit on record) */
  const PRIM = ['visit', 'shift'];
  const cfg = () => Object.assign({ thresholdH: 4, firstVisitOfDay: true, capH: 24, escalateAfterH: 24, showWhenNoChange: false,
    dismissExpiryH: null, touchDebounceS: 60,
    ranking: ['severity', 'unackAge', 'costImpact'], rankingFallback: ['woOverdue', 'srcOffline'],
    schedule: { enabled: false, at: 'shiftStart', window: 'shift' } }, E.data.brief || {});
  const demo = () => !!(window.EKO_BUILD && window.EKO_BUILD.demo);
  const ls = { get(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } },
               set(k, v){ try{ localStorage.setItem(k, v); }catch(e){} } };
  /* the dismissal is per SESSION, so a new session always brings the Brief back */
  const ss = { get(k){ try{ return sessionStorage.getItem(k); }catch(e){ return null; } },
               set(k, v){ try{ sessionStorage.setItem(k, v); }catch(e){} },
               del(k){ try{ sessionStorage.removeItem(k); }catch(e){} } };
  const who = () => ((E.data.user || {}).name || 'user') + ':' + (E.data.nameEn || 'site');
  const visitKey = () => LSV + ':' + who();
  const hhmm = ms => { const d = new Date(ms); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  /* a window's start: HH:MM today, "yesterday HH:MM" otherwise (the cap keeps it within a day) */
  const stamp = (app, ms) => new Date(ms).toDateString() === new Date().toDateString() ? hhmm(ms) : app.t('cu.yday', { t: hhmm(ms) });
  const sevRank = s => ({ critical: 3, high: 2, medium: 1 }[s] || 0);

  /* -------------------------------- windows -------------------------------- */
  /* A window is { kind, gapH, atMs } plus, when the absence was longer than the
     cap, { capped:true, absenceH }. The delta computation takes any of them. */
  function visitWindow(){
    const prev = ls.get(visitKey());
    let gapH = prev ? (Date.now() - (+prev)) / 36e5 : null;
    /* DEMO ONLY (D129 rule). A demo must never lose the Brief, so in a demo build
       brief.demoGapH STANDS IN for the real gap on every load. `?gap=<h>`
       overrides it (0 suppresses it; 72 simulates a three-day absence). A client
       build reaches none of this and uses the real stored lastSeen. */
    if(demo()){
      let q = null; try{ q = new URL(location.href).searchParams.get('gap'); }catch(e){}
      if(q != null && isFinite(+q)) gapH = +q;
      else if(cfg().demoGapH != null) gapH = cfg().demoGapH;
    }
    if(gapH == null) return null;
    return { kind: 'visit', gapH, atMs: Date.now() - gapH * 36e5 };
  }
  /* since the start of the shift the wall's pattern says we are in
     (data.wall.shifts.starts, the single source the wall also reads) */
  function shiftWindow(){
    const starts = (((E.data.wall || {}).shifts) || {}).starts || [];
    const toMin = s => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s)); return m ? +m[1] * 60 + +m[2] : null; };
    const mins = starts.map(toMin).filter(x => x != null).sort((a, b) => a - b);
    if(!mins.length) return null;
    const now = new Date(), nowMin = now.getHours() * 60 + now.getMinutes();
    const passed = mins.filter(x => x <= nowMin);
    const start = passed.length ? passed[passed.length - 1] : mins[mins.length - 1];
    const gapH = (nowMin - start + (passed.length ? 0 : 1440)) / 60;
    return { kind: 'shift', gapH, atMs: Date.now() - gapH * 36e5, startMin: start };
  }
  const fixed = (kind, h) => ({ kind, gapH: h, atMs: Date.now() - h * 36e5 });
  /* the cap: an absence longer than capH shows the last capH hours, and says so */
  function capped(w){
    const cap = cfg().capH;
    if(!w || cap == null || w.gapH <= cap) return w;
    return Object.assign({}, w, { gapH: cap, atMs: Date.now() - cap * 36e5, capped: true, absenceH: w.gapH });
  }
  /* the VISIT window is the one this load opened with: init() has already stamped
     the clock, so recomputing it here would report a gap of zero. */
  function windows(){
    return { visit: S.visit ? capped(S.visit) : null, shift: shiftWindow(), h8: fixed('h8', 8), h24: fixed('h24', 24) };
  }
  const windowFor = kind => windows()[kind] || null;

  /* -------------------------------- ranking -------------------------------- */
  /* ONE rule orders the recommendation AND the items (data.brief.ranking):
       1. severity   — the EFFECTIVE severity: an alarm unacknowledged for longer
                       than brief.escalateAfterH (24 h) ranks as if one level
                       higher. For the Brief's ranking ONLY — the ribbon, the
                       alarm's glyph and its real severity never change.
       2. unackAge   — the longest unacknowledged first (this breaks the ties
                       the escalation creates)
       3. costImpact — the highest stated impactAedMo first (none = 0) */
  const escalated = a => !a.ack && (a.ageH || 0) >= cfg().escalateAfterH;
  const effSev = a => sevRank(a.sev) + (escalated(a) ? 1 : 0);
  const SEVNAME = ['', 'medium', 'high', 'critical', 'critical'];
  function alarmCmp(a, b){
    const KEYS = { severity: effSev, unackAge: x => x.ageH || 0, costImpact: x => x.impactAedMo || 0 };
    for(const k of (cfg().ranking || []).filter(k => KEYS[k])){ const x = KEYS[k](b) - KEYS[k](a); if(x) return x; }
    return 0;
  }
  const topOf = list => list.filter(a => !a.ack).sort(alarmCmp)[0] || null;

  /* -------------------------------- deltas --------------------------------- */
  /* Every item: { type, key, text, tip, counts, link, severity, top } — link is
     what the item opens; top is the unacknowledged alarm that ranks it. Nothing
     here states a count the ribbon owns. */
  function deltas(app, win){
    const E2 = app, t = (k, v) => E2.t(k, v), h = win.gapH;
    const ar = E2.lang === 'ar';
    const evs = (E2.data.eventLog || []).filter(e => e.h <= h);
    const kind = k => evs.filter(e => e.kind === k);
    const als = E2.data.alarms || [];
    const raised = als.filter(a => a.ageH <= h);
    const acked = als.filter(a => a.ack && a.ack.ageH != null && a.ack.ageH <= h);
    const cleared = kind('alarmCleared');
    /* an unacknowledged alarm that passed the escalation age INSIDE the window */
    const crossed = als.filter(a => !a.ack && a.ageH >= cfg().escalateAfterH && a.ageH - h < cfg().escalateAfterH)
      .sort(alarmCmp);
    const woNew = kind('woCreated'), woAsgn = kind('woAssigned'), woDone = kind('woCompleted'), woLate = kind('woOverdue');
    const srcStale = kind('srcStale'), srcOff = kind('srcOffline'), srcBack = kind('srcRecovered');
    const target = kind('targetCrossed')[0] || null;
    const seg = (n, k) => n ? t(k, { n }) : null;
    const join = parts => parts.filter(Boolean).join(t('cu.join'));
    const items = [];

    if(raised.length || cleared.length || acked.length){
      const whoAckRaw = [...new Set(acked.map(a => a.ack.who).filter(Boolean))];
      const whoAck = whoAckRaw.map(u => E2.person ? E2.person(u) : u).join(t('cu.join'));
      const top = topOf(raised), shown = top || raised.slice().sort((a, b) => sevRank(b.sev) - sevRank(a.sev))[0] || null;
      items.push({ type: 'alarms', key: 'alarms', top, severity: shown ? shown.sev : null, ack: !top && !!shown,
        text: t('alarms') + t('cu.lblSep') + join([seg(raised.length, 'cu.sgRaised'), seg(cleared.length, 'cu.sgCleared'),
          acked.length ? (seg(acked.length, 'cu.sgAcked') + (whoAck ? ' ' + t('cu.by', { who: whoAck }) : '')) : null]),
        tip: cleared.length ? cleared.map(e => (ar ? e.plainAr : e.plainEn) + ' · ' + e.asset).join('\n') : '',
        counts: { raised: raised.length, cleared: cleared.length, acknowledged: acked.length, acknowledgedBy: whoAckRaw },
        link: { target: 'alarmList' } });
    }
    crossed.slice(0, 1).forEach(a => items.push({ type: 'threshold', key: 'threshold', top: a, severity: a.sev, ack: false,
      text: t('cu.threshold', { asset: a.asset, age: E2.fmtAge(a.ageH) }),
      tip: E2.alarmLines(a, false).main, counts: { asset: a.asset, severity: a.sev, unackAgeH: a.ageH },
      link: { target: 'asset', asset: a.asset } }));
    if(woNew.length || woAsgn.length || woDone.length || woLate.length){
      const by = woAsgn.map(e => ar ? (e.byAr || e.byEn) : e.byEn).filter(Boolean)[0];
      items.push({ type: 'workOrders', key: 'wos', top: null, severity: null,
        text: t('cu.lblWos') + t('cu.lblSep') + join([seg(woNew.length, 'cu.sgWoNew'),
          woAsgn.length ? (seg(woAsgn.length, 'cu.sgWoAsgn') + (by ? ' ' + t('cu.to', { who: by }) : '')) : null,
          seg(woDone.length, 'cu.sgWoDone'), seg(woLate.length, 'cu.sgWoLate')]),
        tip: [...woNew, ...woAsgn, ...woDone, ...woLate].map(e => e.wo + ' · ' + e.asset).join('\n'),
        counts: { created: woNew.length, assigned: woAsgn.length, completed: woDone.length, overdue: woLate.length, assignedTo: by || null },
        link: woLate.length ? { target: 'asset', asset: woLate[0].asset } : { target: 'workOrders' } });
    }
    if(srcStale.length || srcOff.length || srcBack.length){
      items.push({ type: 'sources', key: 'sources', top: null, severity: null,
        text: t('cu.lblSources') + t('cu.lblSep') + join([seg(srcStale.length, 'cu.sgStale'), seg(srcOff.length, 'cu.sgOffline'), seg(srcBack.length, 'cu.sgRecovered')]),
        tip: [...srcStale, ...srcOff, ...srcBack].map(e => ar ? (e.nameAr || e.nameEn) : e.nameEn).join('\n'),
        counts: { stale: srcStale.length, offline: srcOff.length, recovered: srcBack.length },
        link: { target: 'sources' } });
    }
    if(target){
      /* the figure is read LIVE from metrics; the event only says it crossed in this window */
      /* D142: the percentage derives from the metric and THE limit field the event names */
      const val = (E2.data.metrics || {})[target.metric];
      const limv = (target.limit || '').split('.').reduce((o, k) => (o || {})[k], E2.data);
      const pct = val != null && limv ? val / limv * 100 : null;
      if(pct != null && val != null) items.push({ type: 'threshold', key: 'target', top: null, severity: null,
        text: t(target.labelKey, { v: C().fmt(val, 2), pct: C().fmt(pct, 0) }),
        tip: '', counts: { metric: target.metric, value: val, pctOfTarget: pct, dir: target.dir || 'above' },
        link: { target: 'page', page: target.page, module: target.module, sub: target.sub || '' } });
    }
    /* the SAME order as the recommendation: items an unacknowledged alarm ranks
       first, by that alarm; then the fallbacks in their order (an overdue work
       order, an offline source); then the rest as computed */
    const fb = cfg().rankingFallback || [];
    const cls = it => it.top ? 0
      : (it.type === 'workOrders' && it.counts.overdue && fb.includes('woOverdue')) ? 1 + fb.indexOf('woOverdue')
      : (it.type === 'sources' && it.counts.offline && fb.includes('srcOffline')) ? 1 + fb.indexOf('srcOffline')
      : 1 + fb.length;
    items.forEach((it, i) => { it.i = i; });
    items.sort((x, y) => (cls(x) - cls(y)) || (x.top && y.top ? alarmCmp(x.top, y.top) : 0) || (x.i - y.i));
    return { items, raised, acked, cleared, crossed, woLate, srcOff, srcStale, win };   /* D150: no cap — the feed shows every change as its own box */
  }

  /* the plain words for an alarm: its plain line, starting lower-case in English
     unless it opens with an acronym */
  function plain(app, a){
    const s = app.lang === 'ar' ? (a.plainAr || a.plainEn || '') : (a.plainEn || '');
    return app.lang === 'ar' || /^[A-Z]{2}/.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1);
  }

  /* ONE recommended next action: the unacknowledged alarm the window touched
     that ranks first (see ranking, above), stating WHY — its age, and when it
     was escalated, the threshold it passed. With no alarm candidate the
     fallbacks apply in order (rankingFallback): a work order now overdue, then a
     source that went offline. Nothing else recommends anything. */
  function recommend(app, d){
    const E2 = app, t = (k, v) => E2.t(k, v), ar = E2.lang === 'ar', c = cfg();
    const a = topOf([...new Set([...d.raised, ...d.crossed])]);
    if(a){
      const esc8 = escalated(a), hours = Math.round(a.ageH), days = Math.round(a.ageH / 24);
      const k = (esc8 ? 'cu.recoStale' : 'cu.recoAlarm') + (hours < 72 ? '' : 'D');
      return { type: 'alarm', asset: a.asset, subject: { kind: 'alarm', id: a.id },
        rank: { severity: a.sev, effectiveSeverity: SEVNAME[effSev(a)], escalated: esc8, unackAgeH: a.ageH, impactAedMo: a.impactAedMo || null },
        text: t(k, { asset: a.asset, sev: t('rpSev.' + a.sev), n: hours < 72 ? hours : days, h: c.escalateAfterH }),
        lead: t('cu.leadAlarm', { asset: a.asset, what: plain(app, a) }),
        link: { target: 'asset', asset: a.asset } };
    }
    for(const f of (c.rankingFallback || [])){
      if(f === 'woOverdue' && d.woLate[0]) return { type: 'workOrder', asset: d.woLate[0].asset, subject: { kind: 'wo', id: d.woLate[0].wo }, rank: null,
        text: t('cu.recoWo', { asset: d.woLate[0].asset, wo: d.woLate[0].wo }),
        lead: t('cu.leadWo', { asset: d.woLate[0].asset, wo: d.woLate[0].wo }), link: { target: 'asset', asset: d.woLate[0].asset } };
      if(f === 'srcOffline' && d.srcOff[0]){ const name = ar ? (d.srcOff[0].nameAr || d.srcOff[0].nameEn) : d.srcOff[0].nameEn;
        return { type: 'source', asset: d.srcOff[0].src, subject: { kind: 'source', id: d.srcOff[0].src }, rank: null, text: t('cu.recoSrc', { name }),
          lead: t('cu.leadSrc', { name }), link: { target: 'sources' } }; }
    }
    return null;
  }

  /* D144 — THE BASIS OF A COST. Every AED the Brief shows is a platform sum of the
     alarms' stated impact (alarms[].impactAedMo — the optimisation model's monthly
     estimate at current behaviour, priced at the site tariff). It carries its basis
     like every cost in the product (reports' basisText): which alarms it sums, the
     source, the window, the tariff, and "provisional" while the tariff is
     unconfirmed. The model is handed the figure and its parts; it never makes one. */
  function costBasis(app, alarms){
    const parts = (alarms || []).filter(a => a.impactAedMo).map(a => ({ alarm: a.id, asset: a.asset, aedMo: a.impactAedMo }));
    if(!parts.length) return null;
    const b = app.data.basis || {};
    return { aedMo: parts.reduce((x, y) => x + y.aedMo, 0), parts, source: 'model.opt', window: 'monthlyEstimate',
      tariff: { id: b.tariffId, version: b.tariffVersion, aedPerKwh: b.aedPerKwh, unit: 'AED/kWh', status: b.tariffStatus || null } };
  }
  const tariffText = (app, cb) => app.t('rpB.tariff', { id: cb.tariff.id, v: cb.tariff.version || '', rate: C().fmt(cb.tariff.aedPerKwh, 2), unit: cb.tariff.unit })
    + (cb.tariff.status === 'provisional' ? ' ' + app.t('rpB.prov') : '');
  function costBasisText(app, cb){
    const t = (k, v) => app.t(k, v), fmt = C().fmt, sep = t('cu.lblSep');
    const sum = cb.parts.length > 1
      ? t('cu.costSum', { list: cb.parts.map(x => t('cu.costPart', { asset: x.asset, aed: fmt(x.aedMo, 0) })).join(t('cu.costPlus')), aed: fmt(cb.aedMo, 0) })
      : t('cu.costOne', { asset: cb.parts[0].asset, aed: fmt(cb.aedMo, 0) });
    return [sum, t('rpSrc.modelOpt'), t('rpWin.monthlyEst'), tariffText(app, cb)].join(sep);
  }

  /* ------------------------ D150 — THE TIMELINE FEED ------------------------
     ONE BOX PER ITEM (client feedback, 21 September): every change is its own box
     in one format, hanging off a spine in time order — past boxes solid, the Now
     marker, then the scheduled boxes dashed. The box is EKO_C.pbox, the same
     block the asset panel uses: a header row (kind label · time), a title line,
     one short analysis line, and an action row only when an action is needed.
     Kinds: "Critical · action", "High · action", "Medium" (the alarm vocabulary),
     "Note" (work orders, sources, metrics, cleared alarms) and "Coming" (the
     look-ahead). The whole box opens what it concerns.

     ONE BOX PER ALARM: an alarm the window touched (raised, escalated past
     escalateAfterH, or acknowledged in it) is ONE box, placed at the LATEST of
     those moments inside the window, so a box sits at the same time whatever
     window it is read in. Every other change is one box per event (eventLog). */
  function feed(app, win){
    /* to the minute, so the payload is the same for every lens in a render (as recurrence, D144);
       a box also keeps its age in hours (agoH), which decides its ribbon segments exactly */
    const t = (k, v) => app.t(k, v), ar = app.lang === 'ar', h = win.gapH, now = Math.floor(Date.now() / 60000) * 60000, c = cfg();
    const at = hAgo => now - hAgo * 36e5;
    const assetOf = id => (app.data.assets || []).find(x => x.id === id);
    const out = [];
    (app.data.alarms || []).forEach(a => {
      const ev = [];
      if(a.ageH <= h) ev.push(['alarm', a.ageH]);
      if(!a.ack && a.ageH >= c.escalateAfterH && a.ageH - c.escalateAfterH <= h) ev.push(['escalated', a.ageH - c.escalateAfterH]);
      if(a.ack && a.ack.ageH != null && a.ack.ageH <= h) ev.push(['ack', a.ack.ageH]);
      if(!ev.length) return;
      const last = ev.sort((x, y) => x[1] - y[1])[0];
      const as = assetOf(a.asset), hasWo = !!((as && as.wos) || (app.state.woRaised || {})[a.asset]);
      const ackT = a.ack ? (a.ack.ageH != null ? hhmm(at(a.ack.ageH)) : (a.ack.time || '')) : '';
      const status = a.ack ? t(ackT ? 'cu.bx.acked' : 'cu.bx.ackedNoT', { who: personName(app, a.ack.who), t: ackT })
        : t(escalated(a) ? 'cu.bx.unackPast' : 'cu.bx.unack', { age: ageText(app, a.ageH), h: c.escalateAfterH });
      out.push({ key: 'al:' + a.id, type: last[0], at: at(last[1]), agoH: last[1], severity: a.sev, acknowledged: !!a.ack, action: !a.ack,
        alarm: a.id, asset: a.asset, title: t('cu.bx.alarm', { asset: a.asset, what: ar ? (a.plainAr || a.plainEn) : a.plainEn }), detail: status,
        actions: a.ack ? [] : [{ kind: 'ack', alarm: a.id }, hasWo ? { kind: 'openWo', asset: a.asset } : app.data.demo ? null : { kind: 'createWo', asset: a.asset }].filter(Boolean),
        link: { target: 'asset', asset: a.asset } });
    });
    const where = id => { const a = assetOf(id); return a && a.zone ? t('cu.bx.at', { asset: id, zone: ar ? (a.zoneAr || a.zone) : a.zone, floor: a.floor }) : id; };
    (app.data.eventLog || []).filter(e => e.h <= h).forEach(e => {
      const b = { key: 'ev:' + e.id, at: at(e.h), agoH: e.h, severity: null, acknowledged: false, action: false, actions: [] };
      if(e.kind === 'alarmCleared') out.push(Object.assign(b, { type: 'cleared', asset: e.asset, title: t('cu.bx.cleared', { asset: e.asset }),
        detail: ar ? (e.plainAr || e.plainEn) : e.plainEn, link: { target: 'asset', asset: e.asset } }));
      else if(/^wo/.test(e.kind)) out.push(Object.assign(b, { type: 'workOrder', woKind: e.kind, wo: e.wo, asset: e.asset,
        title: t('cu.bx.' + e.kind, { wo: e.wo, who: e.byEn ? personName(app, e.byEn) : '' }), detail: where(e.asset), link: { target: 'workOrder', asset: e.asset, wo: e.wo } }));
      else if(/^src/.test(e.kind)){ const as = assetOf(e.src);   /* D156: a source that IS an asset opens its panel, so the Brief stays */
        out.push(Object.assign(b, { type: 'source', srcKind: e.kind, src: e.src, asset: as ? as.id : null,
          title: t('cu.bx.' + e.kind, { name: ar ? (e.nameAr || e.nameEn) : e.nameEn }), detail: t('cu.bx.' + e.kind + 'D'),
          link: as ? { target: 'asset', asset: as.id } : { target: 'sources' } })); }
      else if(e.kind === 'targetCrossed'){
        /* the figure is read LIVE from metrics against THE limit the event names (D142) */
        const val = (app.data.metrics || {})[e.metric];
        const limv = (e.limit || '').split('.').reduce((o, k) => (o || {})[k], app.data);
        if(val != null && limv) out.push(Object.assign(b, { type: 'metric', metric: e.metric,
          title: t(e.labelKey, { v: C().fmt(val, 2), pct: C().fmt(val / limv * 100, 0) }),
          detail: t('cu.lensPeakEv', { v: C().fmt(val, 2), lim: C().fmt(limv, 1) }),
          counts: { metric: e.metric, value: val, limit: limv, pctOfTarget: val / limv * 100, dir: e.dir || 'above' },
          link: { target: 'page', page: e.page, module: e.module, sub: e.sub || '' } }));
      }
    });
    /* D161 — PROVED in the Brief: a verification that completed inside the window is a change
       ("CH-2 fix verified: …"); a fix that did NOT work is not a note but a problem, so it marks
       the alarm it failed on — which is already in "Needs you" — and re-raises it when the alarm
       had been cleared. */
    const PV = window.EKO_PROVE;
    if(PV) PV.verified(app).forEach(v => {
      if(v.verifiedH == null || v.verifiedH > h || v.outcome === 'tooEarly') return;
      const failed = v.outcome === 'notRecovered';
      const open = failed && (app.data.alarms || []).find(a => a.id === v.alarm && !a.ack);
      const fixLine = t('pv.notRecovLine', { point: v.point, v: C().fmt(v.afterMean, 1), u: v.unit });
      if(open){ const box = out.find(b => b.key === 'al:' + open.id);
        if(box){ box.detail = fixLine + t('cu.lblSep') + box.detail; box.proved = v.id; box.flag = t('pv.fixFailed'); return; } }
      out.push({ key: 'pv:' + v.id, type: 'verified', at: at(v.verifiedH), agoH: v.verifiedH,
        severity: failed ? (open ? open.sev : 'high') : null, acknowledged: false, action: !!failed,
        alarm: failed ? v.alarm : null, asset: v.asset, proved: v.id,
        title: failed ? t('pv.verifiedLine', { asset: v.asset, summary: fixLine })
                      : t('pv.verifiedLine', { asset: v.asset, summary: PV.summaryText(app, v) }),
        detail: v.methodText,
        actions: failed ? [{ kind: 'openWo', asset: v.asset }] : [],
        link: { target: 'asset', asset: v.asset } });
    });
    return out.sort((x, y) => (x.at - y.at) || (x.key < y.key ? -1 : 1));
  }
  /* the look-ahead's items as boxes: "Coming", dashed, their basis as the analysis line */
  const future = la => la ? la.items.map(x => ({ key: 'la:' + x.type + ':' + x.key, type: 'coming', sub: x.type, at: Date.parse(x.dueAt), time: x.time,
    severity: null, acknowledged: false, action: false, actions: [], title: x.text, detail: x.basis, link: x.link })) : [];

  /* ARCHIVE (D150). Archiving removes a box from THIS reader's Brief only: it never
     acknowledges an alarm, never closes a work order, never changes what anyone
     else sees. Per user per site, { boxKey: archivedAt }; recoverable from "Show
     archived" at the foot of the feed. Production keeps it with lastSeen on the
     server (handoff/brief.md §16); here it is localStorage, and a DEMO build forgets
     it on every load (D129 rule) so a demo never drifts. */
  /* D154 — WHERE THE READER PUT IT. The Brief places itself (beside the model, out of
     the panel's way); a reader who drags or resizes it overrides that, and the choice is
     kept per user per site. It is always clamped back into the window, so it can never be
     lost off-screen, and "Reset position" (the header control, or a double-click on the
     header) hands the placement back to the Brief. */
  const LSB = 'eko-brief-box-v1';
  const boxKey = () => LSB + ':' + me() + ':' + (E.data.nameEn || 'site');
  function boxLoad(){
    if(S.box && S.boxFor === boxKey()) return S.box;
    let b = null; try{ b = JSON.parse(ls.get(boxKey()) || 'null'); }catch(e){ b = null; }
    S.box = b && typeof b === 'object' && isFinite(b.l) && isFinite(b.t) ? b : null; S.boxFor = boxKey();
    return S.box;
  }
  const boxSave = () => { if(S.box) ls.set(boxKey(), JSON.stringify(S.box)); else ls.set(boxKey(), ''); };
  const LSA = 'eko-brief-archive-v1';
  const archKey = () => LSA + ':' + me() + ':' + (E.data.nameEn || 'site');
  function archLoad(){
    if(S.arch && S.archFor === archKey()) return S.arch;
    let m = null; try{ m = JSON.parse(ls.get(archKey()) || 'null'); }catch(e){ m = null; }
    S.arch = m && typeof m === 'object' && !Array.isArray(m) ? m : {}; S.archFor = archKey();
    return S.arch;
  }
  const archSave = () => ls.set(archKey(), JSON.stringify(S.arch || {}));

  /* THE RIBBON'S SEGMENTS: the last 24 hours and the primary window (since your last
     visit, or since shift start when the Brief opened for a handover) before Now, the
     look-ahead after it. A segment is a range of the ONE timeline: selecting it
     scrolls to and highlights its boxes, never hides the others. */
  const segsOf = (b, win) => b.type === 'coming' ? ['next'] : ['h24'].concat(b.agoH <= win.gapH ? [win.kind] : []);
  const inWin = (b, win) => b.agoH <= win.gapH;

  /* what was read, over which window, against what — one short muted line */
  function sources(app, d, boxes){
    const E2 = app, t = (k, v) => E2.t(k, v);
    const read = ['alarms'];
    if(d.woLate.length || (E2.data.eventLog || []).some(e => /^wo/.test(e.kind))) read.push('cmms');
    if(d.srcOff.length || d.srcStale.length) read.push('heartbeat');
    if(boxes.some(b => b.type === 'metric' && inWin(b, d.win))) read.push('metrics');
    const lbl = { alarms: 'cu.srcAlarms', cmms: 'cu.srcCmms', heartbeat: 'cu.srcConn', metrics: 'cu.srcMetrics' };
    const basis = { visit: 'cu.basisVisit', shift: 'cu.basisShift', h8: 'cu.basisFixed', h24: 'cu.basisFixed' }[d.win.kind];
    const cb = costBasis(E2, d.raised.filter(a => !a.ack));
    /* D160: the line itself stays short enough to READ on one line; the cost basis (which is
       what made it overrun) is kept in the full text, which the tooltip always carries */
    /* short enough to READ on one line at the board's width: what was read, over which clock
       range. The window's name, the basis and the cost basis are in the full text (the tooltip). */
    const lineShort = t('cu.sourcesShort', { list: read.map(k => t(lbl[k])).join(' · '), from: stamp(E2, d.win.atMs), to: hhmm(Date.now()) });
    const line = lineShort + (cb ? t('cu.lblSep') + t('cu.srcCost', { model: t('rpSrc.modelOpt'), tariff: tariffText(E2, cb) }) : '');
    return { read, line, lineShort };
  }

  /* sources that were not reporting for part of the window: the Brief says the
     window may be incomplete and NAMES them, rather than a confident delta */
  function incomplete(app){
    const E2 = app;
    if(!(E2.state.offline || E2.state.degraded || E2.state.stale)) return [];
    const down = (E2.data.integrations || []).filter(i => !/^live$/i.test(i.st || '')).map(i => i.name);
    const stale = (E2.data.assets || []).filter(a => a.st === 'stale').map(a => a.id);
    return down.concat(stale).slice(0, 3);
  }

  /* ------------------------------ memory (D141) -----------------------------
     The Brief remembers what it recommended: { id, subject:{kind,id}, asset,
     reason, issuedAt, issuedTo:{user,role}, resolution }. Before each new
     recommendation it looks back: at most ONE continuity line — the OLDEST
     unresolved earlier recommendation, or, when none is open, the most recent
     one that has been resolved, said once (for the visit it is first shown in).
     THE RESOLUTION RULE: a recommendation is resolved when its alarm is
     acknowledged or cleared, its work order is closed, or its source recovers.
     It is always derived from the live data, never set by hand. Per user by
     default; a person with the canSeeTeamBrief permission sees the team's. Production
     keeps the store server-side (handoff/brief.md); here it is localStorage,
     re-seeded from data.briefHistory on every load of a DEMO build so a demo
     never drifts. */
  const LSM = 'eko-brief-recos-v1';
  const memKey = () => LSM + ':' + (E.data.nameEn || 'site');
  const me = () => (E.data.user || {}).name || 'user';
  function memLoad(){
    if(S.mem) return S.mem;
    let m = null; try{ m = JSON.parse(ls.get(memKey()) || 'null'); }catch(e){ m = null; }
    const now0 = Date.now();   /* D173: one clock reading for the whole seed, so records of equal age stay equal */
    if(!Array.isArray(m) || demo()) m = (E.data.briefHistory || []).map(r => Object.assign({}, r, { reason: r.reasonEn || null, issuedAt: now0 - r.issuedH * 36e5, state: 'open', resolution: null }));
    S.mem = m; return m;
  }
  const memSave = () => ls.set(memKey(), JSON.stringify(S.mem || []));
  /* record a recommendation the moment a Brief shows it (one open record per subject per user) */
  function issue(app, reco){
    if(!reco || !reco.subject) return;
    const m = memLoad(), u = me();
    const same = r => r.subject.kind === reco.subject.kind && r.subject.id === reco.subject.id && r.issuedTo.user === u && !resolution(app, r);
    if(m.some(same)) return;
    m.push({ id: 'rec-' + Date.now().toString(36), subject: reco.subject, asset: reco.asset, reason: reco.text,
             issuedAt: Date.now(), issuedTo: { user: u, role: app.role() }, state: 'open', resolution: null });
    memSave();
  }
  /* derived from the live data: { how, who, at, wo } or null */
  function resolution(app, r, now = Date.now()){   /* D173: the caller passes one clock reading for a whole pass */
    const log = app.data.eventLog || [], k = r.subject.kind, id = r.subject.id;
    if(k === 'alarm'){
      const a = (app.data.alarms || []).find(x => x.id === id);
      if(!a){ const ev = log.find(e => e.kind === 'alarmCleared' && e.asset === r.asset); return { how: 'cleared', at: ev ? now - ev.h * 36e5 : null }; }
      if(a.ack) return { how: 'acked', who: a.ack.who, at: a.ack.ageH != null ? now - a.ack.ageH * 36e5 : null };
      return null;
    }
    if(k === 'wo'){ const ev = log.find(e => e.kind === 'woCompleted' && e.wo === id); return ev ? { how: 'closed', wo: id, at: now - ev.h * 36e5 } : null; }
    if(k === 'source'){ const ev = log.find(e => e.kind === 'srcRecovered' && e.src === id); return ev ? { how: 'recovered', at: now - ev.h * 36e5 } : null; }
    return null;
  }
  /* "Yesterday's Brief", "An earlier Brief today", "The Brief 3 days ago" */
  function whenOf(app, ms, noun){
    const d0 = new Date(); d0.setHours(0, 0, 0, 0);
    const days = Math.ceil((d0.getTime() - ms) / 864e5);
    const base = noun === 'rec' ? 'cu.recWhen' : 'cu.brWhen';
    return days <= 0 ? app.t(base + '.today') : days === 1 ? app.t(base + '.yday') : app.t(base + 'D', { n: days });
  }
  const ageText = (app, h) => h < 48 ? app.t('cu.ageH', { n: Math.max(1, Math.round(h)) }) : app.t('cu.ageD', { n: Math.round(h / 24) });
  /* a person's name in the reader's language (the site's people: data.demoUsers in the prototype, the user directory in production) */
  const personName = (app, u) => app.person ? app.person(u) : u;   /* D146: the one person-name rule (app.js person()) */
  function continuity(app){
    if(!S.loadAt) return null;
    const team = app.can ? app.can('canSeeTeamBrief') : false, u = me();   /* D142: a permission, not a role */
    const prior = memLoad().filter(r => r.issuedAt < S.loadAt && (team || r.issuedTo.user === u));
    let dirty = false;
    const now = Date.now();   /* D173: one clock reading, so two resolutions of equal age compare equal (it was read per record, and a millisecond tick between two reads reordered them) */
    const withRes = prior.map(r => { const res = resolution(app, r, now); if(res && !r.resolution){ r.resolution = res; dirty = true; }
      const st = res ? 'resolved' : 'open'; if(r.state !== st){ r.state = st; dirty = true; } return { r, res }; });
    const byId = (a, b) => (a.r.id < b.r.id ? -1 : a.r.id > b.r.id ? 1 : 0);   /* D173: every sort ends in a deterministic tiebreaker */
    const open = withRes.filter(x => !x.res).sort((a, b) => (a.r.issuedAt - b.r.issuedAt) || byId(a, b))[0];
    let out = null;
    if(open){
      const r = open.r, a = r.subject.kind === 'alarm' ? (app.data.alarms || []).find(x => x.id === r.subject.id) : null;
      const age = ageText(app, a ? a.ageH : (Date.now() - r.issuedAt) / 36e5);
      const mine = r.issuedTo.user === u;
      out = { kind: 'open', rec: r.id, asset: r.asset, issuedAt: new Date(r.issuedAt).toISOString(), issuedTo: r.issuedTo,
        text: app.t(mine ? 'cu.contOpen' : 'cu.contOpenTeam', { when: whenOf(app, r.issuedAt, 'brief'), who: personName(app, r.issuedTo.user), asset: r.asset, age }),
        link: { target: 'asset', asset: r.asset } };
    } else {
      const done = withRes.filter(x => x.res && (!x.r.reportedIn || x.r.reportedIn === S.loadAt)).sort((a, b) => ((b.res.at || 0) - (a.res.at || 0)) || (b.r.issuedAt - a.r.issuedAt) || byId(a, b))[0];   /* ties: the more recently issued recommendation, then its id */
      if(done){
        const r = done.r, res = done.res;
        if(!r.reportedIn){ r.reportedIn = S.loadAt; dirty = true; }
        const K = { acked: 'cu.contAcked', cleared: 'cu.contCleared', closed: 'cu.contClosed', recovered: 'cu.contRecovered' }[res.how];
        out = { kind: 'resolved', rec: r.id, asset: r.asset, issuedAt: new Date(r.issuedAt).toISOString(), issuedTo: r.issuedTo,
          resolution: { how: res.how, by: res.who || null, at: res.at ? new Date(res.at).toISOString() : null },
          text: app.t(K, { when: whenOf(app, r.issuedAt, 'rec'), asset: r.asset, who: res.who ? personName(app, res.who) : '', t: res.at ? hhmm(res.at) : '', wo: res.wo || '' }),
          link: { target: 'asset', asset: r.asset } };
      }
    }
    if(dirty) memSave();
    return out;
  }

  /* ----------------------------- look-ahead (D141) ---------------------------
     "Next 8 hours": ONLY what the data already holds — PM tasks and work orders
     falling due (CMMS), maintenance windows, warranty expiries (assets[].wtyEnd),
     the demand forecast against the contracted limit with its stated basis, and
     the water tank reaching its refill threshold by the autonomy calculation.
     Never a prediction the platform cannot support. Every item states its basis.
     No source for the site → no section at all, never an empty one. */
  function lookahead(app){
    const t = (k, v) => app.t(k, v), ar = app.lang === 'ar', H = cfg().lookaheadH || 8, now = Date.now(), end = now + H * 36e5;
    const la = app.data.lookahead || null, srcs = [], items = [];
    const at = h => now + h * 36e5;
    const clock = ms => new Date(ms).toDateString() === new Date().toDateString() ? hhmm(ms) : t('cu.tmrw', { t: hhmm(ms) });
    const inWin = ms => ms >= now && ms <= end;
    if(la && la.pm){ srcs.push('pm');
      la.pm.forEach(x => { const ms = at(x.dueH); if(inWin(ms)) items.push({ type: 'pm', key: x.id, at: ms, text: t('cu.laPm', { id: x.id, task: ar ? (x.taskAr || x.taskEn) : x.taskEn, asset: x.asset }), basis: t('cu.laBasisPm'), link: { target: 'asset', asset: x.asset } }); }); }
    if(la && la.woDue){ srcs.push('wo');
      la.woDue.forEach(x => { const ms = at(x.dueH); if(inWin(ms)) items.push({ type: 'wo', key: x.wo, at: ms, text: t('cu.laWo', { wo: x.wo, asset: x.asset }), basis: t('cu.laBasisWo'), link: { target: 'asset', asset: x.asset } }); }); }
    if(la && la.events){ srcs.push('events');
      la.events.forEach(x => { const ms = at(x.startH); if(inWin(ms)) items.push({ type: 'event', key: x.id, at: ms, text: t('cu.laMw', { title: ar ? (x.titleAr || x.titleEn) : x.titleEn, asset: x.asset, to: clock(at(x.endH)) }), basis: t('cu.laBasisMw'), link: { target: 'asset', asset: x.asset } }); }); }
    const wty = (app.data.assets || []).filter(a => a.wtyEnd);
    if(wty.length){ srcs.push('warranty');
      wty.forEach(a => { const ms = new Date(a.wtyEnd + 'T23:59:00').getTime(); if(inWin(ms)) items.push({ type: 'warranty', key: 'wty-' + a.id, at: ms, text: t('cu.laWty', { asset: a.id }), basis: t('cu.laBasisWty'), link: { target: 'asset', asset: a.id } }); }); }
    const df = la && la.demandForecast, lim = ((app.limit && app.limit()) || {}).mw;   /* D170: a contract or a design capacity */
    if(df && lim && (df.hourlyMw || []).length){ srcs.push('demand');
      const steps = df.hourlyMw.slice(0, Math.floor(H / (df.stepH || 1)));
      let i = 0; steps.forEach((v, j) => { if(v > steps[i]) i = j; });
      const d = new Date(now + (i + 1) * (df.stepH || 1) * 36e5); d.setMinutes(0, 0, 0);
      items.push({ type: 'demand', key: 'demand', at: d.getTime(), pct: Math.round(steps[i] / lim * 100),
        text: t(app.lk ? app.lk('cu.laPeak') : 'cu.laPeak', { v: C().fmt(steps[i], 2), pct: C().fmt(steps[i] / lim * 100, 0), lim: C().fmt(lim, 2) }),
        basis: t('cu.laBasisPeak', { m: ar ? (df.basisAr || df.basisEn) : df.basisEn }), link: { target: 'page', page: 'power', module: 'energy', sub: 'power' } }); }
    const w = app.data.water;
    if(w && w.tankVolumeM3 != null && w.tankCapacityM3 && w.meterAvgM3Day){ srcs.push('tank');
      const floor = w.tankCapacityM3 * (w.refillThresholdPct || 0) / 100;
      const hrs = (w.tankVolumeM3 - floor) / (w.meterAvgM3Day / 24), ms = now + hrs * 36e5;
      if(inWin(ms)) items.push({ type: 'tank', key: 'tank', at: ms, text: t('cu.laTank', { th: C().fmt(w.refillThresholdPct, 0) }),
        basis: t('cu.laBasisTank', { v: C().fmt(w.tankVolumeM3, 0), r: C().fmt(w.meterAvgM3Day, 1) }), link: { target: 'page', page: 'water', module: 'utilities', sub: 'water' } }); }
    if(!srcs.length) return null;
    items.sort((a, b) => a.at - b.at);
    return { hours: H, sources: srcs, items: items.map(x => ({ type: x.type, key: x.key, time: clock(x.at), text: x.text, basis: x.basis, dueAt: new Date(x.at).toISOString(), link: x.link, pct: x.pct != null ? x.pct : null })) };
  }

  /* ----------------------------- recurrence (D144) --------------------------
     A REPEATING PATTERN over the lookback (brief.recurrence.lookbackD, default 30
     days): the same asset raising the same alarm type minCount (3) times or more.
     The pattern must be live — an alarm of that type is open on that asset now.
     AT MOST ONE line: the most occurrences, then the highest effective severity of
     the open alarm, then the most recent. The CONDITION clause ("each after a
     high-load afternoon") is said only when EVERY occurrence carries the condition
     in the data (the site demand before the fault at or above highLoadMw, inside
     the afternoon hours); otherwise the line states only the count. Production
     reads the event store, which must retain the lookback (handoff/brief.md §13). */
  function recurrence(app){
    const H = app.data.alarmHistory, rc = cfg().recurrence;
    if(!H || !rc) return null;
    const t = (k, v) => app.t(k, v), ar = app.lang === 'ar', lb = rc.lookbackD || 30, min = rc.minCount || 3;
    const groups = {};
    (H.events || []).filter(e => e.agoH <= lb * 24).forEach(e => { const k = e.asset + '|' + e.type; (groups[k] = groups[k] || []).push(e); });
    const cands = Object.keys(groups).map(k => {
      const [asset, type] = k.split('|'), occ = groups[k].slice().sort((a, b) => a.agoH - b.agoH);
      return { asset, type, occ, al: (app.data.alarms || []).find(a => a.asset === asset && a.type === type) };
    }).filter(c => c.occ.length >= min && c.al);
    if(!cands.length) return null;
    cands.sort((x, y) => (y.occ.length - x.occ.length) || (effSev(y.al) - effSev(x.al)) || (x.occ[0].agoH - y.occ[0].agoH));
    const c = cands[0], n = c.occ.length;
    const hi = e => e.loadMw != null && e.hour != null && e.loadMw >= rc.highLoadMw && e.hour >= rc.afternoonFrom && e.hour < rc.afternoonTo;
    const cond = c.occ.every(hi) ? 'highLoadAfternoon' : null;
    const w = (H.types || {})[c.type] || {}, what = ar ? (w.ar || w.en || c.type) : (w.en || c.type);
    const ordKey = 'cu.ord.' + n, ord = t(ordKey), P = { ord, n, d: lb, asset: c.asset, what, cond: cond ? t('cu.recurCond.' + cond) : '' };
    const text = t((ord !== ordKey ? 'cu.recur' : 'cu.recurN') + (cond ? 'Why' : ''), P);
    const base = Math.floor(Date.now() / 60000) * 60000;   /* to the minute, so the payload is the same for every lens in a render */
    const day = ms => new Date(ms).toLocaleDateString(ar ? 'ar-AE' : 'en-GB', { day: 'numeric', month: 'short' });
    const evidence = t('cu.recurEv', { list: c.occ.map(e => t('cu.recurOccShort', { d: day(Date.now() - e.agoH * 36e5), h: String(e.hour).padStart(2, '0'), mw: e.loadMw != null ? C().fmt(e.loadMw, 2) : t('emptyDash') })).join(t('cu.join')) });
    const tip = c.occ.map(e => t('cu.recurOcc', { d: day(Date.now() - e.agoH * 36e5), h: String(e.hour).padStart(2, '0'), mw: e.loadMw != null ? C().fmt(e.loadMw, 2) : t('emptyDash') })).join('\n');
    return { asset: c.asset, type: c.type, alarm: c.al.id, count: n, lookbackD: lb,
      occurrences: c.occ.map(e => ({ at: new Date(base - e.agoH * 36e5).toISOString(), hour: e.hour, loadMw: e.loadMw != null ? e.loadMw : null })),
      condition: cond ? { kind: cond, highLoadMw: rc.highLoadMw, fromHour: rc.afternoonFrom, toHour: rc.afternoonTo } : null,
      text, evidence, tip, standIn: !!H.standIn, link: { target: 'asset', asset: c.asset } };
  }

  /* --------------------------- affirmative calm (D144) -----------------------
     When NOTHING needs attention — no recommendation, no alarm open and
     unacknowledged anywhere on the site, and no handover waiting for you — the Brief says so positively, with its
     evidence: the share of points reporting (integrations[].pointsTotal /
     pointsStale, from the heartbeat) and every source up. Below
     brief.calm.coverageMinPct it must NOT say quiet: it names what did not report.
     No coverage data at all: it says nothing needs you, and that it cannot vouch
     for every system. */
  function coverage(app){
    const ints = (app.data.integrations || []).filter(i => i.pointsTotal);
    if(!ints.length) return null;
    const total = ints.reduce((x, i) => x + i.pointsTotal, 0), stale = ints.reduce((x, i) => x + (i.pointsStale || 0), 0);
    return { total, reporting: total - stale, pct: Math.floor((total - stale) / total * 100), missingPct: Math.round(stale / total * 100),
      gaps: ints.filter(i => i.pointsStale).map(i => ({ name: i.name, stale: i.pointsStale, total: i.pointsTotal })) };
  }
  function calm(app, d, reco){
    if(reco || (app.data.alarms || []).some(a => !a.ack)) return null;
    if(window.EKO_HO && window.EKO_HO.pending(app)) return null;   /* a handover waiting to be received needs you */
    const t = (k, v) => app.t(k, v), fmt = C().fmt, min = (cfg().calm || {}).coverageMinPct != null ? cfg().calm.coverageMinPct : 95;
    const cov = coverage(app), down = incomplete(app).concat([...d.srcOff, ...d.srcStale].map(e => app.lang === 'ar' ? (e.nameAr || e.nameEn) : e.nameEn));
    const hr = new Date(d.win.atMs).getHours();
    const period = hr >= 22 || hr < 5 ? 'night' : hr < 12 ? 'morning' : hr < 18 ? 'afternoon' : 'evening';
    if(!cov) return { kind: 'unknown', coverage: null, text: t('cu.calmUnknown') };
    if(cov.pct >= min && !down.length)
      return { kind: 'quiet', coverage: cov, threshold: min, text: t('cu.calmQuiet', { period: t('cu.period.' + period), pct: cov.pct }) };
    const list = cov.gaps.map(g => t('cu.calmGap', { name: g.name, n: fmt(g.stale, 0), total: fmt(g.total, 0) })).concat(down);
    return { kind: 'gaps', coverage: cov, threshold: min, sources: list,
      text: t('cu.calmGaps', { pct: Math.max(1, cov.missingPct), list: list.join(t('cu.join')) }) };
  }

  /* ------------------------------ lenses (D143) -----------------------------
     ONE computed delta, three narrations, by the reader's role (EKO.role(); the
     demo's Preview as role switches it). The items, their counts, the sources,
     the continuity line and the look-ahead are IDENTICAL across lenses; only the
     ORDER of the items, the EMPHASIS line under an item, the LEAD the headline is
     written from, and the recommendation's WORDING differ.
       technician — what to do and where: location first, plain language, the
                    recommended action with its route
       engineer   — why: the evidence behind each change — its technical line,
                    shown by default, and the asset's 7-day trend where it has one
       executive  — impact: cost where a basis exists (the alarm's stated
                    impactAedMo), risk (criticals, life safety, the contract
                    limit), compliance (PM), this period against the previous one;
                    no equipment detail unless it drives cost or risk */
  const LENSES = ['technician', 'engineer', 'executive'];
  const lensOf = app => { const r = app.role ? app.role() : 'technician'; return LENSES.includes(r) ? r : ({ security: 'technician', manager: 'engineer' }[r] || 'technician'); };   /* E13: the new roles read with the nearest lens */
  function trendOf(app, assetId){
    const a = (app.data.assets || []).find(x => x.id === assetId), tr = a && a.trend7;
    if(!tr || !tr.vals || tr.vals.length < 2 || tr.unit === '%') return null;
    const v0 = tr.vals[0], v1 = tr.vals[tr.vals.length - 1], d = C().fmt;
    const k = Math.abs(v1 - v0) < Math.abs(v0) * 0.05 ? 'cu.lensTrendFlat' : v1 > v0 ? 'cu.lensTrendUp' : 'cu.lensTrendDown';
    return app.t(k, { point: tr.point, a: d(v0, 1), b: d(v1, 1), u: tr.unit, n: tr.vals.length });
  }
  function lensView(app, d, reco, rec, calmv, boxes){
    const t = (k, v) => app.t(k, v), ar = app.lang === 'ar', lens = lensOf(app), fmt = C().fmt, sep = t('cu.lblSep');
    const loc = a => a ? (ar ? (a.locAr || a.locEn) : a.locEn) : null;
    const place = id => { const a = (app.data.assets || []).find(x => x.id === id); return a && a.zone ? t('cu.lensAt', { zone: ar ? (a.zoneAr || a.zone) : a.zone, floor: a.floor }) : null; };
    const alarmOf = id => (app.data.alarms || []).find(a => a.id === id) || null;
    const top = reco && reco.type === 'alarm' ? alarmOf(reco.subject.id) : null;
    const tech = a => a ? (ar ? (a.techAr || a.techEn) : a.techEn) : null;
    const emphasis = {}, tips = {};
    let costs = null;
    /* D150: the feed is ONE timeline, so the order is time in every lens; the lens
       keeps what it always owned — the analysis line under each box, the lead the
       headline is written from, and the recommendation's wording */
    const order = boxes.map(b => b.key);
    const winB = boxes.filter(b => inWin(b, d.win));
    let lead = reco ? reco.lead : (winB.length ? winB[winB.length - 1].title : null);
    let recommendation = reco ? reco.text : null;

    if(lens === 'technician'){
      /* where first: every box that concerns a place says it */
      boxes.forEach(b => { const a = b.alarm && alarmOf(b.alarm);
        if(a && loc(a)) emphasis[b.key] = loc(a) + sep + b.detail;
        else if(b.type === 'workOrder' && place(b.asset)) emphasis[b.key] = b.asset + sep + place(b.asset); });
      if(top){ lead = t('cu.leadTech', { where: loc(top), asset: top.asset, what: plain(app, top) }); recommendation = t('cu.recoTech', { where: loc(top), reco: reco.text }); }
      else if(reco && reco.type === 'workOrder' && place(reco.asset)) recommendation = t('cu.recoTech', { where: place(reco.asset), reco: reco.text });
    }
    if(lens === 'engineer'){
      /* evidence first: the technical line, the 7-day trend in the box's tooltip */
      boxes.forEach(b => { const a = b.alarm && alarmOf(b.alarm);
        if(a && tech(a)){ emphasis[b.key] = tech(a) + sep + b.detail; const tr = trendOf(app, a.asset); if(tr) tips[b.key] = tr; } });
      if(top){ lead = t('cu.leadEng', { asset: top.asset, tech: tech(top), what: plain(app, top) }); recommendation = t('cu.recoEng', { reco: reco.text, tech: tech(top) }); }
    }
    if(lens === 'executive'){
      const h = d.win.gapH, als = app.data.alarms || [];
      const open = d.raised.filter(a => !a.ack);
      costs = costBasis(app, open);
      const cost = costs ? costs.aedMo : 0, costTip = costs ? costBasisText(app, costs) : null;
      const crit = open.filter(a => a.sev === 'critical').length;
      const prev = als.filter(a => a.ageH > h && a.ageH <= 2 * h).length;
      const tgt = boxes.find(b => b.type === 'metric' && inWin(b, d.win));
      const site = ((window.EKO_DATA || {}).estate || { sites: [] }).sites.find(s => s.key === app.data.key || s.nameEn === app.data.nameEn);   /* D169: by key (Demo Data Centre is the dc-auh1 row) */
      /* impact first: each alarm's stated cost (its basis in the tooltip), else the risk */
      boxes.forEach(b => {
        const a = b.alarm && alarmOf(b.alarm), as = b.asset && (app.data.assets || []).find(x => x.id === b.asset);
        if(a && a.impactAedMo && !a.ack){ const cb = costBasis(app, [a]); emphasis[b.key] = t(cb.tariff.status === 'provisional' ? 'cu.lensCostProv' : 'cu.lensCost', { aed: fmt(a.impactAedMo, 0) }); tips[b.key] = costBasisText(app, cb); }
        else if(a && as && (as.tags || []).includes('life-safety')) emphasis[b.key] = t('cu.lensLife') + sep + b.detail;
        else if(b.type === 'metric') emphasis[b.key] = t('cu.lensPenalty');
        else if(b.type === 'workOrder' && b.woKind === 'woOverdue' && site && site.pmDue) emphasis[b.key] = t('cu.lensPm', { done: site.pmDone, due: site.pmDue, pct: fmt(site.pmDone / site.pmDue * 100, 0) });
      });
      /* this period against the one before: the primary segment's tooltip (never a box) */
      tips.segment = t('cu.lensPeriod', { n: d.raised.length, prev, h: Math.round(h) }) + (crit ? sep + t('cu.lensCrit', { n: crit }) : '');
      /* the lead names equipment only when it carries cost or risk */
      const parts = [];
      if(crit || cost) parts.push(crit ? t(cost ? 'cu.leadExecCritCost' : 'cu.leadExecCrit', { n: crit, aed: fmt(cost, 0) }) : t('cu.leadExecCost', { aed: fmt(cost, 0) }));
      if(tgt && tgt.counts) parts.push(t('cu.leadExecPeak', { pct: fmt(tgt.counts.pctOfTarget, 0) }));
      lead = parts.length ? parts.join(t('cu.leadSep')) : t('cu.leadExecQuiet');
      if(cost) tips.lead = costTip;
      if(top) recommendation = top.impactAedMo ? t('cu.recoExecCost', { asset: top.asset, sev: t('rpSev.' + top.sev), aed: fmt(top.impactAedMo, 0) })
                                               : t('cu.recoExec', { reco: reco.text });
      if(top && top.impactAedMo) tips.recommendation = costBasisText(app, costBasis(app, [top]));
    }
    /* D144: recurrence has priority in the ENGINEER lens — first above the feed,
       and the lead the headline is written from opens with it */
    if(lens === 'engineer' && rec) lead = rec.text;
    /* D144: nothing needs you — the calm sentence is the lead in every lens */
    if(calmv){ lead = calmv.text; recommendation = null; }
    /* E13: the persona's Brief: its own items (at most three) and the one sentence that names them (js/personas.js) */
    const PER = window.EKO_PERSONA, personaItems = PER ? PER.briefItems(app) : null;
    if(PER) lead = PER.briefLead(app, personaItems);   /* the recommendation stays (the contract); the persona's Brief shows the items instead */
    return { lens, order, emphasis, lead, recommendation, tips, costBasis: costs, recurrenceFirst: lens === 'engineer' && !!rec, personaItems };
  }

  /* -------------------------------- payload -------------------------------- */
  /* EXACTLY the shape the production endpoint returns (handoff/brief.md,
     data-contracts.md §6c). The card renders from this and nothing else.
     D150: `window` is the PRIMARY window (the headline, the recommendation and the
     sources line are written for it); `items` are the past boxes of the whole
     feed (the last 24 hours, or the primary window if longer), each with the
     ribbon segments it belongs to; `lookahead.items` are the future boxes;
     `segments` carry the ribbon's counts. Archived boxes are left out of all of
     them (and listed, for "Show archived"). */
  function payload(app, win){
    const fw = fixed('h24', Math.max(24, win.gapH));
    const arch = archLoad(), isA = k => !!arch[k];
    const all = feed(app, fw);
    const laAll = lookahead(app), futAll = future(laAll);
    const d = deltas(app, win);
    /* the recommendation ranks only what this reader has not archived */
    const dr = Object.assign({}, d, { raised: d.raised.filter(a => !isA('al:' + a.id)), crossed: d.crossed.filter(a => !isA('al:' + a.id)),
      woLate: d.woLate.filter(e => !isA('ev:' + e.id)), srcOff: d.srcOff.filter(e => !isA('ev:' + e.id)) });
    const past = all.filter(b => !isA(b.key));
    const reco = past.some(b => inWin(b, win)) ? recommend(app, dr) : null;
    const pinKey = !reco ? null : reco.subject.kind === 'alarm' ? 'al:' + reco.subject.id
      : ((past.find(b => (reco.subject.kind === 'wo' && b.wo === reco.subject.id && b.woKind === 'woOverdue') || (reco.subject.kind === 'source' && b.src === reco.subject.id && b.srcKind === 'srcOffline')) || {}).key || null);
    const rec = recurrence(app), calmv = calm(app, d, reco);
    const src = sources(app, d, past);
    const inc = incomplete(app);
    const lastSeen = S.visit ? new Date(S.visit.atMs).toISOString() : null;
    const box = b => ({ type: b.type, key: b.key, severity: b.severity || null, acknowledged: !!b.acknowledged, action: !!b.action,
      at: new Date(b.at).toISOString(), title: b.title, detail: b.detail, actions: b.actions, link: b.link, segments: segsOf(b, win),
      pinned: b.key === pinKey, alarm: b.alarm || null, asset: b.asset || null, wo: b.wo || null, counts: b.counts || null,
      flag: b.flag || null, proved: b.proved || null });
    const la = laAll ? Object.assign({}, laAll, { items: laAll.items.filter((x, i) => !isA(futAll[i].key)).map(x => Object.assign({}, x, { key: 'la:' + x.type + ':' + x.key })) }) : null;
    const items = past.map(box);
    const p = {
      site: app.data.id || app.data.nameEn,
      window: { kind: win.kind, from: new Date(win.atMs).toISOString(), to: new Date().toISOString(),
        hours: Math.round(win.gapH * 100) / 100, capped: !!win.capped, absenceHours: win.capped ? Math.round(win.absenceH * 100) / 100 : null },
      feedWindow: { from: new Date(fw.atMs).toISOString(), hours: fw.gapH },
      lastSeen,
      items,
      /* D150: the ribbon — the counts are the boxes each segment holds */
      segments: [{ kind: 'h24', hours: fw.gapH, count: items.length },
                 { kind: win.kind, from: new Date(win.atMs).toISOString(), count: items.filter(b => b.segments.includes(win.kind)).length },
                 { kind: 'next', hours: laAll ? laAll.hours : (cfg().lookaheadH || 8), count: la ? la.items.length : 0 }].filter((s, i) => !(i === 1 && s.kind === 'h24')),
      archived: all.concat(futAll).filter(b => isA(b.key)).map(b => ({ key: b.key, type: b.type, title: b.title, at: new Date(b.at).toISOString(), archivedAt: new Date(arch[b.key]).toISOString() })),
      /* the top-ranked change stated plainly: the model's input for the headline,
         and the headline itself when no model answers */
      lead: reco ? reco.lead : ((past.filter(b => inWin(b, win)).slice(-1)[0] || {}).title || null),
      recommendation: reco ? { type: reco.type, asset: reco.asset, subject: reco.subject, text: reco.text, rank: reco.rank, link: reco.link, box: pinKey } : null,
      /* D143: the reader's lens — the EMPHASIS, lead and wording; never the items */
      lens: lensOf(app),
      view: lensView(app, d, reco, rec, calmv, past),
      /* D141: before the new recommendation, what became of an earlier one; and what is coming */
      continuity: continuity(app),
      lookahead: la,
      /* D144: at most one recurring pattern; the calm verdict when nothing needs you;
         the handover addressed to this site and shift (js/handover.js) */
      recurrence: rec,
      calm: calmv,
      handover: window.EKO_HO ? window.EKO_HO.forBrief(app) : null,
      /* D161: what is coming (a reading projected to its limit), what waiting has cost so far,
         and what the fixes have returned — each computed by EKO_PROVE, never by the model */
      predicted: predicted(app), ledger: ledgerFor(app), rollup: window.EKO_PROVE ? window.EKO_PROVE.rollup(app) : null,
      sources: { read: src.read, line: src.line, lineShort: src.lineShort, incomplete: inc, windowIncomplete: inc.length > 0 },
      narration: null, narrationAvailable: false
    };
    /* E14c: the Brief's four sections, and the sentence that summarises them (the model may only reword it) */
    p.view.sections = sections14(app, p);
    if(p.view.personaItems) p.view.lead = lead14(app, p.view.sections, p.handover);
    const n = NARR.get(hashOf(app, p));
    if(n && (n.status === 'ok' || n.status === 'regenerated')){
      p.narration = { headline: n.headline, recommendation: n.reco || (reco ? reco.text : null), status: n.status };
      p.narrationAvailable = true;
    }
    return p;
  }

  /* D161 — the forward warnings the Brief shows: a reading whose projected crossing falls
     inside prove.predict.warnWithinD. Inside the look-ahead window it belongs to "Due in the
     next 8 h"; further out it is a warning in "Needs you". */
  /* E3: the forecast peak over the contract is a forward warning too, linked to the Forecasting page */
  /* E8: the forecast sentence, the same as the Forecasting headline, when the month is over its budget */
  function fcPeak(app){
    const P = window.EKO_EP && window.EKO_EP.energyInsight && window.EKO_EP.energyInsight(app); if(!P || P.state !== 'over') return [];
    return [{ key: 'fc:energy', asset: P.a || null, days: null, soon: false, title: P.first.replace(/\.$/, '') + (window.EKO_EP.budgetRule && window.EKO_EP.budgetRule(app) ? '. ' + window.EKO_EP.budgetRule(app).replace(/\.$/, '') : ''), detail: P.second.replace(/\.$/, ''), tip:   /* E11: the budget rule where the budget figure is */ app.t('cu.fcEnergyTip'),
      link: { target: 'page', page: 'fcst', module: 'energy', sub: 'fcst' } }];
  }
  function predicted(app){ return predictedPv(app).concat(fcPeak(app)); }
  function predictedPv(app){
    const PV = window.EKO_PROVE; if(!PV) return [];
    const c = PV.cfg(app).predict, laH = cfg().lookaheadH || 8;
    return PV.predictions(app).filter(p => p.state === 'drift' && p.days <= (c.warnWithinD || 14))
      .map(p => ({ key: 'pd:' + p.asset + ':' + p.point, asset: p.asset, days: p.days, soon: p.days * 24 <= laH,
        title: p.asset + app.t('cu.lblSep') + app.t('pv.predictLine', { point: p.point, range: app.t('pv.inDaysRange', { n: Math.round(p.days), lo: p.daysLo, hi: p.daysHi }) }),
        detail: p.fitLineText || app.t('pv.fitLine', { r2: C().fmt(p.r2, 2), d: p.lookbackD }),
        tip: p.fitCriterion, link: { target: 'asset', asset: p.asset } }));
  }
  /* the ledger is a PERMISSION, not a lens: managers and executives hold canSeeTeamBrief */
  function ledgerFor(app){
    const PV = window.EKO_PROVE;
    return PV && PV.canSeeLedger(app) ? PV.ledger(app) : null;
  }

  /* ------------------------------- narration ------------------------------- */
  /* The cache key: a hash of the delta payload the model would be given, plus the
     language. Re-renders, window switches back and forth and reloads of the same
     payload never call the model twice. */
  function hashOf(app, p){
    const s = app.lang + '|' + p.window.kind + '|' + p.items.map(i => i.key + ':' + i.title).join('|') + '|' + (p.recommendation ? p.recommendation.text : '') + '|' + (p.lead || '') + '|' + (p.continuity ? p.continuity.text : '') + '|' + p.view.lens + '|' + (p.view.lead || '') + '|' + (p.view.recommendation || '') + '|' + (p.recurrence ? p.recurrence.text : '') + '|' + (p.calm ? p.calm.text : '');
    let h = 5381; for(let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }
  function context(app, p){
    return { kind: 'brief', lens: p.view.lens, site: app.lang === 'ar' ? app.data.nameAr : app.data.nameEn,
      window: app.t('cu.ctxWindow', { from: stamp(app, Date.parse(p.window.from)), to: hhmm(Date.parse(p.window.to)) }),
      sectionCount: p.items.length,
      figures: p.items.map(l => ({ id: l.key, label: l.title, severity: l.severity, fmt: '', unit: '' })),
      lead: p.view.lead || p.lead || '',
      summary: !!(p.view.sections && p.view.personaItems),   /* E14c: the lead is the Brief's summary sentence */
      emphasis: Object.keys(p.view.emphasis).map(k => p.view.emphasis[k]),
      costBasis: p.view.costBasis ? costBasisText(app, p.view.costBasis) : '',
      continuity: p.continuity ? p.continuity.text : '',
      recurrence: p.recurrence ? p.recurrence.text : '',
      calm: p.calm && !(p.view.personaItems || []).length ? p.calm.text : '',   /* E13: a persona with items is not calm */
      lookahead: p.lookahead ? p.lookahead.items.map(x => x.time + ' ' + x.text + ' (' + x.basis + ')') : [],
      recommendation: p.view.recommendation || (p.recommendation ? p.recommendation.text : '') };
  }
  /* The model returns { headline, recommendation } as JSON. The headline names the
     most important change in plain language — an insight, never a count. The
     reworded recommendation must still name the asset the platform chose, or the
     computed wording stands. */
  function parse(text, reco){
    let o = null; try{ o = JSON.parse(text); }catch(e){}
    const headline = o && typeof o.headline === 'string' ? o.headline : (o ? '' : String(text || ''));
    let rw = o && typeof o.recommendation === 'string' ? o.recommendation : null;
    if(rw && reco && reco.asset && rw.indexOf(reco.asset) < 0) rw = null;
    return { headline, reco: rw };
  }
  async function narrate(app, p, key){
    const L = LLM();
    const done = v => { NARR.set(key, v); delete S.pending[key];
      /* the arrival plays when the narration lands (never when it is replayed from the cache) */
      S.arrival = { key, at: Date.now() }; app.set({}); };
    if(!L || L.kind === 'none' || !L.adapter){ return done({ status: 'unreachable' }); }
    let ok = false; try{ ok = await L.available(); }catch(e){ ok = false; }
    if(!ok) return done({ status: 'unreachable' });
    const ctx = context(app, p);
    const prompt = [app.t('rpPrompt.role'), app.t('rpPrompt.rule'), app.t('rpPrompt.lang'), app.t('cu.promptShape'), 'CONTEXT: ' + JSON.stringify(ctx)].join('\n');
    for(let attempt = 1; attempt <= 2; attempt++){
      let r;
      try{ r = await L.generate(prompt, ctx, { lang: app.lang, attempt }); }
      catch(e){ return done({ status: 'unreachable' }); }
      const out = parse(r.text, p.recommendation);
      const bad = RN() ? RN().offending(out.headline + ' ' + (out.reco || ''), ctx) : [];
      if(out.headline && !bad.length) return done({ status: attempt > 1 ? 'regenerated' : 'ok', headline: out.headline, reco: out.reco });
      console.warn('[brief] narration rejected (attempt ' + attempt + '): ' + (out.headline ? 'numbers not in context: ' + bad.join(', ') : 'no headline'));
      try{ window.EKO_R.audit(app, 'brief.narration.rejected', 'brief', { attempt, numbers: bad, model: r.model }); }catch(e){}
    }
    done({ status: 'rejected' });
  }

  /* ------------------------------ the dismissal ----------------------------
     Dismissing means "not now", never "never again". It holds for THIS visit
     and expires at the next qualifying absence: the record is keyed to the
     visit window's start, so a new absence is a new question. It lives in
     sessionStorage, so a new session always brings the Brief back; inside the
     session it lapses after dismissExpiryH (default: the threshold). */
  function dismissedFor(win){
    const dm = S.dismissed;
    if(!dm || !win) return false;
    if(dm.since !== Math.round(win.atMs / 60000)) return false;      /* a different absence */
    const h = cfg().dismissExpiryH != null ? cfg().dismissExpiryH : cfg().thresholdH;
    if(h != null && (Date.now() - dm.at) / 36e5 >= h) return false;   /* it lapsed */
    return true;
  }
  /* the automatic trigger: gap over the threshold, OR the first visit of the day */
  function qualifies(v){
    if(!v) return false;
    if(v.gapH >= cfg().thresholdH) return true;
    return !!cfg().firstVisitOfDay && new Date(v.atMs).toDateString() !== new Date().toDateString();
  }

  /* D144 (ruled): a handover waiting for the incoming reader opens the Brief by
     itself ONCE PER SESSION per reader per handover, until it is received — not
     on every page change. The first automatic showing is recorded in
     sessionStorage; it stays open until closed (Collapse, Escape, a route change
     or another transient surface), and after that the reader reopens the Brief
     from its control, where the handover is still on top until received. */
  const HOA = 'eko-ho-auto';
  function hoAuto(app){
    const id = window.EKO_HO && window.EKO_HO.pendingId(app);
    if(!id){ S.hoAutoKey = null; return false; }
    const k = HOA + ':' + me() + ':' + id;
    if(S.hoAutoKey === k) return true;          /* the showing in progress */
    if(ss.get(k)) return false;                 /* already shown this session */
    ss.set(k, '1'); S.hoAutoKey = k; return true;
  }

  /* E9 (EKO_E9_Prompt.md A3): the automatic opening. Once per session (recorded in sessionStorage when it first
     shows), only while the Overview is the page; the showing in progress stays until it is closed or the page
     changes. A deep link (?page= another page) lands on that page, where the Brief never opens by itself. It is
     always one click away on the top bar. */
  const BAUTO = 'eko-brief-auto';
  function autoHere(app){
    if(app.state.pageId !== app.overviewId()){ S.autoNow = false; return false; }
    if(S.autoNow) return true;
    return !ss.get(BAUTO);
  }
  function shown(p){ if(p && !S.autoNow){ ss.set(BAUTO, '1'); S.autoNow = true; } return p; }

  /* --------------------------------- render -------------------------------- */
  /* Opened on demand the Brief ignores the threshold, the no-change suppression
     and the dismissal: the user asked for it, so it always renders. */
  function current(app){
    if(!app || app.state.wall) return null;                           /* nobody arrives at a wall */
    if(S.forced){
      const kind = S.winKind || (qualifies(S.visit) ? 'visit' : 'shift');
      const w = windowFor(kind) || windowFor('shift') || windowFor('h8');
      return payload(app, w);
    }
    /* E9: by itself the Brief opens once per session, only on the Overview: never on a deep link or any other page */
    if(!autoHere(app)) return null;
    /* D144: a handover addressed to this site and shift, not yet received, opens the
       Brief by itself (the shift so far); it stays visible until someone receives it */
    if(!qualifies(S.visit)) return hoAuto(app) ? shown(payload(app, windowFor('shift') || windowFor('h8'))) : null;
    if(dismissedFor(S.visit)) return null;
    const p = payload(app, capped(S.visit));
    if(!p.items.some(b => b.segments.includes('visit')) && !cfg().showWhenNoChange) return null;       /* no change since your visit, no Brief */
    return shown(p);
  }
  const isOpen = app => !S.held && !!current(app || E);

  /* THE MOTION BUDGET (D140). Motion in this product means urgency: the ribbon's
     leader flashes while an unacknowledged critical exists (widgets.js ribbon,
     the same condition). While it does, the Brief never animates — it appears
     already at rest. Only one thing on screen moves at a time. */
  const critFlashing = app => (app.data.alarms || []).some(a => a.sev === 'critical' && !a.ack);
  /* the arrival's timeline, in ms from the moment the narration lands (D150): the
     headline's words, then the spine draws itself down, then the boxes settle onto
     it in time order LINE_MS apart (the last few together, so a long feed never
     drags), then the Start-here glow, then stillness */
  const WORD_MS = 45, SPINE_MS = 320, LINE_MS = 60, GLOW_MS = 1200, STAGGER_MAX = 14;
  function timeline(words, boxes){
    const head = words * WORD_MS, spineAt = head, boxAt = head + SPINE_MS;
    const lastBox = boxAt + Math.min(Math.max(0, boxes - 1), STAGGER_MAX) * LINE_MS + 300;
    return { head, spineAt, boxAt, glowAt: lastBox, end: lastBox + GLOW_MS + 100 };
  }

  function card(app){
    E = app;
    if(S.held) return '';   /* E15: the Brief is held in its button while the reader looks at the model */
    const p = current(app);
    if(!p) return '';
    const t = (k, v) => app.t(k, v);
    const key = hashOf(app, p);
    const cached = NARR.get(key);
    if(!cached && !S.pending[key] && p.items.length){ S.pending[key] = true; setTimeout(() => narrate(app, p, key), 0); }
    const status = cached ? cached.status : (p.items.length ? 'running' : 'none');
    /* a Brief opened on demand, or switched to a window whose narration is cached,
       arrives again rather than popping in */
    if(S.replay && cached){ S.arrival = { key, at: Date.now() }; }
    if(cached || !p.items.length) S.replay = false;
    const still = critFlashing(app);
    const arr = S.arrival && S.arrival.key === key ? Date.now() - S.arrival.at : null;
    const lead = p.view.lead || p.lead;
    const headline = p.narrationAvailable ? p.narration.headline : (lead ? t('cu.headFallback', { lead }) : '');
    const words = headline ? headline.split(/\s+/).filter(Boolean) : [];
    const kind = p.window.kind;
    const seg = S.seg && p.segments.some(s => s.kind === S.seg) ? S.seg : kind;
    const pin = p.items.find(b => b.pinned) || null;
    const past = p.items.filter(b => !b.pinned);
    const fut = (p.lookahead ? p.lookahead.items : []).map(x => ({ key: x.key, type: 'coming', time: x.time, title: x.text, detail: x.basis, link: x.link, actions: [], segments: ['next'] }));
    const tl = timeline(words.length, past.length + fut.length + 1);
    const phase = status === 'running' ? 'gen' : (arr != null && arr < tl.end ? 'arrive' : 'rest');
    const motion = still ? 'still' : 'full';
    const d = ms => `--d:${ms}ms`;
    /* a payload link is a TARGET; the shell decides which action reaches it */
    const ACT = { alarmList: () => ({ act: 'cuGoAlarms' }), asset: l => ({ act: 'openAsset', asset: l.asset }), workOrder: l => ({ act: 'woOpen', asset: l.asset }),
                  workOrders: () => ({ act: 'cuGoRegister' }), sources: () => ({ act: 'dlg', v: 'conn' }), page: l => ({ act: 'cuGoPage', page: l.page, mod: l.module, sub: l.sub || '' }) };
    const linkOf = l => { const a = l && ACT[l.target] ? ACT[l.target](l) : null; if(!a) return {}; const { act, ...data } = a; return { act, data }; };
    const attrs = l => { const a = l && ACT[l.target] ? ACT[l.target](l) : {}; return Object.keys(a).map(k => 'data-' + k + '="' + esc(a[k]) + '"').join(' '); };
    const fromMs = Date.parse(p.window.from);
    const reco = p.recommendation;
    const recoText = p.narrationAvailable && p.narration.recommendation ? p.narration.recommendation : (p.view.recommendation || (reco ? reco.text : ''));
    if(reco) issue(app, reco);

    /* the WHAT column drops the asset the row already shows in its own column */
    const shortOf = b => b.asset && b.title.indexOf(b.asset + t('cu.lblSep')) === 0 ? b.title.slice((b.asset + t('cu.lblSep')).length) : b.title;
    /* ---- the box: EKO_C.pbox, the asset panel's block (the full log) ---- */
    const KIND = b => b.type === 'coming' ? t('cu.bk.coming') : !b.severity ? t('cu.bk.note')
      : t('cu.bk.' + b.severity + (b.action && b.severity !== 'medium' ? 'Act' : ''));
    const ACTS_ = { ack: a => ({ act: 'ackAlarm', data: { alarm: a.alarm }, label: t('acknowledge') }), createWo: a => ({ act: 'cwo', data: { asset: a.asset }, label: t('cwo') }),
                    openWo: a => ({ act: 'woOpen', data: { asset: a.asset }, label: t('cu.bx.openWo') }) };
    const archBtn = b => `<button class="iconbtn icon22 cuarch tipU" data-act="brArch" data-k="${esc(b.key)}" data-tip="${esc(t('cu.archTip'))}" aria-label="${esc(t('cu.arch'))}">${icon('archive', 13)}</button>`;
    const boxHtml = (b, o) => { const l = linkOf(b.link);
      return C().pbox({ kind: o.kind || KIND(b), kicon: o.kicon || '', time: b.type === 'coming' ? b.time : stamp(app, Date.parse(b.at)),
        title: o.title || b.title, detail: o.detail || p.view.emphasis[b.key] || b.detail,
        /* D151: the title and the analysis line are clamped in the feed, so the box's tooltip carries them whole */
        tip: [o.title || b.title, o.detail || p.view.emphasis[b.key] || b.detail, o.tip || p.view.tips[b.key] || ''].filter(Boolean).join('\n'),
        sev: b.severity || null, acked: b.acknowledged, sched: b.type === 'coming', act: l.act, data: l.data,
        actions: o.archived ? [{ act: 'brRestore', data: { k: b.key }, label: t('cu.restore') }] : (b.actions || []).map(a => ACTS_[a.kind] && ACTS_[a.kind](a)).filter(Boolean),
        hend: o.archived || o.noArch ? '' : archBtn(b) }); };
    let bi = 0;
    const li = (b, when) => `<li class="ptli" data-when="${when}"${b.severity ? ` data-sev="${esc(b.severity)}"` : ''}${b.segments.includes(seg) ? ' data-hl="1"' : ''} data-k="${esc(b.key)}" style="${d(tl.boxAt + Math.min(bi++, STAGGER_MAX) * LINE_MS)}"><span class="ptldot" aria-hidden="true"></span>${boxHtml(b, {})}</li>`;
    /* the recommendation: the FIRST box, pinned ("Start here"), carrying its subject's
       severity, time and actions; the subject is not repeated in the timeline */
    const pinHtml = pin || (reco && recoText) ? `<div class="cupin" style="${d(tl.boxAt)};--dg:${tl.glowAt}ms">${boxHtml(pin || { key: 'reco', type: 'note', at: new Date().toISOString(), link: reco.link, actions: [], segments: [] },
        { kind: t('cu.recoLbl') + (pin && pin.severity ? t('cu.lblSep') + KIND(pin) : ''), kicon: icon('pin', 12), title: recoText, detail: pin ? pin.title : '', tip: p.view.tips.recommendation || '', noArch: !pin })}</div>` : '';
    const pastHtml = past.map(b => li(b, 'past')).join('');
    const nowH = `<li class="ptlnow" style="${d(tl.boxAt + Math.min(bi++, STAGGER_MAX) * LINE_MS)}"><span class="ptlnowl">${esc(t('cu.nowAt', { t: hhmm(Date.now()) }))}</span></li>`;
    const futHtml = fut.map(b => li(b, 'future')).join('');
    const empty = !past.length && !pin ? `<li class="cuempty">${esc(t('cu.nothing', { t: stamp(app, fromMs) }))}</li>` : '';
    const arch = p.archived || [];
    const archHtml = arch.length ? `<div class="cuarchf"><button class="cumore" data-act="brShowArch" aria-expanded="${!!S.showArch}">${esc(S.showArch ? t('cu.archHide') : t('cu.archShow', { n: arch.length }))}</button>
        ${S.showArch ? `<div class="pboxes cuarchl">${arch.map(a => boxHtml({ key: a.key, type: a.type, at: a.at, title: a.title, detail: t('cu.archAt', { t: stamp(app, Date.parse(a.archivedAt)) }), actions: [], segments: [], time: a.type === 'coming' ? hhmm(Date.parse(a.at)) : null }, { archived: true, kind: a.type === 'coming' ? t('cu.bk.coming') : t('cu.bk.archived') })).join('')}</div>` : ''}</div>` : '';

    /* ---- the ribbon: past segments, Now, the future; a dropdown when narrow ---- */
    const segLbl = s => t('cu.seg.' + (s.kind === 'next' ? 'next' : s.kind), { h: s.hours });
    const segTip = s => s.kind === 'next' ? t('cu.segTip.next', { h: s.hours }) : s.kind === 'h24' ? t('cu.segTip.h24', { h: Math.round(s.hours) })
      : t('cu.segTip.prim', { from: stamp(app, fromMs), to: hhmm(Date.now()) }) + (p.view.tips.segment ? '\n' + p.view.tips.segment : '');
    const segBtn = s => `<button class="curb" data-act="brSeg" data-v="${esc(s.kind)}" aria-pressed="${s.kind === seg}" data-when="${s.kind === 'next' ? 'future' : 'past'}" data-tip="${esc(segTip(s))}"><span class="curbl">${esc(segLbl(s))}</span><span class="curbn tMonoS">${s.count}</span></button>`;
    const pastSegs = p.segments.filter(s => s.kind !== 'next'), nextSeg = p.segments.find(s => s.kind === 'next');
    const ribbon = `<div class="curib" role="group" aria-label="${esc(t('cu.segLbl'))}" style="${d(tl.head)}">
        <div class="curibseg">${pastSegs.map(segBtn).join('')}${nextSeg ? segBtn(nextSeg) : ''}</div>
        <label class="curibsel"><span class="srOnly">${esc(t('cu.segLbl'))}</span><select class="cuwinsel" data-chg="brSeg" aria-label="${esc(t('cu.segLbl'))}">${p.segments.map(s =>
          `<option value="${esc(s.kind)}"${s.kind === seg ? ' selected' : ''}>${esc(t('cu.segOpt', { lbl: segLbl(s), n: s.count }))}</option>`).join('')}</select></label></div>`;

    const recl = p.recurrence ? `<button class="cucont curecur" data-tip="${esc(p.recurrence.text + '\n' + p.recurrence.tip)}" ${attrs(p.recurrence.link)}><span class="cuneu">${C().dicon('rotate', 13)}</span><span class="cutx">${esc(p.view.recurrenceFirst ? p.recurrence.evidence : p.recurrence.text)}</span></button>` : '';   /* the engineer's headline IS the pattern; the line under it is its evidence */
    const cont = p.continuity ? `<button class="cucont" data-kind="${esc(p.continuity.kind)}" data-tip="${esc(p.continuity.text)}" ${attrs(p.continuity.link)}><span class="cuneu">${icon('clock', 13)}</span><span class="cutx">${esc(p.continuity.text)}</span></button>` : '';
    /* D144 — THE FOLD BUDGET (after() raises S.fit while the board overflows the window):
       1 the handover shows its note in two lines and drops its summary (both in Open);
       2 the continuity and recurrence lines take one line each (whole in the tooltip);
       3 the sources take one line (whole in the tooltip). The feed scrolls inside the
         board at every step (D150); past 3 the board scrolls as a whole. */
    const note = p.sources.incomplete.length ? t('cu.incomplete', { list: p.sources.incomplete.join(' · ') }) : '';
    /* E13: an AI-written headline (the narration landed) carries the AI edge; the computed fallback does not */
    const hl = headline ? `<p class="cuhl" data-tip="${esc(headline + (p.view.tips.lead ? '\n' + p.view.tips.lead : ''))}">${words.map((w, i) => `<span class="cuw" style="${d(i * WORD_MS)}">${esc(w)}</span>`).join(' ')}</p>` : '';
    /* ====================== D152 — TWO LAYERS ==============================
       THE BRIEF is a SHIFT LOG: one table with fixed columns (time · priority ·
       asset · what · action) under three fixed sections (Needs you · Changed ·
       Due in the next 8 h), over a strip of counts, under one headline
       sentence. Alignment does the organising: every row is the same shape, so
       the eye runs down the columns. Nothing waits behind a hover, nothing
       moves, and colour says PRIORITY only — with a letter beside it (ISA-101 /
       ISA-18.2 practice: shape and text as well as colour, one click to the
       source, and controls that a gloved hand can hit).
       THE FULL LOG (S.full) is the box-by-box timeline of D150, one click away
       behind "Full log (23)" — the second and last layer. */
    /* D160: "Needs you" is never collapsed — every item shows and the table scrolls; the other
       two sections show everything up to five, and only then keep their "All" */
    const OVER = 5;
    const LIM = [[3, 2], [3, 2], [2, 1], [2, 1]][Math.min(S.fit, 3)];
    const inSeg = b => seg === 'h24' || b.segments.includes(kind);
    const rank = b => (b.pinned ? -1 : 0) + (b.severity === 'critical' ? 0 : b.severity === 'high' ? 1 : 2);
    const need = p.items.filter(b => b.action && inSeg(b)).sort((a, b) => rank(a) - rank(b) || Date.parse(a.at) - Date.parse(b.at));
    /* D161: a projected crossing is a forward warning — it needs someone, but it is not an alarm */
    const warn = (p.predicted || []).filter(x => !x.soon).map(x => ({ key: x.key, type: 'predict', severity: null, acknowledged: false,
      action: false, at: new Date().toISOString(), title: x.title, detail: x.detail, tip: x.tip, asset: x.asset,
      actions: [], link: x.link, segments: [kind, 'h24'] }));
    const changed = p.items.filter(b => !b.action && inSeg(b)).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    const due = fut.slice();
    /* the priority cell: a letter for an alarm (localised), a glyph for everything else */
    const GL = { workOrder: 'wrench', source: 'layers', metric: 'gauge', cleared: 'check', coming: 'clock', ack: 'check',
                 verified: 'check', predict: 'gauge' };
    /* D160: the product's severity glyph (shape AND colour AND the word), the same one the
       ribbon, the alarm list and the asset panel use */
    const priCell = b => b.severity
      ? `<span class="bpri" data-p="${esc(b.severity)}" aria-label="${esc(t('rpSev.' + b.severity))}" data-tip="${esc(t('rpSev.' + b.severity) + (b.acknowledged ? t('cu.lblSep') + t('tl.ack') : ''))}">${C().sevGlyph(b.severity, !!b.acknowledged, 13)}</span>`
      : `<span class="bpri" data-p="note" aria-hidden="true">${icon(GL[b.type] || 'info', 12)}</span>`;
    const rowAct = b => { const a = (b.actions || [])[0];
      if(a && a.kind === 'ack') return `<button class="btnSm ${b.pinned ? 'btnP' : 'btnG'}" data-act="ackAlarm" data-alarm="${esc(a.alarm)}">${esc(t('cu.ackShort'))}</button>`;
      if(b.type === 'workOrder') return `<button class="btnSm btnG" data-act="woOpen" data-asset="${esc(b.asset)}">${esc(t('cu.openShort'))}</button>`;
      if(b.type === 'metric') return `<button class="btnSm btnG" ${attrs(b.link)}>${esc(t('cu.viewShort'))}</button>`;
      if(b.type === 'coming' || b.type === 'predict') return `<button class="btnSm btnG" ${attrs(b.link)}>${esc(t('cu.openShort'))}</button>`;
      if(b.type === 'verified') return `<button class="btnSm btnG" ${attrs(b.link)}>${esc(t('cu.viewShort'))}</button>`;
      return ''; };
    const row = b => { const l = linkOf(b.link), lbl = b.title + (b.detail ? ': ' + b.detail : '');   /* E8: no dash in the tooltip */
      return `<div class="brow"${b.severity && !b.acknowledged ? ` data-sev="${esc(b.severity)}"` : ''}${b.pinned ? ' data-first="1"' : ''}${b.asset && b.asset === app.state.assetSel ? ' data-cur="1"' : ''} data-tip="${esc(lbl)}">
        ${l.act ? `<button class="browcover" data-act="${esc(l.act)}"${Object.keys(l.data || {}).map(k => ` data-${k}="${esc(l.data[k])}"`).join('')} aria-label="${esc(lbl)}"></button>` : ''}
        <span class="btm tMonoS">${esc(b.type === 'coming' ? b.time : hhmm(Date.parse(b.at)))}</span>
        ${priCell(b)}
        <span class="bas tMonoS">${esc(b.asset || (b.type === 'metric' ? t('cu.metricLbl') : ''))}</span>
        <span class="bwt">${b.pinned ? `<span class="bstar">${icon('pin', 11)}${esc(t('cu.recoLbl'))}</span>` : ''}${b.flag ? `<span class="bflag">${esc(b.flag)}</span>` : ''}${esc(b.type === 'coming' || b.type === 'metric' ? b.title : shortOf(b))}</span>
        <span class="bact">${rowAct(b)}</span></div>`; };
    /* the section header carries its own count — "NEEDS YOU 6" says what the 6 are */
    const sec = (key, list, lim, n, label) => `<section class="bbox"${key === 'need' && n ? ' data-hot="1"' : ''}>
        <div class="bsec"><span>${esc(label)}</span><b class="bsecn tMonoS">${n}</b>${lim < n ? `<button class="cumore" data-act="brFull" data-v="${esc(key)}">${esc(t('cu.allShort'))}</button>` : ''}</div>
        <div class="brows">${list.length ? list.slice(0, lim).map(row).join('') : `<p class="bnone">${esc(t('cu.rowNone'))}</p>`}</div></section>`;
    /* D161 — THE LEDGER: what waiting has cost so far, for the permission that may see it.
       No name appears in the total; the assignee is on the row that is opened. */
    const led = p.ledger;
    const ledgerBox = led && led.rows.length ? `<section class="bbox" data-led="1">
        <div class="bsec"><span>${esc(t('pv.ledger'))}</span><b class="bsecn tMonoS" data-money="1" data-tip="${esc(led.basisText)}">${esc(t('pv.ledgerTotal', { n: C().fmt(led.total, 0), aed: C().fmt(led.total, 0) }))}</b></div>
        <div class="brows">${led.rows.slice(0, 3).map(r => `<div class="brow bled" data-tip="${esc(r.reason || '')}">
            <button class="browcover" data-act="openAsset" data-asset="${esc(r.asset)}" aria-label="${esc(r.asset)}"></button>
            <span class="bledt"><b class="tMonoS">${esc(r.asset)}</b>${esc(t('cu.lblSep') + (r.reason || ''))}</span>
            <span class="bledd">${esc(t('pv.ledgerRow', { n: r.days }))}</span>
            <span class="bleda" data-tip="${esc(led.basisText)}">${esc(t('pv.ledgerTotal', { aed: C().fmt(r.aed, 0) }))}</span></div>`).join('')}</div></section>` : '';
    /* D161 — the roll-up: verified savings this month, each fix one click away (executive lens) */
    const roll = p.rollup && p.view.lens === 'executive' && p.rollup.n ? `<div class="pvroll" data-tip="${esc(p.rollup.basisText)}">
        <span>${esc(t('pv.rollup'))}</span><b>${esc(t('pv.rollupLine', { aed: C().fmt(p.rollup.aed, 0), n: p.rollup.n }))}</b>
        ${p.rollup.fixes.map(f => `<button class="pvrolla" data-act="openAsset" data-asset="${esc(f.asset)}">${esc(f.asset)}</button>`).join('')}</div>` : '';
    /* E14c: the E13 compact Brief (.perbrief) and the D152 shift log table are gone: ONE Brief, the pop-up (pop14) */
    /* the full log (D150's timeline), the second layer */
    const full = `${cont || recl ? `<div class="cuconts">${p.view.recurrenceFirst ? recl + cont : cont + recl}</div>` : ''}${ribbon}
      <div class="cufeed" tabindex="-1" aria-label="${esc(t('cu.feedLbl'))}">
        ${pinHtml}
        <ol class="ptl cuspine">${empty}${pastHtml}${nowH}${futHtml}</ol>
        ${archHtml}
      </div>`;
    /* E14c: ONE Brief, the pop-up, for every persona and page; the full log opens inside it */
    S.pop = true;
    return pop14(app, p, { status, headline, full: S.full ? (hl || '') + full : null });
  }


  /* ------------------------- E14c: the Brief pop-up (mock 6, redesigned) -------------------------
     A SUMMARY of what matters, in EKO's order: Detect, Predict and Prevent, Prove; the handover is
     one line. About 880 px wide, at most 80 percent of the window high, anchored under the Brief
     button at the top end, moved only by its header (after 4 px), never re-laid out by a click
     inside it: the ribbon and the timeline's earlier group change attributes in place.
     Top to bottom: the header (the persona, the shift, Collapse); the engine's sentence, the only
     AI-written text (the glow only while it is written); the ribbon; the summary on the left
     (Act now, Coming up, Done this shift, the handover line); the timeline on the right, oldest
     first (the earlier events folded, the shift's start, its events, Now kept in view, the next
     8 hours muted); the footer (the source chips; How this works on site, Prepare handover,
     Full log). One component for every persona and every page. */
  function shiftStarts(app){
    return ((((app.data.wall || {}).shifts) || {}).starts || []).map(x => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(x)); return m ? +m[1] * 60 + +m[2] : null; }).filter(x => x != null);
  }
  const shiftName14 = ms => { const h = new Date(ms).getHours(); return h >= 4 && h < 12 ? 'morning' : h >= 12 && h < 20 ? 'afternoon' : 'night'; };
  /* where an event comes from: work orders from the CMMS, door and card reader alarms from access control, the rest from FIN */
  function src14(app, b){
    if(b.type === 'workOrder') return 'cmms';
    const a = b.asset && ((app.data.alarms || []).concat(app.data.alarmCatalog || [])).find(x => x.asset === b.asset);
    return a && a.fam === 'sec' ? 'access' : 'fin';
  }
  const kind14 = b => b.type === 'verified' || b.type === 'cleared' ? 'ok' : b.severity === 'critical' ? 'crit' : (b.severity === 'high' || b.severity === 'medium') && !b.acknowledged ? 'warn' : b.type === 'workOrder' ? 'wo' : 'plan';
  const L14 = (app, en, ar) => app.lang === 'ar' ? (ar || en) : en;
  const lc14 = (app, s) => !s || app.lang === 'ar' ? (s || '') : s.charAt(0).toLowerCase() + s.slice(1);
  const money14 = app => !!(window.EKO_PERSONA && window.EKO_PERSONA.money(app));
  /* the persona's alarms (E13's rules): the engineer the HVAC and electrical ones, the security officer the access and fire ones, the rest all */
  const ENG14 = ['ahu', 'chw', 'heat', 'elec'], SEC14 = ['sec', 'fire'];
  function alarmsFor14(app){
    const per = window.EKO_PERSONA ? window.EKO_PERSONA.of(app) : null;
    const sysOf = a => ((app.data.assets || []).find(x => x.id === a.asset) || {}).sys || a.fam;
    let al = (app.visAlarms ? app.visAlarms() : (app.data.alarms || [])).filter(a => !a.shelved && (a.sev === 'critical' || a.sev === 'high'));
    if(per === 'engineer') al = al.filter(a => ENG14.includes(sysOf(a)));
    if(per === 'security') al = al.filter(a => SEC14.includes(a.fam));
    const R = { critical: 0, high: 1 };
    return al.sort((a, b) => (R[a.sev] - R[b.sev]) || (a.ack ? 1 : 0) - (b.ack ? 1 : 0) || b.ageH - a.ageH);
  }
  /* E16: THE ONE DEFINITION of "need you now": the Brief's Act now rows (the persona's critical and high alarms, three at most).
     The summary panel's persona sentence counts the same list (EKO_BRIEF.actNow). */
  const actNow14 = app => alarmsFor14(app).slice(0, 3);
  /* THE FOUR SECTIONS, from the engine's records (never the mock's values) */
  function sections14(app, p){
    const t = (k, v) => app.t(k, v), per = window.EKO_PERSONA ? window.EKO_PERSONA.of(app) : null, canAck = !(app.role && app.role() === 'partner');
    const PV = window.EKO_PROVE, wos = ((app.data.maintenance || {}).wos || []);
    const openWo = id => wos.filter(w => w.asset === id && !w.closedH && w.state !== 'done').sort((a, b) => (a.dueH == null) - (b.dueH == null) || (a.dueH || 0) - (b.dueH || 0))[0] || null;
    const where = a => (app.loc ? app.loc(a, 'loc') : null) || L14(app, a.locEn, a.locAr) || '';
    /* Act now (Detect) */
    const detect = actNow14(app).map(a => ({ key: 'al:' + a.id, sev: a.sev, tag: a.asset, asset: a.asset, text: L14(app, a.plainEn, a.plainAr) || a.asset,
      meta: [where(a), t('br14c.open', { age: app.fmtAge(a.ageH) })].filter(Boolean).join(t('cu.lblSep')), risk: a.sev === 'critical',
      act: !a.ack && canAck ? { act: 'ackAlarm', data: { alarm: a.id }, label: t('acknowledge') } : { act: 'openAsset', data: { asset: a.asset }, label: t('br14c.inModel') } }));
    /* Coming up (Predict and Prevent): the forecast drifts, the demand peak, the work due in the next 8 hours */
    const coming = [];
    (PV ? PV.predictions(app).filter(x => x.state === 'drift').sort((a, b) => a.days - b.days) : []).slice(0, 1).forEach(x => { const w = openWo(x.asset);
      coming.push({ key: 'pv:' + x.asset, kind: 'predict', asset: x.asset, days: Math.round(x.days), task: w ? lc14(app, L14(app, w.taskEn, w.taskAr)) : '',
        text: t('br14d.pred', { a: x.asset, point: x.pointShort || lc14(app, x.point), n: Math.round(x.days) }), icon: t('br14d.icDays', { n: Math.round(x.days) }), pill: t('br14d.range', { lo: x.daysLo, hi: x.daysHi }),
        act: w ? { act: 'woOpen', data: { asset: x.asset }, label: t('br14c.openWo', { wo: w.id }) } : { act: 'e14Predict', data: { v: x.asset }, label: t('br14c.openPred') } }); });
    if(per === 'executive' || per === 'fm'){ const X = window.EKO_PERSONA && window.EKO_PERSONA.execLine ? window.EKO_PERSONA.execLine(app) : null;
      if(X && X.M && X.M.gap > 0) coming.push({ key: 'budget', kind: 'budget', icon: 'MWh', pill: t('br14d.forecast'), text: t('br14c.budget', { m: X.mName, d: C().fmt(X.M.gap, 0) }) + (money14(app) && (app.data.basis || {}).aedPerKwh ? t('br14c.budgetAed', { aed: C().fmt(X.M.gap * 1000 * app.data.basis.aedPerKwh, 0) }) : ''),
        act: { act: 'goSub', data: { page: 'fcst', mod: 'energy', sub: 'fcst' }, label: t('br14c.openFcst') } }); }
    (p.lookahead ? p.lookahead.items : []).forEach(x => {
      if(coming.length >= 3) return;
      if(x.type === 'demand' && x.pct != null) coming.push({ key: x.key, kind: 'demand', icon: 'kW', pill: t('br14d.forecast'), text: t('br14d.peak', { t: x.time, p: C().fmt(x.pct, 0) }), act: { act: 'cuGoPage', data: { page: 'power', mod: 'energy', sub: 'power' }, label: t('br14c.open1') } });
      else if((x.type === 'wo' || x.type === 'pm') && per !== 'executive'){ const id = String(x.key).split(':').pop(); const asset = x.link && x.link.asset;
        coming.push({ key: x.key, kind: 'due', icon: 'WO', sub: asset || '', asset: asset || null, text: t('br14d.due', { wo: id, t: x.time }), act: asset ? { act: 'woOpen', data: { asset }, label: t('br14c.open1') } : null }); }
    });
    /* Done this shift (Prove): the fixes proved, the alarms cleared, the work orders completed */
    const sw = shiftWindow(), done = [];
    (PV ? PV.verified(app).filter(v => v.outcome === 'recovered' || v.outcome === 'partly') : []).slice(0, 1).forEach(v => done.push({ key: 'pv:' + v.id,
      text: t(v.outcome === 'recovered' ? 'br14c.recovered' : 'br14c.partly', { a: v.asset, wo: v.wo || '' }) + (money14(app) && v.aedMo != null ? t('br14c.saving', { aed: C().fmt(v.aedMo, 0) }) : ''),
      act: { act: 'e14Prove', data: { v: v.asset }, label: t('br14c.open1') } }));
    const ev = (app.data.eventLog || []).filter(e => e.h <= sw.gapH);
    const cleared = ev.filter(e => e.kind === 'alarmCleared').length, closed = ev.filter(e => e.kind === 'woCompleted').length;
    if(cleared) done.push({ key: 'cleared', text: t(cleared === 1 ? 'br14c.cleared1' : 'br14c.clearedN', { n: cleared }), act: null });
    else if(closed) done.push({ key: 'closed', text: t(closed === 1 ? 'br14c.closed1' : 'br14c.closedN', { n: closed }), act: null });
    return { detect, coming: coming.slice(0, 3), done: done.slice(0, 2) };
  }
  /* the sentence: what the sections say, in one line (the model may only reword it) */
  function lead14(app, S14, ho){
    const t = (k, v) => app.t(k, v), parts = [], n = S14.detect.length;   /* E16: "need you now" is the Act now count, everywhere (actNow) */
    parts.push(n ? t(n === 1 ? 'br14c.l.al1' : 'br14c.l.alN', { n }) : t('br14c.l.al0'));
    const pr = S14.coming.find(x => x.kind === 'predict');
    if(pr) parts.push(pr.task ? t('br14c.l.predTask', { a: pr.asset, task: pr.task, n: pr.days }) : t('br14c.l.pred', { a: pr.asset, n: pr.days }));
    if(ho && !ho.receipt && ho.by && window.EKO_HO && ho.by.user !== ((app.data.user || {}).name)) parts.push(t('br14c.l.ho'));
    return parts.join(t('br14c.l.sep')) + t('br14c.l.rest');
  }
  /* the timeline, oldest first: the events before the shift (folded), the shift's start, its events, Now, the next 8 hours */
  function events14(app, p){
    const t = (k, v) => app.t(k, v), now = Date.now(), from = now - 24 * 36e5, H = (p.lookahead && p.lookahead.hours) || cfg().lookaheadH || 8, end = now + H * 36e5;
    const sw = shiftWindow(), shiftFrom = sw.atMs, money = money14(app);
    const ev = [];
    (p.items || []).forEach(b => { const ms = Date.parse(b.at); if(ms >= from && ms <= now && (money || !/\bAED\b|درهم/.test(b.title))) ev.push({ ms, text: b.title, kind: kind14(b), src: src14(app, b), asset: b.asset || null, key: 'tl:' + (b.key || ms) }); });
    (p.lookahead ? p.lookahead.items : []).forEach(x => { const ms = Date.parse(x.dueAt); if(ms > now && ms <= end)
      ev.push({ ms, text: x.text, kind: 'next', src: x.type === 'demand' ? 'fc' : x.type === 'tank' ? 'fin' : 'cmms', due: x.type === 'demand' || x.type === 'tank' ? 'expected' : 'due', asset: (x.link && x.link.asset) || null, key: 'tl:' + x.key }); });
    const mins = shiftStarts(app), d0 = new Date(from); d0.setHours(0, 0, 0, 0);
    for(let k = 0; k <= 2; k++) mins.forEach(m => { const x = new Date(d0); x.setDate(x.getDate() + k); x.setHours(0, m, 0, 0); const ms = x.getTime();
      if(ms >= from && ms <= end) ev.push({ ms, text: t(ms <= now ? 'br14.tl.start.' + shiftName14(ms) : 'br14.tl.next.' + shiftName14(ms)), kind: ms <= now ? 'shift' : 'next', src: 'shift', due: ms > now ? 'expected' : null }); });
    if(window.EKO_HO && window.EKO_HO.events) window.EKO_HO.events(app, from, end).forEach(e => ev.push(Object.assign(e, { kind: 'ho' })));
    ev.sort((a, b) => a.ms - b.ms);
    ev.forEach(e => { e.g = e.ms > now ? 'next' : e.ms >= shiftFrom - 6e4 ? 'shift' : 'before'; });
    return { ev, now, from, end, H, shiftFrom };
  }
  const SRC14 = ['fin', 'access', 'cmms', 'ho', 'shift', 'fc'];
  /* scroll the timeline inside its own box to a range: the last 24 h to the top, the shift to its start, Now and the next hours to Now */
  function tlTo(card, v){
    const tl = card && card.querySelector('.br14tl'); if(!tl) return;
    const tgt = v === 'h24' ? null : v === 'shift' ? (tl.querySelector('.br14ev[data-g="shift"]') || tl.querySelector('.br14nowrow')) : tl.querySelector('.br14nowrow');
    const top = tgt ? Math.max(0, tgt.offsetTop - (v === 'shift' ? 6 : v === 'next' ? 30 : Math.round(tl.clientHeight * 0.5))) : 0;
    tl.scrollTop = top; S.tlTop = top;
  }
  /* E14d (design/persona-mock/6-Brief-popup-v2.html): the approved look. A wrapper carries the AI glow (a 1 px
     conic ring and its blurred halo, both on the 16 px corners, turning every 3 s while the summary is written and
     every 14 s after); inside it a glass card. The header band and the sentence band are the drag handle. The
     summary on the left wraps and is never cut; the ribbon sits on the timeline it controls. */
  const SPARK14 = id => `<svg class="br14spark" viewBox="0 0 24 24" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4C7DFF"/><stop offset=".55" stop-color="#7B6CFF"/><stop offset="1" stop-color="#C86BD9"/></linearGradient></defs><path fill="url(#${id})" d="M12 2c.6 4.9 3.1 7.4 8 8-4.9.6-7.4 3.1-8 8-.6-4.9-3.1-7.4-8-8 4.9-.6 7.4-3.1 8-8z"/></svg>`;
  const LOC14 = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="5.5"/><circle cx="12" cy="12" r="1.6" class="f"/><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4"/></svg>';
  const reduceMotion = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const nbH = h => window.EKO_HIT ? window.EKO_HIT.nb(h) : h;   /* E17: asset tags never break at their hyphen (js/shell/hit.js) */
  function pop14(app, p, o){
    const t = (k, v) => app.t(k, v), T = events14(app, p), now = T.now, sw = T.shiftFrom;
    const seg = ['h24', 'shift', 'now', 'next'].includes(S.seg14) ? S.seg14 : 'shift';
    const persona = window.EKO_PERSONA ? window.EKO_PERSONA.of(app) : null;
    const S14 = p.view.sections || sections14(app, p);
    /* the writing: two shimmer lines (at least 0.9 s), then the words fade in one by one; at once with reduced motion */
    const still = reduceMotion(), key = hashOf(app, p) + ':' + app.lang;
    const writing = !still && (o.status === 'running' || Date.now() < (S.writeUntil || 0));
    const words = o.headline ? o.headline.split(/\s+/).filter(Boolean) : [];
    const arriving = !writing && !still && words.length && S.wordsFor !== key;
    if(arriving){ S.wordsFor = key; S.glowUntil = Date.now() + words.length * 55 + 900; clearTimeout(S.glowT);
      S.glowT = setTimeout(() => { const w = document.querySelector('.br14wrap'); if(w) w.classList.remove('writing'); }, words.length * 55 + 950); }
    const glowWriting = writing || Date.now() < (S.glowUntil || 0);
    const ai = !!(p.narrationAvailable && !writing);
    const who = t('br14.who', { p: persona ? t('per.n.' + persona) : t('cu.title'), shift: t('br14.shiftLc.' + shiftName14(sw)), t: hhmm(sw) });
    const lead = o.full ? '' : writing ? `<p class="br14hl" aria-live="polite"><span class="br14shim"></span><span class="br14shim"></span><span class="srOnly">${esc(t('br14.reading'))}</span></p>`
      /* E17: the reveal is one mask sweep over the sentence. Per-word spans with their own blur animation
         stopped Chrome painting the sentence's clipped gradient text, so it read blank on a reopen. */
      : `<p class="br14hl${arriving ? ' br14arr' : ''}" aria-live="polite"${arriving ? ` style="--arr:${words.length * 55 + 350}ms"` : ''}>${esc(o.headline || '')}</p>`;
    /* the summary rows: they wrap, never cut */
    /* E15: Show in the model, only where the model has the element or room (data.assets[].gid / roomGid); nothing is placed by guess */
    const FO = window.EKO_BFOCUS, canLoc = id => !!(FO && id && FO.locatable(app, id));
    const locA = (x) => canLoc(x.asset) ? ` data-act="bfLocate" data-v="${esc(x.key)}"` : '';
    const locB = (x) => canLoc(x.asset) ? `<button class="br14loc" data-act="bfLocate" data-v="${esc(x.key)}" data-tip="${esc(t('bf15.loc'))}" aria-label="${esc(t('bf15.loc'))}">${LOC14}</button>` : '';
    const btn = (a, pri) => a ? `<button class="br14btn${pri ? ' pri' : ''}" data-act="${esc(a.act)}"${Object.keys(a.data || {}).map(k => ` data-${k}="${esc(a.data[k])}"`).join('')}>${esc(a.label)}</button>` : '';
    const sec = (k, n, cls) => `<div class="br14sec">${esc(t('br14c.s.' + k))} <span class="br14ct ${cls}">${n}</span></div>`;
    const det = S14.detect.map(x => `<div class="br14r${canLoc(x.asset) ? ' loc' : ''}" data-sev="${esc(x.sev)}"${locA(x)}><span class="br14sev ${x.sev === 'critical' ? 'c' : 'h'}" aria-label="${esc(t('rpSev.' + x.sev))}"></span>
        <div><div class="br14t"><code>${esc(x.tag)}</code>${esc(x.text)}</div><div class="br14m">${esc(x.meta)}${x.risk ? ` <span class="br14risk">${esc(t('cu.lblSep') + t('br14d.risk'))}</span>` : ''}</div></div>
        ${locB(x)}${btn(x.act, x.risk && x.act && x.act.act === 'ackAlarm')}</div>`).join('');
    const com = S14.coming.map(x => `<div class="br14r${canLoc(x.asset) ? ' loc' : ''}"${locA(x)}><span class="br14ic ${x.kind === 'due' ? 'w' : 'f'}">${esc(x.icon || '')}</span>
        <div><div class="br14t">${esc(x.text)}${x.pill ? ` <span class="br14fc">${esc(x.pill)}</span>` : ''}${x.sub ? ` <span class="br14m br14inl">${esc(t('cu.lblSep') + x.sub)}</span>` : ''}</div></div>${locB(x)}${btn(x.act)}</div>`).join('');
    const done = S14.done.length ? `<div class="br14done"><span class="br14sec br14seci">${esc(t('br14c.s.done'))}</span>${S14.done.map(x => x.act ? `<button class="br14chip" data-act="${esc(x.act.act)}"${Object.keys(x.act.data || {}).map(k => ` data-${k}="${esc(x.act.data[k])}"`).join('')}>${esc(x.text)}</button>` : `<span class="br14chip">${esc(x.text)}</span>`).join('')}</div>`
      : `<div class="br14done"><span class="br14sec br14seci">${esc(t('br14c.s.done'))}</span><span class="br14none">${esc(t('br14c.none.done'))}</span></div>`;
    const ho = window.EKO_HO && p.handover ? window.EKO_HO.line14(app, p.handover) : '';
    const left = `<div class="br14col br14main">${sec('detect', S14.detect.length, 'crit')}<div class="br14rows">${det || `<p class="br14none">${esc(t('br14c.none.detect'))}</p>`}</div>
        ${sec('coming', S14.coming.length, 'pred')}<div class="br14rows">${com || `<p class="br14none">${esc(t('br14c.none.coming'))}</p>`}</div>
        ${done}${ho}${window.EKO_E14 ? window.EKO_E14.siteBox(app, 'land') : ''}</div>`;
    /* the timeline and its ribbon */
    const cnt = { h24: T.ev.filter(e => e.g !== 'next').length, shift: T.ev.filter(e => e.g === 'shift').length, next: T.ev.filter(e => e.g === 'next').length };
    const segB = (s, lbl, n) => `<button class="br14seg${s === 'now' ? ' now' : ''}" data-act="brSeg14" data-v="${s}" aria-pressed="${seg === s}">${esc(lbl)}${n != null ? `<b>${n}</b>` : ''}</button>`;
    const ribbon = `<div class="br14rib" role="group" aria-label="${esc(t('cu.segLbl'))}">${segB('h24', t('br14.seg.h24'), cnt.h24)}${segB('shift', t('br14d.since', { t: hhmm(sw) }), cnt.shift)}${segB('now', t('br14.seg.now'))}${segB('next', t('br14.seg.next', { h: T.H }), cnt.next)}</div>`;
    const DOT = { crit: 'd-c', warn: 'd-h', wo: 'd-i', ok: 'd-o', next: 'd-i', ho: 'd-n', shift: 'd-n', plan: 'd-n' };
    const tlRow = e => `<div class="br14ev${e.g === 'next' ? ' fut' : ''}${canLoc(e.asset) ? ' loc' : ''}" data-g="${e.g}"${canLoc(e.asset) ? ` data-act="bfLocate" data-v="${esc(e.key)}" role="button" tabindex="0" data-tip="${esc(t('bf15.loc'))}"` : ''}><span class="br14tm">${esc(hhmm(e.ms))}</span><span class="br14dt ${DOT[e.kind] || 'd-n'}"${e.kind === 'crit' || e.kind === 'warn' ? ` aria-label="${esc(t(e.kind === 'crit' ? 'rpSev.critical' : 'rpSev.high'))}"` : ' aria-hidden="true"'}></span>
        <span class="br14tx">${esc(e.text)}${e.due ? ` <i class="br14due">${esc(t('br14c.tl.' + e.due))}</i>` : ''}<span class="br14src">${esc(t('br14d.src.' + e.src))}</span></span></div>`;
    const before = T.ev.filter(e => e.g === 'before'), inShift = T.ev.filter(e => e.g === 'shift'), next = T.ev.filter(e => e.g === 'next');
    const tl = `<div class="br14col br14tlcol">${ribbon}<div class="br14tl" tabindex="0" aria-label="${esc(t('br14.tl'))}">
        ${before.length ? `<button class="br14fold" data-act="brBefore14" aria-expanded="${!!S.before14}"><span class="br14car">›</span>${esc(t('br14d.before', { t: hhmm(sw), n: before.length }))}</button><div class="br14early">${before.map(tlRow).join('')}</div>` : ''}
        ${inShift.map(tlRow).join('')}
        <div class="br14ev br14nowrow" data-g="now"><span class="br14tm">${esc(hhmm(now))}</span><span class="br14dt d-o" aria-hidden="true"></span><span class="br14tx">${esc(t('br14.seg.now'))}</span></div>
        ${next.map(tlRow).join('')}</div></div>`;
    /* the footer: the source chips, each with its last update; the three actions */
    const used = new Set(T.ev.map(e => e.src).concat(window.EKO_HO && window.EKO_HO.enabled() ? ['ho'] : []));
    const asOf = (app.data.basis || {}).asOf || hhmm(now), HO = window.EKO_HO;
    const tip = k => t('br14d.chip.' + k + 'L') + t('cu.lblSep') + (k === 'ho' ? (HO && HO.onServer() ? t('br14c.upd.hoSrv', { t: HO.lastSync ? hhmm(HO.lastSync) : asOf }) : t('br14c.upd.hoLocal'))
      : k === 'shift' ? t('br14c.upd.shift') : k === 'fc' ? t('br14c.upd.fc', { t: asOf }) : t('br14c.upd.src', { t: asOf }));
    const chips = SRC14.filter(k => used.has(k)).map(k => `<span class="br14sc" tabindex="0" data-tip="${esc(tip(k))}" aria-label="${esc(tip(k))}">${esc(t('br14d.chip.' + k))}</span>`).join('');
    const foot = `<div class="br14foot"><div class="br14srcs">${chips}</div>
        ${window.EKO_E14 ? window.EKO_E14.siteBtn(app, 'land') : ''}${window.EKO_HO ? window.EKO_HO.prepareButton(app) : ''}${o.full ? `<button class="br14btn" data-act="brBrief">${esc(t('cu.backBrief'))}</button>` : `<button class="br14btn" data-act="brFull">${esc(t('br14.full'))}</button>`}</div>`;
    const body = o.full ? `<div class="br14body br14fullb">${o.full}</div>` : `<div class="br14body">${left}${tl}</div>`;
    return `<section class="br14 br14wrap${glowWriting ? ' writing' : ''}" data-view="${o.full ? 'log' : 'brief'}" data-lens="${esc(p.view.lens)}" data-phase="${writing ? 'gen' : 'rest'}" data-seg="${seg}" data-before="${S.before14 ? 'open' : 'closed'}" role="dialog" aria-label="${esc(t('cu.title'))}" aria-busy="${writing}">
      <div class="br14card">
        <div class="br14hd br14bar"><span class="br14grip" aria-hidden="true"></span>${SPARK14('br14g1')}<h2 class="br14title">${esc(t(o.full ? 'cu.logTitle' : 'cu.title'))}</h2><span class="br14who">${esc(who)}</span><span class="grow"></span>
          <button class="br14ibtn" data-act="cuDismiss">${esc(t('cu.collapse'))}</button></div>
        ${o.full ? '' : `<div class="br14lead">${lead}</div>`}
        ${body}
        ${foot}
      </div>
    </section>`;
  }

  /* ------------------------------ the board (D142) --------------------------
     The Brief OVERLAYS: a board anchored under the top bar, centred over the
     canvas (the viewer column on a site page, the page column elsewhere), on the
     elevated overlay surface with a real shadow. Nothing on the page moves when it
     opens or closes — it is a transient surface (js/shell/surfaces.js) like the
     marker popup, notifications and reports. On a phone it is a bottom sheet. */
  function overlay(app){
    const c = card(app);
    /* D159: the board is rendered WITH the geometry it already has. Each page render creates a
       fresh element, and one without the placement painted at its default width for a frame
       before after() corrected it — that flash is what read as the board jumping. */
    const g = S.box || S.geom;
    const st = g ? ` style="--brL:${Math.round(g.l)}px;--brW:${Math.round(g.w)}px${g.t ? `;--brT:${Math.round(g.t)}px` : ''}${g.h ? `;--brH:${Math.round(g.h)}px` : ''}"` : '';
    const pst = S.pop && S.box && S.box.pop14d ? ` data-moved="1" style="--brL:${Math.round(S.box.x)}px;--brT:${Math.round(S.box.y)}px"` : '';   /* E14b: the pop-up where the reader moved it */
    return c ? `<div class="brfloat${S.pop ? ' brpop' : ''}" role="presentation"${S.pop ? pst : st}>${c}</div>` : '';   /* E14: the pop-up is centred by its CSS */
  }
  /* The count on the top-bar control: the changes since your last visit, when that
     absence earned a Brief — shown whether or not the Brief is open. */
  function newCount(app){
    if(!app || app.state.wall || !qualifies(S.visit)) return 0;
    const arch = archLoad();   /* D150: the boxes since your last visit, less those you archived */
    return feed(app, capped(S.visit)).filter(b => !arch[b.key]).length;
  }
  function control(app){
    E = app;
    if(app.state.wall) return '';
    const t = (k, v) => app.t(k, v), n = newCount(app), open = !!current(app), held = !!S.held;
    const tip = held ? t('bf15.back') : n ? t('cu.ctlTipN', { n }) : t('cu.ctlTip');
    return `<button class="tbbrief tipU${held ? ' held' : ''}" data-act="cuToggle" aria-pressed="${open}" aria-haspopup="dialog" data-tip="${esc(tip)}" aria-label="${esc(tip)}">
      <span class="aiglyph" aria-hidden="true">${icon('spark', 16)}</span><span class="tbbrlbl">${esc(t(held ? 'bf15.back' : 'cu.btn'))}</span>${n ? `<span class="tbbrcnt" aria-hidden="true">${n}</span>` : ''}</button>`;   /* E17b: while Show in the model is open, "Back to Brief" where the word shows, else the sparkle and the count as usual */
  }
  let boardRO = null;
  const FEED_MIN = 360;
  const BOARD_MIN = 480;   /* px of board (the card is 24 less): below this a Brief line wraps word by word (D151) */
  /* D153: the Brief keeps ONE width whatever else is open — a surface that resizes when an
     unrelated panel opens makes the reader re-find every line. It only moves when it must. */
  const boardWidth = () => Math.max(BOARD_MIN, Math.min(innerWidth >= 1600 ? 660 : 560, innerWidth - 24));   /* px: below this the fold budget gives the feed room (D150) */
  function after(){
    const fl = document.querySelector('.brfloat');
    if(boardRO){ boardRO.disconnect(); boardRO = null; }
    if(S.held && !document.getElementById('vpmain')){ collapse('route'); setTimeout(() => E.set({}), 0); }   /* E15: a page without the model ends the focus */
    if(window.EKO_BFOCUS && window.EKO_BFOCUS.active()) window.EKO_BFOCUS.refresh();
    if(!fl){ S.onScreen = false; S.feedTop = 0; S.pinTo = false; S.shown14 = false; return; }
    /* D144: the MODEL AREA — the viewer column less the executive summary, whose KPI
       rows the Brief refers to and so must never cover. The summary sits on the
       leading side (the right in Arabic); the board takes whatever lies beside it,
       up to the right-hand panel (which bounds #vpmain). Pages without a summary
       use the viewer column, else the page column. */
    /* E14: the pop-up is centred over the page by its CSS; only its timeline keeps a scroll position */
    if(fl.classList.contains('brpop')){
      const tl = fl.querySelector('.br14tl');
      if(tl){
        if(!S.tlShown){ S.tlShown = true; tlTo(fl.querySelector('.br14'), 'now'); S.tlTop = tl.scrollTop; }   /* E14c: it opens on Now */
        else tl.scrollTop = S.tlTop || 0;
        tl.addEventListener('scroll', () => { S.tlTop = tl.scrollTop; }, { passive: true });
      }
      /* E14b: moved by its header like the board before it (drop it back near the top to centre it again; a double click on the header does too) */
      /* E14d: the height fits the summary when it opens, then holds until it is closed or the window resizes: a click never changes its size */
      const wrap = fl.querySelector('.br14wrap');
      if(wrap && !E.stacked()){ const vh = innerWidth + 'x' + innerHeight;
        if(S.popH && S.popHFor === vh && !wrap.matches('[data-view="log"]')) wrap.style.height = S.popH + 'px';
        else if(!wrap.matches('[data-view="log"]') && !wrap.querySelector('.br14shim')){ S.popH = Math.round(wrap.getBoundingClientRect().height); S.popHFor = vh; wrap.style.height = S.popH + 'px'; } }
      const b = boxLoad(); if(b && b.pop14d && !E.stacked()){ S.box = b; placePop(fl, b.x, b.y); } else { if(S.box && !S.box.pop14d) S.box = null; delete fl.dataset.moved; }   /* the pop-up's place is its own (E14d: pop14d) */
      dragPop(fl);
      if(!S.shown14 && wrap){ S.shown14 = true; morph14(wrap, document.querySelector('.tbbrief'), true); }   /* E15: it grows out of the Brief button */
      return;
    }
    const main = !E.stacked() && document.getElementById('vpmain');
    const host = main || document.getElementById('mount');
    if(!host) return;
    const sum = main && main.querySelector(':scope > #ovp');
    const place = () => {
      /* D154: the reader's own placement, clamped into the window */
      const b = boxLoad();
      if(b && !b.pop && !E.stacked()){
        const w = Math.max(BOARD_MIN, Math.min(b.w || boardWidth(), innerWidth - 16));
        const l = Math.max(8, Math.min(b.l, innerWidth - w - 8));
        const tp = Math.max(56, Math.min(b.t, innerHeight - 220));   /* always at least a readable strip on screen */
        fl.style.setProperty('--brL', Math.round(l) + 'px'); fl.style.setProperty('--brW', Math.round(w) + 'px');
        fl.style.setProperty('--brT', Math.round(tp) + 'px');
        fl.style.setProperty('--brH', b.h ? Math.round(Math.max(200, Math.min(b.h, innerHeight - tp - 12))) + 'px' : '');
        S.geom = { l, w, t: tp, h: b.h || 0 };
        return;
      }
      fl.style.removeProperty('--brT'); fl.style.removeProperty('--brH');
      const r = host.getBoundingClientRect(); let L = r.left, R = r.right;
      const s = sum && sum.isConnected ? sum.getBoundingClientRect() : null;
      /* D159: the board is placed from STABLE geometry — the page column's box and the
         declared widths of the executive summary and the asset panel. The viewer column
         between them RESIZES while a panel slides in, and anchoring to it made the Brief
         chase the animation left and right. A move under 6 px is not worth making. */
      const W = boardWidth(), rtl = (window.DASHBOARD_ROOT || document.documentElement).dir === 'rtl';
      /* D159: look every element up NOW. A ResizeObserver can fire with nodes the last render
         replaced; measuring a detached summary returned 0 and threw the board across the page
         for a frame, which is the flicker the reader saw when selecting a row. */
      const page = document.getElementById('mount') || host;
      const pageR = page.getBoundingClientRect();
      const sumEl = document.getElementById('ovp');
      const sumW = sumEl && sumEl.isConnected ? (sumEl.offsetWidth || 0) : 0;
      if(!page.isConnected) return;
      /* only the DETAIL panel moves the Brief (D153): the KPI summary stays visible (D144), and
         the module panel is secondary while the Brief is being read, so the board may cover it.
         Its declared width is stable while it animates; the viewer column between them is not. */
      const ap = document.getElementById('assetpanel');
      const endW = ap && ap.isConnected ? (ap.offsetWidth || 0) : 0;
      /* the reading-start side holds the summary; the panels hold the end side */
      const startEdge = (rtl ? pageR.left + endW : pageR.left + sumW) + 8;
      const endEdge = (rtl ? pageR.right - sumW : pageR.right - endW) - 8;
      L = rtl ? Math.max(startEdge, endEdge - W) : Math.min(startEdge, endEdge - W);
      L = Math.max(8, Math.min(L, innerWidth - 8 - W));
      const Lr = Math.round(L), Wr = Math.round(W), prev = +fl.dataset.autoL;
      if(!(prev >= 0) || Math.abs(prev - Lr) >= 6) fl.style.setProperty('--brL', Lr + 'px');
      else L = prev;
      if(fl.dataset.autoW !== String(Wr)) fl.style.setProperty('--brW', Wr + 'px');
      fl.dataset.autoL = Math.round(L); fl.dataset.autoW = Wr;
      S.geom = { l: Math.round(L), w: Wr };   /* the next render starts from here, not from nothing */
    };
    place();
    /* D159: the asset panel is NOT observed — it animates, and re-placing the board on every
       frame of its slide is what made the Brief drift left and right; its final width is read
       in place() instead, on the renders that matter */
    if(window.ResizeObserver){ boardRO = new ResizeObserver(() => { if(document.querySelector('.brfloat')) place(); });
      boardRO.observe(host); const s0 = document.getElementById('ovp'); if(s0) boardRO.observe(s0); }
    /* D144: the fold budget — one step at a time while the board overflows the window
       (the board alone is re-rendered; nothing else on the page moves) */
    const cd = fl.querySelector('.cucard');
    /* D150: the budget also steps while the FEED is shorter than FEED_MIN — the feed is the Brief now */
    const fd = cd && cd.querySelector('.cufeed');   /* only the full log has one */
    const short = fd && fd.scrollHeight > fd.clientHeight + 1 && fd.clientHeight < FEED_MIN;
    if(cd && !E.stacked() && S.fit < 3 && (cd.scrollHeight > cd.clientHeight + 1 || short)){ S.fit++; fl.innerHTML = nbH(card(E)); after(); return; }
    feedScroll(fl);
    tableScroll(fl);
    dragBind(fl);
  }
  /* E14d: THE POP-UP'S DRAG. The header band and the sentence band are the handle (cursor grab, no text selection,
     touch-action none); a button never starts it; it starts after 4 px of movement; the pop-up stays inside the page
     area under the top bar; its place is remembered per user; a double click on the header puts it back. */
  const TOP14 = 52 + 8;
  function morph14(el, to, grow, done){
    if(!el || !to || reduceMotion() || !el.animate){ if(done) done(); return; }
    const r = el.getBoundingClientRect(), b = to.getBoundingClientRect(); if(!r.width || !r.height){ if(done) done(); return; }
    const k = { transform: `translate(${b.left - r.left}px,${b.top - r.top}px) scale(${b.width / r.width},${b.height / r.height})`, opacity: 0, filter: 'blur(8px)' }, z = { transform: 'none', opacity: 1, filter: 'blur(0)' };
    el.style.transformOrigin = '0 0';
    const a = el.animate(grow ? [k, z] : [z, k], { duration: grow ? 520 : 460, easing: grow ? 'cubic-bezier(.2,.8,.2,1)' : 'cubic-bezier(.55,0,.25,1)', fill: grow ? 'none' : 'forwards' });
    a.onfinish = () => { if(done) done(); };
    return a;
  }
  /* collapse into the button; the next open grows out of it */
  function shrinkThen(done){
    if(S.shrinking) return; const w = document.querySelector('.br14wrap');
    if(!w){ done(); return; }
    S.shrinking = true; S.shrinkA = morph14(w, document.querySelector('.tbbrief'), false, () => { S.shrinking = false; S.shrinkA = null; done(); });
    if(!S.shrinkA) S.shrinking = false;
  }
  /* E15: Show in the model. The Brief shrinks into its button and is held there (its scroll and ribbon kept) */
  function shrinkInto(cb){ shrinkThen(() => { S.held = true; S.forced = true; S.shown14 = false; E.set({}); if(cb) cb(); }); }
  function unhold(){ if(!S.held) return; S.held = false; if(!S.forced){ open(null); return; } E.set({}); }
  /* the items the focus card steps through: Act now and Coming up rows with an asset, and the timeline's events with one */
  function focusData(){
    const app = E, p = app && current(app); if(!p) return null;
    const t = (k, v) => app.t(k, v), S14 = p.view.sections || sections14(app, p), T = events14(app, p), sep = t('cu.lblSep');
    const place = id => { const r = (app.data.assets || []).find(x => x.id === id); if(!r) return ''; const ar = app.lang === 'ar';
      return [ar ? (r.levelAr || r.level) : r.level, ar ? (r.zoneAr || r.zone) : r.zone].filter(Boolean).join(sep); };
    const items = S14.detect.filter(x => x.asset).map(x => ({ key: x.key, sec: 'detect', secLabel: t('br14c.s.detect'), sev: x.sev, tag: x.tag, text: x.text, meta: x.meta, act: x.act, pri: !!(x.risk && x.act && x.act.act === 'ackAlarm'), asset: x.asset }))
      .concat(S14.coming.filter(x => x.asset).map(x => ({ key: x.key, sec: 'coming', secLabel: t('br14c.s.coming'), sev: 'pred', tag: String(x.text).includes(x.asset) ? '' : x.asset, text: x.text, meta: place(x.asset), act: x.act, asset: x.asset })));
    const tl = T.ev.filter(e => e.asset).map(e => ({ key: e.key, sec: 'tl', secLabel: t('br14.tl'), sev: e.kind === 'crit' ? 'critical' : e.kind === 'warn' ? 'high' : '', tag: '', text: e.text,
      meta: [hhmm(e.ms), place(e.asset)].filter(Boolean).join(sep), act: { act: 'openAsset', data: { asset: e.asset }, label: t('br14c.inModel') }, asset: e.asset }));
    return { items, tl };
  }
  function placePop(fl, x, y){
    const c = fl.querySelector('.br14wrap'); if(!c) return;
    const w = c.offsetWidth, h = c.offsetHeight;
    const cx = Math.max(8, Math.min(x, innerWidth - w - 8)), cy = Math.max(TOP14, Math.min(y, innerHeight - Math.min(h, innerHeight - TOP14 - 8) - 8));
    fl.style.setProperty('--brL', Math.round(cx) + 'px'); fl.style.setProperty('--brT', Math.round(cy) + 'px'); fl.dataset.moved = '1';
    return { x: cx, y: cy };
  }
  function dragPop(fl){
    if(E.stacked() || fl.dataset.drag) return;
    fl.dataset.drag = '1';
    const wrap = fl.querySelector('.br14wrap'); if(!wrap) return;
    const down = ev => {
      if((ev.button != null && ev.button !== 0) || ev.target.closest('button, a, select, input, textarea') || innerWidth <= 820) return;
      const r = wrap.getBoundingClientRect(), x0 = ev.clientX, y0 = ev.clientY;
      let started = false, last = null;
      const move = e => {
        const dx = e.clientX - x0, dy = e.clientY - y0;
        if(!started){ if(Math.hypot(dx, dy) < 4) return; started = true; fl.dataset.dragging = 'move'; try{ getSelection().removeAllRanges(); }catch(x){} }
        e.preventDefault(); last = placePop(fl, r.left + dx, r.top + dy);
      };
      const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); document.removeEventListener('pointercancel', up);
        if(!started) return;   /* a click: nothing moves, nothing is re-laid out */
        delete fl.dataset.dragging;
        if(last){ S.box = { x: last.x, y: last.y, pop14d: true }; boxSave(); } };
      document.addEventListener('pointermove', move); document.addEventListener('pointerup', up); document.addEventListener('pointercancel', up);
    };
    wrap.querySelectorAll('.br14hd, .br14lead').forEach(h => h.addEventListener('pointerdown', down));
    const hd = wrap.querySelector('.br14hd');
    if(hd) hd.addEventListener('dblclick', e => { if(e.target.closest('button')) return; S.box = null; boxSave(); delete fl.dataset.moved; fl.style.removeProperty('--brL'); fl.style.removeProperty('--brT'); });
  }
  /* D154: drag by the header, resize from the end corner; pointer events, so a touch panel
     works the same. The geometry is written on drop, never on every frame's re-render. */
  function dragBind(fl){
    if(E.stacked() || fl.dataset.drag) return;
    fl.dataset.drag = '1';
    const card = fl.querySelector('.cucard'); if(!card) return;
    const head = card.querySelector('.cuhead') || card.querySelector('.br14bar');   /* E14b: the pop-up's header */
    const start = (ev, mode) => {
      if(ev.button != null && ev.button !== 0) return;
      if(mode === 'move' && ev.target.closest('button, select, a, .cuwin2, [role="tab"]')) return;
      const r = card.getBoundingClientRect(), x0 = ev.clientX, y0 = ev.clientY;
      const box = { l: r.left, t: r.top, w: r.width + 24, h: r.height };
      card.setPointerCapture && ev.pointerId != null && (ev.target.setPointerCapture ? ev.target.setPointerCapture(ev.pointerId) : 0);
      /* E14c: the drag starts after 4 px of movement, so a plain click inside the header never moves the Brief */
      let started = false;
      let raf = 0, lastH = mode === 'size' ? box.h : innerHeight - box.t - 76;
      const move = e => {
        const dx = e.clientX - x0, dy = e.clientY - y0, rtl = (window.DASHBOARD_ROOT || document.documentElement).dir === 'rtl';
        if(!started){ if(Math.hypot(dx, dy) < 4) return; started = true; fl.dataset.dragging = mode; e.preventDefault(); }
        if(mode === 'move'){ S.box = { l: box.l - 12 + dx, t: box.t - 12 + dy, w: box.w, h: S.box && S.box.h };  }
        else { const w = Math.max(BOARD_MIN, box.w + (rtl ? -dx : dx)), h = Math.max(220, box.h + dy);
               S.box = { l: rtl ? box.l - 12 - (w - box.w) : box.l - 12, t: box.t - 12, w, h }; }
        S.boxFor = boxKey(); place2(fl);
        /* D155: while RESIZING, the rows follow the box in the same frame — the reader sees the
           Brief grow, not settle with a jolt when the pointer is released */
        if(!raf) raf = requestAnimationFrame(() => { raf = 0;
          /* the room the board has: its own height when resized, else what is left below its top */
          const h = (S.box && S.box.h) || (innerHeight - ((S.box && S.box.t) || 64) - 76);
          if(Math.abs(h - lastH) < 10) return;
          lastH = h; refit(fl);
        });
      };
      const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up);
        if(raf){ cancelAnimationFrame(raf); raf = 0; }
        if(!started) return;   /* a click, not a drag: nothing moves, nothing is re-laid out */
        delete fl.dataset.dragging;
        /* dropped near where the Brief would place it: hand the placement back */
        const auto = fl.dataset.autoL != null ? +fl.dataset.autoL : null;
        if(S.box && auto != null && Math.abs(S.box.l - auto) < 24 && Math.abs(S.box.t - 64) < 24 && !S.box.h){ S.box = null; }
        if(fl.classList.contains('brpop')){
          /* dropped back near its anchor (under the Brief button) it returns there */
          const r2 = card.getBoundingClientRect(), rtl = (window.DASHBOARD_ROOT || document.documentElement).dir === 'rtl';
          const near = rtl ? Math.abs(r2.left - 16) < 24 : Math.abs(innerWidth - r2.right - 16) < 24;
          if(S.box) S.box.pop14 = true;
          if(near && Math.abs(r2.top - 60) < 24){ S.box = null; delete fl.dataset.moved; fl.style.removeProperty('--brL'); fl.style.removeProperty('--brT'); }
          boxSave(); return; }
        boxSave(); noAnim(fl); refit(fl); };
      document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
    };
    if(head){ head.addEventListener('pointerdown', e => start(e, 'move'));
      head.addEventListener('dblclick', e => { if(e.target.closest('button, select, .cuwin2')) return; S.box = null; boxSave(); E.set({}); }); }
    const rz = card.querySelector('.brrz'); if(rz) rz.addEventListener('pointerdown', e => start(e, 'size'));
  }
  /* D155: re-fit the BOARD alone — the fold budget from scratch, in one task, so the reader
     never sees the intermediate steps; the page is not re-rendered at all. */
  /* D157: repaint the board alone (the page is untouched), so a toggle or a control inside the
     Brief never costs a full render — that is what flickered */
  function paint(){
    const fl = document.querySelector('.brfloat');
    if(!fl || !E) return E && E.set({});
    S.fit = 0; delete fl.dataset.drag; fl.innerHTML = nbH(card(E)); after();
  }
  function refit(fl){
    S.fit = 0;
    delete fl.dataset.drag;          /* the header is about to be replaced: let it bind again */
    fl.innerHTML = nbH(card(E));
    after();
  }
  function noAnim(fl){
    fl.dataset.noanim = '1';
    clearTimeout(noAnim.t); noAnim.t = setTimeout(() => { const b = document.querySelector('.brfloat'); if(b) delete b.dataset.noanim; }, 260);
  }
  /* the live geometry while dragging (no re-render: the board only moves) */
  function place2(fl){
    const b = S.box; if(!b) return;
    if(fl.classList.contains('brpop')) fl.dataset.moved = '1';
    const w = Math.max(BOARD_MIN, Math.min(b.w, innerWidth - 16));
    fl.style.setProperty('--brL', Math.round(Math.max(8, Math.min(b.l, innerWidth - w - 8))) + 'px');
    fl.style.setProperty('--brT', Math.round(Math.max(56, Math.min(b.t, innerHeight - 220))) + 'px');
    fl.style.setProperty('--brW', Math.round(w) + 'px');
    if(b.h) fl.style.setProperty('--brH', Math.round(Math.max(200, Math.min(b.h, innerHeight - b.t - 12))) + 'px');
  }
  /* D150: the feed keeps its scroll position across re-renders; a segment chosen (or the
     Brief first shown) scrolls to that segment: a past segment to its first box, with
     the timeline running on to Now; the future to Now, the scheduled boxes after it */
  function feedScroll(fl){
    const f0 = fl.querySelector('.cufeed');
    if(!f0) return;
    /* the scroller: the feed on desktop; on a phone the whole sheet scrolls as one (D150) */
    const f = getComputedStyle(f0).overflowY === 'visible' ? f0.closest('.cucard') : f0;
    if(!S.onScreen){ S.onScreen = true; if(S.restoreTop){ S.restoreTop = false; S.pinTo = false; } else S.scrollSeg = 'instant'; }   /* D164: a restored Brief keeps its scroll position */
    if(S.scrollSeg){ S.pinTo = true; S.pinMode = S.scrollSeg; }
    /* until the reader scrolls, the feed stays aligned to the chosen segment (a late font or
       re-render never leaves it a few pixels off); measured on the LAYOUT, never on transforms */
    if(S.pinTo){
      const pin = f.querySelector('.cupin'), sticky = !!pin && getComputedStyle(pin).position === 'sticky';
      const pinH = sticky ? pin.offsetHeight - 2 : 0;   /* the sticky wrapper (top -2px) covers exactly this much */
      const seg = f0.closest('.cucard').dataset.seg;
      const tgt = seg === 'next' ? f.querySelector('.ptlnow') : f.querySelector('.ptli[data-hl="1"]');
      const off = el => { let y = 0; for(let e = el; e && e !== f && f.contains(e); e = e.offsetParent) y += e.offsetTop; return f.contains(f.offsetParent) ? y : y - (f === f0 ? f.offsetTop : 0); };
      /* D151: where Start here scrolls with the feed (a short screen), the Brief opens at the top, Start here first */
      const top = pin && !sticky && S.pinMode === 'instant' ? 0 : tgt ? Math.max(0, off(tgt) - pinH - (seg === 'next' ? 6 : 0)) : 0;
      const smooth = S.scrollSeg === 'smooth' && !(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
      S.ownScrollUntil = Date.now() + (smooth ? 900 : 80);
      if(smooth && f.scrollTo) f.scrollTo({ top, behavior: 'smooth' }); else f.scrollTop = top;
      S.feedTop = top; S.scrollSeg = false;
      if(document.fonts && document.fonts.ready && !S.fontsHooked){ S.fontsHooked = true; document.fonts.ready.then(() => { const b = document.querySelector('.brfloat'); if(b && S.pinTo) feedScroll(b); }); }
    } else f.scrollTop = S.feedTop || 0;
    f.addEventListener('scroll', () => { S.feedTop = f.scrollTop; if(Date.now() > (S.ownScrollUntil || 0)) S.pinTo = false; }, { passive: true });
  }

  /* D164: the shift log's table (the Brief's default layer) scrolls on its own. Its position is
     remembered for a page-change restore only: reopened after a page change, the table returns
     to where the reader left it and holds there through the opening re-fits until the reader
     scrolls; a fresh open starts at the top, as before. */
  function tableScroll(fl){
    const t = fl.querySelector('.btable'); if(!t) return;
    if(S.restoreTable != null){ S.ownTableScroll = true; t.scrollTop = S.restoreTable; }
    S.tableTop = t.scrollTop;
    t.addEventListener('scroll', () => { if(S.ownTableScroll){ S.ownTableScroll = false; return; } S.restoreTable = null; S.tableTop = t.scrollTop; }, { passive: true });
  }

  /* --------------------------------- opening ------------------------------- */
  /* The Brief renders on the site Overview and the Portfolio. Opened from
     anywhere else it takes you to the Overview first. */
  function open(kind){
    if(S.shrinkA){ S.shrinkA.onfinish = null; S.shrinkA.cancel(); S.shrinkA = null; } S.shrinking = false;   /* E15: an open wins over a collapse still shrinking */
    /* D164: reopened from its control after a page change collapsed it, the Brief comes back as the
       reader left it: the same window, ribbon segment, layer and feed scroll position */
    const r = kind == null ? S.resume : null; S.resume = null;
    if(r){ S.forced = true; S.replay = true; S.fit = 0; S.showArch = false; S.winKind = r.winKind; S.seg = r.seg; S.full = r.full;
      S.feedTop = r.feedTop; S.restoreTable = r.tableTop; S.scrollSeg = false; S.pinTo = false; S.restoreTop = true; E.set({ born: 'catchup', dlg: null }); return; }
    S.restoreTable = null; S.tableTop = 0;
    S.forced = true; S.replay = true; S.fit = 0; S.showArch = false; S.scrollSeg = 'instant'; S.full = false; S.tlShown = false; S.seg14 = null;
    writeStart(); S.popH = 0;
    /* no window asked for: the last visit when that absence earned a Brief, else the shift so far;
       'h24' or 'next' (D150) open on that ribbon segment over the default primary window */
    S.winKind = PRIM.includes(kind) && (kind !== 'visit' || S.visit) ? kind : (qualifies(S.visit) ? 'visit' : 'shift');
    S.seg = kind === 'h24' || kind === 'next' ? kind : S.winKind;
    E.set({ born: 'catchup', dlg: null });   /* D142: an overlay opens where you are */
  }
  /* Collapse returns the Brief to its top-bar control: "not now" for the automatic
     Brief (recorded against the VISIT window), never a deletion — the control stays,
     with its count, and reopens it. D164: a PAGE CHANGE (the surface manager's route
     sweep, why = 'route') also remembers where the reader was, so the next reopen from
     the control restores it; any other collapse (the control, Escape, another surface)
     forgets it. The Brief is anchored over the model area, so it never follows the
     reader onto another page's layout. */
  /* E14d: the summary is written: two shimmer lines for 0.9 s at least, then its words fade in (none of it with reduced motion) */
  function writeStart(){
    if(reduceMotion()) return;
    S.writeUntil = Date.now() + 900; S.wordsFor = null; clearTimeout(S.writeT);
    S.writeT = setTimeout(() => { if(document.querySelector('.br14wrap')) paint(); }, 950);
  }
  function collapse(why){
    if(S.shrinkA){ S.shrinkA.onfinish = null; S.shrinkA.cancel(); S.shrinkA = null; } S.shrinking = false;   /* E16: a close that is not the button (a page change, Escape, another surface) ends a shrink still running, so its finish never undoes this collapse */
    if(S.held){ S.held = false; if(window.EKO_BFOCUS) window.EKO_BFOCUS.reset(); }
    S.resume = why === 'route' ? { winKind: S.winKind, seg: S.seg, full: S.full, feedTop: S.feedTop || 0, tableTop: S.tableTop || 0 } : null;
    S.restoreTable = null;
    if(S.visit){ S.dismissed = { since: Math.round(S.visit.atMs / 60000), at: Date.now() }; ss.set(LSD, JSON.stringify(S.dismissed)); }
    S.forced = false; S.winKind = null; S.seg = null; S.showArch = false; S.full = false; S.hoAutoKey = null; S.autoNow = false;   /* E9: a closed automatic showing does not come back this session */
  }

  /* --------------------------------- actions ------------------------------- */
  const ACTS = {
    /* closing always records against the VISIT window, so closing an on-demand
       Brief never lets the automatic one reappear in its place */
    cuDismiss(){ shrinkThen(() => { collapse(); E.set({}); }); },
    /* the top-bar control: open the Brief, or collapse it back */
    cuToggle(){ if(S.held){ if(window.EKO_BFOCUS) window.EKO_BFOCUS.back(); else unhold(); return; } if(current(E)) shrinkThen(() => { collapse(); E.set({}); }); else open(null); },
    /* the account menu, the Overview header button and the scheduled notification */
    cuOpen(el){ open(el && el.dataset ? el.dataset.win : null); },
    brElse(){ S.elseOpen = !S.elseOpen; E.set({}); },   /* E13: everything else, under the persona's three */
    /* E14: the pop-up's ribbon highlights a range on the timeline (it never hides the rest) */
    brSeg14(el){ const v = el.dataset.v; if(!['h24', 'shift', 'now', 'next'].includes(v)) return; S.seg14 = v;
      const card = (el.closest && el.closest('.br14')) || document.querySelector('.br14'); if(!card) return;
      card.dataset.seg = v; card.querySelectorAll('.br14seg').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === v)));
      if(v === 'h24'){ S.before14 = true; card.dataset.before = 'open'; const bb = card.querySelector('.br14fold'); if(bb) bb.setAttribute('aria-expanded', 'true'); }
      tlTo(card, v); },
    brBefore14(el){ S.before14 = !S.before14; const card = (el.closest && el.closest('.br14')) || document.querySelector('.br14'); if(!card) return; card.dataset.before = S.before14 ? 'open' : 'closed'; const b = card.querySelector('.br14fold'); if(b) b.setAttribute('aria-expanded', String(!!S.before14)); },
    /* E14: replay the writing: the skeleton and the glow, then the sentence again */
    brReplay(){ S.forced = true; writeStart(); paint(); },
    /* D150: a ribbon segment (a button, or the narrow dropdown) scrolls to and highlights its boxes */
    brSeg(el){ const v = el.dataset.v || el.value; if(!v) return; S.forced = true; S.seg = v; S.scrollSeg = 'smooth'; paint(); },
    /* archive: THIS reader's Brief only — the alarm, the work order, the source never change */
    brArch(el, ev){ if(ev) ev.stopPropagation(); const k = el.dataset.k; if(!k) return; archLoad()[k] = Date.now(); archSave(); S.forced = true; paint(); },
    brRestore(el, ev){ if(ev) ev.stopPropagation(); const a = archLoad(); delete a[el.dataset.k]; archSave(); if(!Object.keys(a).length) S.showArch = false; S.forced = true; paint(); },
    brShowArch(){ S.showArch = !S.showArch; S.forced = true; paint(); },
    /* D154: hand the placement back to the Brief */
    brReset(){ S.box = null; boxSave(); S.forced = true; paint(); },
    /* D152: the Brief (a shift log) and the full log (the timeline) — the only two layers */
    brFull(el){ S.full = true; S.forced = true; S.showArch = false; S.scrollSeg = 'instant';
      if(el && el.dataset.v === 'due') S.seg = 'next'; paint(); },
    brBrief(){ S.full = false; S.forced = true; if(S.seg === 'next') S.seg = null; paint(); },
    /* D164 (replaces D156's keepRoute): a row that opens a PAGE is a page change like any other:
       the Brief collapses to its control and restores its place when reopened (collapse('route')) */
    cuGoAlarms(){ E.go(E.overviewId(), 'overview', null); },
    cuGoRegister(){ E.go('assets-register', 'assets', 'reg'); },
    cuGoPage(el){ E.go(el.dataset.page, el.dataset.mod, el.dataset.sub || null); }
  };

  /* -------------------------------- lastSeen ------------------------------- */
  /* Stamped on MEANINGFUL activity — a load, a route change, a panel opened, an
     acknowledgement (every user action goes through app.js's dispatcher, which
     calls this) — never on a poll, and debounced so a busy session or a second
     tab does not rewrite it on every click. In production this is a debounced
     POST to the server (handoff/brief.md); here it is localStorage. */
  function touch(force){
    if(!E) return;
    const now = Date.now();
    if(!force && now - S.touchedAt < cfg().touchDebounceS * 1000) return;
    S.touchedAt = now;
    ls.set(visitKey(), String(now));
  }

  /* ------------------------------- scheduled -------------------------------
     OFF by default (data.brief.schedule.enabled). When on, the Brief is
     delivered at each shift start as a notification with a deep link, through
     the report engine's delivery path (EKO_R.deliver) — the same path a
     generated report takes. Once per shift per user per site. */
  function scheduleTick(){
    const sc = cfg().schedule || {};
    if(!sc.enabled || !E || E.state.wall) return false;
    const sw = shiftWindow();
    if(!sw) return false;
    const dd = new Date(sw.atMs);
    const slot = LSS + ':' + who() + ':' + dd.toDateString() + ':' + sw.startMin;
    if(ls.get(slot)) return false;
    ls.set(slot, String(Date.now()));
    const deliver = window.EKO_R && window.EKO_R.deliver;
    const n = { type: 'brief.ready', actorId: 'system', siteId: E.data.id || E.data.key || 'marsa',
      params: { site: E.data.id || E.data.key || 'marsa', t: hhmm(sw.atMs), win: sc.window || 'shift' }, source: { kind: 'brief', id: slot } };
    if(deliver) deliver(E, n, 'brief.deliver', 'brief');
    else if(window.EKO_NOTIF) window.EKO_NOTIF.add(n);
    return true;
  }

  /* ---------------------------------- init --------------------------------- */
  /* Read the stored lastSeen ONCE, then stamp this visit, so a reload inside
     the session does not swallow the window the user actually returned to. */
  function init(app){
    E = app;
    S.visit = visitWindow();
    S.loadAt = Date.now(); S.mem = null;   /* D141: what this load's Briefs remember against */
    touch(true);
    try{ S.dismissed = JSON.parse(ss.get(LSD) || 'null'); }catch(e){ S.dismissed = null; }
    /* DEMO ONLY (D129 rule): a demo must never lose the Brief, so every LOAD forgets
       the dismissal. Inside the session dismissing still works normally. A client
       build never reaches this line. */
    if(demo()){ ss.del(LSD); S.dismissed = null; S.arch = {}; S.archFor = archKey(); archSave(); }   /* D150: and the archive (a demo never drifts) */
    if(S.schedTimer) clearInterval(S.schedTimer);
    if((cfg().schedule || {}).enabled){ setTimeout(scheduleTick, 0); S.schedTimer = setInterval(scheduleTick, 60000); }
  }
  /* test and demo seams: force a visit window, clear the dismissal */
  function simulate(gapH){ S.visit = gapH == null ? null : { kind: 'visit', gapH, atMs: Date.now() - gapH * 36e5 };
    if(E) E.set({}); }
  function reset(){ S.resume = null; S.restoreTop = false; S.restoreTable = null; S.tableTop = 0; S.mem = null; S.dismissed = null; S.hoAutoKey = null; S.fit = 0; S.forced = false; S.winKind = null; S.seg = null; S.showArch = false; S.full = false; S.arrival = null; ss.del(LSD); NARR.clear(); S.pending = {}; if(E) E.set({}); }

  return { init, card, overlay, control, collapse, after, open, actNow: app => actNow14(app || E), shrinkInto, unhold, isHeld: () => !!S.held, focusData, memory: () => memLoad(), continuity: app => continuity(app || E), lookahead: app => lookahead(app || E), payload: (app, kind) => payload(app || E, windowFor(kind || 'visit') || windowFor('h8')),
           ACTS, deltas, windows, recommend, recurrence: app => recurrence(app || E), calm: app => { const w = windowFor('visit') || windowFor('h8'), d = deltas(app || E, w); return calm(app || E, d, d.items.length ? recommend(app || E, d) : null); }, shiftWindow: () => shiftWindow(), simulate, reset, touch, scheduleTick, isOpen,
           canOpen: () => true, get state(){ return S; }, get narrationCache(){ return NARR; } };
})();
