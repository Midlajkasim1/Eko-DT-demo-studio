/* ============================================================================
   SURFACE MANAGER (D67) — the one place that knows which transient surfaces
   are open and enforces the interaction rules for all of them:
     R2  at most ONE transient surface; dialogs are the only stack and they
         sit above their parent, which stays open and is returned to
     R3  Escape closes the TOPMOST surface only (the palette clears a
         non-empty query first); on a full page with nothing open it goes Back
     R4  a route change closes every transient surface; none is restored
     R5  closing a surface returns focus to its opener's equivalent element
         after the re-render (openers are recorded by stable data attributes)
     R1  (menus/flyouts) close on click-away as well as selection and Escape
   It hooks the render choke point (reconcile before, afterRender after) and
   the router (closeAll), so no surface carries its own copy of these rules.
   ============================================================================ */
window.EKO_SURF = (function(){
  'use strict';
  let E = null;
  const NF = () => window.EKO_NF, CTL = () => window.EKO_CTL;
  const PAGES = ['notifications', 'module-locked', 'report-preview', 'reports', 'portfolio', 'pfsite'];      /* full pages: Back + Escape-back */

  /* kinds: dialog (stack, keeps parent) | overlay | menu | flyout */
  const DEFS = [
    { id:'doc',      kind:'dialog',  isOpen:()=>!!document.getElementById('docov'),             close:()=>{ const o=document.getElementById('docov'); if(o) o.remove(); } },
    { id:'wmax',     kind:'dialog',  isOpen:()=>!!document.getElementById('wmaxov'),            close:()=>{ const o=document.getElementById('wmaxov'); if(o) o.remove(); } },
    { id:'big',      kind:'dialog',  isOpen:()=>!!(CTL()&&CTL().big&&CTL().big(E)),              close:()=>CTL().closeBig(E) },
    { id:'ctl',      kind:'dialog',  isOpen:()=>!!(CTL()&&CTL().dialog&&CTL().dialog(E)),        close:()=>CTL().closeDialog(E) },
    { id:'prefs',    kind:'dialog',  isOpen:()=>!!(NF()&&NF().st(E).prefs),                     close:()=>{ NF().st(E).prefs=false; } },
    { id:'help',     kind:'dialog',  isOpen:()=>E.state.dlg==='help',                           close:()=>{ E.state.dlg=null; } },
    { id:'teaser',   kind:'dialog',  isOpen:()=>E.state.dlg==='teaser',                         close:()=>{ E.state.dlg=null; } },
    { id:'ai',       kind:'overlay', sticky:true, isOpen:()=>!!(window.EKO_AI&&window.EKO_AI.isOpen()), close:()=>{ window.EKO_AI.close(); } },   /* D132: the conversation panel; the page stays usable beside it; sticky = navigation keeps it (R4 exception) */
    { id:'alerts',   kind:'overlay', isOpen:()=>E.state.dlg==='alerts',                         close:()=>{ E.state.dlg=null; } },
    { id:'report',   kind:'overlay', isOpen:()=>E.state.dlg==='report',                         close:()=>{ E.state.dlg=null; } },
    { id:'rpconfirm',kind:'dialog',  isOpen:()=>E.state.dlg==='rpconfirm',                      close:()=>{ E.state.dlg=null; } },
    { id:'pfcov',    kind:'dialog',  isOpen:()=>E.state.dlg==='pfcov',                          close:()=>{ E.state.dlg=null; } },
    { id:'pfcard',   kind:'overlay', isOpen:()=>!!E.state.pfCard,                               close:()=>{ E.state.pfCard=null; } },
    { id:'pal',      kind:'overlay', isOpen:()=>E.state.dlg==='pal',                            close:()=>{ E.state.dlg=null; E.state.palQ=''; E.state.palSel=0; } },
    { id:'notif',    kind:'overlay', isOpen:()=>!!(NF()&&NF().st(E).open),                      close:()=>{ NF().st(E).open=false; NF().st(E).menu=false; } },
    { id:'mkpop',    kind:'overlay', isOpen:()=>!!E.state.mkPop,                                close:()=>{ E.state.mkPop=null; E.state.mkPopN=0; } },
    { id:'asset',    kind:'overlay', isOpen:()=>!!E.state.assetSel,                             close:()=>{ E.state.assetSel=null; E.state.apWide=false; } },
    { id:'menu',     kind:'menu',    isOpen:()=>E.state.dlg==='menu',                           close:()=>{ E.state.dlg=null; E.state.rlAsk=false; } },
    { id:'switcher', kind:'menu',    isOpen:()=>E.state.dlg==='switcher',                       close:()=>{ E.state.dlg=null; } },
    { id:'display',  kind:'menu',    isOpen:()=>E.state.dlg==='display',                        close:()=>{ E.state.dlg=null; } },
    { id:'wallcfg',  kind:'dialog',  isOpen:()=>E.state.dlg==='wallcfg',                        close:()=>{ E.state.dlg=null; } },
    { id:'settings', kind:'dialog',  isOpen:()=>E.state.dlg==='settings'||E.state.dlg==='addons', close:()=>{ E.state.dlg=null; E.state.rlAsk=false; } },
    { id:'signout',  kind:'dialog',  isOpen:()=>E.state.dlg==='signout',                        close:()=>{ E.state.dlg=null; } },
    { id:'conn',     kind:'overlay', isOpen:()=>E.state.dlg==='conn',                           close:()=>{ E.state.dlg=null; } },
    { id:'more',     kind:'menu',    isOpen:()=>!!E.state.mobMore,                              close:()=>{ E.state.mobMore=false; E.state.rlAsk=false; } },
    { id:'fly',      kind:'flyout',  isOpen:()=>!!E.state.dock.bloom,                           close:()=>{ E.state.dock.bloom=null; } },
    { id:'radial',   kind:'menu',    isOpen:()=>!!E.state.radial,                               close:()=>{ E.state.radial=null; } }
  ];
  const byId = {}; DEFS.forEach(d => byId[d.id] = d);
  const openSet = () => new Set(DEFS.filter(d => { try{ return d.isOpen(); }catch(e){ return false; } }).map(d => d.id));

  let last = new Set(), order = [], lastClick = null, openers = {}, pendingFocus = null, pendingEnter = null;
  /* where each surface's first focusable control lives (D121) */
  const ROOTS = { mkpop:'.mkpop', conn:'.connpop', settings:'.dlgsettings', signout:'.dlgsignout', menu:'.accmenu', display:'.dispmenu', switcher:'.dlg[role="menu"]', more:'.dlg', notif:'.nfpanel, .nfpop', alerts:'.dlg', report:'.dlg', help:'.dlghelp', wallcfg:'.wcfg', pfcov:'.dlg', rpconfirm:'.dlg', teaser:'.dlg', ai:'#aipanel', prefs:'.dlg' };
  function enterSurface(id){
    const sel = ROOTS[id]; if(!sel) return;
    const root = [...document.querySelectorAll(sel)].find(x => x.getClientRects().length); if(!root) return;   /* fixed-positioned surfaces have no offsetParent */
    if(root.contains(document.activeElement) && document.activeElement !== root) return;   /* the surface already placed focus (an input) */
    const usable = el => !el.disabled && el.getClientRects().length && el.matches('a[href], button, input, select, textarea, [tabindex]');   /* only what focus() can actually take */
    const first = [...root.querySelectorAll('[role^="menuitem"], [role="tab"], .nfrow, input:not([type="hidden"])')].find(usable)   /* menu items and tabs first, then any control */
      || [...root.querySelectorAll('[tabindex="0"], button:not([data-act="closeDlg"]):not([data-act="nfClose"]):not([data-act="nfMenu"]), [href]')].find(usable);
    if(first){ try{ first.focus({ preventScroll:true }); }catch(e){} }
  }
  const rm = (arr, x) => { const i = arr.indexOf(x); if(i >= 0) arr.splice(i, 1); };

  /* ---- R2: called at the START of every render, before markup is built --- */
  function reconcile(){
    const now = openSet();
    const opened = [...now].filter(id => !last.has(id));
    const closed = [...last].filter(id => !now.has(id));
    if(opened.length){
      const newest = opened[opened.length - 1];
      if(byId[newest].kind !== 'dialog' && !byId[newest].sticky){
        /* one transient surface: everything else that is open closes now (a sticky companion, D132, stays).
           Levels, Layers, and Style sit over the selection card, so the card stays open behind them. */
        DEFS.forEach(d => {
          if(d.id === newest || d.sticky || !now.has(d.id)) return;
          if(newest === 'fly' && d.id === 'mkpop') return;
          d.close();
        });
      }
      opened.forEach(id => { rm(order, id); order.push(id); if(lastClick) openers[id] = lastClick; });
      pendingEnter = newest;   /* D121: a menu or popover takes focus on open so the keyboard can walk it */
    }
    closed.forEach(id => rm(order, id));
    last = openSet();
    order = order.filter(id => last.has(id));
    if(closed.length) pendingFocus = openers[closed[closed.length - 1]] || { fallback:true };
  }

  /* ---- R5: after the frame is built, focus the opener's equivalent ------- */
  const describe = el => ({ act: el.dataset.act || '', v: el.dataset.v || '', asset: el.dataset.asset || '',
                            mod: el.dataset.mod || '', k: el.dataset.k || '', id: el.id || '' });
  function noteClick(el){ if(el && el.dataset && el.dataset.act) lastClick = describe(el); }
  function noteOpener(desc){ lastClick = desc; }
  let entered = null;
  function afterRender(){
    if(pendingEnter){ const id = pendingEnter; pendingEnter = null; if(last.has(id)){ entered = id; enterSurface(id); } }
    else if(entered){ if(!last.has(entered)) entered = null; else if(!document.activeElement || document.activeElement === document.body) enterSurface(entered); }   /* a re-render replaced the focused item: put focus back */
    if(!pendingFocus) return;
    const d = pendingFocus; pendingFocus = null;
    let el = null;
    if(!d.fallback){
      const sel = d.id ? '#' + CSS.escape(d.id)
        : '[data-act="' + d.act + '"]' + (d.v ? '[data-v="' + d.v + '"]' : '') + (d.asset ? '[data-asset="' + d.asset + '"]' : '')
          + (d.mod ? '[data-mod="' + d.mod + '"]' : '') + (d.k ? '[data-k="' + d.k + '"]' : '');
      try{ el = [...document.querySelectorAll(sel)].find(x => x.getClientRects().length) || null; }catch(e){ el = null; }   /* D133: a fixed opener (the launcher) has no offsetParent but is on screen */
    }
    if(!el){ el = document.getElementById('mount'); if(el) el.tabIndex = -1; }   /* the grid */
    if(el){ try{ el.focus({ preventScroll:true }); }catch(e){} }
  }

  /* ---- R3: Escape ------------------------------------------------------- */
  function topmost(){
    const now = openSet();
    if(!now.size) return null;
    const unknown = [...now].filter(id => !order.includes(id));
    /* A dialog stays above the surface under it. The parent can be missing from the stack when it was already open at startup. */
    const fresh = unknown.filter(id => byId[id].kind === 'dialog');
    if(fresh.length) return fresh[fresh.length - 1];
    for(let i = order.length - 1; i >= 0; i--) if(byId[order[i]].kind === 'dialog' && now.has(order[i])) return order[i];
    if(unknown.length) return unknown[unknown.length - 1];
    for(let i = order.length - 1; i >= 0; i--) if(now.has(order[i])) return order[i];
    return [...now][0];
  }
  function escape(){
    const top = topmost();
    if(top){
      if(top === 'pal' && E.state.palQ){ E.state.palQ = ''; E.state.palSel = 0; E.set({}); return 'cleared'; }
      byId[top].close(); E.set({}); return top;
    }
    /* With nothing open, Escape puts the click tool down. A latched slice stays. */
    if(E.state.dock && E.state.dock.tool){
      if(E.state.dock.tool === 'measure' && E.engine && E.engine.clearMeasure) E.engine.clearMeasure();
      if(E.state.dock.tool === 'slice' && E.engine && E.engine.stopSlice) E.engine.stopSlice();
      if(E.state.dock.tool === 'select' && E.dropSelection) E.dropSelection();
      E.state.dock.tool = null; E.set({}); return 'tool'; }
    if(E.state.locFocus && E.locExit){ E.locExit(); return 'locate'; }     /* Locate-in-3D focus: a mode too */
    if(E.state.modelFs){ E.set({ modelFs:false }); return 'model'; }       /* D94: a mode, not a surface */
    if(PAGES.includes(E.state.pageId)){ back(); return 'back'; }
    if(E.state.histAge != null){ E.set({ histAge:null }); return 'live'; }   /* a mode, not a surface */
    return null;
  }
  function back(){
    if(E.state.pageId === 'notifications' && NF()){ NF().ACTS.nfBack(); return; }
    const p = E.state._prev;
    if(p && p.pageId && p.pageId !== E.state.pageId) E.go(p.pageId, p.module, p.sub);
    else E.go('marsa-overview', 'overview', null);
  }

  /* ---- R4: route change ------------------------------------------------- */
  function closeAll(){ DEFS.forEach(d => { if(d.sticky) return; try{ if(d.isOpen()) d.close(); }catch(e){} }); order = order.filter(id => byId[id] && byId[id].sticky); }

  /* ---- R1 for menus/flyouts: click-away ---------------------------------- */
  function wireClickAway(){
    document.addEventListener('pointerdown', ev => {
      const t = ev.target;
      if(!(t instanceof Element)) return;
      if(E.state.dock.bloom && !t.closest('.mzfly, #vbar, .vsheet, .vfab')){ E.state.dock.bloom = null; E.set({}); }
      else if(E.state.radial && !t.closest('.vradial')){ E.state.radial = null; E.set({}); }
    }, true);
  }

  function init(app){ E = app; last = openSet(); order = [...last]; wireClickAway(); }
  return { init, reconcile, afterRender, escape, back, closeAll, noteClick, noteOpener, topmost, openSet: () => [...openSet()], order: () => order.slice(), PAGES };
})();
