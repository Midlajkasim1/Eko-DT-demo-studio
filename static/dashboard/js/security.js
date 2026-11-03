/* ============================================================================
   SECURITY AND LIFE SAFETY (D180, partner demo A3). A top-level module built
   like ESG: an overview over the model (the status of fire, access, CCTV,
   intrusion and emergency power, counts, and the open events ranked) and
   full-width views: Cameras, Access, Fire and life safety, Emergency power,
   and, where the site has bed data from an external hospital system,
   Evacuation (A7). It replaces Systems > Life & Safety and Systems > Security.

   Read only: nothing here writes to a panel, a door, a camera or a generator.
   No control buttons. Vendor neutral wording: "the video system", "the access
   control system", "the fire alarm panel".

   Data: data.security (demo, marked so; handoff/security.md and the
   security.* contracts in handoff/data-contracts.md), plus the site's
   alarms in the fire and security families, which keep their own source.
   The alarm to camera timeline: selecting an access or fire event shows the
   nearest camera (same zone, else same storey) and the event on one
   timeline. The prototype shows a still image placeholder, never video.
   ============================================================================ */
window.EKO_SEC = (function(){
  'use strict';
  const C = () => window.EKO_C, A = () => window.EKO_A;
  const esc = s => C().esc(s), fmt = (v, d) => C().fmt(v, d), icon = (n, s) => C().icon(n, s);
  let E = null;
  /* in the Studio the cameras are real: the linked FIN cameras (default) or every CCTV element of the model */
  let camSetup = null;
  function camerasBySource(){
    const eng = E && E.engine, d = E && E.data.security;
    const setup = eng && eng.cameraSetup ? eng.cameraSetup() : null;
    if(!d || !setup || setup === camSetup) return;
    camSetup = setup;
    d.cameras = (setup.cameras || []).map(c => ({ id: c.name, gid: c.guid, en: c.name, ar: c.name, room: c.room, storey: c.storey, clip: c.clip, recording: c.clip !== 'none' }));
  }
  const use = E2 => { if(E2){ E = E2; camerasBySource(); } return E; };
  const t = (k, p) => E.t(k, p);
  const D = () => (E && E.data.security) || null;
  const L = (en, ar) => E.lang === 'ar' ? (ar || en) : en;
  const SEVR = { critical: 0, high: 1, medium: 2, low: 3 };
  const zoneOf = id => ((D() || {}).zones || []).find(z => z.id === id) || null;
  const zoneName = id => { const z = zoneOf(id); return z ? L(z.en, z.ar) : (id || ''); };
  /* a storey code as people say it: L2 → Level 2, GF → Ground floor, RF → Roof, B1 → Basement 1 */
  const storeyName = s => !s ? '' : /^L\d+$/.test(s) ? E.t('lvlName', { n: s.slice(1) }) : s === 'GF' ? E.t('ov3.fl.GF') : s === 'RF' ? E.t('ov3.fl.RF') : /^B\d+$/.test(s) ? E.t('ov3.fl.B', { n: s.slice(1) }) : E.t('sec.storey', { s });
  const msAgo = min => E.nowMs() - (min || 0) * 60000;
  const clock = ms => E.clockLabel(ms);
  const active = () => !!D();

  /* ------------------------------ derived lists ---------------------------- */
  const cams = () => (D() || {}).cameras || [];
  const doors = () => (D() || {}).doors || [];
  const camOnline = () => cams().filter(c => c.online !== false).length;
  const doorById = id => doors().find(d => d.id === id) || null;
  /* access events with their door's zone and storey */
  const accessEvents = () => (((D() || {}).access || {}).events || []).map(e => { const d = doorById(e.door) || {};
    return Object.assign({ src: 'access', zone: d.zone, storey: d.storey, doorName: d.en ? L(d.en, d.ar) : e.door }, e); });
  const FLAG = ['forced', 'held', 'tailgate'];
  const fireEvents = () => ((((D() || {}).fire) || {}).events || []).map(e => Object.assign({ src: 'fire' }, e))
    .concat(window.EKO_SCN ? window.EKO_SCN.fireEvents(E) : []);   /* D180: the demo scenario's activations while it plays */
  const intrEvents = () => ((((D() || {}).intrusion) || {}).events || []).map(e => Object.assign({ src: 'intrusion' }, e));
  const sevOfEv = e => e.sev || (e.src === 'fire' ? (e.kind === 'alarm' ? 'critical' : 'medium')
    : e.src === 'intrusion' ? 'high' : e.kind === 'forced' ? 'high' : e.kind === 'held' && (e.heldMin || 0) >= 10 ? 'high' : 'medium');
  /* the site's FIN alarms in the fire and security families: they keep their own source */
  const famAlarms = () => (E.data.alarms || []).filter(a => (a.fam === 'fire' || a.fam === 'sec') && !(a.shelved));
  function evTitle(e){
    if(e.src === 'alarm') return E.alarmLines(e.a, true).main;
    if(e.src === 'access') return t('sec.ev.' + e.kind, { door: e.doorName, m: e.heldMin != null ? e.heldMin : '' });
    return L(e.en, e.ar);
  }
  /* every open event, ranked: severity first, then the newest */
  function openEvents(){
    const out = famAlarms().map(a => ({ src: 'alarm', id: a.id, a, sev: a.sev, agoMin: (a.ageH || 0) * 60, asset: a.asset,
      zone: (((D() || {}).assetZone || {})[a.asset]) || null, kind: a.fam === 'fire' ? 'fireAlarm' : 'secAlarm' }));
    const alIds = new Set(famAlarms().map(a => a.id));   /* an access event that is also a FIN alarm shows once, as the alarm */
    accessEvents().filter(e => FLAG.includes(e.kind) && e.open !== false && !(e.alarm && alIds.has(e.alarm))).forEach(e => out.push(Object.assign({}, e, { sev: sevOfEv(e) })));
    fireEvents().filter(e => e.active !== false).forEach(e => { if(!out.some(o => o.asset && o.asset === e.device)) out.push(Object.assign({}, e, { sev: sevOfEv(e) })); });
    intrEvents().filter(e => e.active !== false).forEach(e => out.push(Object.assign({}, e, { sev: sevOfEv(e) })));
    return out.sort((x, y) => (SEVR[x.sev] - SEVR[y.sev]) || (x.agoMin - y.agoMin));
  }
  const findEvent = id => openEvents().concat(accessEvents(), fireEvents(), intrEvents()).find(e => e.id === id) || null;
  /* the nearest camera to an event: same zone, else same storey */
  function nearestCam(e){
    const cs = cams(); if(!cs.length) return null;
    const z = e.zone || (e.door && (doorById(e.door) || {}).zone) || null, st = e.storey || (e.door && (doorById(e.door) || {}).storey) || null;
    return cs.find(c => z && c.zone === z && c.online !== false) || cs.find(c => z && c.zone === z)
      || cs.find(c => st && c.storey === st && c.online !== false) || null;
  }

  /* ------------------------------- status rows ----------------------------- */
  function status(){
    const d = D() || {}, f = d.fire || {}, acc = accessEvents(), fe = fireEvents().filter(e => e.active !== false);
    const fireAl = famAlarms().filter(a => a.fam === 'fire'), faults = fe.filter(e => e.kind === 'fault').length + fireAl.filter(a => !(fe.some(e => e.device === a.asset))).length;
    const firing = fe.filter(e => e.kind === 'alarm').length;
    const iso = (f.isolations || []).length;
    const flagged = acc.filter(e => FLAG.includes(e.kind) && e.open !== false);
    const pw = d.power || {}, gens = pw.generators || [], ups = pw.ups || [], ats = pw.ats || [];
    const ie = intrEvents().filter(e => e.active !== false);
    const sec = famAlarms().filter(a => a.fam === 'sec');
    return [
      { k: 'fire', go: ['sec-fire', 'fire'], tone: firing ? 'crit' : faults || iso ? 'warn' : 'ok',
        v: firing ? t('sec.st.fireAlarm', { n: firing }) : t('sec.st.fireNormal'),
        cap: t('sec.st.fireCap', { f: faults, i: iso, d: f.devices != null ? fmt(f.devices, 0) : t('emptyDash') }) },
      { k: 'access', go: ['sec-access', 'access'], tone: flagged.some(e => sevOfEv(e) === 'high') ? 'warn' : flagged.length ? 'warn' : 'ok',
        v: t('sec.st.doors', { a: doors().filter(x => x.online !== false).length, b: doors().length }),
        cap: t('sec.st.accessCap', { f: flagged.filter(e => e.kind === 'forced').length, h: flagged.filter(e => e.kind === 'held').length, g: flagged.filter(e => e.kind === 'tailgate').length }) },
      { k: 'cctv', go: ['sec-cams', 'cams'], tone: camOnline() < cams().length ? 'warn' : 'ok',
        v: cams().length ? fmt(camOnline() / cams().length * 100, 1) + '%' : t('emptyDash'),
        cap: t('sec.st.camCap', { a: camOnline(), b: cams().length }) },
      { k: 'intrusion', go: ['sec', null], tone: ie.length ? 'warn' : 'ok',
        v: t('sec.st.zonesArmed', { a: (((d.intrusion || {}).zones) || []).filter(z => z.armed).length, b: (((d.intrusion || {}).zones) || []).length }),
        cap: t('sec.st.intrCap', { n: ie.length, d: (d.intrusion || {}).detectors != null ? fmt((d.intrusion || {}).detectors, 0) : t('emptyDash') }) + (sec.length ? ' · ' + t('sec.st.secAlarms', { n: sec.length }) : '') },
      { k: 'power', go: ['sec-power', 'power'], tone: gens.some(g => g.fuelPct != null && g.fuelPct < (pw.fuelPolicyPct || 70)) || ats.some(a => a.position !== 'normal') ? 'warn' : 'ok',
        v: t('sec.st.gens', { a: gens.filter(g => g.ready !== false).length, b: gens.length }),
        cap: t('sec.st.powerCap', { u: ups.filter(u => u.battery !== 'discharging').length, ub: ups.length, s: ats.every(a => a.position === 'normal') ? t('sec.ats.normal') : t('sec.ats.emergency') }) }]
      .concat(d.nurse ? [(() => { const cl = d.nurse.calls || [], old = cl.reduce((m, c) => Math.max(m, c.ageMin), 0);   /* D180: S7 nurse call */
        return { k: 'nurse', go: ['sec-nurse', 'nurse'], tone: old >= 5 ? 'warn' : 'ok', v: t('sec.st.nurse', { n: cl.length }), cap: cl.length ? t('sec.st.nurseCap', { a: Math.floor(old) + ':' + String(Math.round((old % 1) * 60)).padStart(2, '0') }) : t('nc.none') }; })()] : []);
  }

  /* ---------------------------------- views -------------------------------- */
  const sevDot = sev => C().sevGlyph(sev === 'low' ? 'medium' : sev, false, 13);
  function evRow(e){
    const when = E.fmtAge(e.agoMin / 60);
    const src = e.src === 'alarm' ? t('sec.src.alarm') : t('sec.src.' + e.src);
    const where = e.src === 'access' ? zoneName(e.zone) : e.src === 'alarm' ? (E.loc(e.a, 'loc') || e.asset) : (e.zone ? zoneName(e.zone) : storeyName(e.storey));
    return `<button class="secev" data-act="secEv" data-v="${esc(e.id)}" data-sev="${esc(e.sev)}">
      <span class="secevdot">${sevDot(e.sev)}</span>
      <span class="secevb"><span class="secevt">${esc(evTitle(e))}</span><span class="secevm">${esc([where, src].filter(Boolean).join(' · '))}</span></span>
      <span class="tMonoS secevage">${esc(when)}</span></button>`;
  }
  function summary(E2){
    use(E2);
    if(window.EKO_SECW && active()) return window.EKO_SECW.summary(E);   /* D182: the overview to the functional specs */
    if(!active()) return C().summaryShell(E, t('modSecLs'), `<p class="alempty">${esc(t('sec.none'))}</p>`);
    const rows = status().map(r => `<button class="ovk secrow" data-act="secGo" data-v="${esc(r.go[0])}" data-sub="${esc(r.go[1] || '')}">
        <div class="ovkhead"><span class="scdot" data-tone="${r.tone === 'crit' ? 'crit' : r.tone}"></span><span class="ovklbl">${esc(t('sec.k.' + r.k))}</span></div>
        <div class="ovkval"><span class="ovknum secnum">${esc(r.v)}</span></div>
        <div class="ovkcap" data-tone="t3">${esc(r.cap)}</div></button>`).join('');
    /* D180 (S4): view cones on the 3D cameras; the model has no view direction, so angle, depth and direction are assumed */
    const cones = E.engine && E.engine.setCones ? `<div class="seccones"><label class="row gap6 aiC"><input type="checkbox" data-chg="secCones"${E.state.secCones ? ' checked' : ''}><span>${esc(t('sec.cones'))}</span></label>
      <label class="row gap6 aiC"><input type="checkbox" data-chg="secOcc"${E.state.secOcc ? ' checked' : ''}${E.state.secCones ? '' : ' disabled'}><span>${esc(t('sec.conesOcc'))}</span></label>
      <p class="tCap">${esc(t('sec.conesNote'))}</p></div>` : '';
    return C().summaryShell(E, t('sec.ovT'), `<div class="ovklist">${rows}</div>${cones}${window.EKO_SCN ? window.EKO_SCN.startButton(E) : ''}`);
  }
  function panel(E2){
    use(E2);
    if(window.EKO_SECW && active()) return window.EKO_SECW.panel(E);   /* D182: the ranked list, or the event workspace */
    const ev = active() ? openEvents() : [];
    const body = ev.length ? `<div class="secevs">${ev.map(evRow).join('')}</div>` : `<p class="alempty">${esc(t('sec.ev.none'))}</p>`;
    return C().modShell(E, t('sec.evT'), '', '', `<div class="alcard"><div class="alcardh"><span class="alcardt">${esc(t('sec.evRanked'))}</span>
        <span class="alcardm">${esc(t('sec.evMeta', { n: ev.length }))}</span></div>${body}
        <div class="alfoot">${esc(t('sec.evFoot'))}</div></div>`);
  }
  /* the markers of the security landing: cameras, doors and fire devices that carry a position */
  function markers(E2){
    use(E2);
    const d = D(); if(!d) return '';
    const sel = E.state.secSel;
    const pts = [];
    cams().forEach(c => { if(c.gid || (isFinite(+c.x) && isFinite(+c.y) && c.x !== undefined)) pts.push({ id: c.id, gid: c.gid, x: +c.x || 0, y: +c.y || 0, k: 'cam', bad: c.online === false, tip: c.id + ' · ' + L(c.en, c.ar) }); });
    doors().forEach(c => { if(isFinite(+c.x) && isFinite(+c.y) && c.x !== undefined) pts.push({ id: c.id, x: +c.x, y: +c.y, k: 'door', bad: accessEvents().some(e => e.door === c.id && FLAG.includes(e.kind) && e.open !== false), tip: c.id + ' · ' + L(c.en, c.ar) }); });
    /* D180: fire devices in alarm (the demo scenario) are marked; a site with many devices shows only what needs a look:
       flagged doors, offline cameras, the selection, and every camera only with the view cones on */
    fireEvents().filter(e => e.active !== false && e.kind !== 'fault' && isFinite(+e.x) && e.x !== undefined).forEach(e => pts.push({ id: e.device, ev: e.id, x: +e.x, y: +e.y, k: 'fire', bad: true, tip: L(e.en, e.ar) }));
    const fk = E.state.secFilter, fOk = p => !fk || (fk === 'cctv' && p.k === 'cam') || (fk === 'access' && p.k === 'door') || (fk === 'fire' && p.k === 'fire');   /* D182: a tile filters the model */
    for(let q = pts.length - 1; q >= 0; q--) if(!fOk(pts[q])) pts.splice(q, 1);
    const crowded = { cam: cams().length > 60, door: doors().length > 60 };
    const off = !!E.state.secMarksOff;
    const keep = p => p.id === sel || (!off && (!crowded[p.k] || p.bad || (p.k === 'cam' && (E.state.secCones || fk === 'cctv'))));
    for(let q = pts.length - 1; q >= 0; q--) if(!keep(pts[q])) pts.splice(q, 1);
    return `<div class="mklayer secmklayer">${pts.map(p => `<button class="mk secmk" data-x="${p.x}" data-y="${p.y}"${p.gid ? ` data-bimid="${esc(p.gid)}"` : ''} data-k="${p.k}" data-bad="${p.bad ? 1 : 0}" data-sel="${sel === p.id ? 1 : 0}"
        data-act="${p.k === 'cam' ? 'secCam' : p.k === 'fire' ? 'secEv' : 'secDoor'}" data-v="${esc(p.ev || p.id)}" data-tip="${esc(p.tip)}" aria-label="${esc(p.tip)}">${icon(p.k === 'cam' ? 'eye' : p.k === 'fire' ? 'flame' : 'lock', 11)}</button>`).join('')}${window.EKO_SECW ? window.EKO_SECW.pulse(E) : ''}${!off && window.EKO_SCN3 ? window.EKO_SCN3.markers(E) : ''}${!off && window.EKO_EVAC && window.EKO_EVAC.markers ? window.EKO_EVAC.markers(E) : ''}</div>`;
  }
  /* the landing: the summary over the model, the open events in the panel */
  function landing(E2, doc){
    use(E2);
    const model = (doc.widgets || []).find(w => w.type === 'viewer3d') || {};
    const cfg = Object.assign({}, model.config || {}, { markers: false, markToggle: true });
    return window.EKO_V.viewer(E, cfg, located(E) + markers(E) + summary(E)) + (E.state.assetSel ? C().assetPanel(E) : panel(E));
  }
  function located(E2){
    const b = E2.state.secLocated;
    if(!b) return '';
    return `<div class="secloc" role="status"><span>${esc(t('sec.located', { c: b.id }))}</span>
      <button class="btnG btnSm" data-act="secLocatedBack">${icon('chevL', 12)} ${esc(t('back'))}</button></div>`;
  }
  /* A second locate keeps the first one's way back */
  function locatedFrom(E2, id){
    const prev = E2.state.secLocated, eng = E2.engine;
    if(prev) return Object.assign({}, prev, { id });
    return { id, from: { pageId: E2.state.pageId, module: E2.state.module, sub: E2.state.sub }, view: eng && eng.saveViewpoint ? eng.saveViewpoint() : null };
  }

  const widget = (...a) => A().widget(E, ...a), hero = (...a) => A().heroTile(E, ...a);
  const pageWrap = (pg, heroes, inner) => `<div class="pwarea secpage" data-pg="${pg}">${heroes.length ? `<div class="pwhero" style="grid-template-columns:repeat(${heroes.length},1fr)">${heroes.join('')}</div>` : ''}${inner}</div>`;
  const seg = (act, v, lbl, on) => `<button class="seg" data-act="${act}" data-v="${esc(v)}" data-on="${on}" aria-pressed="${on}">${esc(lbl)}</button>`;
  const none = k => `<div class="pwarea"><p class="alempty">${esc(t(k))}</p></div>`;

  /* 1. CAMERAS */
  const PER = 24;
  function camsPage(E2){
    if(window.EKO_SECP && window.EKO_SECP.applies(E2)) return window.EKO_SECP.camsPage(E2);   /* D182: js/sec-pages.js */
    use(E2); if(!active()) return none('sec.none');
    const all = cams(), f = E.state.secCamF || 'all';
    const groups = [...new Set(all.map(c => c.zone || c.storey).filter(Boolean))];
    const list = all.filter(c => f === 'all' || (f === 'offline' ? c.online === false : (c.zone || c.storey) === f));
    const pages = Math.max(1, Math.ceil(list.length / PER)), pg = Math.min(E.state.secCamPg || 0, pages - 1);
    const tile = c => `<article class="seccam" data-off="${c.online === false ? 1 : 0}">
        <div class="seccamimg" aria-hidden="true">${icon('eye', 22)}<span class="tCap">${esc(t('sec.cam.still'))}</span></div>
        <div class="seccamb"><b class="tMonoS">${esc(c.id)}</b><span class="seccamn">${esc(L(c.en, c.ar))}</span>
          <span class="tCap">${esc([c.zone ? zoneName(c.zone) : '', storeyName(c.storey)].filter(Boolean).join(' · '))}</span>
          <span class="seccamst" data-on="${c.online !== false ? 1 : 0}"><span class="secdot"></span>${esc(t(c.online === false ? 'sec.cam.offline' : 'sec.cam.online'))}</span></div>
        <div class="row gap6 seccama"><button class="btnG btnSm" data-act="secCam" data-v="${esc(c.id)}">${esc(t('sec.cam.open'))}</button>
          <button class="btnG btnSm" data-act="secLocate" data-v="${esc(c.id)}" ${isFinite(+c.x) && c.x !== undefined ? '' : `disabled data-tip="${esc(t('sec.notPlaced'))}"`}>${esc(t('sec.locate'))}</button></div></article>`;
    const heroes = [hero(t('sec.cam.rate'), all.length ? fmt(camOnline() / all.length * 100, 1) : t('emptyDash'), '%', t('sec.cam.rateCap', { a: camOnline(), b: all.length })),
      hero(t('sec.cam.offlineT'), String(all.length - camOnline()), '', t('sec.cam.offlineCap')),
      hero(t('sec.cam.totalT'), String(all.length), '', t('sec.cam.totalCap', { n: groups.length }))];
    const filt = `<div class="row gap6 secfilt"><div class="segbox row">${seg('secCamF', 'all', t('fltAll'), f === 'all')}${seg('secCamF', 'offline', t('sec.cam.offline'), f === 'offline')}</div>
      <select class="tlsel" data-chg="secCamSel" aria-label="${esc(t('sec.cam.zoneF'))}"><option value="all">${esc(t('sec.cam.allZones'))}</option>${groups.map(g => `<option value="${esc(g)}"${f === g ? ' selected' : ''}>${esc(zoneOf(g) ? zoneName(g) : storeyName(g))}</option>`).join('')}</select>
      <span class="grow"></span><span class="tCap">${esc(t('sec.cam.count', { a: list.length ? pg * PER + 1 : 0, b: Math.min(list.length, (pg + 1) * PER), n: list.length }))}</span>
      <button class="iconbtn icon26" data-act="secCamPg" data-v="${pg - 1}" ${pg <= 0 ? 'disabled' : ''} aria-label="${esc(t('sec.prev'))}">${C().dicon('start', 12)}</button>
      <button class="iconbtn icon26" data-act="secCamPg" data-v="${pg + 1}" ${pg >= pages - 1 ? 'disabled' : ''} aria-label="${esc(t('sec.next'))}">${C().dicon('end', 12)}</button></div>`;
    return pageWrap('sec-cams', heroes, (window.EKO_P2 ? window.EKO_P2.coverage(E) : '') + widget(t('sec.cam.T'), t('sec.cam.cap'), filt + `<div class="seccams">${list.slice(pg * PER, (pg + 1) * PER).map(tile).join('')}</div>`, t('sec.src.video')));
  }

  /* 2. ACCESS */
  function accessPage(E2){
    if(window.EKO_SECP && window.EKO_SECP.applies(E2)) return window.EKO_SECP.accessPage(E2);
    use(E2); if(!active()) return none('sec.none');
    const ev = accessEvents(), acc = (D() || {}).access || {};
    const k = kk => ev.filter(e => e.kind === kk).length;
    const heroes = [hero(t('sec.acc.events'), fmt((acc.grantedToday || 0) + (acc.deniedToday || 0), 0), '', t('sec.acc.eventsCap', { g: fmt(acc.grantedToday || 0, 0), d: fmt(acc.deniedToday || 0, 0) })),
      hero(t('sec.acc.forced'), String(k('forced')), '', t('sec.acc.todayCap'), k('forced') ? t('sec.flag') : '', 'warn'),
      hero(t('sec.acc.held'), String(k('held')), '', t('sec.acc.todayCap'), k('held') ? t('sec.flag') : '', 'warn'),
      hero(t('sec.acc.tail'), String(k('tailgate')), '', t('sec.acc.todayCap'), k('tailgate') ? t('sec.flag') : '', 'warn')];
    const byDoor = doors().map(d => { const de = ev.filter(e => e.door === d.id);
      return { d, n: de.length, f: de.filter(e => e.kind === 'forced').length, h: de.filter(e => e.kind === 'held').length, g: de.filter(e => e.kind === 'tailgate').length }; })
      .filter(r => r.n || r.d.online === false).sort((a, b) => (b.f + b.h + b.g) - (a.f + a.h + a.g) || b.n - a.n);
    const flag = n => n ? `<span class="secflag">${n}</span>` : `<span class="cT3">0</span>`;
    const doorRows = byDoor.map(r => `<tr><th scope="row"><span class="tMonoS">${esc(r.d.id)}</span> <span class="tCap">${esc(L(r.d.en, r.d.ar))}</span></th><td>${esc(zoneName(r.d.zone) || storeyName(r.d.storey))}</td>
        <td class="tMonoS">${r.n}</td><td>${flag(r.f)}</td><td>${flag(r.h)}</td><td>${flag(r.g)}</td><td class="tCap">${esc(t(r.d.online === false ? 'sec.cam.offline' : 'sec.cam.online'))}</td></tr>`).join('');
    const zones = [...new Set(doors().map(d => d.zone || d.storey))];
    const zoneRows = zones.map(z => { const ze = ev.filter(e => (e.zone || e.storey) === z);
      return `<tr><th scope="row">${esc(zoneOf(z) ? zoneName(z) : storeyName(z))}</th><td class="tMonoS">${doors().filter(d => (d.zone || d.storey) === z).length}</td><td class="tMonoS">${ze.length}</td>
        <td>${flag(ze.filter(e => e.kind === 'forced').length)}</td><td>${flag(ze.filter(e => e.kind === 'held').length)}</td><td>${flag(ze.filter(e => e.kind === 'tailgate').length)}</td></tr>`; }).join('');
    const recent = ev.slice().sort((a, b) => a.agoMin - b.agoMin).slice(0, 14).map(e => `<button class="secev" data-act="secEv" data-v="${esc(e.id)}" data-sev="${esc(FLAG.includes(e.kind) ? sevOfEv(e) : 'low')}">
        <span class="tMonoS secevage">${esc(clock(msAgo(e.agoMin)))}</span><span class="secevb"><span class="secevt">${esc(evTitle(e))}</span><span class="secevm">${esc(zoneName(e.zone) || storeyName(e.storey))}</span></span>
        ${FLAG.includes(e.kind) ? `<span class="secflag">${esc(t('sec.k.' + e.kind))}</span>` : `<span class="tCap">${esc(t('sec.k.' + e.kind))}</span>`}</button>`).join('');
    const th = (...ks) => ks.map(x => `<th scope="col">${esc(t(x))}</th>`).join('');
    return pageWrap('sec-access', heroes,
      `<div class="secgrid2">${widget(t('sec.acc.byDoor'), t('sec.acc.byDoorCap'), `<div class="mnttblwrap"><table class="mnttbl"><thead><tr>${th('sec.c.door', 'sec.c.zone', 'sec.c.events', 'sec.k.forced', 'sec.k.held', 'sec.k.tailgate', 'sec.c.state')}</tr></thead><tbody>${doorRows || `<tr><td colspan="7" class="alempty">${esc(t('sec.acc.noneToday'))}</td></tr>`}</tbody></table></div>`, t('sec.src.accessFoot'))}
        ${widget(t('sec.acc.recent'), t('sec.acc.recentCap'), `<div class="secevs">${recent || `<p class="alempty">${esc(t('sec.acc.noneToday'))}</p>`}</div>`)}</div>`
      + widget(t('sec.acc.byZone'), '', `<div class="mnttblwrap"><table class="mnttbl"><thead><tr>${th('sec.c.zone', 'sec.c.doors', 'sec.c.events', 'sec.k.forced', 'sec.k.held', 'sec.k.tailgate')}</tr></thead><tbody>${zoneRows}</tbody></table></div>`, t('sec.src.accessFoot')));
  }

  /* 3. FIRE AND LIFE SAFETY */
  function firePage(E2){
    if(window.EKO_SECP && window.EKO_SECP.applies(E2)) return window.EKO_SECP.firePage(E2);
    use(E2); if(!active()) return none('sec.none');
    const f = (D() || {}).fire || {}, fe = fireEvents(), fal = famAlarms().filter(a => a.fam === 'fire');
    const alarmsAct = fe.filter(e => e.kind === 'alarm' && e.active !== false);
    const faults = fe.filter(e => e.kind === 'fault' && e.active !== false);
    const finFaults = fal.filter(a => !faults.some(e => e.device === a.asset));
    const iso = f.isolations || [];
    const heroes = [hero(t('sec.fire.active'), String(alarmsAct.length), '', t('sec.fire.activeCap'), alarmsAct.length ? t('sec.flag') : '', 'crit'),
      hero(t('sec.fire.faults'), String(faults.length + finFaults.length), '', t('sec.fire.faultsCap')),
      hero(t('sec.fire.iso'), String(iso.length), '', t('sec.fire.isoCap')),
      hero(t('sec.fire.devices'), f.devices != null ? fmt(f.devices, 0) : t('emptyDash'), '', t('sec.fire.devicesCap', { n: (f.panels || []).length }))];
    const scnP = window.EKO_SCN && window.EKO_SCN.panelState(E);
    const panels = (f.panels || []).map(p0 => Object.assign({}, p0, scnP ? { status: scnP } : {})).map(p => `<tr><th scope="row"><span class="tMonoS">${esc(p.id)}</span> <span class="tCap">${esc(L(p.en, p.ar))}</span></th>
        <td><span class="secpst" data-st="${esc(p.status)}"><span class="secdot"></span>${esc(t('sec.panel.' + p.status))}</span></td><td class="tMonoS">${esc(String(p.zones != null ? p.zones : t('emptyDash')))}</td>
        <td class="tMonoS">${esc(p.devices != null ? fmt(p.devices, 0) : t('emptyDash'))}</td><td class="tCap">${esc(p.noteEn ? L(p.noteEn, p.noteAr) : '')}</td></tr>`).join('');
    const evList = list => list.map(e => `<div class="secfrow"><button class="secev" data-act="secEv" data-v="${esc(e.id)}" data-sev="${esc(sevOfEv(e))}"><span class="secevdot">${sevDot(sevOfEv(e))}</span>
        <span class="secevb"><span class="secevt">${esc(L(e.en, e.ar))}</span><span class="secevm">${esc([e.device, zoneName(e.zone) || storeyName(e.storey)].filter(Boolean).join(' · '))}</span></span><span class="tMonoS secevage">${esc(E.fmtAge(e.agoMin / 60))}</span></button>
        <button class="btnG btnSm" data-act="secLocate" data-v="${esc(e.device || '')}" ${posOf(e.device) ? '' : `disabled data-tip="${esc(t('sec.notPlaced'))}"`}>${esc(t('sec.locate'))}</button></div>`).join('');
    const finRows = finFaults.map(a => `<div class="secfrow"><button class="secev" data-act="secEv" data-v="${esc(a.id)}" data-sev="${esc(a.sev)}"><span class="secevdot">${sevDot(a.sev)}</span>
        <span class="secevb"><span class="secevt">${esc(E.alarmLines(a, true).main)}</span><span class="secevm">${esc(a.asset + ' · ' + t('sec.src.alarm'))}</span></span><span class="tMonoS secevage">${esc(E.fmtAge(a.ageH))}</span></button>
        <button class="btnG btnSm" data-act="secLocate" data-v="${esc(a.asset)}" ${posOf(a.asset) ? '' : `disabled data-tip="${esc(t('sec.notPlaced'))}"`}>${esc(t('sec.locate'))}</button></div>`).join('');
    const isoRows = iso.map(i => `<tr><th scope="row">${esc(zoneName(i.zone) || storeyName(i.storey) || i.zone)}</th><td class="tMonoS">${esc(i.device || t('emptyDash'))}</td>
        <td class="tCap">${esc(L(i.reasonEn, i.reasonAr))}</td><td class="tCap">${esc(E.person(i.byRole || ''))}</td><td class="tMonoS">${esc(E.fmtAge(i.agoH || 0))}</td></tr>`).join('');
    const th = (...ks) => ks.map(x => `<th scope="col">${esc(t(x))}</th>`).join('');
    return pageWrap('sec-fire', heroes, (window.EKO_SCN ? window.EKO_SCN.fireBlocks(E) : '') +
      widget(t('sec.fire.panels'), t('sec.fire.panelsCap'), `<div class="mnttblwrap"><table class="mnttbl"><thead><tr>${th('sec.c.panel', 'sec.c.state', 'sec.c.zones', 'sec.c.devices', 'sec.c.note')}</tr></thead><tbody>${panels || `<tr><td colspan="5" class="alempty">${esc(t('sec.fire.noPanel'))}</td></tr>`}</tbody></table></div>`, t('sec.src.fireFoot'))
      + `<div class="secgrid2">${widget(t('sec.fire.alarmsT'), '', alarmsAct.length ? evList(alarmsAct) : `<p class="alempty">${esc(t('sec.fire.noAlarms'))}</p>`)}
        ${widget(t('sec.fire.faultsT'), '', (faults.length || finFaults.length) ? evList(faults) + finRows : `<p class="alempty">${esc(t('sec.fire.noFaults'))}</p>`)}</div>`
      + widget(t('sec.fire.isoT'), t('sec.fire.isoTCap'), iso.length ? `<div class="mnttblwrap"><table class="mnttbl"><thead><tr>${th('sec.c.zone', 'sec.c.device', 'sec.c.reason', 'sec.c.by', 'sec.c.since')}</tr></thead><tbody>${isoRows}</tbody></table></div>` : `<p class="alempty">${esc(t('sec.fire.noIso'))}</p>`));
  }

  /* 4. EMERGENCY POWER */
  function powerPage(E2){
    if(window.EKO_SECP && window.EKO_SECP.applies(E2)) return window.EKO_SECP.powerPage(E2);
    use(E2); if(!active()) return none('sec.none');
    const pw = (D() || {}).power || {}, gens = pw.generators || [], ups = pw.ups || [], ats = pw.ats || [], pol = pw.fuelPolicyPct || 70;
    const heroes = [hero(t('sec.pw.gens'), t('sec.st.gens', { a: gens.filter(g => g.ready !== false).length, b: gens.length }), '', t('sec.pw.gensCap')),
      hero(t('sec.pw.fuel'), gens.length ? fmt(Math.min(...gens.map(g => g.fuelPct)), 0) : t('emptyDash'), gens.length ? '%' : '', t('sec.pw.fuelCap', { p: pol })),
      hero(t('sec.pw.ups'), String(ups.length), '', t('sec.pw.upsCap', { n: ups.filter(u => u.battery === 'discharging').length })),
      hero(t('sec.pw.ats'), ats.length ? t(ats.every(a => a.position === 'normal') ? 'sec.ats.normal' : 'sec.ats.emergency') : t('emptyDash'), '', t('sec.pw.atsCap', { n: ats.length }))];
    const bar = (p, low) => `<span class="mntbar secfuel"><span style="width:${Math.max(0, Math.min(100, p)).toFixed(0)}%" data-low="${low ? 1 : 0}"></span></span>`;
    const th = (...ks) => ks.map(x => `<th scope="col">${esc(t(x))}</th>`).join('');
    const gRows = gens.map(g => `<tr><th scope="row"><span class="tMonoS">${esc(g.id)}</span> <span class="tCap">${esc(L(g.en, g.ar))}</span></th>
        <td>${esc(t('sec.run.' + (g.run || 'standby')))}</td><td><span class="row gap6 aiC">${bar(g.fuelPct, g.fuelPct < pol)}<span class="tMonoS">${fmt(g.fuelPct, 0)}%</span></span></td>
        <td><span class="secres" data-r="${esc((g.lastTest || {}).result || '')}">${esc(g.lastTest ? t('sec.test.' + g.lastTest.result) : t('emptyDash'))}</span></td>
        <td class="tCap">${esc(g.lastTest ? t('sec.pw.testWhen', { d: g.lastTest.agoD, l: g.lastTest.loadPct != null ? g.lastTest.loadPct : t('emptyDash') }) : t('emptyDash'))}</td></tr>`).join('');
    const uRows = ups.map(u => `<tr><th scope="row"><span class="tMonoS">${esc(u.id)}</span> <span class="tCap">${esc(L(u.en, u.ar))}</span></th>
        <td><span class="row gap6 aiC">${bar(u.loadPct, u.loadPct > 80)}<span class="tMonoS">${fmt(u.loadPct, 0)}%</span></span></td>
        <td>${esc(t('sec.bat.' + (u.battery || 'float')))}</td><td class="tMonoS">${esc(u.runtimeMin != null ? t('mnt.minV', { v: u.runtimeMin }) : t('emptyDash'))}</td><td class="tCap">${esc(u.noteEn ? L(u.noteEn, u.noteAr) : '')}</td></tr>`).join('');
    const aRows = ats.map(a => `<tr><th scope="row"><span class="tMonoS">${esc(a.id)}</span> <span class="tCap">${esc(L(a.en, a.ar))}</span></th>
        <td><span class="secpst" data-st="${a.position === 'normal' ? 'normal' : 'alarm'}"><span class="secdot"></span>${esc(t(a.position === 'normal' ? 'sec.ats.normal' : 'sec.ats.emergency'))}</span></td>
        <td class="tCap">${esc(a.lastTransferAgoD != null ? t('sec.pw.lastTransfer', { d: a.lastTransferAgoD }) : t('emptyDash'))}</td></tr>`).join('');
    const place = pw.placeEn ? `<p class="tCap secplace">${esc(L(pw.placeEn, pw.placeAr))}</p>` : '';
    return pageWrap('sec-power', heroes, place
      + widget(t('sec.pw.genT'), t('sec.pw.genTCap'), `<div class="mnttblwrap"><table class="mnttbl"><thead><tr>${th('sec.c.unit', 'sec.c.run', 'sec.c.fuel', 'sec.c.test', 'sec.c.when')}</tr></thead><tbody>${gRows || `<tr><td colspan="5" class="alempty">${esc(t('sec.pw.none'))}</td></tr>`}</tbody></table></div>`, t('sec.src.power'))
      + `<div class="secgrid2">${widget(t('sec.pw.upsT'), '', `<div class="mnttblwrap"><table class="mnttbl"><thead><tr>${th('sec.c.unit', 'sec.c.load', 'sec.c.battery', 'sec.c.runtime', 'sec.c.note')}</tr></thead><tbody>${uRows || `<tr><td colspan="5" class="alempty">${esc(t('sec.pw.none'))}</td></tr>`}</tbody></table></div>`)}
        ${widget(t('sec.pw.atsT'), '', `<div class="mnttblwrap"><table class="mnttbl"><thead><tr>${th('sec.c.unit', 'sec.c.position', 'sec.c.when')}</tr></thead><tbody>${aRows || `<tr><td colspan="3" class="alempty">${esc(t('sec.pw.none'))}</td></tr>`}</tbody></table></div>`)}</div>`);
  }

  /* ------------------------------ dialogs ---------------------------------- */
  function posOf(id){
    if(!id) return null;
    const c = cams().find(x => x.id === id) || doors().find(x => x.id === id) || ((D() || {}).fire && ((D().fire.deviceList) || []).find(x => x.id === id));
    if(c && isFinite(+c.x) && c.x !== undefined) return { x: +c.x, y: +c.y };
    const a = (E.data.alarms || []).find(x => x.asset === id && isFinite(+x.x) && x.x !== undefined);
    return a ? { x: +a.x, y: +a.y } : null;
  }
  const dlgShell = (title, inner, cls) => `<div class="scrim" data-act="closeDlg"></div><div class="dlg secdlg ${cls || ''}" role="dialog" aria-label="${esc(title)}">
      <div class="dgmhead"><h3>${esc(title)}</h3><button class="iconbtn msA" data-act="closeDlg" aria-label="${esc(t('close'))}">${icon('x', 13)}</button></div>
      <div class="secdlgbody">${inner}</div></div>`;
  const still = c => `<div class="seccamimg secbig" aria-hidden="true">${icon('eye', 30)}<span class="tCap">${esc(t('sec.cam.still'))}</span>${c && c.online === false ? `<span class="secoff">${esc(t('sec.cam.offline'))}</span>` : ''}</div>`;
  /* one timeline: the camera's recording band, the event, and the other events in the same zone */
  function timeline(e, c){
    const evMs = msAgo(e.agoMin), from = evMs - 10 * 60000, to = Math.min(E.nowMs(), evMs + 10 * 60000) > evMs ? Math.min(E.nowMs(), evMs + 10 * 60000) : evMs + 60000;
    const W = 560, X = ms => 16 + (ms - from) / (to - from) * (W - 32);
    const ticks = []; for(let m = Math.ceil(from / 300000) * 300000; m <= to; m += 300000) ticks.push(m);
    const others = accessEvents().concat(fireEvents(), intrEvents()).filter(o => o.id !== e.id && ((o.zone && o.zone === e.zone) || (!o.zone && o.storey && o.storey === e.storey)))
      .map(o => ({ o, ms: msAgo(o.agoMin) })).filter(x => x.ms >= from && x.ms <= to);
    const rec = c && c.online !== false;
    return `<svg class="sectl" viewBox="0 0 ${W} 78" role="img" aria-label="${esc(t('sec.tl.aria'))}">
      <text x="16" y="14" class="sectlt">${esc(t('sec.tl.cam'))}</text>
      <rect x="16" y="20" width="${W - 32}" height="10" rx="3" class="sectlrec" data-on="${rec ? 1 : 0}"/>
      <text x="16" y="46" class="sectlt">${esc(t('sec.tl.events'))}</text>
      <line x1="16" y1="58" x2="${W - 16}" y2="58" class="sectlax"/>
      ${ticks.map(m => `<line x1="${X(m).toFixed(1)}" y1="54" x2="${X(m).toFixed(1)}" y2="62" class="sectlax"/><text x="${X(m).toFixed(1)}" y="75" text-anchor="middle" class="sectlt">${esc(clock(m))}</text>`).join('')}
      ${others.map(x => `<circle cx="${X(x.ms).toFixed(1)}" cy="58" r="4" class="sectlo"/>`).join('')}
      <line x1="${X(evMs).toFixed(1)}" y1="18" x2="${X(evMs).toFixed(1)}" y2="62" class="sectlev"/><circle cx="${X(evMs).toFixed(1)}" cy="58" r="6" class="sectlevd"/></svg>`;
  }
  function eventDialog(id){
    const e = findEvent(id); if(!e) return '';
    const ev = e.src === 'alarm' ? Object.assign({}, e, { zone: e.zone || (((D() || {}).assetZone || {})[e.asset]) || null }) : e;
    const c = nearestCam(ev);
    const where = ev.src === 'access' ? zoneName(ev.zone) : ev.src === 'alarm' ? (E.loc(ev.a, 'loc') || ev.asset) : (zoneName(ev.zone) || storeyName(ev.storey));
    const camLine = c ? `<p class="tCap">${esc(t(c.zone && c.zone === ev.zone ? 'sec.near.zone' : 'sec.near.storey', { id: c.id }))}</p>` : `<p class="tCap">${esc(t('sec.near.none'))}</p>`;
    const meta = `<dl class="secdl"><dt>${esc(t('sec.c.source'))}</dt><dd>${esc(ev.src === 'alarm' ? t('sec.src.alarm') : t('sec.src.' + ev.src))}</dd>
      <dt>${esc(t('sec.c.when'))}</dt><dd class="tMonoS">${esc(clock(msAgo(ev.agoMin)))}</dd><dt>${esc(t('sec.c.where'))}</dt><dd>${esc(where || t('emptyDash'))}</dd>
      ${ev.src === 'alarm' && ev.a.ack ? `<dt>${esc(t('ov3.eq.ackT'))}</dt><dd>${esc(t('ov3.eq.ackBy', { t: ev.a.ack.time || '', who: E.person(ev.a.ack.who) }))}</dd>` : ''}</dl>`;
    const acts = `<div class="row gap6 secacts">${c ? `<button class="btnG btnSm" data-act="secCam" data-v="${esc(c.id)}">${esc(t('sec.cam.open'))}</button>` : ''}
      ${ev.asset || ev.device ? `<button class="btnG btnSm" data-act="openAsset" data-asset="${esc(ev.asset || ev.device)}">${esc(t('details'))}</button>` : ''}</div>`;
    return dlgShell(evTitle(ev), `<div class="secgrid2 secdlggrid"><div>${still(c)}${camLine}</div><div>${meta}${acts}</div></div>
      <h4 class="tLbl">${esc(t('sec.tl.T'))}</h4>${timeline(ev, c)}<p class="tCap">${esc(t('sec.tl.note'))}</p>${window.EKO_SCN ? window.EKO_SCN.eventDetail(E, ev) : ''}`, 'secdlgev');
  }
  function camDialog(id){
    const c = cams().find(x => x.id === id); if(!c) return '';
    const near = openEvents().filter(e => (e.zone && e.zone === c.zone) || (!e.zone && e.storey && e.storey === c.storey)).slice(0, 5);
    return dlgShell(c.id + ' · ' + L(c.en, c.ar), `${still(c)}<dl class="secdl"><dt>${esc(t('sec.c.where'))}</dt><dd>${esc([c.zone ? zoneName(c.zone) : '', storeyName(c.storey)].filter(Boolean).join(' · '))}</dd>
      <dt>${esc(t('sec.c.state'))}</dt><dd>${esc(t(c.online === false ? 'sec.cam.offline' : 'sec.cam.online'))}</dd>${c.gid ? `<dt>${esc(t('sec.c.gid'))}</dt><dd class="tMonoS">${esc(c.gid)}</dd>` : ''}</dl>
      <h4 class="tLbl">${esc(t('sec.cam.nearEv'))}</h4>${near.length ? `<div class="secevs">${near.map(evRow).join('')}</div>` : `<p class="alempty">${esc(t('sec.cam.noEv'))}</p>`}
      ${E.engine && E.engine.viewFromCamera && c.gid ? `<button class="btnG btnSm" data-act="secCamView" data-v="${esc(c.gid)}">${esc(t('sec.cam.view3d'))}</button><p class="tCap">${esc(t('sec.cam.view3dNote'))}</p>` : ''}
      <p class="tCap">${esc(t('sec.cam.viewNote'))}</p>`, 'secdlgcam');
  }
  function dialog(E2){
    use(E2);
    const k = E.state.secDlg || {};
    if(k.kind === 'ev') return eventDialog(k.id);
    if(k.kind === 'cam') return camDialog(k.id);
    if(k.kind === 'evac' && window.EKO_EVAC) return window.EKO_EVAC.dialog(E, k.id);
    return '';
  }

  /* --------------------------------- actions -------------------------------- */
  const ACTS = {
    secGo(el){ const E2 = window.EKO; E2.go(el.dataset.v, 'security', el.dataset.sub || null); },
    secEv(el){ if(window.EKO_SECW) return window.EKO_SECW.ACTS.secEv(el); window.EKO.set({ born: 'dlg', dlg: 'sec', secDlg: { kind: 'ev', id: el.dataset.v } }); },   /* D182: the event workspace */
    secCam(el){ const E2 = window.EKO; if(window.EKO_SECP && window.EKO_SECP.applies(E2)) return E2.set({ born: 'dlg', dlg: 'ops', secDlg: null, opsDrill: { key: 'spCam', arg: el.dataset.v } });   /* D182: the camera detail */
      E2.set({ born: 'dlg', dlg: 'sec', secDlg: { kind: 'cam', id: el.dataset.v } }); },
    secDoor(el){ const E2 = window.EKO; use(E2); const ev = accessEvents().filter(e => e.door === el.dataset.v).sort((a, b) => a.agoMin - b.agoMin)[0];
      if(ev) E2.set({ born: 'dlg', dlg: 'sec', secDlg: { kind: 'ev', id: ev.id } }); else E2.go('sec-access', 'security', 'access'); },
    secCamF(el){ const E2 = window.EKO; E2.set({ secCamF: el.dataset.v, secCamPg: 0 }); },
    secCones(el){ window.EKO.set({ secCones: !!el.checked }); },
    /* the camera's fixed viewpoint in the 3D (Security overview, the camera's level open) */
    secCamView(el){ const E2 = window.EKO; const gid = el.dataset.v; E2.state.dlg = null; E2.state.secDlg = null; E2.go('sec', 'security', null);
      requestAnimationFrame(() => { const lv = E2.engine.viewFromCamera(gid); if(lv){ E2.state.dock.level = lv; E2.set({}); } }); },
    secOcc(el){ window.EKO.set({ secOcc: !!el.checked }); },
    secCamSel(el){ const E2 = window.EKO; E2.set({ secCamF: el.value, secCamPg: 0 }); },
    secCamPg(el){ const E2 = window.EKO; E2.set({ secCamPg: Math.max(0, +el.dataset.v || 0) }); },
    /* Locate in 3D: the landing over the model, the item framed and marked */
    secLocate(el){ const E2 = window.EKO; use(E2); const id = el.dataset.v, p = posOf(id), cam = cams().find(c => c.id === id); if(!p && !(cam && cam.gid)) return;
      if(cam && cam.gid) E2.state.secLocated = locatedFrom(E2, id);
      E2.state.dlg = null; E2.state.secDlg = null; E2.state.secSel = id; E2.go('sec', 'security', null);
      requestAnimationFrame(() => requestAnimationFrame(() => { const eng = E2.engine, host = document.getElementById('enginehost');
        if(!eng || !host) return;
        if(cam && cam.gid && eng.cameraSetup && eng.flyToGid){ eng.flyToGid(cam.gid); if(eng.highlightGid) eng.highlightGid(cam.gid); return; }
        const r = host.getBoundingClientRect();
        if(eng.frameRect) eng.frameRect([p], { left: r.width * 0.35, top: 40, width: r.width * 0.5, height: r.height - 160 }, { scale: 1.8 }); })); },
    secMarksShow(){ const E2 = window.EKO; E2.set({ secMarksOff: !E2.state.secMarksOff }); },
    secLocatedBack(){ const E2 = window.EKO, b = E2.state.secLocated, eng = E2.engine; if(!b) return;
      if(eng && eng.highlightGid) eng.highlightGid(null);
      E2.state.secLocated = null; E2.state.secSel = null;
      if(b.from.pageId !== E2.state.pageId){ E2.go(b.from.pageId, b.from.module, b.from.sub); return; }
      if(b.view && eng && eng.flyToViewpoint) eng.flyToViewpoint(b.view); else if(eng && eng.resetView) eng.resetView();
      E2.set({}); }
  };
  /* D182: the internals the overview and event workspace build on (js/sec-ws.js) */
  const _x = E2 => { use(E2); return { D, cams, doors, accessEvents, fireEvents, intrEvents, famAlarms, zoneName, storeyName, evTitle, sevOfEv, findEvent, openEvents, nearestCam, status, markers, posOf }; };
  /* E13: the counts the security officer's headline and Brief read: open events (and the high ones), the fire state, the cameras online */
  function counts(E2){ use(E2); const ev = openEvents(), st = status(), fire = st.find(r => r.k === 'fire') || {};
    return { open: ev.length, high: ev.filter(e => e.sev === 'critical' || e.sev === 'high').length, top: ev[0] || null, topTitle: ev[0] ? evTitle(ev[0]) : '', fireTone: fire.tone, fireV: fire.v, camOn: camOnline(), cams: cams().length }; }
  return { active, summary, panel, landing, locatedFrom, camsPage, accessPage, firePage, powerPage, dialog, ACTS, openEvents, nearestCam, status, counts, _x };
})();
