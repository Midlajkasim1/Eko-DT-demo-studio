/* ============================================================================
   SPLITTERS (D51, rebuilt D58) — shell-level resize handles between panels.
   Built once; every panel inherits via the document in js/layouts/panels.js.
   - Affordance: a 1px divider carrying an ALWAYS-VISIBLE grip pill at
     mid-height (the modern pattern: VS Code / Figma / Linear); hover or focus
     brightens the pill and draws a 2px accent line; drag holds it.
   - Geometry: the handle sits on the panel's REAL rendered edge, every
     animation frame (rAF loop), so it glides with the panel's width
     transition instead of lagging behind it. Only the summary overlay
     (#ovp, which shrink-wraps its content) uses its declared width.
   - Drag: pointer capture attempted, window-level listeners regardless;
     the drag ends on pointerup, pointercancel, window blur, tab hide, or a
     move with no button held — a stuck accent line is impossible.
   - Below min-40px the drag snaps into the EXISTING collapse state; beyond
     max it resists; double-click resets to default; keyboard per the ARIA
     window-splitter pattern; widths persist per site + route.
   - No splitters below 768px (sheets take over — js/shell/sheets.js).
   ============================================================================ */
window.EKO_SPLIT = (function(){
  'use strict';
  let E = null, handles = {}, drag = null, loop = 0;

  const DOC = () => (window.EKO_LAYOUTS.panels || { splits: [] });
  const isRtl = () => (window.DASHBOARD_ROOT||document.documentElement).dir === 'rtl';
  const route = () => E.state.pageId || 'root';
  const site = () => (E.data && (E.data.siteId || (E.data.site && E.data.site.id))) || 'marsa';
  const lsKey = s => 'eko-sp:' + site() + ':' + route() + ':' + s.id;
  const stored = s => { const v = parseInt(localStorage.getItem(lsKey(s)) || '', 10); return isNaN(v) ? null : v; };
  const store = (s, w) => { try{ localStorage.setItem(lsKey(s), String(Math.round(w))); }catch(e){} };

  function collapsed(s){ return !!(s.collapse && E.state[s.collapse]); }
  function setCollapsed(s, on, prevW){
    if(!s.collapse) return;
    if(on && prevW) store(s, prevW);
    if(on) unapply(s);
    E.state[s.collapse] = on;
    try{ localStorage.setItem(s.lsKey, on ? 'min' : 'full'); }catch(e){}
    E.set({});
  }
  function maxFor(s, el){
    /* the centre always absorbs the remainder; growth is capped by how much
       the WIDEST sibling (the centre) can give before hitting centerMin */
    const centerMin = s.centerMin || DOC().centerMin || 360;
    let room = window.innerWidth - centerMin - 80;
    if(el && el.parentElement){
      let center = null;
      [...el.parentElement.children].forEach(c => {
        if(c !== el && (!center || c.clientWidth > center.clientWidth)) center = c;
      });
      if(center && center.clientWidth > 0)
        room = el.getBoundingClientRect().width + center.clientWidth - centerMin;
    }
    return Math.max(s.min, Math.min(s.max, room));
  }
  function widthOf(s){ const v = stored(s); return v != null ? v : s.def; }
  function apply(s, w){ (window.DASHBOARD_ROOT||document.documentElement).style.setProperty(s.varName, Math.round(w) + 'px'); }
  function unapply(s){ (window.DASHBOARD_ROOT||document.documentElement).style.removeProperty(s.varName); }
  function target(s){
    const els = document.querySelectorAll(s.target);
    for(const el of els){ if(el.getBoundingClientRect().width > 0 || collapsed(s)) return el; }
    return els[0] || null;
  }

  function ensureHandle(s){
    if(handles[s.id]) return handles[s.id];
    const h = document.createElement('div');
    h.className = 'sphandle';
    h.tabIndex = 0;
    h.setAttribute('role', 'separator');
    h.setAttribute('aria-orientation', 'vertical');
    h.dataset.split = s.id;
    h.innerHTML = '<span class="spgrip" aria-hidden="true"></span>';
    (window.DASHBOARD_ROOT || document.body).appendChild(h);
    h.addEventListener('pointerdown', ev => startDrag(s, h, ev));
    h.addEventListener('dblclick', () => { store(s, s.def); apply(s, s.def);
      if(collapsed(s)) setCollapsed(s, false); else E.set({}); });
    h.addEventListener('keydown', ev => keys(s, ev));
    handles[s.id] = h;
    return h;
  }

  function keys(s, ev){
    const step = ev.shiftKey ? 64 : 16;
    let w = collapsed(s) ? 0 : widthOf(s);
    const el = target(s);
    const mx = maxFor(s, el);
    if(ev.key === 'ArrowLeft' || ev.key === 'ArrowRight'){
      ev.preventDefault();
      const dir = ((ev.key === 'ArrowRight') !== isRtl()) === (s.side === 'start') ? 1 : -1;
      if(collapsed(s)){ if(dir > 0) setCollapsed(s, false); return; }
      w = Math.max(s.min, Math.min(mx, w + dir * step));
      store(s, w); apply(s, w); syncAria(s); E.set({});
    } else if(ev.key === 'Home'){ ev.preventDefault();
      if(s.collapse) setCollapsed(s, true, widthOf(s));
    } else if(ev.key === 'End'){ ev.preventDefault();
      if(collapsed(s)) setCollapsed(s, false);
      store(s, mx); apply(s, mx); syncAria(s); E.set({});
    } else if(ev.key === 'Enter'){ ev.preventDefault();
      if(s.collapse) setCollapsed(s, !collapsed(s), collapsed(s) ? null : widthOf(s));
    }
  }

  /* ------------------------------- drag ----------------------------------- */
  function startDrag(s, h, ev){
    if(window.innerWidth < 768 || (ev.button != null && ev.button !== 0)) return;
    ev.preventDefault();
    try{ h.setPointerCapture(ev.pointerId); }catch(e){}
    const startW = collapsed(s) ? 0 : widthOf(s);
    drag = { s, h, startX: ev.clientX, startW, raf: 0, lastW: startW, lastRaw: startW };
    document.body.classList.add('spdrag');
    h.classList.add('spactive');
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
    window.addEventListener('blur', endDrag);
    document.addEventListener('visibilitychange', endDrag);
  }
  function step(){
    if(!drag) return;
    const { s, lastRaw } = drag;
    const el = target(s);
    const mx = maxFor(s, el);
    /* D59: the drag NEVER closes the panel — it clamps at min (and max);
       collapse is only the chevron (or Home/Enter on the keyboard). Dragging
       a collapsed rail outward still re-opens it. */
    if(collapsed(s) && lastRaw > s.min / 2) setCollapsed(s, false);
    if(collapsed(s)) return;
    const w = Math.max(s.min, Math.min(mx, lastRaw));
    drag.lastW = w;
    apply(s, w);
    syncAria(s);
  }
  function onMove(ev){
    if(!drag) return;
    if(ev.buttons === 0){ endDrag(ev); return; }         /* button released elsewhere */
    const sign = (drag.s.side === 'start') !== isRtl() ? 1 : -1;
    drag.lastRaw = drag.startW + sign * (ev.clientX - drag.startX);
    /* pointermove is already delivered at frame rate (coalesced); applying
       synchronously keeps the panel 1:1 with the pointer, no throttle lag */
    step();
  }
  function endDrag(ev){
    if(!drag) return;
    if(ev && ev.type === 'visibilitychange' && !document.hidden) return;
    step();
    const { s, h, lastW } = drag;
    try{ if(ev && ev.pointerId != null) h.releasePointerCapture(ev.pointerId); }catch(e){}
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', endDrag);
    window.removeEventListener('pointercancel', endDrag);
    window.removeEventListener('blur', endDrag);
    document.removeEventListener('visibilitychange', endDrag);
    h.classList.remove('spactive');
    document.body.classList.remove('spdrag');
    if(!collapsed(s)) store(s, lastW);
    drag = null;
    E.set({});                      /* settle: charts re-render to final size */
  }

  /* ---------------------------- geometry ---------------------------------- */
  function syncAria(s){
    const h = handles[s.id];
    if(!h) return;
    const el = target(s);
    h.setAttribute('aria-valuemin', s.min);
    h.setAttribute('aria-valuemax', Math.round(maxFor(s, el)));
    h.setAttribute('aria-valuenow', collapsed(s) ? 0 : Math.round(widthOf(s)));
    h.setAttribute('aria-label', E.t(s.labelKey));
  }
  function position(s){
    const h = handles[s.id];
    const el = target(s);
    if(!el || window.innerWidth < 768 || (s.hideWhen && E.state[s.hideWhen])){ if(h) h.style.display = 'none'; return; }
    const r = el.getBoundingClientRect();
    if(r.height < 40 || r.width < 1){ h.style.display = 'none'; return; }
    /* a width the CSS pins (the Studio's laptop band caps the asset panel at its minimum) has nothing to drag: no dead handle */
    const cap = parseFloat(getComputedStyle(el).maxWidth);
    if(!collapsed(s) && cap <= s.min){ h.style.display = 'none'; return; }
    /* the REAL rendered edge (so the handle glides with the width
       transition); the summary overlay shrink-wraps, so it alone uses its
       declared width from its start edge */
    const startSide = (s.side === 'start') !== isRtl();
    let boundaryX;
    if(s.overlay && !collapsed(s)) boundaryX = startSide ? r.left + widthOf(s) : r.right - widthOf(s);
    else boundaryX = startSide ? r.right : r.left;
    h.style.display = 'block';
    h.style.transform = 'translate(' + (boundaryX - 7).toFixed(1) + 'px,' + r.top.toFixed(1) + 'px)';
    h.style.height = r.height.toFixed(1) + 'px';
  }
  function frame(){
    if(E && window.innerWidth >= 768) DOC().splits.forEach(s => { if(s.enabled !== false) position(s); });
    loop = requestAnimationFrame(frame);
  }

  /* state → vars/attributes; the rAF loop only moves handles */
  function sync(){
    if(!E) return;
    if(window.innerWidth < 768){
      Object.values(handles).forEach(h => { h.style.display = 'none'; });
      DOC().splits.forEach(unapply);
      return;
    }
    DOC().splits.forEach(s => {
      if(s.enabled === false){
        /* no handle → no drag width: the panel uses its CSS default, and any
           width a handle once saved is forgotten (a saved 90px nav with no
           way to drag it back looked like a broken rail — D59b) */
        if(handles[s.id]) handles[s.id].style.display = 'none';
        unapply(s);
        try{ localStorage.removeItem(lsKey(s)); }catch(e){}
        return;
      }
      const el = target(s);
      const h = ensureHandle(s);
      h.setAttribute('aria-label', E.t(s.labelKey));
      if(!el){ h.style.display = 'none'; return; }
      /* D59 fix: never re-apply the STORED width while this split is being
         dragged — that re-application every tick was the visible snap-back */
      if(drag && drag.s === s){ /* live width owns the var */ }
      else if(collapsed(s)) unapply(s); else apply(s, widthOf(s));
      if(s.compactBelow){
        const w = collapsed(s) ? 0 : widthOf(s);
        el.toggleAttribute('data-compact', w > 0 && w < s.compactBelow);
      }
      syncAria(s);
      position(s);
    });
    const reg = document.querySelector('.regwrap');
    if(reg) reg.toggleAttribute('data-compact', reg.getBoundingClientRect().width < 560);
  }

  function resetAll(){
    Object.keys(localStorage).filter(k => k.indexOf('eko-sp:') === 0)
      .forEach(k => localStorage.removeItem(k));
    DOC().splits.forEach(s => {
      (window.DASHBOARD_ROOT||document.documentElement).style.removeProperty(s.varName);
      if(s.collapse && E.state[s.collapse]){
        E.state[s.collapse] = false;
        try{ localStorage.setItem(s.lsKey, 'full'); }catch(e){}
      }
    });
    E.set({});
  }

  function init(app){
    E = app;
    sync();
    setInterval(sync, 300);            /* state/vars/compact (cheap) */
    window.addEventListener('resize', sync);
    if(!loop) loop = requestAnimationFrame(frame);   /* handle geometry, every frame */
  }
  function stop(){
    if(loop){ cancelAnimationFrame(loop); loop = 0; }
    Object.keys(handles).forEach(function (id) { handles[id].remove(); delete handles[id]; });
    E = null;
  }

  return { init, stop, sync, resetAll };
})();
