/* ============================================================================
   BUILDING DATA ENGINE: Demo Medical Centre (E1, EKO_Module_Standard part 3).
   One seeded, deterministic engine produces every number the medical site
   shows. No screen code here: pure functions of (configuration, the site's
   static structure from the model, the load minute). Same seed, same numbers.

     create(cfg, site, nowMs) -> the engine:
       weather(ms)          dry bulb and humidity, hourly, from the configured climatology
       hour(ms, design)     kW by system for that hour; design = the same physics, design parameters, no faults
       day(k)               MWh by system, actual and design, for day k (0 today so far, -1 yesterday)
       room(gid, ms)        a room's temperature, humidity, CO2 and people
       readings             AHU-1 filter pressure, AHU-2 supply air, by day (the Predict and Prove inputs)
       alarms()             the alarms the faults raise, with FIN priorities and times
       workOrders()         every work order with its CMMS lifecycle; kpis() recomputed from them
       security(t)          doors, cameras, access counts, fire, power, beds and nurse calls at time t
   Every assumption is in js/sim/medical-config.js; handoff/building-data-engine.md.
   ============================================================================ */
(function(root){
  'use strict';
  const DAY = 864e5, HOUR = 36e5, MIN = 6e4;
  const V = x => (x && typeof x === 'object' && !Array.isArray(x) && 'v' in x && 'note' in x) ? x.v : x;
  /* deterministic noise: a hash of (seed, key), never a running state, so any hour can be computed on its own */
  const h32 = s => { let h = 2166136261; for(let i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  const mix = a => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const SYS = ['cool', 'ahu', 'heat', 'light', 'dial', 'med'];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  /* opts.fix: faults taken as fixed from now (E3: the forecast peak if the chiller is cleaned); the history is unchanged.
     E10, the counterfactuals behind "Why over budget" (none of them changes the base engine):
       opts.fixFrom        the time the faults in opts.fix are taken as fixed from (default now), so a month can be run without its fault
       opts.weatherShiftD  the weather of that many days away (-364: the same weekday last year)
       opts.growShiftD     the load growth of that many days away (-364: last year's level, the dialysis sessions added since) */
  function create(cfg, site, nowMs, opts){
    const seed = String(V(cfg.seed));
    const U = key => mix(h32(seed + '|' + key));
    const N = key => { const u1 = Math.max(1e-12, U(key + '~a')), u2 = U(key + '~b'); return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2); };
    const LN = (key, med, spread) => med * Math.exp(spread * N(key));
    const now = Math.floor(nowMs / MIN) * MIN;
    const midnight = ms => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
    const today0 = midnight(now);
    const dayStart = k => { const d = new Date(today0); d.setDate(d.getDate() + k); return d.getTime(); };
    const dkey = ms => { const d = new Date(ms); return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); };
    const hrOf = ms => (ms - midnight(ms)) / HOUR;
    const ago = h => now - h * HOUR;

    /* ------------------------------ weather ------------------------------ */
    const C = cfg.climate;
    const monthly = (arr, ms) => { const d = new Date(ms), m = d.getMonth(), dim = new Date(d.getFullYear(), m + 1, 0).getDate(), p = (d.getDate() - 0.5) / dim - 0.5;
      const m2 = (m + (p >= 0 ? 1 : -1) + 12) % 12, f = Math.abs(p); return arr[m] * (1 - f) + arr[m2] * f; };
    const WS = ((opts || {}).weatherShiftD || 0) * DAY;
    function dayMeanT0(ms){ return monthly(V(C.meanC), ms) + V(C.dayNoiseC) * N('wd' + dkey(ms)); }
    const dayMeanT = ms => dayMeanT0(ms + WS);
    function weather(ms1){
      const ms = ms1 + WS;
      const d0 = midnight(ms), hr = hrOf(ms), tm = dayMeanT0(d0), sw = monthly(V(C.swingC), ms) / 2;
      const t = tm + sw * Math.cos(2 * Math.PI * (hr - V(C.peakHour)) / 24) + V(C.hourNoiseC) * N('wh' + dkey(ms) + '|' + Math.floor(hr));
      const rh = clamp(monthly(V(C.rhPct), ms) + 3 * N('wr' + dkey(ms)) - 1.6 * (t - tm), 12, 96);
      return { t, rh, tMean: tm };
    }
    const cddOfDay = ms => Math.max(0, dayMeanT(midnight(ms)) - V(C.cddBaseC));

    /* ------------------------------ schedule ----------------------------- */
    const S = cfg.schedule;
    const openOf = ms => V(S.open)[new Date(ms).getDay()];
    const isOpen = ms => { const o = openOf(ms), h = hrOf(ms); return h >= o[0] && h < o[1]; };
    function stationsRunning(ms){
      const n = V(S.dialysisSessions)[new Date(ms).getDay()], h = hrOf(ms), sess = V(S.sessionHours).slice(0, n);
      return sess.some(s => h >= s[0] && h < s[1]) ? Math.round(V(S.dialysisStations) * V(S.stationsUsed)) : 0;
    }
    const sessionOf = ms => { const n = V(S.dialysisSessions)[new Date(ms).getDay()], h = hrOf(ms); return V(S.sessionHours).slice(0, n).findIndex(s => h >= s[0] && h < s[1]); };
    const imagingOn = ms => { const o = openOf(ms), im = V(S.imagingHours), h = hrOf(ms); return h >= Math.max(o[0], im[0]) && h < Math.min(o[1], im[1]); };
    /* the share of the weekday peak on site: a ramp after opening, the late morning peak, a quieter afternoon and evening */
    function occFrac(ms){
      const o = openOf(ms), h = hrOf(ms), night = V(S.staffNight) / V(S.peoplePeak);
      if(h < o[0] || h >= o[1]) return night;
      const x = (h - o[0]) / (o[1] - o[0]), shape = x < 0.25 ? 0.4 + 2.4 * x : x < 0.45 ? 1 : x < 0.8 ? 1 - 0.5 * (x - 0.45) : 0.82 - 1.4 * (x - 0.8);
      const day = new Date(ms).getDay() === 5 ? 0.62 : 1;
      return clamp(shape * day * (1 + 0.04 * N('oc' + Math.floor(ms / HOUR))), night, 1.05);
    }
    /* E11: the people on site at a time is ONE figure: the sum of the room counts at that hour (headcount below). */
    const people = ms => headcount(ms).total;

    /* ------------------------------- faults ------------------------------ */
    const F = cfg.faults;
    const fixed = new Set(((opts || {}).fix) || []), fixFrom = (opts || {}).fixFrom != null ? opts.fixFrom : now;
    const copFactor = ms => { const f = F.chillerCop, on = ago(f.onsetAgoD * 24); if(fixed.has('chillerCop') && ms >= fixFrom) return 1; return ms < on ? 1 : 1 - f.drop * clamp((ms - on) / (f.rampD * DAY), 0, 1); };
    /* AHU-1 filter differential pressure, daily mean: the clean value after each change plus steady loading */
    const fp = F.ahu1Filter;
    function filterDp(k){
      const sinceChange = ((k + fp.lastChangeAgoD) % 90 + 90) % 90;   /* changed every 90 days before the current cycle */
      return fp.cleanPa + fp.ratePaPerD * sinceChange + fp.scatterPa * N('fdp' + k);
    }
    /* AHU-2 supply air above set point, daily mean (°C over): rising while the actuator stuck, low after the fix */
    const sp = F.ahu2Supply;
    function supplyDev(k){
      const d = -k;
      if(d > sp.onsetAgoD || (fixed.has('ahu2Supply') && dayStart(k) >= fixFrom)) return 0.32 + sp.scatter * N('sad' + k);
      if(d > sp.fixAgoD) return sp.devBefore[0] + sp.devBefore[1] * (sp.onsetAgoD - d) + sp.scatter * 1.6 * N('sad' + k);
      return sp.devAfter + sp.scatter * N('sad' + k);
    }

    /* ----------------------------- hourly loads ----------------------------- */
    const cache = new Map(), GS = ((opts || {}).growShiftD || 0) * DAY;
    function hour(ms, design){
      const hk = Math.floor(ms / HOUR), key = hk + (design ? 'd' : 'a');
      if(cache.has(key)) return cache.get(key);
      const t0 = hk * HOUR + HOUR / 2, w = weather(t0), open = isOpen(t0), occ = occFrac(t0), ppl = V(S.peoplePeak) * occ, st = stationsRunning(t0), img = imagingOn(t0);
      const grow = 1 + V(cfg.growthPctYr) / 100 * (t0 + GS - now) / (365 * DAY);
      const lk = V(cfg.lightingKw), lightUse = open ? 0.55 + 0.45 * Math.min(1, occ) : V(cfg.lightingNight);
      const light = (lk.L1 + lk.L2 + lk.L3) * lightUse;
      const mk = V(cfg.medicalKw), med = img ? mk[1] : mk[0];
      const wp = V(cfg.waterPlantKw), dial = wp[st > 0 ? 1 : 0] + st * V(cfg.stationKw);
      const hw = V(cfg.hotWaterKw), mo = new Date(t0).getMonth(), heat = (open ? hw[1] : hw[0]) + ([11, 0, 1].includes(mo) ? hw[2] : 0);
      const dk = Math.round((midnight(t0) - today0) / DAY);
      const filt = design ? 1 : 1 + Math.max(0, filterDp(dk) - fp.cleanPa) / 900;   /* a loaded filter costs fan power on AHU-1 */
      let ahu = 0; V(cfg.ahus).forEach(a => { ahu += a.kw * (open ? V(cfg.fanDay) : V(cfg.fanSetback)) * (a.id === fp.asset ? filt : 1); });
      const dT = Math.max(0, w.t - V(cfg.indoorC));
      const vent = V(cfg.ventKwPerK) * (open ? 1 : 1 / 3) * dT * (1 + V(cfg.latentFactor) * Math.max(0, (w.rh - 50) / 50));
      const gs = V(cfg.gainShare), gains = ppl * V(cfg.peopleKw) + light * gs.light + med * gs.med + dial * gs.dial + ahu * gs.ahu;
      const q = V(cfg.envelopeKwPerK) * dT + vent + gains + V(cfg.coolBaseKw);
      let cop = clamp(V(cfg.copRated) * (1 + V(cfg.copSlope) * (35 - w.t)), 2.2, 5.5);
      if(!design) cop *= copFactor(t0);
      const extra = design ? 0 : Math.max(0, supplyDev(dk) - 0.3) * sp.kwhPerUnitDay / 24;   /* the stuck valve: reheat against overcooling */
      const o = { cool: q / cop + extra, ahu, heat, light, dial, med };
      SYS.forEach(s => { o[s] *= grow; if(!design) o[s] *= 1 + V(cfg.meterNoise) * N('mn' + s + hk); });
      const total = SYS.reduce((a, s) => a + o[s], 0);
      const r = { ms: hk * HOUR, sys: o, total, t: w.t, rh: w.rh, ppl, occ, open, stations: st, cop };
      cache.set(key, r); return r;
    }
    /* E3: an hour's load split over the distribution boards (kW): each system by its share, lighting by the level's rating, the fans by the level each unit serves */
    function boards(ms, design){
      const x = hour(ms, design), EL = cfg.elec, lk = V(cfg.lightingKw), lt = lk.L1 + lk.L2 + lk.L3, fan = {}; let ft = 0;
      V(cfg.ahus).forEach(a => { fan[a.serves] = (fan[a.serves] || 0) + a.kw; ft += a.kw; });
      return V(EL.boards).map(b => { const s = b.share; const kw = x.sys.cool * s.cool + x.sys.heat * s.heat + x.sys.dial * s.dial + x.sys.med * s.med + x.sys.light * lk[b.level] / lt + x.sys.ahu * (fan[b.level] || 0) / ft;
        return { board: b.board, level: b.level, kw }; });
    }
    /* a day, MWh: k = 0 is today up to the load minute (part = the share of the day elapsed) */
    const dayCache = new Map();
    function day(k){
      if(dayCache.has(k)) return dayCache.get(k);
      const d0 = dayStart(k), d1 = dayStart(k + 1), end = k === 0 ? now : d1, a = {}, d = {};
      SYS.forEach(s => { a[s] = 0; d[s] = 0; });
      let peak = 0;
      for(let ms = d0; ms < end; ms += HOUR){ const f = Math.min(1, (end - ms) / HOUR), x = hour(ms, false), y = hour(ms, true);
        SYS.forEach(s => { a[s] += x.sys[s] * f / 1000; d[s] += y.sys[s] * f / 1000; }); peak = Math.max(peak, x.total); }
      const sum = o => SYS.reduce((v, s) => v + o[s], 0);
      const r = { k, ms: d0, part: (end - d0) / (d1 - d0), actual: a, design: d, total: sum(a), designTotal: sum(d), cdd: cddOfDay(d0), tMean: dayMeanT(d0), peakKw: peak };
      dayCache.set(k, r); return r;
    }

    /* ------------------------------- rooms ------------------------------- */
    const ROOM = [[/GENERATOR/i, 'gen'], [/UPS/i, 'ups'], [/ELEC|M\/E|NETWORK|COMMUNICATIONS|SHAFT|PENTHOUSE|FAN|WATER/i, 'plant'], [/CORRIDOR|Corridor|STAIR|Stair|vestibule|ELEV/i, 'circ'],
      [/Waiting|seat|reception|registration|Public|Rest area/i, 'wait'], [/Treatment|station|Examination|Exam|Assessment|Consult|observation|Radiography|Ultrasound|Imaging/i, 'clin'], [/Office|workstation|Education|learners/i, 'office']];
    const typeOf = name => (ROOM.find(([re]) => re.test(name || '')) || [0, 'store'])[1];
    const servedBy = lv => (V(cfg.ahus).find(a => a.serves === lv) || {}).id || null;
    /* E11: a bed patient is counted in the room of the bed; the bed is in use by the same rule as security(t) */
    const bedRooms = new Map(); (((site.security || {}).evac || {}).beds || []).forEach(b => { if(!bedRooms.has(b.roomGid)) bedRooms.set(b.roomGid, []); bedRooms.get(b.roomGid).push(b); });
    const bedInUse = (b, ms) => { const sess = sessionOf(ms), img = imagingOn(ms), k = 'bd' + b.id + '|' + dkey(ms) + '|' + (b.floor === 'L1' ? sess : img ? 'img' : 'x');
      return b.floor === 'L1' ? sess >= 0 && U(k) < V(S.stationsUsed) : img && U(k) < V(S.level2Used); };
    const bedsIn = (gid, ms) => (bedRooms.get(gid) || []).filter(b => bedInUse(b, ms)).length;
    /* E11: a room's count at a time, on its own (the head count reads it without the room's conditions); room() uses the same */
    const DENS = { clin: 0.09, wait: 0.35, office: 0.08, circ: 0.05, store: 0.01, plant: 0.005, gen: 0, ups: 0 };
    const typeMemo = new Map(), tyOf = name => { if(!typeMemo.has(name)) typeMemo.set(name, typeOf(name)); return typeMemo.get(name); };
    function occOf(sp, ms, ty){ const hk = Math.floor(ms / HOUR), area = sp.area || 12;
      return Math.max(bedsIn(sp.gid, ms), Math.round(area * DENS[ty || tyOf(sp.name)] * (isOpen(ms) ? occFrac(ms) : 0.05) * (0.7 + 0.6 * U('ro' + sp.gid + hk)))); }
    /* a room's conditions at a time: its serving AHU (the demo mapping), its type's schedule, the faults */
    function room(sp, ms){
      const ty = typeOf(sp.name), hk = Math.floor(ms / HOUR), w = weather(ms), open = isOpen(ms), o = occFrac(ms), k = Math.round((midnight(ms) - today0) / DAY);
      const area = sp.area || 12, dens = { clin: 0.09, wait: 0.35, office: 0.08, circ: 0.05, store: 0.01, plant: 0.005, gen: 0, ups: 0 }[ty];
      const occ = occOf(sp, ms, ty);   /* E11: at least its bed patients (occOf) */
      let tempC = 22.2 + 0.8 * U('rt' + sp.gid) + 0.05 * occ + 0.04 * Math.max(0, w.t - 30) + 0.25 * N('rtn' + sp.gid + hk);
      if(ty === 'gen') tempC = 27.5 + 0.12 * (w.t - 30) + 0.4 * N('rg' + hk) + (V(cfg.power.fuelPct) ? 2.2 : 0);
      if(ty === 'ups') tempC = 24.2 + 0.4 * N('ru' + hk) + (ms >= ago(F.upsRoom.onsetAgoH) ? F.upsRoom.extraC * clamp((ms - ago(F.upsRoom.onsetAgoH)) / (2 * HOUR), 0, 1) : 0);
      if(ty === 'plant') tempC = 25.2 + 0.08 * (w.t - 30) + 0.5 * N('rp' + sp.gid + hk) + 1.2 * U('rpp' + sp.gid);
      const lv = sp.storey; if(lv === 'L1' && servedBy('L1') && !/Haemo|Treatment|station/i.test(sp.name)) {}   /* AHU-1 rooms */
      if(lv === 'L1' && /Treatment station|Haemo|Water treatment|Medication/i.test(sp.name)) tempC += 0.6 * Math.max(0, supplyDev(k) - 0.3);   /* AHU-2's rooms ran warm while its valve stuck */
      let rhPct = clamp(44 + 0.18 * (w.rh - 55) + 2 * N('rh' + sp.gid + hk), 30, 70);
      if(sp.gid === F.imagingRh.room && ms >= ago(F.imagingRh.onsetAgoH)){ rhPct = F.imagingRh.rh + 0.8 * N('rhi' + hk); tempC -= 1.4; }
      const co2Ppm = Math.round(430 + occ / Math.max(1, area) * 5200 * (1 + 0.1 * N('rc' + sp.gid + hk)));
      return { type: ty, tempC: +tempC.toFixed(1), rhPct: Math.round(rhPct), co2Ppm: ty === 'plant' || ty === 'gen' || ty === 'ups' ? null : co2Ppm, occ, servedBy: servedBy(lv) };
    }

    /* ------------------------------- readings ------------------------------ */
    const readings = {
      filterDp: k => +filterDp(k).toFixed(1),
      supplyDev: k => +supplyDev(k).toFixed(2),
      /* the Predict input: the last 30 daily means up to today */
      ahu1Series: () => { const v = []; for(let k = -29; k <= 0; k++) v.push(+filterDp(k).toFixed(1)); return v; },
      /* the Prove input: 14 days before the fix and 14 days from it, with the cooling degree days of each window */
      ahu2Windows: () => { const b = [], a = [], cb = [], ca = []; for(let k = -sp.fixAgoD - 14; k < -sp.fixAgoD; k++){ b.push(+supplyDev(k).toFixed(2)); cb.push(cddOfDay(dayStart(k))); }
        for(let k = -sp.fixAgoD; k < 0; k++){ a.push(+supplyDev(k).toFixed(2)); ca.push(cddOfDay(dayStart(k))); }
        const sum = x => x.reduce((p, q) => p + q, 0); return { before: b, after: a, cddBefore: +(sum(cb) / cb.length).toFixed(2), cddAfter: +(sum(ca) / ca.length).toFixed(2) }; }
    };

    /* -------------------------------- alarms ------------------------------- */
    /* each alarm is raised from the data: the time its rule first held, its FIN priority from the catalogue */
    const fdpWarn = fp.limitPa - 14 * fp.ratePaPerD, fdpRaiseD = (fdpWarn - fp.cleanPa) / fp.ratePaPerD - fp.lastChangeAgoD;   /* days from today */
    const RAISE = {
      'al-med-o2': () => ({ at: ago(F.o2Dip.onsetAgoH), tech: [F.o2Dip.dipBar, F.o2Dip.limitBar] }),
      'al-med-fr03': () => ({ at: ago(F.fridge.excursionsAgoH[F.fridge.excursionsAgoH.length - 1]), tech: [F.fridge.peakC] }),
      'al-med-rh': () => ({ at: ago(F.imagingRh.onsetAgoH - 0.4), tech: [F.imagingRh.rh] }),
      'al-med-ahu1': () => ({ at: dayStart(Math.ceil(fdpRaiseD)) + 7 * HOUR, tech: [readings.filterDp(0), fp.limitPa] }),
      'al-med-ch1': () => ({ at: ago(F.chillerCop.alarmAgoH), ackAfterMin: 30, ackBy: 'the shift engineer', tech: [21.4, 18.5] }),
      'al-med-blr2': () => ({ at: ago(F.boilerCycle.onsetAgoH), tech: [14] }),
      'al-med-ups1': () => ({ at: ago(F.upsRoom.onsetAgoH - 1), tech: [room({ gid: 'ups', name: 'UPS', area: 20, storey: 'L1' }, now).tempC, F.upsRoom.limitC] }),
      'al-med-smk': () => ({ at: now - F.detector.agoMin * MIN, tech: [] }),
      'al-med-door': () => ({ at: now - F.doorHeld.agoMin * MIN, tech: [F.doorHeld.heldMin] })
    };
    const fmt1 = v => (Math.round(v * 10) / 10).toFixed(1);
    const TECH = {
      'al-med-o2': (x) => [`Line ${fmt1(x[0])} bar · low alarm ${fmt1(x[1])} bar`, `الخط ${fmt1(x[0])} بار · الإنذار المنخفض ${fmt1(x[1])} بار`],
      'al-med-fr03': (x) => [`Fridge ${fmt1(x[0])} °C · band 2 to 8 °C · sensor point, not a model element`, `الثلاجة ${fmt1(x[0])} °م · النطاق 2 إلى 8 °م · نقطة استشعار، ليست عنصرًا في النموذج`],
      'al-med-rh': (x) => [`RH ${x[0]} % · band 30 to 60 % set in Settings`, `الرطوبة ${x[0]} % · النطاق 30 إلى 60 % المحدد في الإعدادات`],
      'al-med-ahu1': (x) => [`Filter ΔP ${fmt1(x[0])} Pa · limit ${x[1]} Pa`, `فرق ضغط الفلتر ${fmt1(x[0])} باسكال · الحد ${x[1]} باسكال`],
      'al-med-ch1': (x) => [`Discharge pressure ${fmt1(x[0])} bar · expected ${fmt1(x[1])} bar`, `ضغط التصريف ${fmt1(x[0])} بار · المتوقع ${fmt1(x[1])} بار`],
      'al-med-blr2': (x) => [`${x[0]} starts per hour · expected under 6`, `${x[0]} تشغيلًا في الساعة · المتوقع أقل من 6`],
      'al-med-ups1': (x) => [`Room ${fmt1(x[0])} °C · limit ${fmt1(x[1])} °C · no model element`, `الغرفة ${fmt1(x[0])} °م · الحد ${fmt1(x[1])} °م · لا عنصر في النموذج`],
      'al-med-smk': () => ['Contamination fault · loop 2', 'عطل تلوث · الحلقة 2'],
      'al-med-door': (x) => [`Held ${x[0]} min · limit 1 min`, `مفتوح ${x[0]} د · الحد 1 د`]
    };
    function alarms(){
      return (site.alarmCatalog || []).filter(c => RAISE[c.id]).map(c => { const r = RAISE[c.id](), tx = TECH[c.id](r.tech);
        return Object.assign({}, c, { raisedAt: new Date(r.at).toISOString(), techEn: tx[0], techAr: tx[1],
          ack: r.ackAfterMin ? { at: new Date(r.at + r.ackAfterMin * MIN).toISOString(), who: r.ackBy } : null,
          lifecycle: [['Raised', null, true], ['Issued', { afterMin: 1 }, true], ['Acknowledged', null, !!r.ackAfterMin], ['Work order', null, false]] }); });
    }
    /* the earlier occurrences the alarm history keeps (the fridge excursions before the open one) */
    function alarmHistory(){
      return F.fridge.excursionsAgoH.slice(0, -1).map(h => ({ asset: F.fridge.asset, type: 'fridgeHigh', agoH: h, hour: new Date(ago(h)).getHours(), loadMw: +(hour(ago(h), false).total / 1000).toFixed(2) }));
    }
    /* FIN alarm history for the response KPIs: alarms raised in the last 30 days with their acknowledgement and recovery times */
    function alarmLog(){
      const R = cfg.response, out = [];
      ['critical', 'high', 'medium'].forEach(p => { for(let i = 0; i < V(R.alarmsPer30D)[p]; i++){ const k = p + i;
        out.push({ prio: p, agoH: 720 * U('al' + k), ackMin: +LN('ak' + k, V(R.ackMedMin)[p], V(R.ackSpread)).toFixed(1), recH: +LN('rc' + k, V(R.recMedH)[p], V(R.recSpread)).toFixed(2) }); } });
      return out;
    }

    /* ----------------------------- work orders ----------------------------- */
    /* the story's work orders, linked to the faults, then the planned and corrective background, all with a CMMS lifecycle:
       opened, target (from the priority), started, closed; state from those times */
    const STORY = [
      { id: 'WO-5125', asset: F.o2Dip.asset, task: ['Oxygen manifold check', 'فحص مشعب الأكسجين'], type: 'cm', prio: 'P1', openAgoH: F.o2Dip.onsetAgoH - 1, state: 'asgn' },
      { id: 'WO-5124', asset: F.fridge.asset, task: ['Fridge temperature check, stock moved', 'فحص حرارة الثلاجة، نُقل المخزون'], type: 'cm', prio: 'P1', openAgoH: 1.1, state: 'prog' },
      { id: 'WO-5121', asset: fp.asset, task: ['Filter change', 'تغيير الفلتر'], type: 'pm', prio: 'P3', openAgoH: 3, dueInH: 96, state: 'asgn' },
      { id: 'WO-5118', asset: F.chillerCop.asset, task: ['Condenser coil clean, discharge pressure high', 'تنظيف ملف المكثف، ضغط التصريف مرتفع'], type: 'cm', prio: 'P2', openAgoH: F.chillerCop.alarmAgoH - 10, state: 'prog' },
      { id: 'WO-5110', asset: F.upsRoom.asset, task: ['UPS room cooling unit fan', 'مروحة وحدة تبريد غرفة UPS'], type: 'cm', prio: 'P2', openAgoH: 4.4, state: 'asgn' },
      { id: 'PM-0311', asset: 'GEN-1', task: ['Monthly run with transfer test', 'التشغيل الشهري مع اختبار التحويل'], type: 'pm', prio: 'P2', openAgoH: (V(cfg.power.lastRunAgoD) - 28) * 24, dueAgoH: (V(cfg.power.lastRunAgoD) - 30) * 24, state: 'pend' },
      { id: 'WO-5102', asset: F.boilerCycle.asset, task: ['Boiler short cycling, check the controls', 'تشغيل وإيقاف متكرر للمرجل، فحص التحكم'], type: 'cm', prio: 'P3', openAgoH: F.boilerCycle.onsetAgoH - 2, state: 'asgn' },
      { id: 'WO-5031', asset: 'Hot water pump 3', task: ['Pump seal weeping', 'تسرب من حشوة المضخة'], type: 'cm', prio: 'P3', openAgoH: 312, dueInH: 48, state: 'pend' },
      { id: 'WO-4955', asset: 'AHU-5', task: ['Supply air ran warm in the morning start', 'هواء الإمداد دافئ عند بدء التشغيل صباحًا'], type: 'cm', prio: 'P3', openAgoH: 1180, dueAgoH: 240, state: 'asgn' },
      { id: 'WO-4870', asset: 'Plate heat exchanger 2', task: ['Gasket inspection', 'فحص الحشوات'], type: 'pm', prio: 'P4', openAgoH: 2600, dueAgoH: 1900, state: 'asgn' },
      { id: 'WO-5077', asset: sp.asset, task: ['Cooling valve actuator replaced', 'استبدال مشغل صمام التبريد'], type: 'cm', prio: 'P2', openAgoH: (sp.fixAgoD + 4) * 24 + 2, closeAgoH: sp.fixAgoD * 24, state: 'done', fault: 'ahu2Supply' }
    ];
    let woCache = null;
    function workOrders(){
      if(woCache) return woCache;
      const R = cfg.response, tgt = V(R.targetH), out = [];
      STORY.forEach(s => { const opened = ago(s.openAgoH), due = s.dueAgoH != null ? ago(s.dueAgoH) : s.dueInH != null ? now + s.dueInH * HOUR : opened + tgt[s.prio] * HOUR;
        out.push({ id: s.id, asset: s.asset, taskEn: s.task[0], taskAr: s.task[1], type: s.type, prio: s.prio, opened, due, closed: s.closeAgoH != null ? ago(s.closeAgoH) : null, state: s.state, story: true }); });
      /* planned maintenance: every asset on its interval over the history; each task closes on time or late (the late share) */
      const iv = V(cfg.pm.intervalsD), assets = (site.assets || []).filter(a => iv[a.sys]);
      let n = 3000;
      assets.forEach(a => { const step = iv[a.sys] * DAY, ph = U('ph' + a.id) * step;
        for(let due = today0 - V(cfg.historyDays) * DAY + ph; due < today0 - 2 * DAY; due += step){ const key = a.id + '|' + Math.round(due / DAY), late = U('lt' + key) < V(cfg.pm.lateShare);
          const closed = due - (1 + 3 * U('pe' + key)) * DAY + (late ? (1 + 6 * U('pl' + key)) * DAY : 0);
          if(out.some(w => w.asset === a.id && w.type === 'pm' && !w.closed)) { /* a story PM is open for this asset */ }
          out.push({ id: 'PM-' + (++n), asset: a.id, taskEn: 'Planned maintenance', taskAr: 'صيانة مخططة', type: 'pm', prio: 'P3', opened: due - 14 * DAY, due, closed: Math.min(closed, now - HOUR), state: 'done' }); } });
      /* corrective background: closed within the window, closure times by priority */
      const cm = V(R.cmPer30D), pr = ['P1', 'P2', 'P2', 'P3', 'P3', 'P3', 'P4'];
      for(let i = 0; i < cm * 13; i++){ const p = pr[Math.floor(U('cp' + i) * pr.length)], opened = now - (V(cfg.historyDays) * DAY) * U('co' + i), dur = LN('cd' + i, V(R.closeMedH)[p], V(R.closeSpread)) * HOUR;
        if(opened + dur > now - HOUR) continue; const a = (site.assets || [])[Math.floor(U('ca' + i) * (site.assets || []).length)];
        out.push({ id: 'WO-' + (4000 + i), asset: a ? a.id : 'AHU-1', taskEn: 'Corrective repair', taskAr: 'إصلاح تصحيحي', type: 'cm', prio: p, opened, due: opened + tgt[p] * HOUR, closed: opened + dur, state: 'done' }); }
      woCache = out; return out;
    }
    /* the maintenance KPIs, recomputed from the records (the tiles show these; tools/sim-tests.js recomputes them independently) */
    function kpis(){
      const W = workOrders(), from = now - 30 * DAY, iv = V(cfg.pm.intervalsD);
      const SYSN = [['ahu', 'Air handling', 'مناولة الهواء'], ['chw', 'Heating and cooling plant', 'معدات التدفئة والتبريد', 'heat'], ['elec', 'Emergency power', 'الطاقة الاحتياطية'], ['fire', 'Fire and life safety', 'الحريق والسلامة']];
      const sysOf = id => ((site.assets || []).find(a => a.id === id) || {}).sys;
      const pmBySystem = SYSN.map(([s, en, ar, s2]) => { const due = W.filter(w => w.type === 'pm' && w.due >= from && w.due < now && [s, s2].includes(sysOf(w.asset)));
        return { sysEn: en, sysAr: ar, done: due.filter(w => w.closed && w.closed <= w.due + DAY).length, due: due.length }; });
      const closed = W.filter(w => w.closed && w.closed >= from), slaMetPct = closed.length ? +(closed.filter(w => w.closed <= w.due).length / closed.length * 100).toFixed(1) : null;
      const L = alarmLog().filter(a => a.agoH <= 720), q = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))] : null; };
      const byPrio = ['critical', 'high', 'medium'].map(p => { const l = L.filter(a => a.prio === p);
        return { prio: p, n: l.length, ackMedMin: Math.round(q(l.map(a => a.ackMin), 0.5)), ackP90Min: Math.round(q(l.map(a => a.ackMin), 0.9)), recMedH: +q(l.map(a => a.recH), 0.5).toFixed(1), recP90H: +q(l.map(a => a.recH), 0.9).toFixed(1) }; });
      return { pmBySystem, slaMetPct, response: { windowD: 30, byPrio }, open: W.filter(w => !w.closed), recent: closed };
    }

    /* -------------------------- security and fire -------------------------- */
    const AC = cfg.access;
    /* card passes per door per hour, counts only: people on site times passes per person, spread over the doors by weight */
    const doorWeight = id => (V(AC.busyDoors).indexOf(id) >= 0 ? 14 - 2 * V(AC.busyDoors).indexOf(id) : 0.5 + U('dw' + id));
    function security(t){
      t = t || now;
      const sec = site.security || {}, out = {};
      /* E4: cameras, card passes, flagged events and intrusion from the hourly security records (js/sim/medical-security.js) */
      const SECS = root.EKO_SIMS || (typeof require !== 'undefined' ? require('./medical-security.js') : null), K = SECS ? SECS.kpis(api) : null;
      out.cameras = K ? K.cameras : [];
      out.intrusion = K ? K.intrusion : { areas: [] };
      /* doors: locked out of hours, public doors unlocked in hours; the configured exceptions */
      const open = isOpen(t), doors = sec.doors || [];
      const offR = doors.filter((d, i) => U('ro' + d.id) < V(F.readersOffline) / doors.length * 1.0001).slice(0, V(F.readersOffline));
      const pick = (tag, n, excl) => doors.filter(d => !excl.has(d.id)).map(d => [d.id, U(tag + d.id)]).sort((a, b) => a[1] - b[1]).slice(0, n).map(x => x[0]);
      const ex = new Set([F.doorHeld.door, F.doorForced.door]);
      const offSet = new Set(pick('rof', V(F.readersOffline), ex)), uoff = new Set(pick('uof', V(F.unlockedOffSchedule), new Set([...ex, ...offSet]))), openNow = new Set(pick('opn', 5, new Set([...ex, ...offSet, ...uoff])));
      out.doors = doors.map(d => { let st = d.id === F.doorForced.door ? 'forced' : d.id === F.doorHeld.door ? 'held' : offSet.has(d.id) ? 'offline' : uoff.has(d.id) ? 'unlockedOff' : openNow.has(d.id) && open ? 'open' : open && U('ul' + d.id) < 0.25 ? 'unlocked' : 'locked';
        return { id: d.id, state: st, online: !offSet.has(d.id) }; });
      void offR;
      /* access counts, the busiest doors, the flagged events and the week: the records' (js/sim/medical-security.js) */
      out.access = K ? K.access : null;
      /* fire: the detector fault, isolations, device tests against the interval */
      const FI = cfg.fire, tests = ((sec.fire || {}).deviceTests || []);
      const overdue = new Set(tests.map(q => [q.id, U('ft' + q.id)]).sort((a, b) => a[1] - b[1]).slice(0, V(FI.overdueTests)).map(x => x[0]));
      out.fire = { events: [{ id: 'mfe-01', kind: 'fault', device: F.detector.device, agoMin: F.detector.agoMin, alarm: 'al-med-smk', en: 'Smoke detector fault, contamination', ar: 'عطل كاشف الدخان، تلوث' }],
        isolations: V(FI.isolations).map(i => Object.assign({}, i)),
        deviceTests: tests.map(q => ({ id: q.id, monthsAgo: overdue.has(q.id) ? 13 + Math.floor(U('fo' + q.id) * 5) : 1 + Math.floor(U('fm' + q.id) * 11) })) };
      /* security and fire history for the times to acknowledge and clear (30 days) */
      out.history = []; const ev = V(FI.eventsPer30D), sys = ['fire', 'access', 'intrusion', 'cctv', 'power'];
      ['critical', 'high', 'medium'].forEach(p => { for(let i = 0; i < ev[p]; i++){ const k = 'sh' + p + i; out.history.push({ prio: p, sys: sys[Math.floor(U(k + 's') * sys.length)], ackMin: +LN(k + 'a', { critical: 1.5, high: 3.5, medium: 9 }[p], 0.6).toFixed(1), clearMin: +LN(k + 'c', { critical: 18, high: 35, medium: 90 }[p], 0.6).toFixed(0) }); } });
      /* emergency power: the critical loads now, the generator and the UPS from them */
      const PW = cfg.power, loads = ((sec.power || {}).loads || []).map(l => Object.assign({}, l, { kw: +(l.kw * (0.92 + 0.16 * U('pl' + l.en))).toFixed(1) }));
      const upsKw = loads.filter(l => l.on === 'ups').reduce((a, l) => a + l.kw, 0);
      out.power = { loads, fuelPct: V(PW.fuelPct), upsLoadPct: Math.round(upsKw / (V(PW.upsKva) * 0.9) * 100 * 2.6), upsRuntimeMin: Math.round(V(PW.upsBatteryKwh) / Math.max(1, upsKw * 2.6) * 60) };
      /* beds: the dialysis stations from the sessions, the Level 2 places from the booked hours; assistance on occupied beds only */
      const NC = cfg.nurse, beds = ((sec.evac || {}).beds || []);
      const sess = sessionOf(t), imgOn = imagingOn(t);
      out.beds = beds.map((b, i) => { const k = 'bd' + b.id + '|' + dkey(t) + '|' + (b.floor === 'L1' ? sess : imgOn ? 'img' : 'x');
        const inUse = b.floor === 'L1' ? sess >= 0 && U(k) < V(S.stationsUsed) : imgOn && U(k) < V(S.level2Used);
        const between = b.floor === 'L1' && sess < 0 && open;
        let status = inUse ? (b.floor === 'L1' && U(k + 'i') < V(NC.isolatedShare) ? 'isolated' : 'occ') : between && U(k + 'c') < 0.35 ? 'cleaning' : U('bc' + b.id) < 0.06 ? 'closed' : 'free';
        return { id: b.id, status, assist: (status === 'occ' || status === 'isolated') && U(k + 'a') < V(NC.assistShare) }; });
      /* nurse calls: per occupied bed hour, answer times by unit; the calls open now */
      const units = {}, byHour = {}, unitOf = b => (beds.find(x => x.id === b) || {}).zone || 'open';
      const calls = [];
      for(let ms = t - 24 * HOUR; ms < t; ms += HOUR){ const st = security.bedsAt ? null : null; void st;
        beds.forEach(b => { const occ = (b.floor === 'L1' ? sessionOf(ms) >= 0 && U('bd' + b.id + '|' + dkey(ms) + '|' + sessionOf(ms)) < V(S.stationsUsed) : imagingOn(ms) && U('bd' + b.id + '|' + dkey(ms) + '|img') < V(S.level2Used));
          if(!occ) return; const u = U('nc' + b.id + Math.floor(ms / HOUR)); if(u > V(NC.callsPerOccBedH)) return;
          const z = b.zone || 'open', ans = LN('na' + b.id + Math.floor(ms / HOUR), (V(NC.answerMedMin)[z] || 2.6), V(NC.answerSpread)), at = ms + U('nt' + b.id + Math.floor(ms / HOUR)) * HOUR;
          calls.push({ bed: b.id, unit: z, at, answerMin: ans, type: U('ny' + b.id + Math.floor(ms / HOUR)) < 0.7 ? 'assist' : U('nz' + b.id + Math.floor(ms / HOUR)) < 0.6 ? 'pain' : 'bath' }); }); }
      const qq = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))] : null; };
      calls.forEach(c => { (units[c.unit] = units[c.unit] || []).push(c.answerMin); const h = new Date(c.at).getHours(); (byHour[h] = byHour[h] || []).push(c.answerMin); });
      out.nurse = { open: calls.filter(c => c.at + c.answerMin * MIN > t).map(c => ({ bed: c.bed, type: c.type, ageMin: +((t - c.at) / MIN).toFixed(1) })),
        units: Object.keys(units).map(u => ({ id: u, medianMin: +qq(units[u], 0.5).toFixed(1), p90Min: +qq(units[u], 0.9).toFixed(1), calls24h: units[u].length })),
        byHour: Object.keys(byHour).map(Number).sort((a, b) => a - b).filter(h => byHour[h].length >= 2).map(h => [h, +qq(byHour[h], 0.5).toFixed(1)]),
        byHourP90: Object.keys(byHour).map(Number).sort((a, b) => a - b).filter(h => byHour[h].length >= 2).map(h => [h, +qq(byHour[h], 0.9).toFixed(1)]), calls };
      return out;
    }

    /* E3: the forecast peak, the next n days (15-minute demand from the hourly peak by the demand ratio), and the same with faults fixed from now */
    function peakAhead(n){ let b = { kw: 0, at: now }; for(let k = 1; k <= n; k++){ const x = day(k); if(x.peakKw > b.kw) b = { kw: x.peakKw, at: x.ms }; } return { kw: b.kw, kw15: b.kw * V(cfg.demandRatio), at: b.at }; }   /* E7: the engine is hourly; the 15-minute figure is an estimate (the demand ratio) */
    const twins = new Map();
    const whatIf = o => { const key = JSON.stringify(o || {}); if(!twins.has(key)) twins.set(key, create(cfg, site, nowMs, o)); return twins.get(key); };

    /* ------------------------------ occupancy ------------------------------ */
    /* E11: THE people count. For a time: the hour it falls in, counted at the middle of the hour, over every room of the model
       (site.spaceGeo.rooms). Waiting and clinical rooms hold patients and visitors (the evacuation moves them); the other rooms
       (offices, corridors, stores, plant) are taken as staff, which the evacuation does not model. Capacity: the sum of the rooms'
       capacities, floor area times the design occupancy of the room type (space.capacityPerM2, the one definition). */
    const ROOMS = ((site.spaceGeo || {}).rooms || []).map(r => ({ gid: r.gid, name: r.en, area: r.area, storey: r.level, dept: r.dept }));
    const roomCapacity = sp => Math.max(1, Math.round(sp.area * (V(cfg.space.capacityPerM2)[typeOf(sp.name)] || 0.1)));
    const CAPACITY = ROOMS.reduce((s, sp) => s + roomCapacity(sp), 0);
    const hcCache = new Map();
    function headcount(ms){
      const hk = Math.floor(ms / HOUR); if(hcCache.has(hk)) return hcCache.get(hk);
      const at = hk * HOUR + HOUR / 2, rooms = []; let pv = 0, staff = 0, beds = 0;
      ROOMS.forEach(sp => { const ty = tyOf(sp.name), n = occOf(sp, at, ty), b = bedsIn(sp.gid, at), patient = ty === 'wait' || ty === 'clin';
        rooms.push({ gid: sp.gid, n, beds: b, type: ty, patient }); if(patient) pv += n; else staff += n; beds += b; });
      const out = { at, total: pv + staff, patientsVisitors: pv, staff, bedPatients: beds, capacity: CAPACITY, rooms };
      if(hcCache.size > 400) hcCache.clear(); hcCache.set(hk, out); return out;
    }
    function occupancy(){
      const carpet = []; for(let k = -6; k <= 0; k++){ const row = []; for(let h = 0; h < 24; h++) row.push(+occFrac(dayStart(k) + h * HOUR + HOUR / 2).toFixed(2)); carpet.push(row); }
      let peakToday = people(now); for(let ms = today0; ms + HOUR / 2 <= now; ms += HOUR) peakToday = Math.max(peakToday, people(ms + HOUR / 2));   /* E6: the peak so far includes now */
      let s30 = 0; for(let k = -30; k < 0; k++){ let p = 0; for(let h = 6; h < 22; h++) p = Math.max(p, people(dayStart(k) + h * HOUR + HOUR / 2)); s30 += p; }
      return { capacity: CAPACITY, nowCount: people(now), peakToday, avg30Peak: Math.round(s30 / 30), carpet };
    }

    const api = { site, doorWeight, V, SYS, now, today0, dayStart, weather, isOpen, occFrac, people, headcount, roomCapacity, stationsRunning, hour, boards, day, room, typeOf, readings, alarms, alarmHistory, alarmLog,
      workOrders, kpis, security, occupancy, cfg, U, N, faults: F, cddOfDay, peakAhead, whatIf, fixed: [...fixed] };
    return api;
  }

  const api = { create, V, SYS };
  if(typeof module !== 'undefined') module.exports = api;
  root.EKO_SIM = Object.assign(root.EKO_SIM || {}, api);
})(typeof window !== 'undefined' ? window : globalThis);
