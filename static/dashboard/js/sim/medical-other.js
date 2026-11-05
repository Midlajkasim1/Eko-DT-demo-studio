/* ============================================================================
   OTHER SYSTEMS, DATA STATES AND ROOM OCCUPANCY, Demo Medical Centre (E5). Part of the building data engine.
     otherSystems(e)  the lifts (the model's three shafts; one out of service by a configured fault, which the
                      evacuation plan also reads), the medical gases (oxygen follows the line pressure fault),
                      the dialysis water plant (supplying while a session runs), the EV chargers
     dataStates(e)    every integration's points by state: online, stale (more than three intervals since the
                      last value), offline (the device does not answer: cameras, readers), flat, out of range,
                      never reported; its health now and over the last 24 hours, its last value
     rooms(e, d)      each sensed room's people now against its capacity (floor area per person), and its CO2
   Values are in js/sim/medical-config.js (other, points) with notes.
   ============================================================================ */
(function(root){
  'use strict';
  const V = x => (x && typeof x === 'object' && !Array.isArray(x) && 'v' in x && 'note' in x) ? x.v : x;
  const HOUR = 36e5;
  const liftName = n => { const m = /^(Public|Service) lift (\d+)$/.exec(n || ''); return m ? [n, (m[1] === 'Public' ? 'المصعد العام ' : 'مصعد الخدمة ') + m[2]] : [n, n]; };

  function otherSystems(e){
    const site = e.site, cfg = e.cfg, OT = cfg.other, F = cfg.faults, now = e.now, G = (site.security || {}).evacGraph || { nodes: [] };
    const out = F.liftOut || {}, outFrom = now - (out.sinceAgoH || 0) * HOUR;
    const lifts = (G.nodes || []).filter(n => n.type === 'Elevator').map(n => { const isOut = n.id === out.lift, nm = liftName(n.name); let trips = 0;
      for(let k = 24; k >= 1; k--){ const ms = now - k * HOUR; if(isOut && ms >= outFrom) continue; trips += Math.round(V(OT.liftTripsPerH) * (e.isOpen(ms) ? 1 : 0.2) * (0.8 + 0.4 * e.U('lt' + n.id + Math.floor(ms / HOUR)))); }
      const downH = isOut ? Math.min(30 * 24, (now - outFrom) / HOUR) : 0;
      return { id: n.id, en: nm[0], ar: nm[1], state: isOut ? 'out of service' : 'in service', trips24h: trips, availPct: +((30 * 24 - downH) / (30 * 24) * 100).toFixed(1), causeEn: isOut ? out.cause : null }; });
    const gasFault = V(OT.gases), o2 = F.o2Dip;
    const gas = id => gasFault[id] === 'o2Dip' && o2.dipBar < o2.limitBar ? 'low' : 'normal';
    const st = e.stationsRunning(now);
    return { lifts, gases: { O2: gas('O2'), MA: gas('MA'), VAC: gas('VAC') },
      water: [['alarm', 0], ['warning', 0], ['supply', st > 0 ? 1 : 0], ['standby', st > 0 ? 0 : 1], ['leak', 0]], ev: V(OT.evStates).slice(), liftsOut: lifts.filter(l => l.state !== 'in service').map(l => l.id) };
  }

  function dataStates(e, K){
    const cfg = e.cfg, P = cfg.points, F = cfg.faults, now = e.now, per = V(P.perIntegration), iv = V(P.intervalMin), sec = e.site.security || {};
    K = K || (root.EKO_SIMS || require('./medical-security.js')).kpis(e);
    const S = e.security(now), camOff = K.cameras.filter(c => !c.online).length, rdOff = S.doors.filter(d => d.online === false).length;
    const staleSensors = V(F.staleSensors).length, panelBad = 1 + ((S.fire || {}).isolations || []).length;   /* the detector in fault and the isolated devices */
    const R = (root.EKO_SIMS || require('./medical-security.js')).records(e), hrs = R.hours.slice(-24);
    const camLog = hrs.map((ms, i) => { const k = R.cameras.length; return +(R.cameras.filter(c => c.h[c.h.length - 24 + i] && c.h[c.h.length - 24 + i].online).length / Math.max(1, k)).toFixed(2); });
    const ints = Object.keys(per).map(name => { const n = per[name]; let stale = 0, offline = 0, never = 0, flat = 0, oor = 0, lastMin = +(iv[name] * (0.1 + 0.5 * e.U('lm' + name))).toFixed(1), log;
      if(/BMS/.test(name)){ stale = V(P.bmsStale) + staleSensors; never = V(P.bmsNever); flat = V(P.bmsFlat); oor = V(P.bmsOor);
        log = hrs.map(ms => new Date(ms).getHours() === V(P.bmsDipHour) && ms < e.today0 + 12 * HOUR ? 0.62 : +((n - stale - never) / n).toFixed(2)); }
      else if(/Video/.test(name)){ offline = camOff; log = camLog; }
      else if(/Access/.test(name)){ offline = rdOff; log = hrs.map(() => +((n - rdOff) / n).toFixed(2)); }
      else if(/Fire alarm/.test(name)){ stale = panelBad; lastMin = V(P.panelLagMin); const from = now - F.detector.agoMin * 6e4; log = hrs.map(ms => ms + HOUR > from ? +((n - panelBad) / n * 0.62).toFixed(2) : +((n - 1) / n).toFixed(2)); }
      else log = hrs.map(() => 1);
      const online = n - stale - offline - never, health = n ? online / n * 100 : 100, state = n && (offline || stale) / n > 0.05 || /Fire alarm/.test(name) ? 'degraded' : 'live';
      return { name, points: n, online, stale, offline, never, flat, oor, state: /Fire alarm/.test(name) ? 'degraded' : state, lastMin, healthPct: Math.round(health), log }; });
    const sum = k => ints.reduce((a, i) => a + i[k], 0);
    return { points: sum('points'), online: sum('online'), stale: sum('stale'), offline: sum('offline'), flat: sum('flat'), oor: sum('oor'), never: sum('never'), integrations: ints };
  }

  /* the rooms with a sensor: people now from the engine's rooms, capacity from the floor area */
  function rooms(e, d){
    const m2 = V(e.cfg.other.m2PerPerson);
    return (((d.heat || {}).zones) || []).filter(z => !z.kind).map(z => { const area = z.rect ? z.rect[2] * z.rect[3] * 4 : 15;
      return { name: z.nameEn, nameAr: z.nameAr, gid: z.gid, cap: Math.max(2, Math.round(area / m2)), occ: z.occ || 0, co2: z.co2Ppm }; });
  }

  const api = { otherSystems, dataStates, rooms };
  if(typeof module !== 'undefined') module.exports = api;
  root.EKO_SIMO = api;
})(typeof window !== 'undefined' ? window : globalThis);
