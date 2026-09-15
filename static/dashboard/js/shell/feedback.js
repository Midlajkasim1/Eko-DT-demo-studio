/* ============================================================================
   FEEDBACK (D75) — the ONE toast. Every transient confirmation or explanation
   in the app goes through here, so they all look, place and behave alike:
     - one at a time (a new one replaces the current one)
     - tone: info | ok | warn (icon + accent), text at the caption size
     - at most ONE action (Undo, Reload, Retry, Activity) via data-act
     - auto-dismiss (4 s; longer for actions), paused while hovered/focused,
       Escape dismisses, click on the ✕ dismisses
     - placed bottom-centre of the content area ABOVE any bar, timeline, FAB
       or tab bar — never on a control; recomputed on resize; mirrors in RTL
     - role="status" / aria-live="polite" for screen readers
   Tiers (handoff/interactions.md §Feedback): inline state first, toast for
   the moment, the bell for anything that matters later, a banner for
   system-wide state. No strings live here.
   ============================================================================ */
window.EKO_FB = (function(){
  'use strict';
  const GAP = 12, MS = 4000, MS_ACTION = 6000;
  const C = () => window.EKO_C;
  let E = null, box = null, timer = null, until = 0, hover = false;

  function el(){
    if(box) return box;
    box = document.createElement('div');
    box.id = 'ekotoast'; box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite');
    box.hidden = true;
    box.addEventListener('pointerenter', () => { hover = true; });
    box.addEventListener('pointerleave', () => { hover = false; arm(Math.max(1200, until - Date.now())); });
    box.addEventListener('focusin', () => { hover = true; });
    box.addEventListener('focusout', () => { hover = false; arm(1500); });
    document.body.appendChild(box);
    return box;
  }
  function arm(ms){
    clearTimeout(timer); until = Date.now() + ms;
    timer = setTimeout(() => { if(hover){ arm(1000); return; } hide(); }, ms);
  }
  /* Bottom-centre of the content area, lifted above whatever chrome sits
     there (controls bar, timeline, FAB, phone tab bar, PWA banner). */
  function place(){
    const L = el();
    const mount = document.getElementById('mount');
    const vh = window.innerHeight, vw = window.innerWidth;
    let bottom = mount ? Math.max(0, vh - mount.getBoundingClientRect().bottom) : 0;
    bottom += GAP;
    /* D76: centred on the SCENE axis (with the bar and the timeline) when a
       scene is on screen, else on the content area */
    const scene = document.getElementById('vpmain');
    const axisEl = (scene && scene.getBoundingClientRect().width > 300) ? scene : mount;
    const ar = axisEl ? axisEl.getBoundingClientRect() : { left:0, right:vw };
    const cx = (ar.left + ar.right) / 2;
    const chrome = ['#mobtabs', '.scrubbar', '#vbar', '.vfab', '.pwabanner', '#ailaunch'];
    const h = L.offsetHeight, w = L.offsetWidth;
    L.style.left = Math.round(Math.max(8, Math.min(cx - w / 2, vw - w - 8))) + 'px'; L.style.right = 'auto'; L.style.marginInline = '0';
    /* lift until the toast's band no longer intersects any chrome element */
    for(let pass = 0; pass < 6; pass++){
      let lifted = false;
      chrome.forEach(sel => document.querySelectorAll(sel).forEach(c => {
        const r = c.getBoundingClientRect();
        if(r.width < 2 || r.height < 2) return;
        const top = vh - bottom - h, bot = vh - bottom;
        if(r.top < bot && r.bottom > top && r.left < cx + w / 2 && r.right > cx - w / 2){
          bottom = Math.max(bottom, vh - r.top + GAP); lifted = true;
        }
      }));
      if(!lifted) break;
    }
    L.style.bottom = Math.round(bottom) + 'px';
  }
  /* toast({ text, tone, action:{ label, act, v, asset }, ms }) */
  function toast(o){
    if(!o || !o.text) return;
    const L = el(), t = E ? E.t.bind(E) : (k => k);
    const tone = o.tone || 'info';
    const ICON = { info:'info', ok:'check', warn:'warn' }[tone] || 'info';
    const act = o.action ? `<button class="fbact" data-act="${C().esc(o.action.act)}"${o.action.v ? ` data-v="${C().esc(o.action.v)}"` : ''}${o.action.asset ? ` data-asset="${C().esc(o.action.asset)}"` : ''}>${C().esc(o.action.label)}</button>` : '';
    L.innerHTML = `<span class="fbic" aria-hidden="true">${C().icon(ICON, 15)}</span><span class="fbtxt">${C().esc(o.text)}</span>${act}
      <button class="iconbtn icon26 fbx" data-act="fbClose" aria-label="${C().esc(t('fbDismiss'))}">${C().icon('x', 12)}</button>`;
    L.dataset.tone = tone;
    L.hidden = false;
    L.dataset.born = '0'; void L.offsetWidth; L.dataset.born = '1';
    place();
    arm(o.ms || (o.action ? MS_ACTION : MS));
  }
  function hide(){ clearTimeout(timer); timer = null; hover = false; if(box) box.hidden = true; }
  const visible = () => !!box && !box.hidden;
  function init(app){
    E = app; el();
    window.addEventListener('resize', () => { if(visible()) place(); });
    document.addEventListener('keydown', ev => { if(ev.key === 'Escape' && visible()) hide(); }, true);
    /* an action inside the toast dismisses it after the app handled it */
    document.addEventListener('click', ev => { if(box && box.contains(ev.target) && ev.target.closest('.fbact')) setTimeout(hide, 0); });
  }
  const ACTS = { fbClose(){ hide(); } };
  return { init, toast, hide, visible, place, ACTS, el: () => box };
})();
