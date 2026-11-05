/* ============================================================================
   FIRE ENGINE, Demo Medical Centre (E4). Part of the building data engine.
     matrix(site, cfg)        the cause and effect matrix as data: for each fire zone (the model's departments
                              on a level), the expected outputs, each item with the point that shows it happened
     scenario(e, site, cfg)   the demo fire: the origin room's zone, its detectors (inside the zone by the model's
                              geometry, js/data: security.fire.detectors) in order of distance from the origin, the
                              manual call point, the panel, each output observed from its points at the programme's
                              delays, the AHU-3&4 (2) fault (never observed, its cause, the work order raised after
                              the event), the timeline and the end card's figures
     inZoneVolume(d, zone)    a detector against the zone volume (point in the rooms' outlines, slab to slab)
   Every timing is in js/sim/medical-config.js (scenario) with a note. Replay only: nothing is sent anywhere.
   ============================================================================ */
(function(root){
  'use strict';
  const V = x => (x && typeof x === 'object' && !Array.isArray(x) && 'v' in x && 'note' in x) ? x.v : x;
  const lvName = lv => ['Level ' + lv.slice(1), 'المستوى ' + lv.slice(1)];

  /* ------------------------------ the matrix ------------------------------ */
  function matrix(site, cfg){
    const sec = site.security || {}, fire = sec.fire || {}, G = sec.evacGraph || { nodes: [] }, SC = cfg.scenario;
    const lifts = (G.nodes || []).filter(n => n.type === 'Elevator');
    return (fire.zones || []).map(z => {
      const lv = z.storey, ln = lvName(lv), doors = (sec.doors || []).filter(d => d.storey === lv && d.zone === 'z' + z.dept);
      const ahus = V(cfg.ahus).filter(a => a.serves === lv), nd = (fire.dampers || {})[lv] || 0, fans = V(SC.pressurisedStairs);
      const outputs = [
        { id: 'doors', kind: 'doors', en: 'Doors on hold-open release in the zone', ar: 'الأبواب المحرَّرة في المنطقة', expectedEn: doors.length + ' doors released', expectedAr: doors.length + ' أبواب محرَّرة',
          point: 'access system door states', items: doors.map(d => ({ id: d.id, point: 'door state, access system' })) }]
        .concat(ahus.map((a, i) => ({ id: 'ahu' + (i + 1), kind: 'ahu', en: a.id + ' stopped', ar: 'إيقاف ' + a.id, expectedEn: 'stopped', expectedAr: 'متوقف', asset: a.id,
          point: 'BACnet BO run command, BI status', items: [{ id: a.id, point: 'BACnet BI run status' }] })))
        .concat([{ id: 'dampers', kind: 'dampers', en: 'Smoke and fire dampers closed, ' + ln[0], ar: 'إغلاق مخمدات الدخان والحريق، ' + ln[1], expectedEn: nd + ' of ' + nd + ' closed', expectedAr: nd + ' من ' + nd + ' مغلقة',
            point: 'damper end switches', items: Array.from({ length: nd }, (_, i) => ({ id: 'FSD-' + lv + '-' + String(i + 1).padStart(2, '0'), point: 'damper end switch' })) },
          { id: 'stairfan', kind: 'stairfan', en: 'Stair pressurisation fans started', ar: 'تشغيل مراوح ضغط الدرج', expectedEn: fans.length + ' of ' + fans.length + ' running', expectedAr: fans.length + ' من ' + fans.length + ' تعمل',
            point: 'fan run status', items: fans.map(id => ({ id, point: 'fan run status' })) },
          { id: 'lifts', kind: 'lifts', en: 'Lifts recalled to Level 1', ar: 'استدعاء المصاعد إلى المستوى 1', expectedEn: lifts.length + ' of ' + lifts.length + ' recalled', expectedAr: lifts.length + ' من ' + lifts.length + ' مستدعاة',
            point: 'lift controller status', items: lifts.map(n => ({ id: n.id, name: n.name, point: 'lift controller status' })) }])
        .filter(o => o.items.length);
      return { zone: z.id, storey: lv, en: z.en, ar: z.ar, outputs };
    });
  }

  /* ------------------------------ geometry ------------------------------ */
  const inPoly = (x, y, lp) => { let c = false; for(let i = 0, j = lp.length - 1; i < lp.length; j = i++){ const a = lp[i], b = lp[j]; if((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
  function inZoneVolume(d, zone){
    if(!d || !d.m || !zone || !zone.volume) return false;
    return zone.volume.some(v => d.m[2] >= v.z0 - 0.3 && d.m[2] <= v.z0 + v.h + 0.3 && v.loops.filter(lp => inPoly(d.m[0], d.m[1], lp)).length % 2 === 1);
  }
  const centroidOf = v => { let x = 0, y = 0, n = 0; (v.loops[0] || []).forEach(p => { x += p[0]; y += p[1]; n++; }); return n ? [x / n, y / n] : null; };

  /* ------------------------------ the scenario ------------------------------ */
  function scenario(e, site, cfg){
    const sec = site.security || {}, fire = sec.fire || {}, SC = cfg.scenario, F = cfg.faults, S = V(SC.steps), R = V(SC.responseS);
    const origin = V(SC.origin), G = sec.evacGraph || { nodes: [] }, on = (G.nodes || []).find(n => n.name && n.name.includes(origin));
    const zone = on && (fire.zones || []).find(z => z.spaces.includes(on.gid)); if(!zone) return null;
    const vol = zone.volume.find(v => v.g === on.gid), o0 = vol ? centroidOf(vol) : null; if(!o0) return null;
    const dist = d => Math.hypot(d.m[0] - o0[0], d.m[1] - o0[1]);
    /* the detectors in the zone, by distance from the origin; each alarms when the smoke reaches it */
    const det = (fire.detectors || []).filter(d => d.zone === zone.id && d.kind === 'smoke').map(d => ({ d, r: dist(d) })).sort((a, b) => a.r - b.r);
    const t1 = V(SC.firstAlarmS), sp = V(SC.smokeMs), reach = det.map(x => ({ d: x.d, r: x.r, t: Math.round(t1 + (x.r - det[0].r) / sp) })).filter(x => x.t <= V(SC.windowS)).slice(0, V(SC.maxDetectors));
    const pull = (fire.detectors || []).filter(d => d.kind === 'pull' && d.storey === zone.storey).map(d => ({ d, r: dist(d) })).sort((a, b) => a.r - b.r)[0];
    const dev = x => ({ id: x.d.id, gid: x.d.gid, kind: x.d.kind === 'pull' ? 'pull' : 'smoke', x: x.d.x, y: x.d.y, storey: x.d.storey, room: x.d.roomEn, roomAr: x.d.roomAr, distM: +x.r.toFixed(1) });
    const devices = reach.map(dev).concat(pull ? [dev(pull)] : []);
    const panelS = t1 + V(SC.panelAfterS), dueS = panelS + V(SC.dueS);
    /* the outputs of the zone's row of the matrix, each item observed at its delay; the fault's item never is; a lift out of service is not expected to move */
    const M = matrix(site, cfg).find(m => m.zone === zone.id), bad = F.ahuNoStop, liftOut = F.liftOut ? F.liftOut.lift : null;
    const outputs = M.outputs.map(o => { const items = o.items.map(it => { const fault = (o.kind === 'ahu' && it.id === bad.asset), na = o.kind === 'lifts' && it.id === liftOut;
        return Object.assign({}, it, { atS: fault || na ? null : +(panelS + R[o.kind] + 0.5 * e.U('ce' + zone.id + it.id)).toFixed(1), state: na ? 'na' : fault ? 'fault' : 'ok' }); });
      const live = items.filter(i => i.state !== 'na'), missing = live.some(i => i.state === 'fault');
      const naN = items.filter(i => i.state === 'na'), lv2 = live.length;
      if(naN.length && o.kind === 'lifts'){ o = Object.assign({}, o, { expectedEn: lv2 + ' of ' + lv2 + ' recalled; ' + naN.map(i => i.name || i.id).join(', ') + ' out of service', expectedAr: lv2 + ' من ' + lv2 + ' مستدعاة؛ ' + naN.map(i => i.name || i.id).join('، ') + ' خارج الخدمة' }); }
      return Object.assign({}, o, { expected: o.expectedEn, items, missing, outS: missing ? null : Math.ceil(Math.max(...live.map(i => i.atS))), na: items.filter(i => i.state === 'na').map(i => i.name || i.id) }); });
    const steps = [{ t: 0, k: 'start' }, { t: V(SC.preAlarmS), k: 'pre', dev: 0 }, { t: t1, k: 'alarm', dev: 0 }, { t: panelS, k: 'panel' }]
      .concat(reach.slice(1).map((x, i) => ({ t: x.t, k: 'alarm', dev: i + 1 })))
      .concat(pull ? [{ t: V(SC.pullS), k: 'alarm', dev: devices.length - 1 }] : [])
      .concat(outputs.filter(o => o.outS != null).map(o => ({ t: o.outS, k: 'out', out: o.id })))
      .concat(outputs.some(o => o.missing) ? [{ t: dueS, k: 'missing' }] : [])
      .concat(['cams', 'power', 'ack', 'beds', 'muster', 'end'].map(k => ({ t: S[k], k })))
      .sort((a, b) => a.t - b.t);
    const faultOut = outputs.find(o => o.missing);
    const afterWo = faultOut ? { id: bad.wo, asset: bad.asset, taskEn: bad.task[0], taskAr: bad.task[1], type: 'cm', prio: bad.prio, state: 'asgn', cause: bad.cause, causeAr: bad.causeAr } : null;
    /* the end card's figures, from the same data */
    const tR = e.today0 + V(SC.replayHour) * 36e5, beds = e.security(tR).beds, bedLv = new Set(((sec.evac || {}).beds || []).filter(b => b.floor === zone.storey).map(b => b.id));
    const summary = { alarms: devices.length, observed: outputs.filter(o => !o.missing).length, outputs: outputs.length, ackAfterS: S.ack - t1, assist: beds.filter(b => bedLv.has(b.id) && b.assist).length,
      fault: faultOut ? { asset: bad.asset, cause: bad.cause, causeAr: bad.causeAr, wo: bad.wo } : null };
    return { zone: zone.id, level: zone.storey, durS: S.end, devices, steps, outputs, panelS, dueS, afterWo, summary, origin: { gid: on.gid, name: on.name, m: o0 } };
  }

  /* the muster counts: the people the evacuation plan sends to the assembly point, by the level of the exit they leave by */
  function musterFromPlan(p, cfg){
    const MO = V(cfg.scenario.musterOf), out = {}, nodes = p.snapshotRef ? p.snapshotRef.s.nodes : new Map();
    p.timelines.forEach(x => { if(x.stranded || x.transport !== 'none') return; const n = nodes.get(x.exit_node), mp = n && MO[n.floor]; if(mp) out[mp] = (out[mp] || 0) + 1; });
    return out;
  }
  const api = { matrix, scenario, inZoneVolume, musterFromPlan };
  if(typeof module !== 'undefined') module.exports = api;
  root.EKO_SIMF = api;
})(typeof window !== 'undefined' ? window : globalThis);
