/* ============================================================================
   BUILDING DATA ENGINE, APPLIED (E1). At boot, on a site that names the engine
   (data.sim === 'medical'), the engine runs once for the load minute and its
   outputs are written into the data the pages already read: the alarms, the
   energy figures, the rooms, the work orders and their KPIs, security, fire,
   power, beds and nurse calls, the readings Prove and Predict use, the Brief's
   event log and lookahead. The site file keeps only the structure from the
   model (rooms, devices, positions, names) and the alarm catalogue's words.
   Every page therefore reads one data set: two pages cannot disagree.
   ============================================================================ */
(function(root){
  'use strict';
  const HOUR = 36e5, DAY = 864e5;
  const iso = ms => new Date(ms).toISOString();
  const hhmm = ms => { const d = new Date(ms); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dLbl = ms => { const d = new Date(ms); return d.getDate() + ' ' + MON[d.getMonth()]; };

  /* the whole mapping, pure: (engine, the site data) -> the site data with the engine's values written in */
  /* E8: the monthly budgets from one rule: the same month last year from the engine, less the saving target.
     A month from this one onwards is budgeted against the year before it; an earlier month (next year's) against this year's. */
  function budgets(e){
    const pct = e.V(e.cfg.budgetSavingPct), n = new Date(e.now), out = [];
    for(let m = 0; m < 12; m++){ const y = (m >= n.getMonth() ? n.getFullYear() : n.getFullYear() + 1) - 1, dim = new Date(y, m + 1, 0).getDate(); let sum = 0;
      for(let i = 1; i <= dim; i++) sum += e.day(Math.round((new Date(y, m, i).getTime() - e.today0) / 864e5)).total;
      out.push(Math.round(sum * (1 - pct / 100))); }
    return out;
  }
  function apply(e, d){
    const now = e.now, V = e.V, cfg = e.cfg, F = cfg.faults;
    d.basis = Object.assign({}, d.basis, { asOfAt: iso(now), asOf: hhmm(now) });
    /* alarms and their history */
    d.alarms = e.alarms();
    d.alarmHistory = Object.assign({}, d.alarmHistory || {}, { events: e.alarmHistory() });
    /* the energy figures: today, the last 24 hours, the meters */
    const h = e.hour(now, false), hd = e.hour(now, true), d0 = e.day(0);
    let peak = { kw: 0, at: e.today0 }; for(let ms = e.today0; ms <= now; ms += HOUR){ const x = e.hour(ms, false); if(x.total > peak.kw) peak = { kw: x.total, at: ms }; }   /* E7: the peak hour's average, at the start of its hour */
    let rest = 0; const end = e.dayStart(1); for(let ms = now; ms < end; ms += HOUR) rest += e.hour(ms, false).total * Math.min(1, (end - ms) / HOUR) / 1000;
    d.metrics = Object.assign({}, d.metrics, { facilityLoadMw: +(h.total / 1000).toFixed(3), loadNowMw: +(h.total / 1000).toFixed(3), energyTodayMwh: +d0.total.toFixed(2),
      peakTodayMw: +(peak.kw / 1000).toFixed(3), peakTodayAt: iso(peak.at), todayForecastEodMwh: +(d0.total + rest).toFixed(1), baselineKw: Math.round(hd.total),
      loadAboveBaselinePct: +((h.total / hd.total - 1) * 100).toFixed(1) });
    const l24 = []; for(let k = 23; k >= 0; k--) l24.push(+(e.hour(now - k * HOUR, false).total / 1000).toFixed(3)); d.load24hMw = l24;
    const days7 = []; for(let k = -6; k <= 0; k++) days7.push(+e.day(k).total.toFixed(1));
    (d.meters || []).forEach(m => { if(m.domain === 'energy'){ m.last = Math.round(d0.total * 1000); m.lastAt = hhmm(now); if(m.sparkUnit === 'MWh/d') m.spark7 = days7.slice(); } });
    (d.summary || []).forEach(s => { if(s.key === 'energy'){ const sp = []; for(let k = 11; k >= 0; k--) sp.push(Math.round(e.hour(now - k * 2 * HOUR, false).total / 1000 * 2 * 10) / 10); s.spark = sp;
      const typ = e.day(-7).total * d0.part; s.deltaEn = (d0.total >= typ ? '+' : '') + Math.round((d0.total / typ - 1) * 100) + '% vs typical'; s.deltaAr = '‎' + s.deltaEn.replace(' vs typical', ' مقابل المعتاد'); } });
    if(d.power){ (d.power.pmus || []).forEach(p => { p.kw = Math.round(h.total); p.kwh = Math.round(d0.total * 1000); });
      if(d.power.subview){ d.power.subview.loadNowKw = Math.round(h.total); d.power.subview.baselineKw = Math.round(hd.total); } }
    if(d.energyLanding){ d.energyLanding.currentKw = Math.round(h.total); d.energyLanding.baselineKw = Math.round(hd.total); }
    /* the energy model reads the engine's days (js/energy-model.js) */
    if(d.energyModel){ Object.defineProperty(d.energyModel, 'engine', { value: e, enumerable: false, configurable: true });
      d.energyModel.contractKw = V(cfg.contractKw); d.energyModel.floorAreaM2 = V(cfg.floorAreaM2); d.energyModel.budgetMwh = budgets(e); d.energyModel.budgetRule = { savingPct: V(cfg.budgetSavingPct) }; d.energyModel.tolPct = V(cfg.tolPct); }
    /* occupancy */
    d.occupancy = Object.assign({}, d.occupancy || {}, e.occupancy());
    /* rooms: the heat map zones from the engine's rooms; stale sensors as configured */
    const stale = new Map(V(F.staleSensors));
    if(d.heat && d.heat.zones){ d.heat.zones.forEach(z => { const sp = { gid: z.gid || z.nameEn, name: z.nameEn, storey: z.floor, area: (z.rect ? z.rect[2] * z.rect[3] * 4 : 15) };
      const r = e.room(sp, now), key = Object.keys(Object.fromEntries(stale)).find(k => (z.nameEn || '').includes(k)); z.occPrev = e.room(sp, now - HOUR).occ;   /* E7: the count an hour ago, for the change */
      z.tempC = r.tempC; z.rhPct = r.type === 'plant' || r.type === 'gen' || r.type === 'ups' ? null : r.rhPct; z.co2Ppm = r.co2Ppm; z.occ = r.occ;
      z.intervalMin = 5; z.ageMin = key ? stale.get(key) : 1 + Math.floor(e.U('za' + sp.gid) * 3);
      z.hours = []; for(let i = 0; i < 8; i++){ const x = e.room(sp, e.today0 + (i * 3 + 1.5) * HOUR); z.hours.push(+Math.min(1, Math.max(0.1, (x.occ + 1) / (Math.max(...[0, 1, 2, 3, 4, 5, 6, 7].map(j => e.room(sp, e.today0 + (j * 3 + 1.5) * HOUR).occ)) + 1))).toFixed(2)); }
      (z.equip || []).forEach(q => { q.tempC = Math.round(r.tempC + 6 + 10 * e.U('eq' + q.asset) + (q.asset === F.upsRoom.asset ? F.upsRoom.extraC : 0)); }); }); }
    /* the readings Predict and Prove use */
    const W = e.readings.ahu2Windows(), sp2 = F.ahu2Supply;
    if(d.readingHistory && d.readingHistory.series && d.readingHistory.series[0]){ d.readingHistory.series[0].vals = e.readings.ahu1Series(); d.readingHistory.series[0].limit = F.ahu1Filter.limitPa; d.readingHistory.series[0].band = [0, F.ahu1Filter.bandPa]; }
    (d.verified || []).forEach(v => { if(v.asset === sp2.asset){ Object.assign(v, { before: W.before, after: W.after, cddBefore: W.cddBefore, cddAfter: W.cddAfter, fixedDaysAgo: sp2.fixAgoD, wo: sp2.wo, limit: sp2.limit, band: sp2.band, kwhPerUnitDay: sp2.kwhPerUnitDay, verifiedH: +((now - e.today0) / HOUR).toFixed(1) }); } });
    (d.assets || []).forEach(a => { if(a.id === sp2.asset && a.params) a.params = a.params.map(p => /Supply air/.test(p[0]) ? [p[0], p[1], e.readings.supplyDev(0).toFixed(1) + ' K'] : p);
      if(a.id === F.ahu1Filter.asset && a.params) a.params = a.params.map(p => /Filter/.test(p[0]) ? [p[0], p[1], e.readings.filterDp(0).toFixed(0) + ' Pa'] : p); });
    /* work orders and the maintenance KPIs */
    const K = e.kpis(), all = e.workOrders(), story = all.filter(w => w.story);
    const woRow = w => ({ id: w.id, asset: w.asset, taskEn: w.taskEn, taskAr: w.taskAr, type: w.type, prio: w.prio, state: w.state,
      openedH: +((now - w.opened) / HOUR).toFixed(1), dueH: w.closed ? null : +((w.due - now) / HOUR).toFixed(1), closedH: w.closed ? +((now - w.closed) / HOUR).toFixed(1) : null });
    d.maintenance = Object.assign({}, d.maintenance || {}, { wos: story.map(woRow), pmBySystem: K.pmBySystem, response: K.response, slaMetPct: K.slaMetPct });
    const openPm = story.filter(w => w.type === 'pm' && !w.closed), over = story.filter(w => !w.closed && w.due < now), oldest = over.slice().sort((a, b) => a.due - b.due)[0];
    const pmDone = K.pmBySystem.reduce((s, r) => s + r.done, 0), pmDue = K.pmBySystem.reduce((s, r) => s + r.due, 0);
    d.pm = Object.assign({}, d.pm || {}, { open: story.filter(w => !w.closed).length, overdue: over.length, oldestDays: oldest ? Math.floor((now - oldest.due) / DAY) : 0, oldestAsset: oldest ? oldest.asset : null,
      oldestTaskEn: oldest ? oldest.taskEn.toLowerCase() : '', oldestTaskAr: oldest ? oldest.taskAr : '', dueWithin7: openPm.filter(w => w.due - now < 7 * DAY).length, done: pmDone, due: pmDue });
    (d.assets || []).forEach(a => { const ws = all.filter(w => w.asset === a.id).sort((p, q) => q.opened - p.opened).slice(0, 3);
      if(ws.length) a.activity = ws.map(w => [w.id, w.taskEn, dLbl(w.opened), w.closed ? 'done' : w.state, +((now - (w.closed || w.opened)) / HOUR).toFixed(1)]);
      const op = all.filter(w => w.asset === a.id && !w.closed); a.wos = op.length; a.wost = op.length ? op[0].state : null; });
    /* the Brief's event log and lookahead, from the engine's records (the last 24 hours, the next 8) */
    const ev = [];
    story.filter(w => !w.closed && now - w.opened < 24 * HOUR).forEach(w => ev.push({ id: 'mev-' + w.id, h: +((now - w.opened) / HOUR).toFixed(1), kind: 'woCreated', wo: w.id, asset: w.asset }));
    story.filter(w => !w.closed && w.due < now).forEach(w => ev.push({ id: 'mev-o-' + w.id, h: +((now - w.due) / HOUR).toFixed(1), kind: 'woOverdue', wo: w.id, asset: w.asset }));
    story.filter(w => w.closed && now - w.closed < 24 * HOUR).forEach(w => ev.push({ id: 'mev-c-' + w.id, h: +((now - w.closed) / HOUR).toFixed(1), kind: 'woCompleted', wo: w.id, asset: w.asset }));
    stale.forEach((min, src) => ev.push({ id: 'mev-s-' + src, h: +(min / 60).toFixed(1), kind: 'srcStale', src, nameEn: 'Room sensor ' + src, nameAr: 'مستشعر الغرفة ' + src }));
    d.eventLog = ev.sort((a, b) => a.h - b.h);
    if(d.lookahead){ const la = (d.brief || {}).lookaheadH || 8, hrs = []; for(let k = 1; k <= la; k++) hrs.push(+(e.hour(now + k * HOUR, false).total / 1000).toFixed(2));
      d.lookahead = Object.assign({}, d.lookahead, { pm: openPm.filter(w => w.due > now && w.due - now < la * HOUR).map(w => ({ id: w.id, asset: w.asset, taskEn: w.taskEn, taskAr: w.taskAr, dueH: +((w.due - now) / HOUR).toFixed(1) })),
        woDue: story.filter(w => !w.closed && w.type === 'cm' && w.due > now && w.due - now < la * HOUR).map(w => ({ wo: w.id, asset: w.asset, dueH: +((w.due - now) / HOUR).toFixed(1) })),
        demandForecast: Object.assign({}, d.lookahead.demandForecast || {}, { hourlyMw: hrs, basisEn: 'the building data engine for the coming hours (schedule and weather)', basisAr: 'محرك بيانات المبنى للساعات القادمة (الجدول والطقس)' }) }); }
    /* security, fire, power, beds and nurse calls now; the scenario replays at its own hour */
    const sec = d.security; if(sec){ const S = e.security(now), byId = (l, id) => l.find(x => x.id === id) || {};
      (sec.cameras || []).forEach(c => Object.assign(c, byId(S.cameras, c.id)));
      (sec.doors || []).forEach(r => Object.assign(r, byId(S.doors, r.id)));
      sec.access = Object.assign({}, sec.access || {}, S.access);
      sec.fire = Object.assign({}, sec.fire || {}, { events: S.fire.events, isolations: S.fire.isolations.map(i => { const dv = ((sec.fire.deviceTests || []).find(q => q.id === i.device)) || {}; return Object.assign({ gid: dv.gid, storey: dv.storey }, i); }),
        deviceTests: (sec.fire.deviceTests || []).map(q => Object.assign({}, q, byId(S.fire.deviceTests, q.id))) });
      sec.history = Object.assign({}, sec.history || {}, { events: S.history, windowD: 30 });
      if(sec.power){ const g = (sec.power.generators || [])[0], u = (sec.power.ups || [])[0], PW = cfg.power;
        sec.power.loads = S.power.loads;
        if(g) Object.assign(g, { fuelPct: S.power.fuelPct, tankL: V(PW.tankL), ratingKw: V(PW.ratingKw), burnCurve: V(PW.burnCurve), startBatteryV: V(PW.startBatteryV), testOverdue: true,
          lastTest: Object.assign({}, g.lastTest || {}, { agoD: V(PW.lastRunAgoD), result: 'pass', loadPct: 60, transferS: V(PW.lastTransferS) }) });
        if(u) Object.assign(u, { loadPct: S.power.upsLoadPct, runtimeMin: S.power.upsRuntimeMin, ratingKva: V(PW.upsKva) });
        /* E9: the UPS room is the engine's room and its alarm (al-med-ups1) with its work order, never a note: a value over its limit is an alarm */
        if(u){ const ur = e.room({ gid: 'ups', name: 'UPS', area: 20, storey: 'L1' }, now), uw = (e.workOrders() || []).find(w => w.asset === F.upsRoom.asset && w.state !== 'done');
          u.noteEn = null; u.noteAr = null;
          u.room = { tempC: ur.tempC, limitC: F.upsRoom.limitC, over: ur.tempC > F.upsRoom.limitC, alarm: 'al-med-ups1', wo: uw ? uw.id : null }; }
        sec.power.transferTargetS = V(PW.transferTargetS); sec.power.fuelPolicyPct = sec.power.fuelPolicyPct || 70; }
      if(sec.evac){ const atNow = S.beds; (sec.evac.beds || []).forEach(b => Object.assign(b, byId(atNow, b.id)));
        /* the scenario's own bed state, at its replay hour */
        const rh = V(cfg.scenario.replayHour), tR = e.today0 + rh * HOUR, SR = e.security(tR);
        sec.evac.scenarioBeds = SR.beds; sec.evac.scenarioAtEn = 'the replay runs at ' + hhmm(tR); }
      /* E9: the last 24 hours of calls (the page's recent calls and its bays); outside clinic hours, the unit at the replay hour (11:30) as well */
      if(sec.nurse){ const rec = c => ({ bed: c.bed, unit: c.unit, at: c.at, answerMin: +c.answerMin.toFixed(1), type: c.type });
        sec.nurse.recent = S.nurse.calls.filter(c => c.at <= now).map(rec);
        if(!e.isOpen(now)){ const tN = e.today0 + V(cfg.scenario.replayHour) * HOUR, SN = e.security(tN); sec.nurse.replay = { atMs: tN, calls: SN.nurse.open, recent: SN.nurse.calls.filter(c => c.at <= tN).map(rec), units: SN.nurse.units }; } else sec.nurse.replay = null; }
      if(sec.nurse){ Object.assign(sec.nurse, { calls: S.nurse.open, units: S.nurse.units.map(u => Object.assign({}, (sec.nurse.units || []).find(x => x.id === u.id) || { en: u.id, ar: u.id }, u)), byHour: S.nurse.byHour, byHourP90: S.nurse.byHourP90 }); }
      /* E4: intrusion from the hourly records (armed by the opening hours, motion by the hour) */
      if(sec.intrusion && sec.intrusion.areas){ sec.intrusion.areas.forEach(a => Object.assign(a, byId(S.intrusion.areas, a.id))); sec.intrusion.events = []; }
    }
    /* the month to date and the month end the Energy landing, the reports and Ask EKO read: the energy model's, which reads the engine */
    const EMm = root.EKO_EM || (typeof require !== 'undefined' ? require('../energy-model.js') : null);
    if(EMm && d.energyModel){ const EE = { nowMs: () => now, data: d }, EM = EMm.make(d.energyModel), M = EM.mtd(EE);
      const FC = EM.forecast(EE);
      if(d.fcst) d.fcst.monthEndMwh = Math.round(FC.monthEnd.v);
      const L = d.energyLanding; if(L){ L.mtdKwh = Math.round(M.total * 1000);
        /* performance: design over actual for the last 30 days; the spark day by day; the change against the 30 days before */
        const perf = (a, b) => { let x = 0, y = 0; for(let k = a; k <= b; k++){ const q = e.day(k); x += q.total; y += q.designTotal; } return y / x * 100; };
        L.performancePct = +perf(-29, -1).toFixed(1); const prev = perf(-59, -30), dl = L.performancePct - prev;
        L.perfSpark = []; for(let k = -7; k <= -1; k++){ const q = e.day(k); L.perfSpark.push(+(q.designTotal / q.total * 100).toFixed(1)); }
        L.perfDeltaEn = (dl >= 0 ? '+' : '−') + Math.abs(dl).toFixed(1) + '% vs last month'; L.perfDeltaAr = '‎' + (dl >= 0 ? '+' : '−') + Math.abs(dl).toFixed(1) + '% عن الشهر الماضي';
        L.perfWordEn = L.performancePct >= 95 ? 'Good' : L.performancePct >= 90 ? 'Fair' : 'Poor'; L.perfWordAr = L.performancePct >= 95 ? 'جيد' : L.performancePct >= 90 ? 'مقبول' : 'ضعيف';
        /* overnight: last night's load (00:00 to 05:00) against the design model at the same hours */
        let na = 0, nd = 0; for(let hh = 0; hh < 5; hh++){ const ms = e.dayStart(0) + hh * HOUR; na += e.hour(ms, false).total; nd += e.hour(ms, true).total; }
        L.overnightDeviationPct = +((na / nd - 1) * 100).toFixed(1); const oo = Math.abs(L.overnightDeviationPct) <= 5;
        L.overnightWordEn = oo ? 'Healthy' : 'Above design'; L.overnightWordAr = oo ? 'سليم' : 'فوق التصميم'; L.overnightTone = oo ? 'ok' : 'warn';
        const y = e.day(-1);
        (L.sumGauges || []).forEach(g => { if(/HVAC/.test(g.labelEn)) g.val = Math.round((y.actual.cool + y.actual.ahu) / y.total * 100); if(/LOAD FACTOR/.test(g.labelEn)) g.val = Math.round(y.total * 1000 / 24 / y.peakKw * 100); });
        const gapCool = (M.actual.cool - M.design.cool) / M.design.cool * 100;
        (L.modules || []).forEach(m => { if(m.pageId === 'power'){ m.headEn = Math.round(h.total) + ' kW now'; m.headAr = Math.round(h.total) + ' ك.و الآن'; }
          if(m.pageId === 'bench'){ m.headEn = 'cooling ' + Math.round(gapCool) + '% above design'; m.headAr = 'التبريد أعلى من التصميم بنسبة ' + Math.round(gapCool) + '%'; }
          if(m.pageId === 'fcst'){ m.headEn = 'next month about ' + Math.round(FC.next.v) + ' MWh'; m.headAr = 'الشهر القادم نحو ' + Math.round(FC.next.v) + ' م.و.س'; } }); }
      if(d.power){ const hc = d.power.heroCharts || {}, sv = d.power.subview || {};
        if(hc.current){ hc.current.value = +(h.total / (sv.scaleMaxKw || 1100) * 100).toFixed(1); hc.current.noteEn = Math.round(hd.total) + ' kW baseline'; hc.current.noteAr = 'خط الأساس ' + Math.round(hd.total) + ' ك.و'; }
        if(hc.month){ hc.month.spark = []; for(let k = -6; k <= 0; k++) hc.month.spark.push(+(e.day(k).total / 24 / Math.max(e.day(k).part, 1e-6)).toFixed(2)); }
        sv.totalMwh = +d0.total.toFixed(1); }
      if(d.spaces){ const zs = (d.heat || {}).zones || [], inBand = zs.filter(z => z.tempC != null && z.tempC >= 20.5 && z.tempC <= 24.5 && (z.rhPct == null || (z.rhPct >= 30 && z.rhPct <= 60)));
        const comfort = zs.filter(z => z.co2Ppm != null); d.spaces.comfortPct = comfort.length ? +(comfort.filter(z => inBand.includes(z)).length / comfort.length * 100).toFixed(1) : null;
        d.spaces.occupiedPct = Math.round(e.people(now) / e.headcount(now).capacity * 100);   /* E11: the one count and the one capacity */
        { const H = e.headcount(now), f = n => n.toLocaleString('en-US'); d.spaces.occPeakEn = f(H.total) + ' people on site now, of a capacity of ' + f(H.capacity); d.spaces.occPeakAr = f(H.total) + ' شخصًا في الموقع الآن، من سعة ' + f(H.capacity); } } }
    if(EMm && d.energyModel) energyPages(e, d, EMm.make(d.energyModel).mtd({ nowMs: () => now, data: d }));   /* E3 */
    /* E4: the cause and effect matrix and the demo scenario, from the fire engine (js/sim/medical-fire.js) */
    const FI = root.EKO_SIMF || (typeof require !== 'undefined' ? require('./medical-fire.js') : null), sec4 = d.security;
    if(FI && sec4 && sec4.fire && sec4.fire.detectors){ sec4.fire.matrix = FI.matrix(d, cfg); const sc = FI.scenario(e, d, cfg); if(sc && sec4.scenario) Object.assign(sec4.scenario, sc); }
    /* E5: other building systems, the data states and the rooms, from the engine (js/sim/medical-other.js) */
    const OTm = root.EKO_SIMO || (typeof require !== 'undefined' ? require('./medical-other.js') : null);
    if(OTm){ const OS = OTm.otherSystems(e), os = d.otherSystems;
      if(os){ os.lifts = OS.lifts; os.liftsOut = OS.liftsOut; (os.gases || []).forEach(g => { g.state = OS.gases[g.id] || 'normal'; }); if(os.water) os.water.states = OS.water; (os.ev || []).forEach((c, i) => { c.state = OS.ev[i] || 'available'; }); }
      if(d.dataHealth){ const DS = OTm.dataStates(e); ['points', 'online', 'stale', 'offline', 'flat', 'oor', 'never'].forEach(k => { d.dataHealth[k] = DS[k]; });
        (d.dataHealth.integrations || []).forEach(i => { const x = DS.integrations.find(q => q.name === i.name); if(x) Object.assign(i, { state: x.state, lastMin: x.lastMin, healthPct: x.healthPct, log: x.log, points: x.points, stale: x.stale, offline: x.offline }); }); }
      if(d.occupancy) d.occupancy.rooms = OTm.rooms(e, d); }
    /* E6: the figures the Brief, the reports and Ask EKO read that the site file still carried: avoidable energy this month, the
       indoor air quality and comfort indexes from the room sensors, the power factor, the coming maintenance window (the chiller's coil clean) */
    /* E7: no water meter is configured on this site (the model has none and the utilities feed is not set up): the Overview says so, the utilities report shows no data */
    if(d.metrics){ d.metrics.waterTodayM3 = null; (d.summary || []).forEach(r => { if(r.key === 'water'){ r.notConfigured = true; r.capEn = 'no water meter configured on this site'; r.capAr = 'لا عداد مياه مُعدّ في هذا الموقع'; } }); }
    if(d.metrics){ const zs = ((d.heat || {}).zones || []).filter(z => z.co2Ppm != null), ok = zs.filter(z => z.co2Ppm <= 1000 && (z.rhPct == null || (z.rhPct >= 30 && z.rhPct <= 60)));
      d.metrics.avoidableKwhMo = ((d.power || {}).subview || {}).avoidKwh != null ? d.power.subview.avoidKwh : d.metrics.avoidableKwhMo;
      d.metrics.iaq = zs.length ? Math.round(ok.length / zs.length * 100) : null; d.metrics.comfortIndex = d.spaces ? d.spaces.comfortPct : null;
      d.metrics.pfNow = V(cfg.elec.powerFactor); d.metrics.pfTarget = V(cfg.elec.pfTarget); }
    /* each asset's state and its alarms, from the engine's alarms (an asset with an active alarm is in alarm; the rest are ok) */
    (d.assets || []).forEach(a => { const al = (d.alarms || []).filter(x => x.asset === a.id).map(x => x.id); a.alarms = al; a.st = al.length ? 'alarm' : 'ok'; });
    if(d.lookahead){ const ch = F.chillerCop, wo = ((d.maintenance || {}).wos || []).find(w => w.asset === ch.asset && w.state !== 'done');
      d.lookahead.events = wo ? [{ id: 'mw-' + wo.id, kind: 'maintenanceWindow', asset: ch.asset, startH: ch.windowInH[0], endH: ch.windowInH[1], wo: wo.id,
        titleEn: ch.asset + ' isolated for the coil clean (' + wo.id + ')', titleAr: 'عزل ' + ch.asset + ' لتنظيف الملف (' + wo.id + ')' }] : []; }
    /* E5: the test logs and the report schedule, dated from the engine's now (the generator's runs from its last monthly run) */
    { const DAY = 864e5, ymd = ms => { const x = new Date(ms); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); }, Lr = V(cfg.power.lastRunAgoD);
      const Iv = V(cfg.power.runIntervalD), gt = (sec4 && sec4.power && sec4.power.genTests) || []; [Lr - Iv, Lr, Lr + Iv, Lr + 2 * Iv].forEach((ago, i) => { if(gt[i]) gt[i].date = ymd(now - ago * DAY); });
      /* E9: one schedule for the generator's tests, read by Emergency power and Health and tests: the last completed run, the next due, the days overdue */
      if(sec4 && sec4.power){ const last = e.today0 - Lr * DAY, due = last + Iv * DAY; sec4.power.genSchedule = { last: ymd(last), next: ymd(due), overdueD: Math.max(0, Math.round((e.today0 - due) / DAY)), intervalD: Iv, transferS: V(cfg.power.lastTransferS) };
        if(gt[0]) gt[0].result = e.today0 > due ? 'overdue' : 'due'; }
      const ft = (sec4 && sec4.fire && sec4.fire.tests) || []; V(cfg.fire.testsAgoD).forEach((ago, i) => { if(ft[i]) ft[i].date = ymd(now - ago * DAY); });
      const nd = new Date(now), firstNext = new Date(nd.getFullYear(), nd.getMonth() + 1, 1).getTime(), monNext = e.dayStart(((8 - nd.getDay()) % 7) || 7);
      ((sec4 && sec4.reports) || []).forEach(r => { r.next = ymd(r.every === 'weekly' ? monNext : firstNext); }); }
    /* E10, Part C: ESG on this site, from the engine: the electricity, Scope 2 from the configured grid factor, the room comfort,
       a stand-in baseline pack rebuilt on the engine; water, waste, refrigerant, fuel and bills are Not configured (js/sim/medical-esg.js) */
    const ESm = root.EKO_SIMESG || (typeof require !== 'undefined' ? require('./medical-esg.js') : null);
    if(ESm && cfg.esg){ d.esg = ESm.esg(e, d); d.basis = Object.assign({}, d.basis, ESm.basis(cfg));
      if(d.entitlements && d.entitlements.modules) d.entitlements.modules.esg = 'active'; }
    d.sim = 'medical';
    return d;
  }
  /* ------------------------------------------------------------------------------------------------
     E3: the Consumption page, the energy cards and the Systems page cards, from the engine.
     No gauge or figure on these pages comes from the site file; the site file keeps the labels.
     ------------------------------------------------------------------------------------------------ */
  const WD = { en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], ar: ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'] };
  const DK = ['daySunday', 'dayMonday', 'dayTuesday', 'dayWednesday', 'dayThursday', 'dayFriday', 'daySaturday'];
  const niceUp = v => { const p = Math.pow(10, Math.floor(Math.log10(Math.max(v, 1)))); return [1, 2, 2.5, 5, 10].find(x => x * p >= v) * p; };
  /* the baseline of the budget charts: the same hour (or day) on the four weeks before, the 4-week model the card names */
  const wk4 = (f, k) => (f(k - 7) + f(k - 14) + f(k - 21) + f(k - 28)) / 4;
  function energyPages(e, d, M){
    const now = e.now, V = e.V, cfg = e.cfg, EL = cfg.elec, F = cfg.faults, HOUR = 36e5, DAY = 864e5, h = e.hour(now, false), pw = d.power;
    const pf = V(EL.powerFactor), vv = V(EL.voltageV), y0 = e.today0, hNow = Math.floor((now - y0) / HOUR), dom = new Date(now).getDate();
    const hm = ms => { const x = new Date(ms); return String(x.getHours()).padStart(2, '0') + ':' + String(x.getMinutes()).padStart(2, '0'); };
    if(pw){
      pw.contractedMw = V(cfg.contractKw) / 1000;   /* the supply limit the peak tiles read (the medical site had none: "NaN% of limit") */
      const from = new Date(e.dayStart(-6)).getDay(); if(pw.heroCharts && pw.heroCharts.month){ pw.heroCharts.month.fromEn = WD.en[from]; pw.heroCharts.month.fromAr = WD.ar[from]; }
      const nd = new Date(now), prevDays = new Date(nd.getFullYear(), nd.getMonth(), 0).getDate(); let pm = 0;
      for(let k = -(dom - 1) - prevDays; k <= -dom; k++) pm += e.day(k).total;
      pw.prevMonthKwh = Math.round(pm * 1000);
      /* the boards now; today by hour per board (kWh); each board's total today */
      const bNow = e.boards(now, false); pw.boards = bNow.map(b => [b.board, Math.round(b.kw)]);
      const zh = bNow.map(() => []), tot = bNow.map(() => 0);
      for(let k = 0; k <= hNow; k++){ const ms = y0 + k * HOUR, f = Math.min(1, (now - ms) / HOUR); e.boards(ms, false).forEach((b, i) => { zh[i].push(Math.round(b.kw * f)); tot[i] += b.kw * f; }); }
      let mx = 0; for(let k = 0; k <= hNow; k++) mx = Math.max(mx, zh.reduce((a, z) => a + z[k], 0));
      pw.zoneHourly = zh; pw.zoneAxisMax = niceUp(mx * 1.05);
      const T = tot.reduce((a, b) => a + b, 0), sv = pw.subview || (pw.subview = {});
      sv.zonesToday = tot.map(v => [Math.round(v), Math.round(v / T * 100)]); sv.totalMwh = +(T / 1000).toFixed(1);
      sv.pf = pf; sv.pfTarget = V(EL.pfTarget); sv.scaleMaxKw = V(EL.designKw);
      /* the energy above design this month, system by system: what better operation would have saved */
      sv.avoidKwh = Math.round(e.SYS.reduce((a, s) => a + Math.max(0, M.actual[s] - M.design[s]), 0) * 1000);
      /* 15-minute demand today, from the hourly loads with a seeded scatter, and its time labels */
      const Q = HOUR / 4, q0 = Math.min(y0, Math.floor(now / Q) * Q - 4 * Q), q = [];
      for(let ms = q0; ms <= now; ms += Q) q.push(+(e.hour(ms, false).total * (1 + V(EL.quarterScatter) * e.N('q15' + Math.floor(ms / Q))) / 1000).toFixed(3));
      pw.peakSeriesMw = q; const n = q.length - 1; pw.peakSeriesLabels = [0, Math.round(n / 3), Math.round(2 * n / 3), n].map(i => hm(q0 + i * Q));
      if(pw.heroCharts && pw.heroCharts.current){ pw.heroCharts.current.value = +(h.total / sv.scaleMaxKw * 100).toFixed(1); }
      (pw.pmus || []).forEach(p => { p.pf = pf; p.v = +(vv * (1 + 0.002 * e.N('pv' + Math.floor(now / HOUR)))).toFixed(1); p.a = Math.round(h.total * 1000 / (Math.sqrt(3) * p.v * pf)); p.hz = 50; });
      /* the budget charts: today by hour, this week and this month by day, against the 4-week baseline */
      if(pw.bva && pw.bva.ranges){ const R = pw.bva.ranges, hk = ms => e.hour(ms, false).total;
        const td = { a: [], b: [], l: [] };
        for(let k = 0; k <= hNow; k++){ const ms = y0 + k * HOUR, f = Math.min(1, (now - ms) / HOUR); td.a.push(Math.round(hk(ms) * f)); td.b.push(Math.round(wk4(j => hk(ms + j * DAY), 0) * f)); td.l.push(String(k).padStart(2, '0')); }
        R.today = Object.assign({}, R.today, { labels: td.l, actual: td.a, baseline: td.b });
        const dt = k => e.day(k).total, wd = (new Date(now).getDay() + 6) % 7, wk = { a: [], b: [], l: [] };   /* the week from Monday */
        for(let k = -wd; k <= 0; k++){ const part = e.day(k).part; wk.a.push(Math.round(dt(k))); wk.b.push(Math.round(wk4(dt, k) * part)); wk.l.push(DK[new Date(e.dayStart(k)).getDay()]); }
        R.week = Object.assign({}, R.week, { labelKeys: true, labels: wk.l, actual: wk.a, baseline: wk.b });
        const mo = { a: [], b: [], l: [] };
        for(let k = -(dom - 1); k <= 0; k++){ const part = e.day(k).part; mo.a.push(Math.round(dt(k))); mo.b.push(Math.round(wk4(dt, k) * part)); mo.l.push(String(new Date(e.dayStart(k)).getDate())); }
        R.month = Object.assign({}, R.month, { labels: mo.l, actual: mo.a, baseline: mo.b }); }
    }
    /* the energy cards: the chiller below its curve, the AHU-1 filter, the power factor; waste this month against the design model */
    const L = d.energyLanding;
    if(L){
      const MT = M.total * 1000, cg = Math.max(0, (M.actual.cool - M.design.cool) * 1000), fg = Math.max(0, (M.actual.ahu - M.design.ahu) * 1000);
      const drop = Math.max(0, (1 - h.cop / e.hour(now, true).cop) * 100), dp = e.readings.filterDp(0), fp = F.ahu1Filter, chW = F.chillerCop;
      const pfOk = pf >= V(EL.pfTarget);
      L.kpis = [
        { key: 'chiller', labelEn: 'Chiller efficiency', labelAr: 'كفاءة المبرد', unit: '%', gaugeVal: +drop.toFixed(1), gaugeMax: 40, sharePct: +(cg / MT * 100).toFixed(2), wasteKwh: Math.round(cg),
          stateEn: drop > 10 ? Math.round(drop) + '% below its curve' : 'On its curve', stateAr: drop > 10 ? 'أدنى من منحناه بنسبة ' + Math.round(drop) + '%' : 'على منحناه', tone: drop > 10 ? 'warn' : 'ok',
          tipEn: chW.asset + ': drifting for ' + chW.onsetAgoD + ' days; likely cause, to check on site: condenser coil fouling. The coil clean is work order WO-5118.', tipAr: chW.asset + ': انحراف منذ ' + chW.onsetAgoD + ' يومًا؛ السبب المرجّح، للتحقق في الموقع: اتساخ ملف المكثف. تنظيف الملف هو أمر العمل WO-5118.' },
        { key: 'filter', labelEn: 'AHU-1 filter', labelAr: 'فلتر AHU-1', unit: ' Pa', gaugeVal: dp, gaugeMax: fp.limitPa, sharePct: +(fg / MT * 100).toFixed(2), wasteKwh: Math.round(fg),
          stateEn: dp > fp.bandPa ? 'Loading' : 'Clean', stateAr: dp > fp.bandPa ? 'يتحمّل' : 'نظيف', tone: dp > fp.bandPa ? 'warn' : 'ok',
          tipEn: 'Pressure across the filter ' + dp + ' Pa against a ' + fp.limitPa + ' Pa limit; the change is planned (WO-5121).', tipAr: 'الضغط عبر الفلتر ' + dp + ' باسكال مقابل حد ' + fp.limitPa + ' باسكال؛ التغيير مخطط (WO-5121).' },
        { key: 'pf', labelEn: 'Power Factor', labelAr: 'معامل القدرة', unit: '', gaugeVal: pf, gaugeMax: 1, sharePct: 0, wasteKwh: 0,
          stateEn: pfOk ? 'Above the ' + V(EL.pfTarget) + ' threshold' : 'Below the ' + V(EL.pfTarget) + ' threshold', stateAr: pfOk ? 'فوق الحد ' + V(EL.pfTarget) : 'دون الحد ' + V(EL.pfTarget), tone: pfOk ? 'ok' : 'warn',
          tipEn: 'Ensure capacitor banks operate correctly to maintain power factor.', tipAr: 'تأكد من عمل بنوك المكثفات للحفاظ على معامل القدرة.' }];
      L.wasteTotalKwh = L.kpis.reduce((a, k) => a + k.wasteKwh, 0);
      (L.sumGauges || []).forEach(g => { if(/HVAC/.test(g.labelEn)){ const ok = g.val >= 30 && g.val <= 60; g.wordEn = ok ? 'Typical' : g.val > 60 ? 'High' : 'Low'; g.wordAr = ok ? 'معتاد' : g.val > 60 ? 'مرتفع' : 'منخفض'; g.tone = ok ? 'ok' : 'warn'; }
        if(/LOAD FACTOR/.test(g.labelEn)){ const ok = g.val >= 60; g.wordEn = ok ? 'Steady' : 'Peaky'; g.wordAr = ok ? 'مستقر' : 'متذبذب'; g.tone = ok ? 'ok' : 'warn'; } });
    }
    /* the Systems page cards */
    const G = ((d.systems || {}).groups) || []; if(!G.length) return;
    /* E13: the oxygen line belongs to medical gas and FR-03 to the cold chain; neither belongs under HVAC. The HVAC group keeps HVAC
       only; medical gas and the cold chain are a group of their own, with the oxygen card and the fridge */
    { const hv = G.find(g => g.id === 'hvac');
      if(hv && (hv.sysKey || []).some(k => k !== 'HVAC') && !G.some(g => g.id === 'medgas')){
        const ox = (hv.cards || []).filter(c => /OXYGEN/.test(c.labelEn || ''));
        hv.sysKey = ['HVAC']; hv.cards = (hv.cards || []).filter(c => !/OXYGEN/.test(c.labelEn || ''));
        G.splice(G.indexOf(hv) + 1, 0, { id: 'medgas', hue: '#6D8FBE', sysKey: ['Medical gas', 'Refrigeration'], labelEn: 'Medical gas and cold chain', labelAr: 'الغازات الطبية وسلسلة التبريد',
          cards: [{ kind: 'stat', labelEn: 'OVERALL HEALTH', labelAr: 'الحالة العامة', v: '100', u: '%', capEn: '', capAr: '', tone: 'ok' }].concat(ox.map(c => Object.assign({}, c, { subOnly: false })),
            [{ kind: 'stat', labelEn: 'MEDICATION FRIDGE', labelAr: 'ثلاجة الأدوية', v: '', u: '°C', capEn: '', capAr: '', tone: 'ok', fridge: true }]) }); } }
    const fr = F.fridge, frNow = (() => { const last = fr.excursionsAgoH[fr.excursionsAgoH.length - 1]; return last <= fr.durH + 1 || last < 3 ? fr.peakC : 4.6; })();
    G.forEach(g => (g.cards || []).forEach(c => { if(c.fridge){ c.v = frNow.toFixed(1); const out = frNow > fr.bandC[1]; c.tone = out ? 'crit' : 'ok'; c.wash = out ? 'warn' : '';
      c.capEn = 'FR-03 · band ' + fr.bandC[0] + ' to ' + fr.bandC[1] + ' °C' + (out ? ' · above its band' : ''); c.capAr = 'FR-03 · النطاق ' + fr.bandC[0] + ' إلى ' + fr.bandC[1] + ' °م' + (out ? ' · فوق نطاقها' : ''); } }));
    const SYSOF = { ahu: 'HVAC', heat: 'HVAC', chw: 'HVAC', medgas: 'Medical gas', cold: 'Refrigeration', elec: 'Electrical' };
    const bad = new Set((d.alarms || []).map(a => a.asset).filter(Boolean));
    const health = keys => { const A = (d.assets || []).filter(a => keys.includes(SYSOF[a.sys])), b = A.filter(a => bad.has(a.id) || (a.alarms || []).length);
      return { pct: A.length ? (A.length - b.length) / A.length * 100 : 100, n: A.length, bad: b.length }; };
    const S = e.security(now), zs = (d.heat || {}).zones || [], rh = zs.filter(z => z.rhPct != null), inRh = rh.filter(z => z.rhPct >= 30 && z.rhPct <= 60);
    const ahus = V(cfg.ahus), ahuBad = ahus.filter(a => bad.has(a.id)).length, chCap = V(cfg.chillers).length * V(EL.chillerKwTh), chUse = h.sys.cool * h.cop / chCap * 100;
    const imb = V(EL.imbalancePct), imbNow = Math.round(imb[0] + (imb[1] - imb[0]) * e.U('imb' + Math.floor(now / HOUR))), o2 = F.o2Dip, genLate = V(cfg.power.lastRunAgoD) > 30;
    G.forEach(g => { const H = health(g.sysKey || []);
      (g.cards || []).forEach(c => { const L2 = c.labelEn || '';
        if(/OVERALL HEALTH/.test(L2)){ c.v = H.pct.toFixed(1); c.tone = H.pct >= 95 ? 'ok' : H.pct >= 85 ? 'warn' : 'crit';
          c.capEn = H.bad ? H.bad + ' of ' + H.n + ' assets with an alarm' : 'All ' + H.n + ' assets without an alarm'; c.capAr = H.bad ? H.bad + ' من ' + H.n + ' أصول عليها إنذار' : 'كل الأصول الـ' + H.n + ' بلا إنذار'; }
        else if(/AIR HANDLING/.test(L2)){ c.v = ahus.length + ' / ' + ahus.length; c.capEn = 'Total: ' + ahus.length + ', all running'; c.capAr = 'الإجمالي: ' + ahus.length + '، كلها تعمل';
          c.chipEn = ahuBad ? ahuBad + ' with an alarm' : ''; c.chipAr = ahuBad ? ahuBad + ' عليها إنذار' : ''; c.tone = ahuBad ? 'warn' : 'ok'; c.wash = ahuBad ? 'warn' : ''; }
        else if(/HUMIDITY BAND/.test(L2)){ c.val = inRh.length; c.max = rh.length; c.u = '/ ' + rh.length; const off = rh.length - inRh.length;
          c.wordEn = off ? (off === 1 ? 'One room outside the band' : off + ' rooms outside the band') : 'All rooms in band'; c.wordAr = off ? (off === 1 ? 'غرفة واحدة خارج النطاق' : off + ' غرف خارج النطاق') : 'كل الغرف ضمن النطاق'; c.tone = off ? 'warn' : 'ok'; }
        else if(/OXYGEN/.test(L2)){ c.val = o2.dipBar; const lo = o2.dipBar < o2.limitBar; c.wordEn = lo ? 'Below low alarm' : 'Normal'; c.wordAr = lo ? 'دون الإنذار المنخفض' : 'طبيعي'; c.tone = lo ? 'crit' : 'ok'; }
        else if(/CHILLER CAPACITY/.test(L2)){ c.pct = +chUse.toFixed(1); c.wordEn = chUse < 85 ? 'Reserve available' : 'Little reserve'; c.wordAr = chUse < 85 ? 'احتياطي متاح' : 'احتياطي قليل'; }
        else if(/UPS ONLINE/.test(L2)){ c.v = '1 / 1'; c.capEn = 'Load ' + S.power.upsLoadPct + '% · ' + S.power.upsRuntimeMin + ' min on battery'; c.capAr = 'الحمل ' + S.power.upsLoadPct + '% · ' + S.power.upsRuntimeMin + ' د على البطارية'; c.tone = 'ok'; }
        else if(/GENERATOR/.test(L2)){ c.v = '1 / 1'; c.capEn = genLate ? 'Monthly run overdue' : 'Monthly run done'; c.capAr = genLate ? 'التشغيل الشهري متأخر' : 'تم التشغيل الشهري'; c.tone = genLate ? 'warn' : 'ok'; }
        else if(/IMBALANCE/.test(L2)){ c.val = imbNow; c.wordEn = imbNow < 10 ? 'Normal' : 'High'; c.wordAr = imbNow < 10 ? 'طبيعي' : 'مرتفع'; c.tone = imbNow < 10 ? 'ok' : 'warn'; }
        else if(/DESIGN CAPACITY/.test(L2)){ const cap = V(EL.designKw); c.pct = +(h.total / cap * 100).toFixed(1); c.wordEn = (h.total / 1000).toFixed(2) + ' of ' + (cap / 1000).toFixed(1) + ' MW'; c.wordAr = (h.total / 1000).toFixed(2) + ' من ' + (cap / 1000).toFixed(1) + ' م.و'; } }); });
  }

  /* boot: the app calls this once, before the one alarm clock (js/app.js) */
  function boot(E){
    const d = E.data; if(!d || d.sim !== 'medical' || !root.EKO_SIM || !root.EKO_SIM_CFG || !root.EKO_SIM_CFG.medical) return null;
    if(!d.alarmCatalog) d.alarmCatalog = (d.alarms || []).map(a => { const c = Object.assign({}, a); delete c.raisedAt; delete c.ack; delete c.lifecycle; return c; });   /* the words of each alarm; the engine sets its times and values */
    const e = root.EKO_SIM.create(root.EKO_SIM_CFG.medical, d, E.nowMs());
    apply(e, d); E.sim = e;
    return e;
  }
  root.EKO_SIM = Object.assign(root.EKO_SIM || {}, { apply, boot });
  if(typeof module !== 'undefined') module.exports = { apply, boot };
})(typeof window !== 'undefined' ? window : globalThis);
