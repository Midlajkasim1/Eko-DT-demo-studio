/* ============================================================================
   ESTATE MODEL (D103) — the portfolio's one source of derived site facts and
   estate aggregates. Pure data in, plain objects out; every aggregate goes
   through EKO_ROLLUP so the honesty rules cannot be bypassed here.

   Memoisation: sites(E) and header(E) are computed once per CHANGE — the key
   is the estate version counter, the fixture, the language, the coverage
   threshold and the live alarm store — never once per render. stats.computes
   counts header computations so a test can prove it.
   ============================================================================ */
window.EKO_EST = (function(){
  'use strict';
  const R = () => window.EKO_ROLLUP, D = () => window.EKO_DATA.estate;
  const stats = { computes: 0, derives: 0 };
  let cache = { key: null, sites: null, header: null, byId: null };
  let gen = null;

  const cfg = () => D().config;
  const clusterOf = id => D().clusters.find(c => c.id === id) || {};
  const typeOf = t => D().types[t] || {};
  const fixture = E => E.state.estateFixture === '1000' ? (gen = gen || window.EKO_DATA.estateGen()) : D().sites;
  const SEVR = { critical: 0, high: 1, medium: 2 };
  /* estate period (D104): independent of the site timeline window */
  const periodCfg = () => cfg().periods;
  const period = E => { const p = E.state.pfPeriod || periodCfg().default; return periodCfg().ids.includes(p) && p !== 'custom' ? p : periodCfg().default; };
  const jitter = key => { let h = 0; for(const ch of String(key)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; const j = (periodCfg().jitterPct || 0) / 100; return 1 - j + (h % 1000) / 1000 * 2 * j; };
  const hasHistory = (site, p) => (site.monthsOfData || 0) >= (periodCfg().minMonths[p] || 0);
  /* energy for a period: the month-to-date fixture scaled by the type's factor and the site's own variation */
  const energyOf = (site, p) => { if(!hasHistory(site, p)) return null; const f = (periodCfg().factors[site.type] || periodCfg().factors.hotel)[p]; return f == null ? null : Math.round(site.energyMtdKwh * f * (p === 'mtd' ? 1 : jitter(site.key))); };
  /* data-centre energy split for a period: IT share scaled the same way, facility = IT × the site's PUE */
  const dcOf = (site, p) => { if(!site.itKwh || !hasHistory(site, p)) return null; const pue = site.facilityKwh / site.itKwh; const it = Math.round(site.itKwh / 12 * (p === 'last12' ? 12 : p === 'lastMonth' ? 1 : p === 'today' ? 1 / 30 : 0.13) * (p === 'mtd' ? 1 : jitter(site.key))); return { it, facility: Math.round(it * pue) }; };
  const REPR = { offline: 0, stale: 1, degraded: 2, reporting: 3 };

  function key(E){
    const al = E.data.alarms || [];
    return [E.state.estateVer || 0, E.state.estateFixture || 'demo', E.lang, period(E), R().config().coverageThreshold, al.length, al.filter(a => a.ack).length, E.state.woRaised ? Object.keys(E.state.woRaised).length : 0].join('|');
  }

  /* The live twin's own facts override its fixture row: the estate row for
     Marsa is the same truth the site shows. */
  function liveOverrides(E){
    const al = E.data.alarms || [];
    const alarms = { critical: 0, high: 0, medium: 0 }; al.forEach(a => alarms[a.sev]++);
    const open = (E.data.assets || []).filter(a => a.wost && a.wost !== 'done').length;
    const overdue = (E.data.assets || []).filter(a => a.wost === 'pend').length;
    return { alarms, unacked: al.filter(a => !a.ack).length, wos: { open, overdue } };
  }

  function derive(E, s, now){
    stats.derives++;
    const site = Object.assign({}, s, s.key === 'marsa' ? liveOverrides(E) : {});
    const p = period(E); site.period = p; site.energyKwh = energyOf(site, p); site.dc = dcOf(site, p); site.periodOk = hasHistory(site, p);
    site.id = site.key;
    site.heartbeatAt = site.hbAgoMin == null ? null : now - site.hbAgoMin * 60000;
    site.lastSampleAt = site.sampleAgoMin == null ? null : now - site.sampleAgoMin * 60000;
    site.expectedIntervalMin = site.intervalMin;
    site.heartbeatTimeoutFactor = site.offlineFactor || cfg().offlineFactorDefault;
    site.state = R().reportingState(site, now);
    site.telemetry = R().usesTelemetry(site.state);
    const a = site.alarms || { critical: 0, high: 0, medium: 0 }; site.alarms = a;
    site.alarmCount = (a.critical || 0) + (a.high || 0) + (a.medium || 0);
    site.worstSev = a.critical ? 'critical' : a.high ? 'high' : a.medium ? 'medium' : null;
    site.sevRank = site.worstSev ? SEVR[site.worstSev] : 3;
    site.repRank = REPR[site.state];
    const cl = clusterOf(site.cluster); site.region = cl.region || ''; site.clusterEn = cl.en || ''; site.clusterAr = cl.ar || '';
    site.vertical = typeOf(site.type).vertical || 'retail';
    site.compliancePct = site.pmDue ? Math.round(site.pmDone / site.pmDue * 1000) / 10 : null;
    const b = cfg().complianceBands; site.complianceBand = site.compliancePct == null ? null : site.compliancePct >= b.ok ? 'ok' : site.compliancePct >= b.mid ? 'mid' : 'low';
    site.wos = site.wos || { open: 0, overdue: 0 }; site.meters = site.meters || null;
    site.kpi = kpi(site);
    return site;
  }

  /* Headline KPI per vertical. A site that is not reporting gets no current
     figure: value null and the reason, never a stale number. */
  function kpi(site){
    const not = !site.telemetry ? { value: null, reason: site.state } : (!site.periodOk ? { value: null, reason: 'insufficientHistory' } : null);
    if(site.vertical === 'hospitality'){
      return Object.assign({ kind: 'eui', unit: 'kWh/m²', value: site.floorArea && site.energyKwh != null ? site.energyKwh / site.floorArea : null, basisKey: 'pfBasis.eui', period: site.period }, not || {});
    }
    if(site.vertical === 'datacentre'){
      const pue = site.dc ? site.dc.facility / site.dc.it : null, full = (site.monthsOfData || 0) >= cfg().pueMinMonths;
      return Object.assign({ kind: full ? 'pue' : 'pueShort', value: pue, itLoadKw: site.itLoadKw, months: site.monthsOfData, basisKey: 'pfBasis.pue', period: site.period }, not || {});
    }
    return Object.assign({ kind: 'wo', open: site.wos.open, overdue: site.wos.overdue, energyKwh: site.energyKwh, value: site.wos.open, period: site.period }, not || {});
  }

  function sites(E){
    const k = key(E);
    if(cache.key !== k){ const now = Date.now(); const list = fixture(E).map(s => derive(E, s, now)); const byId = {}; list.forEach(s => byId[s.id] = s); cache = { key: k, sites: list, byId, header: null }; }
    return cache.sites;
  }
  const site = (E, id) => { sites(E); return cache.byId[id] || null; };

  /* Estate aggregates: additive totals with coverage, the not-reporting
     count, and per-vertical ratios that never cross verticals. */
  function header(E){
    sites(E);
    if(cache.header) return cache.header;
    stats.computes++;
    const all = cache.sites, state = s => s.state, th = cfg().coverageThreshold;
    const by = v => all.filter(s => s.vertical === v);
    const rep = { reporting: 0, stale: 0, offline: 0, degraded: 0, notReporting: [] };
    all.forEach(s => { rep[s.state]++; if(!s.telemetry) rep.notReporting.push({ id: s.id, reason: s.state }); });
    const p = period(E), elig = s => s.periodOk ? true : 'insufficientHistory';
    const h = {
      sitesTotal: all.length, period: p,
      mix: { hospitality: by('hospitality').length, datacentre: by('datacentre').length, retail: by('retail').length },
      reporting: rep,
      alarms: R().sum(all, { value: s => s.alarmCount, needs: 'records', state, threshold: th }),
      unacked: R().sum(all, { value: s => s.unacked || 0, needs: 'records', state, threshold: th }),
      energy: R().sum(all, { value: s => s.telemetry ? s.energyKwh : null, weight: s => s.floorArea, weightKey: 'floorArea', eligible: elig, state, threshold: th }),
      wos: R().sum(all, { value: s => s.wos.open, needs: 'records', state, threshold: th }),
      overdue: R().sum(all, { value: s => s.wos.overdue, needs: 'records', state, threshold: th }),
      verticals: {
        hospitality: by('hospitality').length ? R().ratio(by('hospitality'), { num: s => s.energyKwh, den: s => s.floorArea, denKey: 'floorArea', eligible: elig, state, threshold: th }) : null,
        datacentre: by('datacentre').length ? R().ratio(by('datacentre'), { num: s => s.dc ? s.dc.facility : null, den: s => s.dc ? s.dc.it : null, denKey: 'itLoad', eligible: s => (s.monthsOfData || 0) >= cfg().pueMinMonths && s.periodOk ? true : 'insufficientHistory', state, threshold: th }) : null,
        datacentreIt: by('datacentre').length ? R().sum(by('datacentre'), { value: s => s.itLoadKw, needs: 'records', state, threshold: th }) : null,
        retailOverdue: by('retail').length ? R().sum(by('retail'), { value: s => s.wos.overdue, needs: 'records', state, threshold: th }) : null,
        retailEnergyPerSite: by('retail').length ? R().ratio(by('retail'), { num: s => s.energyKwh, den: () => 1, denKey: 'sites', eligible: elig, state, threshold: th }) : null
      }
    };
    cache.header = h;
    return h;
  }

  /* The estate alarm list for the shared ribbon: one {sev, ack} per alarm,
     expanded from every site's counts (records: stale sites included). */
  function ribbonList(E){
    const out = [];
    sites(E).forEach(s => { let un = s.unacked || 0; ['critical', 'high', 'medium'].forEach(sev => { for(let i = 0; i < (s.alarms[sev] || 0); i++){ out.push({ sev, ack: un > 0 ? null : { time: '', who: '' } }); if(un > 0) un--; } }); });
    return out;
  }

  const bump = E => { E.state.estateVer = (E.state.estateVer || 0) + 1; };
  const label = (E, kind, id) => { const ar = E.lang === 'ar';
    if(kind === 'region'){ const r = D().regions.find(x => x.id === id); return r ? (ar ? r.ar : r.en) : id; }
    if(kind === 'cluster'){ const c = clusterOf(id); return ar ? (c.ar || id) : (c.en || id); }
    if(kind === 'type'){ const t = typeOf(id); return ar ? (t.ar || id) : (t.en || id); }
    if(kind === 'vertical'){ const v = D().verticals[id]; return v ? (ar ? v.ar : v.en) : id; }
    return id; };

  /* one site's figures for every period (the detail page's energy table) */
  const energyByPeriod = (E, s) => periodCfg().ids.filter(p => p !== 'custom').map(p => ({ id: p, kwh: s.telemetry ? energyOf(s, p) : null, ok: hasHistory(s, p) }));
  return { sites, site, header, ribbonList, bump, label, stats, typeOf, clusterOf, cfg, period, energyByPeriod };
})();
