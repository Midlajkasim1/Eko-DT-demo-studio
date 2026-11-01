/* ============================================================================
   DEMO SCENARIO REPLAY (D180, screen specs S10, with S1, S2 and S8 parts).
   "Play scenario: fire alarm, Level 2": a scripted, labelled demo timeline that
   plays across Fire (S2), the event workspace (S1), Emergency power (S6) and
   Evacuation (S8). Replay only: nothing is sent to any system, and every view
   it touches says "Demo scenario". Data: security.scenario in the site file.
   - detectors go to pre-alarm and alarm in sequence, the panel follows;
   - the cause and effect check compares the expected outputs with what is
     observed; one expected output (AHU-3&4 (2) stopped) is never observed, so
     the check flags it;
   - cameras are ranked by line of sight to the first detector, from the model
     geometry when the 3D model is loaded, else by distance on the plan;
   - the generator and UPS stay ready; beds needing assistance appear by zone;
     muster counts rise.
   Controls: play, pause, scrub, reset; the presenter bar floats over every page.
   ============================================================================ */
window.EKO_SCN = (function(){
  'use strict';
  const C = () => window.EKO_C, A = () => window.EKO_A;
  const esc = s => C().esc(s), fmt = (v, d) => C().fmt(v, d), icon = (n, s) => C().icon(n, s);
  let E = null, timer = null, startMs = 0, camCache = null;
  const use = E2 => { if(E2) E = E2; return E; };
  const t = (k, p) => E.t(k, p);
  const L = (en, ar) => E.lang === 'ar' ? (ar || en) : en;
  const S = () => ((E && E.data.security) || {}).scenario || null;
  const st = () => E && E.state.scn;
  const on = E2 => { use(E2); return !!(S() && st()); };
  const mmss = s => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
  const at = sec => '+' + mmss(sec);   /* scenario time: the clock has minute resolution, the script runs in seconds */

  /* --------------------------- the state at time t --------------------------- */
  function view(E2){
    use(E2);
    const s = S(), now = st() ? st().t : 0;
    const passed = k => s.steps.filter(x => x.k === k && x.t <= now);
    const devs = s.devices.map((d, i) => { const pre = s.steps.find(x => x.k === 'pre' && x.dev === i), al = s.steps.find(x => x.k === 'alarm' && x.dev === i);
      const state = al && al.t <= now ? 'alarm' : pre && pre.t <= now ? 'pre' : 'normal';
      return Object.assign({}, d, { state, atS: state === 'alarm' ? al.t : state === 'pre' ? pre.t : null, preS: pre ? pre.t : null, alS: al ? al.t : null }); });
    const panelS = (s.steps.find(x => x.k === 'panel') || {}).t;
    /* E4: an output from the engine carries its items, each observed at a time from its point; the row is observed when every item is */
    const outputs = s.outputs.map(o => { if(o.items){ const live = o.items.filter(i => i.state !== 'na'), got = live.filter(i => i.atS != null && i.atS <= now).length;
        const observed = o.missing ? (now >= s.dueS ? 'no' : 'notdue') : got === live.length ? 'yes' : 'notdue';
        return Object.assign({}, o, { observed, atS: observed === 'yes' ? o.outS : null, dueS: s.dueS, got, of: live.length }); }
      const stp = s.steps.find(x => x.k === 'out' && x.out === o.id);
      const mS = (s.steps.find(x => x.k === 'missing') || {}).t, due = mS != null ? mS : panelS != null ? panelS + 15 : 25;
      const observed = o.missing ? (now >= due ? 'no' : 'notdue') : (stp && stp.t <= now ? 'yes' : 'notdue');   /* D182: Observed, Not yet due, Not observed */
      return Object.assign({}, o, { observed, atS: stp ? stp.t : null, dueS: due }); });
    const flag = k => s.steps.some(x => x.k === k && x.t <= now);
    const mS = (s.steps.find(x => x.k === 'muster') || {}).t;
    /* E4: the expected counts are the evacuation plan's people at the assembly point, by exit (js/sim/medical-fire.js) */
    const MX = window.EKO_SIMF && window.EKO_EVACM && window.EKO_EVACM.ready(E) && E.sim ? window.EKO_SIMF.musterFromPlan(window.EKO_EVACM.plan(E, { policy: 'acuity_first', fire: { kind: 'scenario' }, at: 'replay' }), E.sim.cfg) : null;
    const muster = (s.muster || []).map(m0 => { const m = Object.assign({}, m0, { expected: MX ? (MX[m0.id] || 0) : (m0.expected || 0) }); const k = mS == null || now < mS ? 0 : Math.min(1, Math.pow((now - mS) / Math.max(1, s.durS - mS - 5), 0.75));
      const safe = Math.round(m.expected * k * 0.97); return Object.assign({}, m, { safe, unknown: m.expected - safe }); });
    return { now, dur: s.durS, devs, panel: panelS != null && now >= panelS ? 'alarm' : 'normal', panelS, outputs,
      cams: flag('cams'), power: flag('power'), beds: flag('beds'), musterOn: mS != null && now >= mS, muster, zone: s.zone,
      seq: devs.filter(d => d.preS != null && d.preS <= now).map(d => ({ d, k: 'pre', s: d.preS })).concat(devs.filter(d => d.state === 'alarm').map(d => ({ d, k: 'alarm', s: d.alS })))
        .concat(panelS != null && now >= panelS ? [{ k: 'panel', s: panelS }] : []).sort((a, b) => a.s - b.s) };
  }

  /* fire events for the Security module while the scenario plays */
  function fireEvents(E2){
    if(!on(E2)) return [];
    const v = view(E), fz = ((((E.data.security || {}).fire || {}).zones) || []).find(z => z.id === S().zone), zone = fz && fz.dept ? 'z' + fz.dept : 'z02';
    return v.devs.filter(d => d.state !== 'normal').map(d => ({ id: 'scn-' + d.id, src: 'fire', scenario: true, kind: d.state === 'alarm' ? 'alarm' : 'pre', sev: d.state === 'alarm' ? 'critical' : 'high',
      device: d.id, gid: d.gid, storey: d.storey, zone, x: d.x, y: d.y, agoMin: Math.max(0, (v.now - d.atS) / 60),
      en: t(d.kind === 'pull' ? 'scn.ev.pull' : d.state === 'alarm' ? 'scn.ev.smoke' : 'scn.ev.pre', { id: d.id, room: d.room || '' }),
      ar: E.t.call({ lang: 'ar' }, d.kind === 'pull' ? 'scn.ev.pull' : d.state === 'alarm' ? 'scn.ev.smoke' : 'scn.ev.pre', { id: d.id, room: d.roomAr || d.room || '' }) }));
  }
  const panelState = E2 => on(E2) && view(E).panel === 'alarm' ? 'alarm' : null;

  /* ---------------------------- cameras by line of sight ---------------------------- */
  /* ranked to a device: line of sight from the model geometry (the 3D engine), else plan distance */
  function rankCams(E2, dev){
    use(E2);
    const cams = ((E.data.security || {}).cameras || []).filter(c => c.storey === dev.storey && c.gid);
    const eng = E.engine;
    if(eng && eng.losRank && eng.ready && eng.ready()){
      if(camCache && camCache.k === dev.gid) return camCache.v;
      const r = eng.losRank(dev.gid, cams.map(c => c.gid), 30);
      if(r){ const v = { method: 'los', list: r.map(x => Object.assign({}, cams.find(c => c.gid === x.gid), x)).slice(0, 6) }; camCache = { k: dev.gid, v }; return v; }
    }
    const m = (p, q) => Math.hypot((p.x - q.x) * 16.4, (p.y - q.y) * 12.6) / 7.115;   /* plan percent to metres */
    return { method: 'plan', list: cams.map(c => Object.assign({}, c, { dist: m(c, dev), clear: null })).sort((a, b) => a.dist - b.dist).slice(0, 6) };
  }
  function camTable(rk){
    const rows = rk.list.map((c, i) => `<tr><td class="tMonoS">${i + 1}</td><th scope="row"><button class="statlink" data-act="secCam" data-v="${esc(c.id)}">${esc(c.id)}</button></th>
      <td class="tMonoS">${esc(fmt(c.dist, 1))} m</td><td>${c.clear == null ? `<span class="tCap">${esc(t('scn.los.unknown'))}</span>` : `<span class="scnlos" data-ok="${c.clear ? 1 : 0}">${esc(t(c.clear ? 'scn.los.clear' : 'scn.los.blocked', { n: c.walls || 0 }))}</span>`}</td>
      <td>${esc(t(c.online === false ? 'sec.cam.offline' : 'sec.cam.online'))}</td></tr>`).join('');
    return `<div class="mnttblwrap"><table class="mnttbl"><thead><tr><th scope="col">#</th><th scope="col">${esc(t('sec.c.camera'))}</th><th scope="col">${esc(t('scn.c.dist'))}</th><th scope="col">${esc(t('scn.c.los'))}</th><th scope="col">${esc(t('sec.c.state'))}</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="tCap">${esc(t(rk.method === 'los' ? 'scn.los.methodModel' : 'scn.los.methodPlan'))}</p>`;
  }

  /* ------------------------------ S2: fire blocks ------------------------------ */
  function fireBlocks(E2){
    if(!on(E2)) return '';
    const s = S(), v = view(E), widget = (...a) => A().widget(E, ...a);
    const z = (((E.data.security || {}).fire || {}).zones || []).find(x => x.id === s.zone) || {};
    const seq = v.seq.map(x => `<li data-k="${x.k}"><span class="tMonoS">${esc(at(x.s))}</span><span class="scnseqd" data-k="${x.k}" aria-hidden="true"></span>
        <span>${esc(x.k === 'panel' ? t('scn.seq.panel') : t(x.k === 'pre' ? 'scn.seq.pre' : 'scn.seq.alarm', { id: x.d.id, room: L(x.d.room, x.d.roomAr) || '' }))}</span>
        ${x.d ? `<button class="statlink" data-act="scnFly" data-v="${esc(x.d.gid)}">${esc(t('sec.locate'))}</button>` : ''}</li>`).join('');
    const ce = v.outputs.map(o => `<tr data-obs="${o.observed}"><th scope="row">${esc(L(o.en, o.ar))}</th><td>${esc(L(o.expected, o.expectedAr))}</td>
        <td><span class="scnobs" data-obs="${o.observed}">${esc(t('scn.obs.' + o.observed, { at: o.atS != null ? at(o.atS) : '' }))}</span></td><td class="tCap">${esc(o.point)}</td></tr>`).join('');
    const missing = v.outputs.filter(o => o.observed === 'no');
    const first = v.devs.find(d => d.state !== 'normal') || v.devs[0];
    const dts = ((E.data.security || {}).fire || {}).deviceTests || [], MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const tDate = id => { const q = dts.find(x => x.id === id); if(!q || q.monthsAgo == null) return t('emptyDash'); const dd = new Date(E.nowMs()); dd.setMonth(dd.getMonth() - q.monthsAgo); return E.ph(MON[dd.getMonth()]) + ' ' + dd.getFullYear(); };   /* E4: the engine's test record */
    const tests = s.devices.map(d => `<tr><th scope="row" class="tMonoS">${esc(d.id)}</th><td>${esc(L(d.room, d.roomAr) || t('emptyDash'))}</td><td class="tMonoS">${esc(tDate(d.id))}</td><td>${esc(t('scn.test.pass'))}</td></tr>`).join('');
    return `<div class="scnbanner" data-st="${v.panel}">${icon('flame', 16)}<span><b>${esc(L(z.en, z.ar) || s.zone)}</b> · ${esc(t(v.panel === 'alarm' ? 'scn.zoneAlarm' : v.devs.some(d => d.state === 'pre') ? 'scn.zonePre' : 'scn.zoneNormal'))}</span>
        <span class="scnchip">${esc(t('scn.chip'))}</span>${E.engine && E.engine.setZoneVolume ? `<span class="tCap">${esc(t('scn.zoneFloors'))}</span><button class="statlink" data-act="scnZone">${esc(t('scn.showZone'))}</button>` : ''}</div>
      <div class="secgrid2">${widget(t('scn.seqT'), t('scn.seqCap'), seq ? `<ol class="scnseq">${seq}</ol>` : `<p class="alempty">${esc(t('scn.seqNone'))}</p>`)}
        ${widget(t('scn.ceT'), t('scn.ceCap'), `<div class="mnttblwrap"><table class="mnttbl scnce"><thead><tr><th scope="col">${esc(t('scn.c.output'))}</th><th scope="col">${esc(t('scn.c.expected'))}</th><th scope="col">${esc(t('scn.c.observed'))}</th><th scope="col">${esc(t('scn.c.point'))}</th></tr></thead><tbody>${ce}</tbody></table></div>
          ${missing.length ? `<p class="scnflag">${icon('warn', 13)} ${esc(t('scn.ceFlag', { what: missing.map(o => L(o.en, o.ar)).join(', ') }))}</p>` : ''}${missing.length && s.afterWo && v.now >= s.durS ? `<p class="tCap">${esc(t('scn.ceCause', { u: s.afterWo.asset, c: L(s.afterWo.cause, s.afterWo.causeAr), w: s.afterWo.id }))}</p>` : ''}<p class="tCap">${esc(L(s.assumptionEn, s.assumptionAr))}</p>`)}</div>
      ${widget(t('scn.camsT'), t('scn.camsCap', { id: first.id }), v.cams ? camTable(rankCams(E, first)) : `<p class="alempty">${esc(t('scn.camsWait'))}</p>`)}
      ${widget(t('scn.testT'), t('scn.testCap'), `<div class="mnttblwrap"><table class="mnttbl"><thead><tr><th scope="col">${esc(t('sec.c.device'))}</th><th scope="col">${esc(t('sec.c.where'))}</th><th scope="col">${esc(t('scn.c.lastTest'))}</th><th scope="col">${esc(t('scn.c.result'))}</th></tr></thead><tbody>${tests}</tbody></table></div>`)}`;
  }

  /* ------------------------------ S1: event detail ------------------------------ */
  function eventDetail(E2, e){
    use(E2);
    const s = S(); if(!s || !e || e.src !== 'fire') return '';
    const dev = (s.devices || []).find(d => d.id === e.device) || (e.gid ? { gid: e.gid, storey: e.storey, x: e.x, y: e.y, id: e.device } : null);
    if(!dev) return '';
    const p = s.procedure;
    const raised = E.nowMs() - (e.agoMin || 0) * 60000;
    return `<h4 class="tLbl">${esc(t('scn.relCams'))}</h4>${camTable(rankCams(E, dev))}
      <div class="secgrid2"><div><h4 class="tLbl">${esc(L(p.titleEn, p.titleAr))}</h4><ol class="scnproc">${(E.lang === 'ar' ? p.stepsAr : p.stepsEn).map(x => `<li><span class="scnbox" aria-hidden="true"></span>${esc(x)}</li>`).join('')}</ol>
        <p class="tCap">${esc(t('scn.procNote'))}</p><ul class="scndocs">${p.docs.map(d => `<li>${icon('doc', 12)} ${esc(L(d.en, d.ar))}</li>`).join('')}</ul></div>
        <div><h4 class="tLbl">${esc(t('scn.timesT'))}</h4><dl class="secdl"><dt>${esc(t('scn.raised'))}</dt><dd class="tMonoS">${esc(E.clockLabel(raised))}</dd>
          <dt>${esc(t('scn.ackT'))}</dt><dd>${esc(t('scn.ackSource'))}</dd><dt>${esc(t('scn.clearT'))}</dt><dd>${esc(t('scn.notCleared'))}</dd></dl>
          <p class="tCap">${esc(t('scn.notes'))}</p><a class="statlink" href="#" data-act="noop" aria-disabled="true">${esc(t('scn.openFire'))}</a></div></div>`;
  }

  /* ------------------------------ S8: muster panel ------------------------------ */
  function musterPanel(E2){
    use(E2);
    const s = S(); if(!s) return '';
    const v = on(E) ? view(E) : null;
    const MV = (v || view(E)).muster;   /* the expected counts from the evacuation plan, playing or not */
    const rows = (s.muster || []).map((m0, i) => { const r = v && v.musterOn ? v.muster[i] : null, m = MV[i] || m0;
      return `<tr><th scope="row">${esc(L(m.en, m.ar))}</th><td class="tMonoS">${m.expected}</td><td class="tMonoS">${r ? r.safe : t('emptyDash')}</td><td class="tMonoS" data-warn="${r && r.unknown ? 1 : 0}">${r ? r.unknown : t('emptyDash')}</td></tr>`; }).join('');
    return A().widget(E, t('scn.musterT'), t('scn.musterCap'), `<div class="mnttblwrap"><table class="mnttbl"><thead><tr><th scope="col">${esc(t('scn.c.muster'))}</th><th scope="col">${esc(t('scn.c.expected'))}</th><th scope="col">${esc(t('scn.c.safe'))}</th><th scope="col">${esc(t('scn.c.unknown'))}</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="tCap">${esc(v && v.musterOn ? t('scn.musterLive') : t('scn.musterIdle'))}</p>`);
  }
  const zoneOn = E2 => on(E2) && view(E).panel === 'alarm' ? S().zone : null;

  /* ------------------------------ presenter bar ------------------------------ */
  function bar(E2){
    use(E2);
    if(!on(E)) return '';
    const v = view(E), p = st().playing;
    const go = (pg, sub, k) => `<button class="seg" data-act="secGo" data-v="${pg}" data-sub="${sub}" data-on="${E.state.pageId === pg}">${esc(t(k))}</button>`;
    return `<div class="scnbar" role="region" aria-label="${esc(t('scn.chip'))}"><span class="scnchip">${esc(t('scn.chip'))}</span><b class="scnttl">${esc(L(S().titleEn, S().titleAr))}</b>
      <button class="iconbtn icon26" data-act="${p ? 'scnPause' : 'scnPlay'}" aria-label="${esc(t(p ? 'scn.pause' : 'scn.play'))}" data-tip="${esc(t(p ? 'scn.pause' : 'scn.play'))}">${icon(p ? 'pause' : 'play', 13)}</button>
      <input class="scnrange" type="range" min="0" max="${v.dur}" step="1" value="${Math.round(v.now)}" data-chg="scnScrub" aria-label="${esc(t('scn.scrub'))}">
      <span class="tMonoS scntime">${mmss(v.now)} / ${mmss(v.dur)}</span>
      <button class="btnG btnSm" data-act="scnReset">${esc(t('scn.reset'))}</button>
      <span class="row gap2 scnviews">${go('sec', '', 'scn.v.events')}${go('sec-fire', 'fire', 'sec.nav.fire')}${go('sec-power', 'power', 'sec.nav.power')}${go('sec-evac', 'evac', 'sec.nav.evac')}</span>
      <button class="iconbtn icon26" data-act="scnStop" aria-label="${esc(t('scn.stop'))}" data-tip="${esc(t('scn.stop'))}">${icon('x', 13)}</button></div>`;
  }
  function startButton(E2){
    use(E2);
    if(!S() || on(E)) return '';
    return `<button class="btnG btnSm scnstart" data-act="scnStart">${icon('play', 12)} ${esc(t('scn.start'))}</button>`;
  }

  /* -------------------------------- clock -------------------------------- */
  function tick(){
    const E2 = window.EKO; if(!E2 || !E2.state.scn || !E2.state.scn.playing) return;
    const s = S(), before = E2.state.scn.t, now = Math.min(s.durS, before + 0.5);
    E2.state.scn.t = now;
    const crossed = s.steps.filter(x => x.t > before && x.t <= now);
    if(now >= s.durS){ E2.state.scn.playing = false; clearInterval(timer); timer = null; afterWo(E2, true); }
    if(crossed.length || now >= s.durS || Math.floor(now) % 5 === 0 && Math.floor(before) % 5 !== 0){ effects(crossed); E2.set({}); if(window.EKO_SCN3) window.EKO_SCN3.sync(E2); }
    else { const r = document.querySelector('.scnrange'), tm = document.querySelector('.scntime'); if(r) r.value = Math.round(now); if(tm) tm.textContent = mmss(now) + ' / ' + mmss(s.durS); }
  }
  /* replay in the 3D: fly to each detector as it activates; the zone volume shows when the panel goes to alarm */
  function effects(steps){
    const E2 = window.EKO, eng = E2.engine, s = S(); if(!eng) return;
    if(window.EKO_SCN3) return;   /* D182: the model follows the timeline in js/scn3d.js */
    steps.forEach(x => {
      if((x.k === 'alarm' || x.k === 'pre') && eng.flyToGid){ const d = s.devices[x.dev]; eng.flyToGid(d.gid); if(eng.highlightGid) eng.highlightGid(d.gid); }
      if(x.k === 'panel') zone3d(true);
    });
  }
  function zone3d(show){
    const E2 = window.EKO, eng = E2.engine, s = S(); if(!eng || !eng.setZoneVolume) return;
    const z = (((E2.data.security || {}).fire || {}).zones || []).find(q => q.id === s.zone);
    eng.setZoneVolume(show && z ? { spaces: z.spaces, storey: z.storey, color: 'var(--sevCrit)' } : null);
  }
  function stopTimer(){ if(timer){ clearInterval(timer); timer = null; } }
  /* E4: the engine's work order for the fault the check found, raised when the event ends (demo; reversible) */
  function afterWo(E2, add){
    const s = S(), m = E2.data.maintenance; if(!s || !s.afterWo || !m || !Array.isArray(m.wos)) return;
    const i = m.wos.findIndex(w => w.id === s.afterWo.id && w.scenario);
    if(add && i < 0) m.wos.unshift(Object.assign({ openedH: 0, dueH: 4, closedH: null, story: true, scenario: true }, s.afterWo));   /* the P1 target, 4 hours */
    if(!add && i >= 0) m.wos.splice(i, 1);
  }
  /* E7: the bar re-renders on each step of the timeline, so a click could land on a replaced button (two clicks to close); close on the press instead */
  if(typeof document !== 'undefined') document.addEventListener('pointerdown', ev => { const b = ev.target && ev.target.closest && ev.target.closest('[data-act="scnStop"]'); if(b && ev.button === 0){ ev.preventDefault(); ACTS.scnStop(); } }, true);
  const ACTS = {
    scnStart(){ const E2 = use(window.EKO); startMs = E2.nowMs(); camCache = null; E2.state.scn = { t: 0, playing: true }; stopTimer(); timer = setInterval(tick, 500);
      if(window.EKO_SCN3) window.EKO_SCN3.clear(E2); E2.state.secEv = null; E2.go('sec', 'security', null); requestAnimationFrame(() => { if(window.EKO_SCN3) window.EKO_SCN3.sync(E2); }); },   /* D182: on the 3D overview */
    scnPlay(){ const E2 = use(window.EKO); if(!E2.state.scn) return; if(E2.state.scn.t >= S().durS) E2.state.scn.t = 0; E2.state.scn.playing = true; stopTimer(); timer = setInterval(tick, 500); E2.set({}); },
    scnPause(){ const E2 = use(window.EKO); if(E2.state.scn) E2.state.scn.playing = false; stopTimer(); E2.set({}); },
    scnReset(){ const E2 = use(window.EKO); stopTimer(); afterWo(E2, false); camCache = null; startMs = E2.nowMs(); E2.state.scn = { t: 0, playing: false }; zone3d(false); if(E2.engine && E2.engine.highlightGid) E2.engine.highlightGid(null); if(window.EKO_SCN3){ window.EKO_SCN3.clear(E2); } E2.set({}); if(window.EKO_SCN3) window.EKO_SCN3.sync(E2); },
    /* E7: one click closes the scenario and restores every level (the dock and the model) */
    scnStop(){ const E2 = use(window.EKO); if(!E2.state.scn) return; stopTimer(); afterWo(E2, false); if(E2.state.dock) E2.state.dock.level = 'ALL'; if(E2.engine && E2.engine.showAllLevels) E2.engine.showAllLevels(); zone3d(false); if(window.EKO_SCN3) window.EKO_SCN3.clear(E2); if(E2.engine && E2.engine.highlightGid) E2.engine.highlightGid(null); E2.set({ scn: null }); },
    scnScrub(el){ const E2 = use(window.EKO); if(!E2.state.scn) return; const v = +el.value || 0; E2.state.scn.t = v; afterWo(E2, v >= S().durS); if(window.EKO_SCN3){ window.EKO_SCN3.clear(E2); E2.set({}); window.EKO_SCN3.sync(E2); } else { zone3d(view(E2).panel === 'alarm'); E2.set({}); } },
    scnFly(el){ const E2 = use(window.EKO); if(E2.engine && E2.engine.flyToGid){ E2.engine.flyToGid(el.dataset.v); if(E2.engine.highlightGid) E2.engine.highlightGid(el.dataset.v); } },
    scnZone(){ zone3d(true); const E2 = window.EKO; if(E2.engine && E2.engine.isolateLevel){ E2.state.dock.level = 'L2'; } E2.go('sec', 'security', null); }
  };
  return { on, view, fireEvents, panelState, fireBlocks, eventDetail, musterPanel, bar, startButton, rankCams, zoneOn, ACTS, CHG: { scnScrub: ACTS.scnScrub } };
})();
