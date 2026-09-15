/* ============================================================================
   ESTATE MAP (D103 stage 3) — the secondary view of the portfolio. A
   schematic projection of the sites (equirectangular over the estate's own
   bounding box; the prototype ships no basemap tiles), markers in the alarm
   severity shape vocabulary, sites that overlap clustered with the worst
   severity and the count. The table stays the primary view: everything on
   the map is also a row.
   ============================================================================ */
window.EKO_MAP = (function(){
  'use strict';
  const C = () => window.EKO_C, EST = () => window.EKO_EST;
  const esc = s => C().esc(s);
  const W = 1000, H = 560;
  const SEVC = { critical: 'var(--sevCrit)', high: 'var(--sevHigh)', medium: 'var(--sevMed)' };

  /* projection over ALL sites (filters never re-scale the map) */
  function projection(all){
    const pad = (EST().cfg().mapPadPct || 8) / 100;
    const lats = all.map(s => s.lat), lons = all.map(s => s.lon);
    const la0 = Math.min(...lats), la1 = Math.max(...lats), lo0 = Math.min(...lons), lo1 = Math.max(...lons);
    const k = Math.cos((la0 + la1) / 2 * Math.PI / 180);
    const spanX = Math.max(1e-6, (lo1 - lo0) * k), spanY = Math.max(1e-6, la1 - la0);
    const sc = Math.min(W * (1 - 2 * pad) / spanX, H * (1 - 2 * pad) / spanY);
    const ox = (W - spanX * sc) / 2, oy = (H - spanY * sc) / 2;
    return { x: s => ox + (s.lon - lo0) * k * sc, y: s => H - (oy + (s.lat - la0) * sc), xy: (lat, lon) => [ox + (lon - lo0) * k * sc, H - (oy + (lat - la0) * sc)] };
  }
  /* view: {scale, cx, cy} in projection units; screen = (p - c) * scale + centre */
  const view = E => E.state.pfMap || { scale: 1, cx: W / 2, cy: H / 2 };
  const toScreen = (v, x, y) => [(x - v.cx) * v.scale + W / 2, (y - v.cy) * v.scale + H / 2];

  /* greedy clustering in screen units: a site joins the first cluster within the radius */
  function clusters(rows, proj, v){
    const r = EST().cfg().clusterRadius || 26, out = [];
    rows.forEach(s => {
      const [x, y] = toScreen(v, proj.x(s), proj.y(s));
      let c = null; for(const k of out){ if(Math.hypot(k.x - x, k.y - y) <= r){ c = k; break; } }
      if(c){ c.sites.push(s); c.x = (c.x * (c.sites.length - 1) + x) / c.sites.length; c.y = (c.y * (c.sites.length - 1) + y) / c.sites.length; }
      else out.push({ x, y, sites: [s] });
    });
    out.forEach(c => { c.worst = ['critical', 'high', 'medium'].find(sev => c.sites.some(s => s.worstSev === sev)) || null; c.notReporting = c.sites.filter(s => !s.telemetry).length; c.count = c.sites.length; c.alarms = c.sites.reduce((a, s) => a + s.alarmCount, 0); });
    return out;
  }

  function shape(sev, size, telemetry){
    if(!telemetry) return `<circle r="${size * .55}" fill="var(--s1)" stroke="var(--t3)" stroke-width="2" stroke-dasharray="3 2"/>`;
    if(!sev) return `<circle r="${size * .32}" fill="var(--pos)" stroke="rgba(0,0,0,.5)" stroke-width="1"/>`;
    const c = SEVC[sev], h = size * .55;
    if(sev === 'critical') return `<circle r="${h}" fill="${c}" stroke="rgba(0,0,0,.5)" stroke-width="1"/>`;
    if(sev === 'high') return `<polygon points="0,${-h} ${h},${h * .85} ${-h},${h * .85}" fill="${c}" stroke="rgba(0,0,0,.5)" stroke-width="1" stroke-linejoin="round"/>`;
    return `<rect x="${-h * .9}" y="${-h * .9}" width="${h * 1.8}" height="${h * 1.8}" rx="2" fill="${c}" stroke="rgba(0,0,0,.5)" stroke-width="1"/>`;
  }

  function render(E, rows, all){
    const t = E.t.bind(E), ar = E.lang === 'ar', proj = projection(all), v = view(E), cl = clusters(rows, proj, v);
    const D = window.EKO_DATA.estate;
    const labels = D.clusters.map(c => { const [x, y] = toScreen(v, ...proj.xy(c.lat, c.lon)); return `<text class="pfmlbl" x="${x.toFixed(1)}" y="${(y - 18).toFixed(1)}" text-anchor="middle">${esc(ar ? c.ar : c.en)}</text>`; }).join('');
    const grid = [];
    for(let i = 1; i < 10; i++) grid.push(`<line x1="${W / 10 * i}" y1="0" x2="${W / 10 * i}" y2="${H}"/>`);
    for(let i = 1; i < 6; i++) grid.push(`<line x1="0" y1="${H / 6 * i}" x2="${W}" y2="${H / 6 * i}"/>`);
    const marks = cl.map(c => {
      if(c.count === 1){ const s = c.sites[0]; const name = ar ? s.nameAr : s.nameEn;
        const lbl = s.telemetry ? (s.worstSev ? t('pfMkTip', { site: name, n: s.alarmCount, sev: t('rpSev.' + s.worstSev) }) : t('pfMkOk', { site: name })) : t('pfMkNot', { site: name, state: t('pfRep.' + s.state) });
        return `<g class="pfmk" data-act="pfCard" data-site="${esc(s.id)}" data-on="${E.state.pfCard === s.id}" transform="translate(${c.x.toFixed(1)},${c.y.toFixed(1)})" role="button" tabindex="0" aria-label="${esc(lbl)}"><title>${esc(lbl)}</title>${shape(s.worstSev, 22, s.telemetry)}</g>`; }
      const fill = c.worst ? SEVC[c.worst] : (c.notReporting === c.count ? 'var(--t3)' : 'var(--pos)');
      const lbl = t('pfCluTip', { n: c.count, a: c.alarms, nr: c.notReporting });
      return `<g class="pfclu" data-act="pfZoom" data-x="${c.x.toFixed(1)}" data-y="${c.y.toFixed(1)}" transform="translate(${c.x.toFixed(1)},${c.y.toFixed(1)})" role="button" tabindex="0" aria-label="${esc(lbl)}"><title>${esc(lbl)}</title>
        <circle r="15" fill="${fill}" stroke="rgba(0,0,0,.5)" stroke-width="1"/><text y="4" text-anchor="middle">${c.count}</text>${c.notReporting ? `<circle class="pfnr" cx="11" cy="-11" r="5" fill="var(--s1)" stroke="var(--t3)" stroke-width="1.5" stroke-dasharray="2 1.5"/>` : ''}</g>`;
    }).join('');
    const card = E.state.pfCard ? cardFor(E, rows.find(s => s.id === E.state.pfCard) || EST().site(E, E.state.pfCard), proj, v) : '';
    return `<div class="pfmapwrap" data-act="pfCardClose" role="region" aria-label="${esc(t('pfView.map'))}">
      <div class="pfmapbar"><span class="tCap">${esc(t('pfMapNote'))}</span><span class="grow"></span>
        <button class="btnG btnSm" data-act="pfZoomBtn" data-v="in">${esc(t('pfMapZoomIn'))}</button><button class="btnG btnSm" data-act="pfZoomBtn" data-v="out">${esc(t('pfMapZoomOut'))}</button><button class="btnG btnSm" data-act="pfZoomBtn" data-v="reset" ${v.scale === 1 ? 'disabled' : ''}>${esc(t('pfMapReset'))}</button></div>
      <div class="pfmapbox"><svg class="pfmap" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" aria-hidden="false" role="img" aria-label="${esc(t('pfMapAria', { n: rows.length }))}"><g class="pfgrid">${grid.join('')}</g>${labels}${marks}</svg>${card}</div>
      <div class="pfmaplegend"><span>${C().sevGlyph('critical', false, 12, true)} ${esc(t('rpSev.critical'))}</span><span>${C().sevGlyph('high', false, 12, true)} ${esc(t('rpSev.high'))}</span><span>${C().sevGlyph('medium', false, 12, true)} ${esc(t('rpSev.medium'))}</span><span><svg width="12" height="12" viewBox="-6 -6 12 12" aria-hidden="true"><circle r="4" fill="var(--pos)"/></svg> ${esc(t('pfMkLegendOk'))}</span><span><svg width="12" height="12" viewBox="-6 -6 12 12" aria-hidden="true"><circle r="4.5" fill="none" stroke="var(--t3)" stroke-width="1.5" stroke-dasharray="2 1.5"/></svg> ${esc(t('pfMkLegendNot'))}</span></div>
    </div>`;
  }

  /* the marker card: the same anatomy as a row, plus Open site */
  function cardFor(E, s, proj, v){
    if(!s) return '';
    const t = E.t.bind(E), ar = E.lang === 'ar', [x, y] = toScreen(v, proj.x(s), proj.y(s));
    const PF = window.EKO_PF;
    /* the marker's position as custom properties; CSS clamps the card's
       horizontal extent inside the box and after() flips it above the
       marker when it would run out of the bottom (D122) */
    const left = Math.max(0, Math.min(100, x / W * 100)), top = Math.max(0, Math.min(100, y / H * 100));
    return `<div class="pfcard" style="--x:${left.toFixed(1)}%;--y:${top.toFixed(1)}%" role="dialog" aria-label="${esc(ar ? s.nameAr : s.nameEn)}" data-act="none">
      <div class="pfcardh"><span class="pfsite">${C().icon(EST().typeOf(s.type).icon || 'home', 13)} <b>${esc(ar ? s.nameAr : s.nameEn)}</b></span><button class="iconbtn" data-act="pfCardClose" aria-label="${esc(t('close'))}">${C().icon('x', 12)}</button></div>
      <div class="pfcardl">${PF.repChip(E, s)}${PF.sevCell(E, s)}</div>
      <div class="pfcardl">${PF.kpiCell(E, s)}</div>
      <div class="pfcardl tCap">${esc(t('pfc.wos'))}: ${s.wos.open}${s.wos.overdue ? ' · ' + esc(t('pfWoOverdue', { n: s.wos.overdue })) : ''} · ${esc(PF.agoText(E, s))}</div>
      <div class="pfcarda"><button class="btnP btnSm" data-act="siteGo" data-site="${esc(s.id)}">${esc(t('pfOpenSite'))}</button></div></div>`;
  }

  /* after a render: keep the open card inside the map box vertically —
     below the marker when it fits, above it otherwise, pinned to the top
     edge when neither fits (computed geometry, hence an attribute) */
  function after(){
    const card = document.querySelector('.pfcard'), box = card && card.closest('.pfmapbox');
    if(!card || !box) return;
    delete card.dataset.flip;
    const b = box.getBoundingClientRect(); let r = card.getBoundingClientRect();
    if(r.bottom > b.bottom - 4){ card.dataset.flip = '1'; r = card.getBoundingClientRect(); if(r.top < b.top + 4) card.dataset.flip = '2'; }
  }
  return { render, projection, clusters, after, W, H };
})();
