/* ============================================================================
   REPORTING ENGINE — the data contract and the composition rules
   (D88 stage 1 · D89 stage 2 · D90 stage 3 · D91 stage 4).

   THE PRODUCT ARGUMENT: reports are generated inside the client's perimeter,
   from the SAME data layer the screens read, and every figure carries its
   basis. Two things never break: no number is produced by a language model
   (js/reports/narrate.js guards it), and no figure appears without its basis.

   CONTRACT
     ReportSpec  { templateId, siteKey, period:{kind, h?, n?}|null, params:{
                   alarmId?, assetId?, includeAlarms? } }
     ReportDoc   { id, version:1, lang, spec, templateId, titleKey, site,
                   period:{kind, from, to, labelKey, params}, generatedAt,
                   generatedAtLabel, generatedBy, basisVersions:{tariff,
                   emission, tariffProvisional, emissionProvisional},
                   provisional:[what], ekoVersion, sections:[Section],
                   dataQuality:[DQ], figures:{id:Figure}, narration:Narration|null }
     Section     { id, titleKey, status:'ok'|'missing'|'partial'|'locked',
                   missing?:{ reasonKey, params }, widgets:[RenderedWidget] }
     Figure      { id, value, unit, d, fmt, labelKey, basis:Basis,
                   sources:[srcId], flagged:bool }
     Basis       { from, to, windowKey, windowParams, sources:[srcId],
                   averagingKey?, tariff?:{id,version,rate,unit,provisional},
                   emission?:{id,factor,unit,provisional}, formulaKey? }
     DQ          { sourceId, state:'offline'|'stale'|'intermittent'|
                   'unconfirmed'|'degraded', from, to, noteKey, params }
     Narration   { status:'on'|'off'|'partial', adapter, reasonKey?,
                   summary?:Narrated, sections:{ sectionId:Narrated },
                   recommendations?:Narrated, rejections:[{sectionId, attempt,
                   numbers}] }
     Narrated    { text, sources:{ points:[srcId], windowKey, windowParams,
                   bases:[text] }, rejected?:bool }

   IMMUTABILITY (stage 3): a generated document is deep-frozen, stored under
   its id, and never edited; regenerating makes a new id. The audit trail
   records generation, export and narration rejections with user, time and
   parameters. GOVERNANCE: a section bound to a locked module or sub-module
   contributes nothing and says so.
   ============================================================================ */
window.EKO_R = (function(){
  'use strict';
  const T = () => (window.EKO_REPORTS && window.EKO_REPORTS.templates) || {};
  const pad = n => String(n).padStart(2, '0');
  const truncDec = (n, d) => {
    const x = Number(n); if (!isFinite(x)) return NaN;
    if (d <= 0) return Math.trunc(x + (x < 0 ? -1e-9 : 1e-9));
    const f = Math.pow(10, d);
    return Math.trunc(x * f + (x < 0 ? -1e-9 : 1e-9)) / f;
  };
  /* A reading is a finite number or it is MISSING: never "null", "NaN" or a
     silent 0. Zero and negatives are readings; null, NaN, ±Infinity, '' and
     non-numeric strings are not. */
  const MISSING = '—';
  const num = v => { const x = typeof v === 'number' ? v : (typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN); return Number.isFinite(x) ? x : null; };
  /* derived figures: any missing input makes the result missing (null × rate is not 0 AED) */
  const mul = (...xs) => { const n = xs.map(num); return n.includes(null) ? null : n.reduce((a, b) => a * b, 1); };
  const div = (a, b) => { const x = num(a), y = num(b); return x == null || !y ? null : x / y; };
  const fmt = (v, d) => {
    const x = num(v); if (x == null) return MISSING;
    const t = truncDec(x, d);
    return t.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  };
  /* translator for document text: a missing parameter prints MISSING, not "null" */
  const clean = v => { if(!v) return v; const o = {}; for(const k in v){ const x = v[k]; o[k] = x == null || (typeof x === 'number' && !isFinite(x)) ? MISSING : x; } return o; };
  const tr = (E, lang) => (k, v) => E.t.call({ lang: lang || E.lang }, k, clean(v));
  const LS_STORE = 'eko-reports-v1', LS_AUDIT = 'eko-audit-v1', LS_REMOVED = 'eko-reports-removed-v1', STORE_CAP = 12, AUDIT_CAP = 300;

  /* The site's clock for printed times (the open project's timezone, named); the browser's in the prototype */
  const siteTimeOpts = () => { const tz = ((window.INJECTED_PROJECT_CONFIG || {}).site || {}).timezone; return tz ? { timeZone: tz, timeZoneName: 'short' } : {}; };

  /* ---- sources: every id a figure can cite ------------------------------ */
  const SOURCES = {
    'meters.main': { labelKey:'rpSrc.mainMeters' },
    'bms':         { labelKey:'rpSrc.bms' },
    'pmu':         { labelKey:'rpSrc.pmu' },
    'alarms':      { labelKey:'rpSrc.alarms' },
    'assets':      { labelKey:'rpSrc.assets' },
    'cmms':        { labelKey:'rpSrc.cmms' },
    'meter.W-01':  { labelKey:'rpSrc.meterW01' },
    'meter.G-01':  { labelKey:'rpSrc.meterG01' },
    'meter.MW-03': { labelKey:'rpSrc.meterMW03' },
    'meter.KG-02': { labelKey:'rpSrc.meterKG02' },
    'model.opt':   { labelKey:'rpSrc.modelOpt' },
    'model.anom':  { labelKey:'rpSrc.modelAnom' },
    'bench':       { labelKey:'rpSrc.bench' },
    'model.fcst':  { labelKey:'rpSrc.modelFcst' }
  };

  /* ---- periods ---------------------------------------------------------- */
  const PERIODS = ['today', 'last6', 'last12', 'days3', 'month', 'prevMonth'];
  function period(E, p){
    const asOf = E.data.basis.asOf || '14:00';
    p = p || { kind:'today' };
    if(p.kind === 'today')     return { kind:'today', from:'00:00', to:asOf, labelKey:'rpWin.today', params:{ to:asOf } };
    if(p.kind === 'last')      return { kind:'last', h:p.h, from:null, to:asOf, labelKey:'rpWin.lastH', params:{ h:p.h, to:asOf } };
    if(p.kind === 'days')      return { kind:'days', n:p.n, from:null, to:asOf, labelKey:'rpWin.lastD', params:{ n:p.n } };
    if(p.kind === 'month')     return { kind:'month', from:E.data.basis.monthStart || '', to:asOf, labelKey:'rpWin.mtd', params:{ to:asOf } };
    if(p.kind === 'prevMonth') return { kind:'prevMonth', from:null, to:null, labelKey:'rpWin.prevMonth', params:{} };
    return { kind:'today', from:'00:00', to:asOf, labelKey:'rpWin.today', params:{ to:asOf } };
  }
  /* option id (panel form) ↔ period spec */
  const periodOf = id => ({ today:{ kind:'today' }, last6:{ kind:'last', h:6 }, last12:{ kind:'last', h:12 }, days3:{ kind:'days', n:3 }, month:{ kind:'month' }, prevMonth:{ kind:'prevMonth' } })[id] || { kind:'today' };
  const periodId = p => !p ? 'today' : p.kind === 'last' ? (p.h === 12 ? 'last12' : 'last6') : p.kind === 'days' ? 'days3' : p.kind;

  const basisFor = (E, o) => Object.assign({ from:'00:00', to:E.data.basis.asOf, windowKey:'rpWin.today', windowParams:{ to:E.data.basis.asOf } }, o || {});
  /* the project's currency (Dashboard Settings → FIN Config); the prototype's AED otherwise */
  const cur = E => (E.data.basis && E.data.basis.currency) || 'AED';
  const tariff = E => ({ id:E.data.basis.tariffId, version:E.data.basis.tariffVersion, rate:E.data.basis.aedPerKwh, unit:cur(E) + '/kWh', provisional:E.data.basis.tariffStatus === 'provisional' });
  const gasTariff = E => ({ id:E.data.basis.tariffId, version:E.data.basis.tariffVersion, rate:E.data.gas.tariffAedM3, unit:cur(E) + '/m³', provisional:E.data.basis.gasTariffStatus === 'provisional' });
  const emission = E => ({ id:E.data.basis.co2FactorId, factor:E.data.basis.co2KgPerKwh, unit:'kg CO₂/kWh', provisional:E.data.basis.co2FactorStatus === 'provisional' });
  const mtd = E => ({ from:E.data.basis.monthStart || '1', to:E.data.basis.asOf, windowKey:'rpWin.mtd', windowParams:{ to:E.data.basis.asOf } });
  const at = E => ({ from:E.data.basis.asOf, to:E.data.basis.asOf, windowKey:'rpWin.at', windowParams:{ t:E.data.basis.asOf } });

  /* ---- figure resolvers: id → figure. `win` says which report windows the
          figure is valid for: 'today' figures are period totals that only
          exist for today (no history feed yet, D31); 'fixed' figures state
          their own window and are valid in any report. ----------------------- */
  const FIG = {
    'metrics.energyTodayMwh': E => {
      const kwh = E.data.metrics.energyTodayKwh != null ? E.data.metrics.energyTodayKwh
        : (E.data.metrics.energyTodayMwh != null ? E.data.metrics.energyTodayMwh * 1000 : null);
      return { win:'today', value:kwh, unit:'kWh', d:1, labelKey:'kEnergyToday', sources:['meters.main'], basis:basisFor(E, { sources:['meters.main'] }) }; },
    'metrics.waterTodayM3':   E => ({ win:'today', value:E.data.metrics.waterTodayM3, unit:'m³', d:1, labelKey:'kWaterToday', sources:['meter.W-01'], basis:basisFor(E, { sources:['meter.W-01'] }) }),
    'metrics.gasTodayM3':     E => ({ win:'today', value:E.data.metrics.gasTodayM3, unit:'m³', d:1, labelKey:'kGasToday', sources:['meter.G-01'], basis:basisFor(E, { sources:['meter.G-01'] }) }),
    'metrics.comfortIndex':   E => ({ win:'today', value:E.data.metrics.comfortIndex, unit:'', d:1, labelKey:'kComfortIdx', sources:['bms'], basis:basisFor(E, { sources:['bms'], averagingKey:E.data.basis.averagingKey }) }),
    'metrics.iaq':            E => ({ win:'today', value:E.data.metrics.iaq, unit:'', d:1, labelKey:'kIaq', sources:['bms'], basis:basisFor(E, { sources:['bms'], averagingKey:E.data.basis.averagingKey }) }),
    'metrics.loadNowMw':      E => ({ win:'fixed', value:E.data.metrics.loadNowMw, unit:'MW', d:1, labelKey:'kLoadNow', sources:['pmu'], basis:basisFor(E, Object.assign({ sources:['pmu'] }, at(E))) }),
    'metrics.peakTodayMw':    E => ({ win:'today', value:E.data.metrics.peakTodayKw != null ? E.data.metrics.peakTodayKw : (E.data.metrics.peakTodayMw != null ? E.data.metrics.peakTodayMw * 1000 : null), unit:'kW', d:1, labelKey:'pwPeak', sources:['pmu'], basis:basisFor(E, { sources:['pmu'], averagingKey:E.data.basis.averagingKey }) }),
    'metrics.pfNow':          E => ({ win:'fixed', value:E.data.metrics.pfNow, unit:'', d:1, labelKey:'kPfNow', sources:['pmu'], basis:basisFor(E, Object.assign({ sources:['pmu'] }, at(E))) }),
    'energy.currentKw':       E => ({ win:'fixed', value:E.data.energyLanding.currentKw, unit:'kW', d:1, labelKey:'pwCurrentCons', sources:['pmu'], basis:basisFor(E, Object.assign({ sources:['pmu'] }, at(E))) }),
    'energy.baselineKw':      E => ({ win:'fixed', value:E.data.energyLanding.baselineKw, unit:'kW', d:1, labelKey:'rpF.baseline', sources:['model.opt'], basis:basisFor(E, { sources:['model.opt'], windowKey:'rpWin.baseline', windowParams:{} }) }),
    'energy.mtdKwh':          E => ({ win:'fixed', value:E.data.energyLanding.mtdKwh, unit:'kWh', d:1, labelKey:'pwMtd', sources:['meters.main'], basis:basisFor(E, Object.assign({ sources:['meters.main'] }, mtd(E))) }),
    'power.prevMonthKwh':     E => ({ win:'fixed', value:E.data.power.prevMonthKwh, unit:'kWh', d:1, labelKey:'pwPrevMonth', sources:['meters.main'], basis:basisFor(E, { sources:['meters.main'], from:null, to:null, windowKey:'rpWin.prevMonth', windowParams:{} }) }),
    'energy.performancePct':  E => ({ win:'fixed', value:E.data.energyLanding.performancePct, unit:'%', d:1, labelKey:'rpF.performance', sources:['model.opt'], basis:basisFor(E, Object.assign({ sources:['model.opt'] }, mtd(E))) }),
    'power.contractedKw':     E => ({ win:'fixed', value:E.data.metrics.contractedKw, unit:'kW', d:0, labelKey:'rpF.contracted', sources:['meters.main'], basis:basisFor(E, { sources:['meters.main'], windowKey:'rpWin.contract', windowParams:{} }) }),
    /* derived: tariff */
    'derived.energyCostTodayAed': E => { const v = mul(E.data.metrics.energyTodayMwh, 1000, E.data.basis.aedPerKwh);
      return { win:'today', value:v, unit:cur(E), d:1, labelKey:'rpF.energyCostToday', sources:['meters.main'], basis:basisFor(E, { sources:['meters.main'], tariff:tariff(E), formulaKey:'rpFx.kwhTimesTariff' }) }; },
    'derived.energyCostMtdAed':   E => { const v = mul(E.data.energyLanding.mtdKwh, E.data.basis.aedPerKwh);
      return { win:'fixed', value:v, unit:cur(E), d:1, labelKey:'rpF.energyCostMtd', sources:['meters.main'], basis:basisFor(E, Object.assign({ sources:['meters.main'], tariff:tariff(E), formulaKey:'rpFx.kwhTimesTariff' }, mtd(E))) }; },
    'derived.energyCostPrevMonthAed': E => { const v = mul(E.data.power.prevMonthKwh, E.data.basis.aedPerKwh);
      return { win:'fixed', value:v, unit:cur(E), d:1, labelKey:'rpF.energyCostPrev', sources:['meters.main'], basis:basisFor(E, { sources:['meters.main'], tariff:tariff(E), formulaKey:'rpFx.kwhTimesTariff', from:null, to:null, windowKey:'rpWin.prevMonth', windowParams:{} }) }; },
    'derived.avoidableAedMo':     E => { const v = mul(E.data.metrics.avoidableKwhMo, E.data.basis.aedPerKwh);
      return { win:'fixed', value:v, unit:cur(E), d:1, labelKey:'rpF.avoidableMo', sources:['model.opt'], basis:basisFor(E, Object.assign({ sources:['model.opt'], tariff:tariff(E), formulaKey:'rpFx.kwhTimesTariff' }, mtd(E))) }; },
    'derived.wasteAedMtd':        E => { const v = mul(E.data.energyLanding.wasteTotalKwh, E.data.basis.aedPerKwh);
      return { win:'fixed', value:v, unit:cur(E), d:1, labelKey:'rpF.wasteMtd', sources:['model.opt'], basis:basisFor(E, Object.assign({ sources:['model.opt'], tariff:tariff(E), formulaKey:'rpFx.kwhTimesTariff' }, mtd(E))) }; },
    /* derived: emission */
    'derived.co2TodayT':          E => { const v = mul(E.data.metrics.energyTodayMwh, E.data.basis.co2KgPerKwh);
      return { win:'today', value:v, unit:'t CO₂', d:1, labelKey:'rpF.co2Today', sources:['meters.main'], basis:basisFor(E, { sources:['meters.main'], emission:emission(E), formulaKey:'rpFx.mwhTimesFactor' }) }; },
    'derived.co2MtdT':            E => { const v = mul(E.data.energyLanding.mtdKwh, E.data.basis.co2KgPerKwh, 0.001);
      return { win:'fixed', value:v, unit:'t CO₂', d:1, labelKey:'pwCarbon', sources:['meters.main'], basis:basisFor(E, Object.assign({ sources:['meters.main'], emission:emission(E), formulaKey:'rpFx.kwhTimesFactor' }, mtd(E))) }; },
    'derived.co2PrevMonthT':      E => { const v = mul(E.data.power.prevMonthKwh, E.data.basis.co2KgPerKwh, 0.001);
      return { win:'fixed', value:v, unit:'t CO₂', d:1, labelKey:'rpF.co2Prev', sources:['meters.main'], basis:basisFor(E, { sources:['meters.main'], emission:emission(E), formulaKey:'rpFx.kwhTimesFactor', from:null, to:null, windowKey:'rpWin.prevMonth', windowParams:{} }) }; },
    /* water / gas */
    'water.todayM3':      E => ({ win:'today', value:E.data.water.todayM3, unit:'m³', d:1, labelKey:'kWaterToday', sources:['meter.W-01'], basis:basisFor(E, { sources:['meter.W-01'] }) }),
    'water.tankVolumeM3': E => ({ win:'fixed', value:E.data.water.tankVolumeM3, unit:'m³', d:1, labelKey:'rpF.tankVolume', sources:['bms'], basis:basisFor(E, Object.assign({ sources:['bms'] }, at(E))) }),
    'derived.waterAutonomyDays': E => { const w = E.data.water; const v = div(w.tankVolumeM3, w.avgDrawM3Day);   /* the data layer fills avgDrawM3Day (static/js/data-map.js) */
      return { win:'fixed', value:v, unit:'d', d:1, labelKey:'rpF.autonomy', sources:['bms','meter.W-01'], basis:basisFor(E, Object.assign({ sources:['bms','meter.W-01'], formulaKey:'rpFx.volumeOverDraw' }, at(E))) }; },
    'water.meterUptimePct': E => ({ win:'fixed', value:E.data.water.meter.uptimePct, unit:'%', d:1, labelKey:'rpF.meterUptime', sources:['meter.W-01'], basis:basisFor(E, { sources:['meter.W-01'], from:null, windowKey:'rpWin.lastD', windowParams:{ n:30 } }) }),
    'gas.todayM3':        E => ({ win:'today', value:E.data.gas.todayM3, unit:'m³', d:1, labelKey:'kGasToday', sources:['meter.G-01'], basis:basisFor(E, { sources:['meter.G-01'] }) }),
    'gas.mtdM3':          E => ({ win:'fixed', value:E.data.gas.mtdM3, unit:'m³', d:1, labelKey:'rpF.gasMtd', sources:['meter.G-01'], basis:basisFor(E, Object.assign({ sources:['meter.G-01'] }, mtd(E))) }),
    'gas.avg7M3':         E => ({ win:'fixed', value:E.data.gas.avg7M3, unit:'m³/d', d:1, labelKey:'rpF.gasAvg7', sources:['meter.G-01'], basis:basisFor(E, { sources:['meter.G-01'], from:null, windowKey:'rpWin.lastD', windowParams:{ n:7 } }) }),
    'derived.gasCostMtdAed': E => { const v = mul(E.data.gas.mtdM3, E.data.gas.tariffAedM3);
      return { win:'fixed', value:v, unit:cur(E), d:1, labelKey:'rpF.gasCostMtd', sources:['meter.G-01'], basis:basisFor(E, Object.assign({ sources:['meter.G-01'], tariff:gasTariff(E), formulaKey:'rpFx.m3TimesTariff' }, mtd(E))) }; },
    /* alarms (counts derive from the one list) */
    'alarms.open':     E => ({ win:'fixed', value:E.data.alarms.length, unit:'', d:0, labelKey:'rpF.alarmsOpen', sources:['alarms'], basis:basisFor(E, Object.assign({ sources:['alarms'] }, at(E))) }),
    'alarms.critical': E => ({ win:'fixed', value:E.data.alarms.filter(a => a.sev === 'critical').length, unit:'', d:0, labelKey:'rpSev.critical', sources:['alarms'], basis:basisFor(E, Object.assign({ sources:['alarms'] }, at(E))) }),
    'alarms.high':     E => ({ win:'fixed', value:E.data.alarms.filter(a => a.sev === 'high').length, unit:'', d:0, labelKey:'rpSev.high', sources:['alarms'], basis:basisFor(E, Object.assign({ sources:['alarms'] }, at(E))) }),
    'alarms.medium':   E => ({ win:'fixed', value:E.data.alarms.filter(a => a.sev === 'medium').length, unit:'', d:0, labelKey:'rpSev.medium', sources:['alarms'], basis:basisFor(E, Object.assign({ sources:['alarms'] }, at(E))) }),
    'alarms.acked':    E => ({ win:'fixed', value:E.data.alarms.filter(a => a.ack).length, unit:'', d:0, labelKey:'rpF.alarmsAcked', sources:['alarms'], basis:basisFor(E, Object.assign({ sources:['alarms'] }, at(E))) }),
    'derived.ackRatePct': E => { const n = E.data.alarms.length, k = E.data.alarms.filter(a => a.ack).length;
      return { win:'fixed', value:n ? k / n * 100 : null, unit:'%', d:1, labelKey:'rpF.ackRate', sources:['alarms'], basis:basisFor(E, Object.assign({ sources:['alarms'], formulaKey:'rpFx.ackedOverOpen' }, at(E))) }; },
    'alarms.oldestH':  E => ({ win:'fixed', value:E.data.alarms.length ? Math.max(...E.data.alarms.map(a => a.ageH)) : null, unit:'h', d:0, labelKey:'rpF.oldest', sources:['alarms'], basis:basisFor(E, Object.assign({ sources:['alarms'] }, at(E))) }),
    'alarms.inWindow': (E, per) => { const h = hoursOf(per); return { win:'fixed', value:E.data.alarms.filter(a => a.ageH <= h).length, unit:'', d:0, labelKey:'rpF.alarmsRaised', sources:['alarms'], basis:basisFor(E, { sources:['alarms'], from:null, windowKey:'rpWin.lastH', windowParams:{ h, to:E.data.basis.asOf } }) }; },
    /* assets / work orders */
    'assets.inAlarm':  E => ({ win:'fixed', value:E.data.assets.filter(a => a.st === 'alarm').length, unit:'', d:0, labelKey:'rpF.assetsInAlarm', sources:['assets'], basis:basisFor(E, Object.assign({ sources:['assets'] }, at(E))) }),
    'assets.stale':    E => ({ win:'fixed', value:E.data.assets.filter(a => a.st === 'stale').length, unit:'', d:0, labelKey:'rpF.assetsStale', sources:['assets'], basis:basisFor(E, Object.assign({ sources:['assets'] }, at(E))) }),
    'wo.open':         E => ({ win:'fixed', value:E.data.assets.reduce((s, a) => s + (a.wos || 0), 0), unit:'', d:0, labelKey:'rpF.woOpen', sources:['cmms'], basis:basisFor(E, Object.assign({ sources:['cmms'] }, at(E))) }),
    'wo.raisedToday':  E => ({ win:'fixed', value:E.data.assets.reduce((s, a) => s + (a.activity || []).filter(w => w[2] === 'today').length, 0), unit:'', d:0, labelKey:'rpF.woToday', sources:['cmms'], basis:basisFor(E, { sources:['cmms'] }) }),
    /* spaces */
    'spaces.comfortPct':  E => ({ win:'fixed', value:E.data.spaces.comfortPct, unit:'%', d:1, labelKey:'rpF.comfortPct', sources:['bms'], basis:basisFor(E, Object.assign({ sources:['bms'] }, at(E))) }),
    'spaces.occupiedPct': E => ({ win:'fixed', value:E.data.spaces.occupiedPct, unit:'%', d:0, labelKey:'rpF.occupiedPct', sources:['bms'], basis:basisFor(E, Object.assign({ sources:['bms'] }, at(E))) }),
    /* incident (needs params.alarmId) */
    'incident.impactAedMo': (E, per, params) => { const a = E.data.alarms.find(x => x.id === params.alarmId); if(!a || a.impactAedMo == null) return null;
      return { win:'fixed', value:a.impactAedMo, unit:cur(E), d:0, labelKey:'rpF.impactMo', sources:['model.opt'], basis:basisFor(E, { sources:['model.opt'], from:null, to:null, windowKey:'rpWin.monthlyEst', windowParams:{} }) }; },
    'incident.ageH': (E, per, params) => { const a = E.data.alarms.find(x => x.id === params.alarmId); if(!a) return null;
      return { win:'fixed', value:a.ageH, unit:'h', d:a.ageH < 1 ? 1 : 0, labelKey:'rpF.alarmAge', sources:['alarms'], basis:basisFor(E, Object.assign({ sources:['alarms'] }, at(E))) }; },
    /* forecast (sub-module locked on this site: the section says so) */
    'fcst.monthEndMwh': E => ({ win:'fixed', value:E.data.fcst.monthEndMwh, unit:'MWh', d:0, labelKey:'rpF.monthEnd', sources:['model.fcst'], basis:basisFor(E, { sources:['model.fcst'], from:null, to:null, windowKey:'rpWin.monthEnd', windowParams:{} }) })
  };
  const hoursOf = per => per.kind === 'last' ? per.h : per.kind === 'days' ? per.n * 24 : per.kind === 'month' || per.kind === 'prevMonth' ? 24 * 31 : 24;

  /* ---- source labels: registry ids, and any meter by id (D96) ------------ */
  /* The prototype cites its sample meters by id. A site that has no such meter (every Studio project
     in real mode) reads water and gas from its FIN mapping (total_water / total_gas), so it is cited
     as that, never as another site's meter. */
  const FIN_TOTALS = { 'meter.W-01':'rpSrc.waterFin', 'meter.MW-03':'rpSrc.waterFin', 'meter.G-01':'rpSrc.gasFin', 'meter.KG-02':'rpSrc.gasFin' };
  function sourceLabel(E, id, lang){
    const t = (k, v) => E.t.call({ lang: lang || E.lang }, k, v);
    if(FIN_TOTALS[id] && !(E.data.meters || []).some(x => 'meter.' + x.id === id)) return t(FIN_TOTALS[id]);
    if(/^meter\./.test(id)){ const mid = id.slice(6); const m = (E.data.meters || []).find(x => x.id === mid);
      return t('rpSrc.meter', { id: mid }) + (m ? ' · ' + ((lang || E.lang) === 'ar' ? (m.nameAr || m.nameEn) : m.nameEn) : ''); }
    return t((SOURCES[id] || {}).labelKey || id);
  }
  /* ---- data quality: every source that was not clean in the window.
          Meter states come from E.data.meters — the SAME array the Energy
          page's Meter status panel renders (D96): one source, no disagreement. */
  function dataQuality(E){
    const out = [], asOf = E.data.basis.asOf;
    if(E.state.offline) out.push({ sourceId:'bms', state:'offline', from:E.state.offlineSince || '', to:asOf, noteKey:'rpDQ.offline', params:{} });
    else if(E.state.degraded) out.push({ sourceId:'bms', state:'degraded', from:E.state.degradedSince || '', to:asOf, noteKey:'rpDQ.degraded', params:{ src:E.state.degradedSrc || '' } });
    (E.data.meters || []).forEach(m => {
      if(m.quality === 'ok') return;
      const since = E.lang === 'ar' ? (m.sinceAr || m.sinceEn || '') : (m.sinceEn || '');
      if(m.quality === 'intermittent') out.push({ sourceId:'meter.' + m.id, state:'intermittent', from:since || '00:00', to:asOf, noteKey:'rpDQ.intermittent', params:{ got:m.intervalsGot, total:m.intervalsTotal, up:m.uptimePct, target:m.targetPct } });
      else if(m.quality === 'offline'){ const age = (m.sinceAgeH || 0) < 48 ? E.t('ageH', { n:Math.round(m.sinceAgeH || 0) }) : E.fmtAge(m.sinceAgeH || 0);
        out.push({ sourceId:'meter.' + m.id, state:'offline', from:since, to:asOf, noteKey:'rpDQ.meterOffline', params:{ age } }); }
      else if(m.quality === 'unconfirmed') out.push({ sourceId:'meter.' + m.id, state:'unconfirmed', from:since, to:asOf, noteKey:'rpDQ.unconfirmed', params:{} });
    });
    const stale = (E.data.assets || []).filter(a => a.st === 'stale');
    if(stale.length) out.push({ sourceId:'assets', state:'stale', from:stale[0].staleH != null ? stale[0].staleH + ' h' : '', to:asOf, noteKey:'rpDQ.staleAssets', params:{ n:stale.length, ids:stale.map(a => a.id).join(', ') } });
    return out;
  }

  /* ---- governance: locked modules and sub-modules contribute nothing ----- */
  function lockedIds(E){
    const out = new Set();
    (E.nav.modules || []).forEach(m => { if(m.locked) out.add(m.id); (m.subs || []).forEach(s => { if(s.locked) out.add(s.id); }); });
    return out;
  }

  /* ---- ids: immutable per generation --------------------------------------- */
  let seq = 0;
  function newId(){ const d = new Date(); seq++;
    return 'RPT-' + d.getFullYear() + pad(d.getMonth()+1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()) + '-' + String(seq).padStart(3,'0'); }

  const has = (E, path) => { try{ return path.split('.').reduce((o, k) => o == null ? o : o[k], E.data) != null; }catch(e){ return false; } };
  const L = (E, en, ar) => E.lang === 'ar' ? (ar || en) : en;

  /* ---- the shared alarms section (appended when the ask says "with alarms") */
  const ALARMS_SECTION = { id:'alarms', titleKey:'rpS.alarms', widgets:[{ type:'table.alarms' }] };

  /* ---- build ------------------------------------------------------------- */
  function build(E, spec){
    const tpl = T()[spec.templateId];
    if(!tpl) throw new Error('EKO_R: unknown template ' + spec.templateId);
    const params = spec.params || {};
    const per = period(E, spec.period || tpl.defaultPeriod);
    const dq = dataQuality(E);
    const flagged = new Set(dq.map(d => d.sourceId));
    const locked = lockedIds(E);
    const figures = {};
    const fig = id => {
      if(figures[id]) return figures[id];
      const r = FIG[id] ? FIG[id](E, per, params) : null;
      if(!r) return null;
      const value = num(r.value);
      const f = Object.assign({ id }, r, { value, fmt: fmt(value, r.d) });
      f.flagged = (f.sources || []).some(s => flagged.has(s));
      figures[id] = f; return f;
    };
    const alarmRows = (hours, filter) => E.data.alarms.filter(a => a.ageH <= hours && (!filter || filter(a)));
    const incident = params.alarmId ? E.data.alarms.find(a => a.id === params.alarmId) : null;
    const asset = incident ? E.data.assets.find(a => a.id === incident.asset) : (params.assetId ? E.data.assets.find(a => a.id === params.assetId) : null);

    const sectionDefs = tpl.sections.slice();
    if(params.includeAlarms && !sectionDefs.some(s => s.id === 'alarms')) sectionDefs.push(ALARMS_SECTION);

    const sections = sectionDefs.map(s => {
      const lockedBy = (s.module && locked.has(s.module)) ? s.module : (s.sub && locked.has(s.sub)) ? s.sub : null;
      if(lockedBy) return { id:s.id, titleKey:s.titleKey, status:'locked', missing:{ reasonKey:'rpMiss.locked', params:{ module:E.t(s.moduleLabelKey || ('mod' + lockedBy[0].toUpperCase() + lockedBy.slice(1))) } }, widgets:[] };
      const missing = (s.requires || []).filter(p => !has(E, p));
      if(missing.length) return { id:s.id, titleKey:s.titleKey, status:'missing', missing:{ reasonKey:s.missingKey || 'rpMiss.noData', params:{ what:missing.join(', ') } }, widgets:[] };
      if(s.needsIncident && !incident) return { id:s.id, titleKey:s.titleKey, status:'missing', missing:{ reasonKey:'rpMiss.noAlarm', params:{} }, widgets:[] };
      const unavailable = [];
      const widgets = s.widgets.map(w => {
        if(w.type === 'figures'){
          const items = w.items.map(fig).filter(Boolean);
          const ok = items.filter(f => f.win === 'fixed' || per.kind === 'today');
          items.filter(f => !ok.includes(f)).forEach(f => unavailable.push(E.t(f.labelKey)));
          return Object.assign({}, w, { figures: ok });
        }
        if(w.type === 'chart.line'){ const series = E.data[w.series]; return Object.assign({}, w, { values: series || null, sources:w.sources || ['pmu'], basis: basisFor(E, { sources:w.sources || ['pmu'], averagingKey:E.data.basis.averagingKey }) }); }
        if(w.type === 'table.alarms'){ const hours = w.hours || hoursOf(per);
          const filter = w.scope === 'asset' && asset ? (a => a.asset === asset.id && (!incident || a.id !== incident.id)) : w.scope === 'unacked' ? (a => !a.ack) : w.scope === 'acked' ? (a => !!a.ack) : null;
          return Object.assign({}, w, { rows: alarmRows(hours, filter), hours }); }
        if(w.type === 'table.boards') return Object.assign({}, w, { rows: E.data.power.boards, basis: basisFor(E, Object.assign({ sources:['pmu'] }, at(E))) });
        if(w.type === 'table.waste') return Object.assign({}, w, { rows: E.data.energyLanding.kpis, tariff: tariff(E), basis: basisFor(E, Object.assign({ sources:['model.opt'], tariff:tariff(E), formulaKey:'rpFx.kwhTimesTariff' }, mtd(E))) });
        if(w.type === 'table.anom') return Object.assign({}, w, { rows: E.data.anom.items, tariff: tariff(E), basis: basisFor(E, Object.assign({ sources:['model.anom'], tariff:tariff(E), formulaKey:'rpFx.kwhTimesTariff' }, mtd(E))) });
        if(w.type === 'table.bench') return Object.assign({}, w, { rows: E.data.bench.rows, basis: basisFor(E, Object.assign({ sources:['bench'] }, mtd(E))) });
        if(w.type === 'status.leak'){ const l = E.data.water.leak; return Object.assign({}, w, { ready: num(l.nightsCollected) != null && num(l.nightsNeeded) != null && l.nightsCollected >= l.nightsNeeded, params:{ got:l.nightsCollected, need:l.nightsNeeded } }); }
        if(w.type === 'period.energy'){
          return Object.assign({}, w, { available: per.kind === 'today', figures: per.kind === 'today' ? [fig('metrics.energyTodayMwh'), fig('derived.energyCostTodayAed'), fig('derived.co2TodayT')] : [] });
        }
        /* generic tables: rows are localised at build time — the document is
           a fixed artefact in one language */
        if(w.type === 'table.alarmsBySys'){
          const sys = {}; E.data.alarms.forEach(a => { const k = a.sys; sys[k] = sys[k] || { n:0, crit:0, high:0, med:0, ack:0 }; sys[k].n++; sys[k][a.sev === 'critical' ? 'crit' : a.sev === 'high' ? 'high' : 'med']++; if(a.ack) sys[k].ack++; });
          return { type:'table', labelKey:w.labelKey, head:[E.t('rpCol.system'), E.t('rpF.alarmsOpen'), E.t('rpSev.critical'), E.t('rpSev.high'), E.t('rpSev.medium'), E.t('rpF.alarmsAcked')],
            rows:Object.keys(sys).map(k => [k, sys[k].n, sys[k].crit, sys[k].high, sys[k].med, sys[k].ack]), basis:basisFor(E, Object.assign({ sources:['alarms'] }, at(E))) };
        }
        if(w.type === 'table.wo'){
          const rows = []; E.data.assets.forEach(a => (a.activity || []).forEach(x => { if(!w.scope || (w.scope === 'asset' && asset && a.id === asset.id) || (w.scope === 'today' && x[2] === 'today') || (w.scope === 'alarmAssets' && a.st === 'alarm')) rows.push([x[0], a.id, x[1], x[2], E.t('rpWost.' +x[3])]); }));
          return { type:'table', labelKey:w.labelKey, head:[E.t('rpCol.wo'), E.t('colAssetId'), E.t('rpCol.what'), E.t('rpCol.when'), E.t('rpCol.state')], rows, emptyKey:'rpEmpty.wo', basis:basisFor(E, Object.assign({ sources:['cmms'] }, at(E))) };
        }
        if(w.type === 'table.utilAlarms'){
          const src = w.kind === 'gas' ? E.data.gas : E.data.water;
          return { type:'table', labelKey:w.labelKey, head:[E.t('rpCol.sev'), E.t('rpCol.what'), E.t('rpCol.where'), E.t('rpCol.age'), E.t('rpCol.note')],
            rows:(src.alarms || []).map(a => [E.t('rpSev.' +a.sev), L(E, a.tEn, a.tAr), L(E, a.locEn, a.locAr), a.age, L(E, a.noteEn, a.noteAr)]), basis:basisFor(E, { sources:[w.kind === 'gas' ? 'meter.G-01' : 'meter.W-01'] }) };
        }
        if(w.type === 'table.service'){
          const rows = E.data.assets.filter(a => a.st === 'alarm' || a.wos).map(a => [a.id, L(E, a.typeEn, a.typeAr), L(E, a.zone, a.zoneAr), a.svc || '–', a.wos || 0, a.wost ? E.t('rpWost.' +a.wost) : '–']);
          return { type:'table', labelKey:w.labelKey, head:[E.t('colAssetId'), E.t('rpCol.type'), E.t('rpCol.where'), E.t('rpCol.lastService'), E.t('rpCol.woOpen'), E.t('rpCol.state')], rows, basis:basisFor(E, Object.assign({ sources:['assets','cmms'] }, at(E))) };
        }
        if(w.type === 'table.stale'){
          const rows = E.data.assets.filter(a => a.st === 'stale').map(a => [a.id, L(E, a.typeEn, a.typeAr), L(E, a.zone, a.zoneAr), E.fmtAge(a.staleH)]);
          return { type:'table', labelKey:w.labelKey, head:[E.t('colAssetId'), E.t('rpCol.type'), E.t('rpCol.where'), E.t('rpCol.silentFor')], rows, emptyKey:'rpEmpty.stale', basis:basisFor(E, Object.assign({ sources:['assets'] }, at(E))) };
        }
        if(w.type === 'kv.alarm' && incident){
          const a = incident;
          return { type:'kv', labelKey:w.labelKey, rows:[[E.t('rpCol.alarm'), a.id], [E.t('colAssetId'), a.asset], [E.t('rpCol.sev'), E.t('rpSev.' +a.sev)], [E.t('rpCol.where'), E.loc(a)], [E.t('rpCol.what'), L(E, a.techEn, a.techAr)], [E.t('rpCol.plain'), E.loc(a, 'plain')], [E.t('rpCol.raised'), a.raised], [E.t('rpCol.age'), E.fmtAge(a.ageH)], [E.t('rpCol.ack'), a.ack ? E.t('ackShort', { time:a.ack.time, who:a.ack.who }) : E.t('rpVal.notAcked')], [E.t('rpCol.system'), a.sys]],
            basis:basisFor(E, Object.assign({ sources:['alarms'] }, at(E))) };
        }
        if(w.type === 'kv.asset' && asset){
          const a = asset;
          return { type:'kv', labelKey:w.labelKey, rows:[[E.t('colAssetId'), a.id], [E.t('rpCol.type'), L(E, a.typeEn, a.typeAr)], [E.t('rpCol.where'), L(E, a.level, a.levelAr) + ' · ' + L(E, a.zone, a.zoneAr)], [E.t('rpCol.make'), a.make || '–'], [E.t('rpCol.serial'), a.serial || '–'], [E.t('rpCol.lastService'), a.svc || '–'], [E.t('rpCol.cafm'), a.cafm || '–'], [E.t('rpCol.woOpen'), String(a.wos || 0)]]
              .concat((a.params || []).map(p => [p[0] + ' (' + p[1] + ')', p[2]])),
            basis:basisFor(E, Object.assign({ sources:['assets','bms'] }, at(E))) };
        }
        if(w.type === 'table.lifecycle' && incident){
          return { type:'table', labelKey:w.labelKey, head:[E.t('rpCol.step'), E.t('rpCol.when'), E.t('rpCol.state')], rows:incident.lifecycle.map(l => [E.t('rpLc.' +l[0].toLowerCase().replace(/\s+/g, '')), l[1], E.t(l[2] ? 'rpVal.done' : 'rpVal.pending')]), basis:basisFor(E, Object.assign({ sources:['alarms','cmms'] }, at(E))) };
        }
        if(w.type === 'text.notes') return { type:'text', labelKey:w.labelKey, textKey:'rpEmpty.notes' };
        return Object.assign({}, w);
      }).filter(Boolean);
      const partial = widgets.some(w => w.type === 'period.energy' && !w.available) || unavailable.length > 0;
      const missingP = unavailable.length ? { reasonKey:'rpMiss.notForWindow', params:{ what:unavailable.join(', '), window:E.t(per.labelKey, per.params) } }
        : partial ? { reasonKey:'rpMiss.noHistory', params:{ n: per.n || 0 } } : null;
      return { id:s.id, titleKey:s.titleKey, status: partial ? 'partial' : 'ok', missing: missingP, widgets };
    });
    /* only figures that actually appear in the document stay in the map —
       the narration context and the XLSX read from it */
    const shown = new Set();
    sections.forEach(s => s.widgets.forEach(w => (w.figures || []).forEach(f => shown.add(f.id))));
    Object.keys(figures).forEach(id => { if(!shown.has(id)) delete figures[id]; });
    const now = new Date();
    const b = E.data.basis;
    const provisional = [];
    if(b.tariffStatus === 'provisional') provisional.push('tariff');
    if(b.co2FactorStatus === 'provisional') provisional.push('emission');
    if(b.gasTariffStatus === 'provisional') provisional.push('gasTariff');
    const titleParams = incident ? { asset: incident.asset } : {};
    return {
      id: newId(), version: 1, lang: E.lang, spec: JSON.parse(JSON.stringify(spec)), templateId: tpl.id, titleKey: tpl.titleKey, titleParams,
      site: { key: E.data.key, nameEn: E.data.nameEn, nameAr: E.data.nameAr },
      period: per, generatedAt: now.toISOString(), generatedAtLabel: now.toLocaleString(E.lang === 'ar' ? 'ar-AE' : 'en-GB', siteTimeOpts()),
      generatedBy: (E.data.user && (E.lang === 'ar' ? E.data.user.nameAr : E.data.user.name)) || '',
      basisVersions: { tariff: [b.tariffId, b.tariffVersion].filter(x => x != null && x !== '').join(' ') || null, emission: b.co2FactorId != null && b.co2FactorId !== '' ? b.co2FactorId : null, tariffProvisional: b.tariffStatus === 'provisional', emissionProvisional: b.co2FactorStatus === 'provisional' },
      provisional, ekoVersion: window.EKO_VERSION || '', sources: tpl.sources, sections, dataQuality: dq, figures, narration: null
    };
  }

  /* basis line text for a figure/widget (the one honest sentence). A
     provisional tariff or factor is SAID to be provisional, every time. */
  /* a rate that is not configured reads "—", not "— AED/kWh" */
  const tariffText = (t, x) => t('rpB.tariff', { id:x.id, v:x.version || '', rate:fmt(x.rate, 2), unit:num(x.rate) == null ? '' : x.unit }).trim() + (x.provisional ? ' ' + t('rpB.prov') : '');
  const emissionText = (t, x) => t('rpB.emission', { id:x.id, f:fmt(x.factor, 2), unit:num(x.factor) == null ? '' : x.unit }).trim() + (x.provisional ? ' ' + t('rpB.prov') : '');
  function basisText(E, b, flagged, lang){
    const t = tr(E, lang), parts = [];
    if(b.windowKey) parts.push(t(b.windowKey, b.windowParams || {}));
    if(b.sources && b.sources.length) parts.push([...new Set(b.sources.map(s => sourceLabel(E, s, lang)))].join(' + '));
    if(b.averagingKey) parts.push(t(b.averagingKey));
    if(b.tariff) parts.push(tariffText(t, b.tariff));
    if(b.emission) parts.push(emissionText(t, b.emission));
    if(b.formulaKey) parts.push(t(b.formulaKey));
    if(flagged) parts.push(t('rpB.flagged'));
    return parts.join(' · ');
  }

  /* ---- immutability: deep freeze + store --------------------------------- */
  function deepFreeze(o){ if(o && typeof o === 'object' && !Object.isFrozen(o)){ Object.freeze(o); Object.keys(o).forEach(k => deepFreeze(o[k])); } return o; }
  let docs = null;
  function loadStore(){ if(docs) return docs; try{ docs = JSON.parse(localStorage.getItem(LS_STORE) || '[]'); }catch(e){ docs = []; } docs.forEach(deepFreeze); return docs; }
  function saveStore(){ try{ localStorage.setItem(LS_STORE, JSON.stringify(docs)); }catch(e){} }
  /* Removal is SOFT (D92): a document is immutable and its id stays unique
     and citable; "remove" hides it from the library, is audited, and can be
     restored. Hard deletion is a server-side retention decision. */
  let removed = null;
  function loadRemoved(){ if(removed) return removed; try{ removed = new Set(JSON.parse(localStorage.getItem(LS_REMOVED) || '[]')); }catch(e){ removed = new Set(); } return removed; }
  function saveRemoved(){ try{ localStorage.setItem(LS_REMOVED, JSON.stringify([...removed])); }catch(e){} }
  const store = {
    put(doc){ loadStore(); deepFreeze(doc); docs.unshift(doc); if(docs.length > STORE_CAP) docs.length = STORE_CAP; saveStore(); return doc; },
    get(id){ return loadStore().find(d => d.id === id) || null; },
    list(opts){ const r = loadRemoved(); return loadStore().filter(d => (opts && opts.removed) ? true : !r.has(d.id)); },
    isRemoved(id){ return loadRemoved().has(id); },
    remove(E, id){ loadRemoved().add(id); saveRemoved(); audit(E, 'report.remove', id, {}); },
    restore(E, id){ loadRemoved().delete(id); saveRemoved(); audit(E, 'report.restore', id, {}); },
    clear(){ docs = []; saveStore(); }
  };
  /* ---- audit ------------------------------------------------------------- */
  let auditLog = null;
  function loadAudit(){ if(auditLog) return auditLog; try{ auditLog = JSON.parse(localStorage.getItem(LS_AUDIT) || '[]'); }catch(e){ auditLog = []; } return auditLog; }
  function audit(E, action, reportId, params){
    loadAudit();
    const e = { t:new Date().toISOString(), user:(E.data.user && E.data.user.name) || '', action, reportId:reportId || null, params:params || {} };
    auditLog.unshift(e); if(auditLog.length > AUDIT_CAP) auditLog.length = AUDIT_CAP;
    try{ localStorage.setItem(LS_AUDIT, JSON.stringify(auditLog)); }catch(err){}
    return e;
  }
  const auditFor = id => loadAudit().filter(e => e.reportId === id);

  /* ---- title of a document ------------------------------------------------ */
  const title = (E, doc, lang) => E.t.call({ lang: lang || doc.lang }, doc.titleKey, doc.titleParams || {});

  /* ---- generate: build → narrate → freeze → store → audit → notify -------- */
  async function generate(E, spec){
    const doc = build(E, spec);
    if(window.EKO_RN) await window.EKO_RN.narrate(E, doc);
    store.put(doc);
    audit(E, 'report.generate', doc.id, { templateId:doc.templateId, period:doc.period.kind, params:spec.params || {}, narration:doc.narration ? doc.narration.status : 'off', lang:doc.lang });
    if(window.EKO_NOTIF){
      window.EKO_NOTIF.add({ type:'report.ready', params:{ report: title(E, doc) + ' · ' + doc.id, id: doc.id }, source:{ kind:'report', id:doc.id }, actorId:(E.data.user && E.data.user.name) || 'system' });
    }
    return doc;
  }

  return { siteTimeOpts, build, generate, period, periodOf, periodId, PERIODS, dataQuality, basisText, sourceLabel, fmt, num, mul, div, tr, MISSING, tariffText, emissionText, SOURCES, FIG, templates: T, store, audit, auditFor, title, lockedIds, hoursOf };
})();
