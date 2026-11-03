/* ============================================================================
   EVACUATION AND PATIENT STATUS (D180, partner demo A7). Security and life
   safety > Evacuation, shown only where the site has bed data
   (security.evac; the Demo Medical Centre). Beds are the model's 24 nurse
   call bed connectors, named by the treatment station each one serves; a
   bed is occupied, free or needs assistance. Bed IDs only: no patient
   names and no medical details, ever. The status comes from an external
   hospital system; in the prototype it is demo data and the header says
   so. The route is drawn on the Level 1 plan from the treatment area to the
   nearest exit vestibule (schematic, read only).
   ============================================================================ */
window.EKO_EVAC = (function(){
  'use strict';
  const C = () => window.EKO_C, A = () => window.EKO_A;
  const esc = s => C().esc(s), fmt = (v, d) => C().fmt(v, d), icon = (n, s) => C().icon(n, s);
  let E = null;
  const t = (k, p) => E.t(k, p);
  const L = (en, ar) => E.lang === 'ar' ? (ar || en) : en;
  /* E1: the beds now from the building data engine; while the demo scenario plays, the beds at its replay hour (security.evac.scenarioBeds) */
  const withScn = ev => (window.EKO_SCN && window.EKO_SCN.on(E) && ev.scenarioBeds) ? Object.assign({}, ev, { beds: (ev.beds || []).map(b => Object.assign({}, b, ev.scenarioBeds.find(x => x.id === b.id) || {})) }) : ev;
  const D = () => { const ev = ((E && E.data.security) || {}).evac || null; return ev ? withScn(ev) : null; };
  const bedsNow = E2 => { E = E2; return (D() || {}).beds || []; };
  const ST = ['occ', 'isolated', 'free', 'cleaning', 'closed'];   /* the hospital system's bed status codes (HL7 v2 table 0116); assistance is a separate flag */
  /* the Level 1 panel of the plan image, in the image's own pixels (assets/scene/med-scene.svg) */
  const IMG = { w: 1640, h: 1260, crop: [40, 66, 760, 590] };

  /* D182: one level at a time; the level's panel of the plan image (security.coverage.levelBox), else the Level 1 crop */
  function cropOf(lv){
    const b = (((E.data.security || {}).coverage || {}).levelBox || {})[lv];
    return b ? [b[0] / 100 * IMG.w, b[1] / 100 * IMG.h, b[2] / 100 * IMG.w, b[3] / 100 * IMG.h] : IMG.crop;
  }
  const routesOf = (ev, lv) => (ev.routes && ev.routes.length ? ev.routes.filter(r => r.level === lv) : lv === 'L1' && ev.route ? [ev.route] : []);
  function plan(ev, lv){
    lv = lv || 'L1';
    const [cx, cy, cw, ch] = cropOf(lv), P = p => [p[0] / 100 * IMG.w, p[1] / 100 * IMG.h];
    const sel = E.state.evacBed;
    const dots = (ev.beds || []).filter(b => (b.floor || 'L1') === lv && b.x != null).map(b => { const q = P([b.x, b.y]);
      return `<circle class="evbed" data-st="${esc(b.status)}" data-assist="${b.assist ? 1 : 0}" data-on="${sel === b.id}" cx="${q[0].toFixed(1)}" cy="${q[1].toFixed(1)}" r="${sel === b.id ? 9 : 6.5}"><title>${esc(b.id + ' · ' + t('evac.st.' + b.status) + (b.assist ? ' · ' + t('evac.st.assist') : ''))}</title></circle>`; }).join('');
    /* E10: the plan's own routes, walked through the doors and corridors (js/evac/evac-page.js routeSvg); the old fire strategy lines only where the engine has no plan */
    const walked = window.EKO_EVACP && window.EKO_EVACP.routeSvg ? window.EKO_EVACP.routeSvg(E, lv, P) : '';
    const routes = walked || routesOf(ev, lv).filter(r => r.pts && r.pts.length > 1).map(r => { const pts = r.pts.map(P), ex = pts[pts.length - 1];
      return `<polyline class="evroute" points="${pts.map(q => q[0].toFixed(1) + ',' + q[1].toFixed(1)).join(' ')}"/><circle class="evexit" cx="${ex[0].toFixed(1)}" cy="${ex[1].toFixed(1)}" r="11"><title>${esc(L(r.toEn || r.exitEn, r.toAr || r.exitAr))}</title></circle>`; }).join('');
    const seen = new Set(), pin = (p, cls, name) => { const k = p.x + ',' + p.y; if(seen.has(k + cls)) return ''; seen.add(k + cls); const q = P([p.x, p.y]);
      return `<rect class="${cls}" x="${(q[0] - 7).toFixed(1)}" y="${(q[1] - 7).toFixed(1)}" width="14" height="14" rx="3"><title>${esc(name)}</title></rect>`; };
    const stairs = (ev.stairs || []).filter(s => s.level === lv).map(s => pin(s, 'evstair', s.name)).join('') + (ev.refuge || []).filter(s => s.level === lv).map(s => pin(s, 'evrefuge', t('ev.refuge', { s: s.name }))).join('');
    /* E11: the exits, stairs and lifts the routes end at, each an icon with its short name (the full name in the tooltip) */
    const MK = window.EKO_EVACP && window.EKO_EVACP.markers ? window.EKO_EVACP.markers(E, lv) : [], sc = cw / 100;
    const ICON = { exit: 'M-4 -5 h6 v10 h-6 z M2 0 h4 M4 -2 l2 2 l-2 2', stair: 'M-5 5 h3 v-3 h3 v-3 h3 v-3 h2', lift: 'M-4 -5 h8 v10 h-8 z M-1.5 -1 l1.5 -2 l1.5 2 M-1.5 1 l1.5 2 l1.5 -2' };
    const marks = MK.map(m => { const q = P(m.at), s = Math.max(1.6, sc / 5);
      return `<g class="evmk" data-kind="${m.kind}" transform="translate(${q[0].toFixed(1)} ${q[1].toFixed(1)}) scale(${s.toFixed(2)})"><title>${esc(m.title)}</title><rect x="-8" y="-8" width="16" height="16" rx="3"/><path d="${ICON[m.kind]}"/><text x="11" y="4">${esc(m.text)}</text></g>`; }).join('');
    const img = E.data.planImage || ((E.data.viewer.scene || {}).images || {}).photo || '';
    return `<svg class="evplan" viewBox="${cx.toFixed(0)} ${cy.toFixed(0)} ${cw.toFixed(0)} ${ch.toFixed(0)}" role="img" aria-label="${esc(t('evac.planAria'))}">
      <image href="${esc(img)}" x="0" y="0" width="${IMG.w}" height="${IMG.h}"/>${MK.length ? '' : stairs}${routes}${dots}${marks}</svg>`;
  }

  /* the fire zone state on the same level, and the event timeline (the demo scenario's when it plays) */
  function fireZone(lv){
    const widget = (...a) => A().widget(E, ...a), f = (E.data.security || {}).fire || {}, zid = window.EKO_SCN && window.EKO_SCN.zoneOn(E);
    const zs = (f.zones || []).filter(z => z.storey === lv || z.id === zid);
    const rows = zs.map(z => `<tr><th scope="row">${esc(L(z.en, z.ar))}</th><td><span class="secpst" data-st="${z.id === zid ? 'alarm' : 'normal'}"><span class="secdot"></span>${esc(t(z.id === zid ? 'sec.panel.alarm' : 'sec.panel.normal'))}</span></td></tr>`).join('');
    return widget(t('evac.fzT'), t('evac.fzCap'), `<div class="mnttblwrap"><table class="mnttbl"><tbody>${rows}</tbody></table></div>`);
  }
  function timeline(){
    const widget = (...a) => A().widget(E, ...a), on = window.EKO_SCN && window.EKO_SCN.on(E);
    if(!on) return widget(t('evac.tlT'), '', `<p class="alempty">${esc(t('evac.tlNone'))}</p>`);
    const v = window.EKO_SCN.view(E), ago = s => '+' + Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
    const rows = v.seq.map(x => `<li><span class="tMonoS">${esc(ago(x.s))}</span><span>${esc(x.k === 'panel' ? t('scn.seq.panel') : t(x.k === 'pre' ? 'scn.seq.pre' : 'scn.seq.alarm', { id: x.d.id, room: L(x.d.room, x.d.roomAr) || '' }))}</span></li>`)
      .concat(v.beds ? [`<li><span class="tMonoS">${esc(ago(40))}</span><span>${esc(t('evac.tlBeds'))}</span></li>`] : [])
      .concat(v.musterOn ? [`<li><span class="tMonoS">${esc(ago(45))}</span><span>${esc(t('evac.tlMuster'))}</span></li>`] : []).join('');
    return widget(t('evac.tlT'), t('scn.chip'), `<ol class="evtl">${rows}</ol>`);
  }
  /* the level shown: the one the user picked, else the active scenario's level (story rule), else Level 1 */
  const levelOf = ev => E.state.evacLv || ev.scenarioLevel || 'L1';
  const O2 = () => window.EKO_OPS;
  function page(E2){
    E = E2;
    const ev = D();
    if(!ev) return `<div class="pwarea secpage"><p class="alempty">${esc(t('evac.none'))}</p></div>`;
    if(window.EKO_EVACP && window.EKO_EVACP.replaying(E) && !(window.EKO_FRAME && window.EKO_EVACP.replayVisual)) return window.EKO_EVACP.replayView(E);   /* E6: the replay stays on this page (E9: in its visual area) */
    const lv = levelOf(ev), levels = [...new Set((ev.beds || []).map(b => b.floor || 'L1'))].sort();
    const beds = (ev.beds || []).filter(b => (b.floor || 'L1') === lv), n = s => beds.filter(b => b.status === s).length, nA = beds.filter(b => b.assist).length;
    const hero = (...a) => A().heroTile(E, ...a), widget = (...a) => A().widget(E, ...a), lvName = t('lvlName', { n: lv.slice(1) });
    const nOcc = n('occ') + n('isolated');
    const heroes = [hero(t('evac.h.beds'), String(beds.length), '', t('ev.h.bedsCap', { l: lvName })),
      hero(t('evac.h.occ'), String(nOcc), '', t('evac.h.occCap2', { i: n('isolated') })),
      hero(t('evac.h.free'), String(n('free')), '', t('evac.h.freeCap2', { c: n('cleaning'), x: n('closed') })),
      hero(t('evac.h.assist'), String(nA), '', t('evac.h.assistCap'))];
    const src = `<p class="evsrc">${icon('info', 13)}<span>${esc(L(ev.sourceEn, ev.sourceAr))}</span><span class="evsa">${esc(t('evac.saLabel'))}</span></p>`;
    const lvSeg = `<div class="segbox row evlv">${levels.map(l => `<button class="seg" data-act="evacLv" data-v="${l}" data-on="${l === lv}" aria-pressed="${l === lv}">${esc(t('lvlName', { n: l.slice(1) }))}</button>`).join('')}</div>
      <button class="btnG btnSm" data-act="evac3d" data-v="${lv}">${esc(t('ev.show3d'))}</button>`;
    /* the zones of the level */
    const zl = (ev.zones || []).filter(z => (z.level || 'L1') === lv), zsum = { b: 0, o: 0, f: 0, a: 0 };
    const zones = zl.map(z => { const zb = beds.filter(b => b.zone === z.id), o = zb.filter(b => b.status === 'occ' || b.status === 'isolated').length, f = zb.filter(b => b.status === 'free').length, a = zb.filter(b => b.assist).length;
      zsum.b += zb.length; zsum.o += o; zsum.f += f; zsum.a += a;
      return `<tr><th scope="row">${esc(L(z.en, z.ar))}</th><td class="tMonoS">${zb.length}</td><td class="tMonoS">${o}</td><td class="tMonoS">${f}</td><td class="tMonoS" data-warn="${a ? 1 : 0}">${a}</td></tr>`; }).join('');
    const ztbl = `<div class="mnttblwrap"><table class="mnttbl"><thead><tr>${['evac.c.zone', 'evac.c.beds', 'evac.c.occ', 'evac.c.free', 'evac.c.assist'].map(k => `<th scope="col">${esc(t(k))}</th>`).join('')}</tr></thead><tbody>${zones}</tbody></table></div>`;
    /* rule 8: the numbers agree, or the page says so */
    const sumSt = ST.reduce((s, k) => s + n(k), 0);
    const checks = [[sumSt === beds.length, t('ev.chk.sum', { b: beds.length, s: ST.map(k => n(k)).join(' + ') })], [nA <= nOcc, t('ev.chk.assist', { a: nA, o: nOcc })],
      [zsum.b === beds.length && zsum.o === nOcc && zsum.f === n('free') && zsum.a === nA, t('ev.chk.tiles')]];
    const chk = `<ul class="evchk">${checks.map(([ok, txt]) => `<li data-ok="${ok ? 1 : 0}">${icon(ok ? 'check' : 'alert', 12)}<span>${esc(txt)}</span><b>${esc(t(ok ? 'ev.chk.ok' : 'ev.chk.bad'))}</b></li>`).join('')}</ul>`;
    const order = beds.slice().sort((a, b) => (b.assist ? 1 : 0) - (a.assist ? 1 : 0) || ST.indexOf(a.status) - ST.indexOf(b.status) || a.id.localeCompare(b.id));
    const tiles = order.map(b => `<button class="evtile" data-st="${esc(b.status)}" data-assist="${b.assist ? 1 : 0}" data-on="${E.state.evacBed === b.id}" data-act="evacBed" data-v="${esc(b.id)}" aria-pressed="${E.state.evacBed === b.id}">
        <span class="evdot" aria-hidden="true"></span><span class="tMonoS">${esc(b.id)}</span><span class="tCap">${esc(t('evac.st.' + b.status) + (b.assist ? ' · ' + t('evac.st.assistShort') : ''))}</span></button>`).join('');
    const legend = `<span class="evleg">${ST.map(s => `<span data-st="${s}"><span class="evdot" aria-hidden="true"></span>${esc(t('evac.st.' + s))}</span>`).join('')}<span data-st="assist"><span class="evring" aria-hidden="true"></span>${esc(t('evac.st.assist'))}</span>${window.EKO_EVACP && window.EKO_EVACP.routeSvg ? `<span><i class="evlgw" aria-hidden="true"></i>${esc(t('evx.lg.walked'))}</span><span><i class="evlga" aria-hidden="true"></i>${esc(t('evx.lg.assumed'))}</span>` : `<span class="evlegr"><span class="evline" aria-hidden="true"></span>${esc(t('evac.route'))}</span>`}<span><span class="evstairsw" aria-hidden="true"></span>${esc(t('ev.stairs'))}</span></span>`;
    const rts = routesOf(ev, lv), exitLine = rts.length ? `<p class="tCap">${esc(rts.map(r => t(r.kind === 'stair' ? 'ev.toStair' : 'evac.toExit', { x: L(r.toEn || r.exitEn, r.toAr || r.exitAr) })).join(' '))}</p>` : '';
    const lvNote = ev.levelsEn ? `<p class="tCap">${esc(L(ev.levelsEn, ev.levelsAr))}</p>` : '';
    /* E9: one band at the top (the headline, five tiles, the controls); the bed plan as the visual (the replay plays there); five tabs */
    const X9 = window.EKO_EVACP && window.EKO_EVACP.section(E, true), G = window.EKO_FRAME && window.EKO_FRAME.group;
    if(X9 && G){
      /* E10: the visual is the point of the page: by default the model with the walked routes (the replay plays there too); the plan with
         the same routes one click away. The bed status has its own tab. */
      const lvSegOnly = `<div class="segbox row evlv">${levels.map(l => `<button class="seg" data-act="evacLv" data-v="${l}" data-on="${l === lv}" aria-pressed="${l === lv}">${esc(t('lvlName', { n: l.slice(1) }))}</button>`).join('')}</div>`;
      const routeLegend = `<span class="evleg"><span><i class="evlgw" aria-hidden="true"></i>${esc(t('evx.lg.walked'))}</span><span><i class="evlga" aria-hidden="true"></i>${esc(t('evx.lg.assumed'))}</span><span class="evlgend">${esc(t('evx.lg.ends'))}</span></span>`;
      /* The Studio model is not the evacuation's model. Without setRoutes the picture is the plan. */
      const onModel = !!(E.engine && E.engine.setRoutes);
      const playing = window.EKO_EVACP.replaying(E), view = (playing && onModel) ? 'model' : (E.state.evxView || (onModel ? 'model' : 'plan'));
      const vseg = `<div class="row gap8 evxvbar"><div class="segbox row" role="group" aria-label="${esc(t('evx.view'))}">${['model', 'plan'].map(k => `<button class="seg" data-act="evxView" data-v="${k}" data-on="${view === k}" aria-pressed="${view === k}">${esc(t('evx.view.' + k))}</button>`).join('')}</div>${view === 'plan' ? lvSeg : lvSegOnly}<span class="grow"></span><span class="evxlegs">${view === 'plan' ? legend : routeLegend}</span></div>`;
      const visual = view === 'model' ? vseg + window.EKO_EVACP.replayVisual(E) : vseg + `<div class="evxplanwrap">${plan(ev, lv)}</div>` + exitLine;
      if(view === 'model' && !playing && onModel && window.EKO_EVACP.showRoutes) window.EKO_EVACP.showRoutes(E, lv);
      const assumedT = ((E.data.security.evacGraph || {}).assumed || { kept: [] }).kept;
      const assumedW = widget(t('evx.asmT'), t('evx.asmCap', { n: assumedT.length }), O2().table(E, ['evx.c.space', 'evx.c.joined', 'evx.c.m'], assumedT.map(x => `<tr><th scope="row" class="tCap">${esc(x.a)}</th><td class="tCap">${esc(x.b)}</td><td class="tMonoS">${x.m}</td></tr>`).join(''), 'evx.asmNone'));
      return `<div class="pwarea secpage evxpage" data-pg="sec-evac">${X9.hl}<div class="pwhero evxstrip" style="grid-template-columns:repeat(${X9.heroes.length},1fr)">${X9.heroes.join('')}</div><div data-frame="top">${X9.ctl}</div>`
        + `<div data-frame="visual">${visual}</div>`
        + G('model', t('evx.tab.model'), (playing ? window.EKO_EVACP.replayPanel(E) : '') + X9.lines + `<p class="tCap">${esc(t('evx.modelCap'))}</p>` + timeline())
        + G('beds', t('evx.tab.beds'), `<div class="pwhero" style="grid-template-columns:repeat(${heroes.length},1fr)">${heroes.join('')}</div>${chk}` + widget(t('evac.zoneT'), t('evac.zoneCap'), ztbl)
          + widget(t('evac.bedsT'), t('evac.bedsCap', { f: lvName }), `<div class="evtiles">${tiles}</div><p class="tCap">${esc(t('evac.privacy'))}</p>${lvNote}<p class="tCap">${esc(L(ev.codesNoteEn, ev.codesNoteAr))}</p>`)
          + fireZone(lv) + (window.EKO_SCN ? window.EKO_SCN.musterPanel(E) : ''))
        + G('step', t('evx.tab.step'), X9.stepW + X9.briefW)
        + G('transport', t('evx.tab.transport'), X9.trW + X9.loW)
        + G('orders', t('evx.tab.orders'), X9.cmpW)
        + G('limits', t('evx.tab.limits'), X9.limW + assumedW + src) + `</div>`;
    }
    return `<div class="pwarea secpage" data-pg="sec-evac">${src}${window.EKO_EVACP ? window.EKO_EVACP.section(E) : ''}<h3 class="evxh3">${esc(t('evx.bedsT'))}</h3><div class="row gap8 evlvrow">${lvSeg}</div><div class="pwhero" style="grid-template-columns:repeat(${heroes.length},1fr)">${heroes.join('')}</div>${chk}
      <div class="secgrid2">${widget(t('ev.planT', { l: lvName }), t('ev.planCap'), plan(ev, lv) + legend + exitLine)}
        ${widget(t('evac.zoneT'), t('evac.zoneCap'), ztbl)}</div>
      ${widget(t('evac.bedsT'), t('evac.bedsCap', { f: lvName }), `<div class="evtiles">${tiles}</div><p class="tCap">${esc(t('evac.privacy'))}</p>${lvNote}<p class="tCap">${esc(L(ev.codesNoteEn, ev.codesNoteAr))}</p>`)}
      <div class="secgrid2">${fireZone(lv)}${window.EKO_SCN ? window.EKO_SCN.musterPanel(E) : ''}</div>${timeline()}</div>`;
  }
  /* the beds of the level shown in 3D (js/security.js marker layer), outside the demo scenario */
  function markers(E2){
    E = E2; const ev = D(), lv = E.state.evac3d;
    if(!ev || !lv || (window.EKO_SCN && window.EKO_SCN.on(E))) return '';
    return (ev.beds || []).filter(b => (b.floor || 'L1') === lv && b.x != null).map(b => `<span class="mk s3bed" data-st="${esc(b.status)}" data-assist="${b.assist ? 1 : 0}" data-x="${b.x}" data-y="${b.y}" data-tip="${esc(b.id + ' · ' + t('evac.st.' + b.status) + (b.assist ? ' · ' + t('evac.st.assist') : ''))}"></span>`).join('');
  }

  /* S7: nurse call on the 24 bed connectors. Calls by bed and room with type and age; response by unit and by hour. No patient data. */
  function nursePage(E2){
    E = E2;
    const n0 = (E.data.security || {}).nurse, ev = D();
    if(!n0 || !ev) return `<div class="pwarea secpage"><p class="alempty">${esc(t('evac.none'))}</p></div>`;
    /* E9: outside clinic hours on a demo site the page shows the unit at the replay hour (11:30), and says so (the rule Evacuation uses) */
    const atRp = !!(n0.replay && E.data.demo), n = atRp ? Object.assign({}, n0, n0.replay) : n0, nowMs = atRp ? n0.replay.atMs : E.nowMs();
    const hero = (...a) => A().heroTile(E, ...a), widget = (...a) => A().widget(E, ...a), G = window.EKO_FRAME.group;
    const calls = (n.calls || []).slice().sort((a, b) => b.ageMin - a.ageMin);
    const age = m => Math.floor(m) + ':' + String(Math.round((m % 1) * 60)).padStart(2, '0');
    const all24 = (n.units || []).reduce((s, u) => s + u.calls24h, 0);
    const bedOf = id => (ev.beds || []).find(b => b.id === id) || {};
    /* a bay is the room the bed is in: its ID without the station (05-C.009.04 is in bay 05-C.009) */
    const bayOf = id => String(id).split('.').slice(0, 2).join('.');
    const recent = (n.recent || []).slice().sort((p, q) => q.at - p.at), last2 = recent.filter(c => c.at > nowMs - 2 * 36e5);
    const slow = recent.slice().sort((p, q) => q.answerMin - p.answerMin)[0];
    const med = (n.units || []).reduce((s, u) => s + u.medianMin * u.calls24h, 0) / Math.max(1, all24);
    const hl = window.EKO_OPS.headline(E, calls.length ? t('nc.hl.active', { n: calls.length, b: calls[0].bed, m: age(calls[0].ageMin) })
      : t('nc.hl.none', { k: last2.length, s: slow ? fmt(slow.answerMin, 1) : t('emptyDash'), b: slow ? slow.bed : t('emptyDash'), y: slow ? bayOf(slow.bed) : '' }), calls.some(c => c.ageMin >= 5) ? 'attn' : 'ok');
    const heroes = [hero(t('nc.h.active'), String(calls.length), '', t('nc.h.activeCap')),
      hero(t('nc.h.oldest'), calls.length ? age(calls[0].ageMin) : t('nc.none2'), calls.length ? t('nc.minSec') : '', t('nc.h.oldestCap')),
      hero(t('nc.h.last2'), String(last2.length), '', t('nc.h.last2Cap')),
      hero(t('nc.h.median'), fmt(med, 1), t('nc.min'), t('nc.h.medianCap')),
      hero(t('nc.h.slowest'), slow ? fmt(slow.answerMin, 1) : t('emptyDash'), slow ? t('nc.min') : '', slow ? t('nc.h.slowestCap', { b: slow.bed, h: E.clockLabel(slow.at) }) : '')];
    const rows = calls.map(c => `<tr><th scope="row" class="tMonoS">${esc(c.bed)}</th><td>${esc(bayOf(c.bed))}</td><td>${esc(t('nc.type.' + c.type))}</td><td>${esc(t('evac.st.' + (bedOf(c.bed).status || 'occ')))}</td>
      <td class="tMonoS nctimer" data-t0="${T0 - c.ageMin * 60000}" data-warn="${c.ageMin >= 5 ? 1 : 0}">${esc(age(c.ageMin))}</td></tr>`).join('');
    const rRows = last2.map(c => `<tr><td class="tMonoS">${esc(E.clockLabel(c.at))}</td><th scope="row" class="tMonoS">${esc(c.bed)}</th><td>${esc(bayOf(c.bed))}</td><td>${esc(t('nc.type.' + c.type))}</td><td class="tMonoS" data-warn="${c.answerMin >= 5 ? 1 : 0}">${fmt(c.answerMin, 1)}</td></tr>`).join('');
    /* the response by bay over 24 hours: calls, median, slowest */
    const q50 = a => { const x = a.slice().sort((p, q) => p - q); return x.length ? x[Math.floor((x.length - 1) / 2)] : null; };
    const bays = {}; recent.forEach(c => { (bays[bayOf(c.bed)] = bays[bayOf(c.bed)] || []).push(c); });
    const bRows = Object.keys(bays).map(k => ({ k, l: bays[k], m: q50(bays[k].map(c => c.answerMin)), s: Math.max(...bays[k].map(c => c.answerMin)) })).sort((p, q) => q.m - p.m)
      .map((r, i) => `<tr><th scope="row">${esc(r.k)}${i === 0 ? ' <span class="pwchip" data-tone="warn">' + esc(t('nc.slowestBay')) + '</span>' : ''}<br><span class="tCap">${esc(L(((ev.zones || []).find(z => z.id === r.l[0].unit) || {}).en || r.l[0].unit, ((ev.zones || []).find(z => z.id === r.l[0].unit) || {}).ar))}</span></th><td class="tMonoS">${r.l.length}</td><td class="tMonoS">${fmt(r.m, 1)}</td><td class="tMonoS">${fmt(r.s, 1)}</td></tr>`).join('');
    /* D182: the median per hour as bars, the 90th percentile as a mark above each */
    const p90 = h0 => ((n.byHourP90 || []).find(q => q[0] === h0) || [])[1];
    const mx = Math.max(...(n.byHour || []).map(h => Math.max(h[1], p90(h[0]) || 0)), 1), W = 520, H = 120, bw = W / Math.max(1, (n.byHour || []).length);
    const bars = (n.byHour || []).map((h, i) => { const bh = h[1] / mx * (H - 26), p = p90(h[0]), py = p != null ? H - 18 - p / mx * (H - 26) : null;
      return `<rect x="${(i * bw + 4).toFixed(1)}" y="${(H - 18 - bh).toFixed(1)}" width="${(bw - 8).toFixed(1)}" height="${bh.toFixed(1)}" class="ncbar"><title>${esc(String(h[0]).padStart(2, '0') + ':00 · ' + t('ev.nc.medP90', { m: fmt(h[1], 1), p: p != null ? fmt(p, 1) : t('emptyDash') }))}</title></rect>
        ${py != null ? `<line x1="${(i * bw + 4).toFixed(1)}" x2="${(i * bw + bw - 4).toFixed(1)}" y1="${py.toFixed(1)}" y2="${py.toFixed(1)}" class="ncp90"/>` : ''}
        <text x="${(i * bw + bw / 2).toFixed(1)}" y="${H - 4}" text-anchor="middle" class="nctick">${String(h[0]).padStart(2, '0')}</text>`; }).join('');
    /* the plan, zoomed to the dialysis unit: the beds (the model's bed connectors) with readable markers and the bay labels */
    const unit = (ev.beds || []).filter(b => (b.floor || 'L1') === 'L1' && b.x != null), callBeds = new Set(calls.map(c => c.bed)), recentBeds = new Set(last2.map(c => c.bed));
    const xs = unit.map(b => b.x), ys = unit.map(b => b.y), pad = 2.2, box = unit.length ? [Math.min(...xs) - pad, Math.min(...ys) - pad - 1.5, Math.max(...xs) - Math.min(...xs) + 2 * pad, Math.max(...ys) - Math.min(...ys) + 2 * pad + 4] : null;
    const SP = window.EKO_SECP, groups = {}; unit.forEach(b => { (groups[bayOf(b.id)] = groups[bayOf(b.id)] || []).push(b); });
    const planSvg = SP && SP.levelPlan && box ? SP.levelPlan(E, 'L1', (SW, SH) => {
      const X0 = v => (v / 100 * SW).toFixed(1), Y0 = v => (v / 100 * SH).toFixed(1), r = (box[2] / 100 * SW) / 70;
      const lbl = Object.keys(groups).map(k => { const g = groups[k], cx = g.reduce((s2, b) => s2 + b.x, 0) / g.length, below = g[0].zone !== 'iso', top = below ? Math.max(...g.map(b => b.y)) + 3.2 : Math.min(...g.map(b => b.y));   /* the isolation rooms are labelled above, the open bays below, so no two labels meet */
        return `<text x="${X0(cx)}" y="${Y0(top - 1.1)}" text-anchor="middle" class="ncbay" style="font-size:${(r * 2.2).toFixed(1)}px">${esc(t('nc.bay', { b: k }))}</text>`; }).join('');
      const dots = unit.map(b => { const st = callBeds.has(b.id) ? 'call' : b.status === 'occ' || b.status === 'isolated' ? 'occ' : 'free';
        return `<circle cx="${X0(b.x)}" cy="${Y0(b.y)}" r="${(r * (st === 'call' ? 1.6 : 1.1)).toFixed(1)}" class="ncbed" data-st="${st}" data-recent="${recentBeds.has(b.id) ? 1 : 0}"><title>${esc(b.id + ' · ' + t('nc.bed.' + st) + (recentBeds.has(b.id) ? ' · ' + t('nc.bed.recent') : ''))}</title></circle>`; }).join('');
      return lbl + dots; }, t('nc.planAria'), box) : plan(Object.assign({}, ev, { beds: (ev.beds || []).map(b => Object.assign({}, b, { status: callBeds.has(b.id) ? 'call' : 'idle' })), route: null, routes: [], stairs: [], refuge: [] }));
    const legend = `<div class="row gap12 esgleg">${['call', 'occ', 'free'].map(k => `<span><i class="ncbedsw" data-st="${k}"></i>${esc(t('nc.bed.' + k))}</span>`).join('')}<span><i class="ncbedsw" data-st="occ" data-recent="1"></i>${esc(t('nc.bed.recent'))}</span></div>`;
    const src = `<p class="evsrc">${icon('info', 13)}<span>${esc(t('nc.src'))}</span></p>`;
    const rpLine = atRp ? `<p class="opsclaim">${icon('clock', 12)} ${esc(t('nc.atReplay', { h: E.clockLabel(nowMs) }))}</p>` : '';
    const tbl = (ks, body, empty) => body ? `<div class="mnttblwrap"><table class="mnttbl"><thead><tr>${ks.map(k => `<th scope="col">${esc(t(k))}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>` : `<p class="alempty">${esc(t(empty))}</p>`;
    return `<div class="pwarea secpage" data-pg="sec-nurse">${hl}${rpLine}<div class="pwhero" style="grid-template-columns:repeat(${heroes.length},1fr)">${heroes.join('')}</div>`
      + `<div data-frame="visual">${widget(t('nc.planT2'), t('nc.planCap2'), planSvg + legend)}</div>`
      + G('calls', t('nc.tab.calls'), (calls.length ? widget(t('nc.callsT'), t('nc.callsCap'), tbl(['nc.c.bed', 'nc.c.bay', 'nc.c.type', 'nc.c.bedState', 'nc.c.age'], rows, 'nc.none')) : '')
          + widget(t('nc.last2T'), t('nc.last2Cap', { n: last2.length }), tbl(['nc.c.at', 'nc.c.bed', 'nc.c.bay', 'nc.c.type', 'nc.c.answer'], rRows, 'nc.last2None')))
      + G('bays', t('nc.tab.bays'), widget(t('nc.bayT'), t('nc.bayCap'), tbl(['nc.c.bay', 'nc.c.calls', 'nc.c.median', 'nc.c.slowest'], bRows, 'nc.last2None')))
      + G('hours', t('nc.tab.hours'), widget(t('nc.hourT'), t('nc.hourCap'), `<svg class="nchours" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t('nc.hourT'))}">${bars}</svg><div class="row gap12 esgleg"><span><i class="esgsw" data-l="bar" style="background:var(--link)"></i>${esc(t('ev.nc.med'))}</span><span><i class="ncp90sw"></i>${esc(t('ev.nc.p90'))}</span></div>`))
      + `<p class="tCap">${esc(t('nc.privacy'))}</p>${src}</div>`;
  }


  /* the call age timer: counts in real seconds from when the page loaded the calls (the app clock moves by the minute) */
  const T0 = Date.now();
  setInterval(() => { document.querySelectorAll('.nctimer[data-t0]').forEach(el => { const m = (Date.now() - +el.dataset.t0) / 60000;
    el.textContent = Math.floor(m) + ':' + String(Math.floor((m % 1) * 60)).padStart(2, '0'); el.dataset.warn = m >= 5 ? 1 : 0; }); }, 1000);
  const ACTS = {
    evacLv(el){ window.EKO.set({ evacLv: el.dataset.v, evacBed: null }); },
    /* the level in 3D: isolated, its beds as markers, its routes drawn on the model */
    evxView(el){ window.EKO.set({ evxView: el.dataset.v }); },
    evac3d(el){ const E2 = window.EKO, lv = el.dataset.v, ev = (E2.data.security || {}).evac || {};
      /* The Studio host has no route drawing. Stay on the plan; do not fly the loaded model. */
      if(!(E2.engine && E2.engine.setRoutes)){ E2.set({ evxView: 'plan' }); return; }
      E2.state.evac3d = lv; if(E2.state.dock) E2.state.dock.level = lv; E2.go('sec', 'security', null);
      let k = 0; const go = () => { const eng = E2.engine; if(!(eng && eng.ready && eng.ready())){ if(k++ < 60) setTimeout(go, 100); return; }
        if(eng.setRoutes) eng.setRoutes(window.EKO_EVACP && window.EKO_EVACP.pageSegs ? window.EKO_EVACP.pageSegs(E2, lv) : (ev.routes || []).filter(r => r.level === lv).map(r => ({ pts: r.pts, level: r.level })));   /* E10: the plan's walked routes */
        const g = (ev.beds || []).filter(b => b.floor === lv).map(b => b.roomGid).filter(Boolean); if(g.length && eng.flyToGids) eng.flyToGids(g); E2.set({}); };
      setTimeout(go, 60); },
    evacBed(el){ const E2 = window.EKO; E2.set({ evacBed: E2.state.evacBed === el.dataset.v ? null : el.dataset.v }); }
  };
  /* The Model view's sheet is the page colour with a hole the size of .evxvis, so the
     Studio canvas shows there and nowhere else. The box is in page coordinates. */
  function syncHole(){
    const page = document.querySelector('.pwarea.evxpage');
    const hole = page && page.querySelector('.evxvis');
    if(!page || !hole) return;
    const p = page.getBoundingClientRect(), h = hole.getBoundingClientRect();
    const box = [Math.max(0, h.left - p.left), Math.max(0, h.top - p.top), Math.max(0, h.width), Math.max(0, h.height)].map(n => n.toFixed(1) + 'px');
    const key = box.join(',');
    if(syncHole.key !== key || syncHole.watch !== hole){
      syncHole.key = key;
      page.style.setProperty('--evx-x', box[0]);
      page.style.setProperty('--evx-y', box[1]);
      page.style.setProperty('--evx-w', box[2]);
      page.style.setProperty('--evx-h', box[3]);
    }
    if(!syncHole.ro && window.ResizeObserver) syncHole.ro = new ResizeObserver(() => syncHole());
    if(syncHole.ro && syncHole.watch !== hole){ syncHole.ro.disconnect(); syncHole.ro.observe(page); syncHole.ro.observe(hole); syncHole.watch = hole; }
  }
  return { page, nursePage, markers, bedsNow, ACTS, syncHole };
})();
