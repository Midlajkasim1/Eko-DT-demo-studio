/* ============================================================================
   PERSONAS (E13). The partner meeting is told by persona: the chief operator,
   the executive, the HVAC and electrical engineer, the security and life
   safety officer and the facility manager. Each one is a "View as" choice in
   the account menu, mapped to a role (the role decides what may be seen; the
   persona decides where the person lands, the sentence that greets them, and
   what their Brief puts first).
     chief operator      technician   the Overview, with the Brief
     executive           executive    the executive summary (this file)
     engineer            engineer     Systems, HVAC
     security officer    security     the Security overview          (new role, as technician)
     facility manager    manager      Maintenance                    (new role, as engineer, with money)
   The money rule: AED is shown to the executive and the facility manager only
   (and to the ESG partner where the site allows it: js/esg.js moneyOk).
   Every figure comes from the pages' own sources (the engine on the Demo
   Medical Centre); nothing here invents a number.
   ============================================================================ */
window.EKO_PERSONA = (function(){
  'use strict';
  const C = () => window.EKO_C, O = () => window.EKO_OPS;
  const esc = s => C().esc(s), fmt = (v, d) => C().fmt(v, d);
  const LIST = ['operator', 'executive', 'engineer', 'security', 'fm'];
  const ROLE = { operator: 'technician', executive: 'executive', engineer: 'engineer', security: 'security', fm: 'manager' };
  const OF_ROLE = { technician: 'operator', executive: 'executive', engineer: 'engineer', security: 'security', manager: 'fm' };
  const L = (E, en, ar) => E.lang === 'ar' ? (ar || en) : en;

  /* the two new roles, on every site: the security officer sees what the technician sees (plain wording); the facility manager
     what the engineer sees (technical wording, the team's Brief and the handover review) */
  const clone = o => JSON.parse(JSON.stringify(o));
  function addRoles(d){
    const R = d && d.roles; if(!R) return;
    if(!R.security && R.technician) R.security = Object.assign(clone(R.technician), { landing: 'site' });
    if(!R.manager && R.engineer) R.manager = Object.assign(clone(R.engineer), { landing: 'site' });
    const P = d.permissionDefaults || (d.permissionDefaults = {});
    ['canSeeTeamBrief', 'canReviewHandovers'].forEach(k => { P[k] = P[k] || []; if(P[k].includes('engineer') && !P[k].includes('manager')) P[k].push('manager'); });
  }
  Object.keys(window.EKO_DATA || {}).forEach(k => addRoles(window.EKO_DATA[k]));

  /* the persona: the one chosen, while its role is the one in use; else the role's own persona */
  const of = E => { const p = E.state.persona, r = E.role(); return p && ROLE[p] === r ? p : (OF_ROLE[r] || null); };
  const money = E => { const r = E.role(); return r === 'executive' || r === 'manager'; };
  const hasExec = E => !!(E.sim && window.EKO_EM && E.data.energyModel);
  /* each persona's landing on this site */
  function landing(E){
    const p = of(E); if(!p) return null;
    if(p === 'operator') return { pageId: E.overviewId(), module: 'overview', sub: null };
    if(p === 'executive') return hasExec(E) ? { pageId: 'exec', module: 'exec', sub: null } : ((E.data.sites || []).length > 1 ? { pageId: 'portfolio', module: 'overview', sub: null } : { pageId: E.overviewId(), module: 'overview', sub: null });
    if(p === 'engineer') return { pageId: 'systems', module: 'systems', sub: 'hvac' };
    if(p === 'security') return window.EKO_SEC && E.data.security ? { pageId: 'sec', module: 'security', sub: null } : { pageId: E.overviewId(), module: 'overview', sub: null };
    if(p === 'fm') return { pageId: 'mnt', module: 'maintenance', sub: null };
    return null;
  }
  const onLanding = E => { const l = landing(E); return !!l && E.state.pageId === l.pageId && (l.sub == null || E.state.sub === l.sub); };

  /* ------------------------------- the figures ------------------------------- */
  const alarmsOpen = E => (E.visAlarms ? E.visAlarms() : (E.data.alarms || [])).filter(a => !a.shelved);
  const SEVR = { critical: 0, high: 1, medium: 2, low: 3 };
  const bySev = list => list.slice().sort((a, b) => (SEVR[a.sev] - SEVR[b.sev]) || (a.ack ? 1 : 0) - (b.ack ? 1 : 0) || (b.ageH || 0) - (a.ageH || 0));
  const plain = (E, a) => L(E, a.plainEn, a.plainAr) || (E.alarmLines ? E.alarmLines(a, true).main : a.asset);
  const where = (E, a) => (E.loc ? E.loc(a, 'loc') : null) || L(E, a.locEn, a.locAr) || a.asset;
  const HVAC = ['ahu', 'chw', 'heat'], ENG = HVAC.concat(['elec']), SECF = ['sec', 'fire'];
  const sysOfAsset = (E, id) => ((E.data.assets || []).find(x => x.id === id) || {}).sys;
  const backlog = E => window.EKO_MNT ? window.EKO_MNT.backlog(E) : [];
  const pmTotals = E => { const R = window.EKO_MNT ? window.EKO_MNT.pmRows(E) : []; const done = R.reduce((s, r) => s + r.done, 0), due = R.reduce((s, r) => s + r.due, 0);
    const low = R.filter(r => r.due > 0).sort((a, b) => a.done / a.due - b.done / b.due)[0] || null;   /* a system with nothing due is not the lowest */ return { done, due, pct: due ? done / due * 100 : null, low }; };
  const forecast = E => { try{ return window.EKO_EM.of(E).forecast(E); }catch(e){ return null; } };
  const tariff = E => (E.data.basis || {}).aedPerKwh || 0;
  const mon = (E, ms, k) => { const d = new Date(ms); d.setDate(1); d.setMonth(d.getMonth() + (k || 0)); return E.ph(['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][d.getMonth()]); };
  const predictions = E => { try{ return (window.EKO_PROVE ? window.EKO_PROVE.predictions(E) : []).filter(p => p.state === 'drift'); }catch(e){ return []; } };

  /* the risks the executive sees, ranked: the alarms that put care or safety at risk, the money over budget, what is coming */
  function risks(E){
    const t = E.t.bind(E), out = [];
    bySev(alarmsOpen(E)).filter(a => a.sev === 'critical' || a.sev === 'high').slice(0, 2).forEach(a => out.push({ key: 'al:' + a.id, sev: a.sev, what: a.asset + t('cu.lblSep') + plain(E, a), why: t('per.risk.alarm.' + a.sev), act: { act: 'openAsset', data: { asset: a.asset }, label: t('per.act.open') } }));
    const F = forecast(E);
    if(F && F.next && F.budgetNext && F.next.v > F.budgetNext) out.push({ key: 'budget', sev: 'medium', short: t('per.s.budget', { m: mon(E, E.nowMs(), 1) }), what: t('per.risk.budget', { m: mon(E, E.nowMs(), 1), f: fmt(F.next.v, 0), d: fmt(F.next.v - F.budgetNext, 0), b: fmt(F.budgetNext, 0) }),
      why: money(E) && tariff(E) ? t('per.risk.budgetAed', { aed: fmt((F.next.v - F.budgetNext) * 1000 * tariff(E), 0) }) : t('per.risk.budgetWhy'), act: { act: 'goSub', data: { page: 'fcst', mod: 'energy', sub: 'fcst' }, label: t('per.act.forecast') } });
    predictions(E).slice(0, 1).forEach(p => out.push({ key: 'pv:' + p.asset, sev: 'medium', what: p.asset + t('cu.lblSep') + t('per.risk.pred', { point: p.point, n: Math.round(p.days) }), why: t('per.risk.predWhy'), act: { act: 'openAsset', data: { asset: p.asset }, label: t('per.act.open') } }));
    return out.slice(0, 3);
  }
  /* compliance and tests: PM done against due, the life safety tests (the Health and tests page's sources) */
  function compliance(E){
    const t = E.t.bind(E), pm = pmTotals(E), s = E.data.security || {}, f = s.fire || {}, pw = s.power || {}, gs = pw.genSchedule || null, ft = (f.tests || [])[0] || null, m = E.data.maintenance || {};
    return { pm, sla: m.slaMetPct, fireTest: ft, gen: gs, rows: [
      pm.due ? { k: t('per.c.pm'), v: t('per.c.pmV', { d: pm.done, n: pm.due, p: fmt(pm.pct, 0) }), tone: pm.pct >= 95 ? 'ok' : 'warn', go: ['mnt', 'maintenance'], rank: 2, short: t('per.s.pm') } : null,
      m.slaMetPct != null ? { k: t('per.c.sla'), v: fmt(m.slaMetPct, 1) + '%', tone: m.slaMetPct >= 90 ? 'ok' : 'warn', go: ['mnt', 'maintenance'], rank: 1, short: t('per.s.sla') } : null,
      ft ? { k: t('per.c.fire'), v: t('per.c.testV', { d: ft.date, r: t('p2.test.' + ft.result) }), tone: ft.result === 'pass' ? 'ok' : 'warn', go: ['sec-health', 'security', 'health'], rank: 4, short: t('per.s.fire') } : null,
      gs ? { k: t('per.c.gen'), v: gs.overdueD ? t('per.c.genOver', { l: gs.last, d: gs.overdueD }) : t('per.c.genOk', { l: gs.last, n: gs.next || t('emptyDash') }), tone: gs.overdueD ? 'warn' : 'ok', go: ['sec-power', 'security', 'power'], rank: 3, short: t('per.s.gen') } : null].filter(Boolean) };
  }

  /* ------------------------------- the headline ------------------------------- */
  /* E16: "{n} open alarms, {k} need you now; the first: ..." where k and the first are the Brief's Act now (EKO_BRIEF.actNow) */
  function needLine(E, n, base){
    const t = E.t.bind(E), A = window.EKO_BRIEF && window.EKO_BRIEF.actNow ? window.EKO_BRIEF.actNow(E) : [], k = A.length, a = A[0];
    if(!n && !k) return t(base + '.k_calm');
    n = Math.max(n, k);   /* an acknowledged critical can still be in Act now */
    const v = { n, k, what: a ? a.asset + t('cu.lblSep') + plain(E, a) : '', where: a ? where(E, a) : '' };   /* the asset first, as on the Brief's row */
    return t(base + (!k ? '.k_none' : k === 1 ? (n === 1 ? '.k_oneOne' : '.k_one') : '.k_many'), v);
  }
  function headline(E, p){
    const t = E.t.bind(E); p = p || of(E);
    if(p === 'operator'){ const al = bySev(alarmsOpen(E).filter(a => !a.ack)), bl = backlog(E), over = bl.filter(w => w.dueH < 0).length, ho = window.EKO_HO && window.EKO_HO.pending && window.EKO_HO.pending(E);
      return needLine(E, al.length, 'per.hl.op16') + ' ' + t('per.hl.opWo', { w: over }) + (ho ? ' ' + t('per.hl.opHo') : ''); }
    if(p === 'executive' && E.sim && window.EKO_EP && window.EKO_EP.whyOver){ const X = execLine(E); if(X.M) return X.line; }   /* E14: the executive summary's one line (mock 4) */
    if(p === 'executive'){ const F = forecast(E), r = risks(E)[0];
      if(!F || !F.monthEnd) return t('per.hl.execNone');
      const over = F.monthEnd.v - F.budgetMonth, aed = money(E) && tariff(E) ? t('per.hl.execAed', { aed: fmt(Math.abs(over) * 1000 * tariff(E), 0) }) : '';
      return t(over > 0 ? 'per.hl.exec' : 'per.hl.execUnder', { m: mon(E, E.nowMs()), f: fmt(F.monthEnd.v, 0), d: fmt(Math.abs(over), 0), b: fmt(F.budgetMonth, 0), aed }) + (r ? ' ' + t('per.hl.execRisk', { r: r.what }) : ''); }
    if(p === 'engineer'){ const ahus = (E.data.assets || []).filter(a => a.sys === 'ahu' && /^AHU/.test(a.id)), al = bySev(alarmsOpen(E).filter(a => HVAC.includes(sysOfAsset(E, a.asset))));
      const R = window.EKO_EP && E.data.energyModel ? (() => { try{ return window.EKO_EP.rows(E); }catch(e){ return []; } })() : [], w = R[0];
      const eo = alarmsOpen(E).filter(a => !a.ack && ENG.includes(sysOfAsset(E, a.asset)));
      return t('per.hl.eng16', { a: ahus.filter(a => a.st !== 'off').length, n: ahus.length })
        + ' ' + needLine(E, eo.length, 'per.hl.eng16')
        + (w && w.g > 5 ? ' ' + t('per.hl.engBench', { s: L(E, w.s.en || w.s.id, w.s.ar), g: fmt(w.g, 0) }) : ''); }
    if(p === 'security'){ const k = window.EKO_SEC && window.EKO_SEC.counts ? window.EKO_SEC.counts(E) : null; if(!k) return t('per.hl.secNone');
      return needLine(E, k.open, 'per.hl.sec16') + ' ' + t('per.hl.secCam', { f: k.fireV || t('emptyDash'), a: k.camOn, b: k.cams }); }
    if(p === 'fm'){ const bl = backlog(E), over = bl.filter(w => w.dueH < 0).sort((a, b) => a.dueH - b.dueH), pm = pmTotals(E), m = E.data.maintenance || {}, u = window.EKO_OCC && E.sim ? window.EKO_OCC.underUse(E) : null;
      return t('per.hl.fm', { o: over.length, old: over[0] ? over[0].id + ' (' + over[0].asset + ')' : t('emptyDash'), pm: pm.pct != null ? fmt(pm.pct, 0) : t('emptyDash'), sla: m.slaMetPct != null ? fmt(m.slaMetPct, 0) : t('emptyDash') })
        + (u ? ' ' + t('per.hl.fmUse', { n: u.n, p: u.thr }) : ''); }
    return '';
  }
  /* the line on a model landing page (the top of the summary column); full-width pages put the sentence in their headline */
  function line(E){
    const p = of(E); if(!p || !onLanding(E)) return '';
    /* E14: the engineer's landing reaches the prediction and the proof in one click */
    return `<p class="perline" data-p="${p}"><b>${esc(E.t('per.for.' + p))}</b> ${esc(headline(E, p))}</p>${p === 'engineer' && window.EKO_E14 ? window.EKO_E14.engineerLinks(E) : ''}`;
  }

  /* ------------------------------- the Brief ------------------------------- */
  /* at most three items for the persona, in order; each says what happened, where, why it matters, and gives one action */
  function briefItems(E){
    const t = E.t.bind(E), p = of(E), out = [];
    const alarmItem = a => ({ key: 'al:' + a.id, sev: a.sev, what: a.asset + t('cu.lblSep') + plain(E, a), where: where(E, a), why: C().sevAction ? C().sevAction(E, a.sev) + t('cu.lblSep') + t('per.why.' + a.sev) : t('per.why.' + a.sev),
      act: a.ack ? { act: 'openAsset', data: { asset: a.asset }, label: t('per.act.open') } : { act: 'ackAlarm', data: { alarm: a.id }, label: t('acknowledge') } });
    if(p === 'operator'){
      bySev(alarmsOpen(E).filter(a => !a.ack)).slice(0, 2).forEach(a => out.push(alarmItem(a)));
      const ho = window.EKO_HO && window.EKO_HO.pending && window.EKO_HO.pending(E);
      if(ho) out.push({ key: 'ho', sev: null, short: t('per.s.ho'), what: t('per.b.ho'), where: t('per.b.hoWhere'), why: t('per.b.hoWhy'), act: { act: 'hoView', data: { v: window.EKO_HO.pendingId(E) || '' }, label: t('per.act.read') } });
      const over = backlog(E).filter(w => w.dueH < 0);
      if(out.length < 3 && over.length) out.push({ key: 'wo', sev: null, short: t('per.s.over'), what: t('per.b.wo', { n: over.length }), where: over[0].asset, why: t('per.b.woWhy', { id: over[0].id }), act: { act: 'goSub', data: { page: 'mnt', mod: 'maintenance' }, label: t('per.act.open') } });
    }
    if(p === 'engineer'){
      bySev(alarmsOpen(E).filter(a => ENG.includes(sysOfAsset(E, a.asset)))).slice(0, 1).forEach(a => out.push(Object.assign(alarmItem(a), { why: L(E, a.techEn, a.techAr) || t('per.why.' + a.sev), act: { act: 'openAsset', data: { asset: a.asset }, label: t('per.act.open') } })));
      predictions(E).slice(0, 1).forEach(q => out.push({ key: 'pv:' + q.asset, sev: null, what: q.asset + t('cu.lblSep') + t('per.risk.pred', { point: q.point, n: Math.round(q.days) }), where: L(E, ((E.data.assets || []).find(x => x.id === q.asset) || {}).level, ((E.data.assets || []).find(x => x.id === q.asset) || {}).levelAr) || q.asset,
        why: t('per.b.predWhy', { lo: q.daysLo, hi: q.daysHi }), act: { act: 'openAsset', data: { asset: q.asset }, label: t('per.act.open') } }));
      const prog = backlog(E).filter(w => w.type === 'cm' && (w.state === 'prog' || w.state === 'asgn') && ENG.includes(sysOfAsset(E, w.asset)) && alarmsOpen(E).some(a => a.asset === w.asset)).sort((a, b) => (a.prio || '').localeCompare(b.prio || ''))[0];
      if(prog) out.push({ key: 'fix:' + prog.id, sev: null, short: t('per.s.fix', { id: prog.id }), what: t('per.b.fix', { id: prog.id, a: prog.asset }), where: L(E, prog.taskEn, prog.taskAr), why: t('per.b.fixWhy'), act: { act: 'woOpen', data: { asset: prog.asset }, label: t('per.act.open') } });
    }
    if(p === 'executive'){
      const r = risks(E), b = r.find(x => x.key === 'budget'); if(b) out.push(Object.assign({ where: E.data.nameEn ? L(E, E.data.nameEn, E.data.nameAr) : '' }, b));
      r.filter(x => x.key !== 'budget').slice(0, 1).forEach(x => out.push(Object.assign({ where: '' }, x)));
      const c = compliance(E), bad = c.rows.filter(x => x.tone === 'warn').sort((a, b) => b.rank - a.rank)[0];   /* a life safety test overdue first */
      if(bad) out.push({ key: 'comp', sev: null, short: bad.short, what: bad.k + t('cu.lblSep') + bad.v, where: '', why: t('per.b.compWhy'), act: { act: 'goSub', data: { page: bad.go[0], mod: bad.go[1], sub: bad.go[2] || '' }, label: t('per.act.open') } });
    }
    if(p === 'security'){
      const ev = window.EKO_SEC && window.EKO_SEC.counts ? (window.EKO_SEC.counts(E), window.EKO_SEC.openEvents()) : [];
      const acc = ev.find(e => e.src === 'access' || (e.src === 'alarm' && e.a && e.a.fam === 'sec')), fire = ev.find(e => e.src === 'fire' || (e.src === 'alarm' && e.a && e.a.fam === 'fire'));
      const evItem = (e, why) => ({ key: 'ev:' + e.id, sev: e.sev, what: e.src === 'alarm' ? e.asset + t('cu.lblSep') + plain(E, e.a) : (e.doorName || e.asset || e.id) + t('cu.lblSep') + t('sec.ev.' + e.kind, { door: e.doorName || '', m: e.heldMin != null ? e.heldMin : '' }),
        where: e.src === 'alarm' ? where(E, e.a) : (e.zone || e.storey || ''), why, act: { act: 'secEv', data: { v: e.id }, label: t('per.act.open') } });
      if(acc) out.push(evItem(acc, t('per.b.accWhy')));
      if(fire) out.push(evItem(fire, t('per.b.fireWhy')));
      const k = window.EKO_SEC && window.EKO_SEC.counts ? window.EKO_SEC.counts(E) : null;
      if(k && k.cams) out.push({ key: 'cams', sev: null, short: t('per.s.cams'), what: t('per.b.cams', { a: k.camOn, b: k.cams }), where: E.data.nameEn ? L(E, E.data.nameEn, E.data.nameAr) : '', why: t(k.camOn < k.cams ? 'per.b.camsOff' : 'per.b.camsOk'), act: { act: 'goSub', data: { page: 'sec-cams', mod: 'security', sub: 'cams' }, label: t('per.act.open') } });
    }
    if(p === 'fm'){
      const over = backlog(E).filter(w => w.dueH < 0).sort((a, b) => a.dueH - b.dueH);
      if(over.length) out.push({ key: 'over', sev: null, short: t('per.s.over'), what: t('per.b.over', { n: over.length }), where: over[0].asset, why: t('per.b.overWhy', { id: over[0].id, d: Math.round(-over[0].dueH / 24) }), act: { act: 'goSub', data: { page: 'mnt', mod: 'maintenance' }, label: t('per.act.open') } });
      const pm = pmTotals(E); if(pm.low) out.push({ key: 'pm', sev: null, short: t('per.s.pm'), what: t('per.b.pm', { s: L(E, pm.low.sysEn, pm.low.sysAr), d: pm.low.done, n: pm.low.due }), where: t('per.b.pmWhere'), why: t('per.b.pmWhy', { p: pm.pct != null ? fmt(pm.pct, 0) : t('emptyDash') }), act: { act: 'goSub', data: { page: 'mnt', mod: 'maintenance' }, label: t('per.act.open') } });
      const u = window.EKO_OCC && E.sim ? window.EKO_OCC.underUse(E) : null;
      if(u) out.push({ key: 'use', sev: null, short: t('per.s.use'), what: t('per.b.use', { n: u.n, p: u.thr }), where: E.data.nameEn ? L(E, E.data.nameEn, E.data.nameAr) : '', why: t('per.b.useWhy'), act: { act: 'goSub', data: { page: 'spaces-occ', mod: 'spaces', sub: 'occ' }, label: t('per.act.open') } });
    }
    return out.slice(0, 3);
  }
  /* the Brief's one sentence: what needs this person, by name */
  function briefLead(E, items){
    const t = E.t.bind(E), p = of(E), n = items.length;
    if(!n) return t('per.bl.calm.' + (p || 'operator'));
    const names = items.map(x => x.short || x.what.split(t('cu.lblSep'))[0]);
    return t(n === 1 ? 'per.bl.single' : 'per.bl.several', { n, list: names.slice(0, -1).join(t('evx.list.sep')), last: names[names.length - 1], first: names[0], who: t('per.who.' + (p || 'operator')) });
  }

  /* --------------------------- the executive summary --------------------------- */
  /* E14 (mock 4): THE EXECUTIVE SUMMARY, one screen. The month in one line; four tiles (the month's energy
     against budget, its cost for a money role, the peak demand against the contract, the work overdue); why
     the month is over budget, by cause (the engine's own what-if, js/energy-pages.js whyOver); the top risks
     today; the executive report and Ask EKO. The month is the one of this and next that is furthest over. */
  /* the month (of this and next, the one furthest over budget) and its one line, built by code from the forecast and the what-if */
  function execLine(E){
    const t = E.t.bind(E);
    const W = window.EKO_EP && window.EKO_EP.whyOver ? (() => { try{ return window.EKO_EP.whyOver(E); }catch(e){ return null; } })() : null;
    const months = W ? W.months.filter(M => M.gap != null) : [];
    const M = months.slice().sort((a, b) => b.gap - a.gap)[0] || null;
    const mName = M ? E.ph(['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][new Date(M.ms).getMonth()]) : '';
    const chWo = (backlog(E).find(w => W && w.asset === W.chiller && w.type === 'cm') || {}).id || '';
    let line = t('per.hl.execNone');
    if(M){ const ch = Math.round(M.parts.chiller), fixed = M.v - M.parts.chiller, left = fixed - M.b;
      line = M.gap > 0 ? t('x14.line', { m: mName, d: fmt(M.gap, 0), c: fmt(ch, 0) }) + ' ' + t(left > 0.5 ? 'x14.lineFix' : 'x14.lineFixUnder', { wo: chWo ? ' (' + chWo + ')' : '', m: mName, f: fmt(fixed, 0), l: fmt(Math.abs(left), 0) })
        : t('x14.lineUnder', { m: mName, d: fmt(-M.gap, 0), b: fmt(M.b, 0) }); }
    return { W, M, mName, line };
  }
  function execPage(E){
    const t = E.t.bind(E), F = forecast(E), aed = money(E) && tariff(E), E14 = window.EKO_E14;
    const X = execLine(E), W = X.W, M = X.M, mName = X.mName, line = X.line;
    const tile = (lbl, v, u, cap, tone, go) => `<div class="x14tile"${go ? ` data-act="goSub" data-page="${esc(go[0])}" data-mod="${esc(go[1])}" data-sub="${esc(go[2] || '')}" role="button" tabindex="0"` : ''}>
        <div class="x14tl">${esc(lbl)}</div><div class="x14tv tMono">${esc(v)}${u ? ` <span>${esc(u)}</span>` : ''}</div><div class="x14tc"${tone ? ` data-tone="${tone}"` : ''}>${esc(cap)}</div></div>`;
    const tiles = [];
    if(M){
      tiles.push(tile(t('x14.energy', { m: mName }), fmt(M.v, 0), 'MWh', t(M.gap > 0 ? 'x14.energyOver' : 'x14.energyUnder', { b: fmt(M.b, 0), d: fmt(Math.abs(M.gap), 0) }), M.gap > 0 ? 'warn' : 'ok', ['fcst', 'energy', 'fcst']));
      if(aed) tiles.push(tile(t('x14.cost', { m: mName }), fmt(M.v * 1000 * tariff(E), 0), 'AED', M.gap > 0 ? t('x14.costOver', { d: fmt(M.gap * 1000 * tariff(E), 0), c: fmt(Math.max(0, M.parts.chiller) * 1000 * tariff(E), 0) }) : t('x14.costUnder'), M.gap > 0 ? 'warn' : 'ok', ['fcst', 'energy', 'fcst']));
    }
    if(F && F.peakKw) tiles.push(tile(t('x14.peak'), fmt(F.peakKw, 0), 'kW', F.contractKw ? t('x14.peakCap', { c: fmt(F.contractKw, 0) }) : t('x14.peakCapNo'), F.contractKw && F.peakKw > F.contractKw * 0.95 ? 'warn' : '', ['power', 'energy', 'power']));
    const over = backlog(E).filter(w => w.dueH < 0).sort((a, b) => a.dueH - b.dueH);
    const lcf = x => !x || E.lang === 'ar' ? (x || '') : x.charAt(0).toLowerCase() + x.slice(1);
    tiles.push(tile(t('x14.overdue'), String(over.length), '', over[0] ? t('x14.overdueCap', { w: lcf(L(E, over[0].taskEn, over[0].taskAr)), id: over[0].id }) : t('x14.overdueNone'), over.length ? 'warn' : 'ok', ['mnt', 'maintenance']));
    /* why the month is over budget: the gap split by cause, in whole MWh that add up to the gap */
    let why = '';
    if(M && M.gap > 0){
      const K = ['chiller', 'faults', 'weather', 'growth', 'target', 'rest'], COL = { chiller: 'var(--crit)', faults: 'var(--warn)', weather: 'var(--info)', growth: 'var(--acc)', target: 'var(--t3)', rest: 'var(--s3)' };
      const LB = { chiller: t('ep.why.chiller', { a: W.chiller }), faults: t('ep.why.faults', { a: W.valve }), weather: t('ep.why.weather'), growth: t('ep.why.growth'), target: t('ep.why.target', { p: W.pct }), rest: t('ep.why.rest') };
      const r = {}; K.slice(0, 5).forEach(k => { r[k] = Math.round(M.parts[k]); }); r.rest = Math.round(M.gap) - K.slice(0, 5).reduce((s, k) => s + r[k], 0);
      const pos = K.filter(k => r[k] > 0), tot = pos.reduce((s, k) => s + r[k], 0) || 1;
      const segs = pos.map(k => `<div class="x14seg" style="width:${(r[k] / tot * 100).toFixed(1)}%;background:${COL[k]}" title="${esc(LB[k] + ': ' + r[k] + ' MWh')}">${r[k] / tot >= 0.06 ? esc(String(r[k])) : ''}</div>`).join('');
      const legend = K.filter(k => r[k] !== 0).map(k => `<span><i style="background:${COL[k]}"></i><b class="tMonoS">${esc((r[k] < 0 ? '−' : '') + fmt(Math.abs(r[k]), 0))} MWh</b> ${esc(LB[k].charAt(0).toLowerCase() + LB[k].slice(1))}</span>`).join('');
      const basis = [window.EKO_EP.budgetRule(E), aed && C().tariffBasis(E) ? t('x14.costBasis', { b: C().tariffBasis(E).text }) : ''].filter(Boolean).join(' ');
      why = `<section class="x14why"><div class="x14h"><span>${esc(t('x14.whyT', { m: mName }))}</span><button class="e14sitebtn x14more" data-act="goSub" data-page="fcst" data-mod="energy" data-sub="fcst">${esc(t('per.x.openFcst'))}</button></div><div class="x14bar" role="img" aria-label="${esc(t('ep.why.barAria', { m: mName }))}">${segs}</div>
        <div class="x14leg">${legend}</div><div class="x14foot">${esc(basis)}</div></section>`;
    } else why = `<section class="x14why"><div class="x14h">${esc(t('per.x.energyT'))}</div><p class="tCap">${esc(M ? t('x14.lineUnder', { m: mName, d: fmt(Math.abs(M.gap || 0), 0), b: fmt(M.b || 0, 0) }) : t('per.x.noFcst'))}</p></section>`;
    /* the top risks today: care or safety, compliance, cost */
    const cats = [];
    const al = bySev(alarmsOpen(E)).filter(a => a.sev === 'critical' || a.sev === 'high')[0];
    if(al){ const sys = sysOfAsset(E, al.asset) || (E.data.alarmCatalog || []).concat(E.data.alarms || []).filter(x => x.asset === al.asset).map(x => x.fam)[0];
      const cat = ['medgas', 'cold'].includes(al.fam || sys) ? 'care' : SECF.includes(al.fam || sys) ? 'safety' : 'ops';
      cats.push({ k: cat, txt: t('x14.riskAlarm', { what: plain(E, al), where: where(E, al) }), go: { act: 'openAsset', data: { asset: al.asset } } }); }
    const c = compliance(E), bad = c.rows.filter(x => x.tone === 'warn').sort((a, b) => b.rank - a.rank)[0];
    if(bad) cats.push({ k: 'comp', txt: bad.k + t('cu.lblSep') + bad.v, go: { act: 'goSub', data: { page: bad.go[0], mod: bad.go[1], sub: bad.go[2] || '' } } });
    if(F && F.peakAt && F.contractKw && F.peakKw > F.contractKw * 0.9) cats.push({ k: 'cost', txt: t('x14.riskPeak', { d: new Date(F.peakAt).getDate() + ' ' + E.ph(['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][new Date(F.peakAt).getMonth()]), kw: fmt(F.peak15 || F.peakKw, 0), c: fmt(F.contractKw, 0) }), go: { act: 'goSub', data: { page: 'power', mod: 'energy', sub: 'power' } } });
    else if(M && M.gap > 0) cats.push({ k: 'cost', txt: t('x14.riskBudget', { m: mName, d: fmt(M.gap, 0) }), go: { act: 'goSub', data: { page: 'fcst', mod: 'energy', sub: 'fcst' } } });
    const risk = x => `<button class="x14risk" data-act="${esc(x.go.act)}"${Object.keys(x.go.data).map(k => ` data-${k}="${esc(x.go.data[k])}"`).join('')}><b>${esc(t('x14.cat.' + x.k))}</b> ${esc(x.txt)}</button>`;
    return `<div class="pwarea x14page" data-frame="off" data-pg="exec">
      <section class="x14line"><span class="x14k">${esc(t('x14.oneLine'))}</span><p>${esc(line)}</p></section>
      <div class="x14tiles" style="grid-template-columns:repeat(${tiles.length},minmax(0,1fr))">${tiles.join('')}</div>
      <div class="x14row">${why}
        <section class="x14risks"><div class="x14k">${esc(t('x14.risksT'))}</div>${cats.slice(0, 3).map(risk).join('') || `<p class="tCap">${esc(t('per.x.noRisk'))}</p>`}
          <div class="x14acts"><button class="btnP" data-act="rpGen" data-v="executive-monthly">${esc(t('x14.report'))}</button><button class="btnG" data-act="aiOpen" data-ai-label="${esc(t('modExec'))}" data-ai-topic="energy">${esc(t('x14.ask'))}</button>${E14 ? E14.siteBtn(E, 'exec') : ''}</div>
          ${E14 ? E14.siteBox(E, 'exec') : ''}</section></div></div>`;
  }

  /* ------------------------------- View as ------------------------------- */
  function menu(E){
    const t = E.t.bind(E), cur = of(E);
    return `<div class="perlist" role="group" aria-label="${esc(t('per.viewAs'))}">${LIST.map(p => `<button class="peritem" data-act="viewAs" data-v="${p}" aria-pressed="${p === cur}" data-tip="${esc(t('per.d.' + p))}"><span class="perdot" data-p="${p}" aria-hidden="true"></span><span class="grow taS">${esc(t('per.n.' + p))}</span><span class="tCap">${esc(t('per.r.' + p))}</span></button>`).join('')}</div>`;
  }
  const ss = { get: k => { try{ return sessionStorage.getItem(k); }catch(e){ return null; } }, set: (k, v) => { try{ sessionStorage.setItem(k, v); }catch(e){} } };
  function set(E, p){
    if(!ROLE[p] || !(E.data.roles || {})[ROLE[p]]) return false;
    const r = ROLE[p]; E.state.persona = p; ss.set('eko-persona', p);
    E.state.rolePreview = r === (E.data.user || {}).role ? null : r; ss.set('eko-role-preview', E.state.rolePreview || '');
    return true;
  }
  const ACTS = {
    viewAs(el){ const E = window.EKO, p = el.dataset.v; if(!set(E, p)) return;
      E.state.dlg = null; E.state.ovpMin = false; E.state.assetSel = null;
      const l = landing(E) || E.landing(); E.go(l.pageId, l.module, l.sub || null);
      /* the chief operator lands on the Overview with the Brief */
      if(p === 'operator' && window.EKO_BRIEF) setTimeout(() => window.EKO_BRIEF.ACTS.cuOpen({ dataset: {} }), 60); }
  };
  /* ?persona= (demo builds) and the session's choice, read before the first render */
  function init(E){
    try{ const q = new URL(location.href).searchParams.get('persona'); const p = q || ss.get('eko-persona'); if(p && ROLE[p] && (q || (E.state.rolePreview || (E.data.user || {}).role) === ROLE[p])) set(E, p); }catch(e){}
  }
  return { LIST, ROLE, of, money, landing, onLanding, headline, line, briefItems, briefLead, risks, compliance, execPage, execLine, menu, set, init, ACTS };
})();
