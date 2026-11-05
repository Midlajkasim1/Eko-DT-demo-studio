/* ============================================================================
   ESG ON THE MEDICAL CENTRE (E10, Part C). Part of the building data engine.
     esg(e, d)   the ESG pages' inputs (data.esg) from the engine, in the shape the hotel's fixture has:
                 history     each month's electricity (kWh), its cooling and out of hours shares, and the
                             share of sampled occupied hours the sensed rooms were in the comfort band
                 ieq         each sensed room's in-band shares over 7 and 30 days, by room type
                 packs       a stand-in baseline pack, rebuilt on the engine: the baseline year's intensities
                             from the engine, targets and pathway by configured assumptions, no fuel or
                             refrigerant factor (neither is configured on this site)
                 notConfigured   water, cooling tower water, waste, refrigerant, fuel and bills: Not configured
     basis(cfg)  the grid factor record the carbon figures read, from the configuration with its source
   Production: the monthly meter totals, the room sensors, the partner's pack and factor list (handoff/esg.md).
   Values are in js/sim/medical-config.js (esg) with notes.
   ============================================================================ */
(function(root){
  'use strict';
  const V = x => (x && typeof x === 'object' && !Array.isArray(x) && 'v' in x && 'note' in x) ? x.v : x;
  const HOUR = 36e5, DAY = 864e5;
  /* the room types the ESG pages assess (clinical, waiting, office) and the ones they do not (stores, plant) */
  const TYPE = { clin: 'clinical', wait: 'waiting', office: 'office', circ: 'boh', store: 'boh', plant: 'boh', gen: 'boh', ups: 'boh' };
  const inBand = (r, B) => ({ co2: r.co2Ppm == null ? null : r.co2Ppm <= B.co2Ppm, temp: r.tempC >= B.tempC[0] && r.tempC <= B.tempC[1], rh: r.rhPct >= B.rhPct[0] && r.rhPct <= B.rhPct[1] });

  function esg(e, d){
    const cfg = e.cfg, C = cfg.esg, now = e.now, n = new Date(now), B = V(C.ieqBands), A = V(cfg.floorAreaM2);
    const zones = ((d.heat || {}).zones || []).map(z => ({ z, sp: { gid: z.gid || z.nameEn, name: z.nameEn, storey: z.floor, area: (z.rect ? z.rect[2] * z.rect[3] * 4 : 15) } }));
    /* one month: the hours summed (today up to now); the comfort shares from the sampled open hours */
    function month(o){
      const m0 = new Date(n.getFullYear(), n.getMonth() + o, 1).getTime(), m1 = new Date(n.getFullYear(), n.getMonth() + o + 1, 1).getTime(), end = Math.min(m1, now);
      let kwh = 0, cool = 0, ooh = 0;
      for(let ms = m0; ms < end; ms += HOUR){ const f = Math.min(1, (end - ms) / HOUR), x = e.hour(ms, false); kwh += x.total * f; cool += x.sys.cool * f; if(!x.open) ooh += x.total * f; }
      let c = 0, cn = 0, tp = 0, tn = 0;
      for(let ds = m0; ds < end; ds += DAY) V(C.ieqHours).forEach(h => { const ms = ds + h * HOUR; if(ms > now || !e.isOpen(ms)) return;
        zones.forEach(({ z, sp }) => { const r = e.room(sp, ms); if(TYPE[r.type] === 'boh') return; const b = inBand(r, B); if(b.co2 != null){ cn++; if(b.co2) c++; } tn++; if(b.temp) tp++; }); });
      return { o, kwh: +kwh.toFixed(2), coolingKwh: +cool.toFixed(2), oohKwh: +ooh.toFixed(2), co2InBandPct: cn ? +(c / cn * 100).toFixed(1) : null, tempInBandPct: tn ? +(tp / tn * 100).toFixed(1) : null };
    }
    const months = []; for(let o = -V(C.months); o <= 0; o++) months.push(month(o));
    /* the rooms over 7 and 30 days: every open hour, each parameter's share in band */
    const ieqZones = zones.map(({ z, sp }) => { const type = TYPE[e.room(sp, now).type] || 'office', periods = {};
      [['7d', 7], ['30d', 30]].forEach(([k, days]) => { const s = { co2: [0, 0], temp: [0, 0], rh: [0, 0] };
        for(let ms = e.today0 - days * DAY; ms < now; ms += HOUR){ if(!e.isOpen(ms)) continue; const b = inBand(e.room(sp, ms), B);
          ['co2', 'temp', 'rh'].forEach(q => { if(b[q] == null) return; s[q][1]++; if(b[q]) s[q][0]++; }); }
        periods[k] = { co2: s.co2[1] ? +(s.co2[0] / s.co2[1] * 100).toFixed(1) : null, temp: s.temp[1] ? +(s.temp[0] / s.temp[1] * 100).toFixed(1) : null, rh: s.rh[1] ? +(s.rh[0] / s.rh[1] * 100).toFixed(1) : null, pm25: null }; });
      return { zone: z.nameEn, spaceType: type, periods }; });
    /* the stand-in pack: the baseline year from the engine, by the same arithmetic the ESG pages use */
    const by = n.getFullYear() + V(C.baselineYearOffset), g = V(C.gridFactor).kgPerKwh;
    const yr = months.filter(m => new Date(n.getFullYear(), n.getMonth() + m.o, 1).getFullYear() === by);
    const S = f => yr.reduce((s, m) => s + m[f], 0), avg = f => yr.reduce((s, m) => s + m[f], 0) / yr.length;
    const base = yr.length === 12 ? { energyIntensity: S('kwh') / A, coolingShare: S('coolingKwh') / S('kwh') * 100, oohShare: S('oohKwh') / S('kwh') * 100, carbonIntensity: S('kwh') * g / A, co2InBand: avg('co2InBandPct'), tempInBand: avg('tempInBandPct') } : {};
    const kpis = {}; Object.keys(base).forEach(k => { kpis[k] = { v: +base[k].toFixed(1), noteEn: 'stand-in: the engine\'s ' + by + ' figure', noteAr: 'قيمة بديلة: رقم المحرك لعام ' + by }; });
    const pct = V(C.targetPctYr) / 100, targets = {};
    ['energyIntensity', 'carbonIntensity'].forEach(k => { if(base[k] != null) targets[k] = [1, 2, 3].map(i => +(base[k] * Math.pow(1 - pct, n.getFullYear() - by + i - 1)).toFixed(1)); });
    const pack = { id: 'BP-MED-01', version: 1, assessorRole: 'sustainability consultant', assessedAgoD: 30, validFrom: 'yearStart', validYears: 3,
      standards: ['ISO 50001 and ISO 50006 (energy baseline)', 'GHG Protocol Corporate Standard (Scope 2, location based)'], baselineYearOffset: V(C.baselineYearOffset),
      kpis, targets, pathway: { netZeroYear: V(C.netZeroYear), source: 'standIn' },
      ieqBands: Object.assign({ types: ['clinical', 'waiting', 'office'], standardEn: 'the site\'s comfort band, a stand-in until the partner sets the standard', standardAr: 'نطاق الراحة في الموقع، قيمة بديلة حتى يحدد الشريك المعيار',
        occupancy: { clinical: { en: 'the clinic\'s opening hours', ar: 'ساعات عمل العيادة' }, waiting: { en: 'the clinic\'s opening hours', ar: 'ساعات عمل العيادة' }, office: { en: 'the clinic\'s opening hours', ar: 'ساعات عمل العيادة' } } }, B),
      factors: [], calendar: [], evidence: {}, credits: [] };
    const boards = V(cfg.elec.boards).map(b => b.board).join(', ');
    return { standIn: true, engine: true, notConfigured: V(C.notConfigured).slice(),
      history: { unit: 'kWh', months },
      boundary: { id: 'BND-MED-01', dateAgoD: 30, nameEn: 'Whole medical centre', nameAr: 'المركز الطبي كاملًا', floorAreaM2: A, standIn: true,
        includesEn: 'the building in the model, metered by its distribution boards (' + boards + '); the floor area is the engine\'s configured conditioned area',
        includesAr: 'المبنى في النموذج، وتقيسه لوحات التوزيع (' + boards + ')؛ والمساحة هي المساحة المكيفة المضبوطة في المحرك' },
      coverage: { meteredM2: A, basisEn: 'the whole building, metered by its distribution boards (' + boards + ')', basisAr: 'المبنى كاملًا، تقيسه لوحات التوزيع (' + boards + ')' },
      points: [{ id: 'DB', nameEn: 'Distribution boards ' + boards, nameAr: 'لوحات التوزيع ' + boards, serves: ['kwh', 'coolingKwh', 'oohKwh'] },
        { id: 'IEQ', nameEn: 'Room CO2, temperature and humidity sensors', nameAr: 'حساسات الغرف لثاني أكسيد الكربون والحرارة والرطوبة', serves: ['co2InBandPct', 'tempInBandPct'] }],
      systems: { fromBench: true, map: {} }, refrigerant: { entries: [] }, bills: [], capture: { routes: { upload: false, mailbox: false, feed: false } },
      ieq: { zones: ieqZones, spaceTypes: ['clinical', 'waiting', 'office', 'boh'], occupancyEn: 'the clinic\'s opening hours', occupancyAr: 'ساعات عمل العيادة', oa: [] },
      verification: {}, submitted: {}, waste: { months: [] }, measures: [], packs: [pack] };
  }
  /* the grid factor the carbon figures read: one record, in force over the whole history, with its source */
  function basis(cfg){ const G = V(cfg.esg.gridFactor), note = cfg.esg.gridFactor.note;
    return { co2KgPerKwh: G.kgPerKwh, co2FactorId: G.id, co2FactorDate: G.date, co2FactorInForceFrom: G.inForceFrom, co2FactorUnit: 'kgCO2e/kWh', co2FactorVersions: [],
      co2FactorSourceEn: 'stand-in, set from the latest DEWA sustainability report until the sustainability partner confirms it (the engine configuration)',
      co2FactorSourceAr: 'قيمة بديلة، مضبوطة من أحدث تقرير استدامة لهيئة كهرباء ومياه دبي حتى يؤكدها شريك الاستدامة (إعدادات المحرك)', co2FactorNote: note }; }
  const api = { esg, basis };
  if(typeof module !== 'undefined') module.exports = api; else root.EKO_SIMESG = api;
})(typeof window !== 'undefined' ? window : this);
