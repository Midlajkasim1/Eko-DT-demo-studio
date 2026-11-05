/* ============================================================================
   ENERGY DAILY MODEL (D182, functional specs 9 and 10, rule 8). A seeded demo
   recipe in the site data (data.energyModel) turned into daily values relative
   to today, so the benchmark's month to date, the forecast for this month and
   the Overview's energy tile agree on any demo day. Production: the FIN history
   (daily kWh by system meter), the weather feed (cooling degree days), the
   design energy model and the budget.
     day(E, agoD)        { date, cdd, design{sys}, actual{sys}, lastYear{sys}, total, designTotal }   agoD 0 = today
     mtd(E)              month to date: actual and normalised design by system, the gap onset per system
     forecast(E)         the method (last year's day x the recent trend per system), month end, next month,
                         the next 60 days, P10 to P90 from the backtest errors, peak kW, budget
     backtest(E)         the last 92 days: what the method would have forecast against the actual
   Today's actual so far is the Overview's figure (metrics.energyTodayMwh).
   ============================================================================ */
(function(root){
  'use strict';
  const DAY = 86400000;
  const rnd = (seed, i) => { let x = Math.sin(seed * 9301 + i * 49297) * 233280; return x - Math.floor(x) - 0.5; };
  const midnight = ms => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
  function make(m){
    const SYS = m.systems.map(s => s.id);
    const doy = ms => { const d = new Date(ms), s = new Date(d.getFullYear(), 0, 0); return Math.floor((ms - s.getTime()) / DAY); };
    const tMean = ms => m.climate.meanC + m.climate.ampC * Math.sin(2 * Math.PI * (doy(ms) - m.climate.peakDoy + 91) / 365);
    const cdd = ms => Math.max(0, tMean(ms) - m.climate.baseC);
    const wk = ms => m.weekday[new Date(ms).getDay()];
    /* design: the design model's day; cooling scales with degree days, the rest with operating hours (the weekday factor) */
    const design = ms => { const o = {}; m.systems.forEach(s => { o[s.id] = m.baseMwh * s.share * (s.cdd ? cdd(ms) / m.climate.designCdd : wk(ms)); }); return o; };
    const actualAt = (ms, agoD, lastYear) => { const d = design(ms), o = {};
      m.systems.forEach((s, i) => { let v = d[s.id] * (1 + s.bias) * (1 + rnd(m.seed + i, Math.round(ms / DAY)) * m.noise);
        if(lastYear) v *= 1 - m.trendPct / 100;
        else if(s.id === m.fault.sys && agoD <= m.fault.onsetAgoD) v *= 1 + m.fault.extra;
        o[s.id] = v; });
      return o; };
    const sum = o => SYS.reduce((a, k) => a + o[k], 0);
    function day(E, agoD){
      /* E1: on a site with the building data engine, the day is the engine's (hourly physics summed; today up to the load minute) */
      if(m.engine){ const x = m.engine.day(-agoD), ly = m.engine.day(-agoD - 364);
        /* E10: today is the day so far; the forecast's weather ratio takes the whole day's design (it read the part so far, so today's forecast dropped) */
        let designFull = null; if(x.part < 1){ designFull = {}; SYS.forEach(k => { designFull[k] = 0; }); for(let h = 0; h < 24; h++){ const y = m.engine.hour(x.ms + h * 36e5, true); SYS.forEach(k => { designFull[k] += y.sys[k] / 1000; }); } }
        return { ms: x.ms, agoD, cdd: x.cdd, design: x.design, designFull, actual: x.actual, lastYear: ly.actual, lastYearDesign: ly.design, total: x.total, designTotal: x.designTotal, lastYearTotal: ly.total, part: x.part, peakKw: x.peakKw }; }
      const ms = midnight(E.nowMs()) - agoD * DAY, d = design(ms), a = actualAt(ms, agoD, false), ly = actualAt(ms - 364 * DAY, null, true);   /* last year: the same weekday, 52 weeks earlier */
      return { ms, agoD, cdd: cdd(ms), design: d, actual: a, lastYear: ly, total: sum(a), designTotal: sum(d), lastYearTotal: sum(ly) };
    }
    /* the method: last year's same day, scaled per system by the trend of the 7 days before the forecast is made */
    /* E1: with the engine, last year's day is first scaled by the design model at the day's weather and schedule against last year's
       (the weather forecast in production; the engine's own weather in the demo), then by the trend */
    const wx = (x, k) => x.lastYearDesign && x.lastYearDesign[k] ? (x.designFull || x.design)[k] / x.lastYearDesign[k] : 1;
    const trendAt = (E, fromAgoD) => { const o = {}; SYS.forEach(k => { let a = 0, l = 0; for(let i = fromAgoD + 1; i <= fromAgoD + 7; i++){ const x = day(E, i); a += x.actual[k]; l += x.lastYear[k] * wx(x, k); } o[k] = l ? a / l : 1; }); return o; };
    const fcDay = (E, agoD, tr) => { const x = day(E, agoD), o = {}; SYS.forEach(k => { o[k] = x.lastYear[k] * wx(x, k) * tr[k]; }); return { ms: x.ms, bySys: o, total: sum(o), lastYearTotal: x.lastYearTotal }; };
    let btCache = null;
    function backtest(E){
      const key = midnight(E.nowMs()); if(btCache && btCache.key === key) return btCache.v;
      const actual = [], forecast = [];
      for(let i = 92; i >= 1; i--){ const tr = trendAt(E, i); actual.push(+day(E, i).total.toFixed(3)); forecast.push(+fcDay(E, i, tr).total.toFixed(3)); }   /* each day forecast the day before, from the 7 days before it */
      btCache = { key, v: { demo: true, unit: 'MWh', days: 92, actual, forecast } }; return btCache.v;
    }
    function mtd(E){
      const now = new Date(E.nowMs()), dom = now.getDate(), act = {}, des = {}, daily = [];
      SYS.forEach(k => { act[k] = 0; des[k] = 0; });
      const todayShare = m.engine ? 1 : E.data.metrics && E.data.metrics.energyTodayMwh != null ? E.data.metrics.energyTodayMwh / day(E, 0).total : 1;   /* the engine's today is already the day so far */
      for(let i = dom - 1; i >= 0; i--){ const x = day(E, i), f = i === 0 ? todayShare : 1;
        SYS.forEach(k => { act[k] += x.actual[k] * f; des[k] += x.design[k] * f; }); daily.push(Object.assign({}, x, { part: m.engine ? x.part : f })); }
      /* when a system's gap began: the first day of the latest run of days more than twice the tolerance over design */
      const onset = {}; SYS.forEach(k => { let o = null; for(let i = 0; i < 60; i++){ const x = day(E, i); if(x.actual[k] / x.design[k] - 1 > 2 * m.tolPct / 100) o = i; else if(o != null) break; } onset[k] = o; });
      return { days: dom, actual: act, design: des, total: sum(act), designTotal: sum(des), daily, onset };
    }
    function forecast(E){
      const now = new Date(E.nowMs()), y = now.getFullYear(), mo = now.getMonth(), dim = new Date(y, mo + 1, 0).getDate(), dom = now.getDate();
      const bt = backtest(E), err = bt.actual.map((a, i) => (a - bt.forecast[i]) / bt.forecast[i]).sort((p, q) => p - q);
      const q = p => err[Math.min(err.length - 1, Math.max(0, Math.round(p * (err.length - 1))))];
      const tr = trendAt(E, 0), M = mtd(E);
      const ahead = []; for(let i = 0; i <= 62 + dim; i++){ const f = fcDay(E, -i, tr); ahead.push(f); }
      /* today: the rest of the day is forecast; then the remaining days of the month */
      const restToday = ahead[0].total * (1 - (M.daily[M.daily.length - 1] || { part: 0 }).part);
      let rem = restToday; for(let i = 1; i <= dim - dom; i++) rem += ahead[i].total;
      const remDays = dim - dom + 1 - (M.daily[M.daily.length - 1] || { part: 0 }).part;
      /* the range: the backtest's daily P10 and P90 errors, summed over the remaining days */
      const monthEnd = { v: M.total + rem, lo: M.total + rem * (1 + q(0.1)), hi: M.total + rem * (1 + q(0.9)) };
      const next = { bySys: {}, lastYearBySys: {} }; let nt = 0, nly = 0; const n0 = dim - dom + 1, nDim = new Date(y, mo + 2, 0).getDate();
      SYS.forEach(k => { next.bySys[k] = 0; next.lastYearBySys[k] = 0; });
      for(let i = n0; i < n0 + nDim; i++){ const f = ahead[i]; SYS.forEach(k => { next.bySys[k] += f.bySys[k]; }); nt += f.total; const x = day(E, -i); SYS.forEach(k => { next.lastYearBySys[k] += x.lastYear[k]; }); nly += x.lastYearTotal; }
      next.v = nt; next.lo = nt * (1 + q(0.1)); next.hi = nt * (1 + q(0.9)); next.lastYear = nly; next.days = nDim;
      const budget = k => (m.budgetMwh || [])[((k % 12) + 12) % 12];
      /* the engine gives the hourly peak of each coming day (its schedule and the weather normals); the demand ratio turns it into the 15-minute peak */
      const peakKw = m.engine ? Math.max(...ahead.slice(1, 61).map((f, i) => day(E, -(i + 1)).peakKw)) : Math.max(...ahead.slice(0, 60).map(f => f.total)) * 1000 / 24 * m.peakRatio;
      /* E3: with an engine, the peak's day and the peak if the fault behind it is fixed (the engine's own what-if, not a scaling) */
      let peakAt = null, peakFixed = null, peak15 = null;
      if(m.engine && m.engine.peakAhead){ const P = m.engine.peakAhead(60); peakAt = P.at; peak15 = P.kw15; const fx = m.engine.whatIf({ fix: ['chillerCop'] }).peakAhead(60);
        peakFixed = { kw: fx.kw, kw15: fx.kw15, at: fx.at, fault: 'chillerCop', asset: m.engine.faults.chillerCop.asset, wo: 'WO-5118' };
        /* E8: the energy with the fault fixed: the forecast less what the engine's own what-if takes off over the same days */
        const tw = m.engine.whatIf({ fix: ['chillerCop'] }), saved = (a, b) => { let s = 0; for(let i = a; i < b; i++) s += m.engine.day(i).total - tw.day(i).total; return s; };
        monthEnd.fixed = monthEnd.v - saved(1, dim - dom + 1); next.fixed = nt - saved(n0, n0 + nDim); }
      return { trend: tr, monthEnd, budgetMonth: budget(mo), next, budgetNext: budget(mo + 1), ahead: ahead.slice(0, 61), q10: q(0.1), q90: q(0.9), peakKw, peak15, peakAt, peakFixed, contractKw: m.contractKw, mtd: M, dim, dom };
    }
    return { day, mtd, forecast, backtest, systems: m.systems, model: m };
  }
  const cache = new WeakMap();
  const api = { of(E){ const m = E.data.energyModel; if(!m) return null; if(!cache.has(m)) cache.set(m, make(m)); return cache.get(m); }, make };
  if(typeof module !== 'undefined') module.exports = api; else root.EKO_EM = api;
})(typeof window !== 'undefined' ? window : this);
