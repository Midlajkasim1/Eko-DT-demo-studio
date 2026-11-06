/* ============================================================================
   EVACUATION ENGINE ON THE DEMO MEDICAL CENTRE (E2). Builds the planner's
   snapshot from the site: the building graph from the model (security.evacGraph),
   the people from the building data engine (E1: the occupied beds and their
   assistance flag; the people in waiting and treatment rooms as walking), the
   fleet and receiving facilities and every assumption from
   js/evac/medical-evac-config.js. Then plans, compares, asks what-if, and
   gives each person's track for the replay on the model. No screen code.
   ============================================================================ */
window.EKO_EVACM = (function(){
  'use strict';
  const X = () => window.EKO_EVACX, CF = () => window.EKO_EVAC_CFG;
  const V = x => (x && typeof x === 'object' && !Array.isArray(x) && 'v' in x && 'note' in x) ? x.v : x;
  const HOUR = 36e5;
  const ready = E => !!(E && E.data.security && E.data.security.evacGraph && X() && CF() && E.sim);
  const h32 = s => { let h = 2166136261; for(let i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; };
  /* the time the people are taken at: now, or the demo scenario's replay hour */
  const timeOf = (E, at) => typeof at === 'number' ? at : at === 'replay' || (window.EKO_SCN && window.EKO_SCN.on(E)) ? E.sim.today0 + E.sim.V(E.sim.cfg.scenario.replayHour) * HOUR : E.sim.now;

  /* the people: bed patients from the engine's bed states; walkers from the engine's room occupancy (waiting and treatment rooms) */
  function people(E, at){
    const sec = E.data.security, G = sec.evacGraph, C = CF().people, t = timeOf(E, at), S = E.sim.security(E.sim.headcount(t).at), byId = new Map(G.nodes.map(n => [n.id, n]));
    const nodeNear = (L, px, py) => { let b = null, bd = 1e9; G.nodes.forEach(n => { if(n.floor !== L || n.type === 'Exit' || n.type === 'Ambulance-Bay') return; const d = Math.hypot(n.px - px, n.py - py); if(d < bd){ bd = d; b = n; } }); return b; };
    const out = [], assist = V(C.assistMobility), ac = V(C.acuity), TR = V(C.transfer) || {};
    (sec.evac.beds || []).forEach(b => { const st = (S.beds.find(x => x.id === b.id) || {}); if(st.status !== 'occ' && st.status !== 'isolated') return;
      const node = G.roomNode[b.roomGid] ? byId.get(G.roomNode[b.roomGid]) : nodeNear(b.floor, b.x, b.y); if(!node) return;
      const bedbound = st.assist && h32('mob' + b.id) < assist.Bedbound / (assist.Bedbound + assist.Wheelchair);
      /* E6: only a patient who needs transfer takes a vehicle (mid-dialysis, on a bed, flagged by the hospital feed); the rest walk to the assembly point */
      const midDialysis = b.floor === 'L1', needs = (TR.midDialysis && midDialysis) || (TR.onABed && bedbound) || (TR.flagged && st.assist);
      out.push(Object.assign({ id: b.id, ward: node.name, node_id: node.id, bed: b.id, acuity: st.assist ? (bedbound ? 'Critical' : ac.assist) : ac.walking, mobility: st.assist ? (bedbound ? 'Bedbound' : 'Wheelchair') : 'Ambulatory',
        equipment: st.status === 'isolated' ? V(C.isolatedEquipment) : midDialysis ? V(C.inSessionEquipment) : 'None', weight_kg: 75, specialty_needed: V(C.specialty), kind: 'patient', floor: b.floor },
        needs ? {} : { transport: 'none', kind: 'outpatient' })); });
    /* E11: the walkers are the engine's head count (E.sim.headcount, the one people count): in each waiting and clinical room of the
       model, its count less its bed patients, placed at the room's node (or the nearest node on its level). The rest of the count
       (offices, corridors, stores, plant) is staff, which the plan does not model; the page says so. */
    const H = E.sim.headcount(t), geo = new Map((((E.data.spaceGeo || {}).rooms) || []).map(r => [r.gid, r])), nodeOfGid = new Map(G.nodes.filter(n => n.gid).map(n => [n.gid, n]));
    if(V(C.visitorsAreWalking)) H.rooms.forEach(rc => { const w = rc.n - rc.beds; if(!rc.patient || w <= 0) return; const r = geo.get(rc.gid);
      let n = G.roomNode[rc.gid] ? byId.get(G.roomNode[rc.gid]) : nodeOfGid.get(rc.gid);
      if(!n || n.type === 'Exit' || n.type === 'Ambulance-Bay'){ const c = r.poly.reduce((a, p) => [a[0] + p[0] / r.poly.length, a[1] + p[1] / r.poly.length], [0, 0]); n = nodeNear(r.level, c[0], c[1]); }
      if(!n) return;
      for(let i = 0; i < w; i++) out.push({ id: 'W-' + n.id + '-' + rc.gid.slice(-4) + '-' + (i + 1), ward: n.name, node_id: n.id, bed: null, acuity: 'Ambulatory', mobility: 'Ambulatory', equipment: 'None', weight_kg: 75, specialty_needed: 'General', transport: 'none', kind: 'walker', floor: n.floor }); });
    return { list: out, t, head: H };
  }
  function snapshot(E, at){
    const G = E.data.security.evacGraph, C = CF(), P = people(E, at);
    const raw = { nodes: G.nodes, edges: G.edges, egress_access: G.egress_access, floorRank: V(C.floorRank), source: 'Demo Medical Centre, the model and the building data engine',
      patients: P.list, vehicles: V(C.vehicles).map(v => ({ id: v[0], type: v[1], capacity: v[2], mode: v[3], status: v[4], location: 'site', crew_count: 2, crew_shift: 'Day' })),
      facilities: V(C.facilities).map(f => ({ id: f[0], name: f[1], type: f[2], travel_minutes: f[3], beds: f[4], zone: '', distance_km: 0, load_percent: 0, notes: '' })) };
    return { s: X().snapshot(raw), people: P.list, t: P.t, head: P.head };
  }
  /* the fire: the scenario's room, random by seed (the planner's option), a chosen room, or none */
  function fireFor(E, s, f){
    const C = CF(); if(!f || f.kind === 'none') return null;
    if(f.kind === 'seed') return X().ignite(s, +f.seed || 0, V(C.smokeSpread), { tracedPrefixes: ['W'], originTypes: ['Ward'] });
    let origin = f.kind === 'room' ? f.room : null;
    if(f.kind === 'scenario'){ const nm = V(C.scenarioOrigin); const n = [...s.nodes.values()].find(x => x.name.includes(nm)); origin = n ? n.id : null; }
    return origin && s.nodes.get(origin) ? X().ignite(s, 0, V(C.smokeSpread), { origin }) : null;
  }
  const cfgOf = () => { const C = CF(); return Object.assign({}, X().DEFAULT_CONFIG, { mutual_aid: V(C.mutualAid), stair_seconds_per_floor: V(C.stairSecondsPerFloor) }); };
  const cache = new Map();
  /* o: { policy, fire: {kind, seed, room}, liftsOut, exitOut, at } */
  function plan(E, o){
    o = Object.assign({ policy: 'acuity_first', fire: { kind: 'scenario' }, liftsOut: false, exitOut: null, at: 'now' }, o || {});
    const key = JSON.stringify(o) + '|' + Math.floor(timeOf(E, o.at) / 6e4) + '|' + ((window.EKO_SCN && window.EKO_SCN.on(E)) ? 's' : '');
    if(cache.has(key)) return cache.get(key);
    const S = snapshot(E, o.at), fire = fireFor(E, S.s, o.fire), blocked = [];
    if(o.liftsOut) S.s.nodes.forEach(n => { if(n.type === 'Elevator') blocked.push(n.id); });
    else (((E.data.otherSystems || {}).liftsOut) || []).forEach(id => { if(S.s.nodes.get(id)) blocked.push(id); });   /* E5: a lift out of service (the engine's) carries nobody */
    if(o.exitOut) blocked.push(o.exitOut);
    const p = X().buildPlan(S.s, { policy: o.policy, fire, blockedNodes: blocked, config: Object.assign(cfgOf(), { }), smokePenalty: V(CF().smokePenalty) });
    p.snapshotRef = S; p.opts = o; p.pathOf = (a, b) => pathsOf(E).get(a + '|' + b) || null;   /* E10: the walked path of a link */
    p.pathById = id => ((E.data.security.evacGraph.paths || {})[id]) || null;   /* E12: the walked path of one link, as stored (from its from_node) */
    if(cache.size > 40) cache.clear(); cache.set(key, p); return p;
  }
  const compare = (E, o) => X().POLICIES.slice().sort().reduce((m, pol) => { m[pol] = plan(E, Object.assign({}, o, { policy: pol })); return m; }, {});
  /* the lifts may recall to the fire service: the same plan with every lift out, shown beside the baseline */
  const liftsOut = (E, o) => plan(E, Object.assign({}, o, { liftsOut: true }));
  /* E10: each link's walked path (security.evacGraph.paths, made by the site generator's walk step on the model's walkable floor),
     both ways. A link with no path in the data is drawn straight between its two nodes. */
  const pathIdx = new WeakMap();
  function pathsOf(E){ const G = E.data.security.evacGraph; if(pathIdx.has(G)) return pathIdx.get(G); const m = new Map(), P = G.paths || {};
    (G.edges || []).forEach(e => { const q = P[e.id]; if(!q || !q.p || q.p.length < 2) return; const o = { id: e.id, l: q.l, assumed: !!q.assumed, pts: q.p };
      m.set(e.from_node + '|' + e.to_node, o); m.set(e.to_node + '|' + e.from_node, Object.assign({}, o, { pts: q.p.slice().reverse() })); });
    pathIdx.set(G, m); return m; }
  /* a polyline's point at a fraction of its length */
  const along = (pts, f) => { let L = 0; const seg = []; for(let i = 1; i < pts.length; i++){ const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); seg.push(d); L += d; }
    let r = f * L; for(let i = 0; i < seg.length; i++){ if(r <= seg[i] || i === seg.length - 1){ const u = seg[i] ? Math.min(1, r / seg[i]) : 0; return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * u, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * u]; } r -= seg[i]; }
    return pts[pts.length - 1]; };
  /* E10: the links people use on a level, each once, with how many people take it (the corridor line is wider where more do).
     E12: from the replay's own legs, so the lines drawn are the ways the dots walk. */
  function routeUse(p, lv){
    const use = new Map();
    tracks(p).forEach(tr => { const seen = new Set(); tr.segs.forEach(g => { if(g.k !== 'walk' || g.lv !== lv || seen.has(g.e)) return; seen.add(g.e);
      const u = use.get(g.e) || { n: 0, pts: g.pts, assumed: g.assumed, level: lv }; u.n++; use.set(g.e, u); }); });
    return [...use.values()];
  }
  /* E12: each person's track for the replay: the plan's own route (route_nodes), leg by leg, in the plan's own seconds. Nothing is
     routed again and nothing is stretched to fit. The planner times every leg at its pace, the same for every way of moving: a link's
     travel time (smoke slows it as it slows the plan), a stop at each space passed (its dwell), the start (the preparation: the
     help to get ready, an equipment's time), the wait at a lift and its ride, a stair between levels. The legs add up to the plan's
     times: the person reaches the exit at ready_at, waits there for the vehicle and leaves at boarded_at.
     segs: { t0, t1, k, lv, ... }   k: walk (along pts, a link's walked path), help (getting ready, still), pause (a space passed,
     still), liftWait (still), lift and stair (at the lift or stair, fading from level lv to lv2), exit (waiting for the vehicle, at
     a place of its own beside the exit's marker, still) */
  const M2P = { x: 0.434, y: 0.565 };   /* scene percent per metre: the plan draws 104 m as 740 px of a 1640 by 1260 px scene */
  const adjIdx = new WeakMap();
  /* the planner's adjacency (js/evac/planner.js FacilityGraph): the links in the data's order, both ways */
  const adjOf = s => { if(adjIdx.has(s)) return adjIdx.get(s); const m = new Map(); s.edges.forEach(e => { (m.get(e.from_node) || m.set(e.from_node, []).get(e.from_node)).push([e.to_node, e]);
    if(e.bidirectional !== false) (m.get(e.to_node) || m.set(e.to_node, []).get(e.to_node)).push([e.from_node, e]); }); adjIdx.set(s, m); return m; };
  function tracks(p){
    if(p._tracks) return p._tracks;
    const s = p.snapshotRef.s, N = s.nodes, adj = adjOf(s), smoke = (p.graph && p.graph.smoke) || new Set(), pen = V(CF().smokePenalty), cfg = cfgOf();
    const sf = n => smoke.has(n.id) ? pen : 1, hold = n => Math.round((n.type === 'Elevator' && n.vertical_cycle_seconds ? n.vertical_cycle_seconds : n.dwell_seconds) * sf(n));
    const prepOf = id => { const x = (p.snapshotRef.people || []).find(q => q.id === id), txt = ((x && x.equipment) || '').toLowerCase(); let b = 0; Object.keys(cfg.equipment_prep_seconds).forEach(k => { if(txt.includes(k)) b = Math.max(b, cfg.equipment_prep_seconds[k]); }); return b; };
    const stretcher = m => m === 'Stretcher' || m === 'Bedbound';
    /* the link the planner took from a to b: of the links joining them that this person can use, the quickest, the first in the data's order */
    const linkOf = (a, b, mob) => { let best = null, bc = Infinity; (adj.get(a) || []).forEach(([to, e]) => { if(to !== b || (stretcher(mob) && !e.stretcher_ok)) return; const c = Math.round(e.travel_seconds * sf(N.get(b))); if(c < bc){ bc = c; best = e; } }); return best ? { e: best, sec: bc } : null; };
    const out = [];
    p.timelines.forEach(t => { if(t.stranded || !t.route_nodes.length) return;
      const R = t.route_nodes, segs = [], o = N.get(R[0]), prep = prepOf(t.patient_id); let tm = 0, lift = null;
      const startD = o.dwell_seconds + prep; segs.push({ t0: 0, t1: startD, k: t.mobility !== 'Ambulatory' || prep ? 'help' : 'pause', node: R[0] }); tm = startD;
      for(let i = 1; i < R.length; i++){ const a = R[i - 1], b = R[i], nb = N.get(b), L = linkOf(a, b, t.mobility); if(!L){ segs.push({ t0: tm, t1: tm, k: 'gap', a, b }); continue; }
        const q = p.pathById(L.e.id);
        if(q && q.p && q.p.length >= 2){ const pts = L.e.from_node === a ? q.p : q.p.slice().reverse(); segs.push({ t0: tm, t1: tm + L.sec, k: 'walk', e: L.e.id, lv: q.l, pts, assumed: !!q.assumed, a, b }); }
        else segs.push({ t0: tm, t1: tm + L.sec, k: 'stair', e: L.e.id, a, b });   /* a link between levels (a stair): no floor path */
        tm += L.sec;
        const h = hold(nb); if(!h) continue;
        if(nb.type === 'Elevator'){ /* the lift: the wait the plan gives this person's car, then the ride */
          const dep = t.elevator_id === b ? Math.max(tm, t.elevator_boarded_at) : tm; if(dep > tm) segs.push({ t0: tm, t1: dep, k: 'liftWait', node: b }); tm = dep;
          segs.push({ t0: tm, t1: tm + h, k: 'lift', node: b }); tm += h; lift = b; }
        else { segs.push({ t0: tm, t1: tm + h, k: 'pause', node: b }); tm += h; } }
      /* places: a still leg stands where the walk before it ended (or, at the start, where the next walk begins); a lift or stair
         fades out at its door on one level and in at its door on the next */
      const walkAt = (i, dir) => { for(let j = i + dir; j >= 0 && j < segs.length; j += dir) if(segs[j].k === 'walk') return segs[j]; return null; };
      segs.forEach((g, i) => { if(g.k === 'walk' || g.k === 'gap') return; const pv = walkAt(i, -1), nx = walkAt(i, 1);
        if(g.k === 'lift' || g.k === 'stair'){ g.lv = pv ? pv.lv : o.floor; g.at = pv ? pv.pts[pv.pts.length - 1] : [o.px, o.py]; g.lv2 = nx ? nx.lv : g.lv; g.at2 = nx ? nx.pts[0] : g.at; return; }
        const w = i === 0 ? nx : pv || nx; if(w){ g.lv = w.lv; g.at = w === pv ? w.pts[w.pts.length - 1] : w.pts[0]; } else { g.lv = o.floor; g.at = [o.px, o.py]; } });
      const ex = N.get(t.exit_node), arrive = tm;
      out.push({ id: t.patient_id, transport: t.transport, mobility: t.mobility, exit: t.exit_node, exitAt: ex ? [ex.px, ex.py] : null, exitLv: ex ? ex.floor : null,
        nodes: [R[0]].concat(segs.filter(g => g.k === 'walk' || g.k === 'stair').map(g => g.b)), segs, arrive, ready: t.ready_at, out: t.transport === 'none' ? t.ready_at : t.boarded_at, lift }); });
    /* the exit's queue: each person waiting for a vehicle takes the first free place beside the exit's marker and keeps it until they board */
    const byExit = new Map(); out.forEach(tr => { if(tr.transport === 'none' || !(tr.out > tr.ready)) return; (byExit.get(tr.exit) || byExit.set(tr.exit, []).get(tr.exit)).push(tr); });
    byExit.forEach(list => { const free = []; list.sort((a, b) => a.ready - b.ready || (a.id < b.id ? -1 : 1)).forEach(tr => { let k = free.findIndex(f => f <= tr.ready); if(k < 0){ k = free.length; free.push(0); } free[k] = tr.out;
      const r = 1.1 * Math.sqrt(k + 1), th = k * 2.39996; tr.slot = k; tr.segs.push({ t0: tr.ready, t1: tr.out, k: 'exit', lv: tr.exitLv, at: [tr.exitAt[0] + r * Math.cos(th) * M2P.x, tr.exitAt[1] + r * Math.sin(th) * M2P.y] }); }); });
    p._tracks = out; return out;
  }
  /* a person at a second of the plan: { x, y, floor, state, alpha }, or null once out of the building (a walker at the exit; a patient
     who needs a vehicle once it leaves). state: walk, help, lift, exit (the four a dot shows); a lift or stair leg fades between levels */
  const STATE = { walk: 'walk', pause: 'walk', help: 'help', liftWait: 'lift', lift: 'lift', stair: 'walk', exit: 'exit' };
  function placeAt(p, tr, sec){
    if(sec >= tr.out) return null; sec = Math.max(0, sec);
    let g = null; for(let i = 0; i < tr.segs.length; i++){ const q = tr.segs[i]; if(q.k === 'gap') continue; if(sec >= q.t0 && sec < q.t1){ g = q; break; } }
    if(!g){ g = tr.segs.filter(q => q.k !== 'gap' && q.t0 <= sec).pop(); if(!g) return null; }
    const f = g.t1 > g.t0 ? Math.max(0, Math.min(1, (sec - g.t0) / (g.t1 - g.t0))) : 1;
    if(g.k === 'walk'){ const pt = along(g.pts, f); return { x: pt[0], y: pt[1], floor: g.lv, state: 'walk', alpha: 1, assumed: g.assumed, seg: g }; }
    if(g.k === 'lift' || g.k === 'stair'){ const first = f < 0.5, at = first ? g.at : g.at2; return { x: at[0], y: at[1], floor: first ? g.lv : g.lv2, state: STATE[g.k], alpha: first ? 1 - 2 * f : 2 * f - 1, seg: g }; }
    return { x: g.at[0], y: g.at[1], floor: g.lv, state: STATE[g.k], alpha: 1, seg: g };
  }
  /* E12: the replay's counts on a level: drawn here, on another level, out of the building; they add up to everyone in the plan */
  function levelCounts(p, sec, lv){ const T = tracks(p), r = { here: 0, other: 0, out: 0, total: T.length };
    T.forEach(tr => { const q = placeAt(p, tr, sec); if(!q) r.out++; else if(q.floor === lv) r.here++; else r.other++; }); return r; }
  const posOf = (n, other) => n.type === 'Elevator' && n.pos ? (n.pos[other && other.floor] || Object.values(n.pos)[0]) : [n.px, n.py];
  /* E7: the last critical patient out, honestly. A time only when every critical patient leaves on a vehicle that can reach them.
     A patient who needs transfer and leaves by a door no ambulance reaches is waiting for an external transfer: the plan's
     boarding time for them is not a departure, so they are counted, never dropped from the time (a what-if must not look faster). */
  function criticalOut(p){
    const ok = p.timelines.filter(x => !x.stranded), crit = p.timelines.filter(x => x.acuity === 'Critical');
    const ext = ok.filter(x => x.transport !== 'none' && x.needs_external_transfer), cOk = crit.filter(x => !x.stranded && !x.needs_external_transfer);
    const blocked = crit.length - cOk.length;
    return { minutes: crit.length && !blocked ? Math.max(...cOk.map(x => x.boarded_at)) / 60 : null, none: !crit.length, waitingExternal: ext.length,
      critWaitingExternal: crit.filter(x => !x.stranded && x.needs_external_transfer).length, critStranded: crit.filter(x => x.stranded).length };
  }
  return { ready, people, snapshot, plan, compare, liftsOut, tracks, placeAt, levelCounts, timeOf, criticalOut, routeUse, pathsOf };
})();
