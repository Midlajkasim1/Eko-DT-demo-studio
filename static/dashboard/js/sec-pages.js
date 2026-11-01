/* ============================================================================
   SECURITY AND LIFE SAFETY VIEWS (D182, functional specs sections 2 to 5):
   Cameras, Access and intrusion, Fire and life safety, Emergency power.
   Used in place of the D180 views in js/security.js when the site carries the
   D182 data (data.security.coverage and the fields beside it). Built like ESG
   (rule 0): a headline sentence first, every number a door with a method line,
   the four data states, read only, every action a link out, demo data labelled.
   Handoff: handoff/cameras.md, access.md, fire.md, power.md.
   ============================================================================ */
window.EKO_SECP = (function(){
  'use strict';
  const C = () => window.EKO_C, A = () => window.EKO_A, O = () => window.EKO_OPS, S = () => window.EKO_SEC, W = () => window.EKO_SECW;
  const esc = s => C().esc(s), fmt = (v, d) => C().fmt(v, d), icon = (n, s) => C().icon(n, s);
  const L = (E, en, ar) => E.lang === 'ar' ? (ar || en) : en;
  const D = E => E.data.security || {};
  const applies = E => !!(E.data.security && E.data.security.coverage);
  const X = E => S()._x(E);
  const lvls = E => [...new Set((D(E).cameras || []).map(c => c.storey))].sort();
  const clockAgo = (E, min) => E.clockLabel(E.nowMs() - min * 60000);
  const age = (E, min) => E.fmtAge(min / 60);
  const dayLbl = (E, ms) => new Date(ms).toLocaleDateString(E.lang === 'ar' ? 'ar-AE-u-nu-latn' : 'en-GB', { weekday: 'short' });
  const wrap = (E, pg, hl, heroes, inner) => `<div class="pwarea secpage sppage" data-pg="${pg}">${hl}${heroes.length ? `<div class="pwhero" style="grid-template-columns:repeat(${heroes.length},1fr)">${heroes.join('')}</div>` : ''}${inner}</div>`;
  const widget = (E, ...a) => A().widget(E, ...a);
  const seg = (act, v, lbl, on) => `<button class="seg" data-act="${act}" data-v="${esc(v)}" data-on="${on}" aria-pressed="${on}">${esc(lbl)}</button>`;
  const locBtn = (E, o) => `<button class="btnG btnSm" data-act="spLocate"${Object.keys(o).map(k => o[k] != null ? ` data-${k}="${esc(o[k])}"` : '').join('')}>${esc(E.t('sec.locate'))}</button>`;
  /* an ID that is itself the Locate in 3D link, for narrow tables */
  const locLink = (E, label, o) => `<button class="opsdoor tMonoS" data-act="spLocate"${Object.keys(o).map(k => o[k] != null ? ` data-${k}="${esc(o[k])}"` : '').join('')} data-tip="${esc(E.t('sec.locate'))}">${esc(label)}</button>`;
  const kpiRow = items => `<div class="swkpis spkpis">${items.map(([lbl, v, cap]) => `<div class="swkpi"><span class="tCap">${esc(lbl)}</span><b>${v}</b><span class="tCap">${esc(cap || '')}</span></div>`).join('')}</div>`;
  /* the room or department a reader serves: its name without the "Card reader 123," prefix */
  const roomOf = (E, r) => (L(E, r.en, r.ar) || '').replace(/^Card reader \d+, |^قارئ البطاقات \d+، /, '');
  const chip = (txt, tone) => `<span class="pwchip" data-tone="${tone || 'warn'}">${esc(txt)}</span>`;

  /* ================================ 2. CAMERAS ================================ */
  /* E9: the live grid pages to fit the screen: as many columns as the width takes, as many rows as the work area's height */
  const PER = () => perPage();
  const COLS = () => { const w = window.innerWidth; return w >= 1700 ? 6 : w >= 1200 ? 4 : w >= 760 ? 3 : 1; };
  const perPage = () => { const w = window.innerWidth, h = window.innerHeight; const cols = COLS(), rows = Math.max(1, Math.floor((h - 400) / 235)); return cols * rows; };
  const camState = c => c.online === false ? 'off' : c.recording === false ? 'norec' : 'on';
  function camTile(E, c, i, as){
    const t = E.t.bind(E), x = X(E), st = camState(c);
    const media = st === 'off'
      ? `<div class="spvid spoff" data-state="stale"><span>${icon('clock', 14)} ${esc(t('sp.cam.offSince', { c: clockAgo(E, c.offlineSinceMin || 0), a: age(E, c.offlineSinceMin || 0) }))}</span></div>`
      : `<div class="spvid">${W().videoEl(E, c, i, `muted loop autoplay playsinline preload="metadata" aria-label="${esc(t('s3.cornerAria'))}"`, as)}
         <span class="spvidtag">${esc(L(E, D(E).videoNoteEn, D(E).videoNoteAr) || t('sw.demoVideo'))}</span>${st === 'norec' ? `<span class="spnorec">${esc(t('sp.cam.notRec'))}</span>` : ''}</div>`;
    return `<article class="spcam" data-st="${st}">${media}
      <div class="spcamb"><b class="tMonoS">${esc(c.id)}</b><span class="tCap">${esc([c.room, x.storeyName(c.storey), x.zoneName(c.zone)].filter(Boolean).join(' · '))}</span>
        <span class="row gap6"><button class="btnG btnSm" data-act="secCam" data-v="${esc(c.id)}">${esc(t('sec.cam.open'))}</button>${locBtn(E, { v: c.gid, st: c.storey, cam: c.id })}</span></div></article>`;
  }
  /* E9: a level's plan (the scene image cropped to the level's box) with the page's own marks on it */
  function levelPlan(E, lv, inner, aria, box){
    const d = D(E), cv = d.coverage || {}, b = box || (cv.levelBox || {})[lv]; if(!b) return '';
    const SW = cv.sceneW || 1640, SH = cv.sceneH || 1260, vb = [b[0] / 100 * SW, b[1] / 100 * SH, b[2] / 100 * SW, b[3] / 100 * SH].map(v => v.toFixed(0)).join(' ');
    /* E9: clipped to the level's box, so the neighbouring level on the scene never shows beside it */
    const cid = 'lpc' + lv + Math.round(b[0] * 10) + Math.round(b[1] * 10), vbn = vb.split(' ');
    return `<svg class="spmap" viewBox="${vb}" role="img" aria-label="${esc(aria)}"><defs><clipPath id="${cid}"><rect x="${vbn[0]}" y="${vbn[1]}" width="${vbn[2]}" height="${vbn[3]}"/></clipPath></defs><g clip-path="url(#${cid})"><image href="${esc(((E.data.viewer || {}).scene || {}).images ? E.data.viewer.scene.images.minimal : '')}" x="0" y="0" width="${SW}" height="${SH}"/>${inner(SW, SH)}</g></svg>`;
  }
  /* model metres to plan percent, per level: an affine fit on the detectors, which carry both (least squares) */
  const xfCache = new WeakMap();
  function planXf(E, lv){
    const f = D(E).fire || {}; let all = xfCache.get(f); if(!all){ all = {}; xfCache.set(f, all); } if(all[lv] !== undefined) return all[lv];
    const pts = (f.detectors || []).filter(q => q.storey === lv && q.m && q.x != null);
    if(pts.length < 3){ all[lv] = null; return null; }
    const solve = key => { const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], v = [0, 0, 0];
      pts.forEach(q => { const r = [q.m[0], q.m[1], 1]; for(let i = 0; i < 3; i++){ v[i] += r[i] * q[key]; for(let j = 0; j < 3; j++) A[i][j] += r[i] * r[j]; } });
      const det = M => M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
      const D0 = det(A); if(!D0) return null; return [0, 1, 2].map(c => det(A.map((row, i) => row.map((x, j) => j === c ? v[i] : x))) / D0); };
    const cx = solve('x'), cy = solve('y'); all[lv] = cx && cy ? (mx, my) => [cx[0] * mx + cx[1] * my + cx[2], cy[0] * mx + cy[1] * my + cy[2]] : null; return all[lv];
  }
  function camMap(E, lv){
    const t = E.t.bind(E), d = D(E), cv = d.coverage, b = cv.levelBox[lv]; if(!b) return '';
    const SW = cv.sceneW || 1640, SH = cv.sceneH || 1260, px = p => (p[0] / 100 * SW).toFixed(1) + ',' + (p[1] / 100 * SH).toFixed(1);
    const cams = (d.cameras || []).filter(c => c.storey === lv), drs = (d.doors || []).filter(r => r.storey === lv && r.covered != null);
    const vb = [b[0] / 100 * SW, b[1] / 100 * SH, b[2] / 100 * SW, b[3] / 100 * SH].map(v => v.toFixed(0)).join(' ');
    const vbn = vb.split(' ');
    return `<svg class="spmap" viewBox="${vb}" role="img" aria-label="${esc(t('sp.cam.mapAria', { l: X(E).storeyName(lv) }))}"><defs><clipPath id="cmc${lv}"><rect x="${vbn[0]}" y="${vbn[1]}" width="${vbn[2]}" height="${vbn[3]}"/></clipPath></defs><g clip-path="url(#cmc${lv})">
      <image href="${esc(((E.data.viewer || {}).scene || {}).images ? E.data.viewer.scene.images.minimal : '')}" x="0" y="0" width="${SW}" height="${SH}"/>
      ${cams.filter(c => c.online !== false && c.cone && c.room).map(c => `<polygon points="${c.cone.map(px).join(' ')}" class="spcone"><title>${esc(c.id)}</title></polygon>`).join('')}
      ${drs.map(r => `<circle cx="${(r.x / 100 * SW).toFixed(1)}" cy="${(r.y / 100 * SH).toFixed(1)}" r="${r.covered ? 4 : 6}" class="spdoor" data-cov="${r.covered ? 1 : 0}"><title>${esc(r.id + (r.covered ? '' : ', ' + t('sp.cam.outCone')))}</title></circle>`).join('')}
      ${cams.map(c => `<circle cx="${(c.x / 100 * SW).toFixed(1)}" cy="${(c.y / 100 * SH).toFixed(1)}" r="5" class="spcamdot" data-st="${camState(c)}"${c.room ? '' : ' data-ext="1"'}><title>${esc(c.id + (c.room ? '' : ', ' + t('sp.cam.extTip')))}</title></circle>`).join('')}</g></svg>
      <div class="row gap12 esgleg"><span><i class="esgsw spsw" data-k="cone"></i>${esc(t('sp.cam.lgCone'))}</span><span><i class="esgsw spsw" data-k="cam"></i>${esc(t('sp.cam.lgCam'))}</span><span><i class="esgsw spsw" data-k="off"></i>${esc(t('sp.cam.lgOff'))}</span><span><i class="esgsw spsw" data-k="out"></i>${esc(t('sp.cam.lgOut'))}</span><span><i class="esgsw spsw" data-k="in"></i>${esc(t('sp.cam.lgIn'))}</span>${cams.some(c => !c.room) ? `<span><i class="esgsw spsw" data-k="ext"></i>${esc(t('sp.cam.lgExt', { n: cams.filter(c => !c.room).length }))}</span>` : ''}</div>`;
  }
  function camsPage(E){
    const t = E.t.bind(E), d = D(E), x = X(E), all = d.cameras || [];
    const on = all.filter(c => c.online !== false), off = all.filter(c => c.online === false), rec = all.filter(c => c.online !== false && c.recording !== false), norec = on.filter(c => c.recording === false);
    const longest = off.slice().sort((a, b) => (b.offlineSinceMin || 0) - (a.offlineSinceMin || 0))[0];
    const f = E.state.spCam || {}, lv = f.lv || 'all', zn = f.zn || 'all', st = f.st || 'all', ml = f.map || (lv !== 'all' ? lv : lvls(E)[0]);
    const list = all.filter(c => (lv === 'all' || c.storey === lv) && (zn === 'all' || c.zone === zn) && (st === 'all' || camState(c) === st));
    const pages = Math.max(1, Math.ceil(list.length / PER())), pg = Math.min(f.pg || 0, pages - 1);
    const hl = O().headline(E, off.length ? t('sp.cam.hl', { n: off.length, id: longest.id, a: age(E, longest.offlineSinceMin || 0), r: norec.length }) : norec.length ? t('sp.cam.hlRec', { r: norec.length }) : t('sp.cam.hlOk', { n: all.length }), off.length ? 'attn' : 'ok');
    const heroes = [
      O().hero(E, t('sp.cam.online'), O().door(E, fmt(on.length / all.length * 100, 1), 'spCams', 'on'), '%', t('sp.cam.onlineCap', { a: on.length, b: all.length })),
      O().hero(E, t('sp.cam.rec'), O().door(E, fmt(rec.length / all.length * 100, 1), 'spCams', 'norec'), '%', t('sp.cam.recCap', { a: rec.length, b: all.length })),
      O().hero(E, t('sp.cam.off'), O().door(E, String(off.length), 'spCams', 'off'), '', longest ? t('sp.cam.offCap', { id: longest.id, a: age(E, longest.offlineSinceMin || 0) }) : t('sp.cam.offNone'), off.length ? t('sec.flag') : '', 'warn'),
      O().hero(E, t('sp.cam.seen'), longest ? O().door(E, esc(clockAgo(E, longest.offlineSinceMin || 0)), 'spCams', 'off') : t('emptyDash'), '', longest ? t('sp.cam.seenCap', { id: longest.id }) : t('sp.cam.offNone'))];
    const zones = [...new Set(all.map(c => c.zone).filter(Boolean))];
    const filt = `<div class="row gap6 secfilt"><div class="segbox row">${seg('spCamF', 'lv:all', t('sp.allLevels'), lv === 'all')}${lvls(E).map(l => seg('spCamF', 'lv:' + l, x.storeyName(l), lv === l)).join('')}</div>
      <select class="tlsel" data-chg="spCamZone" aria-label="${esc(t('sec.cam.zoneF'))}"><option value="all">${esc(t('sec.cam.allZones'))}</option>${zones.map(z => `<option value="${esc(z)}"${zn === z ? ' selected' : ''}>${esc(x.zoneName(z))}</option>`).join('')}</select>
      <div class="segbox row">${['all', 'on', 'norec', 'off'].map(k => seg('spCamF', 'st:' + k, t('sp.cam.st.' + k), st === k)).join('')}</div>
      <span class="grow"></span><span class="tCap">${esc(t('sec.cam.count', { a: list.length ? pg * PER() + 1 : 0, b: Math.min(list.length, (pg + 1) * PER()), n: list.length }))}</span>
      <button class="iconbtn icon26" data-act="spCamF" data-v="pg:${pg - 1}" ${pg <= 0 ? 'disabled' : ''} aria-label="${esc(t('sec.prev'))}">${C().dicon('start', 12)}</button>
      <button class="iconbtn icon26" data-act="spCamF" data-v="pg:${pg + 1}" ${pg >= pages - 1 ? 'disabled' : ''} aria-label="${esc(t('sec.next'))}">${C().dicon('end', 12)}</button></div>`;
    const grid = widget(E, t('sp.cam.gridT'), t('sp.cam.gridCap'), filt + `<div class="spcams" style="grid-template-columns:repeat(${COLS()},minmax(0,1fr))">${((pl, as) => pl.map(c => camTile(E, c, all.indexOf(c), as.get(c.id))).join(''))(list.slice(pg * PER(), (pg + 1) * PER()), W().clipsFor(E, list.slice(pg * PER(), (pg + 1) * PER()), COLS())) || `<p class="alempty">${esc(t('sp.cam.noneF'))}</p>`}</div>`, t('sp.src.video'));
    /* the level map and the coverage list share the level */
    const cv = d.coverage, mapSeg = `<div class="segbox row">${lvls(E).map(l => seg('spCamF', 'map:' + l, x.storeyName(l), ml === l)).join('')}</div>`;
    const zRows = zones.map(z => { const zc = all.filter(c => c.zone === z), zd = (d.doors || []).filter(r => r.zone === z), inC = zd.filter(r => r.covered).length;
      return { z, cams: zc.length, on: zc.filter(c => c.online !== false).length, doors: zd.length, inC, p: zd.length ? inC / zd.length * 100 : null }; })
      .sort((a, b) => (a.p == null) - (b.p == null) || a.p - b.p);
    const covRows = zRows.map(r => `<tr><th scope="row">${esc(x.zoneName(r.z))}</th><td class="tMonoS">${r.on} / ${r.cams}</td>
        <td class="tMonoS">${r.p == null ? `<span class="esgnd" data-tip="${esc(t('sp.cam.noDoors'))}">${esc(t('emptyDash'))}</span>` : esc(t('sp.cam.inViewV', { a: r.inC, b: r.doors, p: fmt(r.p, 0) }))}</td><td class="tMonoS">${r.doors ? O().door(E, String(r.doors - r.inC), 'spDoorsOut', r.z) : esc(t('emptyDash'))}</td></tr>`).join('');
    const totIn = (d.doors || []).filter(r => r.covered).length;
    /* E9: four tabs: the live grid, the level map, the coverage by zone, the health of each camera (js/shell/frame.js) */
    const G = window.EKO_FRAME.group;
    const mapW = widget(E, t('sp.cam.mapT'), t('sp.cam.mapCap'), mapSeg + camMap(E, ml));
    const covW = widget(E, t('sp.cam.covT'), L(E, cv.noteEn, cv.noteAr), `<p class="tCap">${esc(t('sp.cam.covSum', { a: totIn, b: (d.doors || []).length }))}</p>` + O().table(E, ['sec.c.zone', 'sp.c.camsOn', 'sp.c.inView', 'sp.c.out'], covRows));
    const bad = all.filter(c => camState(c) !== 'on').sort((a, b) => (camState(a) === 'off' ? 0 : 1) - (camState(b) === 'off' ? 0 : 1) || (b.offlineSinceMin || 0) - (a.offlineSinceMin || 0));
    const hRows = bad.map(c => `<tr><th scope="row">${locLink(E, c.id, { v: c.gid, st: c.storey, cam: c.id })}</th><td>${esc(c.room || t('sp.cam.extRoom'))}</td><td>${esc(x.storeyName(c.storey))}</td>
        <td><span class="secpst" data-st="${camState(c) === 'off' ? 'fault' : 'idle'}"><span class="secdot"></span>${esc(t('sp.cam.st.' + camState(c)))}</span></td>
        <td class="tMonoS">${camState(c) === 'off' ? esc(clockAgo(E, c.offlineSinceMin || 0) + ' · ' + age(E, c.offlineSinceMin || 0)) : esc(t('emptyDash'))}</td><td class="tMonoS">${c.onlinePct7d != null ? fmt(c.onlinePct7d, 1) + '%' : esc(t('emptyDash'))}</td>
        <td><button class="btnG btnSm" data-act="secCam" data-v="${esc(c.id)}">${esc(t('sec.cam.open'))}</button></td></tr>`).join('');
    const healthW = widget(E, t('sp.cam.healthT'), t('sp.cam.healthCap', { a: bad.length, n: all.length }), O().table(E, ['sp.c.cam', 'sp.c.room', 'sp.c.level', 'sec.c.state', 'sp.c.offSince', 'sp.c.on7d', 'sp.c.open'], hRows, 'sp.cam.healthNone'), t('sp.src.video'));
    return wrap(E, 'sec-cams', hl, heroes, G('grid', t('sp.cam.tab.grid'), grid) + G('map', t('sp.cam.tab.map'), mapW) + G('cov', t('sp.cam.tab.cov'), covW) + G('health', t('sp.cam.tab.health'), healthW));
  }
  /* camera detail: the clip, where it is, its cone in 3D, its last 24 hours, the link out */
  function camDetail(E, id){
    const t = E.t.bind(E), d = D(E), x = X(E), all = d.cameras || [], c = all.find(q => q.id === id); if(!c) return null;
    const st = camState(c), now = E.nowMs(), from = now - 24 * 3600000, Wd = 560, Xp = ms => 16 + (ms - from) / (now - from) * (Wd - 32);
    const evs = x.accessEvents().concat(x.fireEvents(), x.intrEvents()).filter(e => e.zone === c.zone || (!e.zone && e.storey === c.storey)).filter(e => (e.agoMin || 0) <= 1440);
    const offFrom = st === 'off' ? now - (c.offlineSinceMin || 0) * 60000 : null;
    const ticks = []; for(let h = 0; h <= 24; h += 6) ticks.push(from + h * 3600000);
    const tl = `<svg class="sectl" viewBox="0 0 ${Wd} 80" role="img" aria-label="${esc(t('sp.cam.tlAria'))}">
      <text x="16" y="13" class="sectlt">${esc(t('sec.tl.cam'))}</text>
      <rect x="16" y="19" width="${Wd - 32}" height="10" rx="3" class="sectlrec" data-on="${st === 'on' ? 1 : 0}"/>
      ${offFrom ? `<rect x="${Xp(Math.max(from, offFrom)).toFixed(1)}" y="19" width="${(Wd - 16 - Xp(Math.max(from, offFrom))).toFixed(1)}" height="10" class="sptloff"/>` : ''}
      <text x="16" y="46" class="sectlt">${esc(t('sec.tl.events'))}</text><line x1="16" y1="58" x2="${Wd - 16}" y2="58" class="sectlax"/>
      ${ticks.map(m => `<line x1="${Xp(m).toFixed(1)}" y1="54" x2="${Xp(m).toFixed(1)}" y2="62" class="sectlax"/><text x="${Xp(m).toFixed(1)}" y="76" text-anchor="middle" class="sectlt">${esc(E.clockLabel(m))}</text>`).join('')}
      ${evs.map(e => `<circle cx="${Xp(now - (e.agoMin || 0) * 60000).toFixed(1)}" cy="58" r="5" class="sectlevd"><title>${esc(x.evTitle(e))}</title></circle>`).join('')}</svg>`;
    const media = st === 'off' ? `<div class="spvid spoff spbig" data-state="stale"><span>${icon('clock', 14)} ${esc(t('sp.cam.offSince', { c: clockAgo(E, c.offlineSinceMin || 0), a: age(E, c.offlineSinceMin || 0) }))}</span></div>`
      : `<div class="spvid spbig">${W().videoEl(E, c, all.indexOf(c), 'muted loop autoplay playsinline controls')}<span class="spvidtag">${esc(L(E, d.videoNoteEn, d.videoNoteAr))}</span></div>`;
    const body = `${media}<dl class="secdl"><dt>${esc(t('sp.c.room'))}</dt><dd>${esc(c.room || t('emptyDash'))}</dd><dt>${esc(t('sp.c.level'))}</dt><dd>${esc(x.storeyName(c.storey))}</dd>
      <dt>${esc(t('sec.c.zone'))}</dt><dd>${esc(x.zoneName(c.zone))}</dd><dt>${esc(t('sec.c.state'))}</dt><dd>${esc(t('sp.cam.st.' + st))}</dd></dl>
      <div class="row gap6">${locBtn(E, { v: c.gid, st: c.storey, cam: c.id })}${O().linkOut(E, 'sp.cam.vms')}</div>
      <h4 class="tLbl">${esc(t('sp.cam.tlT'))}</h4>${tl}<p class="tCap">${esc(evs.length ? t('sp.cam.tlN', { n: evs.length }) : t('sp.cam.tlNone'))}</p>`;
    return { title: c.id + ' · ' + (c.room || x.storeyName(c.storey)), body, method: t('sp.m.cam') };
  }

  /* ========================== 3. ACCESS AND INTRUSION ========================== */
  const DSTATES = ['locked', 'unlocked', 'unlockedOff', 'open', 'held', 'forced', 'offline'];
  const NOTSECURE = ['unlockedOff', 'open', 'held', 'forced'];
  const DTONE = { locked: 'ok', unlocked: 'info', unlockedOff: 'attn', open: 'attn', held: 'attn', forced: 'alarm', offline: 'mute' };
  function accessPage(E){
    const t = E.t.bind(E), d = D(E), x = X(E), dr = d.doors || [], acc = d.access || {}, md = acc.model || {}, wk = acc.week || {}, ev = x.accessEvents();
    const cnt = s => dr.filter(r => r.state === s).length, ns = dr.filter(r => NOTSECURE.includes(r.state)), offR = dr.filter(r => r.online === false);
    const hl = O().headline(E, ns.length ? t('sp.acc.hl', { n: ns.length, f: cnt('forced'), h: cnt('held'), p: cnt('open'), u: cnt('unlockedOff'), o: offR.length }) : t('sp.acc.hlOk'), cnt('forced') ? 'alarm' : ns.length ? 'attn' : 'ok');
    const today = (acc.grantedToday || 0) + (acc.deniedToday || 0);
    const heroes = [O().hero(E, t('sp.acc.ns'), O().door(E, String(ns.length), 'spDoors', 'ns'), '', t('sp.acc.nsCap', { f: cnt('forced'), h: cnt('held'), o: cnt('open'), u: cnt('unlockedOff') }), ns.length ? t('sec.flag') : '', cnt('forced') ? 'crit' : 'warn'),
      O().hero(E, t('sp.acc.rOff'), O().door(E, String(offR.length), 'spDoors', 'offline'), '', t('sp.acc.rOffCap', { n: md.readers || dr.length })),
      O().hero(E, t('sp.acc.today'), O().door(E, fmt(today, 0), 'spAccToday'), '', t('sec.acc.eventsCap', { g: fmt(acc.grantedToday || 0, 0), d: fmt(acc.deniedToday || 0, 0) }))];
    const states = `<div class="spstates">${DSTATES.map(s => `<button class="spstate" data-tone="${DTONE[s]}" data-act="opsDrill" data-v="spDoors" data-arg="${s}"><span class="scdot" data-tone="${DTONE[s] === 'alarm' ? 'crit' : DTONE[s] === 'attn' ? 'warn' : DTONE[s] === 'mute' ? 'mute' : 'ok'}"></span><span class="tCap">${esc(t('sp.ds.' + s))}</span><b class="tMonoS">${cnt(s)}</b></button>`).join('')}</div>
      <p class="tCap">${esc(t('sp.acc.counts', { d: md.doorsModel || t('emptyDash'), r: md.readers || dr.length, p: md.paired || t('emptyDash') }))}</p>`;
    const byDoor = [...new Set(ev.map(e => e.door))].map(id => { const de = ev.filter(e => e.door === id), r = dr.find(q => q.id === id) || {};
      return `<tr><th scope="row">${locLink(E, id, { v: r.gid, st: r.storey })}<br><span class="tCap">${esc(roomOf(E, r))}</span></th><td class="tMonoS">${de.length}</td>${['forced', 'held', 'tailgate'].map(k => `<td class="tMonoS">${de.filter(e => e.kind === k).length}</td>`).join('')}</tr>`; }).join('');
    const days = (wk.forced || []).map((_, i) => dayLbl(E, E.nowMs() - (6 - i) * 86400000));
    const week = O().cols(E, days, [{ label: t('sec.k.forced'), tone: 'alarm', vals: wk.forced || [] }, { label: t('sec.k.held'), tone: 'attn', vals: wk.held || [] }, { label: t('sec.k.tailgate'), tone: 'info', vals: wk.tailgate || [] }], { aria: t('sp.acc.weekAria') });
    const busy = O().hbars(E, (acc.busiest || []).map(b => { const r = dr.find(q => q.id === b.door) || {}; return { label: roomOf(E, r).slice(0, 24) || b.door, v: b.n }; }), { aria: t('sp.acc.busyAria') });
    const mean = a => a && a.length ? a.reduce((s, v) => s + v, 0) / a.length : null;
    const kp = kpiRow([[t('sp.kpi.forcedDay'), O().door(E, fmt(mean(wk.forced), 1), 'spAccWeek'), t('sp.kpi.d7')], [t('sp.kpi.held'), O().door(E, String(ev.filter(e => e.kind === 'held').length), 'spAccWeek'), t('sp.kpi.today')],
      [t('sp.kpi.heldMin'), O().door(E, fmt(mean(wk.heldMin), 1), 'spAccWeek'), t('sp.kpi.minD7')], [t('sp.kpi.readersOn'), O().door(E, fmt((dr.length - offR.length) / dr.length * 100, 1) + '%', 'spDoors', 'offline'), t('sp.kpi.readersOnCap', { a: dr.length - offR.length, b: dr.length })]]);
    /* intrusion: the areas as they are now (clinics are disarmed in opening hours), bypassed inputs */
    const ir = d.intrusion || {}, hrs = ir.hours || { open: 7, close: 21 }, areas = W().areasNow(E), hh = n => String(n).padStart(2, '0') + ':00';
    const aRows = areas.map(a => `<tr><th scope="row">${esc(L(E, a.en, a.ar))}</th><td><span class="secpst" data-st="${a.state === 'armed' ? 'normal' : 'idle'}"><span class="secdot"></span>${esc(t('sp.ia.' + a.state))}</span></td>
        <td class="tCap">${esc(a.clinic ? t('sp.ia.ruleClinic', { o: hh(hrs.open), c: hh(hrs.close) }) : t('sp.ia.ruleAlways'))}</td><td class="tMonoS">${a.motion24h != null ? a.motion24h : t('emptyDash')}</td></tr>`).join('');
    const bRows = (ir.bypassed || []).map(b => `<tr><th scope="row">${locLink(E, b.device, { v: b.gid, st: b.storey })}</th><td>${esc(x.zoneName(b.zone))}</td><td class="tCap">${esc(L(E, b.since, b.sinceAr))}</td><td class="tCap">${esc(L(E, b.reasonEn, b.reasonAr))}</td></tr>`).join('');
    /* E9: the plan beside four tabs: events, doors, readers, exceptions (held open, forced, tailgating) */
    const G = window.EKO_FRAME.group, LV = lvls(E), alv = E.state.spAccLv || (ns[0] && ns[0].storey) || LV[0];
    const TONE2 = { ok: 'var(--pos)', info: 'var(--link)', attn: 'var(--warn)', alarm: 'var(--sevCrit)', mute: 'var(--t3)' };
    const plan = levelPlan(E, alv, (SW, SH) => dr.filter(r => r.storey === alv && r.x != null).sort((p, q) => (NOTSECURE.includes(p.state) ? 1 : 0) - (NOTSECURE.includes(q.state) ? 1 : 0)).map(r => { const st = r.online === false ? 'offline' : r.state;
      return `<circle cx="${(r.x / 100 * SW).toFixed(1)}" cy="${(r.y / 100 * SH).toFixed(1)}" r="${NOTSECURE.includes(st) ? 9 : 5}" class="spdoordot" fill="${TONE2[DTONE[st]] || 'var(--t3)'}" data-act="opsDrill" data-v="spDoor" data-arg="${esc(r.id)}" tabindex="0" role="button" aria-label="${esc(r.id + ', ' + t('sp.ds.' + st))}"><title>${esc(r.id + ' · ' + roomOf(E, r) + ' · ' + t('sp.ds.' + st))}</title></circle>`; }).join(''), t('sp.acc.planAria', { l: x.storeyName(alv) }));
    const planW = widget(E, t('sp.acc.planT'), t('sp.acc.planCap'), `<div class="segbox row">${LV.map(l => seg('spAccLv', l, x.storeyName(l) + (dr.some(r => r.storey === l && NOTSECURE.includes(r.state)) ? ' · ' + dr.filter(r => r.storey === l && NOTSECURE.includes(r.state)).length : ''), alv === l)).join('')}</div>${plan}
      <div class="row gap12 esgleg">${['ok', 'attn', 'alarm', 'mute'].map(k => `<span><i class="esgsw" style="background:${TONE2[k]}"></i>${esc(t('sp.acc.lg.' + k))}</span>`).join('')}</div>`);
    const evRows = ev.slice().sort((p, q) => (p.agoMin || 0) - (q.agoMin || 0)).map(e => { const r = dr.find(q => q.id === e.door) || {};
      return `<tr><td class="tMonoS">${esc(clockAgo(E, e.agoMin || 0))}</td><th scope="row">${esc(x.evTitle(e))}</th><td>${locLink(E, e.door, { v: r.gid, st: r.storey })}<br><span class="tCap">${esc(roomOf(E, r))}</span></td></tr>`; }).join('');
    const evW = widget(E, t('sp.acc.evT'), t('sp.acc.evCap', { g: fmt(acc.grantedToday || 0, 0), d: fmt(acc.deniedToday || 0, 0), n: ev.length }), O().table(E, ['sec.c.when', 'sp.c.event', 'sec.c.door'], evRows, 'sec.acc.noneToday'), t('sec.src.accessFoot'));
    const rdRows = dr.slice().sort((p, q) => (p.online === false ? 0 : 1) - (q.online === false ? 0 : 1) || String(p.id).localeCompare(q.id)).map(r => `<tr><th scope="row">${locLink(E, r.id, { v: r.gid, st: r.storey })}</th><td class="tCap">${esc(roomOf(E, r))}</td><td>${esc(x.storeyName(r.storey))}</td>
        <td><span class="secpst" data-st="${r.online === false ? 'fault' : 'normal'}"><span class="secdot"></span>${esc(t(r.online === false ? 'sp.acc.rdOff' : 'sp.acc.rdOn'))}</span></td><td class="tMonoS">${ev.filter(e => e.door === r.id).length}</td></tr>`).join('');
    const rdW = widget(E, t('sp.acc.rdT'), t('sp.acc.rdCap', { a: dr.length - offR.length, b: dr.length }), O().table(E, ['sec.c.door', 'sp.c.room', 'sp.c.level', 'sec.c.state', 'sp.c.flagged'], rdRows));
    const exNow = dr.filter(r => ['forced', 'held', 'open', 'unlockedOff'].includes(r.state)).sort((p, q) => ['forced', 'held', 'unlockedOff', 'open'].indexOf(p.state) - ['forced', 'held', 'unlockedOff', 'open'].indexOf(q.state));
    const exRows = exNow.map(r => `<tr><th scope="row">${locLink(E, r.id, { v: r.gid, st: r.storey })}<br><span class="tCap">${esc(roomOf(E, r))}</span></th><td><span class="spstatechip" data-tone="${DTONE[r.state]}">${esc(t('sp.ds.' + r.state))}</span></td><td>${esc(x.storeyName(r.storey))}</td>
        <td class="tCap">${esc(ev.filter(e => e.door === r.id).map(e => x.evTitle(e) + ', ' + clockAgo(E, e.agoMin || 0)).join('; ') || t('emptyDash'))}</td></tr>`).join('');
    const exW = widget(E, t('sp.acc.exT'), t('sp.acc.exCap', { f: cnt('forced'), h: cnt('held'), g: ev.filter(e => e.kind === 'tailgate').length }), O().table(E, ['sec.c.door', 'sec.c.state', 'sp.c.level', 'sp.c.event'], exRows, 'sp.acc.exNone')
      + `<h4 class="tLbl">${esc(t('sp.acc.exWeek'))}</h4>` + week);
    const inner = `<div data-frame="visual">${planW}</div>`
      + G('events', t('sp.acc.tab.events'), evW + `<div class="secgrid2 spgrid">${widget(E, t('sp.acc.busyT'), t('sp.acc.busyCap'), busy)}</div>` + `<p class="tCap spnote">${esc(t('sp.acc.privacy'))}</p>`)
      + G('doors', t('sp.acc.tab.doors'), widget(E, t('sp.acc.statesT'), t('sp.acc.statesCap'), states) + widget(E, t('sp.acc.byDoorT'), t('sp.acc.byDoorCap'), O().table(E, ['sec.c.door', 'sec.c.events', 'sec.k.forced', 'sec.k.held', 'sec.k.tailgate'], byDoor, 'sec.acc.noneToday')))
      + G('readers', t('sp.acc.tab.readers'), kp + rdW)
      + G('exc', t('sp.acc.tab.exc'), exW);
    return wrap(E, 'sec-access', hl, heroes, inner);
  }

  /* ============================ 4. FIRE AND LIFE SAFETY ============================ */
  function firePage(E){
    const t = E.t.bind(E), d = D(E), x = X(E), f = d.fire || {}, fe = x.fireEvents();
    const alarms = fe.filter(e => e.kind === 'alarm' && e.active !== false), pre = fe.filter(e => e.kind === 'pre' && e.active !== false), faults = fe.filter(e => e.kind === 'fault' && e.active !== false);
    const iso = (f.isolations || []).slice().sort((a, b) => b.agoH - a.agoH), over = iso.filter(i => i.agoH > 24), oldest = iso[0];
    const iv = f.testIntervalMonths || 12, dt = f.deviceTests || [], od = dt.filter(q => q.monthsAgo > iv), soon = dt.filter(q => q.monthsAgo > iv - 1 && q.monthsAgo <= iv);
    const hl = O().headline(E, alarms.length ? t('sp.fi.hlAlarm', { n: alarms.length }) : (faults.length || iso.length) ? t('sp.fi.hl', { f: faults.length, i: iso.length, o: over.length }) : t('sp.fi.hlOk'), alarms.length ? 'alarm' : (faults.length || over.length) ? 'attn' : 'ok');
    const heroes = [O().hero(E, t('sp.fi.active'), O().door(E, String(alarms.length), 'spFire', 'alarm'), '', t('sec.fire.activeCap'), alarms.length ? t('sec.flag') : '', 'crit'),
      O().hero(E, t('sp.fi.pre'), O().door(E, String(pre.length), 'spFire', 'pre'), '', t('sp.fi.preCap')),
      O().hero(E, t('sp.fi.faults'), O().door(E, String(faults.length), 'spFire', 'fault'), '', t('sec.fire.faultsCap')),
      O().hero(E, t('sp.fi.iso'), O().door(E, String(iso.length), 'spFire', 'iso'), '', oldest ? t('sp.fi.isoCap', { a: E.fmtAge(oldest.agoH) }) : t('sp.fi.isoNone'), over.length ? t('sp.fi.over24') : '', 'warn'),
      O().hero(E, t('sp.fi.devices'), O().door(E, fmt(f.devices || dt.length, 0), 'spFire', 'tests'), '', t('sec.fire.devicesCap', { n: (f.panels || []).length }))];
    const claim = `<p class="opsclaim">${icon('info', 12)} ${esc(L(E, f.supplementaryEn, f.supplementaryAr))}</p>`;
    /* the zone view: one level at a time, each zone opens in 3D as a volume */
    const zl = (E.state.spFireLv) || (d.scenario && d.scenario.level) || 'L1', zones = (f.zones || []).filter(z => z.storey === zl);
    const scnZ = window.EKO_SCN && window.EKO_SCN.on(E) && window.EKO_SCN.zoneOn && window.EKO_SCN.zoneOn(E) ? d.scenario.zone : null;
    const zRows = zones.map(z => `<tr${E.state.spFireZone === z.id ? ' class="spzsel"' : ''}><th scope="row"><button class="opsdoor" data-act="spFireZone" data-v="${esc(z.id)}" aria-pressed="${E.state.spFireZone === z.id}" data-tip="${esc(t('sp.fi.selZone'))}">${esc(L(E, z.en, z.ar).replace(/^(Level|المستوى) \d+، ?|^(Level|المستوى) \d+, /, ''))}</button><br><span class="tCap tMonoS">${esc(z.id)}</span></th><td class="tMonoS">${(z.spaces || []).length}</td>
        <td><span class="secpst" data-st="${scnZ === z.id ? 'alarm' : 'normal'}"><span class="secdot"></span>${esc(t(scnZ === z.id ? 'sec.panel.alarm' : 'sec.panel.normal'))}</span></td></tr>`).join('');
    const zoneView = widget(E, t('sp.fi.zonesT'), t('sp.fi.zonesCap'), `<div class="segbox row">${[...new Set((f.zones || []).map(z => z.storey))].sort().map(l => seg('spFireLv', l, x.storeyName(l), zl === l)).join('')}</div>`
      + O().table(E, ['sp.c.fzone', 'sp.c.rooms', 'sec.c.state'], zRows));
    /* the alarm sequence, oldest first, each with Locate */
    const seqRows = fe.slice().sort((a, b) => (b.agoMin || 0) - (a.agoMin || 0)).map(e => `<tr><td class="tMonoS">${esc(clockAgo(E, e.agoMin || 0))}</td><th scope="row">${esc(x.evTitle(e))}<br><span class="tCap">${esc(e.room || x.zoneName(e.zone) || x.storeyName(e.storey))}</span></th>
        <td>${e.gid ? locLink(E, e.device || '', { v: e.gid, st: e.storey }) : esc(e.device || '')}</td></tr>`).join('');
    const seq = widget(E, t('sp.fi.seqT'), t('sp.fi.seqCap'), O().table(E, ['sec.c.when', 'sp.c.event', 'sec.c.device'], seqRows, 'sp.fi.noSeq'));
    /* cause and effect: Observed, Not yet due, Not observed (red, check on site) */
    const ce = window.EKO_SCN && window.EKO_SCN.on(E) ? window.EKO_SCN.fireBlocks(E)
      : widget(E, t('sp.fi.ceT'), t('sp.fi.ceIdle'), O().table(E, ['sp.c.resp', 'sp.c.expected', 'sp.c.point'], ((d.scenario || {}).outputs || []).map(o => `<tr><th scope="row">${esc(L(E, o.en, o.ar))}</th><td class="tCap">${esc(L(E, o.expected, o.expectedAr) || t('emptyDash'))}</td><td class="tCap">${esc(o.point || t('emptyDash'))}</td></tr>`).join(''))
        + `<p class="tCap">${esc(t('sp.fi.ceWords'))}</p>` + (window.EKO_SCN && window.EKO_SCN.startButton ? window.EKO_SCN.startButton(E) : ''));
    /* faults and isolations, with expiry; over 24 hours flagged */
    const fiRows = faults.map(e => `<tr><td>${esc(t('sp.fi.kFault'))}</td><th scope="row">${e.gid ? locLink(E, e.device || '', { v: e.gid, st: e.storey }) : esc(e.device || '')}</th><td class="tCap">${esc(x.evTitle(e))}</td><td class="tMonoS">${esc(age(E, e.agoMin || 0))}</td><td>${esc(t('emptyDash'))}</td></tr>`).join('')
      + iso.map(i => `<tr><td>${esc(t('sp.fi.kIso'))}</td><th scope="row">${i.gid ? locLink(E, i.device || '', { v: i.gid, st: i.storey }) : esc(i.device || '')}</th><td class="tCap">${esc(L(E, i.reasonEn, i.reasonAr))} · ${esc(E.person(i.byRole || ''))}</td>
        <td class="tMonoS">${esc(E.fmtAge(i.agoH))}${i.agoH > 24 ? ' ' + chip(t('sp.fi.over24'), 'crit') : ''}</td><td class="tMonoS">${esc(i.expiresInH != null ? t('sp.fi.expIn', { h: i.expiresInH }) : t('sp.fi.noExp'))}</td></tr>`).join('');
    const fi = widget(E, t('sp.fi.fiT'), t('sp.fi.fiCap'), O().table(E, ['sp.c.kind', 'sec.c.device', 'sec.c.reason', 'sec.c.since', 'sp.c.expires'], fiRows, 'sec.fire.noFaults'));
    /* detector testing against the configured interval */
    const tl = [...new Set(dt.map(q => q.storey))].sort().map(l => { const q = dt.filter(z => z.storey === l), o = q.filter(z => z.monthsAgo > iv).length, s = q.filter(z => z.monthsAgo > iv - 1 && z.monthsAgo <= iv).length;
      return `<tr><th scope="row">${esc(x.storeyName(l))}</th><td class="tMonoS">${q.length}</td><td class="tMonoS">${q.length - o}</td><td class="tMonoS">${o ? O().door(E, String(o), 'spFire', 'overdue:' + l) : '0'}</td><td class="tMonoS">${s}</td></tr>`; }).join('');
    const tests = widget(E, t('sp.fi.testT'), t('sp.fi.testCap', { m: iv }), O().table(E, ['sp.c.level', 'sec.c.devices', 'sp.c.inInt', 'sp.c.overdue', 'sp.c.dueSoon'], tl));
    const h = (((d.history || {}).events) || []).filter(q => q.sys === 'fire');
    const kp = kpiRow([[t('sp.kpi.alarms30'), O().door(E, String(h.length), 'swTimes'), t('sp.kpi.d30')], [t('sw.kpi.tta'), O().door(E, h.length ? fmt(O().median(h.map(q => q.ackMin)), 1) : t('emptyDash'), 'swTimes'), t('sp.kpi.minMed')],
      [t('sp.kpi.faultsOpen'), O().door(E, String(faults.length), 'spFire', 'fault'), t('sp.kpi.now')], [t('sp.kpi.tested'), O().door(E, fmt((dt.length - od.length) / Math.max(1, dt.length) * 100, 1) + '%', 'spFire', 'tests'), t('sp.kpi.testedCap', { m: iv, n: od.length })]]);
    /* E9: the plan beside four tabs (zones, devices, cause and effect, tests); the selected zone is lit on the plan */
    const G = window.EKO_FRAME.group, selZ = (f.zones || []).find(z => z.id === E.state.spFireZone && z.storey === zl) || (scnZ && zones.find(z => z.id === scnZ)) || null, xf = planXf(E, zl);
    const firePlan = levelPlan(E, zl, (SW, SH) => {
      const P = (mx, my) => { const q = xf(mx, my); return (q[0] / 100 * SW).toFixed(1) + ',' + (q[1] / 100 * SH).toFixed(1); };
      const rooms = xf ? zones.map(z => (z.volume || []).map(v => (v.loops || []).map(l => `<polygon points="${l.map(pt => P(pt[0], pt[1])).join(' ')}" class="spfzone" data-on="${selZ && selZ.id === z.id ? 1 : 0}" data-alarm="${scnZ === z.id ? 1 : 0}" data-act="spFireZone" data-v="${esc(z.id)}"><title>${esc(L(E, z.en, z.ar))}</title></polygon>`).join('')).join('')).join('') : '';
      const dets = (f.detectors || []).filter(q => q.storey === zl && q.x != null).map(q => { const flt = fe.some(e => e.device === q.id && e.active !== false); const iso2 = (f.isolations || []).some(i => i.device === q.id);
        return `<circle cx="${(q.x / 100 * SW).toFixed(1)}" cy="${(q.y / 100 * SH).toFixed(1)}" r="${flt || iso2 ? 7 : 3.5}" class="spdet" data-k="${flt ? 'fault' : iso2 ? 'iso' : selZ && q.zone === selZ.id ? 'sel' : 'ok'}"><title>${esc(q.id + ' · ' + (q.roomEn || '') + (flt ? ', ' + t('sp.fi.kFault') : iso2 ? ', ' + t('sp.fi.kIso') : ''))}</title></circle>`; }).join('');
      return rooms + dets; }, t('sp.fi.planAria', { l: x.storeyName(zl) }));
    const planW = widget(E, selZ ? L(E, selZ.en, selZ.ar) : t('sp.fi.planT'), selZ ? t('sp.fi.planSel', { n: (selZ.spaces || []).length, d: (f.detectors || []).filter(q => q.zone === selZ.id).length }) : t('sp.fi.planCap'),
      `<div class="segbox row">${[...new Set((f.zones || []).map(z => z.storey))].sort().map(l => seg('spFireLv', l, x.storeyName(l), zl === l)).join('')}</div>${firePlan}
       <div class="row gap12 esgleg"><span><i class="esgsw spsw" data-k="zsel"></i>${esc(t('sp.fi.lg.sel'))}</span><span><i class="esgsw spsw" data-k="dok"></i>${esc(t('sp.fi.lg.det'))}</span><span><i class="esgsw spsw" data-k="dfault"></i>${esc(t('sp.fi.lg.fault'))}</span><span><i class="esgsw spsw" data-k="diso"></i>${esc(t('sp.fi.lg.iso'))}</span>${selZ ? `<button class="btnG btnSm" data-act="spLocate" data-zone="${esc(selZ.id)}" data-st="${esc(selZ.storey)}">${esc(t('sp.fi.show3d'))}</button>` : ''}</div>`);
    return wrap(E, 'sec-fire', hl + claim, heroes, `<div data-frame="visual">${planW}</div>`
      + G('zones', t('sp.fi.tab.zones'), zoneView) + G('devices', t('sp.fi.tab.devices'), fi + seq) + G('ce', t('sp.fi.tab.ce'), ce) + G('tests', t('sp.fi.tab.tests'), kp + tests));
  }

  /* ============================== 5. EMERGENCY POWER ============================== */
  /* the burn curve: litres per hour at a load percentage, straight lines between the points the maker gives */
  const burnAt = (curve, p) => { const c = (curve || []).slice().sort((a, b) => a[0] - b[0]); if(!c.length) return null; if(p <= c[0][0]) return c[0][1];
    for(let i = 1; i < c.length; i++) if(p <= c[i][0]) return c[i - 1][1] + (c[i][1] - c[i - 1][1]) * (p - c[i - 1][0]) / (c[i][0] - c[i - 1][0]); return c[c.length - 1][1]; };
  function powerModel(E){
    const pw = D(E).power || {}, g = (pw.generators || [])[0] || {}, loads = pw.loads || [];
    const genKw = loads.reduce((s, l) => s + (l.kw || 0), 0), loadPct = g.ratingKw ? genKw / g.ratingKw * 100 : null;
    const lph = loadPct != null ? burnAt(g.burnCurve, loadPct) : null, fuelL = g.tankL != null && g.fuelPct != null ? g.tankL * g.fuelPct / 100 : null;
    return { pw, g, u: (pw.ups || [])[0] || {}, a: (pw.ats || [])[0] || {}, loads, genKw, loadPct, lph, fuelL, autH: lph && fuelL != null ? fuelL / lph : null };
  }
  /* E9: the generator's test schedule, one place for Emergency power and Health and tests (the engine's power.genSchedule) */
  const genSched = E => (D(E).power || {}).genSchedule || null;
  function powerPage(E){
    const t = E.t.bind(E), m = powerModel(E), { pw, g, u, a } = m, lt = g.lastTest || {}, tgt = pw.transferTargetS, sc = genSched(E), ur = u.room || null;
    const upsKw = m.loads.filter(l => l.on === 'ups').reduce((q, l) => q + (l.kw || 0), 0), genOnly = m.loads.filter(l => l.on !== 'ups');
    const running = g.run && g.run !== 'standby';
    /* the headline answers one question: if the mains fails now */
    const parts = [running ? t('sp.pw.hlRun') : t('sp.pw.hlIf', { s: lt.transferS != null ? fmt(lt.transferS, 0) : t('emptyDash'), r: u.runtimeMin != null ? fmt(u.runtimeMin, 0) : t('emptyDash'), h: m.autH != null ? fmt(m.autH, 0) : t('emptyDash'), k: fmt(m.genKw, 0) })];
    if(sc && sc.overdueD > 0) parts.push(t('sp.pw.hlOverdue', { d: sc.overdueD }));
    if(ur && ur.over) parts.push(t('sp.pw.hlUpsRoom', { c: fmt(ur.tempC, 1), l: fmt(ur.limitC, 1) }));
    const hl = O().headline(E, parts.join(' '), running ? 'alarm' : (sc && sc.overdueD > 0) || (ur && ur.over) ? 'attn' : 'ok');
    const heroes = [O().hero(E, t('sp.pw.gen'), O().door(E, esc(t('sec.run.' + (g.run || 'standby'))), 'spPw', 'gen'), '', sc ? t('sp.pw.genCap2', { l: sc.last, d: sc.overdueD }) : t('sp.pw.genCap', { d: lt.agoD != null ? lt.agoD : t('emptyDash'), r: lt.result ? t('sec.test.' + lt.result) : t('emptyDash') }), sc && sc.overdueD > 0 ? t('sp.pw.testDue') : '', 'warn'),
      O().hero(E, t('sp.pw.aut'), m.autH != null ? O().door(E, fmt(m.autH, 1), 'spPw', 'aut') : O().val(E, { v: null, why: t('sp.pw.autNone') }), t('sp.unit.h'), t('sp.pw.autCap', { k: fmt(m.genKw, 0), p: m.loadPct != null ? fmt(m.loadPct, 0) : t('emptyDash') })),
      O().hero(E, t('sp.pw.xfer'), lt.transferS != null ? O().door(E, fmt(lt.transferS, 0), 'spPw', 'gen') : O().val(E, { v: null }), t('sp.unit.s'), tgt != null ? t('sp.pw.xferCap', { s: tgt, w: t(lt.transferS <= tgt ? 'sp.pw.within' : 'sp.pw.over') }) : t('ops.st.nc'), lt.transferS > tgt ? t('sp.pw.over') : '', 'warn'),
      O().hero(E, t('sp.pw.fuel'), g.fuelPct != null ? O().door(E, fmt(g.fuelPct, 0), 'spPw', 'aut') : O().val(E, { v: null }), '%', t('sp.pw.fuelCap', { l: m.fuelL != null ? fmt(m.fuelL, 0) : t('emptyDash'), p: pw.fuelPolicyPct || 70 })),
      O().hero(E, t('sp.pw.upsRt'), u.runtimeMin != null ? O().door(E, fmt(u.runtimeMin, 0), 'spPw', 'ups') : O().val(E, { v: null, why: t('sp.pw.rtNone') }), t('sp.unit.min'), t('sp.pw.upsRtCap'), ur && ur.over ? t('sp.pw.roomAlarm') : '', 'warn')];
    /* the power chain: mains, the transfer switch, the generator and the UPS, the critical loads they serve; each box in its state now */
    const node = (k, st, title, state, lines, tab) => `<div class="pcnode" data-st="${st}"><button class="pchead" ${tab ? `data-act="pfTab" data-v="${tab}"` : 'data-act="opsDrill" data-v="spPw" data-arg="aut"'}><span class="scdot" data-tone="${st === 'ok' ? 'ok' : st === 'warn' ? 'warn' : st === 'crit' ? 'crit' : 'mute'}"></span><span class="pctitle">${esc(title)}</span></button><b class="pcstate">${esc(state)}</b>${lines.map(x => `<span class="tCap">${esc(x)}</span>`).join('')}</div>`;
    const arrow = lbl => `<div class="pcarrow" aria-hidden="true"><span class="tCap">${esc(lbl || '')}</span></div>`;
    const loadsOf = l => `<ul class="pcloads">${l.slice().sort((p, q) => q.kw - p.kw).map(x => `<li><span>${esc(L(E, x.en, x.ar))}</span><span class="tMonoS">${fmt(x.kw, 0)} kW</span></li>`).join('')}</ul>`;
    const atsNormal = a.position === 'normal';
    const chain = `<div class="pchain" role="group" aria-label="${esc(t('sp.pw.chainAria'))}"><div class="pcrow">
      ${node('mains', atsNormal ? 'ok' : 'crit', t('sp.pw.n.mains'), t(atsNormal ? 'sp.pw.n.mainsOn' : 'sp.pw.n.mainsOff'), [t('sp.pw.n.mainsCap', { k: fmt(m.genKw, 0) })])}
      ${arrow()}
      ${node('ats', atsNormal ? 'ok' : 'warn', (a.id || 'ATS') + ' · ' + t('sp.pw.n.ats'), t(atsNormal ? 'sec.ats.normal' : 'sec.ats.emergency'), [a.lastTransferAgoD != null ? t('sp.pw.n.atsCap', { d: a.lastTransferAgoD, s: lt.transferS != null ? lt.transferS : t('emptyDash') }) : ''].filter(Boolean), 'gen')}
      ${arrow(t('sp.pw.n.onFail'))}
      <div class="pcstack">
        ${node('gen', running ? 'crit' : sc && sc.overdueD > 0 ? 'warn' : 'ok', (g.id || 'GEN') + ' · ' + t('sp.pw.n.gen'), t('sec.run.' + (g.run || 'standby')), [t('sp.pw.n.genCap', { s: lt.transferS != null ? lt.transferS : t('emptyDash'), f: g.fuelPct != null ? fmt(g.fuelPct, 0) : t('emptyDash'), h: m.autH != null ? fmt(m.autH, 0) : t('emptyDash') }), sc && sc.overdueD > 0 ? t('sp.pw.n.overdue', { d: sc.overdueD }) : ''].filter(Boolean), 'gen')}
        ${node('ups', ur && ur.over ? 'warn' : 'ok', (u.id || 'UPS') + ' · ' + t('sp.pw.n.ups'), u.mode ? t('sp.pw.mode.' + u.mode) : t('emptyDash'), [t('sp.pw.n.upsCap', { l: u.loadPct != null ? fmt(u.loadPct, 0) : t('emptyDash'), r: u.runtimeMin != null ? fmt(u.runtimeMin, 0) : t('emptyDash') }), ur && ur.over ? t('sp.pw.n.upsRoom', { c: fmt(ur.tempC, 1), l: fmt(ur.limitC, 1) }) : ''].filter(Boolean), 'ups')}
      </div></div>
      <div class="pcarrow pcdown" aria-hidden="true"></div>
      <div class="pcsplit">
        <div class="pcnode pcboard" data-st="ok"><span class="pctitle">${esc(t('sp.pw.n.genLoads', { k: fmt(m.genKw - upsKw, 0) }))}</span>${loadsOf(genOnly)}</div>
        <div class="pcnode pcboard" data-st="ok"><span class="pctitle">${esc(t('sp.pw.n.upsLoads', { k: fmt(upsKw, 0) }))}</span>${loadsOf(m.loads.filter(l => l.on === 'ups'))}</div>
      </div></div>`;
    const dl = rows => `<dl class="secdl">${rows.map(([k, v]) => `<dt>${esc(t(k))}</dt><dd>${v}</dd>`).join('')}</dl>`;
    const G = window.EKO_FRAME.group;
    const gen = widget(E, t('sp.pw.genT'), L(E, g.en, g.ar), dl([['sec.c.run', esc(t('sec.run.' + (g.run || 'standby')))],
      ['sp.pw.lastTest', esc(sc ? t('sp.pw.lastTestV2', { l: sc.last, r: t('sec.test.' + (lt.result || 'pass')), p: lt.loadPct }) : t('emptyDash'))],
      ['sp.pw.nextTest', esc(sc ? t(sc.overdueD > 0 ? 'sp.pw.nextTestOver' : 'sp.pw.nextTestV', { n: sc.next, d: sc.overdueD }) : t('emptyDash')) + (sc && sc.overdueD > 0 ? ' ' + chip(t('sp.pw.testDue')) : '')],
      ['sp.pw.xfer', esc(lt.transferS != null ? t('sp.pw.xferV', { s: lt.transferS, g: tgt != null ? tgt : t('emptyDash') }) : t('emptyDash')) + (tgt != null ? ` <span class="tCap">(${esc(L(E, pw.transferTargetNoteEn, pw.transferTargetNoteAr))})</span>` : '')],
      ['sp.pw.fuel', esc(t('sp.pw.fuelV', { p: g.fuelPct, l: m.fuelL != null ? fmt(m.fuelL, 0) : t('emptyDash'), t: g.tankL != null ? fmt(g.tankL, 0) : t('emptyDash') }))],
      ['sp.pw.aut', m.autH != null ? esc(t('sp.pw.autV', { h: fmt(m.autH, 1), r: fmt(m.lph, 0) })) : O().val(E, { v: null, why: t('sp.pw.autNone') })],
      ['sp.pw.batt', g.startBatteryV != null ? esc(t('sp.pw.battV', { v: fmt(g.startBatteryV, 1), s: t(g.startBatteryOk ? 'sp.pw.ok' : 'sp.pw.low') })) : O().val(E, { v: null })]]));
    const roomRow = ur ? [['sp.pw.upsRoom', `<span class="secpst" data-st="${ur.over ? 'fault' : 'normal'}"><span class="secdot"></span>${esc(t(ur.over ? 'sp.pw.upsRoomOver' : 'sp.pw.upsRoomOk', { c: fmt(ur.tempC, 1), l: fmt(ur.limitC, 1) }))}</span>`
      + (ur.over ? ` <span class="tCap">${esc(t('sp.pw.upsRoomCause'))}</span>` + (ur.wo ? ` <button class="statlink tMonoS" data-act="woOpen" data-asset="${esc(u.id)}">${esc(ur.wo)}</button>` : '') + ` <button class="statlink" data-act="openAsset" data-asset="${esc(u.id)}">${esc(t('sp.pw.upsRoomAlarm'))}</button>` : '')]] : [];
    const ups = widget(E, t('sp.pw.upsT'), L(E, u.en, u.ar), dl([['sp.pw.mode', esc(u.mode ? t('sp.pw.mode.' + u.mode) : t('emptyDash'))], ['sec.c.load', u.loadPct != null ? esc(fmt(u.loadPct, 0) + '%') + (u.ratingKva ? ` <span class="tCap">${esc(t('sp.pw.ofKva', { k: u.ratingKva }))}</span>` : '') : O().val(E, { v: null })],
      ['sp.pw.health', u.healthPct != null ? esc(fmt(u.healthPct, 0) + '%') : O().val(E, { v: null, why: t('sp.pw.healthNone') })], ['sec.c.runtime', u.runtimeMin != null ? esc(t('sp.pw.rtV', { m: u.runtimeMin })) : O().val(E, { v: null, why: t('sp.pw.rtNone') })]].concat(roomRow))
      + `<h4 class="tLbl">${esc(t('sec.pw.atsT'))}</h4>` + dl([['sec.c.position', `<span class="secpst" data-st="${atsNormal ? 'normal' : 'alarm'}"><span class="secdot"></span>${esc(t(atsNormal ? 'sec.ats.normal' : 'sec.ats.emergency'))}</span>`], ['sec.c.when', esc(a.lastTransferAgoD != null ? t('sec.pw.lastTransfer', { d: a.lastTransferAgoD }) : t('emptyDash'))]]));
    const tests = widget(E, t('sp.pw.testsT'), sc ? t('sp.pw.testsCap', { l: sc.last, n: sc.next, i: sc.intervalD }) : '', O().table(E, ['sp.c.date', 'sp.c.kind', 'p2.c.transfer', 'sp.c.result'], (pw.genTests || []).map(q => `<tr><td class="tMonoS">${esc(q.date)}</td><td class="tCap">${esc(L(E, q.type, q.typeAr))}</td><td class="tMonoS">${q.transferS != null ? esc(q.transferS + ' s') : esc(t('emptyDash'))}</td><td><span class="secres" data-r="${esc(q.result)}">${esc(t('sec.test.' + q.result))}</span></td></tr>`).join('')), t('sp.src.power'));
    return `<div class="pwarea secpage sppage" data-pg="sec-power">${hl}<div class="pwhero" style="grid-template-columns:repeat(${heroes.length},1fr)">${heroes.join('')}</div>`
      + `<div data-frame="visual">${widget(E, t('sp.pw.chainT'), '', chain, pw.placeEn ? L(E, pw.placeEn, pw.placeAr) : '')}</div>`
      + G('gen', t('sp.pw.tab.gen'), gen) + G('ups', t('sp.pw.tab.ups'), ups) + G('tests', t('sp.pw.tab.tests'), tests) + `</div>`;
  }

  /* ================================= drill-downs ================================= */
  const O2 = () => window.EKO_OPS;
  if(O2()){
    O2().drill('spCam', (E, id) => camDetail(E, id));
    O2().drill('spCams', (E, k) => { const t = E.t.bind(E), x = X(E), all = D(E).cameras || [];
      const l = all.filter(c => k === 'on' ? c.online !== false : k === 'off' ? c.online === false : c.online === false || c.recording === false);
      return { title: t('sp.cam.list.' + k), body: O2().table(E, ['sp.c.cam', 'sp.c.room', 'sp.c.level', 'sec.c.state', 'sp.c.offSince'], l.map(c => `<tr><th scope="row"><button class="opsdoor tMonoS" data-act="secCam" data-v="${esc(c.id)}">${esc(c.id)}</button></th><td class="tCap">${esc(c.room || '')}</td><td>${esc(x.storeyName(c.storey))}</td><td>${esc(t('sp.cam.st.' + camState(c)))}</td><td class="tMonoS">${c.online === false ? esc(clockAgo(E, c.offlineSinceMin || 0) + ' · ' + age(E, c.offlineSinceMin || 0)) : esc(t('emptyDash'))}</td></tr>`).join('')),
        method: t('sp.m.cams') }; });
    O2().drill('spDoorsOut', (E, z) => { const t = E.t.bind(E), x = X(E), l = (D(E).doors || []).filter(r => r.zone === z && !r.covered);
      return { title: t('sp.cam.outT', { z: x.zoneName(z) }), body: O2().table(E, ['sec.c.door', 'sp.c.level', 'sp.c.where'], l.map(r => `<tr><th scope="row"><span class="tMonoS">${esc(r.id)}</span> <span class="tCap">${esc(L(E, r.en, r.ar))}</span></th><td>${esc(x.storeyName(r.storey))}</td><td>${locBtn(E, { v: r.gid, st: r.storey })}</td></tr>`).join('')),
        method: L(E, D(E).coverage.noteEn, D(E).coverage.noteAr) + '. ' + t('sp.m.cov') }; });
    O2().drill('spDoors', (E, k) => { const t = E.t.bind(E), x = X(E), dr = D(E).doors || [];
      const l = dr.filter(r => k === 'ns' ? NOTSECURE.includes(r.state) : k === 'offline' ? r.online === false : r.state === k);
      return { title: t('sp.acc.listT', { s: k === 'ns' ? t('sp.acc.ns') : t('sp.ds.' + k) }), body: O2().table(E, ['sec.c.door', 'sec.c.zone', 'sec.c.state', 'sp.c.where'], l.map(r => `<tr><th scope="row"><span class="tMonoS">${esc(r.id)}</span> <span class="tCap">${esc(L(E, r.en, r.ar))}</span></th><td>${esc(x.zoneName(r.zone))}</td><td>${esc(t('sp.ds.' + r.state))}</td><td>${locBtn(E, { v: r.gid, st: r.storey })}</td></tr>`).join('')),
        method: t('sp.m.doors') }; });
    O2().drill('spDoor', (E, id) => { const t = E.t.bind(E), x = X(E), r = (D(E).doors || []).find(q => q.id === id) || {}, ev = x.accessEvents().filter(e => e.door === id), st = r.online === false ? 'offline' : r.state;
      return { title: id + ' · ' + roomOf(E, r), body: `<dl class="secdl"><dt>${esc(t('sec.c.state'))}</dt><dd>${esc(t('sp.ds.' + st))}</dd><dt>${esc(t('sp.c.level'))}</dt><dd>${esc(x.storeyName(r.storey))}</dd><dt>${esc(t('sec.c.zone'))}</dt><dd>${esc(x.zoneName(r.zone))}</dd>
        <dt>${esc(t('sp.cam.inView'))}</dt><dd>${esc(t(r.covered ? 'sp.acc.covYes' : 'sp.acc.covNo'))}</dd></dl>`
        + O2().table(E, ['sec.c.when', 'sp.c.event'], ev.map(e => `<tr><td class="tMonoS">${esc(clockAgo(E, e.agoMin || 0))}</td><th scope="row">${esc(x.evTitle(e))}</th></tr>`).join(''), 'sec.acc.noneToday') + `<div class="row gap6">${locBtn(E, { v: r.gid, st: r.storey })}</div>`, method: t('sp.m.doors') }; });
    O2().drill('spAccToday', E => { const t = E.t.bind(E), a = D(E).access || {};
      return { title: t('sp.acc.today'), body: `<dl class="secdl"><dt>${esc(t('sp.acc.granted'))}</dt><dd class="tMonoS">${fmt(a.grantedToday || 0, 0)}</dd><dt>${esc(t('sp.acc.denied'))}</dt><dd class="tMonoS">${fmt(a.deniedToday || 0, 0)}</dd><dt>${esc(t('sp.acc.flagged'))}</dt><dd class="tMonoS">${(a.events || []).length}</dd></dl>`, method: t('sp.m.today') }; });
    O2().drill('spAccWeek', E => { const t = E.t.bind(E), w = (D(E).access || {}).week || {};
      return { title: t('sp.acc.weekT'), body: O2().table(E, ['sp.c.day', 'sec.k.forced', 'sec.k.held', 'sec.k.tailgate', 'sp.kpi.heldMin'], (w.forced || []).map((_, i) => `<tr><th scope="row">${esc(dayLbl(E, E.nowMs() - (6 - i) * 86400000))}</th><td class="tMonoS">${w.forced[i]}</td><td class="tMonoS">${(w.held || [])[i]}</td><td class="tMonoS">${(w.tailgate || [])[i]}</td><td class="tMonoS">${fmt((w.heldMin || [])[i], 1)}</td></tr>`).join('')), method: t('sp.m.week') }; });
    O2().drill('spFire', (E, k) => { const t = E.t.bind(E), x = X(E), f = D(E).fire || {}, iv = f.testIntervalMonths || 12;
      if(k === 'tests' || /^overdue/.test(k)){ const lv = k.split(':')[1], l = (f.deviceTests || []).filter(q => (!lv || q.storey === lv) && (k === 'tests' || q.monthsAgo > iv)).sort((a, b) => b.monthsAgo - a.monthsAgo);
        return { title: t(k === 'tests' ? 'sp.fi.testT' : 'sp.fi.overT'), body: O2().table(E, ['sec.c.device', 'sp.c.level', 'sp.c.tested', 'sp.c.where'], l.map(q => `<tr><th scope="row" class="tMonoS">${esc(q.id)}</th><td>${esc(x.storeyName(q.storey))}</td><td class="tMonoS">${esc(t('sp.fi.monthsAgo', { m: q.monthsAgo }))}${q.monthsAgo > iv ? ' ' + chip(t('sp.c.overdue'), 'crit') : ''}</td><td>${locBtn(E, { v: q.gid, st: q.storey })}</td></tr>`).join('')), method: t('sp.m.tests', { m: iv }) }; }
      if(k === 'iso') return { title: t('sp.fi.iso'), body: O2().table(E, ['sec.c.device', 'sec.c.reason', 'sec.c.since', 'sp.c.expires'], (f.isolations || []).map(i => `<tr><th scope="row" class="tMonoS">${esc(i.device)}</th><td class="tCap">${esc(L(E, i.reasonEn, i.reasonAr))}</td><td class="tMonoS">${esc(E.fmtAge(i.agoH))}</td><td class="tMonoS">${esc(i.expiresInH != null ? t('sp.fi.expIn', { h: i.expiresInH }) : t('sp.fi.noExp'))}</td></tr>`).join('')), method: t('sp.m.iso') };
      const l = x.fireEvents().filter(e => e.kind === k && e.active !== false);
      return { title: t('sp.fi.' + (k === 'alarm' ? 'active' : k === 'pre' ? 'pre' : 'faults')), body: O2().table(E, ['sec.c.when', 'sp.c.event', 'sec.c.device', 'sp.c.where'], l.map(e => `<tr><td class="tMonoS">${esc(clockAgo(E, e.agoMin || 0))}</td><th scope="row">${esc(x.evTitle(e))}</th><td class="tMonoS">${esc(e.device || '')}</td><td>${e.gid ? locBtn(E, { v: e.gid, st: e.storey }) : ''}</td></tr>`).join(''), 'sp.fi.noSeq'), method: t('sp.m.fire') }; });
    O2().drill('spPw', (E, k) => { const t = E.t.bind(E), m = powerModel(E);
      if(k === 'aut') return { title: t('sp.pw.aut'), body: `<dl class="secdl"><dt>${esc(t('sp.pw.critLoad'))}</dt><dd class="tMonoS">${fmt(m.genKw, 0)} kW · ${m.loadPct != null ? fmt(m.loadPct, 0) : t('emptyDash')}%</dd><dt>${esc(t('sp.pw.burn'))}</dt><dd class="tMonoS">${m.lph != null ? fmt(m.lph, 0) + ' L/h' : t('emptyDash')}</dd>
          <dt>${esc(t('sp.pw.fuel'))}</dt><dd class="tMonoS">${m.fuelL != null ? fmt(m.fuelL, 0) + ' L' : t('emptyDash')}</dd><dt>${esc(t('sp.pw.aut'))}</dt><dd class="tMonoS">${m.autH != null ? fmt(m.autH, 1) + ' h' : t('emptyDash')}</dd></dl>`
          + O2().table(E, ['sp.c.loadPct', 'sp.c.lph'], (m.g.burnCurve || []).map(p => `<tr><td class="tMonoS">${p[0]}%</td><td class="tMonoS">${p[1]}</td></tr>`).join('')), method: t('sp.m.aut') };
      if(k === 'ups') return { title: t('sp.pw.upsRt'), body: `<p>${esc(m.u.runtimeMin != null ? t('sp.pw.rtV', { m: m.u.runtimeMin }) : t('sp.pw.rtNone'))}</p>`, method: t('sp.m.ups') };
      return { title: t('sp.pw.gen'), body: O2().table(E, ['sp.c.date', 'sp.c.kind', 'sp.c.result'], (m.pw.genTests || []).map(q => `<tr><td class="tMonoS">${esc(q.date)}</td><td class="tCap">${esc(L(E, q.type, q.typeAr))}</td><td>${esc(t('sec.test.' + q.result))}</td></tr>`).join('')), method: t('sp.m.gen') }; });
  }

  /* ================================== actions ================================== */
  const ACTS = {
    spCamF(el){ const E = window.EKO, [k, v] = el.dataset.v.split(':'), f = Object.assign({}, E.state.spCam || {});
      if(k === 'pg') f.pg = Math.max(0, +v || 0); else { f[k] = v; if(k !== 'map') f.pg = 0; if(k === 'lv' && v !== 'all') f.map = v; } E.set({ spCam: f }); },
    spCamZone(el){ const E = window.EKO; E.set({ spCam: Object.assign({}, E.state.spCam || {}, { zn: el.value, pg: 0 }) }); },
    spFireLv(el){ window.EKO.set({ spFireLv: el.dataset.v }); },
    spFireZone(el){ const E = window.EKO, z = ((D(E).fire || {}).zones || []).find(q => q.id === el.dataset.v); E.set({ spFireZone: E.state.spFireZone === el.dataset.v ? null : el.dataset.v, spFireLv: z ? z.storey : E.state.spFireLv }); },
    spAccLv(el){ window.EKO.set({ spAccLv: el.dataset.v }); },
    /* rule 4: the item's level isolated, the camera flies to it; a fire zone as a volume, a camera with its cone */
    spLocate(el){ const E = window.EKO, d = el.dataset; if(E.engine && E.engine.setLabels) E.engine.setLabels(null); E.state.dlg = null; E.state.opsDrill = null; E.state.secDlg = null; E.state.evac3d = null;
      if(d.st && E.state.dock) E.state.dock.level = d.st;
      E.go('sec', 'security', null);
      let n = 0; const go = () => { const eng = E.engine; if(!(eng && eng.ready && eng.ready())){ if(n++ < 60) setTimeout(go, 100); return; }
        const z = d.zone && ((D(E).fire || {}).zones || []).find(q => q.id === d.zone), c = d.cam && (D(E).cameras || []).find(q => q.id === d.cam);
        if(eng.setRoutes) eng.setRoutes(null);
        if(eng.setZoneVolume) eng.setZoneVolume(z ? { spaces: z.spaces, storey: z.storey, color: 'var(--sevCrit)' } : null);
        if(eng.setCones && c){ eng.setCones({ cams: [{ gid: c.gid, fovDeg: D(E).coverage.fovDeg, depthM: D(E).coverage.depthM }], occlusion: true }); eng._conesKey = 'loc'; }
        const gid = d.v || (z && z.spaces && z.spaces[0]);
        if(z && eng.flyToGids) eng.flyToGids(z.spaces); else if(gid && eng.flyToGid){ eng.flyToGid(gid); if(eng.highlightGid) eng.highlightGid(gid); } };
      setTimeout(go, 60); }
  };
  return { applies, camsPage, accessPage, firePage, powerPage, camDetail, powerModel, genSched, levelPlan, ACTS };
})();
