/* ============================================================================
   EVACUATION ENGINE (E2): a JavaScript port of the domain layer of the team's
   evacuation planner (reference/eko-evac, read only). Deterministic: the code
   decides, the AI only explains. Same snapshot, same plan.
     graph      FacilityGraph: Dijkstra (and A*, which returns the same route)
     fire       ignite(snapshot, seed): Python's seeded random, so a seed gives the same fire as the planner
     triage     acuity_first, mobility_first, horizontal_first
     simulate   lifts pooled across the bank, the ambulance bay's docks, vehicles by triage priority
     plan       buildPlan, comparePolicies, whatIf, templateBriefing (the planner's deterministic briefing)
   Port notes, the only departures, both inert on the planner's own hospitals (tools/evac-tests.js proves the port):
     - floor ranks are a parameter (the planner names its floors Ground, Level 1 to 3; the medical site L1 to L3);
     - a person may have transport mode 'none' (a visitor who walks out): out at the exit, no vehicle.
   No screen code. handoff/evacuation.md.
   ============================================================================ */
(function(root){
  'use strict';

  /* ------------------------------ model rules ------------------------------ */
  const NEEDS_STRETCHER = m => m === 'Stretcher' || m === 'Bedbound';
  const CAN_USE_STAIRS = m => m === 'Ambulatory';
  const TRANSPORT_MODE = p => p.transport === 'none' ? 'none' : NEEDS_STRETCHER(p.mobility) ? 'stretcher' : p.mobility === 'Wheelchair' ? 'wheelchair' : 'ambulatory';
  const ACUITY_RANK = { 'Critical': 0, 'High-Dependency': 1, 'Stable-Bedbound': 2, 'Ambulatory': 3 };
  const IS_EGRESS = n => n.type === 'Exit' || n.type === 'Ambulance-Bay';
  const SINGLE_PER_TRIP = n => /single-patient/.test((n.trip_rule || '').toLowerCase());
  const PLANNER_FLOORS = { 'Level 3': 3, 'Level 2': 2, 'Level 1': 1, 'Ground': 0 };

  /* the snapshot: nodes keep their order (Python dicts are ordered; routing ties depend on it) */
  function snapshot(raw){
    const nodes = new Map(); raw.nodes.forEach(n => nodes.set(n.id, n));
    const egressAccess = {}; Object.keys(raw.egress_access || {}).forEach(k => { egressAccess[k] = new Set(raw.egress_access[k]); });
    return { nodes, edges: raw.edges.slice(), patients: raw.patients.slice(), vehicles: raw.vehicles.slice(), facilities: raw.facilities.slice(), egressAccess,
      floorRank: raw.floorRank || PLANNER_FLOORS, source: raw.source || 'unknown' };
  }
  const egressNodes = s => [...s.nodes.values()].filter(IS_EGRESS);
  function egressFor(s, mode){
    if(mode === 'none') return new Set(egressNodes(s).map(n => n.id));
    if(!Object.keys(s.egressAccess).length) return new Set(egressNodes(s).map(n => n.id));
    return new Set(egressNodes(s).filter(n => (s.egressAccess[n.id] || new Set()).has(mode)).map(n => n.id));
  }
  const availableVehicles = s => s.vehicles.filter(v => v.status === 'Available');
  function seatsByMode(s){ const o = {}; availableVehicles(s).forEach(v => { o[v.mode] = (o[v.mode] || 0) + v.capacity; }); return o; }
  function patientsByMode(s){ const o = {}; s.patients.forEach(p => { const m = TRANSPORT_MODE(p); (o[m] = o[m] || []).push(p); }); return o; }

  /* a binary heap on tuples compared left to right, as Python compares them */
  const cmpT = (a, b) => { for(let i = 0; i < a.length; i++){ if(a[i] < b[i]) return -1; if(a[i] > b[i]) return 1; } return 0; };
  function Heap(){ const h = [];
    return { push(x){ h.push(x); let i = h.length - 1; while(i > 0){ const p = (i - 1) >> 1; if(cmpT(h[i], h[p]) >= 0) break; [h[i], h[p]] = [h[p], h[i]]; i = p; } },
      pop(){ const top = h[0], last = h.pop(); if(h.length){ h[0] = last; let i = 0; for(;;){ const l = 2 * i + 1, r = l + 1; let m = i; if(l < h.length && cmpT(h[l], h[m]) < 0) m = l; if(r < h.length && cmpT(h[r], h[m]) < 0) m = r; if(m === i) break; [h[i], h[m]] = [h[m], h[i]]; i = m; } } return top; },
      get size(){ return h.length; } }; }

  /* -------------------------------- graph -------------------------------- */
  function FacilityGraph(s, blockedNodes, blockedEdges, smokeNodes, smokePenalty){
    const blocked = new Set(blockedNodes || []), bEdges = new Set(blockedEdges || []), smoke = new Set(smokeNodes || []), pen = smokePenalty == null ? 3.0 : smokePenalty;
    const adj = new Map(); s.nodes.forEach((_, id) => adj.set(id, []));
    s.edges.forEach(e => { if(bEdges.has(e.id)) return; adj.get(e.from_node).push([e.to_node, e]); if(e.bidirectional !== false) adj.get(e.to_node).push([e.from_node, e]); });
    const smokeF = n => smoke.has(n.id) ? pen : 1.0;
    const traverse = n => Math.round((n.type === 'Elevator' && n.vertical_cycle_seconds ? n.vertical_cycle_seconds : n.dwell_seconds) * smokeF(n));
    const nodePass = (n, mob) => !blocked.has(n.id) && !(n.type === 'Stairwell' && !CAN_USE_STAIRS(mob));
    const edgePass = (e, mob) => !(NEEDS_STRETCHER(mob) && !e.stretcher_ok);
    let minVert = null;
    const minVertical = () => { if(minVert != null) return minVert; let best = null;
      s.edges.forEach(e => { const a = s.nodes.get(e.from_node), b = s.nodes.get(e.to_node); if(!a || !b || a.floor === b.floor) return; const st = e.travel_seconds + Math.min(a.dwell_seconds, b.dwell_seconds); best = best == null ? st : Math.min(best, st); });
      minVert = best == null ? 0 : best; return minVert; };
    const floorsBelow = (n, targets) => { const here = s.floorRank[n.floor]; if(here == null) return 0; let best = null;
      for(const t of targets){ const tn = s.nodes.get(t), there = tn ? s.floorRank[tn.floor] : null; if(there == null) return 0; const g = Math.abs(here - there); best = best == null ? g : Math.min(best, g); } return best || 0; };
    const heuristic = (n, targets) => floorsBelow(n, targets) * minVertical();
    function route(pid, origin, mobility, targets, extraPrep, strategy, escapeFromBlocked){
      if(targets == null) targets = new Set(egressNodes(s).map(n => n.id));
      targets = new Set([...targets].filter(t => !blocked.has(t))); if(!targets.size) return null;
      const start = s.nodes.get(origin); if(!start) return null;
      if(blocked.has(origin) && !escapeFromBlocked) return null;
      const guided = strategy === 'astar';
      const startCost = start.dwell_seconds + (extraPrep || 0), dist = new Map([[origin, startCost]]), prev = new Map(), seen = new Set(), heap = Heap();
      heap.push([startCost + (guided ? heuristic(start, targets) : 0), startCost, origin]);
      let goal = null; route.expansions = 0;
      while(heap.size){ const [, cost, cur] = heap.pop(); if(seen.has(cur)) continue; seen.add(cur); route.expansions++;
        if(targets.has(cur)){ goal = cur; break; }
        for(const [nbId, e] of (adj.get(cur) || [])){ if(seen.has(nbId)) continue; const nb = s.nodes.get(nbId);
          if(!nb || !nodePass(nb, mobility) || !edgePass(e, mobility)) continue;
          const step = Math.round(e.travel_seconds * smokeF(nb)) + traverse(nb), nc = cost + step;
          if(nc < (dist.has(nbId) ? dist.get(nbId) : Infinity)){ dist.set(nbId, nc); prev.set(nbId, [cur, e]); heap.push([nc + (guided ? heuristic(nb, targets) : 0), nc, nbId]); } } }
      if(goal == null) return null;
      const path = [goal]; while(path[path.length - 1] !== origin) path.push(prev.get(path[path.length - 1])[0]); path.reverse();
      const legs = [{ from: origin, to: origin, seconds: startCost, kind: 'dwell', note: 'prepare at ' + start.name + (extraPrep ? ' (+' + extraPrep + 's equipment)' : '') }];
      for(let i = 1; i < path.length; i++){ const a = path[i - 1], b = path[i], e = prev.get(b)[1], nb = s.nodes.get(b);
        legs.push({ from: a, to: b, seconds: e.travel_seconds, kind: 'travel', note: 'via ' + e.id });
        const hold = traverse(nb); if(hold) legs.push({ from: b, to: b, seconds: hold, kind: nb.type === 'Elevator' ? 'vertical' : 'dwell', note: nb.name }); }
      return { patient_id: pid, nodes: path, legs, total_seconds: dist.get(goal), exit_node: goal };
    }
    return { route, blocked, smoke };
  }

  /* --------------------------------- fire --------------------------------- */
  /* Python's random.Random(seed).choice(seq): MT19937 seeded by init_by_array from the seed's 32-bit words, then
     _randbelow by getrandbits with rejection. Reproduced so a seed places the same fire as the planner. */
  function PyRandom(seed){
    const mt = new Uint32Array(624); let mti = 625;
    const mul = (a, b) => { const ah = a >>> 16, al = a & 0xffff; return ((((ah * b) & 0xffff) << 16) + al * b) >>> 0; };
    const initGen = s => { mt[0] = s >>> 0; for(mti = 1; mti < 624; mti++){ const p = mt[mti - 1] ^ (mt[mti - 1] >>> 30); mt[mti] = (mul(p, 1812433253) + mti) >>> 0; } };
    const initByArray = key => { initGen(19650218); let i = 1, j = 0, k = Math.max(624, key.length);
      for(; k; k--){ const p = mt[i - 1] ^ (mt[i - 1] >>> 30); mt[i] = ((mt[i] ^ mul(p, 1664525)) + key[j] + j) >>> 0; i++; j++; if(i >= 624){ mt[0] = mt[623]; i = 1; } if(j >= key.length) j = 0; }
      for(k = 623; k; k--){ const p = mt[i - 1] ^ (mt[i - 1] >>> 30); mt[i] = ((mt[i] ^ mul(p, 1566083941)) - i) >>> 0; i++; if(i >= 624){ mt[0] = mt[623]; i = 1; } }
      mt[0] = 0x80000000; };
    const u32 = () => { let y; if(mti >= 624){ let kk;
        for(kk = 0; kk < 624 - 397; kk++){ y = (mt[kk] & 0x80000000) | (mt[kk + 1] & 0x7fffffff); mt[kk] = mt[kk + 397] ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0); }
        for(; kk < 623; kk++){ y = (mt[kk] & 0x80000000) | (mt[kk + 1] & 0x7fffffff); mt[kk] = mt[kk + (397 - 624)] ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0); }
        y = (mt[623] & 0x80000000) | (mt[0] & 0x7fffffff); mt[623] = mt[396] ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0); mti = 0; }
      y = mt[mti++]; y ^= y >>> 11; y ^= (y << 7) & 0x9d2c5680; y ^= (y << 15) & 0xefc60000; y ^= y >>> 18; return y >>> 0; };
    let a = Math.abs(Math.trunc(seed)); const key = []; if(a === 0) key.push(0); while(a > 0){ key.push(a % 4294967296); a = Math.floor(a / 4294967296); }
    initByArray(key);
    const getrandbits = k => u32() >>> (32 - k);
    const randbelow = n => { const k = n.toString(2).length; let r = getrandbits(k);   /* n.bit_length() */ while(r >= n) r = getrandbits(k); return r; };
    return { choice: seq => seq[randbelow(seq.length)], u32 };
  }
  function ignite(s, seed, spread, opts){
    spread = spread == null ? 1 : spread; opts = opts || {};
    const prefixes = opts.tracedPrefixes || ['C0_', 'C1_', 'C2_'];
    const origins = [...s.nodes.values()].filter(n => n.type !== 'Elevator' && !prefixes.some(p => n.id.startsWith(p)) && !(opts.originTypes && !opts.originTypes.includes(n.type))).map(n => n.id).sort();
    if(!origins.length) return null;
    const origin = opts.origin || PyRandom(seed).choice(origins), node = s.nodes.get(origin);
    const adj = new Map(); s.edges.forEach(e => { (adj.get(e.from_node) || adj.set(e.from_node, new Set()).get(e.from_node)).add(e.to_node); (adj.get(e.to_node) || adj.set(e.to_node, new Set()).get(e.to_node)).add(e.from_node); });
    const smoke = new Set(), seen = new Set([origin]), q = [[origin, 0]];
    while(q.length){ const [cur, d] = q.shift(); if(d >= spread) continue; for(const nb of [...(adj.get(cur) || [])].sort()){ if(seen.has(nb)) continue; seen.add(nb); smoke.add(nb); q.push([nb, d + 1]); } }
    const n = smoke.size;
    return { seed, origin, origin_name: node.name, floor: node.floor, spread, blocked_nodes: [origin], smoke_nodes: [...smoke].sort(),
      description: 'Fire in ' + node.name + ' (' + node.floor + '); smoke is slowing movement through ' + n + ' adjoining space' + (n !== 1 ? 's' : '') };
  }

  /* -------------------------------- triage -------------------------------- */
  const floorRank = (p, floors, s) => { const order = {}, fr = s.floorRank, top = Math.max(...Object.values(fr)); Object.keys(fr).forEach(k => { order[k] = top - fr[k]; }); const v = order[floors[p.node_id] || '']; return v == null ? 0 : v; };
  const BAND = { Ambulatory: 0, Wheelchair: 1, Stretcher: 2, Bedbound: 3 };
  const POLICIES = {
    acuity_first: (p, f, s) => [ACUITY_RANK[p.acuity], NEEDS_STRETCHER(p.mobility) ? 0 : 1, floorRank(p, f, s), p.id],
    mobility_first: (p, f, s) => [BAND[p.mobility], ACUITY_RANK[p.acuity], floorRank(p, f, s), p.id],
    horizontal_first: (p, f, s) => [floorRank(p, f, s), ACUITY_RANK[p.acuity], NEEDS_STRETCHER(p.mobility) ? 0 : 1, p.id]
  };
  const POLICY_DESCRIPTIONS = {
    acuity_first: 'Most clinically urgent leave first; ties broken by needing a stretcher, then by height above the exit.',
    mobility_first: 'Walking patients leave first to clear corridors and free staff; within each mobility band the most urgent go first.',
    horizontal_first: 'Highest floors clear first, then by clinical urgency.'
  };
  function orderPatients(s, policy, floors){
    if(!POLICIES[policy]) throw new Error('unknown triage policy ' + policy);
    return s.patients.map(p => ({ p, k: POLICIES[policy](p, floors, s) })).sort((a, b) => cmpT(a.k, b.k)).map(x => x.p);
  }

  /* ------------------------------- simulation ------------------------------- */
  const DEFAULT_CONFIG = { load_seconds_stretcher: 180, load_seconds_other: 60, handover_seconds: 300, stair_seconds_per_floor: 45, stairwell_capacity: 8,
    equipment_prep_seconds: { ventilator: 300, isolation: 240, 'cardiac monitor': 180, oxygen: 120, iv: 60 }, mutual_aid: [], bay_capacity_is_vehicles: true, default_bay_capacity: 2 };
  const loadSeconds = (cfg, p) => NEEDS_STRETCHER(p.mobility) ? cfg.load_seconds_stretcher : cfg.load_seconds_other;
  function equipmentPrep(cfg, p){ const text = (p.equipment || '').toLowerCase(); let best = 0; Object.keys(cfg.equipment_prep_seconds).forEach(k => { if(text.includes(k)) best = Math.max(best, cfg.equipment_prep_seconds[k]); }); return best; }
  function bedType(spec){ const s = (spec || '').toLowerCase();
    if(s.startsWith('icu') || s.includes('critical') || s === 'cardiology') return 'ICU'; if(s.includes('maternity')) return 'Maternity';
    if(s.includes('pediatric') || s.includes('paediatric')) return 'Pediatric'; if(s.includes('oncology')) return 'Oncology'; return 'General'; }

  function simulate(s, graph, cfg, ordered, policy){
    /* phase 1: route everyone to an exit their transport can collect at; else out of any exit (needs external transfer); else stranded */
    const routes = new Map(), timelines = [];
    ordered.forEach((p, i) => { const node = s.nodes.get(p.node_id), mode = TRANSPORT_MODE(p);
      const tl = { patient_id: p.id, mobility: p.mobility, acuity: p.acuity, transport: mode, origin_node: p.node_id, floor: node.floor, order: i + 1, route_nodes: [], exit_node: '', ready_at: 0, elevator_wait: 0, elevator_id: '',
        elevator_boarded_at: 0, boarded_at: 0, vehicle_id: '', vehicle_wait: 0, facility_id: '', arrives_at: 0, stranded: false, needs_external_transfer: false, stranded_reason: '' };
      const prep = equipmentPrep(cfg, p), coll = egressFor(s, mode);
      let r = graph.route(p.id, p.node_id, p.mobility, coll.size ? coll : null, prep, 'dijkstra', true);
      if(r == null){ const fb = graph.route(p.id, p.node_id, p.mobility, null, prep, 'dijkstra', true); if(fb != null){ r = fb; tl.needs_external_transfer = true; } }
      if(r == null){ tl.stranded = true; tl.stranded_reason = 'no route from ' + node.name + ' to any exit for a ' + p.mobility.toLowerCase() + ' patient'; }
      else { routes.set(p.id, r); tl.route_nodes = r.nodes; tl.exit_node = r.exit_node; }
      timelines.push(tl); });
    const tlById = new Map(timelines.map(t => [t.patient_id, t]));
    /* phase 2: lifts, pooled across the bank */
    const cars = new Map(); s.nodes.forEach(n => { if(n.type === 'Elevator') cars.set(n.id, { id: n.id, name: n.name, cycle: n.vertical_cycle_seconds || n.dwell_seconds, capacity: n.capacity_persons || 1, exclusive: SINGLE_PER_TRIP(n), free_at: 0, trips: 0, busy: 0, total_wait: 0, peak_queue: 0 }); });
    const pById = new Map(ordered.map(p => [p.id, p]));
    if(!cars.size){ routes.forEach((r, pid) => { tlById.get(pid).ready_at = r.total_seconds; }); }
    else {
      const pool = []; routes.forEach((r, pid) => { let el = 0; r.legs.forEach(leg => { const n = s.nodes.get(leg.to); if(n && n.type === 'Elevator' && leg.kind === 'vertical') pool.push({ pid, arrive: el, after: Math.max(r.total_seconds - (el + leg.seconds), 0) }); el += leg.seconds; }); });
      const rank = new Map(ordered.map((p, i) => [p.id, i])); pool.sort((a, b) => cmpT([a.arrive, rank.has(a.pid) ? rank.get(a.pid) : 2 ** 30], [b.arrive, rank.has(b.pid) ? rank.get(b.pid) : 2 ** 30]));
      let i = 0;
      while(i < pool.length){ const head = pool[i], p = pById.get(head.pid);
        let car = null; cars.forEach(c => { if(!car || cmpT([Math.max(head.arrive, c.free_at), c.id], [Math.max(head.arrive, car.free_at), car.id]) < 0) car = c; });
        const depart = Math.max(head.arrive, car.free_at); let batch;
        if(NEEDS_STRETCHER(p.mobility) && car.exclusive){ batch = [head]; i++; }
        else { batch = []; while(i < pool.length && batch.length < car.capacity){ const cand = pool[i], cp = pById.get(cand.pid); if(NEEDS_STRETCHER(cp.mobility) && car.exclusive) break; if(cand.arrive > depart) break; batch.push(cand); i++; } if(!batch.length){ batch = [head]; i++; } }
        let waiting = 0; for(let j = i; j < pool.length; j++) if(pool[j].arrive <= depart) waiting++;
        car.peak_queue = Math.max(car.peak_queue, waiting + batch.length); car.trips++; car.busy += car.cycle; car.free_at = depart + car.cycle;
        batch.forEach(item => { const w = depart - item.arrive; car.total_wait += w; const tl = tlById.get(item.pid); tl.elevator_wait += w; tl.elevator_id = car.id; tl.elevator_boarded_at = depart; tl.ready_at = depart + car.cycle + item.after; }); }
      routes.forEach((r, pid) => { const tl = tlById.get(pid); if(tl.ready_at === 0) tl.ready_at = r.total_seconds; });
    }
    /* phase 3: vehicles by triage priority, the bay's docks, beds at the far end */
    const facilities = s.facilities.slice().sort((a, b) => a.travel_minutes - b.travel_minutes), freeBeds = new Map(facilities.map(f => [f.id, Object.assign({}, f.beds)]));
    const assignFacility = bt => { for(const f of facilities){ const fb = freeBeds.get(f.id); if((fb[bt] || 0) > 0){ fb[bt]--; return f; } } return facilities[0] || null; };
    const fleet = new Map(); availableVehicles(s).forEach(v => { (fleet.get(v.mode) || fleet.set(v.mode, []).get(v.mode)).push({ v, free_at: 0, trips: 0, busy: 0, wait: 0, peak: 0 }); });
    (cfg.mutual_aid || []).forEach(([minute, count, mode]) => { for(let k = 0; k < count; k++){ const unit = { id: 'AID-' + mode.slice(0, 3).toUpperCase() + '-' + String(Math.trunc(minute)).padStart(3, '0') + '-' + String(k + 1).padStart(2, '0'),
      type: 'Mutual aid (' + mode + ', +' + Math.trunc(minute) + ' min)', capacity: mode === 'stretcher' ? 1 : mode === 'wheelchair' ? 4 : 12, mode, status: 'Available' };
      (fleet.get(mode) || fleet.set(mode, []).get(mode)).push({ v: unit, free_at: minute * 60, trips: 0, busy: 0, wait: 0, peak: 0 }); } });
    const bays = [...s.nodes.values()].filter(n => n.type === 'Ambulance-Bay');
    const baySlots = cfg.bay_capacity_is_vehicles && bays.length ? bays.reduce((a, b) => a + (b.capacity_persons || cfg.default_bay_capacity), 0) : 1e6;
    let docked = [];
    const claimBay = (earliest, duration, mode) => { if(mode !== 'stretcher' || baySlots >= 1e6) return earliest; let start = earliest;
      for(;;){ const busy = docked.filter(e => e > start); if(busy.length < baySlots) break; start = Math.min(...busy); }
      docked.push(start + duration); if(docked.length > 512) docked = docked.filter(e => e > start); return start; };
    const byMode = new Map(); ordered.forEach(p => { const tl = tlById.get(p.id); if(tl.stranded) return; (byMode.get(tl.transport) || byMode.set(tl.transport, []).get(tl.transport)).push(tl); });
    byMode.forEach((pending0, mode) => {
      if(mode === 'none'){ pending0.forEach(t => { t.boarded_at = t.ready_at; t.arrives_at = t.ready_at; }); return; }   /* a visitor: out at the exit */
      const crews = fleet.get(mode);
      if(!crews || !crews.length){ pending0.forEach(t => { t.stranded = true; t.stranded_reason = 'no available vehicle can carry a ' + mode + ' patient'; }); return; }
      let pending = pending0.slice().sort((a, b) => a.order - b.order);
      while(pending.length){ let crew = null; crews.forEach(c => { if(!crew || cmpT([c.free_at, c.v.id], [crew.free_at, crew.v.id]) < 0) crew = c; });
        const cap = crew.v.capacity; let tFree = crew.free_at, readyNow = pending.filter(t => t.ready_at <= tFree);
        if(!readyNow.length){ tFree = Math.min(...pending.map(t => t.ready_at)); readyNow = pending.filter(t => t.ready_at <= tFree); }
        const batch = readyNow.slice(0, cap); let board = Math.max(tFree, Math.max(...batch.map(t => t.ready_at)));
        pending = pending.filter(t => !batch.includes(t));
        crew.peak = Math.max(crew.peak, pending.length + batch.length);
        const load = Math.max(...batch.map(t => loadSeconds(cfg, pById.get(t.patient_id))));
        board = claimBay(board, load, mode); const depart = board + load;
        let trip = 0; batch.forEach(t => { const fac = assignFacility(bedType(pById.get(t.patient_id).specialty_needed)); if(!fac) return; t.facility_id = fac.id; trip = Math.max(trip, fac.travel_minutes); });
        const oneWay = trip * 60; crew.free_at = depart + oneWay + cfg.handover_seconds + oneWay; crew.trips++; crew.busy += crew.free_at - board;
        batch.forEach(t => { t.vehicle_id = crew.v.id; t.vehicle_wait = board - t.ready_at; t.boarded_at = depart; t.arrives_at = depart + oneWay; crew.wait += t.vehicle_wait; }); } });
    const r1 = v => Math.round(v * 10) / 10;
    const resources = [...cars.values()].map(c => ({ resource_id: c.id, kind: 'elevator', name: c.name, trips: c.trips, busy_seconds: r1(c.busy), peak_queue: c.peak_queue, total_wait_seconds: r1(c.total_wait) }));
    fleet.forEach((crews, mode) => crews.forEach(c => resources.push({ resource_id: c.v.id, kind: 'vehicle:' + mode, name: c.v.type, trips: c.trips, busy_seconds: r1(c.busy), peak_queue: c.peak, total_wait_seconds: r1(c.wait) })));
    const done = timelines.filter(t => !t.stranded);
    return { timelines, resources, total_seconds: done.length ? Math.max(...done.map(t => t.boarded_at)) : 0, stranded: timelines.filter(t => t.stranded), policy };
  }

  /* --------------------------------- plan --------------------------------- */
  /* Python's round(): halves to even */
  /* exact, on the float's binary value, as Python rounds: 129.35 is stored as 129.3499999... and rounds to 129.3 */
  function pyRound(x, nd){
    nd = nd || 0; if(!isFinite(x) || x === 0) return x;
    const dv = new DataView(new ArrayBuffer(8)); dv.setFloat64(0, Math.abs(x));
    const hi = dv.getUint32(0), lo = dv.getUint32(4), ex = (hi >>> 20) & 0x7ff;
    let M = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo), E = ex - 1075; if(ex) M |= 1n << 52n; else E = -1074;
    let num = M * 10n ** BigInt(nd), den = 1n; if(E >= 0) num <<= BigInt(E); else den <<= BigInt(-E);
    let q = num / den; const r2 = (num % den) * 2n; if(r2 > den || (r2 === den && q % 2n === 1n)) q += 1n;
    return Math.sign(x) * Number(q) / Math.pow(10, nd);
  }
  const hhmm = sec => { const s = pyRound(sec), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h ? h + 'h ' + String(m).padStart(2, '0') + 'm' : m + 'm'; };
  function buildPlan(s, o){
    o = o || {}; const policy = o.policy || 'acuity_first', cfg = Object.assign({}, DEFAULT_CONFIG, o.config || {}), fire = o.fire || null;
    let blocked = new Set(o.blockedNodes || []); const smoke = new Set();
    if(fire){ fire.blocked_nodes.forEach(n => blocked.add(n)); fire.smoke_nodes.forEach(n => smoke.add(n)); }
    const graph = FacilityGraph(s, blocked, o.blockedEdges, smoke), floors = {}; s.nodes.forEach(n => { floors[n.id] = n.floor; });
    const ordered = orderPatients(s, policy, floors), res = simulate(s, graph, cfg, ordered, policy);
    const pbm = patientsByMode(s), byModeCount = {}; Object.keys(pbm).forEach(k => { byModeCount[k] = pbm[k].length; });
    const compMode = {}, compAcuity = {}; res.timelines.forEach(t => { if(t.stranded) return; compMode[t.transport] = Math.max(compMode[t.transport] || 0, t.boarded_at); compAcuity[t.acuity] = Math.max(compAcuity[t.acuity] || 0, t.boarded_at); });
    Object.keys(compMode).forEach(k => { compMode[k] = pyRound(compMode[k] / 60, 1); }); Object.keys(compAcuity).forEach(k => { compAcuity[k] = pyRound(compAcuity[k] / 60, 1); });
    const evacuated = res.timelines.filter(t => !t.stranded).length;
    const totals = { patients: s.patients.length, evacuated, stranded: res.stranded.length, total_seconds: pyRound(res.total_seconds, 1), total_minutes: pyRound(res.total_seconds / 60, 1), total_readable: hhmm(res.total_seconds),
      patients_by_mode: byModeCount, seats_by_mode: seatsByMode(s), completion_minutes_by_mode: compMode, completion_minutes_by_acuity: compAcuity,
      critical_clear_minutes: compAcuity.Critical != null ? compAcuity.Critical : null, critical_stranded: res.stranded.filter(t => t.acuity === 'Critical').length,
      needs_external_transfer: res.timelines.filter(t => t.needs_external_transfer && !t.stranded).length, vehicles_total: s.vehicles.length, vehicles_available: availableVehicles(s).length };
    let bn = null; res.resources.forEach(r => { if(!bn || r.total_wait_seconds > bn.total_wait_seconds) bn = r; });
    const bottleneck = bn && bn.total_wait_seconds > 0 ? { resource_id: bn.resource_id, kind: bn.kind, name: bn.name, trips: bn.trips, total_wait_minutes: pyRound(bn.total_wait_seconds / 60, 1),
      mean_wait_minutes: pyRound((bn.trips ? bn.total_wait_seconds / bn.trips : 0) / 60, 1), peak_queue: bn.peak_queue } : null;
    return { policy, policy_description: POLICY_DESCRIPTIONS[policy] || '', fire, blocked_nodes: [...blocked].sort(), totals, bottleneck, resources: res.resources, timelines: res.timelines,
      stranded: res.stranded.map(t => ({ patient_id: t.patient_id, acuity: t.acuity, node: t.origin_node, floor: t.floor, mobility: t.mobility, reason: t.stranded_reason })), graph };
  }
  const comparePolicies = (s, o) => Object.keys(POLICIES).sort().reduce((m, p) => { m[p] = buildPlan(s, Object.assign({}, o, { policy: p })); return m; }, {});
  /* take something out of service and say honestly what it costs: elapsed time stops being comparable once anyone is stranded */
  function whatIf(s, o){
    const base = buildPlan(s, Object.assign({}, o, { blockedNodes: o.baseBlocked || [] })), scen = buildPlan(s, o);
    const was = new Set(base.stranded.map(x => x.patient_id)), newly = scen.stranded.map(x => x.patient_id).filter(id => !was.has(id)).sort();
    const delta = scen.totals.total_minutes - base.totals.total_minutes;
    return { baseline: base, scenario: scen, newly_stranded: newly, comparable: !newly.length,
      verdict: newly.length ? { kind: 'stranded', n: newly.length } : { kind: 'delta', minutes: Math.abs(delta), slower: delta > 0 } };
  }
  /* the planner's deterministic briefing: facts from the plan only */
  function templateBriefing(plan){
    const t = plan.totals, modes = t.patients_by_mode, seats = t.seats_by_mode;
    const tight = Object.keys(modes).filter(m => m !== 'none').map(m => [m, modes[m], seats[m] || 0]).sort((a, b) => (a[1] ? a[2] / a[1] : 99) - (b[1] ? b[2] / b[1] : 99));
    const [wm, wp, ws] = tight[0] || ['', 0, 0];
    return { policy: plan.policy, worstMode: wm, worstPatients: wp, worstSeats: ws, bottleneck: plan.bottleneck, stranded: t.stranded, evacuated: t.evacuated, readable: t.total_readable,
      patients: t.patients, modes, vehiclesAvailable: t.vehicles_available, vehiclesTotal: t.vehicles_total };
  }
  /* the facts a language model may cite; anything else in its text is invented (the planner's number guard) */
  function facts(plan){ const t = plan.totals, f = { patients_total: t.patients, patients_evacuated: t.evacuated, patients_stranded: t.stranded, total_minutes: t.total_minutes, total_readable: t.total_readable,
    vehicles_available: t.vehicles_available, vehicles_total: t.vehicles_total, critical_clear_minutes: t.critical_clear_minutes };
    Object.keys(t.patients_by_mode).forEach(m => { f['patients_' + m] = t.patients_by_mode[m]; }); Object.keys(t.seats_by_mode).forEach(m => { f['seats_' + m] = t.seats_by_mode[m]; });
    Object.keys(t.completion_minutes_by_mode).forEach(m => { f['minutes_' + m] = t.completion_minutes_by_mode[m]; }); if(plan.bottleneck) f.bottleneck_wait_minutes = plan.bottleneck.total_wait_minutes; return f; }
  function guard(text, fx){ const allowed = new Set(); Object.values(fx).forEach(v => { if(v == null) return; String(v).match(/\d+(?:\.\d+)?/g)?.forEach(n => allowed.add(n)); });
    return (String(text || '').match(/\d+(?:\.\d+)?/g) || []).filter(tok => !allowed.has(tok) && !allowed.has(String(Math.trunc(+tok))) && !allowed.has((+tok).toFixed(1))); }

  const api = { snapshot, FacilityGraph, ignite, PyRandom, orderPatients, simulate, buildPlan, comparePolicies, whatIf, templateBriefing, facts, guard, pyRound, hhmm, POLICIES: Object.keys(POLICIES), POLICY_DESCRIPTIONS, DEFAULT_CONFIG, TRANSPORT_MODE };
  if(typeof module !== 'undefined') module.exports = api;
  root.EKO_EVACX = api;
})(typeof window !== 'undefined' ? window : globalThis);
