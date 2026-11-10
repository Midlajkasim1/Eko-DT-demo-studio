/* ============================================================================
   E15: SHOW IN THE MODEL (design/persona-mock/6-Brief-popup-v3.html, EKO_E14d_Brief.md
   section 3): EKO_BFOCUS.

   A row of the Brief that maps to a model element or room (data.assets[].gid or
   roomGid, read from the model: handoff/hospital-model-map.md) has a locate button,
   and the row itself locates. On a locate:
     1 the Brief shrinks into the Brief button, which glows and reads "Brief · back";
     2 the focus card appears at the top right (340 px, the glow ring): the section and
       "n of N", ‹ ›, the tag and sentence, the place, the item's one action, Back to Brief;
     3 the camera flies to the element (the viewer's own fly-to) and centres it in the
       model area left of the card; the rest goes studio, its level is outlined in the
       glow colour, the other markers dim and the element gets three pulsing rings;
     4 when the fly ends a curved leader line draws from the element to the card. If
       the reader orbits or zooms, the line hides while the camera moves and is redrawn
       (projected with camera.project()) when it stops.
   ‹ › fly between the items. Back to Brief, Esc or the Brief button reverse it all: the
   line clears, the camera returns to the view before the first locate, the style from
   before the locate returns and the dimming ends, and the Brief grows back with its scroll and ribbon kept.
   Reduced motion: everything jumps, the line appears at once.
   E17 (EKO_E17_Devices_Polish.md item 3): under 1024 px the model is a peek card that
   the focus card covered. There the focus opens the model mode (full screen) and:
     tablet in portrait (768 to 1023 px): the card is a strip pinned to the bottom
       (about 30 percent of the height) with the step buttons and a swipe left or
       right; the asset is centred in the model above it; the line runs from the
       marker to the top edge of the strip;
     phone (under 768 px): the card is a bottom card (about a third of the height);
       the asset is centred in the upper 60 percent with its rings and no line; a
       swipe down, Back to Brief or the device's back button (a history entry)
       return to the Brief as it was, its scroll included.
   Targets there are 44 px; the line hides while the model turns or zooms and is
   redrawn when it stops (as on the desk).
   ============================================================================ */
window.EKO_BFOCUS = (function(){
  'use strict';
  const B = () => window.EKO_BRIEF, C = () => window.EKO_C;
  const esc = s => C().esc(s);
  const reduce = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const NS = 'http://www.w3.org/2000/svg';
  let E = null, st = null, idleT = null, hooked = false, card = null, line = null, mark = null, linkT = null, popSkip = false;
  /* E17: where the focus runs: 'desk', 'tab' (the stacked shell, 768 to 1023 px) or 'phone' (under 768 px) */
  const lay = () => !(E && E.stacked && E.stacked()) ? 'desk' : innerWidth < 768 ? 'phone' : 'tab';

  /* an asset the model can show: an element or a room of the model, and an engine that can fly to it */
  function locatable(app, id){
    if(!id || !app || !app.engine || !app.engine.flyToAssetAt) return false;
    if(app.engine.inModel) return app.engine.inModel(id);
    const a = (app.data.assets || []).find(x => x.id === id);
    return !!(a && (a.gid || a.roomGid) && (!app.engine.locatable || app.engine.locatable(id)));
  }
  const viewer = () => document.getElementById('vpmain');
  const host = () => document.getElementById('enginehost') || viewer();

  /* ------------------------------ the pieces ------------------------------ */
  function ensure(){
    if(!card){ card = document.createElement('aside'); card.id = 'bfocus'; card.className = 'bfwrap'; card.setAttribute('aria-live', 'polite'); card.hidden = true; (window.DASHBOARD_ROOT || document.body).appendChild(card);
      /* E17: on a phone or a tablet, a swipe on the card: left or right for the next or the previous item (mirrored in Arabic); down on a phone for the Brief */
      /* touch events, not pointer events: the card's content may scroll, and the browser cancels a pointer it pans with */
      let sw = null;
      card.addEventListener('touchstart', ev => { if(!st || st.lay === 'desk' || ev.touches.length !== 1) return; const t = ev.touches[0], bc = card.querySelector('.bfcard'); sw = { x: t.clientX, y: t.clientY, top: !bc || bc.scrollTop <= 0 }; }, { passive: true });
      card.addEventListener('touchcancel', () => { sw = null; }, { passive: true });
      card.addEventListener('touchend', ev => { if(!sw || !st) return; const t = ev.changedTouches[0], dx = t.clientX - sw.x, dy = t.clientY - sw.y, top = sw.top; sw = null;
        if(Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.3) step((dx < 0) !== rtl() ? 1 : -1);
        else if(st.lay === 'phone' && top && dy > 56 && dy > Math.abs(dx) * 1.3) back(); }, { passive: true }); }
    if(!line){ line = document.createElementNS(NS, 'svg'); line.id = 'bfline'; line.setAttribute('aria-hidden', 'true');
      line.innerHTML = '<defs><linearGradient id="bflg" x1="0" x2="1"><stop offset="0" stop-color="#4CC3F0"/><stop offset=".5" stop-color="#7B6CFF"/><stop offset="1" stop-color="#C86BD9"/></linearGradient></defs><path id="bflp" d=""/><circle id="bflc1" r="0"/><circle id="bflc2" r="0"/>';
      (window.DASHBOARD_ROOT || document.body).appendChild(line); }
    if(!mark){ mark = document.createElement('div'); mark.id = 'bfmark'; mark.setAttribute('aria-hidden', 'true'); mark.innerHTML = '<i></i><i></i><i></i><b></b>'; mark.hidden = true; (window.DASHBOARD_ROOT || document.body).appendChild(mark); }
  }
  function fill(){
    const t = (k, v) => E.t(k, v), it = st.list[st.i], sec = st.list.filter(x => x.sec === it.sec), n = sec.indexOf(it) + 1;
    const a = it.act;
    card.dataset.sev = it.sev || '';
    card.innerHTML = (window.EKO_HIT ? window.EKO_HIT.nb : (h => h))(`<div class="bfcard">${st.lay === 'phone' ? '<span class="bfgrab" aria-hidden="true"></span>' : ''}
      <div class="bfhd"><span class="bfsev"></span><span>${esc(it.secLabel || '')}</span><span class="bfpos">${esc(t('bf15.pos', { n, m: sec.length }))}</span><span class="grow"></span>
        <button class="bfstep" data-act="bfStep" data-v="-1" aria-label="${esc(t('bf15.prev'))}">‹</button><button class="bfstep" data-act="bfStep" data-v="1" aria-label="${esc(t('bf15.next'))}">›</button></div>
      <div class="bftl">${it.tag ? `<code>${esc(it.tag)}</code>` : ''}${esc(it.text)}</div>
      ${it.meta ? `<div class="bfm">${esc(it.meta)}</div>` : ''}
      <div class="bfact">${a ? `<button class="br14btn${it.pri ? ' pri' : ''}" data-act="${esc(a.act)}"${Object.keys(a.data || {}).map(k => ` data-${k}="${esc(a.data[k])}"`).join('')}>${esc(a.label)}</button>` : ''}
        <button class="bfback" data-act="bfBack"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2c.6 4.9 3.1 7.4 8 8-4.9.6-7.4 3.1-8 8-.6-4.9-3.1-7.4-8-8 4.9-.6 7.4-3.1 8-8z"/></svg>${esc(t('bf15.back'))}</button></div></div>
      <span class="bfpin" aria-hidden="true"></span>`);
  }
  const rtl = () => (window.DASHBOARD_ROOT || document.documentElement).dir === 'rtl';
  /* the card sits at the top end of the model area (the right, the left in Arabic) */
  function placeCard(){
    const v = viewer(); if(!v || !card) return; const r = v.getBoundingClientRect();
    /* E17: on a phone or a tablet the card is pinned to the bottom by its CSS (css/e17.css, .bfwrap[data-lay]) */
    if(st && st.lay !== 'desk'){ card.dataset.lay = st.lay; card.style.top = ''; card.style.removeProperty('--bfW'); card.style.removeProperty('--bfL'); return; }
    delete card.dataset.lay;
    /* never over the summary panel */
    const sm = document.getElementById('ovp'), sr = sm && sm.isConnected && sm.offsetWidth ? sm.getBoundingClientRect() : null;
    const room = sr ? (rtl() ? sr.left - r.left : r.right - sr.right) : r.width, w = Math.min(340, Math.max(240, room - 32));
    card.style.setProperty('--bfW', Math.round(w) + 'px'); card.style.top = Math.round(r.top + 10) + 'px';
    card.style.setProperty('--bfL', Math.round(rtl() ? r.left + 16 : r.right - 16 - w) + 'px');
  }
  function showCard(){
    ensure(); fill(); placeCard();
    if(card.hidden){ card.hidden = false; if(!reduce()) card.animate(st && st.lay !== 'desk' ? [{ transform: 'translateY(40px)', opacity: 0 }, { transform: 'none', opacity: 1 }] : [{ opacity: 0, transform: 'translateY(-8px) scale(.97)' }, { opacity: 1, transform: 'none' }], { duration: 300, easing: 'ease-out' }); }
  }
  function clearLine(){
    if(!line) return; line.querySelector('#bflp').setAttribute('d', ''); line.querySelectorAll('circle').forEach(c => c.setAttribute('r', 0));
    if(card) card.classList.remove('linked'); clearTimeout(linkT);
  }
  /* the element's point on the page (px), or null */
  function point(){
    const it = st && st.list[st.i], eng = E && E.engine; if(!it || !eng || !eng.projectAsset) return null;
    const p = eng.projectAsset(it.asset), h = host(); if(!p || !h) return null;
    const r = h.getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y, visible: p.visible !== false };
  }
  function placeMark(){
    ensure(); const p = point();
    if(!p || !p.visible){ mark.hidden = true; return null; }
    const tg = (st.list[st.i] || {}).asset; document.querySelectorAll('#vpmain .mk').forEach(m => m.classList.toggle('bfon', m.dataset.tip === tg));
    mark.hidden = false; mark.style.left = Math.round(p.x) + 'px'; mark.style.top = Math.round(p.y) + 'px'; mark.dataset.sev = (st.list[st.i] || {}).sev || '';
    return p;
  }
  function drawLine(animate){
    if(!st || card.hidden) return;
    const p = placeMark(); if(!p){ clearLine(); return; }
    /* E17: on a phone the rings alone mark the asset (no line) */
    if(st.lay === 'phone'){ clearLine(); card.dataset.edge = 'none'; card.classList.add('linked'); line.dataset.x1 = Math.round(p.x); line.dataset.y1 = Math.round(p.y); delete line.dataset.x2; delete line.dataset.y2; return; }
    /* to the card's near side edge, or up to its bottom edge when the element is under it; on a tablet, down to the strip's top edge */
    const f = card.getBoundingClientRect(), x1 = p.x, y1 = p.y, top = st.lay === 'tab', under = !top && p.y > f.bottom && (rtl() ? p.x < f.right + 40 : p.x > f.left - 40);
    const x2 = top ? Math.max(f.left + 28, Math.min(f.right - 28, p.x)) : under ? f.left + f.width / 2 : rtl() ? f.right : f.left, y2 = top ? f.top : under ? f.bottom : f.top + f.height / 2;
    /* E17: a line straight down has a box with no width, and its gradient stroke would not draw: it bows a little */
    const bow = top && Math.abs(x2 - x1) < 24 ? 18 : 0;
    const d = under || top ? 'M' + x1 + ',' + y1 + ' C' + (x1 + bow) + ',' + (y1 + (y2 - y1) * 0.55) + ' ' + (x2 - bow) + ',' + (y1 + (y2 - y1) * 0.45) + ' ' + x2 + ',' + y2
      : 'M' + x1 + ',' + y1 + ' C' + (x1 + (x2 - x1) * 0.55) + ',' + y1 + ' ' + (x1 + (x2 - x1) * 0.45) + ',' + y2 + ' ' + x2 + ',' + y2;
    card.dataset.edge = top ? 'top' : under ? 'bottom' : 'side';
    if(top) card.style.setProperty('--pinX', Math.round(x2 - f.left - 5) + 'px');
    const lp = line.querySelector('#bflp'), c1 = line.querySelector('#bflc1'), c2 = line.querySelector('#bflc2');
    lp.setAttribute('d', d); c1.setAttribute('cx', x1); c1.setAttribute('cy', y1); c1.setAttribute('r', 3); c2.setAttribute('cx', x2); c2.setAttribute('cy', y2); c2.setAttribute('r', 3);
    const L = lp.getTotalLength ? lp.getTotalLength() : 0;
    lp.style.strokeDasharray = L; lp.style.strokeDashoffset = 0;
    if(animate && !reduce() && L && lp.animate) lp.animate([{ strokeDashoffset: L }, { strokeDashoffset: 0 }], { duration: 520, easing: 'ease-out' });
    card.classList.add('linked');
    line.dataset.x1 = Math.round(x1); line.dataset.y1 = Math.round(y1); line.dataset.x2 = Math.round(x2); line.dataset.y2 = Math.round(y2);
  }
  /* wait for the fly to end, then link */
  function whenStill(cb){
    const eng = E.engine; let n = 0; clearTimeout(linkT);
    const tick = () => { if(!st) return; if(eng.animating && eng.animating() && n++ < 80){ linkT = setTimeout(tick, 50); return; } linkT = setTimeout(cb, 60); };
    tick();
  }
  /* the camera: centre the element in the model area left of the card */
  function fly(){
    const it = st.list[st.i], eng = E.engine, v = viewer(); if(!v) return;
    const vr = v.getBoundingClientRect(), f = card.getBoundingClientRect();
    /* the free model area: beside the card, and clear of the summary panel on the reading-start side */
    const sm = document.getElementById('ovp'), sr = sm && sm.isConnected && sm.offsetWidth ? sm.getBoundingClientRect() : null;
    const a0 = rtl() ? Math.max(vr.left, f.right + 16) : Math.max(vr.left, sr ? sr.right + 8 : vr.left), a1 = rtl() ? Math.min(vr.right, sr ? sr.left - 8 : vr.right) : Math.min(vr.right, f.left - 16);
    /* too narrow beside the card (a laptop with both panels): the area under it */
    let cx = (a0 + a1) / 2, cy = (vr.top + vr.bottom) / 2; st.below = a1 - a0 < 220;
    if(st.below){ const b0 = rtl() ? vr.left : Math.max(vr.left, sr ? sr.right + 8 : vr.left), b1 = rtl() ? Math.min(vr.right, sr ? sr.left - 8 : vr.right) : vr.right;
      cx = (b0 + b1) / 2; cy = (f.bottom + 24 + vr.bottom - 140) / 2; }
    /* E17: on a tablet and a phone the model above the card. E17b: the card is as tall as its content, so its top is
       read from its layout height (it is pinned to the bottom; its rise-in animation would move the drawn top) */
    if(st.lay !== 'desk'){ st.below = false; cx = (vr.left + vr.right) / 2;
      cy = (vr.top + Math.min(vr.bottom, innerHeight - card.offsetHeight)) / 2; }
    const dx = cx - (vr.left + vr.right) / 2, dy = cy - (vr.top + vr.bottom) / 2;
    clearLine(); mark && (mark.hidden = true);
    (window.DASHBOARD_ROOT || document.documentElement).classList.add('bfx');
    try{ eng.setFocus && eng.setFocus([it.asset], '#7B6CFF'); eng.cutAbove && eng.cutAbove(it.asset); /* outline off for now: eng.outlineLevel && eng.outlineLevel(it.asset); */ }catch(e){}
    eng.flyToAssetAt(it.asset, dx, it.dist || 34, reduce() ? 1 : 900, dy);
    whenStill(() => drawLine(true));
  }
  /* a camera that moves (the reader orbits or zooms): the line hides, and comes back when it stops */
  function onCamera(){
    if(!st || !card || card.hidden) return;
    if(E.engine.animating && E.engine.animating()) return;
    clearLine(); placeMark();
    clearTimeout(idleT); idleT = setTimeout(() => drawLine(false), 220);
  }

  /* -------------------------------- the flow -------------------------------- */
  function locate(app, key){
    E = app;
    if(!viewer()){ E.go(E.overviewId(), 'overview', null); setTimeout(() => locate(app, key), 700); return; }
    const data = B() && B().focusData ? B().focusData() : null; if(!data) return;
    let list = data.items.filter(x => locatable(app, x.asset)), i = list.findIndex(x => x.key === key);
    if(i < 0){ const one = data.tl.find(x => x.key === key && locatable(app, x.asset)); if(!one) return; list = [one]; i = 0; }
    if(!hooked && E.engine.onCameraChange){ E.engine.onCameraChange(onCamera); hooked = true; }
    if(!st){ st = { list, i, from: E.engine.saveViewpoint ? E.engine.saveViewpoint() : null, lay: lay(), fsWas: !!E.state.modelFs,
      /* E17: the Brief's scroll, put back when it returns */
      scroll: [...document.querySelectorAll('.br14wrap .br14body, .br14wrap .br14main, .br14wrap .br14tl')].map(e => e.scrollTop) }; }
    else { st.list = list; st.i = i; }
    ensure();
    const go0 = () => { showCard(); fly(); };
    /* E17: on a phone or a tablet the model opens in its full screen mode first, and the device's back button returns to the Brief */
    const go = () => { if(st.lay === 'desk') return go0();
      (window.DASHBOARD_ROOT || document.documentElement).dataset.bflay = st.lay;
      if(!st.hist && history.pushState){ try{ history.pushState(Object.assign({}, history.state, { ekoFocus: 1 }), ''); st.hist = true; }catch(e){} }
      if(!E.state.modelFs) E.set({ modelFs: true, born: 'dlg' });
      requestAnimationFrame(() => requestAnimationFrame(() => { if(st) go0(); })); };
    if(B() && B().isHeld && B().isHeld()) go(); else B().shrinkInto(go);
  }
  function step(d){
    if(!st || !st.list.length) return;
    st.i = (st.i + d + st.list.length) % st.list.length; fill(); fly();
  }
  function back(fromPop){
    if(!st) return;
    const eng = E.engine, from = st.from, stacked = st.lay !== 'desk', fsWas = st.fsWas, hist = st.hist, scroll = st.scroll;
    clearLine(); if(mark) mark.hidden = true; clearTimeout(idleT); clearTimeout(linkT);
    try{ eng.setFocus && eng.setFocus(null); eng.cutAbove && eng.cutAbove(null); eng.outlineLevel && eng.outlineLevel(null); }catch(e){}
    (window.DASHBOARD_ROOT || document.documentElement).classList.remove('bfx'); delete (window.DASHBOARD_ROOT || document.documentElement).dataset.bflay;
    if(from && eng.flyToViewpoint) eng.flyToViewpoint(from, reduce() ? 1 : 800);
    st = null;
    if(card && !card.hidden){ if(reduce() || !card.animate) card.hidden = true; else card.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180 }).onfinish = () => { card.hidden = true; }; }
    /* E17: the model mode closes as it was before the locate; the history entry goes (unless the back button took it) */
    if(stacked && !fsWas) E.state.modelFs = false;
    if(hist && !fromPop){ popSkip = true; try{ history.back(); }catch(e){ popSkip = false; } }
    if(B()) B().unhold();
    if(scroll) requestAnimationFrame(() => document.querySelectorAll('.br14wrap .br14body, .br14wrap .br14main, .br14wrap .br14tl').forEach((e, k) => { if(scroll[k]) e.scrollTop = scroll[k]; }));
  }
  /* E17: the device's back button (or the browser's) during the focus returns to the Brief */
  addEventListener('popstate', () => { if(popSkip){ popSkip = false; return; } if(st && st.hist){ st.hist = false; back(true); } });
  /* a page change ends the focus without flying (the page has its own view) */
  function reset(){
    if(!st) return; clearLine(); if(mark) mark.hidden = true; if(card) card.hidden = true;
    if(st.hist){ popSkip = true; try{ history.back(); }catch(e){ popSkip = false; } } delete (window.DASHBOARD_ROOT || document.documentElement).dataset.bflay;
    try{ E.engine.setFocus && E.engine.setFocus(null); E.engine.cutAbove && E.engine.cutAbove(null); E.engine.outlineLevel && E.engine.outlineLevel(null); }catch(e){}
    (window.DASHBOARD_ROOT || document.documentElement).classList.remove('bfx'); st = null;
  }
  /* a timeline row that locates is a button for the keyboard too */
  document.addEventListener('keydown', ev => { if((ev.key === 'Enter' || ev.key === ' ') && ev.target && ev.target.matches && ev.target.matches('.br14ev.loc')){ ev.preventDefault(); ev.target.click(); } });
  /* after a render (an action from the card, a new alarm): the item's words and action again, the line where it was */
  function refresh(){
    if(!st || !card || card.hidden) return;
    const d = B() && B().focusData ? B().focusData() : null; if(!d) return;
    const all = d.items.concat(d.tl);
    st.list = st.list.map(x => all.find(y => y.key === x.key) || x); fill();
    if(card.classList.contains('linked') && !(E.engine.animating && E.engine.animating())) drawLine(false);
  }
  document.addEventListener('keydown', ev => { if(ev.key === 'Escape' && st){ ev.stopPropagation(); ev.preventDefault(); back(); } }, true);
  addEventListener('resize', () => { if(!st) return; if(lay() !== st.lay){ back(); return; } placeCard(); fly(); });   /* E17: a change between the desk, tablet and phone layouts ends the focus */

  const ACTS = {
    bfLocate(el, ev){ if(ev && ev.target && ev.target.closest('button') && !ev.target.closest('[data-act="bfLocate"]')) return; locate(window.EKO, el.dataset.v); },
    bfStep(el){ step(+el.dataset.v || 1); },
    bfBack(){ back(); }
  };
  return { locatable, locate, step, back, reset, refresh, ACTS, active: () => !!st, state: () => st ? { key: st.list[st.i].key, asset: st.list[st.i].asset, line: line ? Object.assign({}, line.dataset) : null } : null };
})();
