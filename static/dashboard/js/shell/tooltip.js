/* ============================================================================
   TOOLTIP LAYER (D68) — ONE tooltip element on <body>, positioned from its
   trigger's rectangle (never inside a clipping panel), clamped to the
   viewport, flipped when there is no room:
     block placement (default)      below the trigger; above when the bottom
                                    has no room
     inline placement               beside it, toward the given LOGICAL side
       data-tipat="start|end"       (mirrors in RTL); the other side when
                                    there is no room
   Triggers: any [data-tip]. data-kbd adds a keycap suffix (the shortcut);
   data-tipif="trunc" shows only when the trigger's own text is truncated
   (reveal tips on ellipsised cells). Shows on hover (100 ms), keyboard focus
   (:focus-visible) and touch press-and-hold (450 ms; the click that follows
   is swallowed, as native long-press tooltips do); hides on leave, blur,
   pointerdown, scroll, resize, keydown, and when the trigger leaves the DOM
   (a re-render) — re-attaching to whatever [data-tip] is now under the
   pointer so a toggled control keeps its tooltip. No strings live here: the
   content comes from the trigger's data attributes (i18n at render time).
   ============================================================================ */
window.EKO_TIP = (function(){
  'use strict';
  const GAP = 8, PAD = 8, HOVER_MS = 100, HOLD_MS = 450, MOVE_TOL = 10;
  const SEL = '[data-tip]';
  let E = null, box = null, cur = null, mode = null, timer = null, raf = 0;
  let hold = null, holdEl = null, hx = 0, hy = 0, swallow = false, mute = null;
  let lastX = -1, lastY = -1;

  function layer(){
    if(box) return box;
    box = document.createElement('div');
    box.id = 'ekotip'; box.setAttribute('role', 'tooltip'); box.hidden = true;
    (window.DASHBOARD_ROOT || document.body).appendChild(box);
    return box;
  }
  const closest = n => (n && n.closest) ? n.closest(SEL) : null;
  const truncated = el => el.scrollWidth > el.clientWidth + 1;
  function eligible(el){
    if(!el || !el.dataset || !el.dataset.tip) return false;
    if(el.dataset.tipif === 'trunc' && !truncated(el)) return false;
    return true;
  }
  function fill(el){
    const L = layer();
    L.replaceChildren();
    L.classList.remove('chtip');
    const chart = el.getAttribute('data-chtip');
    if(chart){
      try{
        let raw = chart;
        try{ raw = decodeURIComponent(chart); }catch(e){}
        if(raw.indexOf('&quot;') !== -1){
          const ta = document.createElement('textarea');
          ta.innerHTML = raw;
          raw = ta.value;
        }
        const d = JSON.parse(raw);
        if(d && Array.isArray(d.rows)){
          L.classList.add('chtip');
          const h = document.createElement('div');
          h.className = 'chtiph';
          h.textContent = d.t || '';
          L.appendChild(h);
          d.rows.forEach(row => {
            const r = document.createElement('div');
            r.className = 'chtiprow';
            const dot = document.createElement('i');
            dot.className = 'chtipdot';
            if(row.c) dot.style.background = row.c;
            const n = document.createElement('span');
            n.className = 'chtipn';
            n.textContent = row.n || '';
            const v = document.createElement('span');
            v.className = 'chtipv';
            v.textContent = (row.v || '') + (d.u ? ' ' + d.u : '');
            r.append(dot, n, v);
            L.appendChild(r);
          });
          return;
        }
      }catch(e){}
    }
    L.textContent = el.dataset.tip || '';
    if(el.dataset.kbd){
      const k = document.createElement('span');
      k.className = 'kbd tipkbd'; k.textContent = el.dataset.kbd; L.appendChild(k);
    }
  }
  /* Geometry: viewport-clamped, flipped when the preferred side has no room. */
  function place(){
    if(!cur || !cur.isConnected) return false;
    const r = cur.getBoundingClientRect();
    if(!r.width && !r.height) return false;
    const L = layer();
    const root = window.DASHBOARD_ROOT;
    const rr = root && root.getBoundingClientRect ? root.getBoundingClientRect() : { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
    const w = L.offsetWidth, h = L.offsetHeight;
    const rtl = (window.DASHBOARD_ROOT||document.documentElement).dir === 'rtl';
    const at = cur.dataset.tipat;
    let x, y, pos;
    if((at === 'cursor' || cur.hasAttribute('data-chtip')) && lastX >= 0 && lastY >= 0){
      x = lastX + GAP;
      y = lastY + GAP;
      pos = 'below';
      if(x + w > rr.right - PAD){ x = lastX - GAP - w; pos = 'left'; }
      if(y + h > rr.bottom - PAD){ y = lastY - GAP - h; pos = 'above'; }
    } else if(at === 'start' || at === 'end'){
      let leftOf = (at === 'start') !== rtl;                 /* logical → physical */
      x = leftOf ? r.left - GAP - w : r.right + GAP;
      if(leftOf && x < rr.left + PAD){ leftOf = false; x = r.right + GAP; }
      else if(!leftOf && x + w > rr.right - PAD){ leftOf = true; x = r.left - GAP - w; }
      y = r.top + r.height / 2 - h / 2; pos = leftOf ? 'left' : 'right';
    } else if(at === 'above'){                                 /* prefers above (bottom bars) */
      y = r.top - GAP - h; pos = 'above';
      if(y < rr.top + PAD){ y = r.bottom + GAP; pos = 'below'; }
      x = r.left + r.width / 2 - w / 2;
    } else {
      y = r.bottom + GAP; pos = 'below';
      if(y + h > rr.bottom - PAD){ y = r.top - GAP - h; pos = 'above'; }
      x = r.left + r.width / 2 - w / 2;
    }
    x = Math.max(rr.left + PAD, Math.min(x, rr.right - w - PAD));
    y = Math.max(rr.top + PAD, Math.min(y, rr.bottom - h - PAD));
    L.style.transform = 'none';
    L.style.left = Math.round(x) + 'px';
    L.style.top = Math.round(y) + 'px';
    L.dataset.pos = pos;
    return true;
  }
  /* One frame loop while visible: follows a moving trigger (a panel that is
     animating) and survives re-renders by re-attaching under the pointer. */
  function isHit(el){
    return !!(el && el.classList && el.classList.contains('chhit39'));
  }
  function hitFrom(n){
    return (n && n.closest) ? n.closest('.chhit39') : null;
  }
  function hideChartTips(){
    document.querySelectorAll('.chtipbox').forEach(b => { b.style.display = 'none'; });
    if(box && box.classList.contains('chtip')){
      box.hidden = true;
      box.classList.remove('chtip');
    }
  }
  function plotBox(plot){
    let L = plot.querySelector(':scope > .chtipbox');
    if(!L){
      L = document.createElement('div');
      L.className = 'chtipbox';
      plot.appendChild(L);
    }
    L.style.cssText = 'position:absolute;left:0;top:0;z-index:8;pointer-events:none;display:none;flex-direction:column;gap:6px;min-width:188px;max-width:240px;padding:10px 12px;background:var(--s2,#fff);border:1px solid var(--bd2,rgba(15,23,42,.12));border-radius:8px;box-shadow:0 8px 24px rgba(15,23,42,.14);font:12px/1.35 var(--fB,sans-serif);color:var(--t1,#0f172a)';
    return L;
  }
  function showInPlot(hit, ev){
    const plot = hit.closest('.chplot39');
    if(!plot) return;
    const d = (function(){
      const chart = hit.getAttribute('data-chtip');
      if(!chart) return null;
      try{
        let raw = chart;
        try{ raw = decodeURIComponent(chart); }catch(e){}
        const parsed = JSON.parse(raw);
        return (parsed && parsed.rows) ? parsed : null;
      }catch(e){ return null; }
    })();
    if(!d) return;
    document.querySelectorAll('.chtipbox').forEach(b => { if(!plot.contains(b)) b.style.display = 'none'; });
    const L = plotBox(plot);
    L.replaceChildren();
    const title = document.createElement('div');
    title.textContent = d.t || '';
    title.style.cssText = 'font-weight:600;letter-spacing:.06em;text-transform:uppercase;margin-bottom:2px';
    L.appendChild(title);
    d.rows.forEach(row => {
      const r = document.createElement('div');
      const isTot = row.n === 'Total';
      r.style.cssText = 'display:flex;align-items:center;gap:8px;min-width:0' + (isTot ? ';padding-bottom:6px;margin-bottom:2px;border-bottom:1px solid var(--bd1,rgba(15,23,42,.1));font-weight:600' : '');
      const dot = document.createElement('i');
      dot.style.cssText = 'width:8px;height:8px;border-radius:2px;flex:none;background:' + (row.c || '#94A3B8');
      const n = document.createElement('span');
      n.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--t2,#475569)';
      n.textContent = row.n || '';
      const v = document.createElement('span');
      v.style.cssText = 'flex:none;font-family:ui-monospace,monospace;font-variant-numeric:tabular-nums';
      v.textContent = (row.v || '') + (d.u ? ' ' + d.u : '');
      r.append(dot, n, v);
      L.appendChild(r);
    });
    L.style.display = 'flex';
    const pr = plot.getBoundingClientRect();
    const w = L.offsetWidth, h = L.offsetHeight;
    let x = ev.clientX - pr.left + GAP;
    let y = ev.clientY - pr.top + GAP;
    if(x + w > pr.width - 8) x = ev.clientX - pr.left - GAP - w;
    if(y + h > pr.height - 8) y = ev.clientY - pr.top - GAP - h;
    x = Math.max(8, Math.min(x, Math.max(8, pr.width - w - 8)));
    y = Math.max(8, Math.min(y, Math.max(8, pr.height - h - 8)));
    L.style.left = Math.round(x) + 'px';
    L.style.top = Math.round(y) + 'px';
  }
  function loop(){
    raf = 0;
    if(!cur) return;
    if(isHit(cur)){
      if(!cur.isConnected) hideChartTips();
      return;
    }
    if((!cur.isConnected && !reattach()) || !place()){ hide(); return; }
    raf = requestAnimationFrame(loop);
  }
  /* A re-render (live data refreshes every few seconds) replaces the hovered
     trigger: carry on with the [data-tip] now under the pointer, if any. */
  const underPointer = () => lastX >= 0 ? closest(document.elementFromPoint(lastX, lastY)) : null;
  function reattach(){
    if(mode !== 'hover') return false;
    const t = underPointer();
    if(!t || t === mute || !eligible(t)) return false;
    cur = t; fill(t);
    return true;
  }
  function show(el, m){
    clearTimeout(timer); timer = null;
    if(el && !el.isConnected && (m || 'hover') === 'hover') el = underPointer();   /* re-rendered during the hover delay */
    if(!eligible(el) || el === mute) return;
    const L = layer();
    cur = el; mode = m || 'hover';
    fill(el);
    L.hidden = false;
    L.dataset.born = '0'; void L.offsetWidth; L.dataset.born = '1';
    if(!place()){ hide(); return; }
    if(!raf) raf = requestAnimationFrame(loop);
  }
  function hide(){
    clearTimeout(timer); timer = null;
    if(raf){ cancelAnimationFrame(raf); raf = 0; }
    cur = null; mode = null;
    if(box) box.hidden = true;
    hideChartTips();
  }
  function cancelHold(){ clearTimeout(hold); hold = null; holdEl = null; }

  function init(app){
    E = app;
    layer();
    function trackChart(ev){
      if(ev.pointerType === 'touch') return false;
      lastX = ev.clientX; lastY = ev.clientY;
      const hit = hitFrom(ev.target);
      if(hit){
        if(box){ box.hidden = true; box.classList.remove('chtip'); }
        cur = null;
        showInPlot(hit, ev);
        return true;
      }
      hideChartTips();
      return false;
    }
    window.addEventListener('pointermove', trackChart, true);
    window.addEventListener('pointerover', trackChart, true);
    /* hover (mouse / pen) */
    document.addEventListener('pointerover', ev => {
      if(ev.pointerType === 'touch') return;
      if(hitFrom(ev.target)) return;
      lastX = ev.clientX; lastY = ev.clientY;
      const t = closest(ev.target);
      if(!t || t === cur) return;
      clearTimeout(timer);
      timer = setTimeout(() => show(t, 'hover'), cur ? 0 : HOVER_MS);
    }, true);
    document.addEventListener('pointerout', ev => {
      if(ev.pointerType === 'touch') return;
      if(isHit(cur)) return;
      const t = closest(ev.target);
      if(!t){
        if(cur && mode === 'hover') hide();
        return;
      }
      if(ev.relatedTarget && t.contains(ev.relatedTarget)) return;
      if(t === mute) mute = null;
      if(timer){ clearTimeout(timer); timer = null; }
      if(cur === t && mode === 'hover') hide();
    }, true);
    document.addEventListener('pointermove', ev => {
      if(ev.pointerType === 'touch'){
        if(hold && (Math.abs(ev.clientX - hx) > MOVE_TOL || Math.abs(ev.clientY - hy) > MOVE_TOL)) cancelHold();
        return;
      }
      lastX = ev.clientX; lastY = ev.clientY;
      if(hitFrom(ev.target) || isHit(cur)) return;
      if(timer) return;
      /* engines that deliver no boundary events for disabled controls */
      const t = closest(document.elementFromPoint(lastX, lastY));
      if(t && t !== mute) timer = setTimeout(() => show(t, 'hover'), HOVER_MS);
    }, true);
    /* keyboard focus */
    document.addEventListener('focusin', ev => {
      const t = closest(ev.target);
      if(t && t.matches(':focus-visible')) show(t, 'focus');
    });
    document.addEventListener('focusout', () => { if(cur && mode === 'focus') hide(); });
    /* touch: press-and-hold; a mouse press simply hides */
    document.addEventListener('pointerdown', ev => {
      swallow = false;
      const t = closest(ev.target);
      if(ev.pointerType === 'touch'){
        cancelHold();
        if(t && eligible(t)){
          holdEl = t; hx = ev.clientX; hy = ev.clientY;
          hold = setTimeout(() => {
            hold = null; show(t, 'touch'); swallow = true;
            if(window.EKO_PWA && window.EKO_PWA.haptic) window.EKO_PWA.haptic('snap');
          }, HOLD_MS);
        }
        return;
      }
      mute = t; hide();
    }, true);
    const release = ev => {
      if(ev.pointerType !== 'touch') return;
      cancelHold();
      if(mode === 'touch') hide();
    };
    document.addEventListener('pointerup', release, true);
    document.addEventListener('pointercancel', release, true);
    document.addEventListener('click', ev => {
      if(swallow){ swallow = false; ev.stopPropagation(); ev.preventDefault(); }
    }, true);
    document.addEventListener('contextmenu', ev => { if(hold || holdEl || mode === 'touch') ev.preventDefault(); }, true);
    /* anything that moves or re-frames the page */
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    window.addEventListener('blur', hide);
    document.addEventListener('keydown', ev => { if(mode !== 'focus' || ev.key === 'Escape') hide(); }, true);
  }

  return { init, show, hide, place, current: () => cur, mode: () => mode, el: () => box };
})();
