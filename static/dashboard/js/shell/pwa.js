/* ============================================================================
   PWA LAYER + NATIVE FEEL (D65) — front-end only.
   - Service worker registration, versioned shell cache, "Update available"
     toast (never swaps code under the user), install banner (Android prompt /
     iOS instructions), per-language manifest, theme-coloured status bar.
   - Connectivity: a server heartbeat drives ONE truth — online or offline.
     Offline = persistent stale banner with the time, the stale treatment on
     every value, the ribbon marked stale. The app can never look healthy
     while disconnected. Live values are NEVER cached (sw.js).
   - Native feel: scroll position per route, 200ms route transition, pull-to-
     refresh with our own indicator, keyboard-safe sheets (visualViewport),
     haptics (Vibration API; silent on iOS / unsupported).
   Nothing here runs on file:// — a served origin (HTTPS on site) is the
   deployment target; see handoff/pwa-deployment.md.
   ============================================================================ */
window.EKO_PWA = (function(){
  'use strict';
  let E = null, reg = null, waitingSW = null, deferredPrompt = null, hbTimer = null;
  /* mode: 'online' | 'offline' (no server) | 'degraded' (server up, feed down) */
  const s = { mode:'online', offline:false, offlineSince:null, degradedSince:null, sources:[], feed:null,   /* feed: the last 2xx heartbeat body's ts, feed.status and every source (D130) */
              lastOk:null, update:false, install:false, ios:false, refreshing:false, ptr:0, backOnline:false };
  const HB_MS = 15000, PTR_TRIGGER = 70, LS_DISMISS = 'eko-pwa-install-dismissed';
  const C = () => window.EKO_C;
  const esc = x => C().esc(x);
  const served = () => location.protocol !== 'file:';
  const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) ||
                      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  const mobile = () => matchMedia('(max-width: 767px)').matches;
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hhmm = d => d ? d.toTimeString().slice(0,5) : '';

  /* ------------------------------ status bar ------------------------------ */
  function themeColor(){
    const c = getComputedStyle((window.DASHBOARD_ROOT||document.documentElement)).getPropertyValue('--s1').trim();
    let m = document.querySelector('meta[name="theme-color"]');
    if(!m){ m = document.createElement('meta'); m.name = 'theme-color'; document.head.appendChild(m); }
    if(c) m.content = c;
  }
  function manifestLang(){
    const l = document.querySelector('link[rel="manifest"]');
    if(l) l.href = (window.DASHBOARD_ROOT||document.documentElement).lang === 'ar' ? 'manifest.ar.webmanifest' : 'manifest.webmanifest';
  }

  /* ----------------------------- service worker --------------------------- */
  function registerSW(){
    if(window.DASHBOARD_OVERLAY || !('serviceWorker' in navigator) || !served()) return;
    /* test harnesses (framed pages, ?nosw=1): no worker, so nothing is
       served from a shell cache and nothing reloads mid-run (D83) */
    if(window !== window.top || /(?:\?|&)nosw=1/.test(location.search)) return;
    navigator.serviceWorker.register('sw.js').then(r => {
      reg = r;
      if(r.waiting && navigator.serviceWorker.controller){ waitingSW = r.waiting; s.update = true; E.set({}); }
      r.addEventListener('updatefound', () => {
        const nw = r.installing; if(!nw) return;
        nw.addEventListener('statechange', () => {
          if(nw.state === 'installed' && navigator.serviceWorker.controller){ waitingSW = nw; s.update = true; E.set({}); }
        });
      });
    }).catch(() => {});
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if(reloading) return; reloading = true; location.reload(); });
  }

  /* ------------------------------ connectivity ---------------------------- */
  /* THE HEARTBEAT CONTRACT (handoff/data-contracts.md §heartbeat): GET the
     health URL with no-store every HB_MS; anything but a 2xx within HB_TIMEOUT
     — network error, non-2xx, hang — is OFFLINE from that moment. A 2xx whose
     feed block reports anything but healthy is DEGRADED: the platform is up
     but cannot reach the building system. One healthy 2xx is ONLINE again.
     The production feed swaps HB_URL only. ?simDegraded=1 is the test hook. */
  let HB_URL = '/static/dashboard/heartbeat.json';
  if (window.DASHBOARD_OVERLAY) HB_URL = '/api/fin/status';
  else if (window.EKO_BUILD && window.EKO_BUILD.demo && /simDegraded=1/.test(location.search)) HB_URL = '/static/dashboard/heartbeat-degraded.json';
  const HB_TIMEOUT = 8000;
  const FAIL_N = 2;           /* one stalled poll is not a drop */
  let hbMisses = 0;
  let finStamp = { ok: null, at: null };
  const BAD = { stale:1, disconnected:1, error:1, down:1 };
  function readFeed(body){
    /* -> { degraded, sources:[{id, status, since:Date|null}], since:Date|null } */
    let j = null; try{ j = JSON.parse(body); }catch(e){ return { degraded:false, sources:[], since:null, all:[], ts:null, status:null }; }
    const feed = (j && j.feed) || {};
    const src = feed.sources || {};
    /* D130: every source as reported — id, status, lastSample — nothing inferred */
    const all = Object.keys(src).map(k => ({ id:k, status:String(src[k].status || '').toLowerCase(), lastSample: src[k].lastSample || null }));
    const bad = Object.keys(src).filter(k => BAD[String(src[k].status||'').toLowerCase()])
      .map(k => ({ id:k, status:src[k].status, since: src[k].lastSample ? new Date(src[k].lastSample) : null }));
    const degraded = BAD[String(feed.status||'').toLowerCase()] === 1 || bad.length > 0;
    const times = bad.map(b => b.since).filter(Boolean);
    return { degraded, sources:bad, since: times.length ? new Date(Math.min.apply(null, times)) : null, all, ts: (j && j.ts) || null, status: feed.status || null };
  }
  async function heartbeat(){
    if(!served()) return true;
    const ctl = ('AbortController' in window) ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), HB_TIMEOUT) : null;
    try{
      const r = await fetch(HB_URL + '?ts=' + Date.now(), { cache:'no-store', signal: ctl ? ctl.signal : undefined });
      if(!r.ok) throw new Error(r.status);
      let text = await r.text();
      if(window.DASHBOARD_OVERLAY){
        let st = {};
        try { st = JSON.parse(text); } catch(e) { throw new Error('bad status'); }
        const ok = !!st.connected;
        const now = new Date().toISOString();
        if (finStamp.ok !== ok || !finStamp.at) finStamp = { ok: ok, at: now };
        text = JSON.stringify({
          ok: ok,
          ts: now,
          feed: {
            status: ok ? 'ok' : 'disconnected',
            sources: { fin: { status: ok ? 'ok' : 'disconnected', lastSample: finStamp.at } }
          }
        });
      }
      const f = readFeed(text);
      s.feed = { ts: f.ts, status: f.status, sources: f.all };   /* the last heartbeat body, for the connection popover (D130) */
      if(f.degraded){
        hbMisses += 1;
        if(hbMisses >= FAIL_N) setMode('degraded', f);
      } else {
        hbMisses = 0;
        setMode('online');
      }
      if(E && (E.state.dlg === 'conn' || (E.state.dlg === 'settings' && E.state.settingsTab === 'system'))) E.set({});
      return !f.degraded;
    }catch(e){
      hbMisses += 1;
      if(hbMisses >= FAIL_N) setMode('offline');
      return false;
    }
    finally{ if(timer) clearTimeout(timer); }
  }
  function srcLabel(id){ const k = 'src.' + id; const t = E.t(k); return t === k ? id.toUpperCase() : t; }
  function setMode(mode, info){
    const prev = s.mode;
    if(mode === 'online'){ s.lastOk = new Date(); s.offlineSince = null; s.degradedSince = null; s.sources = []; }
    else if(mode === 'offline'){ if(prev !== 'offline') s.offlineSince = new Date(); s.degradedSince = null; }
    else { if(prev !== 'degraded') s.degradedSince = (info && info.since) || new Date(); s.sources = (info && info.sources) || []; }
    s.mode = mode; s.offline = mode === 'offline';
    (window.DASHBOARD_ROOT||document.documentElement).toggleAttribute('data-offline', mode === 'offline');
    (window.DASHBOARD_ROOT||document.documentElement).toggleAttribute('data-degraded', mode === 'degraded');
    const srcTxt = s.sources.map(b => srcLabel(b.id) + (b.since ? ', ' + E.t('pwaSince', { t: hhmm(b.since) }) : '')).join(' · ');
    const changed = prev !== mode || (mode === 'degraded' && E.state.degradedSrc !== srcTxt);
    E.state.offline = mode === 'offline'; E.state.degraded = mode === 'degraded'; E.state.stale = mode !== 'online';
    E.state.offlineSince = s.offlineSince ? hhmm(s.offlineSince) : null;
    E.state.degradedSince = s.degradedSince ? hhmm(s.degradedSince) : null;
    E.state.degradedSrc = srcTxt;
    if(changed){
      if(mode === 'online' && prev !== 'online'){
        s.backOnline = true;
        (window.DASHBOARD_ROOT||document.documentElement).toggleAttribute('data-backonline', true);
        setTimeout(() => { s.backOnline = false; (window.DASHBOARD_ROOT||document.documentElement).toggleAttribute('data-backonline', false); E.set({}); }, 2500);
      }
      E.set({});
    }
  }
  function setOnline(ok){ setMode(ok ? 'online' : 'offline'); }
  /* a refresh re-asks the server; in the prototype the fixtures are the data,
     so "refreshed" means the heartbeat succeeded and the frame re-rendered */
  function refresh(){
    s.refreshing = true; E.set({});
    heartbeat().then(() => setTimeout(() => { s.refreshing = false; E.set({}); }, 500));
  }

  /* ------------------------------ install banner -------------------------- */
  function installEligible(){
    return mobile() && !standalone() && !localStorage.getItem(LS_DISMISS) && (deferredPrompt || isIOS());
  }
  function wireInstall(){
    window.addEventListener('beforeinstallprompt', ev => { ev.preventDefault(); deferredPrompt = ev; s.install = installEligible(); E.set({}); });
    window.addEventListener('appinstalled', () => { deferredPrompt = null; s.install = false; E.set({}); });
    s.ios = isIOS(); s.install = installEligible();
  }

  /* ------------------------------ native feel ----------------------------- */
  const scrollPos = {};
  function wrapGo(){
    const go0 = E.go;
    E.go = function(p, m, sub){
      scrollPos[E.state.pageId] = window.scrollY;
      go0.call(E, p, m, sub);
      const mount = document.getElementById('mount');
      if(mount && !reduced()){ mount.classList.remove('routein'); void mount.offsetWidth; mount.classList.add('routein'); }
      const y = scrollPos[p] || 0;
      setTimeout(() => window.scrollTo(0, y), 0);
    };
  }
  function wirePTR(){
    let startY = null, active = false;
    document.addEventListener('touchstart', ev => {
      if(!mobile() || window.scrollY > 0 || ev.target.closest('.dlg,#assetpanel,.nfpanel,.regscroll,#enginehost')) { startY = null; return; }
      startY = ev.touches[0].clientY; active = false;
    }, { passive:true });
    document.addEventListener('touchmove', ev => {
      if(startY == null) return;
      const dy = ev.touches[0].clientY - startY;
      if(dy > 8 && window.scrollY === 0){ active = true; s.ptr = Math.min(90, dy); paintPTR(); }
    }, { passive:true });
    document.addEventListener('touchend', () => {
      if(active && s.ptr >= PTR_TRIGGER){ if(navigator.vibrate && !isIOS()) haptic('snap'); refresh(); }
      s.ptr = 0; active = false; startY = null; paintPTR();
    });
  }
  function paintPTR(){
    const el = document.querySelector('.pwaptr'); if(!el) return;
    el.style.transform = 'translate(-50%,' + (s.ptr - 48).toFixed(0) + 'px)';   /* computed position */
    el.style.opacity = Math.min(1, s.ptr / PTR_TRIGGER).toFixed(2);
    el.toggleAttribute('data-armed', s.ptr >= PTR_TRIGGER);
  }
  function wireKeyboard(){
    const vv = window.visualViewport;
    const apply = () => (window.DASHBOARD_ROOT||document.documentElement).style.setProperty('--vvh', Math.round(vv ? vv.height : window.innerHeight) + 'px');
    if(vv){ vv.addEventListener('resize', apply); }
    window.addEventListener('resize', apply); apply();
    document.addEventListener('focusin', ev => {
      const el = ev.target;
      if(!(el instanceof HTMLElement) || !/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      if(!el.closest('.dlg,#assetpanel,.nfpanel,#aipanel')) return;
      setTimeout(() => { try{ el.scrollIntoView({ block:'center', behavior: reduced() ? 'auto' : 'smooth' }); }catch(e){} }, 250);
    });
  }
  function haptic(kind){
    if(isIOS() || !navigator.vibrate) return;               /* silent where unsupported */
    const pat = { ack:[15], unlock:[10,40,20], snap:[8] }[kind] || [10];
    try{ navigator.vibrate(pat); }catch(e){}
  }

  /* ------------------------------ overlays -------------------------------- */
  function overlays(E){
    const t = E.t.bind(E), icon = C().icon;
    let out = '';
    requestAnimationFrame(() => { const b = document.querySelector('.pwastale:not(.pwaok)'); (window.DASHBOARD_ROOT||document.documentElement).style.setProperty('--staleBand', b ? Math.max(32, Math.ceil(b.getBoundingClientRect().height)) + 'px' : '32px'); });   /* D121: the band follows the banner */
    if(s.mode === 'offline') out += `<div class="pwastale" role="status">${icon('clock',13,2)}<span>${esc(t('pwaOffline',{t:E.state.offlineSince||''}))}</span></div>`;
    else if(s.mode === 'degraded') out += `<div class="pwastale pwadeg" role="status">${icon('tools',13,2)}<span>${esc(t('pwaDegraded',{t:E.state.degradedSince||'', src:E.state.degradedSrc||''}))}</span></div>`;
    else if(s.backOnline) out += `<div class="pwastale pwaok" role="status">${icon('check',13,2)}<span>${esc(t('pwaBackOnline'))}</span></div>`;
    if(s.install) out += `<div class="pwabanner" role="dialog" aria-label="${esc(t('pwaInstallT'))}">
      <img class="pwabrand" src="${esc((E.data.brand&&E.data.brand.logo&&E.data.brand.logo.mono)||'')}" alt="">
      <div class="col grow minw0"><b>${esc(t('pwaInstallT'))}</b><span>${esc(s.ios || !deferredPrompt ? t('pwaInstallIos') : t('pwaInstallB'))}</span></div>
      ${deferredPrompt ? `<button class="btnP btnSm" data-act="pwaInstall">${esc(t('pwaInstallBtn'))}</button>` : ''}
      <button class="iconbtn icon26" data-act="pwaDismiss" aria-label="${esc(t('pwaLater'))}">${icon('x',12)}</button></div>`;
    if(s.update) out += `<div class="pwaupdate" role="status"><span>${esc(t('pwaUpdate'))}</span><button class="btnP btnSm" data-act="pwaReload">${esc(t('pwaReload'))}</button></div>`;
    if(mobile()) out += `<div class="pwaptr" aria-hidden="true"><span class="pwaspin"></span>${esc(s.refreshing ? t('pwaRefreshing') : t('pwaPull'))}</div>`;
    if(s.refreshing) out += `<div class="pwarefresh" role="status"><span class="pwaspin"></span>${esc(t('pwaRefreshing'))}</div>`;
    return out;
  }
  const ACTS = {
    pwaInstall(){ if(!deferredPrompt) return; deferredPrompt.prompt();
      deferredPrompt.userChoice.then(() => { deferredPrompt = null; s.install = false; E.set({}); }); },
    pwaDismiss(){ try{ localStorage.setItem(LS_DISMISS, '1'); }catch(e){} s.install = false; E.set({}); },
    pwaReload(){ if(waitingSW) waitingSW.postMessage('SKIP_WAITING'); else location.reload(); },
    pwaRefresh(){ refresh(); },
    pwaRetry(){ location.reload(); }
  };

  /* Cold start with no data (offline before the shell ever fetched the
     fixtures): render the honest empty state — never a number. */
  function coldOffline(){
    const lang = (localStorage.getItem('eko-lang') || 'en');
    const T = (window.EKO_I18N && window.EKO_I18N[lang]) || {};
    const t = k => T[k] || k;
    (window.DASHBOARD_ROOT||document.documentElement).lang = lang; (window.DASHBOARD_ROOT||document.documentElement).dir = lang === 'ar' ? 'rtl' : 'ltr';
    (window.DASHBOARD_ROOT||document.documentElement).setAttribute('data-offline', '');
    const brand = '/static/dashboard/assets/brand/eko-logo-dark.svg';
    document.getElementById('topbar').innerHTML = `<a class="brandslot" aria-label="EKO"><img class="brandimg" data-on="dark" src="${brand}" alt="" style="display:block"></a>
      <div id="alarmribbon" data-tone="unknown" role="status"><span class="ribseg ribzero">${t('pwaNoData')}</span></div>`;
    document.getElementById('mount').innerHTML = `<div class="pwacold"><div class="pwacoldbox">
      <b>${t('pwaColdT')}</b><span>${t('pwaCold')}</span>
      <button class="btnP" onclick="location.reload()">${t('pwaRetry')}</button></div></div>`;
  }

  function init(app){
    E = app;
    themeColor(); manifestLang();
    new MutationObserver(() => { themeColor(); manifestLang(); })
      .observe((window.DASHBOARD_ROOT||document.documentElement), { attributes:true, attributeFilter:['data-theme','lang'] });
    registerSW(); wireInstall(); wrapGo(); wirePTR(); wireKeyboard();
    if(served()){
      window.addEventListener('online', heartbeat);
      window.addEventListener('offline', () => setOnline(false));
      heartbeat(); hbTimer = setInterval(heartbeat, HB_MS);
    }
  }
  /* D130: what the connection popover renders — only fields the heartbeat contract defines */
  const feed = () => ({ served: served(), mode: s.mode, offlineSince: s.offlineSince, degradedSince: s.degradedSince, ts: s.feed ? s.feed.ts : null, status: s.feed ? s.feed.status : null, sources: s.feed ? s.feed.sources.slice() : [], hbMs: HB_MS, timeoutMs: HB_TIMEOUT });
  function stop(){ if(hbTimer){ clearInterval(hbTimer); hbTimer=null; } }
  return { init, stop, overlays, ACTS, haptic, refresh, heartbeat, coldOffline, state: s, feed,
           /* test hooks */ _setOnline: setOnline, _setMode: setMode, _setHb: u => { HB_URL = u; } };
})();
