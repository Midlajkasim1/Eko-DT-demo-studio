/* ============================================================================
   BUILDING DATA ENGINE, THE ASSETS (E13). Every point the engine produces for
   a connected asset of the Demo Medical Centre, with its value at any hour,
   its unit, its band and its source; the history behind the charts; and the
   asset's record: the nameplate (the model first, then the demo table in
   js/sim/medical-config.js assetDemo), the next planned task and the service
   history from the same work order records Activity reads, the documents,
   the spares and the warranty. The faults are the engine's own (cfg.faults):
   the AHU-1 filter, the AHU-2 valve, the chiller's fouled coil, the boiler's
   cycling, the UPS room, the fridge, the oxygen line, the imaging room.
   Values only; no screen code. Node and browser.
   ============================================================================ */
(function(root){
  'use strict';
  const HOUR = 36e5, DAY = 864e5;
  const V = x => (x && typeof x === 'object' && !Array.isArray(x) && 'v' in x && 'note' in x) ? x.v : x;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const r1 = (v, d) => { const k = Math.pow(10, d == null ? 1 : d); return Math.round(v * k) / k; };
  /* the asset's class: the system and, for heating, the kind of unit */
  function kindOf(a){
    if(!a) return null; const id = a.id || '';
    if(a.sys === 'ahu' && /^AHU/.test(id)) return 'ahu';
    if(/^RH-/.test(id)) return 'room';
    if(a.sys === 'chw') return 'chiller';
    if(/Condensing boiler/.test(id)) return 'boiler';
    if(/heat exchanger/i.test(id)) return 'hx';
    if(/pump/i.test(id)) return 'pump';
    return { 'GEN-1': 'gen', 'UPS-1': 'ups', 'ATS-1': 'ats', 'MSB-1': 'msb', 'FACP-1': 'facp', 'FR-03': 'fridge', 'O2-LINE-1': 'o2' }[id] || (a.sys === 'fire' ? 'detector' : a.sys === 'sec' ? 'door' : null);
  }
  const SRC = { bac: n => 'BACnet ' + n + ' (demo point)', eng: 'the building data engine' };

  function make(sim, site){
    const cfg = sim.cfg, F = V(cfg.faults) || cfg.faults, AD = cfg.assetDemo || {}, U = sim.U, N = sim.N, now = sim.now, today0 = sim.today0;
    const fault = k => { const f = F[k]; if(!f) return {}; const o = {}; Object.keys(f).forEach(x => { o[x] = V(f[x]); }); return o; };
    const ago = h => now - h * HOUR, dayIdx = ms => Math.floor((ms - today0) / DAY);
    const hk = ms => Math.floor(ms / HOUR);
    const assets = site.assets || [], byId = id => assets.find(a => a.id === id) || null;
    const ahuCfg = id => (V(cfg.ahus) || []).find(x => x.id === id) || { kw: 30 };
    const copAt = ms => { const w = sim.hour(ms, true).t; return clamp(V(cfg.copRated) * (1 + V(cfg.copSlope) * (35 - w)), 2.2, 5.5); };
    const ramp = (ms, onsetAgoD, rampD) => { const t0 = now - onsetAgoD * DAY; return ms <= t0 ? 0 : clamp((ms - t0) / ((rampD || 1) * DAY), 0, 1); };
    const installedMs = a => { const p = plate(a); return p.installed ? Date.parse(p.installed + 'T08:00:00') : now - 900 * DAY; };
    const runHours = (a, ms, duty) => Math.round((ms - installedMs(a)) / HOUR * duty);

    /* ------------------------------ the points ------------------------------ */
    /* each: k, en, ar, u, band [lo, hi] or null, d (decimals), src, f(ms) -> value (a number, or a word for a state) */
    function defs(a){
      const k = kindOf(a), id = a.id;
      if(k === 'ahu'){ const c = ahuCfg(id), f1 = fault('ahu1Filter'), f2 = fault('ahu2Supply');
        const fan = ms => { const x = sim.hour(ms); return 100 * (x.open ? V(cfg.fanDay) : V(cfg.fanSetback)) + 2.2 * N('fan' + id + hk(ms)); };
        return [
          { k: 'sat', en: 'Supply air temperature', ar: 'حرارة هواء الإمداد', u: '°C', band: [12, 15], d: 1, src: SRC.bac('AI-3'),
            f: ms => 13 + (id === f2.asset ? sim.readings.supplyDev(dayIdx(ms)) : id === f1.asset ? 1.05 : 0.25 * U('sa' + id)) + 0.18 * N('sat' + id + hk(ms)) },
          { k: 'sp', en: 'Supply air set point', ar: 'نقطة ضبط هواء الإمداد', u: '°C', band: null, d: 1, src: SRC.bac('AV-1'), f: () => 13 },
          { k: 'rat', en: 'Return air temperature', ar: 'حرارة هواء الراجع', u: '°C', band: [21, 26], d: 1, src: SRC.bac('AI-4'), f: ms => { const x = sim.hour(ms); return 22.6 + 1.4 * (x.occ || 0) + 0.04 * Math.max(0, x.t - 30) + 0.25 * N('rat' + id + hk(ms)); } },
          { k: 'fan', en: 'Supply fan speed', ar: 'سرعة مروحة الإمداد', u: '%', band: [30, 100], d: 0, src: SRC.bac('AI-7'), f: fan },
          { k: 'fdp', en: 'Filter ΔP', ar: 'فرق ضغط الفلتر', u: 'Pa', band: [0, id === f1.asset ? f1.limitPa : 250], d: 0, src: SRC.bac('AI-12'),
            f: ms => id === f1.asset ? sim.readings.filterDp(dayIdx(ms)) + 3 * N('fd' + hk(ms)) : 112 + 55 * U('fdp' + id) + 0.4 * (dayIdx(ms) + 30) * U('fr' + id) + 2.5 * N('fdp' + id + hk(ms)) },
          { k: 'vlv', en: 'Cooling valve position', ar: 'وضع صمام التبريد', u: '%', band: [0, 100], d: 0, src: SRC.bac('AO-2'), f: ms => clamp(28 + 0.13 * sim.hour(ms).sys.cool + 4 * N('vl' + id + hk(ms)), 8, 98) },
          { k: 'kw', en: 'Fan power', ar: 'قدرة المروحة', u: 'kW', band: [0, c.kw], d: 1, src: SRC.bac('AI-20'), f: ms => c.kw * Math.pow(clamp(fan(ms), 0, 100) / 100, 2.6) },
          { k: 'rh', en: 'Run hours', ar: 'ساعات التشغيل', u: 'h', band: null, d: 0, src: SRC.bac('AV-30'), counter: true, f: ms => runHours(a, ms, 0.97) }];
      }
      if(k === 'chiller'){ const f = fault('chillerCop'), mine = id === f.asset, n = Number((id.match(/(\d)$/) || [])[1] || 1);
        const running = ms => n < 3 || sim.hour(ms).open;
        const cop = ms => copAt(ms) * (mine ? 1 - f.drop * ramp(ms, f.onsetAgoD, f.rampD) : 1) * (1 + 0.015 * N('cp' + id + hk(ms)));
        const kw = ms => running(ms) ? sim.hour(ms).sys.cool / (sim.hour(ms).open ? 3 : 2) * (mine ? 1 + f.drop * ramp(ms, f.onsetAgoD, f.rampD) : 1) : 0;
        return [
          { k: 'chwl', en: 'Chilled water leaving', ar: 'المياه المبردة الخارجة', u: '°C', band: [5.5, 8], d: 1, src: SRC.bac('AI-1'), f: ms => running(ms) ? 6.7 + (mine ? 0.4 * ramp(ms, f.onsetAgoD, f.rampD) : 0) + 0.15 * N('cl' + id + hk(ms)) : 12 },
          { k: 'chwe', en: 'Chilled water entering', ar: 'المياه المبردة الداخلة', u: '°C', band: [10, 14], d: 1, src: SRC.bac('AI-2'), f: ms => 11.6 + 0.004 * sim.hour(ms).sys.cool + 0.2 * N('ce' + id + hk(ms)) },
          { k: 'dp', en: 'Discharge pressure', ar: 'ضغط التصريف', u: 'bar', band: [15, 20], d: 1, src: SRC.bac('AI-9'),
            f: ms => running(ms) ? 18.5 + 0.06 * (sim.hour(ms).t - 32) + (mine ? 2.9 * ramp(ms, f.onsetAgoD, f.rampD) : 0) + 0.15 * N('dp' + id + hk(ms)) : 0 },
          { k: 'kw', en: 'Compressor power', ar: 'قدرة الضاغط', u: 'kW', band: [0, 160], d: 0, src: SRC.bac('AI-20'), f: kw },
          { k: 'cop', en: 'Efficiency (COP)', ar: 'الكفاءة (COP)', u: '', band: [2.4, 6], d: 2, src: SRC.eng, f: cop },
          { k: 'rh', en: 'Run hours', ar: 'ساعات التشغيل', u: 'h', band: null, d: 0, src: SRC.bac('AV-30'), counter: true, f: ms => runHours(a, ms, n < 3 ? 0.9 : 0.45) }];
      }
      if(k === 'boiler'){ const f = fault('boilerCycle'), mine = id === f.asset;
        const load = ms => sim.hour(ms).sys.heat / 4;
        return [
          { k: 'flow', en: 'Flow temperature', ar: 'حرارة التدفق', u: '°C', band: [60, 82], d: 1, src: SRC.bac('AI-1'), f: ms => 72 + 0.6 * N('bf' + id + hk(ms)) },
          { k: 'ret', en: 'Return temperature', ar: 'حرارة الراجع', u: '°C', band: [40, 60], d: 1, src: SRC.bac('AI-2'), f: ms => 52 + 0.8 * N('br' + id + hk(ms)) },
          { k: 'fire', en: 'Firing rate', ar: 'معدل الإشعال', u: '%', band: [0, 100], d: 0, src: SRC.bac('AI-5'), f: ms => clamp(load(ms) / 3.5 + 6 * N('bfr' + id + hk(ms)), 0, 100) },
          { k: 'starts', en: 'Starts per hour', ar: 'مرات التشغيل في الساعة', u: '/h', band: [0, 6], d: 0, src: SRC.eng, f: ms => Math.max(0, Math.round((mine && ms >= ago(f.onsetAgoH) ? 13 : 3) + 1.2 * N('bs' + id + hk(ms)))) },
          { k: 'rh', en: 'Run hours', ar: 'ساعات التشغيل', u: 'h', band: null, d: 0, src: SRC.bac('AV-30'), counter: true, f: ms => runHours(a, ms, 0.35) }];
      }
      if(k === 'hx') return [
          { k: 'pin', en: 'Primary in', ar: 'الدخول الأولي', u: '°C', band: [60, 82], d: 1, src: SRC.bac('AI-1'), f: ms => 71.5 + 0.5 * N('hp' + id + hk(ms)) },
          { k: 'pout', en: 'Primary out', ar: 'الخروج الأولي', u: '°C', band: [40, 62], d: 1, src: SRC.bac('AI-2'), f: ms => 53 + 0.6 * N('ho' + id + hk(ms)) },
          { k: 'sout', en: 'Secondary out', ar: 'الخروج الثانوي', u: '°C', band: [55, 70], d: 1, src: SRC.bac('AI-4'), f: ms => 63 + 0.5 * N('hs' + id + hk(ms)) }];
      if(k === 'pump'){ const sp = ms => clamp(62 + 0.08 * sim.hour(ms).sys.heat + 3 * N('ps' + id + hk(ms)), 30, 100);
        return [
          { k: 'spd', en: 'Speed', ar: 'السرعة', u: '%', band: [30, 100], d: 0, src: SRC.bac('AI-1'), f: sp },
          { k: 'kw', en: 'Power', ar: 'القدرة', u: 'kW', band: [0, 5.5], d: 2, src: SRC.bac('AI-20'), f: ms => 5.5 * Math.pow(sp(ms) / 100, 2.7) },
          { k: 'dp', en: 'Differential pressure', ar: 'فرق الضغط', u: 'kPa', band: [80, 160], d: 0, src: SRC.bac('AI-3'), f: ms => 125 + 0.35 * (sp(ms) - 62) + 3 * N('pd' + id + hk(ms)) },
          { k: 'rh', en: 'Run hours', ar: 'ساعات التشغيل', u: 'h', band: null, d: 0, src: SRC.bac('AV-30'), counter: true, f: ms => runHours(a, ms, Number((id.match(/(\d)$/) || [])[1] || 1) % 2 ? 0.5 : 0.48) }];
      }
      if(k === 'gen'){ const P = cfg.power; return [
          { k: 'fuel', en: 'Fuel level', ar: 'مستوى الوقود', u: '%', band: [70, 100], d: 0, src: SRC.bac('AI-1'), f: () => V(P.fuelPct) },
          { k: 'bat', en: 'Starter battery', ar: 'بطارية التشغيل', u: 'V', band: [24, 28.8], d: 1, src: SRC.bac('AI-2'), f: ms => V(P.startBatteryV) + 0.05 * N('gb' + hk(ms)) },
          { k: 'cool', en: 'Coolant temperature (heater)', ar: 'حرارة سائل التبريد (السخان)', u: '°C', band: [35, 50], d: 1, src: SRC.bac('AI-4'), f: ms => 42 + 0.4 * N('gc' + hk(ms)) },
          { k: 'rh', en: 'Run hours', ar: 'ساعات التشغيل', u: 'h', band: null, d: 0, src: SRC.bac('AV-30'), counter: true, f: ms => Math.round((ms - installedMs(a)) / (30 * DAY)) + 112 }]; }
      if(k === 'ups'){ const P = cfg.power, fr = fault('upsRoom'); const loadKw = ms => 0.06 * sim.hour(ms).total + 18;
        return [
          { k: 'load', en: 'Load', ar: 'الحمل', u: '%', band: [0, 80], d: 0, src: SRC.bac('AI-1'), f: ms => loadKw(ms) / (V(P.upsKva) * 0.9) * 100 },
          { k: 'bat', en: 'Battery charge', ar: 'شحن البطارية', u: '%', band: [90, 100], d: 0, src: SRC.bac('AI-2'), f: () => 100 },
          { k: 'aut', en: 'Autonomy at this load', ar: 'مدة التشغيل بهذا الحمل', u: 'min', band: [10, 200], d: 0, src: SRC.eng, f: ms => V(P.upsBatteryKwh) / loadKw(ms) * 60 },
          { k: 'room', en: 'Room temperature', ar: 'حرارة الغرفة', u: '°C', band: [18, fr.limitC || 27], d: 1, src: SRC.bac('AI-6'), f: ms => sim.room({ gid: 'ups', name: 'UPS', area: 20, storey: 'L1' }, ms).tempC }]; }
      if(k === 'msb') return [
          { k: 'kw', en: 'Site load', ar: 'حمل الموقع', u: 'kW', band: [0, V(cfg.contractKw)], d: 0, src: SRC.bac('AI-1'), f: ms => sim.hour(ms).total },
          { k: 'v', en: 'Voltage, line to line', ar: 'الجهد بين الخطوط', u: 'V', band: [380, 420], d: 0, src: SRC.bac('AI-2'), f: ms => 401 + 1.5 * N('mv' + hk(ms)) },
          { k: 'pf', en: 'Power factor', ar: 'معامل القدرة', u: '', band: [0.9, 1], d: 2, src: SRC.bac('AI-3'), f: ms => 0.95 + 0.006 * N('mp' + hk(ms)) }];
      if(k === 'ats') return [
          { k: 'pos', en: 'Position', ar: 'الوضع', u: '', band: null, src: SRC.bac('BI-1'), word: true, f: () => ['Normal', 'عادي'] },
          { k: 'lt', en: 'Last transfer time', ar: 'زمن آخر تحويل', u: 's', band: [0, V(cfg.power.transferTargetS)], d: 0, src: SRC.eng, f: () => V(cfg.power.lastTransferS) }];
      if(k === 'facp'){ const fs = ((site.security || {}).fire || {}); return [
          { k: 'st', en: 'Panel state', ar: 'حالة اللوحة', u: '', band: null, src: SRC.bac('BI-1'), word: true, f: () => ['Normal, 1 fault', 'عادي، عطل واحد'] },
          { k: 'dev', en: 'Devices on the loops', ar: 'الأجهزة على الحلقات', u: '', band: null, d: 0, src: SRC.eng, f: () => fs.devices || 0 }]; }
      if(k === 'fridge'){ const f = fault('fridge');
        return [{ k: 't', en: 'Fridge temperature', ar: 'حرارة الثلاجة', u: '°C', band: f.bandC || [2, 8], d: 1, src: SRC.bac('AI-1'),
          f: ms => { let v = 4.6 + 0.35 * N('ft' + hk(ms)); (f.excursionsAgoH || []).forEach((h, i, arr) => { const t0 = ago(h), last = i === arr.length - 1, end = last ? now + HOUR : t0 + f.durH * HOUR;
            if(ms >= t0 - HOUR && ms <= end) v = Math.max(v, 4.6 + (f.peakC - 4.6) * clamp((ms - t0 + HOUR) / HOUR, 0, 1)); }); return v; } }]; }
      if(k === 'o2'){ const f = fault('o2Dip');
        return [{ k: 'p', en: 'Line pressure', ar: 'ضغط الخط', u: 'bar', band: [f.limitBar, 5], d: 2, src: SRC.bac('AI-1'), f: ms => (ms >= ago(f.onsetAgoH) ? f.dipBar : f.nominalBar) + 0.02 * N('o2' + hk(ms)) }]; }
      if(k === 'room'){ const f = fault('imagingRh'), sp = { gid: f.room, name: 'Radiography', area: 30, storey: 'L2' };
        return [{ k: 'rh', en: 'Relative humidity', ar: 'الرطوبة النسبية', u: '%', band: f.band || [30, 60], d: 0, src: SRC.bac('AI-2'), f: ms => sim.room(sp, ms).rhPct },
          { k: 't', en: 'Room temperature', ar: 'حرارة الغرفة', u: '°C', band: [20.5, 24.5], d: 1, src: SRC.bac('AI-1'), f: ms => sim.room(sp, ms).tempC }]; }
      if(k === 'detector') return [{ k: 'st', en: 'Device state', ar: 'حالة الجهاز', u: '', band: null, src: 'the fire panel (demo point)', word: true, f: () => ['Fault: contamination', 'عطل: تلوث'] }];
      if(k === 'door') return [{ k: 'st', en: 'Door state', ar: 'حالة الباب', u: '', band: null, src: 'the access control system (demo point)', word: true, f: () => ['Held open', 'مفتوح'] }];
      return [];
    }
    const has = id => defs(byId(id) || {}).length > 0;
    /* the points now, each with its last 24 hours */
    function points(id, ms){
      const a = byId(id); if(!a) return []; ms = ms || now;
      return defs(a).map(p => { const v = p.f(ms), num = typeof v === 'number';
        const spark = num && !p.counter ? Array.from({ length: 24 }, (_, i) => r1(p.f(ms - (23 - i) * HOUR), p.d)) : null;
        return { k: p.k, en: p.en, ar: p.ar, u: p.u, band: p.band, d: p.d, src: p.src, word: !!p.word, value: num ? r1(v, p.d) : v,
          tone: num && p.band ? (v < p.band[0] || v > p.band[1] ? 'out' : 'in') : null, spark }; });
    }
    /* a point's history: hourly over the last `hours` (the charts on the Analytics tab) */
    function history(id, key, hours, stepH){
      const a = byId(id); const p = a && defs(a).find(x => x.k === key); if(!p) return null; stepH = stepH || 1;
      const out = []; for(let h = hours; h >= 0; h -= stepH){ const ms = now - h * HOUR; out.push([ms, r1(p.f(ms), p.d)]); }
      return { k: p.k, en: p.en, ar: p.ar, u: p.u, band: p.band, d: p.d, src: p.src, pts: out };
    }
    /* the charts each kind of asset leads with: the point the fault shows in first */
    const CHARTS = { ahu: [['sat', 168], ['fdp', 720, 24], ['kw', 168]], chiller: [['cop', 720, 24], ['dp', 168], ['kw', 168]], boiler: [['starts', 168], ['flow', 168]],
      hx: [['pout', 168], ['sout', 168]], pump: [['kw', 168], ['dp', 168]], gen: [['bat', 168], ['cool', 168]], ups: [['room', 48], ['load', 168]], msb: [['kw', 168], ['pf', 168]],
      ats: [], facp: [], fridge: [['t', 720, 2]], o2: [['p', 24]], room: [['rh', 48], ['t', 48]], detector: [], door: [] };
    function charts(id){ const a = byId(id), k = kindOf(a); return (CHARTS[k] || []).map(([key, h, st]) => history(id, key, h, st)).filter(Boolean); }

    /* -------------------------------- the record -------------------------------- */
    function plate(a){
      const NP = V(AD.nameplate) || {}, k = kindOf(a), sys = a.sys, o = {};
      if(k === 'ahu'){ const n = NP.ahu || {}; Object.assign(o, { ratedKw: ahuCfg(a.id).kw, airflow: (n.airflow || {})[a.id], coolKw: (n.coolKw || {})[a.id], installed: n.installed, warrantyEnd: n.warrantyEnd }); }
      else if(k === 'chiller') Object.assign(o, NP.chw || {});
      else if(k === 'boiler') Object.assign(o, (NP.heat || {}).boiler || {});
      else if(k === 'hx') Object.assign(o, (NP.heat || {}).hx || {});
      else if(k === 'pump') Object.assign(o, (NP.heat || {}).pump || {});
      else if(sys === 'elec') Object.assign(o, (NP.elec || {})[a.id] || {});
      else if(NP[sys]) Object.assign(o, NP[sys]);
      o.contractor = (V(AD.contractor) || {})[sys === 'heat' ? 'heat' : sys] || null;
      return o;
    }
    /* the next planned task and the service history: the same records Activity reads (data.maintenance.wos and the asset's own rows),
       and where no planned task is open, the next due on the system's interval from the last one done (the engine's work orders) */
    function om(id){
      const a = byId(id); if(!a) return null;
      const iv = (V(cfg.pm.intervalsD) || {})[a.sys], W = sim.workOrders().filter(w => w.asset === id);
      const open = ((site.maintenance || {}).wos || []).filter(w => w.asset === id && w.type === 'pm' && w.state !== 'done' && w.dueH != null).sort((x, y) => x.dueH - y.dueH)[0] || null;
      const lastPm = W.filter(w => w.type === 'pm' && w.closed).sort((x, y) => y.closed - x.closed)[0] || null;
      const next = open ? { id: open.id, en: open.taskEn, ar: open.taskAr, at: now + open.dueH * HOUR, src: 'cmms' }
        : lastPm && iv ? { id: null, en: 'Planned maintenance', ar: 'صيانة مخططة', at: lastPm.due + iv * DAY, src: 'interval', ivD: iv } : null;
      const done = W.filter(w => w.closed).sort((x, y) => y.closed - x.closed).slice(0, 6).map(w => ({ id: w.id, en: w.taskEn, ar: w.taskAr, type: w.type, closed: w.closed, late: w.closed > w.due + DAY }));
      return { next, history: done, lastPm: lastPm ? lastPm.closed : null, ivD: iv || null };
    }
    function docs(id){ return (V(AD.docs) || []).map(([k, en]) => ({ k, en, id })); }
    function spares(id){ const a = byId(id); return a ? ((V(AD.spares) || {})[a.sys] || []).map(([en, n, u]) => ({ en, n, u })) : []; }
    return { kindOf, has, points, history, charts, plate: id => plate(byId(id) || {}), om, docs, spares, model: id => ((site.assetModel || {}).assets || {})[id] || null };
  }
  /* the one instance per engine (the page asks EKO_SIMA.of(E)) */
  const cache = new WeakMap();
  const of = E => { if(!E || !E.sim) return null; if(!cache.has(E.sim)) cache.set(E.sim, make(E.sim, E.data)); return cache.get(E.sim); };
  const api = { of, make, kindOf };
  if(typeof module !== 'undefined') module.exports = api;
  root.EKO_SIMA = api;
})(typeof window !== 'undefined' ? window : globalThis);
