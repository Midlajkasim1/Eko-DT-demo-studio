/* ============================================================================
   SECURITY RECORDS, Demo Medical Centre (E4). Part of the building data engine.
     records(e)   hourly records for the last days (js/sim/medical-config.js, records.days):
                    cameras    per camera per hour: online, recording (the configured outages run up to now,
                               a seeded short dropout now and then in the history)
                    passes     per door per hour: granted and denied card transactions (people on site,
                               passes per person, the door's weight, the denied share)
                    flagged    forced, held open and tailgating events with their time and door
                    intrusion  per area per hour: armed or not (the opening hours), motion detections
     kpis(e, R)   every tile, KPI and list the Security pages show, recomputed from those records only
   The pages read the kpis through the site data (js/sim/medical-apply.js); tools/sim-tests.js recomputes
   each tile from the records and compares.
   ============================================================================ */
(function(root){
  'use strict';
  const V = x => (x && typeof x === 'object' && !Array.isArray(x) && 'v' in x && 'note' in x) ? x.v : x;
  const HOUR = 36e5, MIN = 6e4;
  const cache = new WeakMap();

  function records(e){
    if(cache.has(e)) return cache.get(e);
    const site = e.site, cfg = e.cfg, sec = site.security || {}, RC = cfg.records, F = cfg.faults, AC = cfg.access, now = e.now, t0 = e.dayStart(-(V(RC.days) - 1));
    const hours = []; for(let ms = t0; ms < now; ms += HOUR) hours.push(ms);
    /* cameras */
    const off = new Map(V(F.camerasOffline)), norec = new Set(V(F.camerasNotRecording));
    const cameras = (sec.cameras || []).map(c => { const offFrom = off.has(c.id) ? now - off.get(c.id) * MIN : null;
      return { id: c.id, h: hours.map(ms => { const hk = Math.floor(ms / HOUR), out = offFrom != null && ms + HOUR > offFrom, drop = !out && ms + 2 * HOUR <= now && e.U('cd' + c.id + hk) < V(RC.camDropPerH);   /* a dropout is history, never the last hour */
        const online = !(out || drop); return { ms, online, recording: online && !norec.has(c.id), offFrom: out && offFrom >= ms ? offFrom : null }; }) }; });
    /* card passes: the hour's passes over the doors by weight; whole transactions by seeded rounding */
    const doors = sec.doors || [], wsum = doors.reduce((a, d) => a + e.doorWeight(d.id), 0), round = (x, k) => Math.floor(x) + (e.U(k) < x - Math.floor(x) ? 1 : 0);
    const passes = hours.map(ms => { const f = Math.min(1, (now - ms) / HOUR), mid = ms + HOUR / 2, n = e.people(mid) * V(AC.passesPerPersonDay) / 14 * f * (e.isOpen(mid) ? 1 : 0.15), hk = Math.floor(ms / HOUR);
      const byDoor = {}; doors.forEach(d => { const x = n * e.doorWeight(d.id) / wsum, all = round(x, 'pa' + d.id + hk); if(!all) return; const den = round(all * V(AC.deniedShare), 'pd' + d.id + hk); byDoor[d.id] = [all - den, den]; });
      return { ms, byDoor }; });
    /* flagged events: today the configured ones; the days before by their daily rate */
    const fl = V(AC.flaggedPerDay), flagged = [];
    for(let k = -(V(RC.days) - 1); k < 0; k++){ const d0 = e.dayStart(k);
      ['forced', 'held', 'tailgate'].forEach(kd => { const lam = fl[kd], u = e.U('wk' + kd + k); let c = 0, p = Math.exp(-lam), s = p; while(u > s && c < 20){ c++; p *= lam / c; s += p; }
        for(let i = 0; i < c; i++){ const at = d0 + Math.floor(e.U('fa' + kd + k + i) * 24 * 60) * MIN, door = doors[Math.floor(e.U('fd' + kd + k + i) * doors.length)];
          flagged.push({ id: 'acf-' + kd + (-k) + '-' + i, door: door ? door.id : null, kind: kd, at, heldMin: kd === 'held' ? +(V(AC.heldMin) * (0.5 + e.U('hm' + k + i))).toFixed(1) : null, srcState: 'closed' }); } }); }
    flagged.push({ id: 'mac-01', door: F.doorHeld.door, kind: 'held', at: now - F.doorHeld.agoMin * MIN, heldMin: F.doorHeld.heldMin, alarm: 'al-med-door', srcState: 'unacked' },
      { id: 'mac-04', door: F.doorForced.door, kind: 'forced', at: now - F.doorForced.agoMin * MIN, heldMin: null, srcState: 'unacked' },
      { id: 'mac-05', door: F.tailgate.door, kind: 'tailgate', at: now - F.tailgate.agoMin * MIN, heldMin: null, srcState: 'acked' });
    /* intrusion: armed outside opening hours (plant and IT always), motion by the hour */
    const MP = V(RC.motionPerH), always = a => /plant|it/.test(a.id.replace(/^a-/, ''));
    const intrusion = ((sec.intrusion || {}).areas || []).map(a => ({ id: a.id, zone: a.zone, h: hours.map(ms => { const o = e.isOpen(ms + HOUR / 2), hk = Math.floor(ms / HOUR);
      const motion = Math.round((o ? MP.open : MP.closed) * e.U('mo' + a.id + hk) * (a.clinic ? MP.clinicFactor : 1));
      return { ms, armed: always(a) || (V(RC.armedClosed) && !o), motion }; }) }));
    const R = { t0, now, hours, cameras, passes, flagged, intrusion };
    cache.set(e, R); return R;
  }

  function kpis(e, R){
    R = R || records(e);
    const now = R.now, day0 = e.today0, last = l => l[l.length - 1];
    /* cameras now: the last hour's record; offline since: the start of the run of offline hours */
    const cameras = R.cameras.map(c => { const l = last(c.h); let since = null;
      if(!l.online){ let i = c.h.length - 1; while(i > 0 && !c.h[i - 1].online) i--; since = Math.round((now - (c.h[i].offFrom || c.h[i].ms)) / MIN); }
      const on = c.h.filter(x => x.online).length; return { id: c.id, online: l.online, recording: l.recording, offlineSinceMin: since, onlinePct7d: +(on / c.h.length * 100).toFixed(1) }; });
    /* access today: the hours since midnight */
    let g = 0, dn = 0; const byDoor = {};
    R.passes.filter(p => p.ms >= day0).forEach(p => Object.keys(p.byDoor).forEach(id => { const [a, b] = p.byDoor[id]; g += a; dn += b; byDoor[id] = (byDoor[id] || 0) + a + b; }));
    const busiest = Object.entries(byDoor).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 5).map(([door, n]) => ({ door, n }));
    const week = { forced: [], held: [], tailgate: [], heldMin: [] };
    for(let k = -6; k <= 0; k++){ const d0 = e.dayStart(k), d1 = e.dayStart(k + 1), inDay = R.flagged.filter(f => f.at >= d0 && f.at < d1);
      ['forced', 'held', 'tailgate'].forEach(kd => week[kd].push(inDay.filter(f => f.kind === kd).length));
      const hm = inDay.filter(f => f.kind === 'held' && f.heldMin != null).map(f => f.heldMin); week.heldMin.push(hm.length ? +(hm.reduce((a, b) => a + b, 0) / hm.length).toFixed(1) : 0); }
    const events = R.flagged.filter(f => f.srcState !== 'closed').sort((a, b) => b.at - a.at).map(f => Object.assign({ agoMin: Math.round((now - f.at) / MIN) }, f));
    /* intrusion: the state now, the motion over the last 24 hours */
    const areas = R.intrusion.map(a => { const l24 = a.h.slice(-24); return { id: a.id, state: last(a.h).armed ? 'armed' : 'disarmed', motion24h: l24.reduce((s, x) => s + x.motion, 0), motionHourly: l24.map(x => x.motion) }; });
    return { cameras, access: { grantedToday: g, deniedToday: dn, busiest, events, week }, intrusion: { areas } };
  }

  const api = { records, kpis };
  if(typeof module !== 'undefined') module.exports = api;
  root.EKO_SIMS = api;
})(typeof window !== 'undefined' ? window : globalThis);
