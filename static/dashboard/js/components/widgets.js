/* ============================================================================
   EKO component library — pure render functions, structure and geometry
   carried from the approved reference (see /docs/parity-diff.md). No
   component holds state; no visible string or number lives here: strings
   come from /js/i18n, numbers from /js/data, composition from /js/layouts.
   Interactivity is declared with data-act attributes; app.js delegates.
   ============================================================================ */
window.EKO_C = (function(){
  'use strict';

  const esc = s => String(s ?? '').replace(/[&<>"']/g,
    c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  /* Drop extra digits; 73.958 → 73.9. Counts pass d=0. */
  function truncDec(n, d){
    const x = Number(n);
    if(!isFinite(x)) return NaN;
    if(d <= 0) return Math.trunc(x + (x < 0 ? -1e-9 : 1e-9));
    const f = Math.pow(10, d);
    return Math.trunc(x * f + (x < 0 ? -1e-9 : 1e-9)) / f;
  }
  const fmt = (n, d=1) => {
    if(n == null || n === '') return '--';
    const t = truncDec(n, d);
    if(!isFinite(t)) return '--';
    return t.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  };

  /* ------------------------------- icon set ------------------------------- */
  const IC = {
    home:'<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
    grid:'<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M15 2v2"/><path d="M15 20v2"/><path d="M2 15h2"/><path d="M2 9h2"/><path d="M20 15h2"/><path d="M20 9h2"/><path d="M9 2v2"/><path d="M9 20v2"/>',
    bolt:'<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
    drop:'<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>',
    meter:'<path d="M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"/><path d="m13.4 10.6 4.6-4.6"/><path d="M3.3 17A9 9 0 1 1 20.7 17"/>',
    droplet:'<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/>',
    flame:'<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
    flame:'<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
    gauge:'<path d="M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"/><path d="m13.4 10.6 4.6-4.6"/><path d="M3.3 17A9 9 0 1 1 20.7 17"/>',
    wind:'<path d="M17.7 7.7a2.5 2.5 0 1 1 1.8 4.3H2"/><path d="M9.6 4.6A2 2 0 1 1 11 8H2"/><path d="M12.6 19.4A2 2 0 1 0 14 16H2"/>',
    box:'<path d="M21 8 12 3 3 8v8l9 5 9-5V8Z"/><path d="M3 8l9 5 9-5"/><path d="M12 13v8"/>',
    layout:'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/>',
    columns:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/><path d="M15 4v16"/>',
    bookmark:'<path d="M6 3h12v18l-6-4-6 4Z"/>',
    nohist:'<path d="M5 12h3"/><path d="M10.5 12h3"/><path d="M16 12h3"/>',
    monitor:'<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8"/><path d="M12 16v4"/>',
    settings:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    wrench:'<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
    shield:'<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
    leaf:'<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6"/>',
    search:'<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>',
    bell:'<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    doc:'<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v5h5"/><path d="M16 13H8M16 17H8"/>',
    chevD:'<path d="m6 9 6 6 6-6"/>',
    chevU:'<path d="m18 15-6-6-6 6"/>',
    chevR:'<path d="m9 6 6 6-6 6"/>',
    chevL:'<path d="m15 18-6-6 6-6"/>',
    chevL2:'<path d="m11 17-5-5 5-5"/><path d="m18 17-5-5 5-5"/>',
    chevR2:'<path d="m13 17 5-5-5-5"/><path d="m6 17 5-5-5-5"/>',
    check:'<path d="m4 12.5 5 5L20 6.5"/>',
    clock:'<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon:'<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
    logout:'<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
    lock:'<rect x="4" y="11" width="16" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    x:'<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    thumbUp:'<path d="M7 11v9H4a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3Z"/><path d="M7 11l4-7a2 2 0 0 1 2 2v4h5a2 2 0 0 1 2 2.3l-1.2 6A2 2 0 0 1 16.8 20H7"/>',
    thumbDown:'<path d="M17 13V4h3a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-3Z"/><path d="M17 13l-4 7a2 2 0 0 1-2-2v-4H6a2 2 0 0 1-2-2.3l1.2-6A2 2 0 0 1 7.2 4H17"/>',
    eye:'<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>',
    toolbar:'<rect x="3" y="8" width="18" height="8" rx="3"/><path d="M8 12h.01"/><path d="M12 12h.01"/><path d="M16 12h.01"/>',
    warn:'<path d="M12 3 2.5 20h19L12 3Z"/><path d="M12 10v4"/><path d="M12 17.5h.01"/>',
    eyeOff:'<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/><path d="m3 3 18 18"/>',
    cursor:'<path d="m4 4 7 16 2-7 7-2L4 4Z"/>',
    ruler:'<path d="m3 17 14-14 4 4L7 21l-4-4Z"/><path d="m8 12 1.5 1.5"/><path d="m11 9 1.5 1.5"/><path d="m14 6 1.5 1.5"/>',
    slice:'<path d="M3 12h18"/><path d="M5 12V5h14v7"/><path d="M8 19h8"/>',
    levels:'<rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M5 8.5h14M5 13h14M5 17.5h14"/>',
    layers:'<path d="m12 2 9 4.9-9 4.9-9-4.9Z"/><path d="m3 11.9 9 4.9 9-4.9"/><path d="m3 16.9 9 4.9 9-4.9"/>',
    map:'<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 12h6v8"/><path d="M14 4v6h6"/>',
    palette:'<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18Z" fill="currentColor" stroke="none"/>',
    reset:'<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>',
    tools:'<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
    maximize:'<path d="M4 9V5a1 1 0 0 1 1-1h4"/><path d="M15 4h4a1 1 0 0 1 1 1v4"/><path d="M20 15v4a1 1 0 0 1-1 1h-4"/><path d="M9 20H5a1 1 0 0 1-1-1v-4"/>',
    copy:'<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
    dots:'<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>',
    filter:'<path d="M3 5h18l-7 8v6l-4 2v-8L3 5Z"/>',
    plus:'<path d="M12 5v14"/><path d="M5 12h14"/>',
    trash:'<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>',
    spark:'<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z"/><path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z"/>',
    undo:'<path d="M3 7v6h6"/><path d="M3.5 13a9 9 0 1 0 2.6-7.4L3 7"/>',
    download:'<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 21h16"/>',
    external:'<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    help:'<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>' 
  };
  /* pathLength="60" normalises every primitive to the same nominal length,
     so the nav draw-on (stroke-dasharray:60) is one clean stroke per shape
     at a uniform speed — without it, short paths snap in and long paths
     render as marching dashes. */
  const PLEN = g => g.replace(/<(path|rect|circle|line|polyline|polygon|ellipse)\b/g, '<$1 pathLength="60"');
  const icon = (k, s=16, sw=1.75) =>
    `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PLEN(IC[k]||'')}</svg>`;

  /* -------------------------- severity glyphs ------------------------------
     Colour AND shape AND text together (spec law, values from the reference):
     critical = filled red circle, high = filled amber triangle, medium =
     filled yellow square. Acknowledged = same shape hollow with a horizontal
     bar. Panel size 13px with the reference's dark exclamation; markers are
     16px plain shapes with the 1px dark outline (spec: no glyph inside). */
  const SEV = {
    critical:{ c:'var(--sevCrit)', shape:'circ' },
    high:    { c:'var(--sevHigh)', shape:'tri' },
    medium:  { c:'var(--sevMed)',  shape:'sq' }
  };
  /* On the model these stay the bright hues. Light theme darkens --sevHigh and --sevMed for text chips. */
  const MARK = { critical:'var(--sevCrit)', high:'#F08A3C', medium:'#C4B03A' };
  function sevGlyph(sev, acked, px=13, marker=false, count){
    const s = SEV[sev] || SEV.medium, c = marker ? (MARK[sev] || MARK.medium) : s.c;
    const n = (count != null && count > 1) ? Number(count) : 0;
    const fill = acked ? 'none' : c;
    const stroke = marker ? 'rgba(0,0,0,0.5)' : c;
    const sw = marker ? 1 : 2.5;
    let shp, barY, numY;
    if(s.shape==='circ'){ shp = `<circle cx="12" cy="12" r="10" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`; barY = 12; numY = 16; }
    else if(s.shape==='tri'){ shp = `<polygon points="12,3 22.5,21 1.5,21" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"/>`; barY = 15.5; numY = 17.4; }
    else { shp = `<rect x="3.5" y="3.5" width="17" height="17" rx="2" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`; barY = 12; numY = 16; }
    const mark = (!marker && !acked && !n)
      ? (s.shape==='tri'
        ? `<path d="M12 10v4.4" stroke="#0B1020" stroke-width="2.8" stroke-linecap="round"/><path d="M12 18h.01" stroke="#0B1020" stroke-width="3" stroke-linecap="round"/>`
        : `<path d="M12 6.6v6.2" stroke="#0B1020" stroke-width="3" stroke-linecap="round"/><path d="M12 17.2h.01" stroke="#0B1020" stroke-width="3.2" stroke-linecap="round"/>`)
      : '';
    const bar = acked ? `<path d="M5.5 ${barY}h13" stroke="${c}" stroke-width="2.5" stroke-linecap="round"/>` : '';
    const num = n ? `<text x="12" y="${numY}" text-anchor="middle" font-size="${n>9?8:11}" font-weight="700" fill="#0B1020" font-family="JetBrains Mono,ui-monospace,monospace">${n}</text>` : '';
    return `<svg width="${px}" height="${px}" viewBox="0 0 24 24" aria-hidden="true">${shp}${mark}${bar}${num}</svg>`;
  }
  const sevAction = (E, sev) =>
    E.t(sev === 'critical' ? 'sevActNow' : sev === 'high' ? 'sevToday' : 'sevThisWeek');
  /* D78: every glyph and action word explains itself on hover */
  const sevName = (E, sev) => E.t(sev === 'critical' ? 'acCrit' : sev === 'high' ? 'acHigh' : 'acMed');
  const sevTipFor = (E, a) => a.ack ? E.t('sevTipAck', { s: sevName(E, a.sev) }) : sevName(E, a.sev) + ' · ' + sevAction(E, a.sev);
  const actTip = (E, sev) => E.t(sev === 'critical' ? 'actNowTip' : sev === 'high' ? 'todayTip' : 'weekTip');

  /* D119: the D105 "Show raw points" toggle is gone from the charts and the meter table (the client found it confusing); the asset panel's "Full analytics" table stays. */
  /* Smooth sparkline path (reference-style bezier through relative points). */
  /* D132: the sparkle — one glyph, one accent, one tooltip, every card and panel that can be asked about */
  const aiBtn = (E, label, cap, size, cls) => `<button class="${cls || 'wcb'} aibtn tipU" data-act="aiOpen" data-ai-label="${esc(label || '')}" data-ai-cap="${esc(cap || '')}" data-tip="${esc(E.t('ai.about'))}" aria-label="${esc(E.t('ai.about'))}">${icon('spark', size || 14)}</button>`;
  /* D132b: THE control cluster every card, tile and summary block carries, fixed at its top-right corner
     (CSS .wchrome): sparkle · expand · One glyph per action everywhere. */
  const ctl = (E, label, cap, o) => { o = o || {};   /* D132e: no drag grip — the layout is not editable at this phase */
    return `<span class="wchrome hst">${aiBtn(E, label, cap, 14, 'wcb').replace('data-act="aiOpen"', `data-act="aiOpen"${o.topic ? ` data-ai-topic="${esc(o.topic)}"` : ''}`)}<button class="wcb tipU" data-act="wmax" data-tip="${esc(E.t('mpExpand'))}" aria-label="${esc(E.t('mpExpand'))}">${icon('maximize', 14)}</button></span>`; };
  function sparkPath(vals, w=100, h=22){
    const mn = Math.min(...vals), mx = Math.max(...vals), span = (mx-mn)||1;
    const pts = vals.map((v,i) => [i/(vals.length-1)*w, 3 + (v-mn)/span*(h-6)]);
    let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
    for(let i=1;i<pts.length;i++){
      const [x0,y0]=pts[i-1],[x1,y1]=pts[i];
      d += ` C${(x0+(x1-x0)/2).toFixed(1)},${y0.toFixed(1)} ${(x0+(x1-x0)/2).toFixed(1)},${y1.toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`;
    }
    return d;
  }
  /* Two series on one scale, zero at the baseline. Null hours break the line.
     A larger value sits higher. Returns one path string per continuous run. */
  function sparkPathRange(vals, mn, mx, w=100, h=22){
    const span = (mx - mn) || 1, n = Math.max(vals.length - 1, 1), segs = [];
    let cur = [];
    const flush = () => { if(cur.length >= 2) segs.push(cur); cur = []; };
    vals.forEach((v, i) => {
      if(v == null || !isFinite(+v)){ flush(); return; }
      cur.push([i / n * w, 3 + (mx - (+v)) / span * (h - 6)]);
    });
    flush();
    return segs.map(pts => {
      let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
      for(let i=1;i<pts.length;i++){
        const [x0,y0]=pts[i-1],[x1,y1]=pts[i];
        d += ` C${(x0+(x1-x0)/2).toFixed(1)},${y0.toFixed(1)} ${(x0+(x1-x0)/2).toFixed(1)},${y1.toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`;
      }
      return d;
    }).join(' ');
  }

  /* ------------------------------ alarm ribbon -----------------------------
     Spec addition (D2): THE one place counts are stated, on every page,
     never filtered, never green. */
  function ribbon(E, list, opts){
    /* D103: the same ribbon, estate-scoped when given a list — never filtered, never hidden */
    opts = opts || {};
    const alarms = list || E.data.alarms, rid = opts.id || 'alarmribbon', act = opts.act || 'dlg', actV = opts.actV || 'alerts', tip = opts.tip || E.t('ribTip');
    const n = { critical:0, high:0, medium:0 };
    alarms.forEach(a => n[a.sev]++);
    const unackedCrit = alarms.some(a => a.sev === 'critical' && !a.ack);
    if(!alarms.length){
      return `<div id="${rid}" class="tipU" data-tone="ok" data-tip="${esc(tip)}" role="status">
        <span class="ribseg ribzero">${icon('check',12)} ${esc(E.t('ribAllNormal'))} · <span class="tMonoS">0</span></span></div>`;
    }
    const seg = (sev, count, word) => count === 0 ? '' :
      `<span class="ribseg">
        <span class="${sev==='critical'&&unackedCrit?'ribflash':''}">${sevGlyph(sev,false,12)}</span>
        <span>${count}</span><span class="ribu ribw">${esc(word)}</span></span>`;
    /* Phone chip (D55): ONE chip — the worst UNACKNOWLEDGED severity plus the
       total unacknowledged count, derived from the same canonical list; the
       full per-severity breakdown returns at 768 and above (CSS switches
       between .ribseg and .ribone). Still never filtered, never hidden. */
    const unack = alarms.filter(a => !a.ack);
    const worst = ['critical','high','medium'].find(s => unack.some(a => a.sev === s));
    const one = worst
      ? `<span class="ribseg ribone"><span class="${worst==='critical'?'ribflash':''}">${sevGlyph(worst,false,12)}</span>
          <span>${unack.filter(a=>a.sev===worst).length}</span><span class="ribu">${esc(E.t('rib'+worst[0].toUpperCase()+worst.slice(1)))}</span>
          <span class="ribu">·</span><span>${unack.length}</span><span class="ribu">${esc(E.t('ribUnack'))}</span></span>`
      : `<span class="ribseg ribone">${icon('check',12)} <span class="ribu">${esc(E.t('ribAllAck'))}</span></span>`;
    const whyStale = opts.note || (E.state.degraded ? E.t('pwaDegraded',{t:E.state.degradedSince||'', src:E.state.degradedSrc||''})
                   : E.t('pwaOffline',{t:E.state.offlineSince||''}));
    const staleOn = opts.note ? true : (!list && E.state.stale);
    const stale = staleOn ? `<span class="ribseg ribstale" data-tip="${esc(whyStale)}">${icon(opts.note ? 'clock' : (E.state.degraded?'tools':'clock'),11,2)}<span class="ribu">${esc(opts.note ? E.t('pfUnknownWord') : E.t('pwaStale'))}</span></span>` : '';
    return `<button id="${rid}" class="tipU" data-act="${act}" data-v="${actV}" aria-haspopup="${act === 'dlg' ? 'dialog' : 'false'}" data-stale="${staleOn?1:0}" data-tip="${esc(staleOn ? whyStale : tip)}" aria-label="${esc(E.t('alarms'))}: ${alarms.length}">${stale}
      ${seg('critical', n.critical, E.t('ribCritical'))}
      ${seg('high', n.high, E.t('ribHigh'))}
      ${seg('medium', n.medium, E.t('ribMedium'))}
      ${one}
    </button>`;
  }

  /* --------------------- summary panel (#ovp overlay) ----------------------
     Reference anatomy: absolute overlay on the viewer; ovglass blur mask,
     ovtint gradient, ovvs shade, title row, KPI rows. */
  function summaryShell(E, title, inner, fit){   /* fit: the Energy summary, as tall as its cards (components.css, #ovp[data-fit]) */
    const mn = E.state.ovpMin;
    return `<div id="ovp" data-min="${mn?1:0}"${fit ? ' data-fit="1"' : ''}>
      <div class="ovglass" aria-hidden="true"></div>
      <div class="ovtint" aria-hidden="true"></div>
      <div class="ovvs" aria-hidden="true"></div>
      <div class="ovrz" role="separator" aria-orientation="vertical" aria-label="${esc(E.t('mpExpand'))}"><span></span></div>
      <div class="ovc">
        <div class="ovhead">
          <span class="ovtitle">${esc(title)}</span>
          <button class="ovcollapse tipU" data-act="ovpMin" data-tip="${esc(E.t(mn?'mpExpand':'mpCollapse'))}" aria-label="${esc(E.t(mn?'mpExpand':'mpCollapse'))}">
            ${icon(mn?'chevR2':'chevL2',16)}<span>${esc(E.t(mn?'mpExpand':'mpCollapse'))}</span></button>
        </div>
        <div class="ovpad">${inner}</div>
      </div></div>`;
  }

  /* Overview executive summary: KPI rows with domain hue wash + sparkline. */
  /* D135: a summary row's value is read from metrics.* (one data layer); unmeasured = the dash */
  const sumVal = (E, r) => { const m = (E.data.metrics || {})[r.metric]; return m == null ? '--' : fmt(m, r.d == null ? 1 : r.d); };
  function execSummary(E){
    const rows = E.data.summary.map(r => {
      const deltaText = E.lang === 'ar' ? r.deltaAr : r.deltaEn;
      const capText   = E.lang === 'ar' ? r.capAr   : r.capEn;
      const hasSpark  = Array.isArray(r.spark) && r.spark.length >= 2 && r.spark.every(v => v != null && isFinite(+v));
      const cmp = Array.isArray(r.sparkCompare) ? r.sparkCompare : null;
      const finite = arr => (arr || []).filter(v => v != null && isFinite(+v));
      const bothN = finite(r.spark).length + (cmp ? finite(cmp).length : 0);
      let spark;
      if(cmp && r.spark.length >= 2 && bothN >= 2){
        const both = finite(r.spark).concat(finite(cmp)).map(Number);
        const mx = Math.max(0, ...both), mn = Math.min(0, ...both);
        const todayD = sparkPathRange(r.spark, mn, mx);
        const yestD = sparkPathRange(cmp, mn, mx);
        spark = `<div class="ovkspark"><svg viewBox="0 0 100 22" width="100" height="22" role="img" aria-label="${esc(E.t('kEnergyToday'))}">
             ${yestD ? `<path d="${yestD}" fill="none" stroke="${r.dom}" stroke-width="1.25" stroke-dasharray="2.5 1.5" opacity="0.45"/>` : ''}
             ${todayD ? `<path d="${todayD}" fill="none" stroke="${r.dom}" stroke-width="1.5"/>` : ''}</svg>
           ${deltaText ? `<span class="ovkdelta">${esc(deltaText)}</span>` : ''}</div>`;
      } else spark = hasSpark
        ? `<div class="ovkspark"><svg viewBox="0 0 100 22" width="100" height="22" aria-hidden="true">
             <path d="${sparkPath(r.spark)}" fill="none" stroke="${r.dom}" stroke-width="1.5"/></svg>
           ${deltaText ? `<span class="ovkdelta">${esc(deltaText)}</span>` : ''}</div>`
        : (capText
            ? `<div class="ovkcap" data-tone="${r.capTone||'t3'}">${esc(capText)}</div>`
            : '');
      return `<div class="ovk" style="background:color-mix(in srgb, ${r.dom} 3%, transparent)">
        <div class="ovkhead"><span style="color:${r.dom}">${icon(r.icon,14,2)}</span>
          <span class="ovklbl">${esc(E.t(r.label))}</span>${ctl(E, E.t(r.label), E.lang==='ar' ? (r.capAr || r.deltaAr || '') : (r.capEn || r.deltaEn || ''))}</div>
        <div class="ovkval"><span class="ovknum">${esc(sumVal(E, r))}</span>${sumVal(E, r) !== '--' ? `<span class="ovkunit">${esc(r.u)}</span>` : ''}</div>
        ${spark}</div>`;
    }).join('');
    return summaryShell(E, E.t('execSummary'), `<div class="ovklist">${rows}</div>`);
  }

  /* Energy landing summary (ENERGY SUMMARY): perf, current, MTD, overnight
     gauge (ekoGauge, its own min/max), waste & risk list. Derived AED at
     render from basis.aedPerKwh. */
  function energySummary(E){
    const d = E.data.energyLanding, ar = E.lang==='ar';
    /* Final-mock row anatomy (D37): tone dot before the label; gauges keep
       the 124x78 dial with the readout ROW below it — value left, status
       word right — so the dial ticks never collide with the readout. */
    const gaugeRow = (lbl, val, mx, u, word, tone) => {
      /* Clean stat row without SVG gauge, matching Overall Health styling */
      const dotTone = (tone === 'warn' || tone === 'crit') ? 'warn' : 'ok';
      if (val == null) {
        return `<div class="ovk ovkDark"><div class="ovkhead"><span class="scdot" data-tone="${dotTone}"></span><span class="ovklbl">${esc(lbl)}</span>${ctl(E, lbl, '')}</div>
          <div class="ovkval"><span class="ovknum">--</span></div></div>`;
      }
      return `<div class="ovk ovkDark"><div class="ovkhead"><span class="scdot" data-tone="${dotTone}"></span><span class="ovklbl">${esc(lbl)}</span>${ctl(E, lbl, '')}</div>
        <div class="ovkval"><span class="ovknum">${esc(fmt(val, 1))}</span>${u ? `<span class="ovkunit">${esc(u)}</span>` : ''}</div>
        ${word ? `<div class="scrow"><span class="ovkcap msA" data-tone="${dotTone==='warn'?'warn':'pos'}">${esc(word)}</span></div>` : ''}</div>`;
    };
    const hasSpark = Array.isArray(d.perfSpark) && d.perfSpark.length >= 2;
    const mn = hasSpark ? Math.min(...d.perfSpark) : 0;
    const mx2 = hasSpark ? Math.max(...d.perfSpark) : 0;
    const span = (mx2 - mn) || 1;
    const pts = hasSpark ? d.perfSpark.map((v,i2) => `${(i2/(d.perfSpark.length-1)*90).toFixed(1)},${(18-(v-mn)/span*14).toFixed(1)}`).join(' ') : '';
    const perfDelta = ar ? d.perfDeltaAr : d.perfDeltaEn;
    const perfWord  = ar ? d.perfWordAr  : d.perfWordEn;
    return summaryShell(E, E.t('energySummary'), '<div class="ovklist">'
      + `<div class="ovk ovkDark"><div class="ovkhead"><span class="scdot" data-tone="ok"></span><span class="ovklbl">${esc(E.t('enPerf'))}</span>${ctl(E, E.t('enPerf'), '')}</div>
          <div class="ovkval"><span class="ovknum">${d.performancePct == null ? '--' : fmt(d.performancePct,1)}</span>${d.performancePct != null ? '<span class="ovkunit">%</span>' : ''}</div>
          ${hasSpark ? `<div class="scrow"><svg viewBox="0 0 90 20" width="90" height="20" aria-hidden="true">
            <polyline points="${pts}" fill="none" stroke="var(--domEnergy)" stroke-width="1.5"/></svg>
          ${perfDelta ? `<span class="ovkcap msA" data-tone="t3">${esc(perfDelta)}</span>` : ''}</div>` : ''}
          ${perfWord ? `<div class="scrow"><span class="ovkcap msA" data-tone="pos">${esc(perfWord)}</span></div>` : ''}</div>`
      + gaugeRow(E.t('enOvernight'), d.overnightDeviationPct, 100, '%', ar ? (d.overnightWordAr || '') : (d.overnightWordEn || ''), d.overnightTone || 'ok')
      + d.sumGauges.map(g2 => gaugeRow(ar?g2.labelAr:g2.labelEn, g2.val, g2.max, g2.u, ar?g2.wordAr:g2.wordEn, g2.tone)).join('')
      + (function () {
          const total = d.emsTotal == null ? 0 : d.emsTotal;
          const active = d.emsActive == null ? 0 : d.emsActive;
          const tone = d.emsTone === 'warn' ? 'warn' : 'ok';
          const chip = ar ? d.emsChipAr : d.emsChipEn;
          const cap = total ? E.t('enEmsCap', { n: total }) : E.t('enEmsCap', { n: 0 });
          return `<div class="ovk ovkDark"><div class="ovkhead"><span class="scdot" data-tone="${tone}"></span><span class="ovklbl">${esc(E.t('enEmsMeters'))}</span>${ctl(E, E.t('enEmsMeters'), chip || cap)}</div>
            <div class="ovkval"><span class="ovknum">${active} / ${total}</span></div>
            ${chip ? `<div class="scrow"><span class="ovkcap msA" data-tone="warn">${esc(chip)}</span></div>`
                   : `<div class="scrow"><span class="ovkcap msA" data-tone="t3">${esc(cap)}</span></div>`}</div>`;
        })()
      + '</div>', true);
  }

  /* Utilities landing summary (D40, Final mock): domain-hue 5% washed rows
     with a 14px domain icon; "Active" reads positive, deltas read muted. */
  function utilitiesSummary(E){
    const m = E.data.metrics, u = E.data.utilLanding, ar = E.lang==='ar';
    const srow = key => (E.data.summary.find(r=>r.key===key)||{});
    /* Consumption rows carry the mock's 100x22 spark beside the delta —
       water a smooth curve, gas a stepped line (paths mock-verbatim).
       When value is null show '--' with no unit and no spark/delta. */
    const row = (hue,ic,icC,lbl,v,unit,cap,capTone,sparkPath) =>
      `<div class="ovk uvk" style="background:color-mix(in srgb, ${hue} 50%, transparent)">
        <div class="ovkhead"><span class="uvic" style="color:${icC}">${icon(ic,14)}</span><span class="ovklbl">${esc(lbl)}</span>${ctl(E, lbl, cap)}</div>
        <div class="ovkval"><span class="ovknum">${esc(v)}</span>${v !== '--' ? `<span class="ovkunit">${esc(unit)}</span>` : ''}</div>
        ${sparkPath && v !== '--'
          ? `<div class="uvspark"><svg viewBox="0 0 100 22" width="100" height="22" aria-hidden="true">
              <path d="${sparkPath}" fill="none" stroke="${icC}" stroke-width="1.5"/></svg>
            <span class="ovkcap" data-tone="${capTone||'t3'}">${esc(cap)}</span></div>`
          : (v !== '--' && cap ? `<div class="scrow"><span class="ovkcap msA" data-tone="${capTone||'t3'}">${esc(cap)}</span></div>` : '')}</div>`;
    const W='rgba(96,165,250,.05)', G='rgba(167,139,250,.05)';
    const wVal = m.waterTodayM3 == null ? '--' : fmt(m.waterTodayM3, 1);
    const gVal = m.gasTodayM3   == null ? '--' : fmt(m.gasTodayM3, 1);
    const wDelta = ar ? srow('water').deltaAr : srow('water').deltaEn;
    const gDelta = ar ? srow('gas').deltaAr   : srow('gas').deltaEn;
    const wTot = u.waterMeters == null ? 0 : u.waterMeters;
    const gTot = u.gasMeters == null ? 0 : u.gasMeters;
    const wAct = u.waterActive == null ? wTot : u.waterActive;
    const gAct = u.gasActive == null ? gTot : u.gasActive;
    const wCap = ar ? (u.waterChipAr || E.t('enEmsCap', { n: wTot })) : (u.waterChipEn || E.t('enEmsCap', { n: wTot }));
    const gCap = ar ? (u.gasChipAr || E.t('enEmsCap', { n: gTot })) : (u.gasChipEn || E.t('enEmsCap', { n: gTot }));
    const wTone = u.waterChipEn ? 'warn' : 't3';
    const gTone = u.gasChipEn ? 'warn' : 't3';
    return summaryShell(E, E.t('utilitiesOverview'), '<div class="ovklist">'
      + row(W,'meter','#60A5FA',E.t('kWaterMeters'), wAct + ' / ' + wTot, '', wCap, wTone)
      + row(W,'droplet','#60A5FA',E.t('kWaterConsToday'), wVal, 'm\u00b3', wDelta||'', 't3', wVal !== '--' ? u.waterSparkPath : null)
      + row(G,'meter','#A78BFA',E.t('kGasMeters'), gAct + ' / ' + gTot, '', gCap, gTone)
      + row(G,'flame','#A78BFA',E.t('kGasConsToday'), gVal, 'm\u00b3', gDelta||'', 't3', gVal !== '--' ? u.gasSparkPath : null)
      + '</div>');
  }

  /* Utilities module panel: ACTIVE ALARMS grouped WATER / GAS from live
     utility alarms only, then the two footer rows into the sub-pages. */
  function utilitiesPanel(E){
    const ar = E.lang==='ar';
    const sub = E.state.sub;
    const live = E.visAlarms().filter(a => {
      const d = E.utilDomain(a);
      if (!d) return false;
      return sub === 'water' || sub === 'gas' ? d === sub : true;
    });
    const wa = live.filter(a => E.utilDomain(a) === 'water');
    const ga = live.filter(a => E.utilDomain(a) === 'gas');
    const n = wa.length + ga.length;                     /* count derives */
    const row = (a, subName, page) => `<button class="uprow" data-act="goSub" data-mod="utilities" data-sub="${subName}" data-page="${page}">
      <span class="uadot" data-sev="${esc(a.sev)}"></span>
      <span class="col grow minw0 taS gap1">
        <span class="uploc">${esc(ar ? (a.locAr || a.locEn) : a.locEn)}</span>
        <span class="uptit">${esc(ar ? (a.plainAr || a.plainEn || a.tAr) : (a.plainEn || a.tEn || ''))}</span></span>
      <span class="uaage">${esc(a.ageH != null ? E.fmtAge(a.ageH) : E.ph(a.age))}</span></button>`;
    const foot = (lblKey, key, sub, page) => `<button class="upfoot" data-act="goSub" data-mod="utilities" data-sub="${sub}" data-page="${page}">
      <span class="upfl">${esc(E.t(lblKey))}</span>
      <span class="tMonoS cT2">${esc(ar?E.data.landing[key].headAr:E.data.landing[key].headEn)}</span>${icon('chevR',12)}</button>`;
    return modShell(E, E.t('modUtilities'), '', '',
      `<div class="alcard"><div class="alcardh"><span class="alcardt">${esc(E.t('activeAlarms'))}</span>
        <span class="alcardm">${esc(E.t('utilPanelMeta',{n}))}</span></div>
        <div class="upgrp">${esc(E.t('utilGrpWater'))}</div>${wa.map(i=>row(i,'water','water')).join('')}
        <div class="upgrp">${esc(E.t('utilGrpGas'))}</div>${ga.map(i=>row(i,'gas','gas')).join('')}</div>
      <div class="upcard">${foot('subWater','water','water','water')}${foot('subGas','gas','gas','gas')}</div>`);
  }

  /* --------------------- module panel (right, 378px) ----------------------- */
  /* D134: ONE header row — the title at the start (it truncates, with a tooltip, before any control is
     pushed), the controls grouped at the end 8px apart: AI, the caller's tools, collapse last. No subtitle:
     the title is enough. `lead` is an optional back control that belongs to the title (a sub-view's way up). */
  function modShell(E, title, lead, headExtra, inner, aiTopic){
    const mn = E.state.panMin;
    const ai = mn ? '' : aiBtn(E, title, '', 16, 'modai').replace('data-act="aiOpen"', `data-act="aiOpen"${aiTopic ? ` data-ai-topic="${esc(aiTopic)}"` : ''}`);
    return `<section id="modpanel" aria-label="${esc(title)}" data-min="${mn?1:0}">
      <div id="modhdr">
        ${lead||''}<div class="modtitle" data-tip="${esc(title)}" data-tipif="trunc">${esc(title)}</div>
        <div class="modtools">${ai}${headExtra||''}<button class="ovcollapse tipU" data-act="panMin" data-tip="${esc(E.t(mn?'mpExpand':'mpCollapse'))}" aria-label="${esc(E.t(mn?'mpExpand':'mpCollapse'))}">
          <span>${esc(E.t(mn?'mpExpand':'mpCollapse'))}</span>${icon(mn?'chevL2':'chevR2',16)}</button></div>
      </div>
      <div id="modcontent">${inner}</div></section>`;
  }

  /* Overview module panel: ALARMS card + ALARMS BY SYSTEM card. */
  function alarmModPanel(E){
    const alarms = E.data.alarms;              /* counts: always the full list */
    const acked = alarms.filter(a=>a.ack).length;
    const byAsset = [];
    E.visAlarms().forEach(a => {               /* rows: display-filtered (D30) */
      const g = byAsset.find(x => x.asset === a.asset);
      g ? g.rows.push(a) : byAsset.push({ asset: a.asset, rows: [a] });
    });
    const rowHtml = (a, grouped) => {
      const l = E.alarmLines(a);   /* D105: wording from the role; the technical line beneath for plain-wording roles */
      return `<div class="alr ${grouped?'alrind':''}" data-act="openAsset" data-asset="${esc(a.asset)}" role="button" tabindex="0">
        <span class="alrsev" data-tip="${esc(sevTipFor(E, a))}">${sevGlyph(a.sev, !!a.ack, 13)}</span>
        <div class="alrbody">
          ${grouped?'':`<span class="alrid" ${a.ack?'data-ack="1"':''}>${esc(a.asset)}</span>`}
          <span class="alrwhat">${esc(l.main)}</span>
          ${l.sub?`<span class="alrtech">${esc(l.sub)}</span>`:''}
          ${a.ack?`<span class="alrack">${esc(E.t('ackShort',{time:a.ack.time,who:a.ack.who}))}</span>`:''}
        </div>
        <span class="alract hst">
          ${a.ack?'':`<button class="alghost" data-act="ackAlarm" data-alarm="${a.id}">${esc(E.t('acknowledge'))}</button>`}
          <button class="alprim" data-act="openAsset" data-asset="${esc(a.asset)}">${esc(E.t('details'))}</button>
        </span>
        <span class="alrage">${esc(a.age)}</span>
        <span class="alractw" data-tip="${esc(actTip(E, a.sev))}">${esc(sevAction(E,a.sev))}</span>
      </div>`;
    };
    /* One scroll container per panel (D60): the list never scrolls inside
       its card. Long lists use progressive disclosure — the first AL_CAP
       rows, then "Show all N" (counts stay the full list, per the law). */
    const AL_CAP = 6;
    const totalRows = byAsset.reduce((n, g) => n + g.rows.length, 0);
    const showAll = !!E.state.alAll || totalRows <= AL_CAP;
    let shown = 0;
    const list = byAsset.map(g => {
      if(!showAll && shown >= AL_CAP) return '';
      const rows = showAll ? g.rows : g.rows.slice(0, AL_CAP - shown);
      shown += rows.length;
      return rows.length > 1 || g.rows.length > 1
        ? `<div class="algrp">${esc(g.asset)}</div>` + rows.map(a=>rowHtml(a,true)).join('')
        : rowHtml(rows[0], false);
    }).join('') + (totalRows > AL_CAP
      ? `<button class="almore" data-act="alAll" aria-expanded="${showAll}">${esc(showAll ? E.t('alShowLess') : E.t('alShowAll',{n:totalRows}))}</button>`
      : '');
    /* By-family grouping (D31, client direction): equipment families, not
       disciplines. Counts derive; the all-clear footer lists the quiet
       families from the declared roster. */
    const famMap = {};
    const SEVR = { critical:0, high:1, medium:2 };
    alarms.forEach(a => { const m2 = (famMap[a.fam] = famMap[a.fam] || { n:0, fdd:0, sys:0, worst:'medium' });
      m2.n++; m2[a.cat]++;
      if(SEVR[a.sev] < SEVR[m2.worst]) m2.worst = a.sev; });
    const famL = f => E.lang==='ar' ? f.ar : f.en;
    const famsIn = E.data.families.filter(f => famMap[f.id]);
    const famsClear = E.data.families.filter(f => !famMap[f.id]);
    const sysRows = famsIn.map(f => {
      const v = famMap[f.id];
      const parts = [v.fdd?`${v.fdd} ${E.t('legFdd')}`:null, v.sys?`${v.sys} ${E.t('legSystem')}`:null].filter(Boolean).join(' · ');
      return `<button class="sysrow" data-act="fltSysGo" data-v="${esc(f.id)}" data-tip="${esc(E.t('showSysTip',{sys:famL(f)}))}">
        <span class="sysdot"></span>
        <span class="sysname">${esc(famL(f))}</span><span class="cbadge" data-sev="${v.worst}" data-tip="${esc(E.t('sysBadgeTip',{n:v.n,sys:famL(f)}))}">${v.n}</span>
        <span class="syscats" data-tip="${esc(E.t('legTip'))}">${esc(parts)}</span>${icon('chevR',12)}</button>`;
    }).join('');
    const famsClearTxt = famsClear.map(famL).join(' \u00b7 ');
    const alertBtn = mkEye(E) + `<button class="alertcentre" data-act="dlg" data-v="alerts" data-tip="${esc(E.t('alertCentreTip'))}" aria-haspopup="dialog">
      ${icon('warn',13)}<span>${esc(E.t('alertCentre'))}</span></button>`   /* D134: no count — the ribbon is the one persistent count, the ALARMS meta line the detail */;
    return modShell(E, E.t('modOverview'), '', alertBtn,
      `<div class="alcard">
        <div class="alcardh"><span class="alcardt">${esc(E.t('alarmsPanelT'))}</span>
          <span class="alcardm" data-tip="${esc(E.t('alarmsMetaTip'))}">${esc(E.t('alarmsMeta',{n:alarms.length,a:acked}))}</span></div>
        <div class="allist">${list}</div>
        <div class="alfoot">${esc(E.t('fireLS',{n:E.data.lifeSafetyActive}))}</div>
      </div>
      <div class="alcard">
        <div class="alcardh"><span class="alcardt">${esc(E.t('alarmsBySys'))}</span>
          <span class="alcardm taE">${esc(E.t('toLookAt',{n:alarms.length}))}</span></div>
        <div class="syslegend">
          <span>${sevGlyph('high',false,11)} ${esc(E.t('legSystem'))}</span>
          <span>${sevGlyph('critical',false,11)} ${esc(E.t('legFdd'))}</span></div>
        <div class="syslist">${sysRows}
          <div class="sysclear"><span class="sysclrdot"></span>
            <span>${esc(E.t('famAllClear',{list:famsClearTxt}))}</span></div>
        </div>
      </div>`, 'alarms');
  }

  /* Energy landing module panel: optimization cards. */
  function energyModPanel(E){
    const d = E.data.energyLanding, b = E.data.basis, ar = E.lang==='ar';
    /* Final mock (D37): a 2x2 optimization grid — each card tinted-bordered
       by its tone, with Energy Waste / Cost Impact as paired sub-cells —
       followed by the Energy Waste & Risk section (totals + share bars).
       Top opportunities and Modules do NOT live on this panel. */
    const cur = b.currency || 'AED';   /* the project's currency; no unit after a missing cost */
    const cards = d.kpis.map(k => {
      const st = ar ? k.stateAr : k.stateEn;
      const cost = k.costAed != null ? k.costAed : (k.wasteKwh != null && b.aedPerKwh != null ? k.wasteKwh * b.aedPerKwh : null);   /* no tariff: unknown, not 0 */
      return `<article class="optcard2" data-tone="${k.tone}">
        <div class="optheadrow"><span class="optname">${esc(ar?k.labelAr:k.labelEn)}</span>
          <span class="optval tMonoS msA">${fmt(k.gaugeVal,1)}${k.key==='overnight'||k.key==='imbalance'?'%':''}</span></div>
        ${st ? `<span class="optstate" data-tone="${k.tone}">(${esc(st)})</span>` : ''}
        <p class="opttip">${esc(ar?k.tipAr:k.tipEn)}</p>
        <div class="optcells">
          <span class="optcell"><i class="optlbl">${esc(E.t('wasteLbl'))}</i><b class="tMonoS">${fmt(k.wasteKwh,1)} kWh</b></span>
          <span class="optcell"><i class="optlbl">${esc(E.t('costLbl'))}</i><b class="tMonoS">${fmt(cost,1)}${cost == null ? '' : ' ' + esc(cur)}</b></span>
        </div></article>`;
    }).join('');
    const RAMP2 = ['#C2504B','#D07A3C','#D8A83C','#D8C63C'];
    const ranked = [...d.kpis].filter(k => k.wasteKwh != null && isFinite(k.wasteKwh)).sort((x,y)=>y.wasteKwh-x.wasteKwh);
    const rank = ranked.length ? ranked : d.kpis;
    const rampOf = k => RAMP2[Math.min(Math.max(rank.indexOf(k), 0), RAMP2.length-1)];
    const totAed = d.wasteTotalAed != null ? d.wasteTotalAed : (d.wasteTotalKwh != null && b.aedPerKwh != null ? d.wasteTotalKwh * b.aedPerKwh : null);
    const wr = `<div class="alcard"><div class="alcardh"><span class="alcardt">${esc(E.t('ewrT'))}</span></div>
      <div class="row gap8"><span class="ewrtot tMonoS">${fmt(d.wasteTotalKwh,1)} kWh</span>
        <span class="ewrtot tMonoS">${fmt(totAed,1)}${totAed == null ? '' : ' ' + esc(cur)}</span></div>
      ${d.kpis.map(k => {
        const risk = k.sharePct != null && isFinite(k.sharePct) ? Math.min(100, Math.max(0, k.sharePct)) : 0;
        return `<div class="ewrrow">
        <span class="ewrchip" style="background:${rampOf(k)}">${esc(ar?k.labelAr:k.labelEn)}</span>
        <span class="tMonoS msA">${fmt(k.sharePct,1)}%</span>
        <span class="ewrbar"><span style="width:${risk.toFixed(0)}%;background:${rampOf(k)}"></span></span></div>`;
      }).join('')}</div>`;
    return modShell(E, E.t('modEnergy'), '', '',
      `<div class="opthead"><span class="alcardt">${esc(E.t('optT'))}</span>
        <span class="alcardm">${esc(E.t('optNote'))}</span></div>
      <div class="optgrid">${cards}</div>${wr}`);
  }

  /* ------------------------------ POWER page ------------------------------- */
  function powerPage(E){
    const m = E.data.metrics, p = E.data.power, b = E.data.basis, ar = E.lang==='ar';
    const hero = (lbl, chip, chipTone, val, unit, cap, chart) =>
      `<div class="pwtile"><div class="pwth"><span class="ovklbl">${esc(lbl)}</span>
          ${chip?`<span class="pwchip" data-tone="${chipTone}">${esc(chip)}</span>`:''}${ctl(E, lbl, cap)}</div>
        <div class="ovkval"><span class="ovknum">${esc(val)}</span><span class="ovkunit">${esc(unit)}</span></div>
        ${cap ? `<span class="ovkcap">${esc(cap)}</span>` : ''}${chart||''}</div>`;
    /* Hero mini-charts (D39 — measured from the Final mock): banded track,
       gradient value bar with an amber over-baseline overflow segment and a
       marker dot; the baseline/contracted tick carries its label above. */
    const bullet = (hc, key) => {
      if (!hc) return '';   /* no chart record (real mode: no fixture bands) */
      const split = !hc.crit && hc.value > hc.bands[0];
      const tick = hc.crit ? 100 : hc.bands[0];
      const dotC = split ? '#FFC53D' : '#4EA3E8';
      return `<div class="pwmini2"><svg>
        <defs><linearGradient id="pwg${key}" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="#29A8DF"/><stop offset="100%" stop-color="#4EA3E8"/></linearGradient></defs>
        <rect x="0%" y="16" width="${hc.bands[0]}%" height="12" fill="var(--chTrack)"/>
        <rect x="${hc.bands[0]}%" y="16" width="${hc.bands[1]-hc.bands[0]}%" height="12" fill="var(--chBandWarn)"/>
        <rect x="${hc.bands[1]}%" y="16" width="${100-hc.bands[1]}%" height="12" fill="${hc.crit?'var(--chBandCrit)':'var(--chBandHot)'}"/>
        <rect x="0%" y="19" width="${(split?hc.bands[0]:hc.value)}%" height="6" rx="3" fill="url(#pwg${key})"/>
        ${split?`<rect x="${hc.bands[0]}%" y="19" width="${(hc.value-hc.bands[0]).toFixed(2)}%" height="6" fill="#FFC53D"/>`:''}
        <circle cx="${hc.value}%" cy="22" r="6" fill="${dotC}" opacity="0.3"/>
        <circle cx="${hc.value}%" cy="22" r="2.5" fill="${dotC}"/>
        <line x1="${tick}%" x2="${tick}%" y1="12" y2="31" stroke="var(--chTx)" stroke-width="1.25"/>
        <text x="${tick}%" y="9" text-anchor="${hc.crit?'end':'middle'}" font-family="JetBrains Mono,monospace" font-size="12" fill="var(--chTx)">${esc(ar?hc.noteAr:hc.noteEn)}</text></svg></div>`;
    };
    const spark = (hc) => {
      const mx = Math.max(...hc.spark)*1.15, n2 = hc.spark.length;
      const py = v => (26-v/mx*22).toFixed(1);
      const pts = hc.spark.map((v,i2)=>`${(i2/(n2-1)*100).toFixed(1)},${py(v)}`).join(' ');
      const avg = hc.spark.reduce((a2,v)=>a2+v,0)/n2;
      return `<div class="pwmini2"><svg viewBox="0 0 100 26" preserveAspectRatio="none" class="pwsp39">
        <defs><linearGradient id="pwsparkg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#4EA3E8" stop-opacity="0.35"/><stop offset="100%" stop-color="#4EA3E8" stop-opacity="0"/></linearGradient></defs>
        <polygon points="0,26 ${pts} 100,26" fill="url(#pwsparkg)"/>
        <line x1="0" x2="100" y1="${py(avg)}" y2="${py(avg)}" stroke="var(--chTx)" stroke-width="1" stroke-dasharray="3 2" vector-effect="non-scaling-stroke"/>
        <polyline points="${pts}" fill="none" stroke="#4EA3E8" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>
      <span class="pwminix tMonoS cT3"><i>${esc(ar?hc.fromAr:hc.fromEn)}</i><i>${esc(ar?hc.toAr:hc.toEn)}</i></span></div>`;
    };
    const el = E.data.energyLanding;
    const carbonKgH = el.carbonKgH;
    const peakKw = m.peakTodayKw != null ? m.peakTodayKw : (m.peakTodayMw != null ? m.peakTodayMw * 1000 : null);
    const contractedKw = p.contractedMw != null ? p.contractedMw * 1000 : null;
    const peakPct = (peakKw != null && contractedKw) ? Math.round(peakKw / contractedKw * 100) : null;
    const nd = (v, d2) => v == null ? '--' : fmt(v, d2 == null ? 1 : d2);
    const tr = E.state.pwTrendRange || 'today';
    const sumArr = a => {
      if (!a || !a.length || a.every(v => v == null)) return null;
      const s = a.reduce((n, v) => n + (Number(v) || 0), 0);
      return s === 0 && a.every(v => v == null || Number(v) === 0) ? null : s;
    };
    const colAt = (series, i) => {
      if (!series || !series.length) return null;
      const vals = series.map(z => z && z[i]);
      return sumArr(vals);
    };
    let heroNow = null, heroPrev = null;
    if (tr === 'hourly' && p.zoneLast24 && p.zoneLast24[0] && p.zoneLast24[0].length) {
      const hi = p.zoneLast24[0].length - 1;
      heroNow = colAt(p.zoneLast24, hi);
      heroPrev = hi > 0 ? colAt(p.zoneLast24, hi - 1) : null;
    } else if (tr === 'weekly') {
      heroNow = sumArr(p.zoneWTD);
      heroPrev = sumArr(p.zonePrevWeek);
    } else if (tr === 'monthly') {
      heroNow = sumArr(p.zoneMTD);
      heroPrev = sumArr(p.zonePrevMonth);
    } else {
      heroNow = (p.zoneHourly && p.zoneHourly[0] && p.zoneHourly[0].length)
        ? sumArr(p.zoneHourly.map(z => (z || []).reduce((a, v) => a + (Number(v) || 0), 0)))
        : null;
      heroPrev = sumArr(p.zoneYesterday);
    }
    const heroRow = `<div class="pwhero">
      ${hero(E.t('pwCurrentCons'), el.currentKw != null ? E.t('pwAboveChip') : '', el.currentKw != null ? 'warn' : '', nd(el.currentKw,1), el.currentKw != null ? 'kW' : '', E.t('pwBaselineKwCap',{v:fmt(el.baselineKw,1)}), el.currentKw != null ? bullet(p.heroCharts.current,'L') : '')}
      ${hero(E.t('pwHeroNow.'+tr), '', '', nd(heroNow, 1), heroNow != null ? 'kWh' : '', E.t('pwHeroNowCap.'+tr))}
      ${hero(E.t('pwHeroPrev.'+tr), '', '', nd(heroPrev, 1), heroPrev != null ? 'kWh' : '', E.t('pwHeroPrevCap.'+tr))}
      ${hero(E.t('pwCarbon'), '', '', nd(carbonKgH,1), carbonKgH != null ? 'kg/h' : '', '')}
      ${hero(E.t('pwPeak'), peakPct != null ? E.t('pwPctLimit',{p:peakPct}) : '', peakPct != null ? 'crit' : '', nd(peakKw,1), peakKw != null ? 'kW' : '', E.t('pwContractedLine',{v:fmt(contractedKw,0)}), peakKw != null ? bullet(p.heroCharts.peak,'P') : '')}
    </div>`;
    const zhAll = { hourly: p.zoneLast24, today: p.zoneHourly, weekly: p.zoneWeekly, monthly: p.zoneMonthly };
    /* a board with no reading is missing (--), never 0 kWh */
    const lastVal = z => (z && z.length && z[z.length-1] != null) ? Number(z[z.length-1]) : null;
    const sumVal = z => (z||[]).some(v => v != null) ? (z||[]).reduce((a,v)=>a+(Number(v)||0),0) : null;
    const boardNames = (p.zones && p.zones.length) ? p.zones : p.boards.map(x=>x[0]);
    const boardLoads = tr === 'monthly' && p.zoneMTD ? p.zoneMTD
      : tr === 'weekly' && p.zoneWTD ? p.zoneWTD
      : tr === 'today' && zhAll.today && zhAll.today[0] && zhAll.today[0].length ? zhAll.today.map(sumVal)
      : tr === 'hourly' && zhAll.hourly && zhAll.hourly[0] && zhAll.hourly[0].length ? zhAll.hourly.map(lastVal)
      : (p.zoneLast24 && p.zoneLast24[0] && p.zoneLast24[0].length ? p.zoneLast24.map(lastVal)
        : p.boards.map(x => x[1] == null ? null : Number(x[1])));
    const boards = boardNames.map((name,i2) => [name, boardLoads[i2] == null ? null : boardLoads[i2]]);
    const totKwh = boards.reduce((a,x)=>a+Math.max(0, Number(x[1])||0),0);
    const dbEmpty = boards.every(x => x[1] == null || Number(x[1]) === 0);
    const hues = p.zoneHues && p.zoneHues.length ? p.zoneHues : ['#4EA3E8','#F0A93B','#45C79A','#E48FC4','#A78BFA','#E06C75'];
    const dbWhen = E.t('pwDbWhen.'+tr);
    const dbTot = dbEmpty ? '--' : fmt(totKwh, 1);
    const C2 = 2*Math.PI*58;
    let cum = 0;
    const dsegs = boards.map((x,i2)=>{
      const f = totKwh > 0 ? Math.max(0, Number(x[1])||0)/totKwh : 0;
      const s2 = { c: hues[i2] || '#94A3B8',
        dash: `${(f*C2).toFixed(2)} ${(C2-f*C2).toFixed(2)}`, off: (-cum*C2).toFixed(2) };
      const aMid = (cum + f/2)*2*Math.PI - Math.PI/2;
      s2.lx = (50 + 36*Math.cos(aMid)).toFixed(2);
      s2.ly = (50 + 36*Math.sin(aMid)).toFixed(2);
      s2.pct = Math.round(f*100);
      cum += f;
      return s2;
    });
    const share = `<article class="pwwidget">
      <div class="pwwh"><span class="alcardt">${esc(E.t('pwDbShare'))}</span>
        <span class="alcardm">${esc(E.t('pwDbShareCap',{when:dbWhen,v:dbTot}))}</span>${window.EKO_A.chrome(E)}</div>
      <div class="dnwrap"><svg viewBox="0 0 160 160" aria-hidden="true">
        ${dsegs.map(s2=>`<circle cx="80" cy="80" r="58" fill="none" stroke="${s2.c}" stroke-width="30" stroke-dasharray="${s2.dash}" stroke-dashoffset="${s2.off}" transform="rotate(-90 80 80)"/>`).join('')}</svg>
        ${dbEmpty ? '' : dsegs.map(s2=>`<span class="dnlbl" style="left:${s2.lx}%;top:${s2.ly}%">${s2.pct}%</span>`).join('')}</div>
      <div class="dnleg">${boards.map((x,i2)=>`<span class="dnlegit"><i style="background:${hues[i2]}"></i>${esc(x[0])}</span>`).join('')}</div></article>`;
    const totalMax = Math.max(0, ...boards.map(x=>Math.max(0, Number(x[1])||0)));
    const db = `<article class="pwwidget">
      <div class="pwwh"><span class="alcardt">${esc(E.t('pwDb'))}</span>
        <span class="alcardm">${esc(E.t('pwDbSub',{n:boards.length,v:dbTot,when:dbWhen}))}</span>${window.EKO_A.chrome(E)}</div>
      <div class="dblist grow">${boards.map((x,i2) =>
        `<button class="dbrow" data-act="pwBoard" data-i="${i2}" data-on="${String(E.state.pwBoard)===String(i2)}"><span class="dbid">${esc(x[0])}</span>
          <span class="dbbar"><span style="width:${totalMax?((Math.max(0, Number(x[1])||0)/totalMax*100).toFixed(1)):0}%;background:${hues[i2]}"></span></span>
          <span class="dbkw">${x[1]==null||(dbEmpty&&Number(x[1])===0)?'--':(fmt(Number(x[1]),1)+' kWh')}</span>${icon('chevR',12)}</button>`).join('')}</div></article>`;
    /* no board mapped for this project: say so, never an empty donut or 0 kWh rows */
    const noBoards = titleKey => `<article class="pwwidget"><div class="pwwh"><span class="alcardt">${esc(E.t(titleKey))}</span></div><p class="alempty" data-testid="pw-boards-unset">${esc(E.t('pwDbNotConfigured'))}</p></article>`;
    let zh = (zhAll[tr] && zhAll[tr][0]) ? zhAll[tr] : [[]];
    let zhHues = hues;
    let zhNames = boardNames;
    const boardIdx = E.state.pwBoard == null || E.state.pwBoard === '' ? -1 : Number(E.state.pwBoard);
    if (boardIdx >= 0 && zh[boardIdx]) {
      zh = [zh[boardIdx]];
      zhHues = [hues[boardIdx] || '#4EA3E8'];
      zhNames = [boardNames[boardIdx]];
    }
    const hours = (zh[0] && zh[0].length) || 0;
    let stackMax = 0;
    for(let h2=0;h2<hours;h2++){
      let s = 0; zh.forEach(z => { s += Number(z[h2]) || 0; });
      if(s > stackMax) stackMax = s;
    }
    const YMAX = Math.max(stackMax, 1);
    const step = hours ? 100/hours : 100, bw = step*0.6;
    const xLabels = (p.trendX && p.trendX[tr] && p.trendX[tr].length)
      ? p.trendX[tr]
      : (tr==='weekly' || tr==='monthly'
        ? (zh[0]||[]).map((_,i2)=>String(i2+1))
        : Array.from({length:hours},(_,i2)=>(i2%2===0)?String(i2).padStart(2,'0'):''));
    const zoneName = i2 => zhNames[i2] || (ar ? (p.zonesAr[i2]||p.zones[i2]) : p.zones[i2]);
    const nv = (v, d2) => fmt(v, d2 == null ? 1 : d2);
    const chtipAttr = payload => encodeURIComponent(JSON.stringify(payload));
    const hitCell = (label, unit, rows) =>
      `<span class="chhit39" data-chtip="${chtipAttr({ t: label, u: unit, rows })}"></span>`;
    let bars = '', hits = '';
    for(let h2=0;h2<hours;h2++){
      let y0 = 100;
      const rows = [];
      zh.forEach((z,zi) => {
        const val = Number(z[h2])||0;
        const bh = val/YMAX*100; y0 -= bh;
        bars += `<rect x="${(h2*step+step*0.2).toFixed(2)}" y="${y0.toFixed(2)}" width="${bw.toFixed(2)}" height="${Math.max(0,bh).toFixed(2)}" fill="${zhHues[zi]}"${zi===zh.length-1?' rx="0.6"':''}/>`;
        rows.push({ c: zhHues[zi], n: zoneName(zi), v: nv(val) });
      });
      hits += hitCell(xLabels[h2] || '', 'kWh', rows);
    }
    const grid39 = [0,25,50,75,100].map(y=>`<line x1="0" x2="100" y1="${y}" y2="${y}" stroke="var(--bd1)" stroke-width="1"${y===100?'':' stroke-dasharray="2 3"'} vector-effect="non-scaling-stroke"/>`).join('');
    const yTicks = [YMAX, YMAX*0.75, YMAX*0.5, YMAX*0.25, 0].map(v => v >= 10 ? Math.round(v) : (Math.round(v*10)/10));
    const seg = (k,v) => `<button class="seg" data-on="${tr===v}" data-act="pwTrendRange" data-v="${v}">${esc(E.t(k))}</button>`;
    const xAxis = n => {
      const cols = Math.max(n, xLabels.length, 1);
      const labs = Array.from({length: cols}, (_,i2) => xLabels[i2] || '');
      return `<div class="chx39" style="grid-template-columns:repeat(${cols},minmax(0,1fr))">${labs.map(t2=>`<span>${esc(t2)}</span>`).join('')}</div>`;
    };
    const todayTo = (tr==='today' && hours) ? String(Math.max(0, hours-1)).padStart(2,'0')+':00' : (b.asOf || '');
    const weekRange = p.weekRange || ((xLabels[0] || '') + (xLabels.length ? '–' + xLabels[xLabels.length - 1] : ''));
    const enCap0 = tr==='hourly' ? E.t('pwEnSubHourly')
      : tr==='weekly' ? E.t('pwEnSubWeekly',{range:weekRange})
      : tr==='monthly' ? E.t('pwEnSubMonthly',{from:xLabels[0]||'',to:xLabels[xLabels.length-1]||''})
      : E.t('pwEnSub',{t:todayTo});
    const enCap = boardIdx >= 0 && zhNames[0] ? zhNames[0] + ' · ' + enCap0 : enCap0;
    const pkCap = tr==='hourly' ? E.t('pwPeakSubHourly')
      : tr==='weekly' ? E.t('pwPeakSubWeekly',{range:weekRange})
      : tr==='monthly' ? E.t('pwPeakSubMonthly',{from:xLabels[0]||'',to:xLabels[xLabels.length-1]||''})
      : E.t('pwPeakSub',{t:todayTo});
    const entrend = `<article class="pwwidget">
      <div class="pwwh"><span class="alcardt">${esc(E.t('pwEnTrend'))}</span>
        <span class="alcardm">${esc(enCap)}</span>
        <span class="row segbox msA">${seg('rangeHourly','hourly')}${seg('rangeToday','today')}${seg('rangeWeekly','weekly')}${seg('rangeMonthly','monthly')}</span>${window.EKO_A.chrome(E)}</div>
      <div class="ch39"><div class="chy39">${yTicks.map(v=>`<span>${v}</span>`).join('')}</div>
        <div class="chcol39">
          <div class="chplot39"><svg viewBox="0 0 100 100" preserveAspectRatio="none">${grid39}${bars}</svg>
            ${hours ? `<div class="chhits39">${hits}</div>` : ''}</div>
          ${xAxis(hours)}</div></div>
      <div class="pwlegend">${zhNames.map((z,i2)=>`<span><i class="zdot" style="background:${zhHues[i2]}"></i>${esc(z)}</span>`).join('')}</div></article>`;
    const psAll = { hourly: p.peakLast24, today: p.peakSeries, weekly: p.peakWeekly, monthly: p.peakMonthly };
    const ps = (psAll[tr] && psAll[tr].length) ? psAll[tr] : [];
    const n3 = ps.length;
    const peakAvg = n3 ? ps.reduce((a2,v)=>a2+(Number(v)||0),0)/n3 : 0;
    const livePeak = n3 ? Math.max(...ps.map(v=>Number(v)||0)) : 0;
    const contract = m.contractedKw;
    const niceMax = v => {
      if(!(v > 0)) return 1;
      const mag = Math.pow(10, Math.floor(Math.log10(v)));
      const n = v / mag;
      const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
      return nice * mag;
    };
    const PMAX = niceMax(Math.max(contract || 0, livePeak) * 1.15);
    const pty = v => (100 - v/PMAX*100);
    const xAt = i2 => n3 ? ((i2 + 0.5) / n3 * 100) : 0;
    const pts3 = n3 < 2 ? '' : ps.map((v,i2)=>`${xAt(i2).toFixed(2)},${pty(v).toFixed(2)}`).join(' ');
    const yC = contract != null ? pty(contract) : 0;
    const yA = pty(peakAvg);
    let pkHits = '';
    for(let i2=0;i2<n3;i2++){
      const label = xLabels[i2] || '';
      const val = nv(Number(ps[i2])||0);
      pkHits += hitCell(label, 'kW', [{ c: '#4EA3E8', n: E.t('pwPeak'), v: val }]);
    }
    const pTicks = [PMAX, PMAX*0.75, PMAX*0.5, PMAX*0.25, 0].map(v => v >= 10 ? Math.round(v) : (Math.round(v*10)/10));
    const peak = `<article class="pwwidget">
      <div class="pwwh"><span class="alcardt">${esc(E.t('pwPeakTrend'))}</span>
        <span class="alcardm">${esc(pkCap)}</span>${window.EKO_A.chrome(E)}</div>
      <div class="ch39"><div class="chy39">${pTicks.map(v=>`<span>${v}</span>`).join('')}</div>
        <div class="chcol39">
        <div class="chplot39">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none">
            <defs><linearGradient id="pwpkG" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#4EA3E8" stop-opacity="0.25"/><stop offset="100%" stop-color="#4EA3E8" stop-opacity="0"/></linearGradient></defs>
            ${grid39}
            ${contract != null ? `<rect x="0" y="0" width="100" height="${Math.max(0,yC).toFixed(2)}" fill="rgba(214,69,69,0.12)"/>` : ''}
            ${n3 ? `<line x1="0" x2="100" y1="${yA.toFixed(2)}" y2="${yA.toFixed(2)}" stroke="var(--chTx)" stroke-width="1" stroke-dasharray="4 3" vector-effect="non-scaling-stroke"/>` : ''}
            ${pts3 ? `<polygon points="0,100 ${pts3} 100,100" fill="url(#pwpkG)"/>
            <polyline points="${pts3}" fill="none" stroke="#4EA3E8" stroke-width="2" vector-effect="non-scaling-stroke"/>` : ''}
            ${n3===1 ? `<circle cx="${xAt(0).toFixed(2)}" cy="${pty(ps[0]).toFixed(2)}" r="1.8" fill="#4EA3E8"/>` : ''}
            </svg>
          ${n3 ? `<div class="chhits39">${pkHits}</div>` : ''}
          ${contract != null ? `<span class="pkband39">${esc(E.t('pwContractedLine',{v:fmt(contract,1)}))}</span>` : ''}
          ${n3 ? `<span class="pkavg39" style="top:${yA.toFixed(1)}%">${esc(E.t('pwAvgLine',{v:fmt(peakAvg,1)}))}</span>` : ''}
        </div>
        ${xAxis(Math.max(n3, hours))}</div></div>
      <span class="ovkcap">${esc(E.t('pwPenalty'))}</span></article>`;
    return `<div class="pwarea" data-pg="power">
      <div class="pwheadrow">
        <div><span class="alcardt pgtitle">${esc(E.t('pwTitle'))}</span>
          <span class="alcardm"> ${esc(E.t('pwSub'))}</span></div>
        <span class="msA row gap6">
          <button class="btnG btnSm" data-act="goPage" data-page="power-model" data-sub="power">${esc(E.t('modelView'))}</button></span>
      </div>
      ${heroRow}
      <div class="pwgrid pg39">${boards.length ? share : noBoards('pwDbShare')}${entrend}${boards.length ? db : noBoards('pwDb')}${peak}</div>
      ${mvRow(E)}
    </div>`;
  }
  /* D96: the M&V row declared by the layout document (powerMv widget) */
  function mvRow(E){
    const doc = window.EKO_LAYOUTS[E.state.pageId] || {};
    const w = (doc.widgets || []).find(x => x.type === 'powerMv'); if(!w) return '';
    const cards = ((w.binding || {}).cards || []).map(k => k === 'baselineVsActual' ? (E.data.power.bva ? window.EKO_BVA.card(E) : `<article class="alcard"><p class="alempty" data-testid="bva-unset">${esc(E.t('bvaNotConfigured'))}</p></article>`) : k === 'meterStatus' ? window.EKO_MT.panel(E) : '').join('');
    return `<div class="mvgrid" data-layout="${esc((w.binding || {}).layout || 'side')}">${cards}</div>`;
  }

  /* Consumption model sub-view panel (D39 — the mock's "Model view"): four
     metric rows with h22 bullets, the zones-today list and the waste chip. */
  function consModelPanel(E){
    const p = E.data.power, sv = p.subview, ar = E.lang === 'ar';
    if (!sv) return `<div class="cmpanel"><p class="alempty" data-testid="pw-model-unset">${esc(E.t('pwModelNotConfigured'))}</p></div>`;   /* real mode: no model for this project */
    const mrow = (lbl, val, note, svg2) =>
      `<div class="cmrow"><div class="cmhead"><span class="cmlbl">${esc(lbl)}</span>
        <span class="cmval">${val}</span><span class="cmnote">${esc(note)}</span></div>${svg2||''}</div>`;
    const bulletS = (bands, vSegs, tickPct) =>
      `<svg class="cmbullet">${bands.map(b2=>`<rect x="${b2[0]}%" y="8" width="${b2[1]-b2[0]}%" height="8" fill="${b2[2]}"/>`).join('')}
        ${vSegs.map((s2,i2)=>`<rect x="${s2[0]}%" y="10" width="${(s2[1]-s2[0]).toFixed(1)}%" height="4"${i2===0?' rx="2"':''} fill="${s2[2]}"/>`).join('')}
        <line x1="${tickPct}%" x2="${tickPct}%" y1="5" y2="19" stroke="var(--chTx)" stroke-width="1.25"/></svg>`;
    const bPct = +(sv.baselineKw/sv.scaleMaxKw*100).toFixed(1);
    const lPct = +(sv.loadNowKw/sv.scaleMaxKw*100).toFixed(1);
    const load = bulletS([[0,bPct,'var(--chTrack)'],[bPct,100,'var(--chBandWarn)']],
      [[0,bPct,'#4EA3E8'],[bPct,lPct,'#FFC53D']], bPct);
    const pPct = +(sv.peakKw/sv.limitKw*100).toFixed(1);
    const peak = bulletS([[0,80,'var(--chTrack)'],[80,95,'var(--chBandWarn)'],[95,100,'var(--chBandCrit)']],
      [[0,pPct,'#4EA3E8']], 100);
    const pfP = (v2)=>+((v2-sv.pfScale[0])/(sv.pfScale[1]-sv.pfScale[0])*100).toFixed(1);
    const pf = bulletS([[0,pfP(sv.pfTarget),'var(--chBandWarn)'],[pfP(sv.pfTarget),100,'var(--chTrack)']],
      [[0,pfP(sv.pf),'#FFC53D']], pfP(sv.pfTarget));
    const zrows = p.zones.map((z,i2)=>`<div class="cmzrow" data-act="none" role="button" tabindex="0">
        <span class="cmzdot" style="background:${p.zoneHues[i2]}"></span>
        <span class="cmzname">${esc(ar?(p.zonesAr[i2]||z):z)}</span>
        <span class="cmzval">${fmt(sv.zonesToday[i2][0])}</span>
        <span class="cmzpct">${sv.zonesToday[i2][1]}%</span></div>`).join('')
      + `<div class="cmzrow"><span class="cmzname">${esc(E.t('totalMetered'))}</span>
        <span class="cmzval">${fmt(sv.totalMwh,1)} MWh</span><span class="cmzpct">100%</span></div>`;
    const openBtn = `<button class="btnP btnSm" data-act="goPage" data-page="power" data-sub="power">${esc(E.t('openAnalytics'))}</button>`;
    return modShell(E, E.t('subPower'), '', openBtn,
      mrow(E.t('cmLoadNow'), `${fmt(sv.loadNowKw,1)} <i class="cmunit">kW</i>`, E.t('cmBaseline',{v:sv.baselineKw}), load)
      + mrow(E.t('cmPeakToday'), `${fmt(sv.peakKw,1)} <i class="cmunit">kW</i>`, E.t('cmLimit',{v:sv.limitKw}), peak)
      + mrow(E.t('cmPf'), fmt(sv.pf,1), E.t('cmTarget',{v:sv.pfTarget}), pf)
      + mrow(E.t('cmAvoid'), `<span class="cWarn2">AED ${fmt(sv.avoidAed,1)}</span>`, `${fmt(sv.avoidKwh,1)} kWh`)
      + `<div class="cmzhead">${esc(E.t('zonesToday'))}</div>${zrows}
      <div class="cmwarn"><span class="cmwdot"></span>
        <span class="cmwtxt">${esc(E.t('wasteWarnN',{n:sv.warnN}))} \u00b7 <span class="tMonoS">AED ${fmt(sv.warnAed,1)}</span></span>
        <button class="cmwview" data-act="goPage" data-page="power" data-sub="power">${esc(E.t('viewW'))}</button></div>`);
  }

  /* ---------------------------- register table ----------------------------- */
  function registerTable(E, binding){
    const s = E.state, t = E.t.bind(E);
    let rows = E.data.assets.slice();
    const q = (s.regQ||'').toLowerCase();
    if(q) rows = rows.filter(r => r.id.toLowerCase().includes(q) || r.zone.toLowerCase().includes(q));
    if(s.regStF) rows = rows.filter(r => r.st === s.regStF);
    if(s.regSysF) rows = rows.filter(r => (r.alarms||[]).some(id => E.alarm(id).fam === s.regSysF));
    if(s.regSevF) rows = rows.filter(r => (r.alarms||[]).some(id => E.alarm(id).sev === s.regSevF));
    if(s.regSort){
      const dir = s.regSortDir === 'desc' ? -1 : 1;
      const ord = { alarm:0, stale:1, ok:2 };
      rows.sort((a,b2) => s.regSort==='st' ? (ord[a.st]-ord[b2.st])*dir
        : s.regSort==='wos' ? (a.wos-b2.wos)*dir
        : String(a[s.regSort]).localeCompare(String(b2[s.regSort]))*dir);
    }
    const th = (k, lbl, filt) => `<th data-act="regSort" data-k="${k}" aria-sort="${s.regSort===k?(s.regSortDir==='desc'?'descending':'ascending'):'none'}">
      ${esc(t(lbl))} <span class="sortglyph">↕</span>${filt?` <span class="sortglyph">▾</span>`:''}</th>`;
    const chipFor = r => {
      const c = { critical:0, high:0, medium:0 };
      (r.alarms || []).forEach(id => { const a = E.alarm(id); if (a && c[a.sev] != null) c[a.sev]++; });
      const chips = ['critical','high','medium'].filter(s => c[s]).map(s => `<span class="statchip" data-sev="${s}">${c[s]} ${esc(t('rib'+s[0].toUpperCase()+s.slice(1)))}</span>`).join('');
      if (chips) return `<span class="regsevs">${chips}</span>`;
      if (r.st === 'stale') return `<span class="statchip" data-sev="stale">${esc(t('chipStale',{h:r.staleH}))}</span>`;
      if (r.st === 'alarm') return `<span class="statchip" data-sev="high">${esc(t('chipAlarm',{sev:t('ribHigh')}))}</span>`;
      return `<span class="tCap">${esc(t('stNormal'))}</span>`;
    };
    const woCell = r => !r.wost ? `<span class="tCap">${esc(t('emptyDash'))}</span>`
      : `<span class="row gap6"><span class="wodot" data-st="${r.wost}"></span>${esc(t('wo'+r.wost[0].toUpperCase()+r.wost.slice(1)))}</span>`;
    const staleN = E.data.assets.filter(r=>r.st==='stale').length;
    return `<section class="regwrap" aria-label="${esc(t('regTitle'))}">
      <div class="regbar">
        <div><div class="modtitle">${esc(t('modAssets'))}</div>
          <span class="alcardt">${esc(t('regHead'))}</span>
          <span class="alcardm"> ${esc(t('regConnected',{n:rows.length,total:fmt(E.data.registerTotal,0)}))} </span>
          <button class="alcardm statlink" data-act="regStF" data-v="stale" data-on="${s.regStF==='stale'}">${esc(t('regStaleN',{n:staleN}))}</button></div>
        <input class="regsearch msA" data-act="regQ" value="${esc(s.regQ||'')}" placeholder="${esc(t('regSearchPh'))}" aria-label="${esc(t('regSearchPh'))}">
        ${s.regSysF?`<button class="chip" data-on="true" data-act="regSysClear">${esc((f=>f?(E.lang==='ar'?f.ar:f.en):s.regSysF)(E.data.families.find(x=>x.id===s.regSysF)))} ${icon('x',10)}</button>`:''}
        ${s.regSevF?`<button class="chip" data-on="true" data-act="regSevClear">${esc(t('rib'+s.regSevF[0].toUpperCase()+s.regSevF.slice(1)))} ${icon('x',10)}</button>`:''}
        <button class="btnG btnSm" data-act="none">${esc(t('viewsW'))} ${icon('chevD',11)}</button>
      </div>
      <div class="regscroll"><table class="reg">
        <thead><tr>${th('id','colAssetId')}${th('st','colStatus',true)}${th('floor','colFloor',true)}${th('zone','colZone')}${th('wos','colWos')}<th>${esc(t('colWoStatus'))}</th><th></th></tr></thead>
        <tbody>${rows.map(r => `<tr data-act="openAsset" data-asset="${esc(r.id)}" data-tab="alarms" data-on="${s.assetSel===r.id}" tabindex="0">
          <td class="mono">${esc(r.id)}</td><td>${chipFor(r)}</td>
          <td>${esc(r.floor)}</td><td data-tip="${esc(E.lang==='ar'?(r.zoneAr||r.zone):r.zone)}" data-tipif="trunc">${esc(E.lang==='ar'?(r.zoneAr||r.zone):r.zone)}</td>
          <td class="mono" data-act="openAsset" data-asset="${esc(r.id)}" data-tab="workorder">${r.wos||t('emptyDash')}</td><td data-act="openAsset" data-asset="${esc(r.id)}" data-tab="workorder">${woCell(r)}</td>
          <td><span class="cT3">${icon('dots',13)}</span></td></tr>`).join('')}
        </tbody></table></div></section>`;
  }

  /* Brand slot (D54): the top-bar mark comes from site.brand — both colour
     marks render and the theme attribute shows one (no re-render on theme
     change); the mono mark is the print variant and the co-brand lockup's
     EKO mark. Brand names stay Latin (i18n law); only "powered by" is a
     string. */
  function brandLogo(E){
    const b = E.data.brand || {};
    const L = b.logo || {};
    const name = b.name || 'EKO';
    const img = (k, cls) => L[k] ? `<img class="${cls}" data-on="${k}" src="${esc(L[k])}" alt="" draggable="false">` : '';
    const partner = b.partner && b.partner.logo
      ? `<img class="brandpartner" src="${esc(b.partner.logo)}" alt="${esc(b.partner.name||'')}"><span class="brandby">${esc(E.t('poweredBy'))}</span>${img('mono','brandimg')}`
      : '';
    /* No file configured -> the wordmark text (white-label fallback); the
       slot itself is a fixed box, so any aspect ratio scales INSIDE it and
       the breadcrumb never moves. */
    const marks = (L.light || L.dark)
      ? img('light','brandimg') + img('dark','brandimg') + img('mono','brandimg')
      : `<span class="wordmark">${esc(name)}</span>`;
    return `<a class="brandslot" href="#" data-act="goMod" data-mod="overview" data-page="marsa-overview" aria-label="${esc(name)}" data-partner="${partner?1:0}">
      ${partner || marks}</a>`;
  }

  /* Work-order morph button (D47): ONE footprint, three states - idle
     "+ Work order", raising (spinner, disabled, width locked), raised
     ("check WO-2341" green chip that OPENS the Activity tab). The long
     confirmation sentence lives in the toast and the tooltip, never in the
     row - so the pill row and the phone footer never reflow. */
  function woBtn(E, id){
    const t = E.t.bind(E);
    const phase = (E.state.woPhase||{})[id];
    const done = E.state.woRaised[id];
    if(phase === 'raising')
      return `<button class="btnG btnSm wobtn" disabled aria-busy="true">
        <span class="wospin" aria-hidden="true"></span>${esc(t('woRaising'))}</button>`;
    if(done)
      return `<button class="btnG btnSm wobtn wodone" data-born="${E.state.woBorn===id?1:0}"
        data-act="woOpen" data-asset="${esc(id)}"
        data-tip="${esc(t('woRaised',{id:done}))} \u2014 ${esc(t('apActivityTab'))}">
        <svg class="wocheck" width="12" height="12" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
          <path d="M20 6 9 17l-5-5"/></svg>${esc(done)}</button>`;
    return `<button class="btnG btnSm wobtn" data-act="cwo" data-asset="${esc(id)}">+ ${esc(t('apWoBtn'))}</button>`;
  }

  /* ------------------------------ asset panel ------------------------------
     Reference anatomy (D43 rulings): header = asset CODE + chip + expand +
     close; context = location · zone · plain-language type; action pills
     Locate in 3D (primary) / Work order / CAFM (Analytics is a tab, dropped
     from pills); tabs Alarms / Analytics / O&M / Warranty (+ Control only when
     the data contract, site flag and role permit). Alarms holds FDD and open
     alarms; Analytics holds analog live values and the trend graph.
     Desktop has no footer; the PHONE SHEET keeps a sticky
     footer (intentional responsive divergence, logged). */
  /* The minimum the panel needs, built from the alarms that name the asset */
  function alarmAsAsset(E, id){
    const als = (E.data.alarms || []).filter(a => a.asset === id);
    if(!als.length) return null;
    const a = als[0];
    return { id, st:'alarm', alarms: als.map(x => x.id), params: [], activity: [],
      typeEn: a.locEn ? String(a.locEn).split(' · ')[0] : '', typeAr: a.locAr ? String(a.locAr).split(' · ')[0] : '',
      level: '', levelAr: '', zone: '', zoneAr: '' };
  }
  /* Catalog comes from /api/fin/documents. Family order in that file is the match order.
     A loaded list with no family hides fixture manuals. */
  function docToken(id, code) {
    const c = String(code || '').toUpperCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return !!c && new RegExp('(?:^|[^A-Z0-9])' + c + '(?:[^A-Z0-9]|$)').test(id);
  }
  function docMatch(asset, fam) {
    const id = String(asset.id || '').toUpperCase();
    const type = String(asset.typeEn || '').toLowerCase();
    const tags = (asset.tags || []).map(t => String(t).toLowerCase());
    if ((fam.tags || []).some(t => { const n = String(t).toLowerCase(); return type === n || tags.indexOf(n) !== -1; })) return true;
    if ((fam.codes || []).some(c => docToken(id, c))) return true;
    if ((fam.types || []).some(p => p && type.indexOf(String(p).toLowerCase()) !== -1)) return true;
    if ((fam.names || []).some(p => p && id.indexOf(String(p).toUpperCase()) !== -1)) return true;
    return false;
  }
  function docFileUrl(d) {
    if (!d) return '';
    const ref = d.ref ? String(d.ref) : '';
    const cfg = window.DashboardData && window.DashboardData.config;
    /* Standalone is already on the FIN host, so the record file uses that session. */
    if (cfg && cfg.directMode && ref && cfg.project) {
      const rec = ref.charAt(0) === '@' ? ref.slice(1) : ref;
      return '/api/' + encodeURIComponent(cfg.project) + '/rec/' + encodeURIComponent(rec).replace(/%3A/gi, ':') + '/file';
    }
    if (ref) return '/api/fin/file?ref=' + encodeURIComponent(ref);
    const url = String(d.url || '');
    return url.indexOf('/api/fin/file?') === 0 ? url : '';
  }
  function docRowData(d) {
    if (!d || !(d.name || d.nameAr)) return null;
    return { tEn: d.name || d.nameAr, tAr: d.nameAr || d.name, meta: 'PDF', url: docFileUrl(d) };
  }
  function docsFor(E, asset) {
    const families = E.data && E.data.documents;
    if (!Array.isArray(families)) return null;
    const fam = families.find(f => docMatch(asset, f)) || null;
    if (!fam) return { om: null, warranty: null };
    return { om: docRowData(fam.om), warranty: docRowData(fam.warranty) };
  }
  /* Same name rules as readFcuPoints. A blank or Null point is left off the panel. */
  function fcuFold(name) {
    return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }
  /* Same rule as findPoint in hvacGeometry: first point whose folded navName matches. */
  function fcuFind(points, test) {
    const list = Array.isArray(points) ? points : [];
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      const name = p && (p.navName != null ? p.navName : p[0]);
      if (name != null && test(fcuFold(name))) return p;
    }
    return null;
  }
  function fcuClean(value) {
    if (value == null) return null;
    const s = String(value).trim();
    if (!s || s === '—' || s === '--' || s === 'N/A' || /^null$/i.test(s)) return null;
    return s;
  }
  function fcuNumber(raw) {
    const m = String(raw).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
    if (!m) return null;
    const n = parseFloat(m[0]);
    return Number.isFinite(n) ? n : null;
  }
  /* The unit is added only if the value lacks it */
  function fcuShown(raw, unit) {
    if (!raw) return null;
    if (/[a-zA-Z°%]/.test(raw)) return raw;
    const n = fcuNumber(raw);
    if (n != null && unit && raw.indexOf(unit.trim()) === -1) {
      const text = fmt(n, 1);
      return text + unit;
    }
    return raw;
  }
  function isFddNav(name) {
    const k = fcuFold(name);
    return k.indexOf('fdd') === 0 || k.indexOf('rule') === 0;
  }
  /* FIN's unit tag; never guessed from the name */
  function analogUnit(unit) {
    const u = String(unit || '').trim();
    return u ? ' ' + u : '';
  }
  /* The air-handler family as a whole word of the id or type: "MAHU-ANC09-BF-01" is MAHU,
     never AHU, and "ILIANA ECO-ANC09-BF-01" is the kitchen-exhaust ecology unit whatever
     type FIN gives it. FCU, AHU and FAHU use the generic analog rows. */
  function airKind(asset) {
    const s = (String(asset && asset.id || '') + ' ' + String(asset && asset.typeEn || '')).toUpperCase();
    const m = s.match(/(?:^|[^A-Z])(AHU|MAHU|FAHU|ECO)(?=[^A-Z]|$)/);
    return m ? m[1] : null;
  }
  /* The first of these folded point names (matched on the end) that has a value */
  function pointVal(points, ...names) {
    for (const n of names) {
      const p = fcuFind(points, k => k.endsWith(n));
      const v = fcuClean(p && (p.text || (p.currentValue != null ? p.currentValue : p[2])));
      if (v != null) return v;
    }
    return null;
  }
  function pointShown(raw) {
    return fcuShown(raw, '') || '—';
  }
  /* Same names as readMauPoints. Every row is shown, a missing point as "—",
     so the panel says which MAHU points FIN is not sending. */
  function mauPointRows(asset) {
    if (airKind(asset) !== 'MAHU') return '';
    const points = (asset && asset.points) || [];
    if (!points.length) return '';
    const val = (...names) => pointVal(points, ...names);
    const rows = [
      ['FA_DAMPER_STS', pointShown(val('fadampersts'))],
      ['PRE_FILTER', pointShown(val('prefilter'))],
      ['BAG_FILTER', pointShown(val('bagfilter'))],
      ['TEMP_BEFORE_HEATPIPE', pointShown(val('tempbeforeheatpipe'))],
      ['HUM_BEFORE_HEATPIPE', pointShown(val('humbeforeheatpipe'))],
      ['TEMP_AFTER_HEATPIPE', pointShown(val('tempafterheatpipe'))],
      ['HUM_AFTER_HEATPIPE', pointShown(val('humafterheatpipe'))],
      ['COOLING_VALVE_POS', pointShown(val('coolingvalvepos'))],
      ['COOLING_VALVE_CMD', pointShown(val('coolingvalvecmd'))],
      ['CHW_SUP_TEMP', pointShown(val('chwsuptemp'))],
      ['CHW_RET_TEMP', pointShown(val('chwrettemp'))],
      ['SF_VFD_RUN_STS', pointShown(val('sfvfdrunsts'))],
      ['SF_VFD_SPD_POS', pointShown(val('sfvfdspdpos'))],
      ['SF_TRIP_ALARM', pointShown(val('sftripalarm'))],
      ['SA_TEMP', pointShown(val('satemp'))],
      ['SA_TEMP_SP', pointShown(val('satempsp'))],
      ['SA_HUM', pointShown(val('sahum'))],
      ['SA_PRESSURE', pointShown(val('sapressure'))],
      ['SA_PRESSURE_SP', pointShown(val('sapressuresp'))],
    ];
    return rows.map(row => `<div class="aprow"><dt>${esc(row[0])}</dt><dd>${esc(row[1])}</dd></div>`).join('');
  }
  /* Same names as readEcoPoints, in the order of its FIN page. COMMAN_ALARM is FIN's spelling. */
  function ecoPointRows(asset) {
    if (airKind(asset) !== 'ECO') return '';
    const points = (asset && asset.points) || [];
    if (!points.length) return '';
    const val = (...names) => pointVal(points, ...names);
    const rows = [
      ['BOX_FILTER', pointShown(val('boxfilter'))],
      ['2ND_STAGE_UV_ALARM', pointShown(val('2ndstageuvalarm'))],
      ['KEF_ON_STS', pointShown(val('kefonsts'))],
      ['PRE_FILTER', pointShown(val('prefilter'))],
      ['BAG_FILTER', pointShown(val('bagfilter'))],
      ['1ST_STAGE_UV_ALARM', pointShown(val('1ststageuvalarm'))],
      ['VFD_SPEED_POS', pointShown(val('vfdspeedpos'))],
      ['KEF_HOA', pointShown(val('kefhoa'))],
      ['KEF_TRIP_STS', pointShown(val('keftripsts'))],
      ['VFD_RUN_STS', pointShown(val('vfdrunsts'))],
      ['ALL_FILTER_ALARM', pointShown(val('allfilteralarm'))],
      ['COMMAN_ALARM', pointShown(val('commanalarm', 'commonalarm'))],
    ];
    return rows.map(row => `<div class="aprow"><dt>${esc(row[0])}</dt><dd>${esc(row[1])}</dd></div>`).join('');
  }
  function analogPointRows(asset) {
    const listed = Array.isArray(asset && asset.analog) ? asset.analog : null;
    const rows = [];
    const push = (name, raw, unit) => {
      const shown = fcuShown(fcuClean(raw), analogUnit(unit));
      if (shown) rows.push([name, shown]);
    };
    // data-map has already removed the alarm points
    if (listed && listed.length) {
      listed.forEach(p => {
        if (!p || !p[0] || isFddNav(p[0])) return;
        push(p[0], p[2], p[3]);
      });
    } else {
      const fromPts = (asset && asset.points) || [];
      if (fromPts.length) {
        fromPts.forEach(p => {
          if (!p || !p.reporting) return;
          if (isFddNav(p.navName) || p.alarmPoint === true) return;
          const folded = fcuFold(p.navName);
          if (folded.indexOf('warrant') !== -1) return;
          push(p.navName, p.text || p.currentValue, p.unit);
        });
      } else {
        ((asset && asset.params) || []).forEach(p => {
          if (!p || !p[0] || isFddNav(p[0])) return;
          const folded = fcuFold(p[0]);
          if (folded.indexOf('warrant') !== -1) return;
          push(p[0], p[2], p[3]);
        });
      }
    }
    if (!rows.length) return '';
    return rows.map(row => `<div class="aprow"><dt>${esc(row[0])}</dt><dd>${esc(row[1])}</dd></div>`).join('');
  }
  function workOrderBody(E, r) {
    const t = E.t.bind(E);
    const orders = r.workOrders || [];
    const perKey = { D: 'woPerD', W: 'woPerW', M: 'woPerM', Y: 'woPerY', H: 'woPerH' };
    const period = code => {
      const key = perKey[String(code || '').toUpperCase()];
      return key ? t(key) : (code || '');
    };
    const row = (label, value) => {
      if (value == null || value === '' || value === '--') return '';
      return `<div class="aprow"><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`;
    };
    if (!orders.length) {
      const err = (E.data && E.data.workOrderError) || '';
      const st = (E.data && E.data.workOrderState) || '';
      const note = err ? `${t('apWoReadFail')} ${err}` : st === 'off' ? t('apWoOff') : st === 'pending' ? t('apWoPending') : t(r.equipId ? 'apWoNoRows' : 'apWoUnlinked');
      return `<p class="alempty">${esc(t('apWoEmpty'))}</p>`
        + (r.equipId ? row(t('apWoEquip'), r.equipId) : '')
        + `<p class="apnote">${esc(note)}</p>`;
    }
    const cards = orders.map(order => {
      const st = order.status === 'over' || order.status === 'due' ? order.status : 'sched';
      const stKey = st === 'over' ? 'woOver' : st === 'due' ? 'woDue' : 'woSched';
      return `<article class="apwocard">
        <div class="apwohead">
          <span class="tMono">${esc(order.id)}</span>
          <span class="row gap6"><span class="wodot" data-st="${st}"></span>${esc(t(stKey))}</span>
          ${order.type ? `<span class="tCap">${esc(order.type)}</span>` : ''}
        </div>
        ${row(t('apWoDesc'), order.description)}
        ${row(t('apWoEquip'), order.equipment)}
        ${row(t('apWoTag'), order.assetTag)}
        ${row(t('apWoPos'), order.position)}
        ${row(t('apWoOrg'), order.organization)}
        ${row(t('apWoDue'), order.dueDate)}
        ${row(t('apWoPeriod'), period(order.period))}
        ${row(t('apWoPm'), order.pmSchedule)}
        ${row(t('apWoCreated'), order.created)}
        ${row(t('apWoStart'), order.startDate)}
        ${row(t('apWoEnd'), order.endDate)}
      </article>`;
    }).join('');
    return cards + `<p class="apnote">${esc(t('apWoNote'))}</p>`;
  }

  function histChart(E, r, cmp){
    const t = E.t.bind(E), loc = E.lang === 'ar' ? 'ar-AE' : 'en-GB';
    const hist = cmp.hist, n = hist.length;
    const sel = E.state.apHist && E.state.apHist.id === r.id ? E.state.apHist.i : n - 1;
    const i = Math.max(0, Math.min(n - 1, sel)), day = hist[i];
    const now = new Date(), today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    const dateOf = (d, o) => new Date(d.t).toLocaleDateString(loc, Object.assign({ timeZone: 'UTC' }, o));
    const dayName = d => d.t === today ? t('apHistToday') : d.t === today - 864e5 ? t('apHistYesterday') : dateOf(d, { weekday: 'short', day: 'numeric', month: 'short' });
    const hh = h => String(h).padStart(2, '0');
    const groups = [];
    for (let h = 0; h < 24; h++) groups.push({ label: h % 3 ? '' : hh(h), tip: `${dayName(day)} ${hh(h)}:00`, a: day.a ? day.a[h] : null, b: day.b ? day.b[h] : null });
    const bars = window.ekoCompareBars(groups, { unit: cmp.unit, fmt: v => fmt(v, 1), actLbl: t('apCmpActual'), spLbl: t('apCmpSp'), keep: true, dense: true });
    const avgs = hist.map(d => d.aAvg).filter(v => v != null && isFinite(v));
    const lo = Math.min.apply(null, avgs), span = (Math.max.apply(null, avgs) - lo) || 1;
    const cells = hist.map((d, k) => `<i data-on="${k === i ? 1 : 0}" style="height:${d.aAvg == null ? 0 : (25 + (d.aAvg - lo) / span * 75).toFixed(1)}%"></i>`).join('');
    const step = (v, dis, lbl, ic) => `<button class="iconbtn icon26" data-act="apHistStep" data-v="${v}" aria-label="${esc(lbl)}"${dis ? ' disabled' : ''}>${icon(ic, 14)}</button>`;
    const cap = `${esc(E.ph(cmp.actName || t('apCmpActual')))} · ${esc(t('apHistHourly'))}${cmp.unit ? ` · ${esc(cmp.unit)}` : ''}`;
    return `<p class="tCap">${cap}</p>
      <div class="aphhead">${step(-1, i === 0, t('apHistPrev'), 'chevL')}<span class="aphday">${esc(dayName(day))}</span>${step(1, i === n - 1, t('apHistNext'), 'chevR')}</div>
      <div class="apcmpleg"><span class="apcmpdot" data-k="act"></span>${esc(t('apCmpActual'))}<span class="apcmpdot" data-k="sp"></span>${esc(t('apCmpSp'))}</div>
      <div class="apcmpchart">${bars.html}</div>
      <div class="aphnav" role="slider" tabindex="0" data-id="${esc(r.id)}" data-n="${n}" aria-label="${esc(t('apHistNav'))}" aria-valuemin="0" aria-valuemax="${n - 1}" aria-valuenow="${i}" aria-valuetext="${esc(dayName(day))}">${cells}<span class="aphwin" style="left:${(i / n * 100).toFixed(3)}%;width:${(100 / n).toFixed(3)}%"></span></div>
      <div class="aphends"><span>${esc(dateOf(hist[0], { day: 'numeric', month: 'short' }))}</span><span>${esc(dateOf(hist[n - 1], { day: 'numeric', month: 'short' }))}</span></div>`;
  }

  function assetPanel(E){
    const id = E.state.assetSel;
    if(!id) return '';
    const r = E.data.assets.find(a => a.id === id) || (window.EKO_MT && window.EKO_MT.meterAsAsset(E, id))   /* D96: a meter row opens here too */
      || alarmAsAsset(E, id);   /* an alarm's equipment the register does not list yet */
    if(!r) return '';
    const t = E.t.bind(E), arL = E.lang === 'ar';
    const als = (r.alarms||[]).map(x=>E.alarm(x)).filter(Boolean);   /* a refresh can retire an alarm id the row still lists */
    const sevN = { critical:0, high:0, medium:0 };
    als.forEach(a => { if (sevN[a.sev] != null) sevN[a.sev]++; });
    const worst = ['critical','high','medium'].map(s => als.find(a => a.sev === s)).find(Boolean) || als[0];
    const sevChips = ['critical','high','medium'].filter(s => sevN[s]).map(s => `<span class="statchip" data-sev="${s}">${sevN[s]} ${esc(t('rib'+s[0].toUpperCase()+s.slice(1)))}</span>`).join('');
    const ctl = window.EKO_CTL && window.EKO_CTL.showsControl(E, r);
    let tab = E.state.apTab;
    if (tab === 'activity') tab = 'analytics';
    if(!['alarms','analytics','om','warranty','workorder','control'].includes(tab)) tab = 'alarms';
    if(tab === 'control' && !ctl) tab = 'alarms';
    const trP = x => E.ph(x);
    const foldNav = n => String(n || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const wtySlot = n => { const f = foldNav(n); if (f.indexOf('warrant') === -1) return null; if (f.indexOf('start') !== -1) return 'start'; if (f.indexOf('end') !== -1) return 'end'; return null; };
    const alsText = als.map(a => String((a && (a.plainEn || a.techEn)) || '').toLowerCase());
    const fddRows = (r.params || []).filter(p => {
      if (!isFddNav(p[0]) || wtySlot(p[0])) return false;
      const msg = String(p[2] || '').toLowerCase();
      if (!msg) return false;
      if (msg.length < 16) return true;   // a state word (FAULT), not a message
      return !alsText.some(t => t && (t.indexOf(msg.slice(0, 48)) !== -1 || msg.indexOf(t.slice(0, 48)) !== -1));
    });
    const alarmPtRows = (r.alarmPts || []).filter(p => fcuClean(p[2])).map(p => [p[0], fcuClean(p[2])]);
    const analogRows = analogPointRows(r);
    /* MAHU and ECO list every FIN point they draw, a missing one as "—"; the rest use the generic analog rows */
    const typeRows = mauPointRows(r) || ecoPointRows(r);
    const cmp = r.compare || null;
    const reason = r.st === 'stale' ? 'dgNoTrend.stale' : (r.trendKind === 'state' ? 'dgNoTrend.state' : 'dgNoTrend.none');
    const graphBlock = (() => {
      if (cmp && Array.isArray(cmp.hist) && cmp.hist.length && typeof window.ekoCompareBars === 'function') return histChart(E, r, cmp);
      const dayGroups = cmp && Array.isArray(cmp.days) ? cmp.days.filter(d => d && (d.actual != null || d.sp != null)).map(d => ({ label: d.label, a: d.actual, b: d.sp })) : [];
      const pairGroups = cmp && Array.isArray(cmp.pairs) ? cmp.pairs.filter(p => p.actual != null || p.sp != null).map(p => ({ label: t(p.key), a: p.actual, b: p.sp, unit: p.unit })) : [];
      const groups = dayGroups.length >= 2 ? dayGroups : pairGroups;
      if (!groups.length || typeof window.ekoCompareBars !== 'function') {
        return `<p class="tCap">${esc(t('emptyDash'))} · ${esc(t(reason))}</p>`;
      }
      const days = dayGroups.length >= 2;
      const cap = days
        ? `${esc(trP(cmp.actName || t('apCmpActual')))} · ${esc(t('apCmpDays'))}${cmp.unit ? ` · ${esc(cmp.unit)}` : ''}`
        : esc(t('apCmpCap'));
      const bars = window.ekoCompareBars(groups, { unit: days ? cmp.unit : '', fmt: v => fmt(v, 1), actLbl: t('apCmpActual'), spLbl: t('apCmpSp') });
      return `<p class="tCap">${cap}</p>
        <div class="apcmpleg"><span class="apcmpdot" data-k="act"></span>${esc(t('apCmpActual'))}<span class="apcmpdot" data-k="sp"></span>${esc(t('apCmpSp'))}</div>
        <div class="apcmpchart">${bars.html}</div>`;
    })();
    const pack = docsFor(E, r);
    const omDocs = pack ? (pack.om ? [pack.om] : []) : (r.omDocs || []);
    const warranty = pack ? (pack.warranty || null) : (r.warranty || null);
    const docRow = d2 => {
      const title = esc(arL ? (d2.tAr || d2.tEn) : d2.tEn);
      const name = d2.url
        ? `<button type="button" class="aplink" data-act="docOpen" data-url="${esc(d2.url)}" data-title="${title}">${title}</button>`
        : title;
      return `<div class="aprow"><dt>${name}</dt><dd class="cT3">${esc(d2.meta || '')}</dd></div>`;
    };
    const wtyPick = which => {
      if (which === 'start' && r.wtyStart) return r.wtyStart;
      if (which === 'end' && r.wtyEnd) return r.wtyEnd;
      const fromPts = (r.points || []).find(p => wtySlot(p.navName) === which);
      if (fromPts && fromPts.currentValue) return fromPts.currentValue;
      const fromParams = (r.params || []).find(p => wtySlot(p[0]) === which);
      return fromParams ? fromParams[2] : null;
    };
    const wtyFmt = v => {
      if (v == null || v === '' || v === '—' || v === '--') return null;
      const s = String(v).trim();
      if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
        const d = new Date(s);
        if (!isNaN(d.getTime())) return d.toLocaleDateString(arL ? 'ar-AE' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
      }
      return s;
    };
    const wtyYmd = v => {
      if (v == null || v === '' || v === '—' || v === '--') return null;
      const s = String(v).trim();
      const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
      if (iso) return { y: +iso[1], m: +iso[2], d: +iso[3] };
      const dt = new Date(s);
      if (isNaN(dt.getTime())) return null;
      return { y: dt.getFullYear(), m: dt.getMonth() + 1, d: dt.getDate() };
    };
    const dubaiYmd = () => {
      try {
        const tz = (window.INJECTED_PROJECT_CONFIG && window.INJECTED_PROJECT_CONFIG.site && window.INJECTED_PROJECT_CONFIG.site.timezone) || 'Asia/Dubai';   /* the open project's site */
        const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(new Date());
        const g = k => parseInt((parts.find(p => p.type === k) || {}).value, 10);
        return { y: g('year'), m: g('month'), d: g('day') };
      } catch (e) {
        const n = new Date();
        return { y: n.getFullYear(), m: n.getMonth() + 1, d: n.getDate() };
      }
    };
    const wtyStartVal = wtyFmt(wtyPick('start'));
    const wtyEndVal = wtyFmt(wtyPick('end'));
    const endYmd = wtyYmd(wtyPick('end'));
    let wtyLeftTxt = null;
    if (endYmd) {
      const today = dubaiYmd();
      const left = Math.round((Date.UTC(endYmd.y, endYmd.m - 1, endYmd.d) - Date.UTC(today.y, today.m - 1, today.d)) / 86400000);
      if (left > 0) wtyLeftTxt = t('apWtyLeft', { n: left });
      else if (left === 0) wtyLeftTxt = t('apWtyToday');
      else wtyLeftTxt = t('apWtyExpired');
    }
    const wtyDates = (wtyStartVal ? `<div class="aprow"><dt>${esc(t('apWtyStart'))}</dt><dd>${esc(wtyStartVal)}</dd></div>` : '')
      + (wtyEndVal ? `<div class="aprow"><dt>${esc(t('apWtyEnd'))}</dt><dd>${esc(wtyEndVal)}</dd></div>` : '')
      + (wtyLeftTxt ? `<div class="aprow"><dt>${esc(t('apWtyRemain'))}</dt><dd>${esc(wtyLeftTxt)}</dd></div>` : '');
    let body = '';
    if(tab === 'alarms'){
      const fddHtml = fddRows.length
        ? fddRows.map(p => `<div class="aprow"><dt>${esc(trP(p[0]))}</dt><dd>${esc(E.clip2 ? E.clip2(p[2]) : p[2])}</dd></div>`).join('')
        : '';
      const alarmPtHtml = alarmPtRows.length
        ? alarmPtRows.map(p => `<div class="aprow"><dt>${esc(trP(p[0]))}</dt><dd>${esc(p[1])}</dd></div>`).join('')
        : '';
      body = (fddHtml ? `<h4 class="tLbl">${esc(t('apFdd'))}</h4>${fddHtml}` : '')
        + alarmPtHtml
        + (als.length ? als.map(a => `<div class="alref">
        <div class="alrefh"><span class="statchip" data-sev="${a.sev}">${esc(t('rib'+a.sev[0].toUpperCase()+a.sev.slice(1)).toLowerCase())}</span>
          <span class="alrefage tMonoS msA">${esc(a.age)}</span></div>
        <div class="alreft">${esc(E.alarmLines(a).main)}</div>${E.alarmLines(a).sub ? `<div class="alreftech">${esc(E.alarmLines(a).sub)}</div>` : ''}
        <div class="alrefack">${a.ack ? esc(t('ackShort',{time:a.ack.time,who:a.ack.who})) : esc(t('apUnack'))}</div>
      </div>`).join('') : `<p class="alempty">${esc(t('apNoAlarms'))}</p>`)
      + `<p class="apnote">${esc(t('finNote'))}</p>`;
    } else if(tab === 'analytics'){
      body = `<h4 class="tLbl">${esc(t('apLiveParams'))}</h4>`
        + (typeRows || analogRows || `<p class="alempty">${esc(t('emptyDash'))}</p>`)
        + `<h4 class="tLbl seclbl">${esc(t('apFullT'))}</h4>${graphBlock}`;
    } else if(tab === 'om'){
      body = `<h4 class="tLbl seclbl">${esc(t('omLib'))}</h4>`
        + (omDocs.length ? omDocs.map(docRow).join('')
          : `<p class="alempty">${esc(t('omEmpty'))}</p>`)
        + `<h4 class="tLbl seclbl">${esc(t('apRefs'))}</h4>
        <div class="aprow"><dt>${esc(t('apMake'))}</dt><dd>${esc(r.make||t('emptyDash'))}</dd></div>
        <div class="aprow"><dt>${esc(t('apSerial'))}</dt><dd>${esc(r.serial||t('emptyDash'))}</dd></div>
        <div class="aprow"><dt>${esc(t('apSvc'))}</dt><dd>${esc(r.svc||t('emptyDash'))}</dd></div>
        <div class="aprow"><dt>${esc(t('apCafmRec'))}</dt><dd class="row gap6">
          <span class="tMonoS">${esc(r.cafm||t('emptyDash'))}</span>
          ${r.cafm?`<button class="aplink" data-act="none">${esc(t('openW'))}</button>`:''}</dd></div>
        <p class="apnote">${esc(t('omIndexed'))}</p>`;
    } else if(tab === 'workorder'){
      body = workOrderBody(E, r);
    } else if(tab === 'warranty'){
      if (warranty) {
        const title = esc(arL ? (warranty.tAr || warranty.tEn) : warranty.tEn);
        const name = warranty.url
          ? `<button type="button" class="aplink" data-act="docOpen" data-url="${esc(warranty.url)}" data-title="${title}">${title}</button>`
          : title;
        const bits = [`<span>${esc(warranty.meta || 'PDF')}</span>`];
        if (wtyStartVal) bits.push(`<span>${esc(t('apWtyStart'))} ${esc(wtyStartVal)}</span>`);
        if (wtyEndVal) bits.push(`<span>${esc(t('apWtyEnd'))} ${esc(wtyEndVal)}</span>`);
        if (wtyLeftTxt) bits.push(`<span>${esc(wtyLeftTxt)}</span>`);
        body = `<div class="aprow apwtyrow"><dt>${name}</dt><dd class="cT3"><span class="apwtypair">${bits.join('')}</span></dd></div>`;
      } else {
        body = wtyDates || `<p class="alempty">${esc(t('wtyEmpty'))}</p>`;
      }
    } else if(tab === 'control'){
      body = window.EKO_CTL.controlTab(E, r);
    }
    const woDone = E.state.woRaised[id];
    const orders = r.workOrders || [];
    const woOver = orders.some(o => o.status === 'over');
    const tabBtn = (k, lbl, n, sev) => `<button class="aptab" data-on="${tab===k}" data-act="apTab" data-v="${k}">${esc(lbl)}${n?`<span class="cbadge" data-sev="${sev || (worst?worst.sev:'medium')}">${n}</span>`:''}</button>`;
    return `<aside id="assetpanel" data-born="${E.state.born==='asset'?1:0}" data-wide="${E.state.apWide?1:0}" role="dialog" aria-label="${esc(id)}">
      <div class="draghandle"></div>
      ${E.state.locFocus && !E.stacked() ? `<div class="apback"><button class="btnG btnSm" data-act="locBack">${icon('chevL',14)} ${esc(t('backToAssets'))}</button></div>` : ''}
      <div class="aphead">
        <span class="tMono grow fw6">${esc(id)}</span>
        ${sevChips ? `<span class="regsevs">${sevChips}</span>` : ''}
        <button class="iconbtn icon26 aibtn tipU" data-act="aiOpen" data-ai-label="${esc(id)}" data-ai-topic="alarms" data-ai-cap="${esc(arL?(r.levelAr||r.level):r.level)}" data-tip="${esc(t('ai.about'))}" aria-label="${esc(t('ai.about'))}">${icon('spark',16)}</button>
        <button class="iconbtn icon26" data-act="apWide" data-on="${E.state.apWide?1:0}" aria-pressed="${E.state.apWide?'true':'false'}" aria-label="${esc(t('mpExpand'))}">${icon('maximize',14)}</button>
        <button class="iconbtn icon26" data-act="closeAsset" aria-label="${esc(t('close'))}">${icon('x',12)}</button>
      </div>
      <div class="apctx" data-tip="${esc(arL?(r.levelAr||r.level):r.level)} \u00b7 ${esc(arL?(r.zoneAr||r.zone):r.zone)}" data-tipif="trunc">${esc(arL?(r.levelAr||r.level):r.level)} · ${esc(arL?(r.zoneAr||r.zone):r.zone)} · ${esc(arL?(r.typeAr||r.typeEn||''):(r.typeEn||''))}</div>
      <div class="appills">
        <button class="btnP btnSm" data-act="locate" data-asset="${esc(id)}">${esc(t('locate3d'))}</button>
        ${woBtn(E, id)}
        <button class="btnG btnSm" data-act="none">⧉ ${esc(t('apCafm'))}</button>
      </div>
      <div class="aptabs">${tabBtn('alarms', t('apAlarms'), als.length||'')}${tabBtn('analytics', t('apAnalytics'))}${tabBtn('om', t('apOmTab'))}${tabBtn('warranty', t('apWtyTab'))}${tabBtn('workorder', t('apWoTab'), orders.length||'', woOver?'high':'medium')}${ctl?tabBtn('control', t('apControlTab')):''}</div>
      <div class="apbody">${body}</div>
      <div class="apfoot apfootmob">
        ${E.state.woRaised[id] || (E.state.woPhase||{})[id]
          ? `${woBtn(E, id)}<button class="btnG" data-act="locate" data-asset="${esc(id)}">${esc(t('locate3d'))}</button>`
          : `<button class="btnP" data-act="cwo" data-asset="${esc(id)}">${esc(t('cwo'))}</button>
             <button class="btnG" data-act="locate" data-asset="${esc(id)}">${esc(t('locate3d'))}</button>`}
        <button class="btnG apcafm" data-act="none" data-tip="${esc(t('apCafm'))}" aria-label="${esc(t('apCafm'))}">⧉</button>
      </div></aside>`;
  }

  /* Marker visibility (D70): ONE eye control, used in the alarms panel
     header and the Alert Centre's display section. It toggles the 3D
     markers only — never the list, the counts or the ribbon. */
  function mkEye(E){
    const on = !!E.state.markersOn, tp = E.t(on ? 'mkHideTip' : 'mkShowTip');
    return `<button class="iconbtn icon26 mkeye" data-act="mkToggle" data-on="${on}" aria-pressed="${on}"
      data-tip="${esc(tp)}" aria-label="${esc(tp)}">${icon(on ? 'eye' : 'eyeOff', 14)}</button>`;
  }
  return { esc, fmt, icon, aiBtn, ctl, sevGlyph, sevAction, sevTipFor, actTip, sparkPath, ribbon, woBtn, brandLogo, utilitiesSummary, mkEye,
           execSummary, energySummary, alarmModPanel, energyModPanel,
           powerPage, consModelPanel, utilitiesPanel, registerTable, assetPanel, summaryShell, modShell };
})();
