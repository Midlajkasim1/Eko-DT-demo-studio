/* ============================================================================
   E17: TARGET SIZES (EKO_E17_Devices_Polish.md items 3 and 6, WCAG 2.5.8).
   Every control takes at least 24 x 24 px of pointer, and 44 x 44 px on the
   touch layouts (the stacked shell, under 1024 px), without changing its look:
   a control drawn smaller gets an invisible hit area centred on it, sized
   max(100%, the minimum), on its ::after (or its ::before when it draws its
   own ::after). This file only marks the controls: data-hit="a" or "b" (the
   pseudo-element used) plus "r" when the control was position:static and needs
   position:relative for the hit area. The CSS is in css/e17.css.
   It runs after every render (app.js) and after any other change to the page
   (one pass per frame). Marks on a drawing or the model are left alone: their
   place is the information.
   It also gives a chart its drawing width (--vbw) and the nurse call plan its scale (--k), and wraps asset tags (nb).
   ============================================================================ */
window.EKO_HIT = (function(){
  'use strict';
  const SEL = 'button, a[href], [role="button"], [role="tab"], [role="link"], [role="menuitem"], [role="option"], [role="switch"], summary, label:has(> input[type="checkbox"], > input[type="radio"]), [data-act]:not([role="dialog"]):not(section):not(form):not(input):not(select):not(textarea)';
  const empty = c => c === 'none' || c === 'normal';
  let raf = 0;
  const root = () => window.DASHBOARD_ROOT || document.documentElement;
  const min = () => (window.matchMedia && matchMedia('(max-width:1023px)').matches) ? 44 : 24;
  /* E17 item 6: the top bar's crumb shortens instead of cutting its text. When something in it does not fit, the page
     and the module leave it (the navigation and the page's tabs name them): data-tight="1"; if the site name still does
     not fit, it becomes the site icon with the name in its tooltip: data-tight="2" (css/e17.css). Run at each render
     and in each pass, since the alarm ribbon and the Brief's count fill in after the render. */
  function crumb(){
    const cr = document.getElementById('crumb'); if(!cr || !cr.offsetWidth) return;
    const was = cr.dataset.tight || ''; cr.removeAttribute('data-tight');
    const cut = () => cr.scrollWidth > cr.clientWidth + 1 || [...cr.querySelectorAll('*')].some(c => c.clientWidth > 0 && c.scrollWidth > c.clientWidth + 1);
    let t = ''; if(cut()){ cr.dataset.tight = t = '1'; if(cut()) cr.dataset.tight = t = '2'; }
    return t !== was;
  }
  function pass(){
    raf = 0;
    crumb();
    const N = min();
    root().style.setProperty('--hit', N + 'px');
    root().querySelectorAll(SEL).forEach(el => {
      if(el instanceof SVGElement || el.closest('svg, #enginehost, .mklayer, #ekotip')) return;
      /* the layout size, not the drawn one: a panel growing in (the Brief, from its button) is scaled down for a moment */
      const r = { width: el.offsetWidth, height: el.offsetHeight };
      if(!r.width && !r.height) return;                                  /* not shown: left as it is */
      /* a control that holds other controls (a row with its buttons) gets no hit area: it would lie over them */
      if((r.width >= N && r.height >= N) || el.querySelector(SEL)){ if(el.hasAttribute('data-hit')) el.removeAttribute('data-hit'); return; }
      if(el.hasAttribute('data-hit')) return;
      const cs = getComputedStyle(el), side = empty(getComputedStyle(el, '::after').content) ? 'a' : empty(getComputedStyle(el, '::before').content) ? 'b' : '';
      if(side) el.setAttribute('data-hit', side + (cs.position === 'static' ? 'r' : ''));
    });
    /* E17 item 6: a chart drawn in a fixed viewBox and scaled down to a phone drew its axis text at 5 px. Each such
       drawing carries its viewBox width (--vbw: on a phone a wide chart keeps that size and scrolls in its card) and the
       nurse call plan its scale (--k: its bay labels are sized by it); css/e17.css */
    root().querySelectorAll('svg.esgchart, svg:has(text.ncbay)').forEach(sv => {
      const vb = sv.viewBox && sv.viewBox.baseVal; if(!vb || !vb.width) return;
      if(sv.style.getPropertyValue('--vbw') !== String(vb.width)) sv.style.setProperty('--vbw', vb.width);
      if(!sv.classList.contains('esgchart')){ const w = sv.getBoundingClientRect().width; if(!w) return;
        const k = (w / vb.width).toFixed(3); if(sv.style.getPropertyValue('--k') !== k) sv.style.setProperty('--k', k); }
    });
  }
  const schedule = () => { if(!raf) raf = requestAnimationFrame(pass); };

  /* E17 item 4: an asset tag (AHU-1, O2-LINE-1, SD-928017, WO-5121, RH-02-C.009.01) never breaks at its hyphen.
     nb(html) wraps each tag in the text of a rendered page in <span class="tagnb"> (white-space:nowrap, css/e17.css).
     Only text between tags is touched: never an attribute, and never the text of an option, a textarea, a title,
     a script, a style or SVG text, where a span is not allowed. The text itself (textContent) does not change. */
  const TAG = /\b[A-Z][A-Z0-9]{0,7}(?:-[A-Z0-9][A-Z0-9.]*)+\b/g, RAW = /^<(textarea|option|title|script|style|text|tspan|select)\b/i;
  function nb(html){
    if(!html || html.indexOf('-') < 0) return html;
    const parts = html.split(/(<[^>]*>)/); let skip = null;
    for(let i = 0; i < parts.length; i++){
      const p = parts[i]; if(!p) continue;
      if(p.charCodeAt(0) === 60){   /* a tag */
        if(skip){ if(new RegExp('^</' + skip + '\\b', 'i').test(p)) skip = null; continue; }
        const m = p.match(RAW); if(m && !/\/>$/.test(p)) skip = m[1]; continue; }
      if(!skip && p.indexOf('-') >= 0) parts[i] = p.replace(TAG, '<span class="tagnb">$&</span>');
    }
    return parts.join('');
  }
  function init(){
    const was = window.__ekoHitInit; if(was){ if(was.obs) was.obs.disconnect(); removeEventListener('resize', was.resize); }   /* the dashboard opened again */
    const obs = window.MutationObserver ? new MutationObserver(schedule) : null; if(obs) obs.observe(root(), { childList: true, subtree: true });
    const resize = () => { root().querySelectorAll('[data-hit]').forEach(el => el.removeAttribute('data-hit')); schedule(); };
    addEventListener('resize', resize); window.__ekoHitInit = { obs, resize };
    schedule();
  }
  return { init, pass, schedule, nb, crumb };
})();
