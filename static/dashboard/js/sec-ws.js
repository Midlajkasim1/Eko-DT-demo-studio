/* ============================================================================
   SECURITY AND LIFE SAFETY: OVERVIEW AND EVENT WORKSPACE (D182, functional spec 1).
   Answers: is the building safe right now; what needs attention first and where;
   what can I see of it.
   - Headline: one sentence, the first thing to look at, or "Nothing needs you".
   - Six tiles (Fire, Access, Cameras, Intrusion, Emergency power, Nurse call), each
     with a state word (Normal, Attention, Alarm), its count and one caption; a tile
     filters the list and the model.
   - Open events, ranked: priority, then the oldest unacknowledged first. Each row:
     type, device, room and level, age, source state.
   - Event workspace (select an event): what, where, since when, the source state;
     the cameras that see the spot ranked by line of sight, the top camera's clip
     playing; the site procedure as a checklist; the link to the source system. The
     model goes to the event's level, isolates it and pulses the device.
   - KPIs, every number a door: open events by priority, oldest unacknowledged, time
     to acknowledge and to clear (median, 30 days), devices offline per system.
   Read only. Acknowledge and clear happen in the source system.
   ============================================================================ */
window.EKO_SECW = (function(){
  'use strict';
  const C = () => window.EKO_C, O = () => window.EKO_OPS, S = () => window.EKO_SEC;
  const esc = s => C().esc(s), fmt = (v, d) => C().fmt(v, d), icon = (n, s) => C().icon(n, s);
  const L = (E, en, ar) => E.lang === 'ar' ? (ar || en) : en;
  const SEVR = { critical: 0, high: 1, medium: 2, low: 3 };
  const SYS = ['fire', 'access', 'cctv', 'intrusion', 'power', 'nurse'];

  /* -------------------------------- the events -------------------------------- */
  /* one shape for every open event: what, device, where, level, origin, source state, position, system */
  function events(E){
    const X = S()._x(E), d = X.D() || {}, out = [];
    X.openEvents().forEach(e => {
      let sys = e.src === 'access' ? 'access' : e.src === 'intrusion' ? 'intrusion' : e.src === 'fire' ? 'fire' : e.a && e.a.fam === 'fire' ? 'fire' : 'access';
      let device = e.device || e.asset || e.door || '', room = '', storey = e.storey || null, gid = e.gid || null, x = e.x, y = e.y, state = 'unacked';
      if(e.src === 'alarm'){ const as = (E.data.assets || []).find(a => a.id === e.asset) || {}; room = L(E, as.level, as.levelAr) || ''; storey = storey || as.floor; gid = gid || as.gid; x = e.a.x; y = e.a.y; state = e.a.ack ? 'acked' : 'unacked';
        const door = (d.doors || []).find(r => r.id === e.asset); if(door){ storey = door.storey; } }
      if(e.src === 'access'){ const door = (d.doors || []).find(r => r.id === e.door) || {}; room = door.en ? L(E, door.en, door.ar).replace(/^[^,]*, /, '') : ''; storey = door.storey; gid = door.gid; x = door.x; y = door.y; state = e.srcState || 'unacked'; }
      if(e.src === 'fire'){ const fe = ((d.fire || {}).events || []).find(q => q.id === e.id) || e;
        const dev = ((d.fire || {}).detectors || []).find(q => q.id === (e.device || fe.device)) || {};
        if(!room) room = L(E, fe.room || dev.roomEn, fe.roomAr || dev.roomAr) || '';
        storey = storey || fe.storey || dev.storey; gid = gid || fe.room || dev.room || fe.gid || dev.gid;
        if(x == null && dev.x != null){ x = dev.x; y = dev.y; }
        state = e.scenario ? 'unacked' : (fe.srcState || 'unacked'); }
      if(e.src === 'intrusion') room = X.zoneName(e.zone);
      room = String(room || '').replace(/^(Level|المستوى) \d+ · /, '');   /* the level is shown on its own */
      if(!room && storey) room = X.storeyName(storey);
      out.push({ id: e.id, raw: e, sys, sev: e.sev, title: X.evTitle(e), device, room, storey, gid, x, y, ageMin: e.agoMin || 0, state, kind: e.kind || (e.a && e.a.type) || '' });
    });
    return out.sort((a, b) => (SEVR[a.sev] - SEVR[b.sev]) || ((a.state === 'unacked' ? 0 : 1) - (b.state === 'unacked' ? 0 : 1)) || (b.ageMin - a.ageMin));
  }

  /* -------------------------------- the tiles -------------------------------- */
  function tiles(E){
    const X = S()._x(E), d = X.D() || {}, t = E.t.bind(E), ev = events(E), on = E.state.secFilter;
    const by = k => ev.filter(e => e.sys === k);
    const fire = by('fire'), fAl = fire.filter(e => e.raw.kind === 'alarm' || (e.raw.a && e.sev === 'critical')), iso = ((d.fire || {}).isolations || []).length;
    const acc = by('access'), rdOff = (d.doors || []).filter(r => r.online === false).length, forced = acc.filter(e => e.raw.kind === 'forced');
    const cams = d.cameras || [], camOff = cams.filter(c => c.online === false).length, recOff = cams.filter(c => c.online !== false && c.recording === false).length;
    const ir = d.intrusion || {}, areas = areasNow(E), inAl = by('intrusion').length, armed = areas.filter(a => a.state === 'armed').length;
    const pw = d.power || {}, g0 = (pw.generators || [])[0] || {}, u0 = (pw.ups || [])[0] || {}, onGen = (pw.ats || []).some(a => a.position !== 'normal'), onBat = (pw.ups || []).some(u => u.battery === 'discharging');
    const nc = (d.nurse || {}).calls || [], oldNc = nc.reduce((m, c) => Math.max(m, c.ageMin), 0);
    const T = [
      { k: 'fire', label: t('sec.k.fire'), tone: fAl.length ? 'alarm' : fire.length || iso ? 'attn' : 'ok', count: String(fAl.length || fire.length), cap: t('sw.t.fire', { a: fAl.length, f: fire.length - fAl.length, i: iso }) },
      { k: 'access', label: t('sec.k.access'), tone: forced.length ? 'alarm' : acc.length || rdOff ? 'attn' : 'ok', count: String(acc.length), cap: t('sw.t.access', { f: forced.length, o: rdOff, r: (d.doors || []).length }) },
      { k: 'cctv', label: t('sec.k.cctv'), tone: camOff || recOff ? 'attn' : 'ok', count: cams.length ? fmt((cams.length - camOff) / cams.length * 100, 0) + '%' : t('emptyDash'), cap: t('sw.t.cctv', { o: camOff, r: recOff }) },
      { k: 'intrusion', label: t('sec.k.intrusion'), tone: inAl ? 'alarm' : (ir.bypassed || []).length ? 'attn' : 'ok', count: armed + ' / ' + areas.length, cap: t('sw.t.intr', { b: (ir.bypassed || []).length }) },
      { k: 'power', label: t('sw.k.power'), tone: onGen || onBat ? 'alarm' : g0.testOverdue || (g0.lastTest && g0.lastTest.result === 'overdue') || (g0.fuelPct != null && g0.fuelPct < (pw.fuelPolicyPct || 70)) ? 'attn' : 'ok',
        count: t(onGen ? 'sw.t.onGen' : 'sw.t.onMains'), cap: t('sw.t.power', { f: g0.fuelPct != null ? fmt(g0.fuelPct, 0) : t('emptyDash'), u: u0.loadPct != null ? fmt(u0.loadPct, 0) : t('emptyDash') }) },
      { k: 'nurse', label: t('sec.k.nurse'), tone: oldNc >= 5 ? 'attn' : 'ok', count: d.nurse ? String(nc.length) : t('emptyDash'), cap: d.nurse ? t('sw.t.nurse', { a: nc.length ? Math.floor(oldNc) + ':' + String(Math.round((oldNc % 1) * 60)).padStart(2, '0') : t('emptyDash') }) : t('ops.st.nc') }];
    return `<div class="opstiles swtiles">${T.map(x => O().tile(E, Object.assign(x, { word: t('ops.word.' + x.tone), act: 'secFilter', v: x.k, on: on === x.k }))).join('')}</div>`;
  }
  /* intrusion areas: a clinic area is disarmed in opening hours and armed after hours */
  function areasNow(E){
    const d = (E.data.security || {}).intrusion || {}, h = new Date(E.nowMs()).getHours(), hrs = d.hours || { open: 7, close: 21 };
    return (d.areas || []).map(a => Object.assign({}, a, { state: a.clinic && (h < hrs.open || h >= hrs.close) ? 'armed' : a.state }));
  }

  /* -------------------------------- the KPIs -------------------------------- */
  function kpis(E){
    const t = E.t.bind(E), ev = events(E), d = (E.data.security || {}), h = ((d.history || {}).events) || [];
    const unack = ev.filter(e => e.state === 'unacked').sort((a, b) => b.ageMin - a.ageMin)[0];
    const tta = O().median(h.map(x => x.ackMin)), ttc = O().median(h.map(x => x.clearMin));
    const off = offline(E), offN = SYS.reduce((s, k) => s + (off[k] || []).length, 0);
    const row = (k, v, cap) => `<div class="swkpi"><span class="tCap">${esc(t(k))}</span><b>${v}</b><span class="tCap">${esc(cap)}</span></div>`;
    return `<div class="swkpis">${row('sw.kpi.open', O().door(E, String(ev.length), 'swOpen'), t('sw.kpi.openCap', { c: ev.filter(e => e.sev === 'critical').length, h: ev.filter(e => e.sev === 'high').length, m: ev.filter(e => e.sev === 'medium').length }))}
      ${row('sw.kpi.oldest', unack ? O().door(E, esc(E.fmtAge(unack.ageMin / 60)), 'swOpen') : esc(t('emptyDash')), unack ? unack.title : t('sw.kpi.noneUnack'))}
      ${row('sw.kpi.tta', tta != null ? O().door(E, fmt(tta, 1) + ' ' + esc(t('nc.min')), 'swTimes') : esc(t('emptyDash')), t('sw.kpi.win30'))}
      ${row('sw.kpi.ttc', ttc != null ? O().door(E, fmt(ttc / 60, 1) + ' ' + esc(t('mnt.hrs')), 'swTimes') : esc(t('emptyDash')), t('sw.kpi.win30'))}
      ${row('sw.kpi.off', O().door(E, String(offN), 'swOff'), t('sw.kpi.offCap'))}</div>`;
  }
  function offline(E){
    const d = E.data.security || {};
    return { cctv: (d.cameras || []).filter(c => c.online === false), access: (d.doors || []).filter(r => r.online === false), fire: [], intrusion: [], power: [], nurse: [] };
  }

  /* -------------------------------- headline, summary -------------------------------- */
  function headline(E){
    if(window.EKO_SCN3 && window.EKO_SCN && window.EKO_SCN.on(E)) return window.EKO_SCN3.headline(E);   /* the demo scenario's headline while it plays */
    const t = E.t.bind(E), ev = events(E);
    if(!ev.length) return O().headline(E, t('sw.hl.quiet', { a: t('emptyDash') }), 'ok');
    const top = ev[0];
    return O().headline(E, t(ev.length === 1 ? 'sw.hl.single' : 'sw.hl.multi', { n: ev.length, e: top.title, w: [top.room, top.storey ? S()._x(E).storeyName(top.storey) : ''].filter(Boolean).join(', ') }), top.sev === 'critical' ? 'alarm' : 'attn', { act: 'secEv', v: top.id });
  }
  function summary(E){
    const t = E.t.bind(E);
    const cones = E.engine && E.engine.setCones ? `<div class="seccones"><label class="row gap6 aiC"><input type="checkbox" data-chg="secCones"${E.state.secCones ? ' checked' : ''}><span>${esc(t('sec.cones'))}</span></label>
      <label class="row gap6 aiC"><input type="checkbox" data-chg="secOcc"${E.state.secOcc ? ' checked' : ''}${E.state.secCones ? '' : ' disabled'}><span>${esc(t('sec.conesOcc'))}</span></label><p class="tCap">${esc(t('sec.conesNote'))}</p></div>` : '';
    /* E13: on the security officer's landing the persona sentence (js/personas.js, at the top of the column) is the headline */
    const perOn = !!(window.EKO_PERSONA && window.EKO_PERSONA.line(E));
    return C().summaryShell(E, t('sec.ovT'), `${perOn ? '' : headline(E)}${tiles(E)}${kpis(E)}${cones}${window.EKO_SCN ? window.EKO_SCN.startButton(E) : ''}`);
  }

  /* -------------------------------- the list and the workspace -------------------------------- */
  function panel(E){
    const t = E.t.bind(E), sel = E.state.secEv && events(E).find(e => e.id === E.state.secEv);
    if(window.EKO_SCN3 && window.EKO_SCN && window.EKO_SCN.on(E)) return C().modShell(E, t('scn.chip'), '', '', window.EKO_SCN3.sidePanel(E));
    if(sel) return C().modShell(E, t('sw.ws.T'), '', '', workspace(E, sel));
    const f = E.state.secFilter, ev = events(E).filter(e => !f || e.sys === f);
    const row = e => `<button class="secev swrow" data-act="secEv" data-v="${esc(e.id)}" data-sev="${esc(e.sev)}">
      <span class="secevdot">${C().sevGlyph(e.sev === 'low' ? 'medium' : e.sev, false, 13)}</span>
      <span class="secevb"><span class="secevt">${esc(e.title)}</span><span class="secevm">${esc([t('sw.sys.' + e.sys), e.device, e.room].filter(Boolean).join(' · '))}</span>
        <span class="swst" data-st="${e.state}">${esc(t('sw.st.' + e.state))}</span></span>
      <span class="tMonoS secevage">${esc(E.fmtAge(e.ageMin / 60))}</span></button>`;
    const body = ev.length ? `<div class="secevs">${ev.map(row).join('')}</div>` : `<p class="alempty">${esc(t(f ? 'sw.noneFiltered' : 'sec.ev.none'))}</p>`;
    return C().modShell(E, t('sec.evT'), '', '', `<div class="alcard"><div class="alcardh"><span class="alcardt">${esc(t('sec.evRanked'))}</span>
        <span class="alcardm">${esc(f ? t('sw.filtered', { k: t('sw.sys.' + f) }) : t('sec.evMeta', { n: ev.length }))}</span>${f ? `<button class="statlink" data-act="secFilter" data-v="">${esc(t('sw.clear'))}</button>` : ''}</div>${body}
        <div class="alfoot">${esc(t('sw.listFoot'))}</div></div>`);
  }
  const CLIPS = { marsa: { GF: 'GF', '1F': '1stF', '2F': '2ndF', '3F': '3rdF', '4F': '4thF', '5F': '5thF', RF: 'RF_CCTV_new' } };
  /* a camera's own clip, set in the Studio's Equipment & Spaces; 'none' is a still frame */
  const own = c => ({ clip: c.clip === 'none' ? null : c.clip, why: c.clip === 'none' ? 'off' : null });
  function clipOf(E, c, i){
    if(c.clip) return own(c).clip;
    const m = CLIPS[E.siteName]; if(m) return m[c.storey] || 'GF';
    return 'V' + (((i || 0) % 7) + 1);
  }
  /* E10 item 15: on the engine's site the clip follows the camera's room type, from what each demo clip shows: V1, V4, V5 and V7 clinical
     (a patient room, a nurse counter, two laboratories), V3 the entrance lobby, V2 reception and waiting with a corridor door, V6 a corridor
     with a nurse station. No clip shows a plant room, so plant and electrical rooms get a corridor clip (the camera outside the room).
     Any other room (a store, an office, a washroom) gets a still frame labelled "No demo clip for this room type". */
  const POOL = { clin: ['V1', 'V4', 'V5', 'V7'], entrance: ['V3', 'V2'], wait: ['V2', 'V3'], corridor: ['V6', 'V2'] };
  function kindOf(E, c){
    const r = c.room || '';
    if(/washroom|toilet|changing/i.test(r)) return null;
    if(/ELEC|M\/E\b|NETWORK|COMMUNICATIONS|\bUPS\b|GENERATOR|PLANT|MECH|CORRIDOR|corridor/i.test(r)) return 'corridor';
    if(/entry|vestibule|lobby|entrance|registration|reception/i.test(r)) return 'entrance';
    const ty = E.sim.typeOf(r); return ty === 'clin' ? 'clin' : ty === 'wait' ? 'wait' : null;
  }
  const hash = s => { let h = 7; for(let k = 0; k < s.length; k++) h = (h * 31 + s.charCodeAt(k)) >>> 0; return h; };
  /* the clip of a camera on its own (a workspace, the scenario corner): the first of its pool, rotated by the camera's ID */
  const pick = (E, c) => { if(c.clip) return own(c).clip; const k = kindOf(E, c); if(!k) return null; const p = POOL[k]; return p[hash(c.id) % p.length]; };
  const engineSite = E => !!(E.sim && E.sim.typeOf);
  /* a grid: no clip the same as the tile before it or the tile above it (cols per row); a camera with no clip left gets a still */
  function clipsFor(E, list, cols){
    const out = new Map(), seq = [];
    list.forEach((c, i) => { if(c.clip){ const a = own(c); seq.push(a.clip); out.set(c.id, a); return; }
      let clip = engineSite(E) ? null : clipOf(E, c, i), why = null;
      if(engineSite(E)){ const k = kindOf(E, c);
        if(!k) why = 'type';
        else { const p = POOL[k], s = hash(c.id) % p.length, near = [seq[i - 1], cols > 1 ? seq[i - cols] : null];
          for(let j = 0; j < p.length && !clip; j++){ const v = p[(s + j) % p.length]; if(!near.includes(v)) clip = v; }
          if(!clip) why = 'repeat'; } }
      seq.push(clip); out.set(c.id, { clip, why }); });
    return out;
  }
  const clipSrc = (E, c, i) => { const v = engineSite(E) ? pick(E, c) : clipOf(E, c, i); return v ? '/static/dashboard/assets/video/' + encodeURIComponent(v) + '.mp4' : ''; };
  const stillKey = a => a.why === 'repeat' ? 'sp.clipRepeat17' : a.why === 'off' ? 'sp.clipOff' : 'sp.clipNone17';
  const stillEl = (E, a) => `<div class="spstill" role="img" aria-label="${C().esc(E.t(stillKey(a)))}"><span>${C().esc(E.t(stillKey(a)))}</span></div>`;
  /* the video element, or the still frame where there is no clip (as) is a grid's assignment, when there is one.
     The handover clips are empty files, so a failed video shows that still instead of a blank tile. */
  function videoEl(E, c, i, attrs, as){
    const a = as || (c.clip ? own(c) : engineSite(E) ? { clip: pick(E, c), why: pick(E, c) ? null : 'type' } : { clip: clipOf(E, c, i) });
    if(!a.clip) return stillEl(E, a);
    const src = '/static/dashboard/assets/video/' + encodeURIComponent(a.clip) + '.mp4';
    return `<video src="${C().esc(src)}" ${attrs} onerror="this.hidden=true;var n=this.nextElementSibling;if(n)n.hidden=false"></video><span hidden>${stillEl(E, a)}</span>`;
  }
  /* cameras that see the spot: line of sight through the model walls when the 3D is loaded, else distance on the plan */
  function seeing(E, e){
    const X = S()._x(E), cams = X.cams().filter(c => c.storey === e.storey);
    if(e.gid && E.engine && E.engine.losRank && E.engine.ready && E.engine.ready()){
      const r = E.engine.losRank(e.gid, cams.filter(c => c.gid).map(c => c.gid), 30);
      if(r) return { method: 'los', list: r.map(x => Object.assign({}, cams.find(c => c.gid === x.gid), x)).slice(0, 5) };
    }
    if(e.x == null) return { method: 'none', list: [] };
    const m = (p, q) => Math.hypot((p.x - q.x) * 16.4, (p.y - q.y) * 12.6) / 7.115;
    return { method: 'plan', list: cams.filter(c => c.x != null).map(c => Object.assign({}, c, { dist: m(c, e), clear: null })).sort((a, b) => a.dist - b.dist).slice(0, 5) };
  }
  const PROC = {
    fire: ['Confirm the zone on the fire panel', 'Check the covering cameras', 'Call the fire service as the site emergency plan says', 'Send the response team to the zone', 'Follow the site emergency plan for evacuation'],
    fault: ['Read the fault on the fire panel', 'Check whether the device is isolated', 'Raise a work order in CAFM if none exists', 'Record the fault in the fire log'],
    forced: ['Check the door on the camera', 'Send security to the door', 'Record the outcome in the access system'],
    held: ['Check the door on the camera', 'Ask the area to close the door, or send security', 'Record the outcome in the access system'],
    tailgate: ['Review the clip at the event time', 'Inform the area manager', 'Record the outcome in the access system'],
    other: ['Check the device on the camera', 'Follow the site procedure for this event', 'Record the outcome in the source system']
  };
  function procKey(e){ const k = e.kind; return e.sys === 'fire' ? (/fault|detFault/.test(k) ? 'fault' : 'fire') : k === 'forced' ? 'forced' : (k === 'held' || k === 'doorHeld') ? 'held' : k === 'tailgate' ? 'tailgate' : 'other'; }
  function workspace(E, e){
    const t = E.t.bind(E), X = S()._x(E), see = seeing(E, e), top = see.list[0];
    const pk = procKey(e), pd = ((E.data.security || {}).procedures || {})[pk], steps = pd ? (E.lang === 'ar' ? pd.stepsAr : pd.stepsEn) : PROC[pk].map(s => t('sw.proc.' + pk + '.' + PROC[pk].indexOf(s)));
    const link = e.sys === 'fire' ? 'sw.link.fire' : e.sys === 'cctv' ? 'sw.link.vms' : e.sys === 'intrusion' ? 'p2.openIntr' : 'sw.link.access';
    const origin = E.nowMs() - e.ageMin * 60000;
    const video = top ? `<div class="swvideo">${videoEl(E, top, X.cams().indexOf(X.cams().find(c => c.id === top.id)), `autoplay muted loop playsinline aria-label="${esc(t('sw.ws.videoAria17', { c: top.id }))}"`)}
        <span class="swvtag">${esc(top.id)}</span></div>` : `<p class="alempty">${esc(t('sw.ws.noCam'))}</p>`;
    const camRows = see.list.map((c, i) => `<tr><td class="tMonoS">${i + 1}</td><th scope="row"><button class="statlink" data-act="secCam" data-v="${esc(c.id)}">${esc(c.id)}</button></th><td class="tMonoS">${c.dist != null ? fmt(c.dist, 1) + ' m' : t('emptyDash')}</td>
        <td>${c.clear == null ? `<span class="tCap">${esc(t('scn.los.unknown'))}</span>` : `<span class="scnlos" data-ok="${c.clear ? 1 : 0}">${esc(t(c.clear ? 'scn.los.clear' : 'scn.los.blocked', { n: c.walls || 0 }))}</span>`}</td></tr>`).join('');
    return `<div class="swws"><button class="statlink swback" data-act="secBack">${icon('chevL', 12)} ${esc(t('sw.ws.back'))}</button>
      <h3 class="swwsT">${esc(e.title)}</h3>
      <dl class="secdl"><dt>${esc(t('sw.ws.what'))}</dt><dd>${esc(t('sw.sys.' + e.sys) + (e.device ? ' · ' + e.device : ''))}</dd>
        <dt>${esc(t('sw.ws.where'))}</dt><dd>${esc([e.room, e.storey ? X.storeyName(e.storey) : ''].filter(Boolean).join(', ') || t('emptyDash'))}</dd>
        <dt>${esc(t('sw.ws.since'))}</dt><dd class="tMonoS">${esc(E.clockLabel(origin) + ' · ' + E.fmtAge(e.ageMin / 60))}</dd>
        <dt>${esc(t('sw.ws.state'))}</dt><dd><span class="swst" data-st="${e.state}">${esc(t('sw.st.' + e.state))}</span></dd></dl>
      <h4 class="tLbl">${esc(t('sw.ws.seeT'))}</h4>${video}
      ${see.list.length ? O().table(E, ['sw.c.rank', 'sec.c.camera', 'scn.c.dist', 'scn.c.los'], camRows) : ''}
      <p class="tCap">${esc(t(see.method === 'los' ? 'scn.los.methodModel' : 'scn.los.methodPlan'))}</p>
      <h4 class="tLbl">${esc(t('sw.ws.procT'))}</h4><ol class="scnproc">${steps.map(s => `<li><span class="scnbox" aria-hidden="true"></span>${esc(s)}</li>`).join('')}</ol>
      <p class="tCap">${esc(t('scn.procNote'))}</p>
      <h4 class="tLbl">${esc(t('sw.ws.timesT'))}</h4><dl class="secdl"><dt>${esc(t('scn.ackT'))}</dt><dd>${esc(t(e.state === 'unacked' ? 'sw.ws.notYet' : 'sw.ws.ackedSrc'))}</dd><dt>${esc(t('scn.clearT'))}</dt><dd>${esc(t('scn.notCleared'))}</dd></dl>
      <p>${O().linkOut(E, link)}</p></div>`;
  }

  /* -------------------------------- the model -------------------------------- */
  /* rule 4: the event's level, isolated, the device pulsing */
  function focus(E, e){
    if(!e || !E.engine) return;
    if(e.storey && E.engine.isolateLevel){ E.state.dock.level = e.storey; }
    requestAnimationFrame(() => { if(e.gid && E.engine.flyToGid){ E.engine.flyToGid(e.gid, 34); if(E.engine.highlightGid) E.engine.highlightGid(e.gid); } else if(e.x != null && E.engine.flyToWorld) E.engine.flyToWorld({ x: e.x, y: e.y });
      /* D182 polish: the isolated level reads as rooms: the event's device and the nearest rooms labelled (the adapter fills rooms by type) */
      if(e.gid && E.engine.setLabels && E.engine.roomsNear){ const near = E.engine.roomsNear(e.gid, 9);
        E.engine.setLabels([{ gid: e.gid, text: e.device || e.title, tone: 'sel', lift: 1.6 }].concat(near.map((r, i) => ({ gid: 'space:' + r.gid, text: r.name, tone: i ? 'room' : 'roomOn', lift: 0.4 })))); } });
  }
  function leave(E){
    const from = E.state.secEvFrom, eng = E.engine;
    if(!E.state.secEv && !from) return;
    E.state.secEv = null; E.state.secEvFrom = null;
    if(!eng) return;
    if(eng.highlightGid) eng.highlightGid(null);
    if(eng.setLabels) eng.setLabels(null);
    if(from && E.state.dock){ E.state.dock.level = from.level; if(eng.isolateLevel) eng.isolateLevel(from.level); }
    if(from && from.view && eng.flyToViewpoint) eng.flyToViewpoint(from.view); else if(eng.resetView) eng.resetView();
  }
  /* the pulse ring at the selected event, drawn in the marker layer */
  function pulse(E){
    const e = E.state.secEv && events(E).find(x => x.id === E.state.secEv);
    if(!e) return '';
    if(e.gid){ const gear = (((E.data.security || {}).fire || {}).detectors || []).find(q => q.id === e.device) || {};
      const alt = gear.gid && gear.gid !== e.gid ? gear.gid : '';
      return `<span class="mk swpulse" data-x="${e.x != null ? e.x : 0}" data-y="${e.y != null ? e.y : 0}" data-bimid="${esc(e.gid)}"${alt ? ` data-alt="${esc(alt)}"` : ''} data-pin="room" aria-hidden="true"></span>`; }
    return e.x != null ? `<span class="mk swpulse" data-x="${e.x}" data-y="${e.y}" aria-hidden="true"></span>` : '';
  }

  /* -------------------------------- drills -------------------------------- */
  function regDrills(){
    const O2 = O(); if(!O2) return;
    O2.drill('swOpen', E => { const t = E.t.bind(E), ev = events(E);
      return { title: t('sw.kpi.open'), body: O2.table(E, ['sw.c.prio', 'sw.c.event', 'sw.c.where', 'sw.c.age', 'sw.c.state'], ev.map(e => `<tr><td>${esc(t('ov3.sev.' + e.sev))}</td><th scope="row">${esc(e.title)}</th><td>${esc(e.room)}</td><td class="tMonoS">${esc(E.fmtAge(e.ageMin / 60))}</td><td>${esc(t('sw.st.' + e.state))}</td></tr>`).join('')),
        method: t('sw.m.open') }; });
    O2.drill('swTimes', E => { const t = E.t.bind(E), h = (((E.data.security || {}).history || {}).events) || [];
      const r = ['critical', 'high', 'medium'].map(p => { const x = h.filter(q => q.prio === p); return `<tr><th scope="row">${esc(t('ov3.sev.' + p))}</th><td class="tMonoS">${x.length}</td><td class="tMonoS">${fmt(O2.median(x.map(q => q.ackMin)), 1)} ${esc(t('nc.min'))}</td><td class="tMonoS">${fmt(O2.median(x.map(q => q.clearMin)) / 60, 1)} ${esc(t('mnt.hrs'))}</td></tr>`; }).join('');
      return { title: t('sw.kpi.times'), body: O2.table(E, ['sw.c.prio', 'mnt.c.n', 'sw.kpi.tta', 'sw.kpi.ttc'], r), method: t('sw.m.times') }; });
    O2.drill('swOff', E => { const t = E.t.bind(E), off = offline(E);
      const r = SYS.flatMap(k => (off[k] || []).map(x => `<tr><td>${esc(t('sw.sys.' + k))}</td><th scope="row" class="tMonoS">${esc(x.id)}</th><td class="tMonoS">${x.offlineSinceMin != null ? esc(E.fmtAge(x.offlineSinceMin / 60)) : t('emptyDash')}</td></tr>`)).join('');
      return { title: t('sw.kpi.off'), body: O2.table(E, ['sw.c.sys', 'sec.c.device', 'sw.c.offFor'], r), method: t('sw.m.off') }; });
  }
  setTimeout(regDrills, 0);

  const ACTS = {
    secFilter(el){ const E = window.EKO, v = el.dataset.v || null; leave(E); E.set({ secFilter: E.state.secFilter === v ? null : v, secEv: null }); },
    secEv(el){ const E = window.EKO, id = el.dataset.v, e = events(E).find(x => x.id === id);
      E.state.dlg = null; E.state.opsDrill = null; E.state.secSel = null;
      if(E.state.pageId !== 'sec') E.go('sec', 'security', null);
      if(!E.state.secEvFrom) E.state.secEvFrom = { level: E.state.dock.level, view: E.engine && E.engine.saveViewpoint ? E.engine.saveViewpoint() : null };
      focus(E, e); E.set({ secEv: id }); },
    secBack(){ const E = window.EKO; leave(E); E.set({}); }
  };
  return { events, tiles, kpis, summary, panel, workspace, pulse, focus, leave, clipOf, clipSrc, clipsFor, videoEl, seeing, areasNow, ACTS };
})();
