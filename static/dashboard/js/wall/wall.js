/* ============================================================================
   CONTROL ROOM DISPLAY (D106 · D108 · D109) — the wall. A display CONTEXT,
   not a role and not a simplified app: non-interactive, always-on, legible
   from across the room.

   Structure: three permanent zones and one rotating region.
     · ALARM ZONE (start side, ~30%): severity counts, the unacknowledged
       count and the oldest unacknowledged age as NUMBERS (never charts), the
       alarm performance band (ISA-18.2 / EEMUA 191 figures against configured
       targets), the active alarm list (as many rows as fit), what is not
       reporting. Never rotates — ISA-101 keeps alarm status visible.
     · VITALS STRIP: energy, water, gas, the headline; each with today's curve
       beneath the number in the domain hue.
     · OPS STRIP: the shift band and the watch strip.
     · MAIN REGION: the only rotating area, mostly charts — consumption today
       against baseline, the 24-hour alarm-rate strip, work orders by state,
       the model; on an estate wall the status board. Its own progress bar.
     · FOOTER: name, data as of, connection, rotation position, exit hint.
   Laws
     · nothing here is clickable; no tooltips, no hover, no scrollbars, no
       ellipsis, no collision: when a zone cannot hold everything it shows
       FEWER WHOLE ELEMENTS (rows, lines, tiles' extras), in a stated order
     · type derives from the viewing distance AND the panel: the 16-arc-minute
       floor in millimetres divided by the panel's pixel pitch (D109); a scale
       multiplier may enlarge, never go below the floor
     · dark, low-saturation; colour only for alarm state and the stale
       treatment; the large numbers are one neutral tone
     · every metric states its window and, where configured, its target and
       the target's source; no target configured, no target shown
     · rotation is wall-clock based, the position survives a reload, the
       layout drifts a few pixels on a slow cycle against burn-in
     · Escape exits; any key or click raises the exit hint for five seconds
   Settings: data.wall defaults ← per-display settings saved from the
   workstation's "Control room settings" dialog (localStorage, keyed by the
   display id) ← URL overrides (id, distance, dwell, brightness, motion,
   shifts, scale, panel, panelIn).
   ============================================================================ */
window.EKO_WALL = (function(){
  'use strict';
  const C = () => window.EKO_C, V = () => window.EKO_V, EST = () => window.EKO_EST, PWA = () => window.EKO_PWA, PF = () => window.EKO_PF, R = () => window.EKO_ROLLUP;
  const esc = s => C().esc(s);
  const SEVR = { critical: 0, high: 1, medium: 2 };
  const truncDec = (n, d) => {
    const x = Number(n); if (!isFinite(x)) return 0;
    if (d <= 0) return Math.trunc(x + (x < 0 ? -1e-9 : 1e-9));
    const f = Math.pow(10, d);
    return Math.trunc(x * f + (x < 0 ? -1e-9 : 1e-9)) / f;
  };
  const fmtW = (n, d) => {
    const dd = d == null ? 0 : d;
    const t = truncDec(n || 0, dd);
    return t.toLocaleString('en-GB', { minimumFractionDigits: dd, maximumFractionDigits: dd });
  };
  const dashW = (n, d) => (n == null || n === '' || !isFinite(+n)) ? '--' : fmtW(n, d);
  const hhmm = d => String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  const toMin = s => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim()); return m ? (+m[1]) * 60 + (+m[2]) : null; };
  let E = null, timer = null, lastCounts = null, changedAt = 0, changedKeys = [], epoch = 0, shiftIdx = 0, hotTimer = null, listenersOn = false, boardFit = null, shownPane = null;

  /* ------------------------------ settings -------------------------------- */
  /* Targets and their sources live in config so the client's alarm philosophy governs; the defaults are the published guidance. */
  const TARGETS = {
    standingHours: 24, standingTarget: 10, standingSource: 'EEMUA 191',
    rateWindowMin: 60, rateTargetPer10Min: 1, rateSource: 'EEMUA 191',
    floodPer10Min: 10, floodSource: 'ISA-18.2',
    priorityRef: [5, 15, 80], prioritySource: 'EEMUA 191'
  };
  /* the centre rotates only what the config lists; a site wall holds the model alone by default (one pane of glass), an estate wall the map and the board */
  const SITE_PANES = ['model', 'trend', 'rate', 'work'], ESTATE_PANES = ['map', 'board', 'model'];
  const ALL_PANES = ['model', 'map', 'board', 'trend', 'rate', 'work'];
  const KEY = id => 'eko-wall-cfg-' + (id || 'default');
  function defaults(app){
    const d = (app || E).data.wall || {};
    return { viewingDistance: d.viewingDistance || 6, panelIn: (d.panel && d.panel.diagonalIn) || 98, panelW: (d.panel && d.panel.w) || null, panelH: (d.panel && d.panel.h) || null,
      scale: d.scale || 1, wallBrightness: d.wallBrightness || 100, dwellMain: (d.dwell && d.dwell.main) || 30, dwellModel: (d.dwell && d.dwell.model) || 40,
      theme: d.theme || 'dark', lock: !!d.lock,
      panes: (d.panes || ALL_PANES).filter(p => !(d.disabled || []).includes(p)) };
  }
  function loadSaved(id){ try{ return JSON.parse(localStorage.getItem(KEY(id)) || 'null') || {}; }catch(e){ return {}; } }
  /* the merged settings for one display: defaults ← saved */
  function settingsFor(app, id){ const base = defaults(app), s = loadSaved(id); const out = Object.assign({}, base); Object.keys(base).forEach(k => { if(s[k] != null) out[k] = s[k]; }); out.id = id || 'default'; out.saved = Object.keys(s).length > 0; return out; }
  function saveSettings(id, patch){ const s = Object.assign(loadSaved(id), patch); try{ localStorage.setItem(KEY(id), JSON.stringify(s)); }catch(e){} return s; }
  function resetSettings(id){ try{ localStorage.removeItem(KEY(id)); }catch(e){} }
  function cfg(){
    const d = E.data.wall || {}, o = E.state.wallOpt || {};
    const s = settingsFor(E, o.id || 'default');
    const base = Object.assign({ shiftPx: 6, shiftEverySec: 90, topAlarms: 8, hintSec: 5 }, d, s);
    base.alarmTargets = Object.assign({}, TARGETS, d.alarmTargets || {});
    base.watch = Object.assign({ autonomyDays: 3, trendWindowH: 24 }, d.watch || {});
    base.shifts = d.shifts && Array.isArray(d.shifts.starts) && d.shifts.starts.length ? d.shifts : null;
    if(o.distance) base.viewingDistance = +o.distance;
    if(o.brightness) base.wallBrightness = +o.brightness;
    if(o.scale) base.scale = +o.scale;
    if(o.panel){ const m = /^(\d+)x(\d+)$/.exec(o.panel); if(m){ base.panelW = +m[1]; base.panelH = +m[2]; } }
    if(o.panelIn) base.panelIn = +o.panelIn;
    if(o.dwell){ base.dwellMain = +o.dwell; base.dwellModel = +o.dwell; }
    if(o.shifts === 'none') base.shifts = null;
    if(o.theme === 'light' || o.theme === 'dark' || o.theme === 'auto') base.theme = o.theme;
    if(o.lock === '1') base.lock = true; if(o.lock === '0') base.lock = false;
    base.dwell = { main: base.dwellMain, model: base.dwellModel };
    base.reduceMotion = o.motion === 'reduce' || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
    base.scope = o.scope || (E.landing().pageId === 'portfolio' ? 'estate' : 'site');
    const known = base.scope === 'estate' ? ESTATE_PANES : SITE_PANES;
    base.list = known.filter(p => (base.panes || known).includes(p));
    if(!base.list.length) base.list = known;
    return base;
  }
  /* 16-arc-minute floor (D109 physics): the floor in millimetres is distance × 2·tan(8′); the panel's pixel pitch turns it
     into pixels. Calibrated to the client's reference: 74px body at 9 m on a 98-inch 4K panel. A scale multiplier may
     enlarge; the floor is never undercut. */
  const ARC16 = 2 * Math.tan((8 / 60) * Math.PI / 180);
  function ladderFor(s, w, h){
    const W = s.panelW || w || 3840, H = s.panelH || h || 2160;
    const pitchM = ((s.panelIn || 98) * 0.0254) / Math.hypot(W, H);
    const floorPx = (s.viewingDistance || 6) * ARC16 / pitchM;
    /* D111: the scale runs both ways at the client's instruction; the floor is stated, not enforced (belowFloor) */
    const body = Math.max(12, Math.round(floorPx * (s.scale || 1)));
    return { body, floor: Math.round(floorPx), belowFloor: body < Math.round(floorPx), label: body, num2: Math.round(body * 1.6), num1: Math.round(body * 2.4), line: Math.round(body * 1.15), glyph: Math.round(body * 0.9), val: Math.round(body * 1.2), lines: Math.floor(H / (body * 1.2)), panelW: W, panelH: H };
  }
  const ladder = d => ladderFor(Object.assign({}, E ? defaults(E) : { panelIn: 98, scale: 1 }, { viewingDistance: d }), 3840, 2160);   /* legacy signature: the reference 4K panel */

  /* ------------------------------ rotation (main region only) -------------- */
  const dwellOf = (c, pane) => ((pane === 'model' || pane === 'map') ? c.dwell.model : c.dwell.main) * 1000;
  function paneAt(now){
    const c = cfg(); const total = c.list.reduce((a, p) => a + dwellOf(c, p), 0); if(!c.list.length) return { idx: 0, pane: null, frac: 0, n: 0 };
    let t = ((now - epoch) % total + total) % total, idx = 0;
    for(; idx < c.list.length; idx++){ const dw = dwellOf(c, c.list[idx]); if(t < dw) return { idx, pane: c.list[idx], frac: t / dw, n: c.list.length, dwell: dw / 1000 }; t -= dw; }
    return { idx: 0, pane: c.list[0], frac: 0, n: c.list.length, dwell: dwellOf(c, c.list[0]) / 1000 };
  }
  function tick(){
    if(!E || !E.state.wall) return;
    const now = Date.now(), p = paneAt(now);
    const pageNow = p.pane === 'board' ? boardPage(p) : 0;
    if(p.idx !== E.state.wallIdx || pageNow !== (E.state.wallPage || 0)){ E.state.wallIdx = p.idx; E.state.wallPage = pageNow; try{ sessionStorage.setItem('eko-wall-idx', String(p.idx)); }catch(e){} E.set({ born: 'wall' }); }
    else { const bar = document.querySelector('.wmain .wprog > span'); if(bar) bar.style.width = (p.frac * 100).toFixed(1) + '%'; }
  }
  const SHIFTS = [[0, 0], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1]];
  function applyShift(){ const w = document.querySelector('.wall'); if(w) w.style.transform = ''; }
  function start(app){
    E = app;
    try{ epoch = +(sessionStorage.getItem('eko-wall-epoch') || 0); }catch(e){ epoch = 0; }
    if(!epoch){ epoch = Date.now(); try{ sessionStorage.setItem('eko-wall-epoch', String(epoch)); }catch(e){} }
    E.state.wallIdx = paneAt(Date.now()).idx; E.state.wallPage = 0;
    if(timer) clearInterval(timer);
    timer = setInterval(tick, 500);
    if(!listenersOn){
      listenersOn = true;
      document.addEventListener('visibilitychange', () => { if(document.visibilityState === 'visible') tick(); });
      document.addEventListener('pointerdown', () => { if(E && E.state.wall) hot(); }, true);   /* a click only raises the exit hint */
      window.addEventListener('resize', () => { if(E && E.state.wall){ boardFit = null; E.set({ born: 'wall' }); } });
    }
  }
  const goto = idx => { const c = cfg(); let t = 0; for(let i = 0; i < idx; i++) t += dwellOf(c, c.list[i]); epoch = Date.now() - t; try{ sessionStorage.setItem('eko-wall-epoch', String(epoch)); }catch(e){} tick(); };

  /* ------------------------------ the exit -------------------------------- */
  const WALL_PARAMS = ['display', 'scope', 'via', 'dwell', 'distance', 'brightness', 'motion', 'shifts', 'scale', 'panel', 'panelIn', 'id'];
  function exitUrl(open){ const u = new URL(location.href); WALL_PARAMS.concat(['open', 'theme', 'lock']).forEach(k => u.searchParams.delete(k)); if(cfg().scope === 'estate') u.searchParams.set('page', 'portfolio'); else u.searchParams.delete('page'); if(open) u.searchParams.set('open', open); return u.toString(); }
  function exit(open){
    const url = exitUrl(open), viaTab = !!(E.state.wallOpt || {}).viaTab && !open;
    if(window.__wallExitHook){ window.__wallExitHook({ url, viaTab }); return; }
    if(viaTab){ try{ window.close(); }catch(e){} setTimeout(() => { if(!window.closed) location.assign(url); }, 300); }
    else location.assign(url);
  }
  function onKey(ev){
    if(!E || !E.state.wall) return false;
    if(ev.key === 'Escape'){ ev.preventDefault(); if(E.state.wallCfgOpen){ E.set({ wallCfgOpen: false }); return true; } if(cfg().lock){ hot(); return true; } exit(); return true; }
    if(ev.ctrlKey && ev.shiftKey && (ev.key === 'L' || ev.key === 'l')){ ev.preventDefault(); ACTS.wallLock(); return true; }
    hot(); return true;
  }
  /* D111: the wall is interactive — a gear opens its settings, an exit button leaves, a lock hides both (Ctrl+Shift+L toggles it) */
  const ACTS = {
    wallGear(){ E.set({ wallCfgOpen: !E.state.wallCfgOpen }); },
    wallClose(){ E.set({ wallCfgOpen: false }); },
    wallExit(){ exit(); },
    wallLock(){ const id = (E.state.wallOpt || {}).id || 'default'; saveSettings(id, { lock: !cfg().lock }); E.set({ wallCfgOpen: false }); },
    wallOpenAsset(el){ exit('asset:' + el.dataset.asset); },
    wallOpenSite(el){ exit('site:' + el.dataset.site); },
    wallSet(el){
      const id = (E.state.wallOpt || {}).id || 'default', k = el.dataset.k, patch = {};
      if(k === 'pane'){ const s = settingsFor(E, id), set = new Set(s.panes); if(el.checked) set.add(el.value); else set.delete(el.value); patch.panes = ALL_PANES.filter(p => set.has(p)); }
      else if(k === 'theme') patch.theme = el.dataset.v;
      else { const n = parseFloat(el.value); if(!isFinite(n)) return; patch[k] = n; }
      saveSettings(id, patch); boardFit = null; E.set({});
    }
  };
  function applyWallTheme(){
    const th = cfg().theme, light = th === 'light' || (th === 'auto' && window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches);
    if(light) (window.DASHBOARD_ROOT||document.documentElement).dataset.theme = 'light'; else (window.DASHBOARD_ROOT||document.documentElement).removeAttribute('data-theme');
  }
  function hot(){
    const h = document.querySelector('.wesc'); if(!h) return;
    h.dataset.hot = '1'; if(hotTimer) clearTimeout(hotTimer);
    hotTimer = setTimeout(() => { const el = document.querySelector('.wesc'); if(el) el.dataset.hot = '0'; }, cfg().hintSec * 1000);
  }

  /* ------------------------------ facts ----------------------------------- */
  function facts(){
    const c = cfg(), t = E.t.bind(E), ar = E.lang === 'ar';
    if(c.scope === 'estate'){
      const h = EST().header(E), sites = EST().sites(E), list = EST().ribbonList(E);
      const sev = { critical: 0, high: 0, medium: 0 }; list.forEach(a => sev[a.sev]++);
      return { scope: 'estate', name: t('pfTitle'), sev, unacked: h.unacked.value || 0, unknownLive: (h.unacked.unknownLive || []).length, notReporting: h.reporting.notReporting.length, states: h.reporting, sitesTotal: h.sitesTotal, sites,
        topSites: sites.slice().sort((a, b) => a.sevRank - b.sevRank || b.alarmCount - a.alarmCount).filter(s => s.alarmCount > 0),
        header: h, asOf: hhmm(new Date()), state: h.reporting.notReporting.length ? 'partial' : 'reporting' };
    }
    const al = E.data.alarms, sev = { critical: 0, high: 0, medium: 0 }; al.forEach(a => sev[a.sev]++);
    const site = window.EKO_DATA.portfolio.find(p => p.key === 'marsa') || {};
    const st = (PWA() && PWA().state.mode) || 'online';
    return { scope: 'site', name: ar ? site.nameAr : site.nameEn, sev, unacked: al.filter(a => !a.ack).length, state: st === 'online' ? 'reporting' : st,
      staleAssets: E.data.assets.filter(a => a.st === 'stale').length, connected: E.data.assets.length, registerTotal: E.data.registerTotal,
      topAlarms: al.slice().sort((a, b) => SEVR[a.sev] - SEVR[b.sev] || b.ageH - a.ageH), asOf: (E.data.basis && E.data.basis.asOf) || hhmm(new Date()) };
  }

  /* ------------------------------ metrics --------------------------------- */
  function metrics(f){
    const c = cfg(), T = c.alarmTargets, t = E.t.bind(E), now = new Date();
    const m = { unacked: f.unacked, oldestH: null, standing: null, rate: null, flood: null, dist: null, shift: null, watch: [], rate24: null };
    const total = f.sev.critical + f.sev.high + f.sev.medium;
    const pct = n => total ? Math.round(n / total * 100) : 0;
    m.dist = { pct: { critical: pct(f.sev.critical), high: pct(f.sev.high), medium: pct(f.sev.medium) }, ref: T.priorityRef, source: T.prioritySource, total, incomplete: null };
    if(f.scope === 'site'){
      const al = E.data.alarms, un = al.filter(a => !a.ack);
      m.oldestH = un.length ? Math.max.apply(null, un.map(a => a.ageH || 0)) : null;
      m.standing = { n: al.filter(a => (a.ageH || 0) >= T.standingHours).length, hours: T.standingHours, target: T.standingTarget, source: T.standingSource };
      const inWindow = al.filter(a => (a.ageH || 0) * 60 <= T.rateWindowMin).length;
      m.rate = { n: inWindow, per10: inWindow / (T.rateWindowMin / 10), windowMin: T.rateWindowMin, target: T.rateTargetPer10Min, source: T.rateSource, incomplete: null };
      const in10 = al.filter(a => (a.ageH || 0) * 60 <= 10).length;
      m.flood = { on: in10 > T.floodPer10Min, n: in10, limit: T.floodPer10Min, source: T.floodSource };
      const hist24 = E.data.alarmHistory && Array.isArray(E.data.alarmHistory.last24) ? E.data.alarmHistory.last24 : null;
      const bins = hist24 && hist24.length === 24 ? hist24.slice() : Array(24).fill(0);
      if (!hist24) al.forEach(a => { const h = a.ageH || 0; if(h < 24) bins[23 - Math.floor(h)]++; });
      m.rate24 = { bins, targetPerHour: T.rateTargetPer10Min * 6, source: T.rateSource, incomplete: null };
      if(f.state !== 'reporting'){ const why = t('wall.incompleteFeed', { state: t('pfRep.' + f.state) }); m.rate.incomplete = why; m.dist.incomplete = why; m.rate24.incomplete = why; }
      let startMin, label, sinceMidnight = false;
      const nowMin = now.getHours() * 60 + now.getMinutes();
      if(c.shifts){
        const starts = c.shifts.starts.map(toMin).filter(x => x != null).sort((a, b) => a - b);
        let i = -1; starts.forEach((s, k) => { if(s <= nowMin) i = k; });
        const s = i >= 0 ? starts[i] : starts[starts.length - 1], next = starts[(i >= 0 ? i + 1 : 0) % starts.length];
        startMin = s; const hm = x => String(Math.floor(x / 60)).padStart(2, '0') + ':' + String(x % 60).padStart(2, '0');
        label = t('wall.shift', { a: hm(s), b: hm(next) });
        m.shiftStartedYesterday = i < 0;
      } else { startMin = 0; label = t('wall.sinceMidnight'); sinceMidnight = true; }
      const hoursSince = m.shiftStartedYesterday ? (nowMin + (1440 - startMin)) / 60 : (nowMin - startMin) / 60;
      const acked = al.filter(a => a.ack && a.ack.time && (m.shiftStartedYesterday || (toMin(a.ack.time) != null && toMin(a.ack.time) >= startMin))).length;
      const todayStamp = s => {
        if (!s) return false;
        const nowD = new Date();
        const md = String(s).match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
        if (md) {
          let y = +md[3]; if (y < 100) y += 2000;
          return +md[1] === nowD.getMonth() + 1 && +md[2] === nowD.getDate() && y === nowD.getFullYear();
        }
        const iso = String(s).slice(0, 10);
        const ymd = nowD.getFullYear() + '-' + String(nowD.getMonth() + 1).padStart(2, '0') + '-' + String(nowD.getDate()).padStart(2, '0');
        return iso === ymd;
      };
      const woAll = E.data.assets.flatMap(a => a.workOrders || []);
      m.shift = { label, sinceMidnight, hoursSince, raised: al.filter(a => (a.ageH || 0) <= hoursSince).length, acked, woCreated: woAll.filter(o => todayStamp(o.created || o.startDate)).length, woClosed: woAll.filter(o => todayStamp(o.endDate)).length, woBasis: t('wall.shWoBasis') };
      const livePeak = E.data.metrics && E.data.metrics.peakTodayKw;
      const p = (E.data.power || {}).subview;
      if(livePeak && p && p.limitKw) m.watch.push({ key: 'peak', tone: livePeak / p.limitKw >= 0.9 ? 'warn' : 'ok', text: t('wall.w.peak', { kw: fmtW(livePeak, 1), pct: fmtW(livePeak / p.limitKw * 100), limit: fmtW(p.limitKw, 0) }), basis: t('wall.wb.peak') });
      const trending = E.data.assets.filter(a => a.st === 'alarm' && a.trend7 && a.trend7.vals && a.trend7.vals.length >= 3).filter(a => { const v = a.trend7.vals, d = v[v.length - 1] - v[v.length - 2], w = v[v.length - 1] - v[0]; return d !== 0 && Math.sign(d) === Math.sign(w); });
      if(trending.length) m.watch.push({ key: 'trend', tone: 'warn', text: t('wall.w.trend', { n: fmtW(trending.length), list: trending.map(a => a.id).join(', ') }), basis: t('wall.wb.trend', { h: fmtW(c.watch.trendWindowH) }) });
      const w = E.data.water;
      if(w && w.tankCapacityM3 && w.tankVolumeM3 != null && w.refillThresholdPct != null && w.meterAvgM3Day){
        const pctT = Math.round(w.tankVolumeM3 / w.tankCapacityM3 * 100), days = w.tankVolumeM3 / w.meterAvgM3Day;
        if(pctT <= w.refillThresholdPct || days <= c.watch.autonomyDays) m.watch.push({ key: 'water', tone: pctT <= w.refillThresholdPct ? 'warn' : 'ok', text: t('wall.w.water', { pct: fmtW(pctT), d: fmtW(days, 1), th: fmtW(w.refillThresholdPct) }), basis: t('wall.wb.water') });
      }
      const down = (E.data.meters || []).filter(x => x.live && (x.quality === 'offline' || x.quality === 'intermittent'));
      if(down.length) m.watch.push({ key: 'meters', tone: 'warn', text: t('wall.w.meters', { n: fmtW(down.length), age: E.fmtAge(Math.max.apply(null, down.map(x => (x.receivedMin || 0) / 60))) }), basis: t('wall.wb.meters') });
      const stale = E.data.assets.filter(a => a.st === 'stale');
      if(stale.length) m.watch.push({ key: 'stale', tone: 'warn', text: t('wall.w.stale', { n: fmtW(stale.length), age: E.fmtAge(Math.max.apply(null, stale.map(a => a.staleH || 0))) }), basis: t('wall.wb.stale') });
      if(E.data.pm && E.data.pm.dueWithin7 != null) m.watch.push({ key: 'pm', tone: E.data.pm.overdue ? 'warn' : 'ok', text: t('wall.w.pm', { d: fmtW(E.data.pm.dueWithin7), o: fmtW(E.data.pm.overdue || 0) }), basis: t('wall.wb.pm') });
      return m;
    }
    m.unknownLive = f.unknownLive;
    if(f.notReporting) m.dist.incomplete = t('wall.incompleteSites', { n: fmtW(f.notReporting) });
    m.shift = { label: c.shifts ? t('wall.shiftEstate') : t('wall.sinceMidnight'), sinceMidnight: !c.shifts, notInFeed: true };
    f.sites.filter(s => !s.telemetry).forEach(s => m.watch.push({ key: 'notrep:' + s.id, tone: 'warn', text: t('wall.w.notRep', { site: E.lang === 'ar' ? s.nameAr : s.nameEn, state: t('pfRep.' + s.state), age: s.hbAgoMin != null ? E.fmtAge(s.hbAgoMin / 60) : t('pfNever') }), basis: t('wall.wb.notRep') }));
    const od = f.header.overdue; if(od && od.value) m.watch.push({ key: 'overdue', tone: 'warn', text: t('wall.w.overdue', { n: fmtW(od.value), s: fmtW(od.sitesIncluded) }), basis: t('wall.wb.overdue') });
    return m;
  }

  /* ------------------------------ chart helpers --------------------------- */
  /* Every chart is inline SVG in the neutral tones; hue only where the data carries a domain hue (sparklines) or alarm state. */
  const spark = (vals, hue, compare) => {
    const id = 'wg' + String(hue || 'n').replace(/[^a-z0-9]/gi, '');
    const finite = a => (a || []).filter(x => x != null && isFinite(+x));
    if(compare && compare.length){
      const both = finite(vals).concat(finite(compare)).map(Number);
      if(both.length < 2) return '';
      const max = Math.max(0, ...both), min = Math.min(0, ...both), span = (max - min) || 1;
      const n = Math.max((vals || []).length, compare.length, 2);
      const segs = arr => {
        const out = []; let cur = [];
        for(let i = 0; i < n; i++){
          const x = arr[i];
          if(x == null || !isFinite(+x)){ if(cur.length >= 2) out.push(cur); cur = []; continue; }
          cur.push(`${(i / (n - 1) * 100).toFixed(1)},${(26 - ((+x) - min) / span * 22).toFixed(1)}`);
        }
        if(cur.length >= 2) out.push(cur);
        return out;
      };
      const yest = segs(compare).map(p => `<polyline points="${p.join(' ')}" fill="none" stroke="${esc(hue || 'currentColor')}" stroke-width="1.5" stroke-dasharray="3 2" opacity="0.45" vector-effect="non-scaling-stroke"/>`).join('');
      const today = segs(vals || []).map(p => `<polyline points="${p.join(' ')}" fill="none" stroke="${esc(hue || 'currentColor')}" stroke-width="2.5" vector-effect="non-scaling-stroke"/>`).join('');
      return `<svg class="wspark" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true">${yest}${today}</svg>`;
    }
    const v = finite(vals); if(v.length < 2) return ''; const max = Math.max.apply(null, v), min = Math.min.apply(null, v), span = (max - min) || 1;
    const pts = v.map((x, i) => `${(i / (v.length - 1) * 100).toFixed(1)},${(26 - (x - min) / span * 22).toFixed(1)}`);
    return `<svg class="wspark" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${esc(hue || '#93A1B8')}" stop-opacity=".45"/><stop offset="1" stop-color="${esc(hue || '#93A1B8')}" stop-opacity="0"/></linearGradient></defs><polygon points="0,28 ${pts.join(' ')} 100,28" fill="url(#${id})"/><polyline points="${pts.join(' ')}" fill="none" stroke="${esc(hue || 'currentColor')}" stroke-width="2.5" vector-effect="non-scaling-stroke"/></svg>`;
  };
  const ring = (pct, tone) => { const p = Math.max(0, Math.min(100, pct || 0)), r = 42, c = 2 * Math.PI * r;
    return `<svg class="wring" viewBox="0 0 100 100" aria-hidden="true" data-tone="${tone || 'ok'}"><circle class="wringbg" cx="50" cy="50" r="${r}" fill="none" stroke-width="10"/><circle class="wringfg" cx="50" cy="50" r="${r}" fill="none" stroke-width="10" stroke-linecap="round" stroke-dasharray="${(c * p / 100).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 50 50)"/></svg>`; };
  const bullet = (v, max, target, state) => { const m = Math.max(max || 0, 1); return `<div class="wbullet" data-state="${state || 'ok'}"><span class="wbfill" style="width:${(Math.min(v, m) / m * 100).toFixed(1)}%"></span>${target != null ? `<span class="wbtick" style="inset-inline-start:${(Math.min(target, m) / m * 100).toFixed(1)}%"></span>` : ''}</div>`; };
  const stacked = (parts, cls) => `<div class="wstack ${cls || ''}">${parts.filter(p => p.v > 0).map(p => `<span data-sev="${p.sev || ''}" style="flex:${p.v}"></span>`).join('')}</div>`;
  const fmtK = v => v >= 10000 ? fmtW(v / 1000, 0) + 'k' : v >= 1000 ? fmtW(v / 1000, 1) + 'k' : fmtW(v, v < 10 ? 1 : 0);
  /* a framed chart: three y labels beside the plot, gridlines at quarters, the x labels beneath */
  const chartFrame = (inner, W, H, max, xLabels, cls) => `<div class="wchartwrap ${cls || ''}"><div class="wyaxis"><span>${fmtK(max)}</span><span>${fmtK(max / 2)}</span><span>0</span></div>
      <svg class="wchart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="wgA" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="wgA0"/><stop offset="1" class="wgA1"/></linearGradient></defs>${[0.25, 0.5, 0.75].map(f => `<line class="wgrid" x1="0" x2="${W}" y1="${(H * f).toFixed(1)}" y2="${(H * f).toFixed(1)}" vector-effect="non-scaling-stroke"/>`).join('')}${inner}</svg><span class="wyaxis-sp"></span><div class="wxaxis">${xLabels}</div></div>`;
  const barsSvg = (vals, max, W, H, cls) => vals.map((v, i) => { const bw = W / vals.length; return `<rect class="${cls || ''}" x="${(i * bw + bw * 0.18).toFixed(1)}" y="${(H - v / max * H).toFixed(1)}" width="${(bw * 0.64).toFixed(1)}" height="${(v / max * H).toFixed(1)}" rx="2"/>`; }).join('');
  const hbar = (label, v, max, extra, sev) => `<div class="whb"><span class="whbl">${esc(label)}</span><div class="whbt"><span class="whbf" data-sev="${sev || ''}" style="width:${max ? (Math.min(v, max) / max * 100).toFixed(1) : 0}%"></span></div><span class="whbv">${extra || fmtW(v)}</span></div>`;
  const card = (cls, title, body, extra) => `<section class="wcard ${cls}" ${extra || ''}><h2 class="wct">${title}</h2>${body}</section>`;

  /* ------------------------------ KPI strip ------------------------------- */
  function kpiTile(o){
    /* o: { key, label, value, unit, spark, hue, ring (pct), cap, tone } */
    const val = `<span class="wkv"><span class="wnum2">${esc(o.value)}</span>${o.unit ? `<span class="wunit">${esc(o.unit)}</span>` : ''}</span>`;
    const vis = o.ring != null ? `<div class="wkring">${ring(o.ring, o.tone)}${val}</div>` : val + (o.spark ? spark(o.spark, o.hue, o.sparkCompare) : '');
    return `<div class="wkpi" data-key="${esc(o.key)}" data-tone="${o.tone || 'ok'}" data-size="${o.size || 'std'}"><span class="wklbl">${esc(o.label)}</span>${vis}${o.cap ? `<span class="wkcap wextra">${esc(o.cap)}</span>` : ''}</div>`;
  }
  function kpiStrip(f, m){
    const t = E.t.bind(E), tiles = [];
    if(f.scope === 'estate'){
      const h = f.header, cov = agg => t('wall.covShort', { n: fmtW(agg.sitesIncluded), total: fmtW(agg.sitesTotal), pct: fmtW(agg.coveragePct, 0) });
      /* D120: hierarchy — the two operational figures (sites reporting, active alarms) lead at hero size; the four others are secondary */
      tiles.push({ key: 'rep', size: 'hero', label: t('wall.sitesReporting'), value: fmtW(f.states.reporting), unit: t('wall.ofN', { n: fmtW(f.sitesTotal) }), ring: f.sitesTotal ? f.states.reporting / f.sitesTotal * 100 : 0, tone: f.notReporting ? 'stale' : 'ok', cap: t('pfPer.now') });
      tiles.push({ key: 'alarms', size: 'hero', label: t('pfKpi.alarms'), value: fmtW(h.alarms.value), cap: cov(h.alarms) });
      tiles.push({ key: 'energy', size: 'sec', label: t('pfKpi.energy'), value: fmtW((h.energy.value || 0) / 1000), unit: t('pfMwh'), cap: t('pfPer.' + h.period) + ' · ' + cov(h.energy) });
      tiles.push({ key: 'wos', size: 'sec', label: t('pfKpi.wos'), value: fmtW(h.wos.value), cap: cov(h.wos) });
      tiles.push({ key: 'overdue', size: 'sec', label: t('pfOverdueWord'), value: fmtW(h.overdue.value), tone: h.overdue.value ? 'warn' : 'ok', cap: cov(h.overdue) });
      const R2 = R(), comp = R2.ratio(f.sites, { num: s => s.pmDone, den: s => s.pmDue, denKey: 'sites', needs: 'records', state: s => s.state });
      if(comp.value != null) tiles.push({ key: 'pm', size: 'sec', label: t('pfc.compliance'), value: fmtW(comp.value * 100), unit: '%', ring: comp.value * 100, cap: cov(comp) });
    } else {
      (E.data.summary || []).filter(r => ['energy', 'water', 'gas', 'comfort'].includes(r.key)).forEach(r => {
        let v = (E.data.metrics || {})[r.metric];
        if (v == null && r.key === 'water' && E.data.water) v = E.data.water.todayM3;
        if (v == null && r.key === 'gas' && E.data.gas) v = E.data.gas.todayM3;
        if (v === 0 && (r.key === 'energy' || r.key === 'water' || r.key === 'gas')) v = null;
        tiles.push({ key: r.key, label: t(r.label), value: dashW(v, r.d), unit: r.u || '', spark: r.spark, sparkCompare: r.sparkCompare, hue: r.dom, cap: r.capEn ? (E.lang === 'ar' ? r.capAr : r.capEn) : (E.lang === 'ar' ? r.deltaAr : r.deltaEn) });
      });
      const p = (E.data.power || {}).subview;
      const peakKw = (E.data.metrics && E.data.metrics.peakTodayKw) || null;
      const limitKw = p && p.limitKw;
      tiles.push({
        key: 'peak',
        label: t('wall.kpiPeak'),
        value: dashW(peakKw, 1),
        unit: 'kW',
        ring: (peakKw != null && limitKw) ? peakKw / limitKw * 100 : null,
        tone: (peakKw != null && limitKw && peakKw / limitKw >= 0.9) ? 'warn' : 'ok',
        cap: limitKw ? t('wall.ofContract', { kw: fmtW(limitKw, 0) }) : ''
      });
      const w = E.data.water;
      if(w && w.tankCapacityM3 && w.tankVolumeM3 != null){ const pct = Math.round(w.tankVolumeM3 / w.tankCapacityM3 * 100), days = w.meterAvgM3Day ? w.tankVolumeM3 / w.meterAvgM3Day : null;
        tiles.push({ key: 'tank', label: t('wall.kpiTank'), value: fmtW(pct), unit: '%', ring: pct, tone: pct <= (w.refillThresholdPct || 0) ? 'warn' : 'ok', cap: days != null ? t('wall.autonomy', { d: fmtW(days, 1) }) : '' }); }
    }
    const cols = tiles.reduce((a, x) => a + (x.size === 'hero' ? 3 : x.size === 'sec' ? 2 : 2), 0);   /* hero tiles span 3 tracks, the rest 2 */
    return `<section class="wkpis" data-zone="vitals" style="--wk:${cols}">${tiles.map(kpiTile).join('')}</section>`;
  }

  /* ------------------------------ alarm card (numbers, never charts) ------ */
  function alarmCard(f, m){
    const t = E.t.bind(E), T = cfg().alarmTargets, total = f.sev.critical + f.sev.high + f.sev.medium;
    const cells = ['critical', 'high', 'medium'].map(s => `<div class="wsevc" data-sev="${s}" data-zero="${f.sev[s] === 0}" data-changed="${changedKeys.includes(s) ? 1 : 0}"><span class="wglyph">${C().sevGlyph(s, false, 0)}</span><span class="wnum2">${fmtW(f.sev[s])}</span><span class="wlbl">${esc(t('rpSev.' + s))}</span></div>`).join('');
    const sevbar = '';
    const healthy = total === 0 ? `<div class="wok"><span class="wglyph wokg">${C().icon('check', 0)}</span><span class="wlbl">${esc(t('wall.noAlarms'))}</span></div>` : '';
    const hero = `<div class="whero"><div class="wherot"><span class="wnum">${fmtW(m.unacked)}</span><span class="wlbl">${esc(t('wall.unackedLbl'))}</span></div>
      <div class="wherot"><span class="wnum">${m.oldestH == null ? '--' : esc(E.fmtAge(m.oldestH))}</span><span class="wlbl">${esc(t(f.scope === 'estate' ? 'wall.oldestNotInFeed' : 'wall.oldestLbl'))}</span></div></div>`;
    const cap = Math.min(cfg().topAlarms, 12);
    let lis;
    if(f.scope === 'estate') lis = f.topSites.slice(0, cap).map(s => `<li class="walr" data-sev="${s.worstSev}" data-act="wallOpenSite" data-site="${esc(s.id)}" data-tip="${esc(t('wall.openSite'))}"><span class="wglyph">${C().sevGlyph(s.worstSev, false, 0)}</span><span class="wsevw">${esc(t('rpSev.' + s.worstSev))}</span><span class="wwhat"><span class="wid">${esc(E.lang === 'ar' ? s.nameAr : s.nameEn)}</span>${s.state !== 'reporting' ? ` <span class="wqual">· ${esc(t('pfRep.' + s.state))}</span>` : ''}</span><span class="wage">${esc(t('wall.nAlarms', { n: fmtW(s.alarmCount) }))}</span></li>`);
    else lis = f.topAlarms.slice(0, cap).map(a => `<li class="walr" data-sev="${a.sev}" data-act="wallOpenAsset" data-asset="${esc(a.asset)}" data-tip="${esc(t('wall.openAsset'))}"><span class="wglyph">${C().sevGlyph(a.sev, !!a.ack, 0)}</span><span class="wid">${esc(a.asset)}</span><span class="wwhat">${esc(E.loc(a, 'plain'))}</span><span class="wage">${esc(E.fmtAge(a.ageH))}</span></li>`);
    const totalRows = f.scope === 'estate' ? f.topSites.length : E.data.alarms.length;
    const list = lis.length ? `<div class="wlisth"><span>${esc(t('wall.activeAlarms'))}</span><span class="wcount" data-total="${totalRows}">${esc(t('wall.shownOf', { n: fmtW(lis.length), m: fmtW(totalRows) }))}</span></div><ul class="wlist">${lis.join('')}</ul>` : '';
    const foot = f.scope === 'estate'
      ? `<div class="wnotrep" data-tone="${f.notReporting ? 'stale' : 'ok'}"><span class="wbval">${fmtW(f.notReporting)}</span><span class="wlbl">${esc(t('wall.notReporting'))}${m.unknownLive ? ' · ' + esc(t('wall.unknownLiveShort')) : ''}</span></div>`
      : `<div class="wnotrep" data-tone="${f.staleAssets || f.state !== 'reporting' ? 'stale' : 'ok'}"><span class="wbval">${fmtW(f.staleAssets)}</span><span class="wlbl">${esc(t('wall.staleAssets'))} · ${esc(t('wall.feed'))} ${esc(t('pfRep.' + f.state))}</span></div>`;
    return `<aside class="wcard walarm" data-zone="alarms"><h2 class="wct">${esc(t('wall.zoneAlarms'))}</h2>${healthy}${sevbar}<div class="wsev">${cells}</div>${foot}${hero}${list}</aside>`;   /* D120: the qualifier sits under the counts it qualifies */
  }

  /* ------------------------------ alarm performance card ------------------ */
  function perfCard(f, m){
    const t = E.t.bind(E), T = cfg().alarmTargets;
    /* performance: value, bullet against the target, one label line naming window, target and source */
    const perf = (label, val, v, max, target, state, sub, tgt) => `<div class="wperf" data-state="${state}"${state === 'na' && sub === '' && val === esc(t('wall.notInFeed')) ? ' data-na="feed"' : ''}><span class="wpl">${esc(label)}</span><span class="wpv">${val}${tgt ? `<span class="wpt">${esc(tgt)}</span>` : ''}</span>${sub != null ? sub : bullet(v, max, target, state)}</div>`;
    let rows = '';
    if(m.flood && m.flood.on) rows += `<div class="wflood">${C().sevGlyph('critical', false, 0)}<span>${esc(t('wall.floodShort', { n: fmtW(m.flood.n), src: m.flood.source }))}</span></div>`;
    const tg = n => t('wall.targetShort', { n: fmtW(n) });
    if(m.standing) rows += perf(t('wall.perfStandingS', { h: fmtW(m.standing.hours) }), fmtW(m.standing.n), m.standing.n, Math.max(m.standing.target * 2, m.standing.n), m.standing.target, m.standing.n > m.standing.target ? 'over' : 'ok', null, tg(m.standing.target));
    else rows += perf(t('wall.perfStandingS', { h: fmtW(T.standingHours) }), esc(t('wall.notInFeed')), 0, 1, null, 'na', '');
    if(m.rate) rows += m.rate.incomplete ? perf(t('wall.perfRateS', { m: fmtW(m.rate.windowMin) }), esc(t('wall.incomplete', { why: m.rate.incomplete })), 0, 1, null, 'na', '')
                                        : perf(t('wall.perfRateS', { m: fmtW(m.rate.windowMin) }), fmtW(m.rate.per10, 1), m.rate.per10, Math.max(m.rate.target * 2, m.rate.per10), m.rate.target, m.rate.per10 > m.rate.target ? 'over' : 'ok', null, tg(m.rate.target));
    else rows += perf(t('wall.perfRateS', { m: fmtW(T.rateWindowMin) }), esc(t('wall.notInFeed')), 0, 1, null, 'na', '');
    const d = m.dist;
    const refTxt = t('wall.refShort', { a: fmtW(d.ref[0]), b: fmtW(d.ref[1]), c: fmtW(d.ref[2]) });
    rows += d.incomplete ? perf(t('wall.perfSplitS'), esc(t('wall.incomplete', { why: d.incomplete })), 0, 1, null, 'na', '')
                         : perf(t('wall.perfSplitS'), `${fmtW(d.pct.critical)}/${fmtW(d.pct.high)}/${fmtW(d.pct.medium)}`, 0, 1, null, 'ok',
                             `<div class="wsplitrows">${[['critical', d.pct.critical, d.ref[0]], ['high', d.pct.high, d.ref[1]], ['medium', d.pct.medium, d.ref[2]]].map(x => `<div class="wsr"><span class="wsrl">${esc(t('rpSev.' + x[0]))}</span><div class="wsrt"><span class="wsrf" data-sev="${x[0]}" style="width:${x[1]}%"></span><span class="wsrtick" style="inset-inline-start:${x[2]}%"></span></div><span class="wsrv">${fmtW(x[1])}%</span></div>`).join('')}</div>`, refTxt);
    const srcs = [...new Set([T.standingSource, T.rateSource, T.prioritySource, T.floodSource])].join(' · ');
    const strip = f.scope === 'site' ? `<div class="wperfstrip"><span class="wpl">${esc(t('wall.raised24'))}</span>${paneRate(f, null, m)}</div>` : '';
    return card('wperfcard', esc(t('wall.perfTitle')) + ` <span class="wcov wextra">${esc(srcs)}</span>`, `<div class="wperfs">${rows}</div>${strip}`);
  }

  /* ------------------------------ centre: model / map / board ------------- */
  function chips(m){
    const t = E.t.bind(E);
    return m.watch.length ? `<ul class="wchips">${m.watch.map(w => `<li class="wchip" data-tone="${w.tone}" data-key="${esc(w.key)}" data-tip="${esc(w.basis)}"><i class="wchipdot"></i><span>${esc(w.text)}</span></li>`).join('')}</ul>` : '';
  }
  function paneModel(f, p, m){
    const t = E.t.bind(E), site = f.scope === 'estate' ? (E.lang === 'ar' ? (window.EKO_DATA.portfolio[0] || {}).nameAr : (window.EKO_DATA.portfolio[0] || {}).nameEn) : f.name;
    return `<div class="wpane wmodel" data-pane="model">${V().viewer(E, { markers: true, dock: 'none', pills: false, timeline: false }, '')}<div class="wover"><span class="wovt">${esc(t('wall.model', { site }))}</span></div>${chips(m)}</div>`;
  }
  function paneMap(f, p, m){
    const t = E.t.bind(E), MAP = window.EKO_MAP; if(!MAP) return paneBoard(f, p, m);
    return `<div class="wpane wmap" data-pane="map">${MAP.render(E, f.sites, f.sites)}<div class="wover"><span class="wovt">${esc(t('wall.map'))}</span></div>${chips(m)}</div>`;
  }
  function paneTrend(f){
    const t = E.t.bind(E), b = (((E.data.power || {}).bva || {}).ranges || {}).today;
    if(!b) return `<div class="wpane wchartpane" data-pane="trend"><div class="wok"><span class="wlbl">${esc(t('wall.notInFeed'))}</span></div></div>`;
    const n = b.actual.length, max = Math.max(1, Math.max.apply(null, b.actual.concat(b.baseline.filter(x => x != null)).concat([0]))) * 1.15, W = 1000, H = 400, bw = W / n;
    const pts = b.actual.map((v, i) => `${(i * bw + bw / 2).toFixed(1)},${(H - v / max * H).toFixed(1)}`);
    const line = b.baseline.map((v, i) => v == null ? null : `${(i * bw + bw / 2).toFixed(1)},${(H - v / max * H).toFixed(1)}`).filter(Boolean).join(' ');
    const labels = b.labels.map((l, i) => `<span>${i % 4 === 0 ? esc(l) : ''}</span>`).join('');
    const inner = `<polygon class="wareaA" points="${(bw / 2).toFixed(1)},${H} ${pts.join(' ')} ${(n * bw - bw / 2).toFixed(1)},${H}"/><polyline class="wlineA" points="${pts.join(' ')}" fill="none" stroke-width="4" vector-effect="non-scaling-stroke"/><polyline class="wlineB" points="${line}" fill="none" stroke-width="3" stroke-dasharray="8 7" vector-effect="non-scaling-stroke"/>`;
    return `<div class="wpane wchartpane" data-pane="trend">${chartFrame(inner, W, H, max, labels)}<div class="wlegend wextra"><span class="wlg wlga">${esc(t('bvaActual'))}</span><span class="wlg wlgb">${esc(t('bvaBaseline'))}</span></div></div>`;
  }
  function paneRate(f, p, m){
    const t = E.t.bind(E), r = m.rate24, W = 1000, H = 400;
    if(!r) return `<div class="wpane wchartpane" data-pane="rate"><div class="wok"><span class="wlbl">${esc(t('wall.notInFeed'))}</span></div></div>`;
    const max = Math.max(r.targetPerHour * 1.5, Math.max.apply(null, r.bins) * 1.15, 1), ty = (H - r.targetPerHour / max * H).toFixed(1);
    const labels = r.bins.map((_, i) => `<span>${i === 0 ? esc(t('wall.hAgo', { n: 24 })) : i === 12 ? esc(t('wall.hAgo', { n: 12 })) : i === 23 ? esc(t('wall.now')) : ''}</span>`).join('');
    const body = r.incomplete ? `<div class="wok"><span class="wlbl">${esc(t('wall.incomplete', { why: r.incomplete }))}</span></div>`
      : chartFrame(`${barsSvg(r.bins, max, W, H, 'wbarA')}<line x1="0" x2="${W}" y1="${ty}" y2="${ty}" class="wlineT" stroke-width="2" stroke-dasharray="8 7" vector-effect="non-scaling-stroke"/>`, W, H, max, labels);
    return `<div class="wpane wchartpane" data-pane="rate">${body}<div class="wlegend wextra"><span class="wlg wlgt">${esc(t('wall.rate24TargetShort', { n: fmtW(r.targetPerHour), src: r.source }))}</span></div></div>`;
  }
  function paneWork(f, p, m){
    const t = E.t.bind(E), s = m.shift;
    if(f.scope === 'estate'){
      const h = f.header, max = Math.max(h.wos.value || 0, 1);
      return `<div class="wpane wchartpane" data-pane="work"><div class="whbars">${hbar(t('pfKpi.wos'), h.wos.value || 0, max)}${hbar(t('pfOverdueWord'), h.overdue.value || 0, max, null, h.overdue.value ? 'warn' : '')}</div>
        <div class="wlegend"><span class="wcov wextra">${esc(t('wall.shNotInFeedShort'))}</span></div></div>`;
    }
    let over = 0, due = 0, sched = 0, open = 0;
    E.data.assets.forEach(a => {
      (a.workOrders || []).forEach(o => {
        open++;
        if (o.status === 'over') over++;
        else if (o.status === 'due') due++;
        else sched++;
      });
    });
    const max = Math.max(open, 1);
    const shift = s && !s.notInFeed ? `<div class="wshift"><span class="wshl">${esc(s.label)}</span><div class="wstats">${[[s.raised, 'wall.shRaisedS'], [s.acked, 'wall.shAckedS'], [s.woCreated, 'wall.shWoNewS'], [s.woClosed, 'wall.shWoClosedS']].map(x => `<span class="wstat"><b class="wbval">${dashW(x[0])}</b><span class="wlbl">${esc(t(x[1]))}</span></span>`).join('')}</div></div>` : '';
    return `<div class="wpane wchartpane" data-pane="work"><div class="whbars">${hbar(t('wall.wo.over'), over, max, null, over ? 'warn' : '')}${hbar(t('wall.wo.due'), due, max, null, due ? 'warn' : '')}${hbar(t('wall.wo.sched'), sched, max)}${hbar(t('wall.wo.open'), open, max)}</div>${shift}</div>`;
  }
  const boardOrder = sites => sites.slice().sort((a, b) => (a.telemetry ? 1 : 0) - (b.telemetry ? 1 : 0) || a.sevRank - b.sevRank || b.alarmCount - a.alarmCount || (a.nameEn || '').localeCompare(b.nameEn || ''));
  const boardPerPage = () => (boardFit && boardFit.perPage) || 12;
  const boardPages = () => Math.max(1, Math.ceil(EST().sites(E).length / boardPerPage()));
  const boardPage = p => Math.min(boardPages() - 1, Math.floor(p.frac * boardPages()));
  function paneBoard(f, p){
    const t = E.t.bind(E), per = boardPerPage(), pages = boardPages(), page = boardPage(p), all = boardOrder(f.sites), rows = all.slice(page * per, page * per + per);
    const tile = s => `<div class="wsite" data-rep="${s.state}" data-live="${s.telemetry ? 1 : 0}" data-sev="${s.worstSev || 'none'}">
      <span class="wsname">${esc(E.lang === 'ar' ? s.nameAr : s.nameEn)}</span>
      <span class="wsrep">${esc(t('pfRep.' + s.state))}${!s.telemetry && s.hbAgoMin != null ? ' · ' + esc(E.fmtAge(s.hbAgoMin / 60)) : ''}</span>
      <span class="wssev">${s.worstSev ? C().sevGlyph(s.worstSev, false, 0) + `<b>${fmtW(s.alarmCount)}</b> ${esc(t('rpSev.' + s.worstSev))}` : esc(t('pfNoAlarms'))}</span>
      <span class="wskpi">${esc(PF().kpiText(E, s))}</span></div>`;
    return `<div class="wpane wboard" data-pane="board" data-page="${page}"><h2 class="wct wboardt">${esc(t('wall.board'))} <span class="wcov">${esc(t('wall.boardN', { n: fmtW(all.length) }))}${pages > 1 ? ' · ' + esc(t('wall.boardPage', { i: fmtW(page + 1), n: fmtW(pages) })) : ''}</span></h2><div class="wsites">${rows.map(tile).join('')}</div></div>`;
  }

  /* ------------------------------ side column (charts) -------------------- */
  function sideCards(f, m){
    const t = E.t.bind(E);
    if(f.scope === 'estate'){
      const st = f.states, parts = ['reporting', 'degraded', 'stale', 'offline'].map(s => ({ sev: 'rep-' + s, v: st[s] || 0 }));
      const legend = ['reporting', 'degraded', 'stale', 'offline'].filter(s => st[s]).map(s => `<span class="wlg" data-rep="${s}">${fmtW(st[s])} ${esc(t('pfRep.' + s))}</span>`).join('');
      const nr = f.sites.filter(s => !s.telemetry).slice(0, 4).map(s => `<li class="wnr"><span class="wid">${esc(E.lang === 'ar' ? s.nameAr : s.nameEn)}</span><span class="wage">${esc(t('pfRep.' + s.state))}${s.hbAgoMin != null ? ' · ' + esc(E.fmtAge(s.hbAgoMin / 60)) : ''}</span></li>`).join('');
      const bySite = f.topSites.slice(0, 6), max = Math.max.apply(null, bySite.map(s => s.alarmCount).concat([1]));
      /* D120: a chart in the side column — the estate feed carries no hourly series, so the flagship's energy-against-baseline is shown and labelled as the flagship's; sites by state lives in the hero ring and the not-reporting line */
      const flag = window.EKO_DATA.portfolio[0] || {}, b0 = (((E.data.power || {}).bva || {}).ranges || {}).today;
      const flagName = E.lang === 'ar' ? flag.nameAr : flag.nameEn;
      return perfCard(f, m) + card('wside1', esc(t('wall.energyShort')) + ` <span class="wcov">${esc(t('wall.flagshipOnly', { site: flagName }))}${b0 ? ' · ' + esc(t('wall.toT', { t: b0.labels[b0.labels.length - 1] + ':00' })) : ''}</span>`, paneTrend(f))
        + card('wside2', esc(t('wall.alarmsBySite')), `<div class="whbars">${bySite.map(s => hbar(E.lang === 'ar' ? s.nameAr : s.nameEn, s.alarmCount, max, null, s.worstSev)).join('')}</div>`);
    }
    const b = (((E.data.power || {}).bva || {}).ranges || {}).today;
    return perfCard(f, m) + card('wside1', esc(t('wall.energyShort')) + (b ? ` <span class="wcov">${esc(t('wall.vsBaseTo', { t: b.labels[b.labels.length - 1] + ':00' }))}</span>` : ''), paneTrend(f))
      + card('wside3', esc(t('wall.workOrders')) + ` <span class="wcov">${esc(t('wall.workOpen', { n: fmtW(E.data.assets.reduce((a, x) => a + ((x.wost && x.wost !== 'done') ? (x.wos || 1) : 0), 0)) }))}</span>`, paneWork(f, null, m));
  }

  /* ------------------------------ render ---------------------------------- */
  function render(app){
    E = app;
    const c = cfg(), L = ladderFor(c, window.innerWidth, window.innerHeight), t = E.t.bind(E), f = facts(), m = metrics(f);
    const counts = f.sev;
    if(lastCounts){ const up = ['critical', 'high', 'medium'].filter(s => counts[s] > lastCounts[s]); if(up.length){ changedKeys = up; changedAt = Date.now(); } }
    if(Date.now() - changedAt > 12000) changedKeys = [];
    lastCounts = Object.assign({}, counts);
    const p = paneAt(Date.now()); E.state.wallIdx = p.idx;
    if(p.pane !== shownPane){
      if(p.pane === 'model' && shownPane != null && E.engine && typeof E.engine.resetView === 'function') E.engine.resetView();
      shownPane = p.pane;
    }
    const pane = { model: paneModel, map: paneMap, board: paneBoard, trend: paneTrend, rate: paneRate, work: paneWork }[p.pane];
    const pw = PWA() ? PWA().state : { mode: 'online' };
    const stale = pw.mode !== 'online';
    const since = pw.mode === 'offline' ? pw.offlineSince : pw.degradedSince;
    const banner = stale ? `<div class="wbanner" role="status" data-mode="${pw.mode}">${C().icon(pw.mode === 'degraded' ? 'tools' : 'clock', 0)}<span>${esc(t(pw.mode === 'offline' ? 'wall.offline' : 'wall.degraded', { t: since ? hhmm(new Date(since)) : '' }))}</span></div>` : '';
    const conn = t(pw.mode === 'online' ? 'wall.connLive' : pw.mode === 'degraded' ? 'wall.connDegraded' : 'wall.connOffline');
    const locked = !!c.lock;
    const ctl = locked ? `<span class="wesc wlocked" data-hot="0">${C().icon('lock', 0)}${esc(t('wall.lockedHint'))}</span>`
      : `<span class="wesc" data-hot="0">${esc(t('wall.exitHint'))}</span><button class="wbtn" data-act="wallGear" data-tip="${esc(t('wall.settings'))}" aria-label="${esc(t('wall.settings'))}" aria-expanded="${!!E.state.wallCfgOpen}">${C().icon('settings', 0)}</button><button class="wbtn" data-act="wallExit" data-tip="${esc(t('wall.exit'))}" aria-label="${esc(t('wall.exit'))}">${C().icon('x', 0)}</button>`;
    const foot = `<footer class="wfoot"><span class="wfname">${esc(f.name)}</span><span class="wconn" data-mode="${pw.mode}"><i class="wdot"></i>${esc(conn)}</span><span>${esc(t('wall.asOf', { t: f.asOf }))}</span>${p.n > 1 ? `<span>${esc(t('wall.mainPos', { i: fmtW(p.idx + 1), n: fmtW(p.n) }))}</span>` : ''}<span class="grow"></span>${ctl}</footer>`;
    const panel = E.state.wallCfgOpen && !locked ? settingsPanel(c, L) : '';
    const style = `--wbody:${L.body}px;--wlabel:${L.label}px;--wnum2:${L.num2}px;--wnum1:${L.num1}px;--wline:${L.line}px;--wglyph:${L.glyph}px;--wval:${L.val}px;--wbright:${(c.wallBrightness / 100).toFixed(2)}`;
    return `<div class="wall" data-scope="${c.scope}" data-stale="${stale ? 1 : 0}" data-motion="reduce" data-idx="${p.idx}" data-born="${E.state.born === 'wall' ? 1 : 0}" data-body="${L.body}" style="${style}">
      ${banner}<div class="wgrid">${kpiStrip(f, m)}${alarmCard(f, m)}<section class="wcard wcentre wmain" data-zone="main" data-pane="${p.pane}">${p.n > 1 ? `<div class="wprog" aria-hidden="true"><span style="width:${(p.frac * 100).toFixed(1)}%"></span></div>` : ''}${pane ? pane(f, p, m) : ''}</section><div class="wside" data-zone="side">${sideCards(f, m)}</div></div>${foot}</div>${panel}`;
  }
  /* the on-wall settings panel: type size, theme, brightness, dwell, panes, lock, exit — saved per display like the workstation dialog */
  function settingsPanel(c, L){
    const t = E.t.bind(E), id = (E.state.wallOpt || {}).id || 'default', s = settingsFor(E, id);
    const known = c.scope === 'estate' ? ESTATE_PANES : SITE_PANES;
    const seg = (v, lbl) => `<button class="wseg" data-act="wallSet" data-k="theme" data-v="${v}" data-on="${c.theme === v}" aria-pressed="${c.theme === v}">${esc(lbl)}</button>`;
    return `<div class="wpanel" role="dialog" aria-label="${esc(t('wall.settings'))}">
      <div class="wph"><b>${esc(t('wall.settings'))}</b><span class="wpid">${esc(id)}</span><button class="wbtn" data-act="wallClose" aria-label="${esc(t('close'))}">${C().icon('x', 0)}</button></div>
      <label class="wpf"><span>${esc(t('wall.typeSize'))}</span><input type="range" class="wprange" data-chg="wallSet" data-k="scale" min="0.5" max="2" step="0.05" value="${c.scale}" aria-label="${esc(t('wall.typeSize'))}"><span class="wpv2">${fmtW(c.scale * 100)}% · ${L.body}px${L.belowFloor ? ` · ${esc(t('wall.belowFloor', { px: L.floor }))}` : ''}</span></label>
      <div class="wpf"><span>${esc(t('menuTheme'))}</span><div class="wsegs">${seg('dark', t('thDark'))}${seg('light', t('thLight'))}${seg('auto', t('thAuto'))}</div></div>
      <label class="wpf"><span>${esc(t('wallCfgBright'))}</span><input type="range" class="wprange" data-chg="wallSet" data-k="wallBrightness" min="30" max="100" step="5" value="${c.wallBrightness}" aria-label="${esc(t('wallCfgBright'))}"${c.theme === 'light' ? ' disabled' : ''}><span class="wpv2">${fmtW(c.wallBrightness)}%${c.theme === 'light' ? ' · ' + esc(t('wall.brightDarkOnly')) : ''}</span></label>
      <label class="wpf"><span>${esc(t('wallCfgDwell'))}</span><input type="number" class="wpnum" data-chg="wallSet" data-k="dwellMain" min="5" max="300" step="5" value="${c.dwellMain}" aria-label="${esc(t('wallCfgDwell'))}"><span class="wpv2">${esc(t('wallCfgS'))}</span></label>
      <div class="wpf"><span>${esc(t('wallCfgPanes'))}</span><div class="wpchecks">${known.map(p => `<label><input type="checkbox" data-chg="wallSet" data-k="pane" value="${p}"${c.panes.includes(p) ? ' checked' : ''}> ${esc(t('wall.pane.' + p))}</label>`).join('')}</div></div>
      <div class="wpa"><button class="wbtn2" data-act="wallLock">${C().icon('lock', 0)}${esc(t('wall.lock'))}</button><span class="wpnote">${esc(t('wall.lockHint'))}</span><span class="grow"></span><button class="wbtn2 wbtnx" data-act="wallExit">${esc(t('wall.exit'))}</button></div>
    </div>`;
  }
  function mount(){ applyShift(); applyWallTheme(); fit(); fitBoard(); }
  /* the model's markers and the map's markers arrive as buttons with tooltips; on the wall they are shapes only */
  function inert(){ document.querySelectorAll('.wall [data-tip], .wall title').forEach(el => el.tagName === 'title' ? el.remove() : el.removeAttribute('data-tip')); document.querySelectorAll('.wall button, .wall a, .wall [data-act], .wall [role="button"]').forEach(el => { el.tabIndex = -1; el.removeAttribute('data-act'); el.removeAttribute('role'); el.setAttribute('aria-hidden', 'true'); }); document.querySelectorAll('.wall .pfmapbar, .wall .pfmaplegend, .wall .pfcard').forEach(el => el.remove()); }
  /* Fewer whole elements, never a collision. Each step re-measures with rectangles, so a row that would sit even one pixel past its box goes:
       alarm card: alarm rows (one at a time) · the not-reporting line
       side cards: caption · the shift block · bars from the bottom · not-reporting rows · performance rows from the bottom
       centre:     watch chips (one at a time)
       KPI strip:  the caption lines
     `data-shed` on the zone records what went. */
  function fit(){
    const q = s => document.querySelector(s);
    const over = el => el && (el.scrollHeight > el.clientHeight + 2 || el.scrollWidth > el.clientWidth + 2);
    const outside = (el, box) => { const r = el.getBoundingClientRect(), b = box.getBoundingClientRect(); return r.bottom > b.bottom + 0.5 || r.right > b.right + 0.5 || r.left < b.left - 0.5; };
    const shed = (zone, what) => { if(zone) zone.dataset.shed = ((zone.dataset.shed || '') + ' ' + what).trim(); };
    const zone = q('.walarm'), list = q('.wlist');
    let guard = 0;
    while(list && list.lastElementChild && (over(list) || outside(list.lastElementChild, list) || outside(list.lastElementChild, zone)) && guard++ < 40){ list.removeChild(list.lastElementChild); shed(zone, 'row'); }
    const n = q('.wlisth .wcount'); if(n && list) n.textContent = E.t('wall.shownOf', { n: fmtW(list.children.length), m: fmtW(+n.dataset.total || list.children.length) });
    if(list && !list.children.length){ const h = q('.wlisth'); if(h) h.remove(); list.remove(); }
    if(over(zone) && !(list && list.children.length)){ const x = q('.walarm .wnotrep'); if(x){ x.remove(); shed(zone, 'notrep'); } }
    const chipsEl = q('.wchips'); guard = 0;
    if(!window.DASHBOARD_OVERLAY){
      while(chipsEl && chipsEl.lastElementChild && (over(chipsEl) || [...chipsEl.children].some(ch => outside(ch, chipsEl))) && guard++ < 20){ chipsEl.removeChild(chipsEl.lastElementChild); shed(q('.wcentre'), 'chip'); }
      if(chipsEl && !chipsEl.children.length) chipsEl.remove();
    }
    const kp = q('.wkpis');
    if(over(kp) || [...document.querySelectorAll('.wkpi')].some(over)){ document.querySelectorAll('.wkpis .wextra').forEach(el => el.remove()); shed(kp, 'cap'); }
    /* side cards: caption line · the shift block · bars from the bottom · not-reporting rows from the bottom */
    document.querySelectorAll('.wside .wcard').forEach(cd => {
      const bad = () => over(cd) || [...cd.querySelectorAll('.whb, .wnr, .wstat, .wperf, .wlegend, .wxaxis, .wperfstrip')].some(el => outside(el, cd) || outside(el, el.closest('.whbars, .wnrs, .wperfs') || cd));
      /* D120 order: captions · the shift block · not-reporting rows · text rows down to two · then the chart's axis and strip · bars · the last text rows. A chart outlives text. */
      let ge = 0; while(bad() && cd.querySelector('.wextra') && ge++ < 4){ cd.querySelector('.wextra').remove(); shed(cd, 'cap'); }
      if(bad()){ const sh = cd.querySelector('.wshift'); if(sh){ sh.remove(); shed(cd, 'shift'); } }
      let g = 0; while(bad() && cd.querySelector('.wnr') && g++ < 12){ const nr = cd.querySelectorAll('.wnr'); nr[nr.length - 1].remove(); shed(cd, 'nr'); }
      const lastPerf = () => { const feed = cd.querySelectorAll('.wperf[data-na="feed"]'), na = cd.querySelectorAll('.wperf[data-state="na"]'), pr = cd.querySelectorAll('.wperf'); return feed.length ? feed[feed.length - 1] : na.length ? na[na.length - 1] : pr[pr.length - 1]; };   /* rows that read "not in this feed" go before rows that carry a figure */
      g = 0; while(bad() && cd.querySelectorAll('.wperf').length > 2 && g++ < 6){ lastPerf().remove(); shed(cd, 'perf'); }
      if(bad()){ const ax = cd.querySelector('.wperfstrip .wxaxis'); if(ax){ ax.remove(); shed(cd, 'axis'); } }
      if(bad()){ const st = cd.querySelector('.wperfstrip'); if(st){ st.remove(); shed(cd, 'strip'); } }
      g = 0; while(bad() && cd.querySelectorAll('.whb').length > 1 && g++ < 12){ const bars = cd.querySelectorAll('.whb'); bars[bars.length - 1].remove(); shed(cd, 'bar'); }
      g = 0; while(bad() && cd.querySelectorAll('.wperf').length > 1 && g++ < 6){ lastPerf().remove(); shed(cd, 'perf'); }
    });
  }
  function fitBoard(){
    const main = document.querySelector('.wcentre'), grid = document.querySelector('.wsites'); if(!main || !grid) return;
    const tile = grid.firstElementChild; if(!tile) return;
    const cs = getComputedStyle(grid), gap = parseFloat(cs.gap || cs.rowGap || '0') || 0;
    const cols = Math.max(1, Math.floor((grid.clientWidth + gap) / (tile.offsetWidth + gap)));
    const rows = Math.max(1, Math.floor((grid.clientHeight + gap) / (tile.offsetHeight + gap)));
    const per = cols * rows;
    if(!boardFit || boardFit.perPage !== per){ boardFit = { perPage: per, cols, rows }; E.set({ born: 'wall' }); return; }
    let guard = 0; while(grid.scrollHeight > grid.clientHeight + 1 && grid.children.length > 1 && guard++ < 40) grid.removeChild(grid.lastElementChild);
  }

  const shiftAt = now => SHIFTS[Math.floor((now - epoch) / (cfg().shiftEverySec * 1000)) % 8];
  return { render, start, mount, tick, goto, paneAt, ladder, ladderFor, shiftAt, onKey, exit, exitUrl, hot, ACTS, applyWallTheme, settingsFor, saveSettings, resetSettings, defaults, PANES: ALL_PANES, cfg: () => cfg(), facts: () => facts(), metrics: () => metrics(facts()), boardOrder: () => boardOrder(EST().sites(E)), boardFit: () => boardFit };
})();
