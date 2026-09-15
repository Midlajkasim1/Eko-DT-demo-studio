/* ============================================================================
   PORTFOLIO ROLL-UP ENGINE (D103, stage 1) — a pure module, no UI, no DOM.
   Everything above a single site (estate totals, ratios, availability,
   percentile scores) goes through here so no caller can aggregate wrongly.

   Vocabulary
     site = { id, ... }                       any object with an id
     accessor = site => number | null         null means "no data for this site"
     result = deepFrozen {
       value,                                  the aggregate (null when nothing qualified)
       sitesIncluded, sitesTotal,
       sitesExcluded: [{ id, reason }],        NAMED, never silently dropped
       coveragePct,                            weighted by the metric's denominator (or weight), not by site count
       lowCoverage,                            coveragePct < threshold
       basis: { kind, weightKey }              what the coverage is weighted by
     }

   Laws enforced here
     1. Site reporting state is first-class: reporting · stale · offline · degraded.
        It is never folded into health.
     2. Additive quantities SUM.  ratio() takes a NUMERATOR and a DENOMINATOR
        accessor and divides the sums; there is no way to hand it a per-site
        ratio, so per-site ratios can never be averaged.
     3. Availability returns the worst site and the count below target — never
        a mean.  Percentile scores return the distribution plus a weighted
        headline.
     4. Sites that are stale or offline are excluded from telemetry metrics
        but always counted (sitesTotal) and named (sitesExcluded).  Record
        metrics (alarm counts, work orders) include them (`needs:'records'`)
        and return them in `unknownLive`: an offline site could be raising
        alarms nobody can see, and the aggregate carries that note itself.
     5. Coverage below the threshold (default 90%) flags lowCoverage.
     6. Offline = heartbeat older than heartbeatTimeoutFactor × the site's
        expected interval; per site (`site.heartbeatTimeoutFactor`), default 3.
   ============================================================================ */
window.EKO_ROLLUP = (function(){
  'use strict';

  /* ------------------------------ config ---------------------------------- */
  const cfg = { coverageThreshold: 90, heartbeatTimeoutFactor: 3 };
  function config(patch){ if(patch) Object.assign(cfg, patch); return Object.assign({}, cfg); }

  /* ------------------------------ helpers --------------------------------- */
  const num = v => (typeof v === 'number' && isFinite(v)) ? v : null;
  const ms = t => t == null ? null : (typeof t === 'number' ? t : Date.parse(t));
  const round = (v, d) => v == null ? null : Math.round(v * Math.pow(10, d)) / Math.pow(10, d);
  function deepFreeze(o){ if(o && typeof o === 'object' && !Object.isFrozen(o)){ Object.freeze(o); Object.keys(o).forEach(k => deepFreeze(o[k])); } return o; }

  /* --------------------------- reporting state ---------------------------- */
  /* Derived per site from its heartbeat and last sample.
       offline   — no heartbeat, or the heartbeat is older than
                   heartbeatTimeoutFactor × expected interval
       stale     — heartbeat fine but no sample within the expected interval
       degraded  — heartbeat and samples fine, the feed reports a source down
       reporting — everything present
     site = { heartbeatAt, lastSampleAt, expectedIntervalMin, sourcesDown } */
  function reportingState(site, now){
    const t = ms(now == null ? Date.now() : now);
    const hb = ms(site.heartbeatAt), ls = ms(site.lastSampleAt);
    const interval = (num(site.expectedIntervalMin) || 15) * 60000;
    const factor = num(site.heartbeatTimeoutFactor) || cfg.heartbeatTimeoutFactor;   /* per site; the config value is the default (3× the expected interval) */
    if(hb == null || t - hb > interval * factor) return 'offline';
    if(ls == null || t - ls > interval) return 'stale';
    const down = Array.isArray(site.sourcesDown) ? site.sourcesDown.length : (num(site.sourcesDown) || 0);
    if(down > 0) return 'degraded';
    return 'reporting';
  }
  const REPORTING = Object.freeze(['reporting', 'stale', 'offline', 'degraded']);
  const usesTelemetry = st => st === 'reporting' || st === 'degraded';

  /* ------------------------------ core pass ------------------------------- */
  /* Walks the sites once, decides inclusion, collects the named exclusions and
     the coverage weights.  `pick(site)` returns the numbers a metric needs or
     a string reason to exclude. */
  function pass(sites, opts, pick){
    const now = opts.now, needs = opts.needs || 'telemetry', threshold = opts.threshold == null ? cfg.coverageThreshold : opts.threshold;
    const excluded = [], included = [], unknownLive = [];
    let wIn = 0, wAll = 0;
    sites.forEach(site => {
      const st = opts.state ? opts.state(site) : reportingState(site, now);
      const w = num(opts.weight ? opts.weight(site) : null);
      if(w != null) wAll += w;
      if(needs === 'telemetry' && !usesTelemetry(st)){ excluded.push({ id: site.id, reason: st }); return; }
      /* records from a site that is not reporting are facts that happened; its LIVE state is unknown and the aggregate says so */
      if(needs === 'records' && !usesTelemetry(st)) unknownLive.push({ id: site.id, reason: st });
      const el = opts.eligible ? opts.eligible(site) : true;
      if(el !== true){ excluded.push({ id: site.id, reason: typeof el === 'string' ? el : 'ineligible' }); return; }
      const got = pick(site);
      if(typeof got === 'string'){ excluded.push({ id: site.id, reason: got }); return; }
      included.push(Object.assign({ id: site.id, state: st }, got));
      if(w != null) wIn += w;
    });
    let coveragePct;
    if(opts.weight) coveragePct = wAll > 0 ? round(wIn / wAll * 100, 1) : 0;
    else coveragePct = sites.length ? round(included.length / sites.length * 100, 1) : 0;
    return { included, excluded, unknownLive, coveragePct, lowCoverage: coveragePct < threshold, threshold,
      basis: { kind: opts.weight ? 'weighted' : 'count', weightKey: opts.weightKey || (opts.weight ? 'weight' : 'sites') } };
  }
  function finish(p, value, extra){
    return deepFreeze(Object.assign({ value, sitesIncluded: p.included.length, sitesTotal: p.included.length + p.excluded.length,
      sitesExcluded: p.excluded, unknownLive: p.unknownLive, coveragePct: p.coveragePct, lowCoverage: p.lowCoverage, coverageThreshold: p.threshold, basis: p.basis }, extra || {}));
  }

  /* ------------------------------ aggregates ------------------------------ */
  /* Additive: energy, cost, alarm counts, work orders.  Coverage is weighted
     by the metric's own natural denominator: the caller passes opts.weight
     (floor area for energy); counts (alarms, work orders) pass none and are
     weighted by site count — a small site's alarms matter as much as a large
     one's.  needs:'records' includes sites that are not reporting and lists
     them in unknownLive. */
  function sum(sites, opts){
    const p = pass(sites, opts, site => { const v = num(opts.value(site)); return v == null ? 'noData' : { v }; });
    const value = p.included.length ? p.included.reduce((a, r) => a + r.v, 0) : null;
    return finish(p, value);
  }

  /* Ratio / intensity: PUE, WUE, EUI, energy per m², PM compliance.
     Takes a NUMERATOR and a DENOMINATOR accessor.  Sums each, then divides.
     Coverage is weighted by the denominator over every site that has one
     (a stale site's floor area still counts in the total it is missing from). */
  function ratio(sites, opts){
    if(typeof opts.num !== 'function' || typeof opts.den !== 'function') throw new Error('EKO_ROLLUP.ratio needs { num, den } accessors — a per-site ratio cannot be aggregated');
    if('value' in opts) throw new Error('EKO_ROLLUP.ratio does not accept a value accessor');
    const o = Object.assign({}, opts, { weight: site => num(opts.den(site)), weightKey: opts.denKey || 'denominator' });
    const p = pass(sites, o, site => { const n = num(opts.num(site)), d = num(opts.den(site)); if(n == null) return 'noData'; if(d == null || d <= 0) return 'noDenominator'; return { n, d }; });
    const N = p.included.reduce((a, r) => a + r.n, 0), D = p.included.reduce((a, r) => a + r.d, 0);
    return finish(p, D > 0 ? N / D : null, { numerator: N, denominator: D });
  }

  /* Availability: the worst site and the count below target.  No mean. */
  function availability(sites, opts){
    const p = pass(sites, opts, site => { const v = num(opts.value(site)); return v == null ? 'noData' : { v }; });
    const target = num(opts.target);
    let worst = null; let below = 0;
    p.included.forEach(r => { if(!worst || r.v < worst.value) worst = { id: r.id, value: r.v }; if(target != null && r.v < target) below++; });
    return finish(p, worst ? worst.value : null, { worst, belowTarget: below, target, sitesAtOrAboveTarget: p.included.length - below });
  }

  /* Percentile scores (e.g. Energy Star style): the distribution and an
     area-weighted headline.  opts.weight is the area accessor. */
  function percentile(sites, opts){
    if(typeof opts.weight !== 'function') throw new Error('EKO_ROLLUP.percentile needs a weight accessor (floor area) for the headline');
    const p = pass(sites, opts, site => { const v = num(opts.value(site)), w = num(opts.weight(site)); if(v == null) return 'noData'; if(w == null || w <= 0) return 'noWeight'; return { v, w }; });
    const dist = p.included.map(r => ({ id: r.id, value: r.v, weight: r.w })).sort((a, b) => a.value - b.value);
    const W = dist.reduce((a, r) => a + r.weight, 0);
    const headline = W > 0 ? dist.reduce((a, r) => a + r.value * r.weight, 0) / W : null;
    const q = f => { if(!dist.length) return null; const i = Math.min(dist.length - 1, Math.max(0, Math.round((dist.length - 1) * f))); return dist[i].value; };
    return finish(p, headline, { distribution: dist, p10: q(.1), p50: q(.5), p90: q(.9), min: dist.length ? dist[0].value : null, max: dist.length ? dist[dist.length - 1].value : null });
  }

  /* Counts per reporting state, always over every site. */
  function reportingSummary(sites, now){
    const out = { reporting: 0, stale: 0, offline: 0, degraded: 0, notReporting: [] };
    sites.forEach(s => { const st = reportingState(s, now); out[st]++; if(!usesTelemetry(st)) out.notReporting.push({ id: s.id, reason: st }); });
    return deepFreeze(out);
  }

  return { config, reportingState, reportingSummary, REPORTING, sum, ratio, availability, percentile, usesTelemetry };
})();
