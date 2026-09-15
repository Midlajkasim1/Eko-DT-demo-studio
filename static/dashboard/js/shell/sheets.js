/* ============================================================================
   MOBILE SHEET SNAP POINTS (D51) — below 768px, panels are bottom sheets
   with THREE snap points: peek (~25%), half (~55%), full (~92%, clamped so
   the top bar's alarm ribbon is never covered). Drag the handle; momentum
   snaps to the nearest point on release; swiping down from peek dismisses;
   the backdrop dims only at full; the action footer stays pinned (sticky).
   Applies to the asset panel, the notification panel and dialog sheets.
   ============================================================================ */
window.EKO_SHEET = (function(){
  'use strict';
  let E = null, drag = null, timer = null;
  const SNAPS = [25, 55, 92];
  /* keyboard-aware height basis (D65): the visual viewport shrinks when the
     on-screen keyboard opens, so sheets resize instead of being pushed off */
  const VH = () => (window.visualViewport ? window.visualViewport.height : window.innerHeight);
  const heights = {};                    /* sheet kind -> current snap vh */

  function sheets(){
    if(window.innerWidth >= 768) return [];
    return [...document.querySelectorAll('#assetpanel, .nfpanel, .dlg, .mkpop, #aipanel')]
      .filter(el => {
        const h = el.querySelector('.draghandle');
        /* a HIDDEN handle (e.g. .dlgdrop menus) means "not a sheet" */
        return h && h.offsetHeight > 0 && el.getBoundingClientRect().width > 0;
      });
  }
  function kind(el){
    return el.id === 'assetpanel' ? 'asset'
      : el.classList.contains('nfpanel') ? 'notif' : el.classList.contains('mkpop') ? 'mkpop' : el.id === 'aipanel' ? 'ai' : 'dlg';
  }
  function fullVH(){
    const bar = document.getElementById('topbar');
    const barBottom = bar ? bar.getBoundingClientRect().bottom : 48;
    return Math.min(92, (VH() - barBottom - 6) / VH() * 100);
  }
  function applyH(el, vh){
    el.style.height = vh + 'vh';
    el.style.maxHeight = vh + 'vh';
    const dim = vh >= fullVH() - 2;
    (window.DASHBOARD_ROOT||document.documentElement).toggleAttribute('data-sheetfull', dim);
  }
  function dismiss(el){
    const k = kind(el);
    delete heights[k];
    (window.DASHBOARD_ROOT||document.documentElement).removeAttribute('data-sheetfull');
    if(k === 'asset') E.set({ assetSel: null });
    else if(k === 'mkpop') E.set({ mkPop: null, mkPopN: 0 });
    else if(k === 'ai'){ window.EKO_AI.close(); E.set({}); }   /* D132 */
    else if(k === 'notif' && window.EKO_NF) window.EKO_NF.ACTS.nfClose();
    else if(el.classList.contains('vsheet')){ E.state.dock.bloom = null; E.set({}); }   /* D69 viewer sheet */
    else {
      const closer = el.querySelector('[data-act="closeDlg"],[data-act="ctlDlgClose"],[data-act="nfPrefsClose"]');
      if(closer) closer.click(); else E.set({ dlg: null });
    }
  }

  function onDown(ev){
    if(window.innerWidth >= 768) return;
    const handle = ev.target.closest && ev.target.closest('.draghandle');
    if(!handle) return;
    const el = handle.closest('#assetpanel, .nfpanel, .dlg, .mkpop, #aipanel');
    if(!el) return;
    ev.preventDefault();
    const startVH = el.getBoundingClientRect().height / VH() * 100;
    drag = { el, startY: ev.clientY, startVH, lastY: ev.clientY, lastT: Date.now(), vel: 0, raf: 0 };
    el.classList.add('sheetdrag');
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }
  function onMove(ev){
    if(!drag) return;
    const now = Date.now();
    drag.vel = (ev.clientY - drag.lastY) / Math.max(1, now - drag.lastT);
    drag.lastY = ev.clientY; drag.lastT = now;
    if(drag.raf) return;
    drag.raf = requestAnimationFrame(() => {
      if(!drag) return;             /* released or dismissed mid-frame */
      drag.raf = 0;
      const dyVH = (drag.startY - drag.lastY) / VH() * 100;
      const vh = Math.max(8, Math.min(fullVH(), drag.startVH + dyVH));
      applyH(drag.el, vh);
    });
  }
  function onUp(){
    if(!drag) return;
    const { el, vel } = drag;
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    el.classList.remove('sheetdrag');
    const cur = el.getBoundingClientRect().height / VH() * 100;
    /* momentum: a decisive fling biases one snap in its direction */
    const bias = vel < -0.5 ? 12 : vel > 0.5 ? -12 : 0;
    const pts = [SNAPS[0], SNAPS[1], fullVH()];
    let best = pts[0], bd = 1e9;
    pts.forEach(p => { const d = Math.abs(p - (cur + bias)); if(d < bd){ bd = d; best = p; } });
    if(cur + bias < SNAPS[0] - 8){ dismiss(el); drag = null; return; }
    heights[kind(el)] = best;
    if(window.EKO_PWA) window.EKO_PWA.haptic('snap');
    el.classList.add('sheetsnap');
    applyH(el, best);
    setTimeout(() => el.classList.remove('sheetsnap'), 260);
    drag = null;
  }

  /* re-renders wipe inline styles — the loop restores each sheet's snap
     (a newly opened sheet starts at HALF) */
  function sync(){
    sheets().forEach(el => {
      const k = kind(el);
      if(heights[k] == null) heights[k] = k === 'mkpop' ? SNAPS[0] : SNAPS[1];   /* D128: the marker popup opens at PEEK */
      if(!drag || drag.el !== el) applyH(el, heights[k]);
    });
    if(!sheets().length) (window.DASHBOARD_ROOT||document.documentElement).removeAttribute('data-sheetfull');
  }

  function init(app){
    E = app;
    document.addEventListener('pointerdown', onDown, true);
    timer = setInterval(sync, 250);
  }
  return { init, sync, SNAPS, heights };
})();
