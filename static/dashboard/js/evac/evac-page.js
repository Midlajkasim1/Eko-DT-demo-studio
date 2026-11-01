/* ============================================================================
   EVACUATION PLAN ON THE PAGE (E2). The plan the evacuation engine computes
   (js/evac/planner.js on js/evac/medical-evac.js), shown at the top of
   Security > Evacuation: the headline (building clear, last critical patient
   out, the binding constraint, stranded), the three policies compared, the
   what-ifs, the transport panel, the plan step by step, the planner's
   deterministic briefing, the limits in plain words, and the replay on the
   model (the alarm level isolated, people as dots moving to their exits).
   Read only: a plan to decide with, never an instruction to anything.
   ============================================================================ */
window.EKO_EVACP = (function(){
  'use strict';
  const C = () => window.EKO_C, A = () => window.EKO_A, O = () => window.EKO_OPS, M = () => window.EKO_EVACM, X = () => window.EKO_EVACX;
  const esc = s => C().esc(s), fmt = (v, d) => C().fmt(v, d);
  /* E6: on a demo site the page opens on clinic hours when the time now is outside them (the demo may run in the evening); the time in use is said on the page */
  const outOfHours = E => !!(E.sim && E.sim.isOpen && !E.sim.isOpen(E.sim.now));
  const st = E => Object.assign({ policy: 'acuity_first', fire: 'scenario', seed: 7, room: '', liftsOut: false, exitOut: '', at: outOfHours(E) ? 'replay' : 'now' }, E.state.evx || {});
  const optsOf = (E, s) => ({ policy: s.policy, fire: s.fire === 'seed' ? { kind: 'seed', seed: s.seed } : s.fire === 'room' && s.room ? { kind: 'room', room: s.room } : { kind: s.fire === 'none' ? 'none' : 'scenario' },
    liftsOut: s.liftsOut, exitOut: s.exitOut || null, at: s.at });
  const mins = v => v == null ? null : v;
  const hm = (E, m) => m == null ? E.t('evx.noneVal') : m >= 60 ? Math.floor(m / 60) + E.t('evx.u.h') + ' ' + String(Math.round(m % 60)).padStart(2, '0') + E.t('evx.u.m') : fmt(m, 1) + ' ' + E.t('evx.u.min');
  const nodeName = (p, id) => { const n = p.snapshotRef.s.nodes.get(id); return n ? n.name : id; };
  /* a vehicle type or a lift by name, in the reader's language */
  const VT = { 'Ambulance': 'evx.vt.amb', 'Patient transport bus': 'evx.vt.bus', 'Wheelchair van': 'evx.vt.van' };
  const rName = (E, n) => { const m = /^(Public|Service) lift (\d+)$/.exec(n || ''); return m ? E.t(m[1] === 'Public' ? 'evx.lift.pub' : 'evx.lift.serv', { n: m[2] }) : VT[n] ? E.t(VT[n]) : n; };
  const bnName = (E, b) => !b ? E.t('evx.bn.none') : b.kind === 'elevator' ? rName(E, b.name) : E.t('evx.bn.vehicle', { n: rName(E, b.name) });
  /* E6: the two clocks, named as two different things. Everyone out of the building: the last person at an exit (walking on to the
     assembly point, or waiting there for a vehicle). All transfers complete: the last patient who needs transfer leaves on a vehicle. */
  function clocks(p){
    /* E7: a patient waiting for an external transfer has not left; "All transfers complete" counts only the departures that happen */
    const ok = p.timelines.filter(x => !x.stranded), need = ok.filter(x => x.transport !== 'none'), tr = need.filter(x => !x.needs_external_transfer);
    return { out: ok.length ? Math.max(...ok.map(x => x.transport === 'none' ? x.boarded_at : x.ready_at)) / 60 : null, tr: tr.length ? Math.max(...tr.map(x => x.boarded_at)) / 60 : null,
      nTr: need.length, nAsm: ok.length - need.length, ext: need.length - tr.length, vehicles: new Set(tr.map(x => x.vehicle_id).filter(Boolean)).size,
      walkersOut: ok.some(x => x.transport === 'none') ? Math.max(...ok.filter(x => x.transport === 'none').map(x => x.boarded_at)) / 60 : null };
  }
  /* what the binding constraint limits: a sentence, and a short name for the tile */
  const VS = { 'Ambulance': 'evx.vs.amb', 'Patient transport bus': 'evx.vs.bus', 'Wheelchair van': 'evx.vs.van' };
  const bnShort = (E, b) => !b ? E.t('evx14.vs.none') : b.kind === 'elevator' ? rName(E, b.name) : VS[b.name] ? E.t(VS[b.name]) : b.name;
  const bnLine = (E, b) => !b ? E.t('evx.bnl.none') : b.kind === 'elevator' ? E.t('evx.bnl.lift', { r: rName(E, b.name) }) : E.t('evx.bnl.vehicle', { r: VT[b.name] ? E.t(VT[b.name] + 'L') : b.name });
  /* the headline: a template per case, joined (no critical patient, people stranded, lifts out, an exit blocked, no fire, no transfer) */
  function headline(E, p, K){
    const t = E.t.bind(E), T = p.totals, o = p.opts || {}, CO = M().criticalOut(p), crit = CO.minutes;
    const pre = [o.liftsOut ? t('evx.hl2.lifts') : '', o.exitOut ? t('evx.hl2.exit', { x: nodeName(p, o.exitOut) }) : '', !p.fire ? t('evx.hl2.noFire') : ''].filter(Boolean).join(' ');
    const first = [t(T.stranded ? 'evx.hl2.outRest' : 'evx.hl2.out', { o: hm(E, K.out) }), K.tr == null ? t('evx.hl2.noTr') : t('evx.hl2.tr', { c: hm(E, K.tr) })];
    if(crit != null) first.push(t('evx.hl2.crit', { k: hm(E, crit) }));
    const parts = [T.stranded ? t('evx.hl2.stranded', { s: T.stranded }) : '', CO.waitingExternal ? t('evx.hl2.extLead', { x: CO.waitingExternal }) : '',
      (pre ? pre + ' ' : '') + first.join(t('evx.hl2.sep')) + t('evx.hl2.end'),
      crit == null && !CO.waitingExternal ? t(CO.critStranded ? 'evx.hl2.critStranded' : 'evx.hl2.noCrit') : '', p.bottleneck ? bnLine(E, p.bottleneck) + t('evx.hl2.end') : '',
      !T.stranded ? t('evx.hl2.noneStranded') : ''];
    return O().headline(E, parts.filter(Boolean).join(' '), T.stranded ? 'alarm' : CO.waitingExternal ? 'attn' : 'ok');
  }

  function section(E, asParts){
    if(!M() || !M().ready(E)) return asParts ? null : '';
    const t = E.t.bind(E), s = st(E), o = optsOf(E, s), p = M().plan(E, o), T = p.totals, lo = M().liftsOut(E, Object.assign({}, o, { liftsOut: true })), cmp = M().compare(E, Object.assign({}, o, { liftsOut: s.liftsOut }));
    const CO = M().criticalOut(p), crit = CO.minutes, bn = p.bottleneck, K = clocks(p);
    const hl = headline(E, p, K);
    /* E11: short labels that fit the strip at 1280 (the long ones head the drawers and the compare table); the people tile says who the plan moves and
       how many of the site's head count it leaves out (staff are not modelled), so the two add up to the Occupancy figure for the hour */
    const HD = (p.snapshotRef || {}).head, nPpl = (p.snapshotRef || {}).people ? p.snapshotRef.people.length : T.evacuated;
    /* E17b: a tile with nothing to show says for when (the people of the hour the plan uses, as the line under the tabs states), not a bare "none" */
    const noneAt = esc(t('evx.noneAt17b', { h: E.clockLabel(s.at === 'replay' ? M().timeOf(E, 'replay') : E.sim.now) }));
    const heroes = [O().hero(E, t('evx.ks.out'), O().door(E, esc(hm(E, K.out)), 'evxPlan', 'clear'), '', HD ? t('evx.k.outCap3', { p: nPpl, s: HD.staff }) : t('evx.k.outCap', { n: T.evacuated - T.stranded })),
      O().hero(E, t('evx.ks.tr'), K.tr == null ? noneAt : O().door(E, esc(hm(E, K.tr)), 'evxPlan', 'tr'), '', K.tr == null && !K.ext ? t('evx.k.trNone') : K.ext ? t('evx.k.trExt', { n: K.nTr - K.ext, v: K.vehicles, x: K.ext }) : t('evx.k.trCap', { n: K.nTr, v: K.vehicles })),
      /* E7: patients waiting for an external transfer: the tile counts them instead of a time */
      CO.waitingExternal ? O().hero(E, t('evx.ks.crit'), O().door(E, esc(String(CO.waitingExternal)), 'evxPlan', 'crit'), t('evx.u.waiting'), t('evx.k.critExt'), t('evx.ext'), 'warn')
        : O().hero(E, t('evx.ks.crit'), crit == null ? noneAt : O().door(E, esc(hm(E, crit)), 'evxPlan', 'crit'), '', crit == null ? t('evx.k.critNone') : t('evx.k.critCap')),
      O().hero(E, t('evx.ks.bn'), O().door(E, esc(bnShort(E, bn)), 'evxPlan', 'transport'), '', bn ? t('evx.k.bnCap', { r: bnLine(E, bn), w: fmt(bn.total_wait_minutes, 0) }) : t('evx.bnl.none')),
      /* E9: five tiles; patients who cannot leave by the plan take the fifth place only when there are any */
      T.stranded ? O().hero(E, t('evx.k.stranded'), O().door(E, String(T.stranded), 'evxPlan', 'stranded'), '', t('evx.k.strandedCap', { x: T.needs_external_transfer }), t('sec.flag'), 'crit')
        : O().hero(E, t('evx.ks.asm'), O().door(E, String(K.nAsm), 'evxPlan', 'people'), '', t('evx.k.asmCap2', { p: K.nTr }))];
    const atLine = `<p class="tCap evxat">${esc(s.at === 'replay' ? t(outOfHours(E) ? 'evx.at.usedOut' : 'evx.at.used', { h: E.clockLabel(M().timeOf(E, 'replay')), n: E.clockLabel(E.sim.now) }) : t('evx.at.usedNow', { h: E.clockLabel(E.sim.now) }))}</p>`;
    const seg = (act, v, lbl, on) => `<button class="seg" data-act="${act}" data-v="${esc(v)}" data-on="${on}" aria-pressed="${on}">${esc(lbl)}</button>`;
    const rooms = [...p.snapshotRef.s.nodes.values()].filter(n => n.type === 'Ward' && n.floor === (s.room ? (p.snapshotRef.s.nodes.get(s.room) || {}).floor : 'L2') || n.id === s.room).slice(0, 400);
    const exits = [...p.snapshotRef.s.nodes.values()].filter(n => n.type === 'Exit' || n.type === 'Ambulance-Bay');
    /* E9: the controls in one row: each choice a labelled list, the what-if beside them, the replay at the end */
    const pick = (k, opts, cur, lbl) => `<label class="evxpick"><span class="tLbl evxlbl">${esc(lbl)}</span><select class="tlsel" data-chg="evxPick" data-k="${k}" aria-label="${esc(lbl)}">${opts.map(([v, l]) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
    const ctl = `<div class="evxctl evxrow">
      ${pick('policy', X().POLICIES.map(k => [k, t('evx.pol.' + k)]), s.policy, t('evx.c.policy'))}
      ${pick('fire', ['scenario', 'room', 'seed', 'none'].map(k => [k, t('evx.fire.' + k)]), s.fire, t('evx.c.fire'))}
      ${s.fire === 'room' ? `<select class="tlsel" data-chg="evxRoom" aria-label="${esc(t('evx.fire.room'))}"><option value="">${esc(t('evx.pickRoom'))}</option>${rooms.map(n => `<option value="${esc(n.id)}"${s.room === n.id ? ' selected' : ''}>${esc(n.floor + ' · ' + n.name)}</option>`).join('')}</select>` : ''}
      ${s.fire === 'seed' ? `<input class="tlsel evxseed" type="number" min="0" step="1" value="${esc(s.seed)}" data-chg="evxSeed" aria-label="${esc(t('evx.fire.seed'))}">` : ''}
      <label class="row gap4 aiC tCap"><input type="checkbox" data-chg="evxLifts"${s.liftsOut ? ' checked' : ''}> ${esc(t('evx.w.lifts'))}</label>
      <select class="tlsel evxexit" data-chg="evxExit" aria-label="${esc(t('evx.w.exit'))}"><option value="">${esc(t('evx.w.exitNone'))}</option>${exits.map(n => `<option value="${esc(n.id)}"${s.exitOut === n.id ? ' selected' : ''}>${esc(n.name)}</option>`).join('')}</select>
      ${pick('at', [['now', t('evx.at.now')], ['replay', t('evx.at.replay', { h: E.clockLabel(M().timeOf(E, 'replay')) })]], s.at, t('evx.c.people'))}
      <span class="grow"></span><button class="btnP btnSm" data-act="evxReplay">${esc(t('evx.replay'))}</button></div>`;
    /* the three policies, the same snapshot, the same fire and what-if */
    const cmpRows = Object.keys(cmp).map(k => { const q = cmp[k].totals, kq = clocks(cmp[k]); return `<tr data-on="${k === s.policy ? 1 : 0}"><th scope="row">${esc(t('evx.pol.' + k))}</th><td class="tMonoS">${esc(hm(E, kq.out))}</td><td class="tMonoS">${esc(hm(E, kq.tr))}</td><td class="tMonoS">${esc((co => co.waitingExternal ? t('evx.c.extWait', { n: co.waitingExternal }) : hm(E, co.minutes))(M().criticalOut(cmp[k])))}</td><td class="tMonoS">${q.stranded}</td><td class="tMonoS">${q.needs_external_transfer}</td></tr>`; }).join('');
    const cmpW = A().widget(E, t('evx.cmpT'), t('evx.cmpCap'), O().table(E, ['evx.c.policy', 'evx.k.out', 'evx.k.tr', 'evx.k.crit', 'evx.k.stranded', 'evx.c.ext'], cmpRows)
      + `<p class="tCap">${esc(t('evx.pol.desc.' + s.policy))}</p>`);
    /* the lifts may recall to the fire service: their result beside the baseline, always */
    const L = lo.totals, KL = clocks(lo), wiNote = L.stranded ? t('evx.lo.stranded', { n: L.stranded, k: L.critical_stranded }) : (KL.ext ? t('evx.lo.ok3', { o: hm(E, KL.out), c: hm(E, KL.tr), x: KL.ext }) : t('evx.lo.ok2', { o: hm(E, KL.out), c: hm(E, KL.tr), x: L.needs_external_transfer }));
    const loW = A().widget(E, t('evx.loT'), t('evx.loCap'), `<dl class="secdl"><dt>${esc(t('evx.lo.base'))}</dt><dd>${esc(t('evx.lo.base2', { o: hm(E, K.out), c: hm(E, K.tr), s: T.stranded }))}</dd><dt>${esc(t('evx.lo.out'))}</dt><dd>${esc(wiNote)}</dd></dl>`);
    /* the transport panel */
    const vRows = p.resources.filter(r => /^vehicle/.test(r.kind)).map(r => `<tr><th scope="row" class="tMonoS">${esc(r.resource_id)}</th><td>${esc(rName(E, r.name))}</td><td>${esc(t('evx.mode.' + r.kind.split(':')[1]))}</td><td class="tMonoS">${r.trips}</td><td class="tMonoS">${fmt(r.busy_seconds / 60, 0)}</td><td class="tMonoS">${fmt(r.total_wait_seconds / 60, 0)}</td><td class="tMonoS">${r.peak_queue}</td></tr>`).join('');
    const lRows = p.resources.filter(r => r.kind === 'elevator').map(r => `<tr><th scope="row">${esc(rName(E, r.name))}</th><td class="tMonoS">${r.trips}</td><td class="tMonoS">${fmt(r.total_wait_seconds / 60, 0)}</td><td class="tMonoS">${r.peak_queue}</td></tr>`).join('');
    const trW = A().widget(E, t('evx.trT'), t('evx.trCap', { a: T.vehicles_available, b: T.vehicles_total }), O().table(E, ['evx.c.vehicle', 'evx.c.type', 'evx.c.mode', 'evx.c.trips', 'evx.c.busy', 'evx.c.wait', 'evx.c.peak'], vRows)
      + `<h4 class="tLbl">${esc(t('evx.liftsT'))}</h4>` + O().table(E, ['evx.c.lift', 'evx.c.trips', 'evx.c.wait', 'evx.c.peak'], lRows));
    /* the plan, step by step: the patients one by one, the walkers as one line */
    const pat = p.timelines.filter(x => x.transport !== 'none' && !x.stranded).sort((a, b) => a.order - b.order);
    const wk = p.timelines.filter(x => x.transport === 'none' && !x.stranded), wkOut = wk.length ? Math.max(...wk.map(x => x.boarded_at)) / 60 : null;
    const nWalkPat = wk.filter(x => x.patient_id.indexOf('W-') !== 0).length;
    const sRows = pat.map((x, i) => `<tr><td class="tMonoS">${i + 1}</td><th scope="row" class="tMonoS">${esc(x.patient_id)}</th><td>${esc(t('evx.mob.' + x.mobility))}</td><td class="tCap">${esc(nodeName(p, x.origin_node))}</td>
        <td class="tCap">${esc(nodeName(p, x.exit_node))}${x.needs_external_transfer ? ' ' + `<span class="pwchip" data-tone="warn">${esc(t('evx.ext'))}</span>` : ''}</td><td class="tMonoS">${fmt(x.ready_at / 60, 1)}</td><td class="tMonoS">${esc(x.elevator_id || '')}</td>
        ${x.needs_external_transfer ? `<td colspan="3" class="tCap">${esc(t('evx.extWait'))}</td>` : `<td class="tMonoS">${esc(x.vehicle_id)}</td><td class="tMonoS">${fmt(x.boarded_at / 60, 1)}</td><td class="tMonoS">${esc(x.facility_id)}</td>`}</tr>`).join('');
    const stepW = A().widget(E, t('evx.stepT'), t('evx.stepCap3', { w: wk.length, q: nWalkPat, m: wkOut == null ? t('evx.noneVal') : fmt(wkOut, 1), o: hm(E, K.out) }), O().table(E, ['evx.c.order', 'evx.c.bed', 'evx.c.mob', 'evx.c.from', 'evx.c.exit', 'evx.c.ready', 'evx.c.lift', 'evx.c.vehicle', 'evx.c.departs', 'evx.c.to'], sRows, 'evx.noPatients'));
    /* the planner's deterministic briefing, from the plan's own figures */
    const B = X().templateBriefing(p), modes = Object.keys(B.modes).filter(m => m !== 'none');
    const brief = `<div class="evxbrief"><p><b>${esc(t(K.tr == null ? 'evx.b.head2None' : 'evx.b.head2', { n: B.evacuated, o: hm(E, K.out), c: hm(E, K.tr) }))}</b></p>
      <p>${esc(t(modes.length ? 'evx.b.sit2' : 'evx.b.sit2None', { p: B.patients, m: modes.map(m => B.modes[m] + ' ' + t('evx.mode.' + m)).join(t('evx.list.sep')), w: B.modes.none || 0, a: B.vehiclesAvailable, b: B.vehiclesTotal }))}</p>
      <h4 class="tLbl">${esc(t('evx.b.actions'))}</h4><ul>
        <li>${esc(t('evx.b.a1', { p: t('evx.pol.' + B.policy) }))}</li>${B.worstMode ? `<li>${esc(t('evx.b.a2', { m: t('evx.mode.' + B.worstMode), n: B.worstPatients, s: B.worstSeats }))}</li>` : ''}
        ${B.bottleneck ? `<li>${esc(t('evx.b.a3', { r: bnName(E, B.bottleneck), w: fmt(B.bottleneck.total_wait_minutes, 1) }))}</li>` : ''}${B.stranded ? `<li>${esc(t('evx.b.a4', { n: B.stranded }))}</li>` : ''}</ul>
      <h4 class="tLbl">${esc(t('evx.b.risks'))}</h4><ul>${B.stranded ? `<li>${esc(t('evx.b.r1', { n: B.stranded }))}</li>` : ''}${B.bottleneck ? `<li>${esc(t('evx.b.r2', { r: bnName(E, B.bottleneck), q: B.bottleneck.peak_queue }))}</li>` : ''}<li>${esc(t('evx.b.r3'))}</li></ul>
      <h4 class="tLbl">${esc(t('evx.b.verify'))}</h4><ul><li>${esc(t('evx.b.v1'))}</li><li>${esc(t('evx.b.v2'))}</li></ul>
      <p class="tCap">${esc(t('evx.b.by'))}</p></div>`;
    const briefW = A().widget(E, t('evx.briefT'), t('evx.briefCap'), brief);
    const limits = `<ul class="evxlimits">${['staff', 'lifts', 'fire', 'pool', 'graph'].map(k => `<li>${esc(t('evx.lim.' + k))}</li>`).join('')}</ul>`;
    const fireLine = p.fire ? `<p class="opsclaim">${C().icon('flame', 12)} ${esc(t('evx.fireLine', { r: p.fire.origin_name, f: p.fire.floor, n: p.fire.smoke_nodes.length }))}</p>` : `<p class="opsclaim">${esc(t('evx.noFire'))}</p>`;
    const limW = A().widget(E, t('evx.limT'), t('evx.limCap'), limits) + `<p class="tCap">${esc(t('evx.credit'))}</p>`;
    if(asParts) return { hl, lines: `<div class="row gap12 evxlines">${fireLine}${atLine}</div>`, heroes, ctl, cmpW, loW, trW, briefW, stepW, limW };
    return `<section class="evxsec">${hl}${fireLine}${atLine}<div class="pwhero" style="grid-template-columns:repeat(${heroes.length},1fr)">${heroes.join('')}</div>${ctl}
      <div class="secgrid2">${cmpW}${loW}</div><div class="secgrid2">${trW}${briefW}</div>${stepW}
      ${A().widget(E, t('evx.limT'), t('evx.limCap'), limits)}<p class="tCap">${esc(t('evx.credit'))}</p></section>`;
  }

  /* --------------------------------- drills --------------------------------- */
  if(window.EKO_OPS){
    window.EKO_OPS.drill('evxPlan', (E, k) => { const t = E.t.bind(E), s = st(E), p = M().plan(E, optsOf(E, s)), T = p.totals;
      if(k === 'stranded') return { title: t('evx.k.stranded'), body: O().table(E, ['evx.c.bed', 'evx.c.mob', 'evx.c.from', 'evx.c.reason'], p.stranded.map(x => `<tr><th scope="row" class="tMonoS">${esc(x.patient_id)}</th><td>${esc(t('evx.mob.' + x.mobility))}</td><td class="tCap">${esc(nodeName(p, x.node))}</td><td class="tCap">${esc(x.reason)}</td></tr>`).join(''), 'evx.noneStranded'), method: t('evx.m.stranded') };
      if(k === 'people'){ const by = {}; p.snapshotRef.people.forEach(x => { const kk = x.floor + ' · ' + t(x.kind === 'walker' ? 'evx.walker' : x.kind === 'outpatient' ? 'evx.outpatient' : 'evx.mob.' + x.mobility); by[kk] = (by[kk] || 0) + 1; });
        const K = clocks(p); return { title: t('evx.k.asm'), body: `<p class="tCap">${esc(t('evx.k.asmDetail', { p: K.nTr, n: T.patients }))}</p>` + O().table(E, ['evx.c.who', 'evx.c.n'], Object.keys(by).sort().map(k2 => `<tr><th scope="row">${esc(k2)}</th><td class="tMonoS">${by[k2]}</td></tr>`).join('')), method: t('evx.m.people2', { h: E.clockLabel(p.snapshotRef.t) }) }; }
      if(k === 'transport') return { title: t('evx.k.bn'), body: `<p>${esc(p.bottleneck ? t('evx.k.bnCap', { r: bnLine(E, p.bottleneck), w: fmt(p.bottleneck.total_wait_minutes, 0) }) : t('evx.bnl.none'))}</p>`
        + O().table(E, ['evx.c.vehicle', 'evx.c.type', 'evx.c.trips', 'evx.c.wait', 'evx.c.peak'], p.resources.filter(r => r.total_wait_seconds > 0).sort((a, b) => b.total_wait_seconds - a.total_wait_seconds).map(r => `<tr><th scope="row" class="tMonoS">${esc(r.resource_id)}</th><td>${esc(rName(E, r.name))}</td><td class="tMonoS">${r.trips}</td><td class="tMonoS">${fmt(r.total_wait_seconds / 60, 0)}</td><td class="tMonoS">${r.peak_queue}</td></tr>`).join(''), 'evx.bnl.none'), method: t('evx.m.bn2') };
      if(k === 'tr'){ const K = clocks(p); return { title: t('evx.k.tr'), body: `<p>${esc(K.tr == null ? t('evx.k.trNone') : t('evx.k.trCap', { n: K.nTr, v: K.vehicles }))}</p>`, method: t('evx.m.tr') }; }
      if(k === 'crit') return { title: t('evx.k.crit'), body: O().table(E, ['evx.c.bed', 'evx.c.mob', 'evx.c.departs'], p.timelines.filter(x => x.acuity === 'Critical' && !x.stranded).map(x => `<tr><th scope="row" class="tMonoS">${esc(x.patient_id)}</th><td>${esc(t('evx.mob.' + x.mobility))}</td><td class="tMonoS">${fmt(x.boarded_at / 60, 1)}</td></tr>`).join('')), method: t('evx.m.crit') };
      return { title: t('evx.k.out'), body: `<p>${esc(t('evx.k.outCap', { n: T.evacuated - T.stranded }))}</p>`, method: t('evx.m.out') }; });
  }

  /* ---------------------------- replay on the model ---------------------------- */
  /* E6: the replay stays on the Evacuation page. The page becomes the model (no summary column, no toolbar, the alarm level
     isolated) with the evacuation itself in the panel: people out over time, by exit, at the assembly point, waiting for
     transport, the vehicles in use. The dots are coloured by mobility. Leaving the page, or Back to the plan, ends it. */
  let anim = null;
  const outAt = x => x.transport === 'none' ? x.boarded_at : x.ready_at;
  function stopReplay(render){
    routeKey = null;   /* E10: the static routes are drawn again after the replay */
    const E = window.EKO; if(anim){ cancelAnimationFrame(anim.raf); if(E && E.state.dock && anim.prevLevel !== undefined) E.state.dock.level = anim.prevLevel; anim = null; }
    const el = document.getElementById('evxreplay'); if(el) el.remove(); if(E && E.engine && E.engine.setRoutes) E.engine.setRoutes(null); if(E && E.engine && E.engine.setLabels) E.engine.setLabels(null);
    if(E && E.state.evxReplay){ E.state.evxReplay = false; if(render) E.set({}); }
  }
  /* the state of the evacuation at a second of the plan */
  function stateAt(p, sec){
    const ok = p.timelines, r = { inside: 0, asm: 0, wait: 0, gone: 0, byExit: {}, trip: [] };
    ok.forEach(x => { if(x.stranded || outAt(x) > sec){ r.inside++; return; }
      const ex = x.exit_node; r.byExit[ex] = (r.byExit[ex] || 0) + 1;
      if(x.transport === 'none') r.asm++; else if(x.boarded_at > sec) r.wait++; else r.gone++; });
    const v = {}; ok.forEach(x => { if(!x.vehicle_id || x.transport === 'none' || x.stranded || x.boarded_at > sec) return; const back = x.arrives_at != null ? x.boarded_at + 2 * (x.arrives_at - x.boarded_at) : x.boarded_at;
      if(sec < back) v[x.vehicle_id] = 1; });
    r.trip = Object.keys(v).sort(); return r;
  }
  function liveHtml(E, p, sec, end){
    const t = E.t.bind(E), st0 = stateAt(p, sec);
    const n = (k, v, tone) => `<div class="evxn" data-tone="${tone || ''}"><b class="tMonoS">${v}</b><span class="tCap">${esc(t(k))}</span></div>`;
    /* people out of the building over time: the curve to the end, the time so far drawn solid */
    const W = 280, H = 70, total = p.timelines.length || 1, steps = 48, pts = [];
    for(let i = 0; i <= steps; i++){ const ts = end * i / steps; const o = p.timelines.filter(x => !x.stranded && outAt(x) <= ts).length; pts.push([i / steps * W, H - 4 - o / total * (H - 10)]); }
    const cx = Math.min(1, sec / end) * W, line = q => q.map(([x, y]) => x.toFixed(1) + ',' + y.toFixed(1)).join(' ');
    const curve = `<svg class="evxcurve" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t('evx.rp.curve'))}"><polyline class="evxcf" points="${line(pts)}"/><polyline class="evxcs" points="${line(pts.filter(q => q[0] <= cx + 0.01))}"/><line x1="${cx.toFixed(1)}" x2="${cx.toFixed(1)}" y1="2" y2="${H - 2}" class="evxcc"/></svg>`;
    const exits = Object.keys(st0.byExit).sort((a2, b2) => st0.byExit[b2] - st0.byExit[a2]);
    const exRows = exits.map(id => `<li><span class="tCap">${esc(nodeName(p, id))}</span><b class="tMonoS">${st0.byExit[id]}</b></li>`).join('');
    const vRes = p.resources.filter(r2 => /^vehicle/.test(r2.kind)), used = new Set(p.timelines.filter(x => x.vehicle_id && x.transport !== 'none' && x.boarded_at <= sec).map(x => x.vehicle_id));
    const trips = st0.trip.map(id => { const r2 = vRes.find(q => q.resource_id === id); return `<li><span class="tMonoS">${esc(id)}</span> ${esc(r2 ? rName(E, r2.name) : '')}</li>`; }).join('');
    return `<p class="tMonoS evxclock" id="evxclock">${esc(clockTxt(E, sec, end))}</p>
      <div class="evxns">${n('evx.rp.inside', st0.inside, st0.inside ? 'warn' : '')}${n('evx.rp.asm', st0.asm)}${n('evx.rp.wait', st0.wait, st0.wait ? 'warn' : '')}${n('evx.rp.gone', st0.gone)}</div>
      <h4 class="tLbl">${esc(t('evx.rp.curve'))}</h4>${curve}
      <h4 class="tLbl">${esc(t('evx.rp.byExit'))}</h4>${exRows ? `<ul class="evxexits">${exRows}</ul>` : `<p class="tCap">${esc(t('emptyDash'))}</p>`}
      <h4 class="tLbl">${esc(t('evx.rp.veh'))}</h4><p class="tCap">${esc(t('evx.rp.vehCap', { n: st0.trip.length, u: used.size, a: p.totals.vehicles_available }))}</p>
      ${trips ? `<ul class="evxtrips">${trips}</ul>` : `<p class="tCap">${esc(t('evx.rp.none'))}</p>`}`;
  }
  /* E12: the replay plays the level the page shows (the one picked, else the scenario's level, else Level 1: js/evacuation.js levelOf) */
  const pageLv = E => E.state.evacLv || (((E.data.security || {}).evac || {}).scenarioLevel) || 'L1';
  /* E7: one clock. The replay runs to the headline's last figure (All transfers complete, or Everyone out when nobody needs a vehicle), in the headline's own minutes */
  const endOf = p => { const K = clocks(p); return Math.max(1, (K.tr != null ? K.tr : K.out || 0)) * 60; };
  const clockTxt = (E, sec, end) => E.t('evx.rp.clock', { t: fmt(sec / 60, 1), e: fmt(end / 60, 1) });
  /* the page while the replay plays: the model and the evacuation panel */
  function replayView(E){
    const t = E.t.bind(E), s = st(E), p = M().plan(E, optsOf(E, s)), lv = pageLv(E), end = endOf(p), sec = anim ? anim.sec || 0 : 0;
    return window.EKO_V.viewer(E, { markers: false, timeline: false }, '') + C().modShell(E, t('evx.rp.T'), '', '',
      `<div class="evxpanel"><p class="tCap">${esc(t('evx.rp.cap', { l: lv.slice(1) }))}</p><div id="evxlive">${liveHtml(E, p, sec, end)}</div>
        <button class="btnG btnSm" data-act="evxStop">${esc(t('evx.rp.back'))}</button></div>`);
  }
  /* E9: the replay in the Evacuation page's own visual area (the model beside the tabs), and its live figures in the On the model tab */
  function replayVisual(E){
    return `<div class="evxvis">${window.EKO_V.viewer(E, { markers: false, timeline: false }, '')}</div>`;
  }
  function replayPanel(E){
    const t = E.t.bind(E), s = st(E), p = M().plan(E, optsOf(E, s)), lv = pageLv(E), end = endOf(p), sec = anim ? anim.sec || 0 : 0;
    return A().widget(E, t('evx.rp.T'), t('evx.rp.cap', { l: lv.slice(1) }), `<div id="evxlive">${liveHtml(E, p, sec, end)}</div>${stateLegend(E)}<button class="btnG btnSm" data-act="evxStop">${esc(t('evx.rp.back'))}</button>`);
  }
  /* E12: what a dot shows: its colour is how the person moves, its shape what they are doing */
  const stateLegend = E => { const t = E.t.bind(E);
    return `<h4 class="tLbl">${esc(t('evx.st.T'))}</h4><ul class="evxstates">${['walk', 'help', 'lift', 'exit'].map(k => `<li><i class="evxdot" data-m="Ambulatory" data-s="${k}" aria-hidden="true"></i>${esc(t('evx.st.' + k))}</li>`).join('')}</ul>
      <p class="evxleg">${['Bedbound', 'Wheelchair', 'Ambulatory', 'none'].map(m => `<span><i class="evxdot" data-m="${m}" aria-hidden="true"></i>${esc(t('evx.leg.' + m))}</span>`).join('')}</p><p class="tCap">${esc(t('evx.rp.trail'))}</p>`; };
  function startReplay(E){
    const prev = anim ? anim.prevLevel : (E.state.dock || {}).level;
    if(anim){ cancelAnimationFrame(anim.raf); anim = null; }
    const s = st(E), p = M().plan(E, optsOf(E, s)), tracks = M().tracks(p), end = endOf(p);
    const mob = {}; p.timelines.forEach(x => { mob[x.patient_id] = x.transport === 'none' ? 'none' : x.mobility; });
    /* E12: 10x by default (30x and 60x to choose): at 60x most people are out within seconds and no flow can be seen */
    E.state.evxReplay = true; if(![10, 30, 60].includes(E.state.evxSpeed)) E.state.evxSpeed = 10;
    anim = { raf: 0, prevLevel: prev, sec: 0, t0: performance.now(), lastPanel: 0, lv: pageLv(E) };
    E.state.dock.level = anim.lv;
    E.state.pfTab = Object.assign({}, E.state.pfTab || {}, { 'sec-evac': 'model' });   /* E9: the live figures are in the On the model tab */
    if(E.state.pageId !== 'sec-evac') E.go('sec-evac', 'security', 'evac'); else E.set({});
    /* the level on the model: its routes (E10: the walked paths, wider where more people use them), its exits, stairs and lifts */
    const showLevel = (E2, eng, lv) => { E2.state.dock.level = lv; if(eng.isolateLevel) eng.isolateLevel(lv); if(eng.setRoutes) eng.setRoutes(routeSegs(p, lv)); if(eng.setLabels) eng.setLabels(markers(E2, lv)); if(eng.frameLevel) eng.frameLevel(lv); };
    const TRAIL = [1.25, 2.5, 3.75, 5];   /* the trail: where a walking dot was over the last 5 seconds of the plan */
    const frame = () => { const E2 = window.EKO, eng = E2.engine, vp = document.getElementById('vpmain'), host = document.getElementById('enginehost');
      if(!anim) return; anim.raf = requestAnimationFrame(frame);
      if(!eng || !eng.ready || !eng.ready() || !vp || !host) return;
      if(!anim.started){ anim.started = true; anim.t0 = performance.now(); showLevel(E2, eng, anim.lv); }
      /* E12: a level picked while the replay plays: the replay goes on, on that level */
      const lvNow = pageLv(E2); if(lvNow !== anim.lv){ anim.lv = lvNow; showLevel(E2, eng, lvNow); }
      const lv = anim.lv;
      let el = document.getElementById('evxreplay'); if(!el || el.parentNode !== vp){ if(el) el.remove(); el = document.createElement('div'); el.id = 'evxreplay'; vp.appendChild(el); }
      const speed = E2.state.evxSpeed || 10, sec = Math.min(end, (performance.now() - anim.t0) / 1000 * speed), hr = host.getBoundingClientRect(), vr = vp.getBoundingClientRect();
      anim.sec = sec;
      const scr = q => { const sp = eng.worldToScreen({ x: q.x, y: q.y }); return sp.visible ? [sp.x + hr.left - vr.left, sp.y + hr.top - vr.top] : null; };
      const dots = [], trails = [], cnt = { here: 0, other: 0, out: 0 };
      tracks.forEach(tr => { const q = M().placeAt(p, tr, sec); if(!q){ cnt.out++; return; } if(q.floor !== lv){ cnt.other++; return; } cnt.here++; const at = scr(q); if(!at) return; const m = mob[tr.id] || 'none';
        if(q.state === 'walk' && q.seg && q.seg.k === 'walk'){ const pts = [at]; for(const d of TRAIL){ const r = M().placeAt(p, tr, sec - d); if(!r || r.floor !== lv || r.state !== 'walk' || sec - d < 0) break; const a2 = scr(r); if(!a2) break; pts.push(a2); }
          if(pts.length > 1) trails.push(`<polyline data-m="${m}" points="${pts.map(v => v[0].toFixed(1) + ',' + v[1].toFixed(1)).join(' ')}"/>`); }
        dots.push(`<i class="evxdot" data-m="${m}" data-s="${q.state}" style="left:${at[0].toFixed(1)}px;top:${at[1].toFixed(1)}px${q.alpha < 1 ? ';opacity:' + Math.max(0.08, q.alpha).toFixed(2) : ''}"></i>`); });
      const t = E2.t.bind(E2), ck = clockTxt(E2, sec, end); const ce = document.getElementById('evxclock'); if(ce) ce.textContent = ck;
      /* E12: the counts add up to everyone in the plan: on this level (drawn), on other levels, out of the building */
      el.innerHTML = `<svg class="evxtrails" width="${vr.width.toFixed(0)}" height="${vr.height.toFixed(0)}" aria-hidden="true">${trails.join('')}</svg>` + dots.join('')
        + `<div class="evxbar"><b>${esc(t('evx.r.title', { l: lv.slice(1) }))}</b><span class="tMonoS">${esc(ck)}</span><span class="tCap">${esc(t('evx.r.counts', { h: cnt.here, l: lv.slice(1), o: cnt.other, x: cnt.out, n: tracks.length }))}</span>
        <span class="row gap4">${[10, 30, 60].map(v => `<button class="seg" data-act="evxSpeed" data-v="${v}" data-on="${speed === v}">${v}x</button>`).join('')}</span>
        <button class="btnG btnSm" data-act="evxReplay">${esc(t('evx.replay'))}</button><button class="btnG btnSm" data-act="evxStop">${esc(t('evx.r.stop'))}</button>
        <span class="evxleg">${['Bedbound', 'Wheelchair', 'Ambulatory', 'none'].map(m => `<span><i class="evxdot" data-m="${m}"></i>${esc(t('evx.leg.' + m))}</span>`).join('')}</span></div>`;
      /* the panel, ten times a second (E12: so it reads as the bar does) */
      const live = document.getElementById('evxlive'), now = performance.now();
      if(live && (now - anim.lastPanel > 100 || sec >= end)){ anim.lastPanel = now; if(!anim.doneDrawn) live.innerHTML = liveHtml(E2, p, sec, end); if(sec >= end) anim.doneDrawn = true; } };
    anim.raf = requestAnimationFrame(frame);
  }
  const ACTS = {
    evxSet(el){ const E = window.EKO, [k, v] = el.dataset.v.split(':'); E.set({ evx: Object.assign({}, st(E), { [k]: v }) }); },
    evxPick(el){ const E = window.EKO; E.set({ evx: Object.assign({}, st(E), { [el.dataset.k]: el.value }) }); },
    evxReplay(){ startReplay(window.EKO); },
    evxStop(){ stopReplay(true); },
    /* a new speed keeps the time reached */
    evxSpeed(el){ const E = window.EKO, v = +el.dataset.v; if(anim){ anim.t0 = performance.now() - (anim.sec || 0) / v * 1000; } E.state.evxSpeed = v; },
    evxRoom(el){ const E = window.EKO; E.set({ evx: Object.assign({}, st(E), { room: el.value }) }); },
    evxSeed(el){ const E = window.EKO; E.set({ evx: Object.assign({}, st(E), { seed: Math.max(0, Math.round(+el.value || 0)) }) }); },
    evxLifts(el){ const E = window.EKO; E.set({ evx: Object.assign({}, st(E), { liftsOut: !!el.checked }) }); },
    evxExit(el){ const E = window.EKO; E.set({ evx: Object.assign({}, st(E), { exitOut: el.value }) }); }
  };
  /* the scenario at 0:50: the computed plan's Level 2 routes on the model */
  /* E10: the links people use on a level as the 3D draws them: each once, its width from how many take it, an assumed link marked */
  function routeSegs(p, lv){ const U = M().routeUse(p, lv), mx = Math.max(1, ...U.map(u => u.n));
    return U.map(u => ({ pts: u.pts, level: lv, w: +(0.18 + 0.5 * Math.sqrt(u.n / mx)).toFixed(2), assumed: u.assumed, noEnd: true, n: u.n })); }
  /* E11: the ends of the routes on a level: the exits (and the ambulance bay), the stairs and the lifts, each with a short name; the full name is its tooltip */
  function markers(E, lv){
    const t = E.t.bind(E), G = (E.data.security || {}).evacGraph || { nodes: [] }, num = s => ((/(\d+)/.exec(s || '') || [])[1] || '');
    return G.nodes.filter(n => n.floor === lv && (n.type === 'Exit' || n.type === 'Ambulance-Bay' || n.type === 'Stairwell' || n.type === 'Elevator') && n.px != null).map(n => {
      const kind = n.type === 'Stairwell' ? 'stair' : n.type === 'Elevator' ? 'lift' : 'exit';
      const text = n.type === 'Ambulance-Bay' ? t('evx.mk.amb') : kind === 'exit' ? t('evx.mk.exit', { n: num(n.id) }) : t(kind === 'stair' ? 'evx.mk.stair' : 'evx.mk.lift', { n: num(n.name) || num(n.id) });
      return { at: [n.px, n.py], level: lv, kind, text, title: n.name, tone: kind, lift: 1.2 }; });
  }
  /* E10: the model view of the page (not playing): the plan's walked routes on the level, set once per plan and level */
  let routeKey = null;
  function showRoutes(E, lv){
    if(E.state.dock && E.state.dock.level !== lv) E.state.dock.level = lv;
    const key = JSON.stringify(optsOf(E, st(E))) + '|' + lv; if(key === routeKey) return; routeKey = key;
    let n = 0; const go = () => { const eng = E.engine; if(routeKey !== key) return; if(!(eng && eng.ready && eng.ready())){ if(n++ < 80) setTimeout(go, 120); return; }
      if(eng.setRoutes) eng.setRoutes(pageSegs(E, lv)); if(eng.setLabels) eng.setLabels(markers(E, lv)); if(eng.frameLevel && !go.framed){ go.framed = true; eng.frameLevel(lv); } };
    setTimeout(go, 80);
  }
  /* the links of the page's own plan (its order, fire and what-if) on a level, for the 3D */
  const pageSegs = (E, lv) => M() && M().ready(E) ? routeSegs(M().plan(E, optsOf(E, st(E))), lv) : [];
  function scenarioRoutes(E, lv){
    if(!M() || !M().ready(E)) return null;
    const p = M().plan(E, { policy: 'acuity_first', fire: { kind: 'scenario' }, at: 'replay' });
    return { segs: routeSegs(p, lv), plan: p };
  }
  /* E10: the same on the 2D plan (scene pixels): one line per link used, its width from its use; an assumed link dashed and labelled */
  function routeSvg(E, lv, P){
    if(!M() || !M().ready(E)) return ''; const s = st(E), p = M().plan(E, optsOf(E, s)), U = M().routeUse(p, lv), mx = Math.max(1, ...U.map(u => u.n)), t = E.t.bind(E);
    return U.sort((a, b) => a.n - b.n).map(u => { const pts = u.pts.map(P).map(q => q[0].toFixed(1) + ',' + q[1].toFixed(1)).join(' '), w = (2 + 9 * Math.sqrt(u.n / mx)).toFixed(1);
      return `<polyline class="evxroute" data-assumed="${u.assumed ? 1 : 0}" points="${pts}" style="stroke-width:${w}px"><title>${esc(u.assumed ? t('evx.assumedLink', { n: u.n }) : t('evx.routeUse', { n: u.n }))}</title></polyline>`; }).join(''); }
  window.addEventListener && window.addEventListener('hashchange', () => stopReplay(false));
  const replaying = E => !!(E.state.evxReplay && anim);
  return { section, ACTS, CHG: ACTS, startReplay, stopReplay, scenarioRoutes, routeSegs, routeSvg, pageSegs, showRoutes, markers, replayView, replaying, clocks, stateAt, replayVisual, replayPanel };
})();
