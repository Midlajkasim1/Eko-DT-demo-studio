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
  const fmt = (n, d=0) => Number(n).toLocaleString('en-US',
    { minimumFractionDigits: d, maximumFractionDigits: d });

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
  function sevGlyph(sev, acked, px=13, marker=false){
    const s = SEV[sev] || SEV.medium, c = s.c;
    const fill = acked ? 'none' : c;
    const stroke = marker ? 'rgba(0,0,0,0.5)' : c;
    const sw = marker ? 1 : 2.5;
    let shp, barY;
    if(s.shape==='circ'){ shp = `<circle cx="12" cy="12" r="10" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`; barY = 12; }
    else if(s.shape==='tri'){ shp = `<polygon points="12,3 22.5,21 1.5,21" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"/>`; barY = 15.5; }
    else { shp = `<rect x="3.5" y="3.5" width="17" height="17" rx="2" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`; barY = 12; }
    const mark = (!marker && !acked)
      ? (s.shape==='tri'
        ? `<path d="M12 10v4.4" stroke="#0B1020" stroke-width="2.8" stroke-linecap="round"/><path d="M12 18h.01" stroke="#0B1020" stroke-width="3" stroke-linecap="round"/>`
        : `<path d="M12 6.6v6.2" stroke="#0B1020" stroke-width="3" stroke-linecap="round"/><path d="M12 17.2h.01" stroke="#0B1020" stroke-width="3.2" stroke-linecap="round"/>`)
      : '';
    const bar = acked ? `<path d="M5.5 ${barY}h13" stroke="${c}" stroke-width="2.5" stroke-linecap="round"/>` : '';
    return `<svg width="${px}" height="${px}" viewBox="0 0 24 24" aria-hidden="true">${shp}${mark}${bar}</svg>`;
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
  function summaryShell(E, title, inner){
    const mn = E.state.ovpMin;
    return `<div id="ovp" data-min="${mn?1:0}">
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
  const sumVal = (E, r) => { const m = (E.data.metrics || {})[r.metric]; return m == null ? '\u2013' : fmt(m, r.d || 0); };
  function execSummary(E){
    const rows = E.data.summary.map(r => {
      const spark = r.spark
        ? `<div class="ovkspark"><svg viewBox="0 0 100 22" width="100" height="22" aria-hidden="true">
             <path d="${sparkPath(r.spark)}" fill="none" stroke="${r.dom}" stroke-width="1.5"/></svg>
           <span class="ovkdelta">${esc(E.lang==='ar'?r.deltaAr:r.deltaEn)}</span></div>`
        : `<div class="ovkcap" data-tone="${r.capTone||'t3'}">${esc(E.lang==='ar'?r.capAr:r.capEn)}</div>`;
      return `<div class="ovk" style="background:color-mix(in srgb, ${r.dom} 3%, transparent)">
        <div class="ovkhead"><span style="color:${r.dom}">${icon(r.icon,14,2)}</span>
          <span class="ovklbl">${esc(E.t(r.label))}</span>${ctl(E, E.t(r.label), E.lang==='ar' ? (r.capAr || r.deltaAr || '') : (r.capEn || r.deltaEn || ''))}</div>
        <div class="ovkval"><span class="ovknum">${esc(sumVal(E, r))}</span><span class="ovkunit">${esc(r.u)}</span></div>
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
      /* Energy dial (D38, Final mock): NOT the ramp gauge — a plain track
         with ONE tone-coloured arc (state colour), a needle and a hub, and
         no tick labels. */
      const g = ekoGauge(val, 0, mx, 'risk');
      const arcC = tone==='warn' ? '#E08A2E' : '#4EA36B';
      return `<div class="ovk ovkDark"><div class="ovkhead"><span class="scdot" data-tone="${tone==='warn'?'warn':'ok'}"></span><span class="ovklbl">${esc(lbl)}</span>${ctl(E, lbl, '')}</div>
        <div class="ovgauge"><svg viewBox="0 0 124 78" width="124" height="78">
          <path d="${g.track}" stroke="var(--bd1)" stroke-width="9" fill="none"/>
          ${g.hasFill?`<path d="${g.fillArc}" stroke="${arcC}" stroke-width="9" fill="none"/>`:''}
          <line x1="62" y1="66" x2="${g.nx}" y2="${g.ny}" stroke="var(--t1)" stroke-width="3" stroke-linecap="round"/>
          <circle cx="62" cy="66" r="5" fill="var(--s3)" stroke="var(--bd2)" stroke-width="1.5"/></svg></div>
        <div class="scrow"><span class="tMonoS fw6">${esc(String(val))}${esc(u)}</span>
          <span class="ovkcap msA" data-tone="${tone==='warn'?'warn':'pos'}">${esc(word)}</span></div></div>`;
    };
    const sp = d.perfSpark, mn = Math.min(...sp), mx2 = Math.max(...sp), span = (mx2-mn)||1;
    const pts = sp.map((v,i2)=>`${(i2/(sp.length-1)*90).toFixed(1)},${(18-(v-mn)/span*14).toFixed(1)}`).join(' ');
    return summaryShell(E, E.t('energySummary'), '<div class="ovklist">'
      + `<div class="ovk ovkDark"><div class="ovkhead"><span class="scdot" data-tone="ok"></span><span class="ovklbl">${esc(E.t('enPerf'))}</span>${ctl(E, E.t('enPerf'), '')}</div>
          <div class="ovkval"><span class="ovknum">${fmt(d.performancePct,2)}</span><span class="ovkunit">%</span></div>
          <div class="scrow"><svg viewBox="0 0 90 20" width="90" height="20" aria-hidden="true">
            <polyline points="${pts}" fill="none" stroke="var(--domEnergy)" stroke-width="1.5"/></svg>
          <span class="ovkcap msA" data-tone="t3">${esc(ar?d.perfDeltaAr:d.perfDeltaEn)}</span></div>
          <div class="scrow"><span class="ovkcap msA" data-tone="pos">${esc(ar?d.perfWordAr:d.perfWordEn)}</span></div></div>`
      + gaugeRow(E.t('enOvernight'), d.overnightDeviationPct, 100, '%', ar?'\u062a\u062d\u0630\u064a\u0631':'Warning', 'warn')
      + d.sumGauges.map(g2 => gaugeRow(ar?g2.labelAr:g2.labelEn, g2.val, g2.max, g2.u, ar?g2.wordAr:g2.wordEn, g2.tone)).join('')
      + '</div>');
  }

  /* Utilities landing summary (D40, Final mock): domain-hue 5% washed rows
     with a 14px domain icon; "Active" reads positive, deltas read muted. */
  function utilitiesSummary(E){
    const m = E.data.metrics, u = E.data.utilLanding, ar = E.lang==='ar';
    const srow = key => (E.data.summary.find(r=>r.key===key)||{});
    /* Consumption rows carry the mock's 100x22 spark beside the delta \u2014
       water a smooth curve, gas a stepped line (paths mock-verbatim). */
    const row = (hue,ic,icC,lbl,v,unit,cap,capTone,sparkPath) =>
      `<div class="ovk uvk" style="background:color-mix(in srgb, ${hue} 50%, transparent)">
        <div class="ovkhead"><span class="uvic" style="color:${icC}">${icon(ic,14)}</span><span class="ovklbl">${esc(lbl)}</span>${ctl(E, lbl, cap)}</div>
        <div class="ovkval"><span class="ovknum">${esc(v)}</span><span class="ovkunit">${esc(unit)}</span></div>
        ${sparkPath
          ? `<div class="uvspark"><svg viewBox="0 0 100 22" width="100" height="22" aria-hidden="true">
              <path d="${sparkPath}" fill="none" stroke="${icC}" stroke-width="1.5"/></svg>
            <span class="ovkcap" data-tone="${capTone||'t3'}">${esc(cap)}</span></div>`
          : `<div class="ovkcap" data-tone="${capTone||'t3'}">${esc(cap)}</div>`}</div>`;
    const W='rgba(96,165,250,.05)', G='rgba(167,139,250,.05)';
    return summaryShell(E, E.t('utilitiesOverview'), '<div class="ovklist">'
      + row(W,'meter','#60A5FA',E.t('kWaterMeters'), fmt(u.waterMeters), '', E.t('wordActive'), 'pos')
      + row(W,'droplet','#60A5FA',E.t('kWaterConsToday'), fmt(m.waterTodayM3), 'm\u00b3', ar?srow('water').deltaAr:srow('water').deltaEn, 't3', u.waterSparkPath)
      + row(G,'meter','#A78BFA',E.t('kGasMeters'), fmt(u.gasMeters), '', E.t('wordActive'), 'pos')
      + row(G,'flame','#A78BFA',E.t('kGasConsToday'), fmt(m.gasTodayM3), 'm\u00b3', ar?srow('gas').deltaAr:srow('gas').deltaEn, 't3', u.gasSparkPath)
      + '</div>');
  }

  /* Utilities module panel (D40, Final mock): ACTIVE ALARMS grouped WATER /
     GAS from the water+gas monitoring lists (never the canonical ribbon
     twelve), then the two footer rows into the sub-pages. */
  function utilitiesPanel(E){
    const ar = E.lang==='ar';
    const wa = E.data.water.alarms, ga = E.data.gas.alarms;
    const n = wa.length + ga.length;                     /* count derives */
    const row = (i, sub, page) => `<button class="uprow" data-act="goSub" data-mod="utilities" data-sub="${sub}" data-page="${page}">
      <span class="uadot" data-sev="${i.sev}"></span>
      <span class="col grow minw0 taS gap1">
        <span class="uploc">${esc(ar?i.locAr:i.locEn)}</span>
        <span class="uptit">${esc(ar?i.tAr:i.tEn)}</span></span>
      <span class="uaage">${esc(E.ph(i.age))}</span></button>`;
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
    const cards = d.kpis.map(k =>
      `<article class="optcard2" data-tone="${k.tone}">
        <div class="optheadrow"><span class="optname">${esc(ar?k.labelAr:k.labelEn)}</span>
          <span class="optval tMonoS msA">${fmt(k.gaugeVal,1)}${k.key==='overnight'||k.key==='imbalance'?'%':''}</span></div>
        <span class="optstate" data-tone="${k.tone}">(${esc(ar?k.stateAr:k.stateEn)})</span>
        <p class="opttip">${esc(ar?k.tipAr:k.tipEn)}</p>
        <div class="optcells">
          <span class="optcell"><i class="optlbl">${esc(E.t('wasteLbl'))}</i><b class="tMonoS">${fmt(k.wasteKwh,2)} kWh</b></span>
          <span class="optcell"><i class="optlbl">${esc(E.t('costLbl'))}</i><b class="tMonoS">${fmt(k.wasteKwh*b.aedPerKwh,2)} AED</b></span>
        </div></article>`).join('');
    const RAMP2 = ['#C2504B','#D07A3C','#D8A83C','#D8C63C'];
    const rank = [...d.kpis].sort((x,y)=>y.wasteKwh-x.wasteKwh);
    const rampOf = k => RAMP2[Math.min(rank.indexOf(k), RAMP2.length-1)];
    const maxKwh = rank[0].wasteKwh;
    const wr = `<div class="alcard"><div class="alcardh"><span class="alcardt">${esc(E.t('ewrT'))}</span></div>
      <div class="row gap8"><span class="ewrtot tMonoS">${fmt(d.wasteTotalKwh,2)} kWh</span>
        <span class="ewrtot tMonoS">${fmt(d.wasteTotalKwh*b.aedPerKwh,2)} AED</span></div>
      ${d.kpis.map(k => `<div class="ewrrow">
        <span class="ewrchip" style="background:${rampOf(k)}">${esc(ar?k.labelAr:k.labelEn)}</span>
        <span class="tMonoS msA">${fmt(k.sharePct,2)}%</span>
        <span class="ewrbar"><span style="width:${(k.wasteKwh/maxKwh*100).toFixed(0)}%;background:${rampOf(k)}"></span></span></div>`).join('')}</div>`;
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
        <span class="ovkcap">${esc(cap)}</span>${chart||''}</div>`;
    /* Hero mini-charts (D39 — measured from the Final mock): banded track,
       gradient value bar with an amber over-baseline overflow segment and a
       marker dot; the baseline/contracted tick carries its label above. */
    const bullet = (hc, key) => {
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
    const carbonT = el.mtdKwh * b.co2KgPerKwh / 1000;                 /* derives */
    const peakPct = Math.round(m.peakTodayMw / p.contractedMw * 100); /* derives */
    const heroRow = `<div class="pwhero">
      ${hero(E.t('pwCurrentCons'), E.t('pwAboveChip'), 'warn', fmt(el.currentKw,2), 'kW', E.t('pwBaselineKwCap',{v:fmt(el.baselineKw,1)}), bullet(p.heroCharts.current,'L'))}
      ${hero(E.t('pwMtd'), E.t('pwLiveCap'), 'ok', fmt(el.mtdKwh,2), 'kWh', E.t('capMainMeters',{time:b.asOf})+' \u00b7 '+E.t('pwFcstEod',{v:fmt(m.todayForecastEodMwh,1)}), spark(p.heroCharts.month))}
      ${hero(E.t('pwPrevMonth'), '', '', fmt(p.prevMonthKwh,2), 'kWh', E.t('pwPrevMonthCap'))}
      ${hero(E.t('pwCarbon'), '', '', fmt(carbonT,2), 't', E.t('pwCarbonCap',{r:b.co2KgPerKwh}))}
      ${hero(E.t('pwPeak'), E.t('pwPctLimit',{p:peakPct}), 'crit', fmt(m.peakTodayMw,2), 'MW', E.t('pwContractedMwCap',{v:p.contractedMw}), bullet(p.heroCharts.peak,'P'))}
    </div>`;
    /* Distribution-board share (D39): the mock's 6-segment donut (r58,
       stroke 30) with percentage labels around the ring; shares derive. */
    const totKw = p.boards.reduce((a,x)=>a+x[1],0);
    const DON = ['#2DD4BF','#60A5FA','#F5C542','#F08A24','#E4564A','#818CF8'];
    const C2 = 2*Math.PI*58;
    let cum = 0;
    const dsegs = p.boards.map((x,i2)=>{
      const f = x[1]/totKw;
      const s2 = { c: DON[i2],
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
        <span class="alcardm">${esc(E.t('pwDbShareCap',{mw:fmt(totKw/1000,2)}))}</span>${window.EKO_A.chrome(E)}</div>
      <div class="dnwrap"><svg viewBox="0 0 160 160" aria-hidden="true">
        ${dsegs.map(s2=>`<circle cx="80" cy="80" r="58" fill="none" stroke="${s2.c}" stroke-width="30" stroke-dasharray="${s2.dash}" stroke-dashoffset="${s2.off}" transform="rotate(-90 80 80)"/>`).join('')}</svg>
        ${dsegs.map(s2=>`<span class="dnlbl" style="left:${s2.lx}%;top:${s2.ly}%">${s2.pct}%</span>`).join('')}</div>
      <div class="dnleg">${p.boards.map((x,i2)=>`<span class="dnlegit"><i style="background:${DON[i2]}"></i>${esc(x[0])}</span>`).join('')}</div></article>`;
    const totalMax = Math.max(...p.boards.map(x=>x[1]));
    const db = `<article class="pwwidget">
      <div class="pwwh"><span class="alcardt">${esc(E.t('pwDb'))}</span>
        <span class="alcardm">${esc(E.t('pwDbSub',{n:p.boards.length,mw:fmt(totKw/1000,2)}))}</span>${window.EKO_A.chrome(E)}</div>
      <div class="dblist grow">${p.boards.map(x =>
        `<button class="dbrow" data-act="none"><span class="dbid">${esc(x[0])}</span>
          <span class="dbbar"><span style="width:${(x[1]/totalMax*100).toFixed(1)}%"></span></span>
          <span class="dbkw">${fmt(x[1])} kW</span>${icon('chevR',12)}</button>`).join('')}</div></article>`;
    /* Energy trend (D39): stacked kWh bars on the mock's fixed 0-120 axis. */
    const zh = p.zoneHourly, hours = zh[0].length, YMAX = 120;
    const step = 100/hours, bw = step*0.6;
    let bars = '';
    for(let h2=0;h2<hours;h2++){
      let y0 = 100;
      zh.forEach((z,zi) => {
        const bh = z[h2]/YMAX*100; y0 -= bh;
        bars += `<rect x="${(h2*step+step*0.2).toFixed(2)}" y="${y0.toFixed(2)}" width="${bw.toFixed(2)}" height="${bh.toFixed(2)}" fill="${p.zoneHues[zi]}"${zi===zh.length-1?' rx="0.6"':''}/>`;
      });
    }
    const grid39 = [0,25,50,75,100].map(y=>`<line x1="0" x2="100" y1="${y}" y2="${y}" stroke="var(--bd1)" stroke-width="1"${y===100?'':' stroke-dasharray="2 3"'} vector-effect="non-scaling-stroke"/>`).join('');
    const seg = (k,on) => `<button class="seg" data-on="${on}" data-act="none">${esc(E.t(k))}</button>`;
    const xh = Array.from({length:Math.ceil(hours/2)},(_,i2)=>String(i2*2).padStart(2,'0'));
    const entrend = `<article class="pwwidget">
      <div class="pwwh"><span class="alcardt">${esc(E.t('pwEnTrend'))}</span>
        <span class="alcardm">${esc(E.t('pwEnSub',{t:b.asOf}))}</span>
        <span class="row segbox msA">${seg('rangeHourly',false)}${seg('rangeToday',true)}${seg('rangeWeekly',false)}${seg('rangeMonthly',false)}</span>${window.EKO_A.chrome(E)}</div>
      <div class="ch39"><div class="chy39">${[120,90,60,30,0].map(v=>`<span>${v}</span>`).join('')}</div>
        <div class="chplot39"><svg viewBox="0 0 100 100" preserveAspectRatio="none">${grid39}${bars}</svg></div></div>
      <div class="chx39">${xh.map(t2=>`<span>${t2}</span>`).join('')}</div>
      <div class="pwlegend">${p.zones.map((z,i2)=>`<span><i class="zdot" style="background:${p.zoneHues[i2]}"></i>${esc(ar?(p.zonesAr[i2]||z):z)}</span>`).join('')}</div></article>`;
    /* Peak demand trend (D39): fixed 0-140 axis, over-contract red band,
       dashed average line, gradient area under the curve. */
    const ps = p.peakSeries, PMAX = 140, n3 = ps.length;
    const pty = v => (100 - v/PMAX*100);
    const pts3 = ps.map((v,i2)=>`${(i2/(n3-1)*100).toFixed(2)},${pty(v).toFixed(2)}`).join(' ');
    const yC = pty(m.contractedKw), yA = pty(p.peakAvgKw);
    const peak = `<article class="pwwidget">
      <div class="pwwh"><span class="alcardt">${esc(E.t('pwPeakTrend'))}</span>
        <span class="alcardm">${esc(E.t('pwPeakSub'))}</span>${window.EKO_A.chrome(E)}</div>
      <div class="ch39"><div class="chy39">${[140,105,70,35,0].map(v=>`<span>${v}</span>`).join('')}</div>
        <div class="chplot39">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none">
            <defs><linearGradient id="pwpkG" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#4EA3E8" stop-opacity="0.25"/><stop offset="100%" stop-color="#4EA3E8" stop-opacity="0"/></linearGradient></defs>
            ${grid39}
            <rect x="0" y="0" width="100" height="${yC.toFixed(2)}" fill="rgba(214,69,69,0.12)"/>
            <line x1="0" x2="100" y1="${yA.toFixed(2)}" y2="${yA.toFixed(2)}" stroke="var(--chTx)" stroke-width="1" stroke-dasharray="4 3" vector-effect="non-scaling-stroke"/>
            <polygon points="0,100 ${pts3} 100,100" fill="url(#pwpkG)"/>
            <polyline points="${pts3}" fill="none" stroke="#4EA3E8" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>
          <span class="pkband39">${esc(E.t('pwContractedLine',{v:m.contractedKw}))}</span>
          <span class="pkavg39" style="top:${yA.toFixed(1)}%">${esc(E.t('pwAvgLine',{v:fmt(p.peakAvgKw,1)}))}</span>
        </div></div>
      <div class="chx39">${['00:00','04:00','08:00','12:00'].map(t2=>`<span>${t2}</span>`).join('')}</div>
      <span class="ovkcap">${esc(E.t('pwPenalty'))}</span></article>`;
    return `<div class="pwarea" data-pg="power">
      <div class="pwheadrow">
        <div><span class="alcardt pgtitle">${esc(E.t('pwTitle'))}</span>
          <span class="alcardm"> ${esc(E.t('pwSub'))}</span></div>
        <span class="msA row gap6">
          <button class="btnG btnSm" data-act="goPage" data-page="power-model" data-sub="power">${esc(E.t('modelView'))}</button></span>
      </div>
      ${heroRow}
      <div class="pwgrid pg39">${share}${entrend}${db}${peak}</div>
      ${mvRow(E)}
    </div>`;
  }
  /* D96: the M&V row declared by the layout document (powerMv widget) */
  function mvRow(E){
    const doc = window.EKO_LAYOUTS[E.state.pageId] || {};
    const w = (doc.widgets || []).find(x => x.type === 'powerMv'); if(!w) return '';
    const cards = ((w.binding || {}).cards || []).map(k => k === 'baselineVsActual' ? window.EKO_BVA.card(E) : k === 'meterStatus' ? window.EKO_MT.panel(E) : '').join('');
    return `<div class="mvgrid" data-layout="${esc((w.binding || {}).layout || 'side')}">${cards}</div>`;
  }

  /* Consumption model sub-view panel (D39 — the mock's "Model view"): four
     metric rows with h22 bullets, the zones-today list and the waste chip. */
  function consModelPanel(E){
    const p = E.data.power, sv = p.subview, ar = E.lang === 'ar';
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
      + mrow(E.t('cmPf'), sv.pf.toFixed(2), E.t('cmTarget',{v:sv.pfTarget}), pf)
      + mrow(E.t('cmAvoid'), `<span class="cWarn2">AED ${fmt(sv.avoidAed,2)}</span>`, `${fmt(sv.avoidKwh)} kWh`)
      + `<div class="cmzhead">${esc(E.t('zonesToday'))}</div>${zrows}
      <div class="cmwarn"><span class="cmwdot"></span>
        <span class="cmwtxt">${esc(E.t('wasteWarnN',{n:sv.warnN}))} \u00b7 <span class="tMonoS">AED ${fmt(sv.warnAed,2)}</span></span>
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
    const worst = a => a.map(id=>E.alarm(id)).sort((x,y)=>({critical:0,high:1,medium:2}[x.sev]-{critical:0,high:1,medium:2}[y.sev]))[0];
    const chipFor = r => {
      if(r.st === 'stale') return `<span class="statchip" data-sev="stale">${esc(t('chipStale',{h:r.staleH}))}</span>`;
      if(r.st === 'alarm'){ const a = worst(r.alarms);
        const w = t('rib'+a.sev[0].toUpperCase()+a.sev.slice(1));
        return `<span class="statchip" data-sev="${a.sev}">${r.alarms.length>1?esc(t('alarmsN',{n:r.alarms.length})):esc(t('chipAlarm',{sev:w}))}</span>`; }
      return `<span class="tCap">${esc(t('stNormal'))}</span>`;
    };
    const woCell = r => !r.wost ? `<span class="tCap">${esc(t('emptyDash'))}</span>`
      : `<span class="row gap6"><span class="wodot" data-st="${r.wost}"></span>${esc(t('wo'+r.wost[0].toUpperCase()+r.wost.slice(1)))}</span>`;
    const staleN = E.data.assets.filter(r=>r.st==='stale').length;
    return `<section class="regwrap" aria-label="${esc(t('regTitle'))}">
      <div class="regbar">
        <div><div class="modtitle">${esc(t('modAssets'))}</div>
          <span class="alcardt">${esc(t('regHead'))}</span>
          <span class="alcardm"> ${esc(t('regConnected',{n:rows.length,total:fmt(E.data.registerTotal)}))} </span>
          <button class="alcardm statlink" data-act="regStF" data-v="stale" data-on="${s.regStF==='stale'}">${esc(t('regStaleN',{n:staleN}))}</button></div>
        <input class="regsearch msA" data-act="regQ" value="${esc(s.regQ||'')}" placeholder="${esc(t('regSearchPh'))}" aria-label="${esc(t('regSearchPh'))}">
        ${s.regSysF?`<button class="chip" data-on="true" data-act="regSysClear">${esc((f=>f?(E.lang==='ar'?f.ar:f.en):s.regSysF)(E.data.families.find(x=>x.id===s.regSysF)))} ${icon('x',10)}</button>`:''}
        ${s.regSevF?`<button class="chip" data-on="true" data-act="regSevClear">${esc(t('rib'+s.regSevF[0].toUpperCase()+s.regSevF.slice(1)))} ${icon('x',10)}</button>`:''}
        <button class="btnG btnSm" data-act="none">${esc(t('viewsW'))} ${icon('chevD',11)}</button>
      </div>
      <div class="regscroll"><table class="reg">
        <thead><tr>${th('id','colAssetId')}${th('st','colStatus',true)}${th('floor','colFloor',true)}${th('zone','colZone')}${th('wos','colWos')}<th>${esc(t('colWoStatus'))}</th><th></th></tr></thead>
        <tbody>${rows.map(r => `<tr data-act="openAsset" data-asset="${esc(r.id)}" data-on="${s.assetSel===r.id}" tabindex="0">
          <td class="mono">${esc(r.id)}</td><td>${chipFor(r)}</td>
          <td>${esc(r.floor)}</td><td data-tip="${esc(E.lang==='ar'?(r.zoneAr||r.zone):r.zone)}" data-tipif="trunc">${esc(E.lang==='ar'?(r.zoneAr||r.zone):r.zone)}</td>
          <td class="mono">${r.wos||t('emptyDash')}</td><td>${woCell(r)}</td>
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
     from pills); tabs Alarms / Activity / O&M / Warranty (+ Control only when
     the data contract, site flag and role permit). LIVE PARAMETERS persists
     above every tab. Desktop has no footer; the PHONE SHEET keeps a sticky
     footer (intentional responsive divergence, logged). */
  function assetPanel(E){
    const id = E.state.assetSel;
    if(!id) return '';
    const r = E.data.assets.find(a => a.id === id) || (window.EKO_MT && window.EKO_MT.meterAsAsset(E, id));   /* D96: a meter row opens here too */
    if(!r) return '';
    const als = (r.alarms||[]).map(x=>E.alarm(x));
    const worst = als[0];
    const t = E.t.bind(E), arL = E.lang === 'ar';
    const ctl = window.EKO_CTL && window.EKO_CTL.showsControl(E, r);
    let tab = E.state.apTab;
    if(!['alarms','activity','om','warranty','control'].includes(tab)) tab = 'alarms';
    if(tab === 'control' && !ctl) tab = 'alarms';
    const trP = x => E.ph(x);
    const live = `<h4 class="tLbl">${esc(t('apLiveParams'))}</h4>
      ${(r.params||[]).map(p =>
        `<div class="aprow"><dt>${esc(trP(p[0]))}<span class="apsrc">${esc(trP(p[1]))}</span></dt><dd>${esc(p[2])}</dd></div>`).join('')
        || `<p class="alempty">${esc(t('emptyDash'))}</p>`}`;
    /* D105: progressive disclosure replaces the old Pro depth — a labelled expansion in place, per user */
    const fullOn = E.disclose('full');
    const tr7 = r.trend7 && Array.isArray(r.trend7.vals) && r.trend7.vals.length >= 2 ? r.trend7 : null;
    const reason = r.st === 'stale' ? 'dgNoTrend.stale' : (r.trendKind === 'state' ? 'dgNoTrend.state' : 'dgNoTrend.none');
    const full = `<div class="apfull"><div class="row gap8"><h4 class="tLbl grow">${esc(t('apFullT'))}</h4><button class="statlink" data-act="disclose" data-k="full" aria-expanded="${fullOn}">${esc(t(fullOn ? 'hideFull' : 'discloseFull'))}</button></div>
      ${fullOn ? (tr7 ? (() => { const p = window.ekoTrend(tr7.vals, 240, 56); const lo = Math.min(...tr7.vals), hi = Math.max(...tr7.vals);
        return `<p class="tCap">${esc(trP(tr7.point))} · ${esc(t('apTrendPts', { n: tr7.vals.length }))} · ${lo}–${hi} ${esc(tr7.unit || '')}</p>
        <div class="systrend"><svg viewBox="0 0 240 56" preserveAspectRatio="none"><path d="${p.area}" fill="var(--accT)"/><path d="${p.line}" fill="none" stroke="var(--acc)" stroke-width="1.5"/></svg></div>
        <table class="rawtbl"><thead><tr><th>${esc(t('rawPoint'))}</th><th>${esc(t('rawValue'))}</th></tr></thead><tbody>${tr7.vals.map((v, i) => `<tr><td>${t('rawDay', { n: i + 1 - tr7.vals.length })}</td><td class="tMonoS">${v} ${esc(tr7.unit || '')}</td></tr>`).join('')}</tbody></table>`; })()
        : `<p class="tCap">${esc(t('emptyDash'))} · ${esc(t(reason))}</p>`) : ''}</div>`;
    let body = '';
    if(tab === 'alarms'){
      body = (als.length ? als.map(a => `<div class="alref">
        <div class="alrefh"><span class="statchip" data-sev="${a.sev}">${esc(t('rib'+a.sev[0].toUpperCase()+a.sev.slice(1)).toLowerCase())}</span>
          <span class="alrefage tMonoS msA">${esc(a.age)}</span></div>
        <div class="alreft">${esc(E.alarmLines(a).main)}</div>${E.alarmLines(a).sub ? `<div class="alreftech">${esc(E.alarmLines(a).sub)}</div>` : ''}
        <div class="alrefack">${a.ack ? esc(t('ackShort',{time:a.ack.time,who:a.ack.who})) : esc(t('apUnack'))}</div>
      </div>`).join('') : `<p class="alempty">${esc(t('apNoAlarms'))}</p>`)
      + `<p class="apnote">${esc(t('finNote'))}</p>`;
    } else if(tab === 'activity'){
      const act = r.activity || [];
      body = `<h4 class="tLbl seclbl">${esc(t('apActivity'))}</h4>`
        + (act.length ? act.map(a2 => `<div class="actref">
          <div class="actrefh"><span class="tMonoS fw6">${esc(a2[0])}</span>
            <span class="row gap6 msA"><span class="wodot" data-st="${a2[3]||'prog'}"></span>${esc(t('wo'+(a2[3]||'prog')[0].toUpperCase()+(a2[3]||'prog').slice(1)))}</span></div>
          <div class="actreft">${esc(trP(a2[1]))}</div>
          <div class="actrefd">${esc(trP(a2[2]||''))}</div></div>`).join('')
        : `<p class="alempty">${esc(t('emptyDash'))}</p>`);
    } else if(tab === 'om'){
      body = `<h4 class="tLbl seclbl">${esc(t('omLib'))}</h4>`
        + ((r.omDocs && r.omDocs.length) ? r.omDocs.map(d2 =>
          `<div class="aprow"><dt>${esc(arL?(d2.tAr||d2.tEn):d2.tEn)}</dt><dd class="cT3">${esc(d2.meta)}</dd></div>`).join('')
          : `<p class="alempty">${esc(t('omEmpty'))}</p>`)
        + `<h4 class="tLbl seclbl">${esc(t('apRefs'))}</h4>
        <div class="aprow"><dt>${esc(t('apMake'))}</dt><dd>${esc(r.make||t('emptyDash'))}</dd></div>
        <div class="aprow"><dt>${esc(t('apSerial'))}</dt><dd>${esc(r.serial||t('emptyDash'))}</dd></div>
        <div class="aprow"><dt>${esc(t('apSvc'))}</dt><dd>${esc(r.svc||t('emptyDash'))}</dd></div>
        <div class="aprow"><dt>${esc(t('apCafmRec'))}</dt><dd class="row gap6">
          <span class="tMonoS">${esc(r.cafm||t('emptyDash'))}</span>
          ${r.cafm?`<button class="aplink" data-act="none">${esc(t('openW'))}</button>`:''}</dd></div>
        <p class="apnote">${esc(t('omIndexed'))}</p>`;
    } else if(tab === 'warranty'){
      body = r.warranty
        ? `<div class="aprow"><dt>${esc(arL?(r.warranty.tAr||r.warranty.tEn):r.warranty.tEn)}</dt><dd class="cT3">${esc(r.warranty.meta||'')}</dd></div>`
        : `<p class="alempty">${esc(t('wtyEmpty'))}</p>`;
    } else if(tab === 'control'){
      body = window.EKO_CTL.controlTab(E, r);
    }
    const woDone = E.state.woRaised[id];
    const tabBtn = (k, lbl, n) => `<button class="aptab" data-on="${tab===k}" data-act="apTab" data-v="${k}">${esc(lbl)}${n?`<span class="cbadge" data-sev="${worst?worst.sev:'medium'}">${n}</span>`:''}</button>`;
    return `<aside id="assetpanel" data-born="${E.state.born==='asset'?1:0}" data-wide="${E.state.apWide?1:0}" role="dialog" aria-label="${esc(id)}">
      <div class="draghandle"></div>
      <div class="aphead">
        <span class="tMono grow fw6">${esc(id)}</span>
        ${worst?`<span class="statchip" data-sev="${worst.sev}">${als.length>1?esc(t('alarmsN',{n:als.length})):esc(t('chipAlarm',{sev:t('rib'+worst.sev[0].toUpperCase()+worst.sev.slice(1))}))}</span>`:''}
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
      <div class="aptabs">${tabBtn('alarms', t('apAlarms'), als.length||'')}${tabBtn('activity', t('apActivityTab'))}${tabBtn('om', t('apOmTab'))}${tabBtn('warranty', t('apWtyTab'))}${ctl?tabBtn('control', t('apControlTab')):''}</div>
      <div class="apbody">${live}${full}${body}</div>
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
