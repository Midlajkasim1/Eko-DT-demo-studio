/* ============================================================================
   EKO app — state, router, i18n, theme, language, Simple/Pro, delegation.
   The shell (top bar + ribbon, nav rail, mount, ask bar, phone tabs) renders
   here; page content comes from /js/pages/archetypes.js driven by
   /js/layouts; every string from /js/i18n; every number from /js/data.
   ============================================================================ */
(function(){
  'use strict';
  const C = window.EKO_C, V = window.EKO_V, P = window.EKO_P;
  const esc = C.esc, icon = C.icon;
  const ls = { get(k){ try{return localStorage.getItem(k)}catch(e){return null} },
               set(k,v){ try{localStorage.setItem(k,v)}catch(e){} } };
  /* display preferences that live for the session only (D70) */
  const ss = { get(k){ try{return sessionStorage.getItem(k)}catch(e){return null} },
               set(k,v){ try{sessionStorage.setItem(k,v)}catch(e){} },
               del(k){ try{sessionStorage.removeItem(k)}catch(e){} } };

  /* No data on this device (cold start offline): honest empty shell, never a
     number that could be mistaken for current (D65). */
  if(!(window.EKO_DATA && window.EKO_DATA.marsa)){
    if(window.EKO_PWA) window.EKO_PWA.coldOffline();
    return;
  }
  /* CLDR plural category of a count for a language (cached rules) — a plain
     function so E.t works on any receiver that carries a lang (the exporters
     call E.t.call({ lang })) */
  const _pluralRules = {};
  function pluralCat(langIn, n){
    const lang = langIn === 'ar' ? 'ar' : 'en';
    if(!_pluralRules[lang]){ try{ _pluralRules[lang] = new Intl.PluralRules(lang); }catch(e){ _pluralRules[lang] = { select: x => x === 1 ? 'one' : 'other' }; } }
    return _pluralRules[lang].select(n);
  }
  const E = window.EKO = {
    data: window.EKO_DATA.marsa,
    nav: window.EKO_LAYOUTS.nav,
    lang: ls.get('eko-lang') || 'en',
    state: {
      pageId: 'marsa-overview', module: 'overview', sub: null,
      rolePreview: ss.get('eko-role-preview') || null,     /* D105: demo-only role preview, session-scoped */
      disclose: {},                                        /* D105: per-user progressive-disclosure overrides (loaded per role) */
      themeMode: ls.get('eko-theme-mode') || 'auto',
      navMin: ls.get('eko-nav') === 'min',
      exp: {},   /* exclusive accordion (D28): at most one module open */
      alarmF: { sev: new Set(), sys: new Set() },
      triageOpen: {},
      assetSel: null, apTab: 'alarms',
      dock: { tool: 'select', bloom: null, style: 'default', tone: 'blue',
              level: 'ALL', layer: 'all', alerts: 'all', minimap: false },
      mkPop: null, mkPopN: 0, mkPulse: null, radial: null, vbarMin: ls.get('eko-vbar') === 'min',   /* D73 */
      ovpMin: ls.get('eko-ovp') === 'min', panMin: ls.get('eko-pan') === 'min', regMin: ls.get('eko-reg') === 'min',   /* D128: the register's model strip */
      /* `born` marks the element a state change just opened, so entry
         animations play once on open — not on every re-render. render()
         clears it after the frame is built. */
      born: null,
      sysExp: {},   /* per-group expand state on the Systems landing */
      histAge: null,
      regQ: '', regStF: null, regSysF: null, regSevF: null, regSort: null, regSortDir: 'asc',
      markersOn: ss.get('eko-mk') !== '0', showAcked: true, tlMetric: 'kwh', tlRange: 'day',   /* D70: per session */
      hmMode: 'temp', hmFloor: 'All', hmSel: null, hmOutline: false,
      hmLayers: { sensors: false, labels: true, values: true },
      woRaised: {}, dlg: null, palQ: '', palSel: 0,
      mobMore: false,
      report: null, rp: { intent:null, text:'' }, rpBusy:false, rpHubQ:'', rpHubF:'all', rpHubRemoved:false, askHint:null,   /* D88–D92 */
      modelFs:false,   /* D94: the full-screen model mode of the stacked shell */
      bvaRange:'today',   /* D96: baseline-versus-actual window */
      pfView:'table', pfMap:null, pfCard:null, pfCovKey:null, pfFrom:false, estateVer:0, estateFixture:'demo',   /* D103: the portfolio layer */
      pfPeriod:'mtd', pfSite:null,   /* D104: the estate period (independent of the site window) and the site detail */
      wall:false, wallOpt:null, wallIdx:0   /* D106: the control-room display context */
    },

    /* i18n: t('key', {vars}) — every visible string goes through here.
       D122 plural families: a count string is a FAMILY of keys
       key.zero / .one / .two / .few / .many / .other (whatever forms the
       language needs; .other is the one every family has). When the table
       holds key.other, the count in vars.n (or the var named by key.plural,
       e.g. "total") picks the form through Intl.PluralRules for the current
       language; a form the language does not define falls back to .other.
       English needs one/other; Arabic needs all six (singular, dual, 3–10,
       11–99, 100+, zero). */
    t(key, vars){
      const en = window.EKO_I18N.en, tbl = window.EKO_I18N[this.lang] || en;
      let k = key;
      if(tbl[key + '.other'] !== undefined || en[key + '.other'] !== undefined){
        const fam = tbl[key + '.other'] !== undefined ? tbl : en;
        const sel = fam[key + '.plural'] || 'n', raw = vars ? vars[sel] : undefined;
        const num = typeof raw === 'number' ? raw : parseFloat(String(raw ?? '').replace(/[,\s\u00a0]/g, ''));
        const cat = isNaN(num) ? 'other' : pluralCat(this.lang, num);   /* module helper: t() is also called as E.t.call({ lang }) by the report and narration exporters */
        k = fam[key + '.' + cat] !== undefined ? key + '.' + cat : key + '.other';
      }
      let s = tbl[k] ?? en[k] ?? key;
      /* {var|family}: a second count inside one string renders through its
         own family ("{alarms|openAlarmsN}"), so each noun agrees with its
         own number in both languages */
      if(vars) s = s.replace(/\{(\w+)\|([\w.]+)\}/g, (m, v, f) => this.t(f, { n: vars[v] }));
      if(vars) for(const v in vars) s = s.split('{'+v+'}').join(vars[v]);
      return s;
    },
    /* D122: a DATA phrase in the current language (paramAr whole-phrase map,
       then month/weekday tokens inside dates); English returns the string. */
    ph(x){ return this.lang === 'ar' && typeof x === 'string' && window.EKO_I18N.phrase ? window.EKO_I18N.phrase(x) : x; },
    /* CLDR plural category of a count in the current language (module helper). */
    pluralCat(n){ return pluralCat(this.lang, n); },
    alarm(id){ return this.data.alarms.find(a => a.id === id) },
    /* D105: the role model. Role = defaults; permissions stay in user.canControl / features. */
    role(){ const roles = this.data.roles || {}; const r = this.state.rolePreview || (this.data.user || {}).role; return roles[r] ? r : (roles.technician ? 'technician' : Object.keys(roles)[0] || 'technician'); },
    roleCfg(){ return (this.data.roles || {})[this.role()] || {}; },
    wording(){ return this.roleCfg().wording || 'plain'; },
    disclose(k){ const o = this.state.disclose || {}; return (k in o) ? !!o[k] : !!((this.roleCfg().disclose || {})[k]); },
    landing(){ const c = this.roleCfg(); const l = c.landing === 'auto' ? ((this.data.sites || []).length > 1 ? 'portfolio' : 'site') : (c.landing || 'site');
      return l === 'portfolio' ? { pageId:'portfolio', module:'overview' } : { pageId:'marsa-overview', module:'overview' }; },
    /* one place for alarm wording: plain roles read the plain line with the technical string beneath;
       compact surfaces show that second line only when "Show technical detail" is on */
    alarmLines(a, compact){ const tech = this.lang === 'ar' ? (a.techAr || a.techEn) : a.techEn; const plain = this.loc(a, 'plain');
      if(this.wording() === 'technical') return { main: tech, sub: '' };
      return { main: plain, sub: (compact && !this.disclose('tech')) ? '' : tech }; },
    loc(a, kind){
      const ar = this.lang === 'ar';
      return kind === 'plain' ? (ar ? a.plainAr : a.plainEn) : (ar ? a.locAr : a.locEn);
    },
    /* Age labels derive from ageH: <1 h in minutes, <24 h in hours, else days. */
    fmtAge(h){
      if(h < 1) return this.t('ageM', { n: Math.round(h*60) });
      if(h < 24) return this.t('ageH', { n: Math.round(h) });
      return this.t('ageD', { n: Math.round(h/24) });
    },
    /* Alert-centre display filter (D30): which alarms the LIST, MARKERS and
       TIMELINE show. alarmF.sev holds HIDDEN severities (empty = all).
       Counts (ribbon, metas, by-system) always derive from the full list. */
    visAlarms(){
      const hid = this.state.alarmF.sev;
      return this.data.alarms.filter(a =>
        !hid.has(a.sev) && (this.state.showAcked || !a.ack));
    },
    /* Timeline events derive from the alarm list: everything younger than 24 h. */
    events(){
      return this.visAlarms().filter(a => a.ageH <= 24)
        .slice().sort((a,b) => a.ageH - b.ageH);
    },
    hhmmAgo(age){
      const d = new Date(Date.now() - age*36e5);
      return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
    },
    set(patch){ Object.assign(this.state, patch); render(); },
    /* D94: ONE switch for the stacked (tablet/phone) shell; CSS mirrors it at 1023px */
    stacked(){ return window.matchMedia && matchMedia('(max-width:1023px)').matches; },

    go(pageId, module, sub){
      const gate = window.EKO_ADDONS && window.EKO_ADDONS.lockFor(this, module ?? this.state.module, sub);   /* D125: a gated route opens its add-on, never a half page */
      if(gate){ this.set({ born:'dlg', teaserKey: gate, dlg:'teaser', mobMore:false }); return; }
      if(pageId !== this.state.pageId) this.state._prev = { pageId: this.state.pageId, module: this.state.module, sub: this.state.sub };
      if(window.EKO_SURF) window.EKO_SURF.closeAll();          /* R4 (D67) */
      this.set({ born: this.state.born || 'nav',
                 pageId, module: module ?? this.state.module, sub: sub ?? null,
                 mkPop: null, dlg: null, mobMore: false, modelFs: false });
    }
  };

  /* 3D engine: ONE config line in the site data picks the adapter; the shell
     only ever talks to the viewer-api surface. */
  E.engine = window.EKO_VIEWER.create(E.data.viewer.engine || 'static');
  E.engine.onCameraChange(() => window.EKO_V.position(E));
  E.engine.onMarkerClick(id => E.set({ born:'pop', mkPop: id, mkPopN: 0 }));   /* D128: a marker opens its popup, never the panel */
  E.engine.onError(err => console.warn(E.t('engineErr', { msg: err.message })));

  /* ------------------------------- theme ---------------------------------- */
  function applyTheme(){
    const m = E.state.themeMode;
    const dark = m === 'auto'
      ? !(matchMedia && matchMedia('(prefers-color-scheme: light)').matches)
      : m === 'dark';
    (window.DASHBOARD_ROOT||document.documentElement).classList.add('tfade');
    (window.DASHBOARD_ROOT||document.documentElement).setAttribute('data-theme', dark ? 'dark' : 'light');
    setTimeout(() => (window.DASHBOARD_ROOT||document.documentElement).classList.remove('tfade'), 350);
  }
  /* D107: the wall's URL carries the display, the context and how it was opened; the exit strips them */
  const wallScope = () => (E.state.pageId === 'portfolio' || E.state.pageId === 'pfsite') ? 'estate' : 'site';
  const WALL_PARAMS = ['display', 'scope', 'via', 'dwell', 'distance', 'brightness', 'motion', 'shifts', 'page', 'scale', 'panel', 'panelIn', 'id', 'open', 'theme', 'lock'];
  function wallUrl(scope, via, id){ const u = new URL(location.href); WALL_PARAMS.forEach(k => u.searchParams.delete(k)); u.searchParams.set('display', 'wall'); u.searchParams.set('scope', scope); if(via) u.searchParams.set('via', via); if(id && id !== 'default') u.searchParams.set('id', id); return u.toString(); }
  /* D129: the global density preference is retired — row density is the table's own Display menu (per grid) */
  const discloseKey = () => 'eko-disclose-' + (((E.data.user || {}).name) || 'user') + '-' + E.role();
  function loadDisclose(){ try{ return JSON.parse(ls.get(discloseKey()) || '{}') || {}; }catch(e){ return {}; } }
  function saveDisclose(){ ls.set(discloseKey(), JSON.stringify(E.state.disclose || {})); }
  function applyLang(){
    (window.DASHBOARD_ROOT||document.documentElement).lang = E.lang;
    (window.DASHBOARD_ROOT||document.documentElement).dir = E.lang === 'ar' ? 'rtl' : 'ltr';
  }

  /* HH:MM of an ISO timestamp in local time (heartbeat ts / lastSample) */
  const hhmmOf = iso => { const d = new Date(iso); return isNaN(d) ? '' : String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  /* a relative age for a heartbeat timestamp, through the plural families; the absolute goes in the tooltip */
  const agoOf = iso => { const d = new Date(iso); if(isNaN(d)) return ''; const m = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
    return m < 60 ? E.t('pfAgo.min', { n: m }) : m < 48 * 60 ? E.t('pfAgo.h', { n: Math.round(m / 60) }) : E.t('pfAgo.d', { n: Math.round(m / 1440) }); };

  /* ------------------------------- top bar -------------------------------- */
  function topbar(){
    const site = window.EKO_DATA.portfolio.find(p => p.key === 'marsa');
    const siteName = E.lang === 'ar' ? site.nameAr : site.nameEn;
    const crumbPage = E.state.sub || E.state.module;
    const navDoc = E.nav.modules.find(m => m.id === E.state.module);
    return `
    ${C.brandLogo(E)}
    <nav id="crumb" aria-label="${esc(E.t('ariaCrumb'))}">
      <span class="deskonly crumbdt">${esc(E.t('dt'))}</span><span class="deskonly crumbdt" aria-hidden="true">/</span>
      ${E.state.pageId === 'portfolio'
        ? `<span class="crumbbtn crumbhere" aria-current="page">${esc(E.t('pfTitle'))}</span>`
        : E.state.pageId === 'pfsite'
        ? `<button class="crumbbtn cT2" data-act="pfGo">${esc(E.t('pfTitle'))}</button><span aria-hidden="true" class="flexnone">/</span><span class="crumbbtn crumbhere" aria-current="page">${esc((() => { const s = window.EKO_EST && window.EKO_EST.site(E, E.state.pfSite); return s ? window.EKO_PF.name(E, s) : ''; })())}</span>`
        : `${window.EKO_PF && window.EKO_PF.crumb(E) ? `<button class="crumbbtn cT2 deskonly" data-act="pfGo">${esc(E.t('pfTitle'))}</button><span aria-hidden="true" class="flexnone deskonly">/</span>` : ''}<button class="crumbbtn" data-act="dlg" data-v="switcher" aria-haspopup="menu">${esc(siteName)} ${icon('chevR',11)}</button>`}
      ${navDoc && E.state.pageId !== 'portfolio' && E.state.pageId !== 'pfsite' ? `<span aria-hidden="true" class="flexnone">/</span><button class="crumbbtn cT2" data-act="goMod" data-mod="${navDoc.id}" data-page="${esc(navDoc.pageId||'')}">${esc(E.t(navDoc.label))}</button>` : ''}
      ${(() => { const sb = navDoc && E.state.sub && (navDoc.subs||[]).find(x=>x.id===E.state.sub);
        return sb && E.state.pageId !== 'portfolio' && E.state.pageId !== 'pfsite' ? `<span aria-hidden="true" class="flexnone">/</span><span class="cT2">${esc(E.t(sb.label))}</span>` : ''; })()}
    </nav>
    <span class="tbdiv deskonly" aria-hidden="true"></span>
    <div class="tbgrp tbstatus" role="group" aria-label="${esc(E.t('alarms'))}">
      ${E.state.pageId === 'portfolio' || E.state.pageId === 'pfsite' ? '' : C.ribbon(E)}
      ${(() => { const mode = E.state.offline ? 'offline' : E.state.degraded ? 'degraded' : 'online';   /* D121: one truth surface per context — the estate ribbon on estate routes; the pill states the connection */
        /* D124: ONE connection indicator — the sources' state lives in the LIVE pill's tooltip (a source down is the DEGRADED state) */
        const ints = E.data.integrations || [], live = ints.filter(i => /^live$/i.test(i.st || '')).length;
        const srcs = ints.map(i => [i.name, i.proto, E.ph(i.st), E.ph(i.hb)].filter(Boolean).join(' · ')).join('\n');
        /* D130: hover = one line (state, since when, data as of — all heartbeat fields); click = the connection popover */
        const F = window.EKO_PWA && window.EKO_PWA.feed ? window.EKO_PWA.feed() : null, asOf = F && F.ts ? hhmmOf(F.ts) : '';
        const tip = mode === 'offline' ? (asOf ? E.t('connTipOff', { s: E.state.offlineSince || '', t: asOf }) : E.t('connHdrOff', { t: E.state.offlineSince || '' }))
          : mode === 'degraded' ? (asOf ? E.t('connTipDeg', { s: E.state.degradedSince || '', t: asOf }) : E.t('connHdrDeg', { t: E.state.degradedSince || '' }))
          : (asOf ? E.t('connTipOk', { t: asOf }) : E.t('connOk'));
        return `<button class="connpill tipU" data-mode="${mode}" data-act="dlg" data-v="conn" data-tip="${esc(tip)}" aria-label="${esc(tip)}" aria-haspopup="dialog" aria-expanded="${E.state.dlg === 'conn'}"><span class="conndot"></span><span class="conntext">${esc(E.t(mode === 'offline' ? 'connOffline' : mode === 'degraded' ? 'connDegraded' : 'connOk'))}</span></button>`; })()}
    </div>
    <div class="grow"></div>
    <div class="row gap10 tbgrp tbtools">
      <button class="srchbtn deskonly tipU" data-act="dlg" data-v="pal" data-tip="${esc(E.t('searchW'))}" data-kbd="Ctrl K" aria-label="${esc(E.t('searchW'))}" aria-keyshortcuts="Control+K">
        ${icon('search',14)}<span class="grow taS">${esc(E.t('searchW'))}</span></button>
      <span class="clock deskonly tipU" id="clock" data-tip="${esc(E.t('clockTip'))}"></span>
      <span class="tbdiv deskonly" aria-hidden="true"></span>
      ${(() => { const to = E.lang === 'en' ? 'ar' : 'en';   /* D123: one toggle that names the language you switch TO, in its own script (Gulf convention) */
        return `<button class="langbtn tipU" lang="${to}" data-act="lang" data-v="${to}" data-tip="${esc(E.t('langSwitchTip'))}" aria-label="${esc(E.t('langSwitchTip'))}">${esc(E.t('langSwitch'))}</button>`; })()}
      ${(() => { const dark = (window.DASHBOARD_ROOT||document.documentElement).getAttribute('data-theme') !== 'light';   /* D129: one-click light/dark; Auto lives in Settings › Appearance */
        return `<button class="iconbtn tipU themebtn" data-act="themeToggle" data-tip="${esc(E.t(dark ? 'themeToLight' : 'themeToDark'))}" aria-label="${esc(E.t(dark ? 'themeToLight' : 'themeToDark'))}">${icon(dark ? 'sun' : 'moon', 18)}</button>`; })()}
      <button class="iconbtn tipU tbdisp" data-act="dlg" data-v="display" data-tip="${esc(E.t('tbDisplay'))}" aria-label="${esc(E.t('tbDisplay'))}" aria-haspopup="menu" aria-expanded="${E.state.dlg==='display'}">${icon('monitor',18)}</button>
      <button class="iconbtn deskonly tipU" data-act="dlg" data-v="report" data-tip="${esc(E.t('reportsTip'))}" aria-label="${esc(E.t('reportsTip'))}" aria-haspopup="dialog">${icon('doc',18)}</button>
      ${window.EKO_NF ? window.EKO_NF.bell(E) : ''}
      <button class="avatar tipU" data-act="dlg" data-v="menu" data-tip="${esc(E.t('accountTip'))}" aria-haspopup="menu" aria-label="${esc(E.t('accountTip'))}">AY</button>
    </div>`;
  }

  /* ------------------------------- nav rail ------------------------------- */
  function navRail(){
    const mods = E.nav.modules.filter(m => !m.hidden).map(m => {
      const on = E.state.module === m.id ? (E.state.sub ? 'contains' : 'page') : 'none';
      const hasSubs = m.subs && m.subs.length;
      const open = !!E.state.exp[m.id] || E.state.module === m.id;   /* D117: the active module shows its sub-items, as the mockup does */
      const subs = hasSubs && open && !E.state.navMin ? `<div class="nsubs" data-born="${E.state.born==='nsub:'+m.id?1:0}">${m.subs.filter(s => !s.hidden).map(s =>
        s.locked
        ? `<button class="nsub" data-lock="true" data-act="teaser" data-teaser="${esc(s.teaser||s.label)}" data-mod="${m.id}">
             <span class="grow taS">${esc(E.t(s.label))}</span>${icon('lock',12)}</button>`
        : `<button class="nsub" data-on="${E.state.sub===s.id}" data-act="goSub" data-mod="${m.id}" data-sub="${s.id}" data-page="${esc(s.pageId)}">
           <span class="grow taS">${esc(E.t(s.label))}</span>
           ${s.dot?`<span class="ndot" style="background:var(--sev${s.dot[0].toUpperCase()+s.dot.slice(1)})"></span>`:''}</button>`).join('')}</div>` : '';
      return `<div>
        <button class="nvi" data-on="${on}" data-lock="${!!m.locked}" ${E.state.navMin?`data-tip="${esc(E.t(m.label))}" data-tipat="end"`:''}
          data-act="${m.locked?'teaser':'goMod'}" data-mod="${m.id}" ${m.teaser?`data-teaser="${m.teaser}"`:''} data-page="${esc(m.pageId||'')}">
          <span class="nvib"></span><span class="nvic">${icon(m.icon,17)}</span>
          <span class="nlbl">${esc(E.t(m.label))}</span>
          <span class="nlock tipU" data-tip="${esc(E.t('lockedTip'))}">${icon('lock',13)}</span>
          ${hasSubs && !m.locked ? `<span class="nchevb" data-act="navExp" data-mod="${m.id}"><span class="nchevc"><span class="nchev dirx" data-open="${open}">${icon('chevR',12)}</span></span></span>` : ''}
        </button>${subs}</div>`;
    }).join('');
    return `${mods}
      <div class="navfoot col gap4">
        <button class="nvi" ${E.state.navMin?`data-tip="${esc(E.t('nSettings'))}" data-tipat="end"`:''} data-act="dlg" data-v="settings" aria-haspopup="dialog"><span class="nvic">${icon('tools',16)}</span><span class="nlbl">${esc(E.t('nSettings'))}</span></button>
        <button class="nvi" data-tip="${esc(E.t('nHelp'))}" data-kbd="?" data-tipat="end" aria-keyshortcuts="?" data-act="dlg" data-v="help" aria-haspopup="dialog"><span class="nvic">${icon('help',16)}</span><span class="nlbl">${esc(E.t('nHelp'))}</span></button>
        <button class="nvi" data-tip="${esc(E.t(E.state.navMin?'expandNav':'collapseNav'))}" data-tipat="end" data-kbd="[" aria-keyshortcuts="[" data-act="navMin" aria-label="${esc(E.t(E.state.navMin?'expandNav':'collapseNav'))}">
          <span class="nvic ncv">${icon('chevL2',15)}</span><span class="nlbl">${esc(E.t('collapseNav'))}</span></button>
      </div>`;
  }

  /* ------------------------- page header (stacked, D94) --------------------
     Native pattern: the bottom tabs name the module; this sticky strip names
     the PAGE and carries the module's sub-navigation as scrollable tabs (the
     rail's subs, which the tabs cannot show), plus Model and Ask. */
  function pagehead(){
    const mod = E.nav.modules.find(m => m.id === E.state.module);   /* hidden subs are filtered below (D125) */
    const doc = window.EKO_LAYOUTS[E.state.pageId] || {};
    const landing = ['siteOverview', 'categoryLanding'].includes(doc.archetype);
    const title = E.state.pageId === 'portfolio' ? E.t('pfTitle') : E.state.pageId === 'pfsite' ? ((s => s ? window.EKO_PF.name(E, s) : E.t('pfTitle'))(window.EKO_EST && window.EKO_EST.site(E, E.state.pfSite))) : E.state.pageId === 'reports' ? E.t('rpHubT') : E.state.pageId === 'report-preview' ? E.t('rpPanelT')
      : E.state.pageId === 'notifications' ? E.t('nfTitle') : mod ? E.t(mod.label) : E.t('modOverview');
    const subs = mod && mod.subs && mod.subs.length ? [{ home:true, pageId:mod.pageId }].concat(mod.subs.filter(s => !s.hidden)) : [];
    const strip = subs.length ? `<div class="phsubs" role="tablist">${subs.map(s => {
      const on = s.home ? !E.state.sub : E.state.sub === s.id;
      return `<button class="phsub" role="tab" aria-selected="${on}" data-on="${on ? 1 : 0}" data-lock="${!!s.locked}" data-act="${s.locked ? 'teaser' : 'phGo'}" data-mod="${mod.id}" ${s.home ? '' : `data-sub="${s.id}"`} data-page="${esc(s.pageId || mod.pageId || '')}" ${s.teaser ? `data-teaser="${s.teaser}"` : ''}>${esc(E.t(s.home ? 'phSummary' : s.label))}${s.locked ? icon('lock', 11) : ''}</button>`; }).join('')}</div>` : '';
    return `<div id="pagehead" data-subs="${subs.length ? 1 : 0}"><div class="phrow"><h1 class="phtitle">${esc(title)}</h1><span class="grow"></span>
      ${landing ? `<button class="btnG btnSm" data-act="modelFs" data-tip="${esc(E.t('mModelTip'))}">${icon('box', 14)} ${esc(E.t('mModel'))}</button>` : ''}</div>${strip}</div>`;
  }

  /* ------------------------------ phone tabs ------------------------------- */
  function mobtabs(){
    const tab = id => {
      const m = E.nav.modules.find(x => x.id === id);
      return `<button data-on="${E.state.module===id?'page':'none'}" data-act="goMod" data-mod="${m.id}" data-page="${esc(m.pageId||'')}">
        ${icon(m.icon,18)}<span>${esc(E.t(m.mobile||m.label))}</span></button>`;
    };
    return E.nav.phoneTabs.map(tab).join('')
      + `<button data-on="${E.state.mobMore?'page':'none'}" data-act="mobMore">${icon('grid',18)}<span>${esc(E.t('mobMore'))}</span></button>`;
  }

  /* ------------------------------- overlays -------------------------------- */
  function overlays(){
    const d = E.state.dlg;
    let out = '';
    if(E.state.mobMore){
      out += `<div class="scrim" data-born="${E.state.born==='dlg'?1:0}" data-act="closeDlg"></div><div class="dlg" data-born="${E.state.born==='dlg'?1:0}" role="dialog" aria-label="${esc(E.t('moreT'))}">
        <div class="draghandle"></div><div class="dlghead"><h2>${esc(E.t('moreT'))}</h2></div>
        <div class="mlangrow" role="group" aria-label="${esc(E.t('menuLang'))}">
          <span class="tLbl">${esc(E.t('menuLang'))}</span>
          <div class="langgrp">
            <button class="seg" data-on="${E.lang==='en'}" data-act="lang" data-v="en">EN</button>
            <button class="seg" data-on="${E.lang==='ar'}" data-act="lang" data-v="ar">عربي</button>
          </div></div>
        <div class="col gap4">${E.nav.modules.filter(m=>!E.nav.phoneTabs.includes(m.id) && !m.hidden).map(m =>
          `<button class="nvi" data-lock="${!!m.locked}" data-act="${m.locked?'teaser':'goMod'}" data-mod="${m.id}" ${m.teaser?`data-teaser="${m.teaser}"`:''} data-page="${esc(m.pageId||'')}">
             <span class="nvic">${icon(m.icon,17)}</span><span class="nlbl">${esc(E.t(m.label))}</span>
             <span class="nlock">${icon('lock',13)}</span></button>`).join('')}
          <button class="nvi" data-act="rpHub"><span class="nvic">${icon('doc',17)}</span><span class="nlbl">${esc(E.t('rpHubT'))}</span></button>
          <button class="nvi" data-act="nfPage"><span class="nvic">${icon('bell',17)}</span><span class="nlbl">${esc(E.t('nfTitle'))}</span></button>
          <button class="nvi" data-act="dlg" data-v="help" aria-haspopup="dialog"><span class="nvic">${icon('help',17)}</span><span class="nlbl">${esc(E.t('hpTitle'))}</span></button></div></div>`;
    }
    if(E.state.signedOut) return `<div class="signedout" role="dialog" aria-modal="true" aria-label="${esc(E.t('signedOutT'))}"><div class="signedoutcard">${C.brandLogo(E)}<h2>${esc(E.t('signedOutT'))}</h2><p class="tCap">${esc(E.t('signedOutD'))}</p><button class="btnP" data-act="signIn">${esc(E.t('signIn'))}</button></div></div>`;   /* D129 */
    if(window.EKO_AI) out += window.EKO_AI.launcher(E) + window.EKO_AI.panel(E);   /* D132/D133: the launcher, the scrim and the conversation, with or without a dialog */
    if(!d) return out + (window.EKO_CTL ? window.EKO_CTL.overlays(E) : '') + (window.EKO_NF ? window.EKO_NF.overlays(E) : '') + (window.EKO_PWA ? window.EKO_PWA.overlays(E) : '');
    if(d === 'display'){
      /* D107: the Display control — workstation or the control-room wall */
      const scope = wallScope();
      out += `<div class="scrim scrimclear" data-born="${E.state.born==='dlg'?1:0}" data-act="closeDlg"></div>
      <div class="dlg dlgdrop dropEnd dispmenu" data-born="${E.state.born==='dlg'?1:0}" role="menu" aria-label="${esc(E.t('tbDisplay'))}">
        <div class="draghandle"></div>
        <div class="acchead">${esc(E.t('tbDisplay'))}</div>
        <button class="accitem disprow" role="menuitemradio" aria-checked="true" data-act="closeDlg">${icon('check',15)}<span class="grow taS">${esc(E.t('dispWork'))}</span></button>
        <button class="accitem disprow" role="menuitemradio" aria-checked="false" data-act="wallOpen" data-tip="${esc(E.t(scope === 'estate' ? 'dispWallDEstate' : 'dispWallD'))}">${icon('monitor',15)}<span class="grow taS">${esc(E.t('dispWall'))}</span></button>
        <div class="accsep" role="separator"></div>
        <button class="accitem" role="menuitem" data-act="dlg" data-v="wallcfg" data-tip="${esc(E.t('dispSettingsD'))}">${icon('settings',15)}<span class="grow taS">${esc(E.t('dispSettings'))}</span></button>
      </div>`;
    } else if(d === 'wallcfg'){
      /* D109: the control room's setup surface — per display, kept on this workstation, never a control on the wall itself */
      const Wl = window.EKO_WALL, id = E.state.wallCfgId || 'default', s = Wl.settingsFor(E, id);
      const SW = s.panelW || (window.screen && screen.width) || window.innerWidth, SH = s.panelH || (window.screen && screen.height) || window.innerHeight;
      const L = Wl.ladderFor(s, SW, SH), t = E.t.bind(E);
      const num = (k, lblKey, min, max, step, unitKey) => `<label class="rpfld"><span class="tCap">${esc(t(lblKey))}</span><span class="row gap6 aiC"><input type="number" class="dgfin wcfin" data-chg="wallCfg" data-k="${k}" value="${esc(String(s[k]))}" min="${min}" max="${max}" step="${step}" aria-label="${esc(t(lblKey))}"><span class="tCap">${esc(t(unitKey))}</span></span></label>`;
      const cur = s.panelW ? `${s.panelW}x${s.panelH}` : 'auto';
      const panelOpts = [['auto', t('wallCfgAuto', { w: (window.screen && screen.width) || window.innerWidth, h: (window.screen && screen.height) || window.innerHeight })], ['1920x1080', '1920 × 1080'], ['2560x1440', '2560 × 1440'], ['3840x2160', '3840 × 2160']];
      const scopeNow = wallScope(), panesFor = scopeNow === 'estate' ? ['map', 'board', 'model'] : ['model', 'trend', 'rate', 'work'];
      out += `<div class="scrim" data-act="closeDlg"></div>
      <div class="dlg wcfg" role="dialog" aria-label="${esc(t('wallCfgTitle'))}"><div class="dgmhead"><h3>${esc(t('wallCfgTitle'))}</h3><button class="iconbtn msA" data-act="closeDlg" aria-label="${esc(t('close'))}">${icon('x', 13)}</button></div>
        <p class="tCap">${esc(t('wallCfgIntro'))}</p>
        <div class="wcfgrid">
          <label class="rpfld"><span class="tCap">${esc(t('wallCfgDisplay'))}</span><input type="text" class="dgfin" data-chg="wallCfgId" value="${esc(id)}" aria-label="${esc(t('wallCfgDisplay'))}"></label>
          <label class="rpfld"><span class="tCap">${esc(t('wallCfgPanel'))}</span><select class="rpf" data-chg="wallCfg" data-k="panel" aria-label="${esc(t('wallCfgPanel'))}">${panelOpts.map(o => `<option value="${o[0]}"${o[0] === cur ? ' selected' : ''}>${esc(o[1])}</option>`).join('')}</select></label>
          ${num('viewingDistance', 'wallCfgDistance', 1, 30, 0.5, 'wallCfgM')}
          ${num('panelIn', 'wallCfgPanelIn', 20, 300, 1, 'wallCfgIn')}
          ${num('scale', 'wallCfgScale', 0.5, 2, 0.05, 'wallCfgX')}
          ${num('wallBrightness', 'wallCfgBright', 30, 100, 5, 'wallCfgPct')}
          ${num('dwellMain', 'wallCfgDwell', 5, 300, 5, 'wallCfgS')}
          ${num('dwellModel', 'wallCfgDwellModel', 5, 300, 5, 'wallCfgS')}
        </div>
        <div class="rpfld"><span class="tCap">${esc(t('wallCfgPanes'))}</span><div class="wcfpanes">${panesFor.map(p => `<label class="row gap6 aiC"><input type="checkbox" class="dgfck" data-chg="wallCfgPane" value="${p}"${s.panes.includes(p) ? ' checked' : ''}><span>${esc(t('wall.pane.' + p))}</span></label>`).join('')}</div></div>
        <div class="wcfread"><b>${esc(t('wallCfgReadout', { body: L.body, floor: L.floor, d: s.viewingDistance, w: SW, h: SH, lines: L.lines }))}</b><span class="tCap">${esc(t(L.lines < 30 ? 'wallCfgTight' : 'wallCfgRoomy'))}</span>${s.saved ? `<span class="tCap">${esc(t('wallCfgSaved'))}</span>` : ''}</div>
        <div class="row gap8 jcE wcfoot"><button class="btnG btnSm" data-act="wallCfgReset">${esc(t('wallCfgReset'))}</button><button class="btnP btnSm" data-act="wallOpen">${esc(t('wallCfgOpen'))}</button></div>
      </div>`;
    } else if(d === 'menu'){
      /* D85/D107: the account MENU — headed sections, a description under every setting. */
      const seg = (grp, v, lbl, on, tip) => `<button class="seg" data-on="${on}" data-act="${grp}" data-v="${v}" aria-pressed="${on}"${tip ? ` data-tip="${esc(tip)}"` : ''}>${esc(lbl)}</button>`;
      const u = E.data.user || {};
      const roleKey = { technician:'roleTechnician', engineer:'roleEngineer', executive:'roleExecutive' }[E.role()] || 'roleTechnician';
      const previewing = !!E.state.rolePreview && E.state.rolePreview !== u.role;
      /* D129: the account menu is IDENTITY and ACCOUNT ACTIONS — name and role, Sign out — plus the demo
         section in demo builds. Theme is the top-bar toggle and Settings › Appearance; language is the
         top-bar toggle; density is the table's Display menu; Edit layout sits with the cards; Reset layout
         is Settings › Appearance; shortcuts and legend are Help; the wall is the Display control; modules
         are Settings › Administration; saved portfolio views are the portfolio's Views menu. */
      const row = (lblKey, descKey, control, kbd, asTip) => `<div class="accrow"${asTip && descKey ? ` data-tip="${esc(E.t(descKey))}"` : ''}><div class="acclblw"><span class="acclbl">${esc(E.t(lblKey))}${kbd ? ` <span class="kbd">${kbd}</span>` : ''}</span></div>${control}</div>`;
      const item = (act, v, ic, lblKey, descKey, extra, kbd, asTip) => `<button class="accitem" role="menuitem" data-act="${act}"${v ? ` data-v="${v}"` : ''}${extra || ''}${asTip && descKey ? ` data-tip="${esc(E.t(descKey))}"` : ''}>${icon(ic,15)}<span class="grow taS">${esc(E.t(lblKey))}</span>${kbd ? `<span class="kbd">${kbd}</span>` : ''}</button>`;
      const demo = !!(window.EKO_BUILD && window.EKO_BUILD.demo);
      out += `<div class="scrim scrimclear" data-born="${E.state.born==='dlg'?1:0}" data-act="closeDlg"></div>
      <div class="dlg dlgdrop dropEnd accmenu" data-born="${E.state.born==='dlg'?1:0}" role="menu" aria-label="${esc(E.t('accountTip'))}">
        <div class="draghandle"></div>
        <div class="accid"><span class="avatar accavatar" aria-hidden="true">AY</span><div class="col accwho"><b>${esc(E.lang==='ar' ? (u.nameAr||u.name||'') : (u.name||''))}</b><span class="accrole">${esc(E.t(roleKey))}${previewing ? ` <span class="accprev">${esc(E.t('rolePreviewTag'))}</span>` : ''}</span></div></div>
        ${demo ? `<div class="accdemobox" data-tip="${esc(E.t('demoRoleNote'))}"><span class="accdemolbl"><span class="accdemotag">${esc(E.t('menuDemo'))}</span>${esc(E.t('demoRole'))}</span>
          <div class="segbox row accsegs">${['technician','engineer','executive'].map(r => seg('rolePreview', r, E.t({ technician:'roleTechnician', engineer:'roleEngineer', executive:'roleExecutive' }[r]), E.role() === r)).join('')}</div></div>` : ''}
        <div class="accfoot"><button class="btnG accsignout" role="menuitem" data-act="signOut" data-tip="${esc(E.t('signOutD'))}">${esc(E.t('signOut'))}</button></div>
      </div>`;
    } else if(d === 'report'){
      out += window.EKO_RV.panel(E);                              /* D88/D92 quick launcher */
    } else if(d === 'rpconfirm'){
      out += window.EKO_RV.confirmDialog(E);                      /* D92: what was understood */
    } else if(d === 'help'){
      /* D78/D79: Help — a fixed head (title, search, Legend | Shortcuts) over a
         scrolling body. The legend renders js/layouts/help.js; the shortcuts
         tab lists every key. */
      const H = window.EKO_LAYOUTS.help, tab = E.state.helpTab === 'keys' ? 'keys' : 'legend';
      const glyph = g => g.kind === 'sev' ? C.sevGlyph(g.sev, !!g.ack, 16, !!g.marker)
        : g.kind === 'icon' ? icon(g.name, 16)
        : g.kind === 'badge' ? `<span class="cbadge" data-sev="${esc(g.sev||'medium')}">${esc(g.text)}</span>`
        : `<span class="hpword">${esc(E.t(g.key))}</span>`;
      const row = (lbl, keys) => `<div class="aprow hpkey"><dt>${esc(E.t(lbl))}</dt><dd class="row gap4">${keys.map(k=>`<span class="kbd">${esc(k)}</span>`).join('')}</dd></div>`;
      const legend = H.sections.map(s => `<div class="hpsec"><span class="tLbl seclbl">${esc(E.t(s.t))}</span>
          ${s.items.map(it => `<div class="hprow" data-q="${esc((E.t(it.t)+' '+E.t(it.b)).toLowerCase())}"><span class="hpg">${it.g.kind === 'word' ? '' : glyph(it.g)}</span>
            <div class="hpbody">${it.g.kind === 'word' ? glyph(it.g) : ''}<b>${esc(E.t(it.t))}</b><span>${esc(E.t(it.b))}</span></div></div>`).join('')}</div>`).join('');
      const keys = `<div class="hpsec"><span class="tLbl seclbl">${esc(E.t('kbNavH'))}</span>
        ${row('kbCollapse',['['])}${row('searchW',['Ctrl','K'])}${row('askTitle',['Ctrl','/'])}${row('hpTitle',['?'])}${row('kbClose',['Esc'])}</div>
        <div class="hpsec"><span class="tLbl seclbl">${esc(E.t('kbViewH'))}</span>
        ${row('kbTheme',['T'])}${row('kbArabic',['Shift','R'])}</div>
        <div class="hpsec"><span class="tLbl seclbl">${esc(E.t('kbViewerH'))}</span>
        ${window.EKO_LAYOUTS.tools.all.filter(t => t.kind !== 'more').map(t => row(t.label,[t.key])).join('')}${row('vbarCollapse',[window.EKO_LAYOUTS.tools.expandKey])}${row('kbEscSelect',['Esc'])}</div>
        <div class="hpsec"><span class="tLbl seclbl">${esc(E.t('kbTlH'))}</span>
        ${row('kbBackLive',['End'])}</div>`;
      out += `<div class="scrim" data-born="${E.state.born==='dlg'?1:0}" data-act="closeDlg"></div>
      <div class="dlg dlghelp" data-born="${E.state.born==='dlg'?1:0}" role="dialog" aria-label="${esc(E.t('hpTitle'))}">
        <div class="hphead">
          <div class="draghandle"></div><div class="dlghead"><h2>${esc(E.t('hpTitle'))}</h2>
          <button class="iconbtn msA" data-act="closeDlg" aria-label="${esc(E.t('close'))}">${icon('x',14)}</button></div>
          <div class="segbox row hptabs" role="tablist">
            <button class="seg" role="tab" data-on="${tab==='legend'}" aria-selected="${tab==='legend'}" data-act="helpTab" data-v="legend">${esc(E.t('hpTabLegend'))}</button>
            <button class="seg" role="tab" data-on="${tab==='keys'}" aria-selected="${tab==='keys'}" data-act="helpTab" data-v="keys">${esc(E.t('kbTitle'))}</button></div>
          ${tab==='legend' ? `<input class="vpq hpq" type="search" placeholder="${esc(E.t('hpFind'))}" aria-label="${esc(E.t('hpFind'))}" autocomplete="off">` : ''}
        </div>
        <div class="hpscroll" role="tabpanel">${tab==='legend' ? legend : keys}</div></div>`;
    } else if(d === 'teaser'){
      out += window.EKO_ADDONS.dialog(E);                          /* D125: one add-on dialog from the catalogue */
    } else if(d === 'addons' || d === 'settings'){
      /* D129: SETTINGS — Appearance (theme, layout), Administration (modules and add-ons), Security (PIN, audit) */
      const tab = d === 'addons' ? 'administration' : (['appearance', 'system', 'administration', 'security'].includes(E.state.settingsTab) ? E.state.settingsTab : 'appearance');
      const segT = (v, lbl, on) => `<button class="seg" data-on="${on}" data-act="theme" data-v="${v}" aria-pressed="${on}">${esc(lbl)}</button>`;
      const tabBtn = (v, key) => `<button class="seg" role="tab" data-on="${tab === v}" aria-selected="${tab === v}" data-act="settingsTab" data-v="${v}">${esc(E.t(key))}</button>`;
      let body = '';
      if(tab === 'appearance'){
        body = `<div class="strow"><div class="col grow"><b>${esc(E.t('menuTheme'))}</b><span class="tCap">${esc(E.t('themeD'))}</span></div>
            <div class="segbox row">${segT('auto', E.t('thAuto'), E.state.themeMode==='auto')}${segT('light', E.t('thLight'), E.state.themeMode==='light')}${segT('dark', E.t('thDark'), E.state.themeMode==='dark')}</div></div>
          <div class="strow"><div class="col grow"><b>${esc(E.t('stLayout'))}</b><span class="tCap">${esc(E.t('resetD'))}</span></div>
            ${E.state.rlAsk ? `<button class="btnG btnSm accwarn" data-act="resetLayout2">${esc(E.t('resetLayoutConfirm'))}</button>` : `<button class="btnG btnSm" data-act="resetLayout">${esc(E.t('resetLayout'))}</button>`}</div>`;
      } else if(tab === 'system'){
        /* D131: System — the connection's sources (heartbeat fields) and the configured integrations (data.integrations), read-only */
        const F = window.EKO_PWA && window.EKO_PWA.feed ? window.EKO_PWA.feed() : { mode:'online', sources:[], hbMs:15000, timeoutMs:5000 };
        const rank = st => ({ disconnected:0, down:0, error:0, stale:1, ok:2 })[st] ?? 1;
        const srcName = id => { const k = 'src.' + id, t = E.t(k); return t === k ? String(id).toUpperCase() : t; };
        const chipKey = st => ['ok', 'stale', 'disconnected', 'error', 'down'].includes(st) ? 'hb.' + st : null;
        const head = F.mode === 'offline' ? E.t('connHdrOff', { t: E.state.offlineSince || '' }) : F.mode === 'degraded' ? E.t('connHdrDeg', { t: E.state.degradedSince || '' }) : E.t('connOk');
        const srows = F.sources.slice().sort((x, y) => rank(x.status) - rank(y.status)).map(src => `<div class="hbrow" data-st="${esc(src.status)}"><span class="hbname">${esc(srcName(src.id))}</span><span class="hbchip" data-st="${esc(src.status)}">${esc(chipKey(src.status) ? E.t(chipKey(src.status)) : src.status)}</span>${src.lastSample ? `<span class="hbago tMonoS tipU" data-tip="${esc(E.t('hbLastSample', { t: new Date(src.lastSample).toLocaleString(E.lang === 'ar' ? 'ar-AE' : 'en-GB') }))}">${esc(agoOf(src.lastSample))}</span>` : `<span class="hbago tMonoS">${esc(E.t('emptyDash'))}</span>`}</div>`).join('');
        const ints = E.data.integrations || [];
        const irows = ints.map(i => `<tr><td>${esc(i.name)}</td><td class="tMonoS">${esc(i.proto || '')}</td><td>${esc(E.ph(i.st || ''))}</td><td class="tMonoS">${esc(E.ph(i.hb || ''))}</td><td class="tMonoS">${esc(E.ph(i.pts || ''))}</td></tr>`).join('');
        body = `<div class="stsys"><div class="hbhead"><span class="conndot" data-mode="${esc(F.mode)}"></span><b>${esc(head)}</b></div>
            <div class="tLbl hblbl">${esc(E.t('connSources'))}</div>${srows || `<p class="tCap hbnote">${esc(E.t(F.served === false ? 'connLocal' : F.mode === 'offline' ? 'connNoHb' : 'connWaiting'))}</p>`}
            <p class="tCap stsysnote">${esc(E.t('stSysCheck', { i: Math.round(F.hbMs / 1000), o: Math.round(F.timeoutMs / 1000) }))}</p>
            <div class="tLbl hblbl">${esc(E.t('stSysInteg'))}</div>
            ${irows ? `<div class="audwrap"><table class="audt stinteg"><thead><tr><th>${esc(E.t('intCol.name'))}</th><th>${esc(E.t('intCol.proto'))}</th><th>${esc(E.t('intCol.st'))}</th><th>${esc(E.t('intCol.hb'))}</th><th>${esc(E.t('intCol.pts'))}</th></tr></thead><tbody>${irows}</tbody></table></div>` : `<p class="tCap hbnote">${esc(E.t('stSysNoInteg'))}</p>`}
          </div>`;
      } else if(tab === 'administration'){ body = window.EKO_ADDONS ? window.EKO_ADDONS.adminBody(E) : ''; }
      else { body = window.EKO_CTL && window.EKO_CTL.securityBody ? window.EKO_CTL.securityBody(E) : ''; }
      out += `<div class="scrim" data-born="${E.state.born==='dlg'?1:0}" data-act="closeDlg"></div>
      <div class="dlg dlgsettings" data-born="${E.state.born==='dlg'?1:0}" role="dialog" aria-label="${esc(E.t('stTitle'))}">
        <div class="draghandle"></div><div class="dlghead"><h2>${esc(E.t('stTitle'))}</h2>
        <button class="iconbtn msA" data-act="closeDlg" aria-label="${esc(E.t('close'))}">${icon('x',14)}</button></div>
        <div class="segbox row sttabs" role="tablist">${tabBtn('appearance', 'stAppearance')}${tabBtn('system', 'stSystem')}${tabBtn('administration', 'accAdmin')}${tabBtn('security', 'stSecurity')}</div>
        <div class="stbody" data-tab="${tab}">${body}</div>
      </div>`;
    } else if(d === 'conn'){
      /* D130: the connection popover — informational, built only from the heartbeat contract:
         ok, ts, feed.status, feed.sources.<id>.status, feed.sources.<id>.lastSample, plus the
         client's interval and timeout. No control, no retry, no chart, no log. */
      const F = window.EKO_PWA && window.EKO_PWA.feed ? window.EKO_PWA.feed() : { mode:'online', sources:[], ts:null, hbMs:15000, timeoutMs:5000 };
      const mode = F.mode, rank = st => ({ disconnected:0, down:0, error:0, stale:1, ok:2 })[st] ?? 1;
      const srcName = id => { const k = 'src.' + id, t = E.t(k); return t === k ? String(id).toUpperCase() : t; };
      const chipKey = st => ['ok', 'stale', 'disconnected', 'error', 'down'].includes(st) ? 'hb.' + st : null;
      const rows = F.sources.slice().sort((x, y) => rank(x.status) - rank(y.status)).map(src => `<div class="hbrow" data-st="${esc(src.status)}">
          <span class="hbname">${esc(srcName(src.id))}</span>
          <span class="hbchip" data-st="${esc(src.status)}">${esc(chipKey(src.status) ? E.t(chipKey(src.status)) : src.status)}</span>
          ${src.lastSample ? `<span class="hbago tMonoS tipU" data-tip="${esc(E.t('hbLastSample', { t: new Date(src.lastSample).toLocaleString(E.lang === 'ar' ? 'ar-AE' : 'en-GB') }))}">${esc(agoOf(src.lastSample))}</span>` : `<span class="hbago tMonoS">${esc(E.t('emptyDash'))}</span>`}
        </div>`).join('');
      const head = mode === 'offline' ? E.t('connHdrOff', { t: E.state.offlineSince || '' }) : mode === 'degraded' ? E.t('connHdrDeg', { t: E.state.degradedSince || '' }) : E.t('connOk');
      out += `<div class="scrim scrimclear" data-born="${E.state.born==='dlg'?1:0}" data-act="closeDlg"></div>
      <div class="dlg dlgdrop dropMid connpop" data-born="${E.state.born==='dlg'?1:0}" data-mode="${mode}" role="dialog" aria-label="${esc(E.t('connTitle'))}">
        <div class="draghandle"></div>
        <div class="hbhead"><span class="conndot" data-mode="${mode}"></span><b>${esc(head)}</b><button class="iconbtn msA" data-act="closeDlg" aria-label="${esc(E.t('close'))}">${icon('x',13)}</button></div>
        ${mode === 'offline' && F.ts ? `<p class="tCap hbnote">${esc(E.t('connLastHb', { t: hhmmOf(F.ts) }))}</p>` : ''}
        <div class="tLbl hblbl">${esc(E.t('connSources'))}</div>
        ${rows || `<p class="tCap hbnote">${esc(E.t(F.served === false ? 'connLocal' : mode === 'offline' ? 'connNoHb' : 'connWaiting'))}</p>`}
        <div class="hbfoot"><span>${esc(E.t('connChecked', { i: Math.round(F.hbMs / 1000) }))}</span><button class="statlink" data-act="dlg" data-v="settings" data-stab="system">${esc(E.t('connHealth'))}</button></div>
      </div>`;
    } else if(d === 'signout'){
      out += `<div class="scrim" data-born="${E.state.born==='dlg'?1:0}" data-act="closeDlg"></div>
      <div class="dlg dlgsignout" data-born="${E.state.born==='dlg'?1:0}" role="dialog" aria-label="${esc(E.t('signOutQ'))}">
        <div class="draghandle"></div><div class="dlghead"><h2>${esc(E.t('signOutQ'))}</h2>
        <button class="iconbtn msA" data-act="closeDlg" aria-label="${esc(E.t('close'))}">${icon('x',14)}</button></div>
        <p class="tCap">${esc(E.t('signOutNote'))}</p>
        <div class="row gap8"><button class="btnP" data-act="signOut2">${esc(E.t('signOut'))}</button><button class="btnG" data-act="closeDlg">${esc(E.t('cancelW'))}</button></div>
      </div>`;
    } else if(d === 'alerts'){
      /* D81: head · filter bar · scrolling list · footer. Chips carry the
         SITE counts (the canonical-12 law: filters never change counts). */
      const hid = E.state.alarmF.sev, all = E.data.alarms;
      const vis = E.visAlarms();
      const cnt = sev => all.filter(a => a.sev === sev).length;
      const chip = (sev, key) => `<button class="acchip" data-on="${!hid.has(sev)}" data-act="fltSev" data-v="${sev}" aria-pressed="${!hid.has(sev)}"
        data-tip="${esc(E.t(hid.has(sev) ? 'acChipShow' : 'acChipHide', { s: E.t(key) }))}">${C.sevGlyph(sev,false,12)}<span>${esc(E.t(key))}</span><span class="acn">${cnt(sev)}</span></button>`;
      const ackChip = `<button class="acchip" data-on="${E.state.showAcked}" data-act="ackTgl" aria-pressed="${E.state.showAcked}"
        data-tip="${esc(E.t(E.state.showAcked ? 'acAckHide' : 'acAckShow'))}">${C.sevGlyph('medium',true,12)}<span>${esc(E.t('acAckShort'))}</span><span class="acn">${all.filter(a=>a.ack).length}</span></button>`;
      const filtered = hid.size > 0 || !E.state.showAcked;
      const rows = vis.map(a => `<button class="acalr" data-act="alertGo" data-asset="${esc(a.asset)}">
        <span data-tip="${esc(C.sevTipFor(E, a))}">${C.sevGlyph(a.sev, !!a.ack, 13)}</span><span class="tMonoS fw6 flexnone">${esc(a.asset)}</span>
        ${(l => `<span class="acwhat grow taS" data-tip="${esc(l.main + (l.sub ? ' · ' + l.sub : ''))}" data-tipif="trunc">${esc(l.main)}${l.sub ? `<span class="alrtech acsub">${esc(l.sub)}</span>` : ''}</span>`)(E.alarmLines(a, true))}
        <span class="tMonoS cT3 flexnone">${esc(E.fmtAge(a.ageH))}</span></button>`).join('');
      out += `<div class="scrim scrimclear" data-born="${E.state.born==='dlg'?1:0}" data-act="closeDlg"></div>
      <div class="dlg dlgdrop dropMid dlgalerts" data-born="${E.state.born==='dlg'?1:0}" role="dialog" aria-label="${esc(E.t('alertCentre'))}">
        <div class="draghandle"></div>
        <div class="dlghead achead"><h2>${esc(E.t('alertCentre'))}</h2><span class="acmeta" data-tip="${esc(E.t('alarmsMetaTip'))}">${esc(E.t('acActiveN',{n:vis.filter(a=>!a.ack).length}))}</span>
          <button class="iconbtn msA" data-act="closeDlg" aria-label="${esc(E.t('close'))}">${icon('x',14)}</button></div>
        <div class="acfilters" role="group" aria-label="${esc(E.t('acSevT'))}" data-model="${E.state.markersOn}">
          <button class="acchip acmaster" data-on="${E.state.markersOn}" data-act="mkToggle" aria-pressed="${E.state.markersOn}"
            data-tip="${esc(E.t(E.state.markersOn ? 'mkHideTip' : 'mkShowTip'))}">${icon(E.state.markersOn ? 'eye' : 'eyeOff', 13)}<span>${esc(E.t('acOnModel'))}</span></button>
          <span class="acsep" aria-hidden="true"></span>
          ${chip('critical','acCrit')}${chip('high','acHigh')}${chip('medium','acMed')}${ackChip}
          ${(filtered || !E.state.markersOn) ? `<button class="statlink acreset" data-act="fltReset">${esc(E.t('acReset'))}</button>` : ''}</div>
        ${E.state.markersOn ? '' : `<p class="acnote">${icon('eyeOff', 12)}<span>${esc(E.t('acHiddenNote'))}</span></p>`}
        ${E.wording() === 'plain' ? `<div class="alldisc"><button class="statlink" data-act="disclose" data-k="tech" aria-pressed="${E.disclose('tech')}">${esc(E.t(E.disclose('tech') ? 'hideTech' : 'discloseTech'))}</button></div>` : ''}
        <div class="aclist">${rows || `<p class="alempty">${esc(E.t('allClearShort'))}</p>`}</div>
        <div class="alfoot">${esc(E.t('fireLS',{n:E.data.lifeSafetyActive}))}</div>
      </div>`;
    } else if(d === 'switcher'){
      out += `<div class="scrim scrimclear" data-born="${E.state.born==='dlg'?1:0}" data-act="closeDlg"></div>
      <div class="dlg dlgdrop dropStart" data-born="${E.state.born==='dlg'?1:0}" role="menu" aria-label="${esc(E.t('portOverview'))}"><div class="draghandle"></div><div class="col gap4">
        <button class="palrow pfswitch" data-on="${E.state.pageId==='portfolio'}" data-act="pfGo">${icon('map',13)}<span class="grow taS">${esc(E.t('pfSwitcherAll'))}</span><span class="tCap">${window.EKO_DATA.portfolio.length}</span></button>
        <div class="accsep" role="separator"></div>
        ${window.EKO_DATA.portfolio.map(p => `<button class="palrow" data-on="${p.key==='marsa'}" data-act="${p.open?'closeDlg':'none'}" ${p.open?'':'disabled'}>
          <span class="grow taS">${esc(E.lang==='ar'?p.nameAr:p.nameEn)}</span>
          <span class="tCap">${esc(E.lang==='ar'?p.cityAr:p.cityEn)}</span></button>`).join('')}</div></div>`;
    } else if(d === 'pal'){
      const q = (E.state.palQ||'').toLowerCase();
      const pages = E.nav.modules.filter(m=>!m.hidden).flatMap(m => [
        { kind:'page', label:E.t(m.label), go:{page:m.pageId,mod:m.id}, locked:!!m.locked, teaser:m.teaser || m.id, mod:m.id },
        ...(m.subs||[]).filter(s => !s.hidden).map(s => ({ kind:'page', label:E.t(m.label)+' · '+E.t(s.label), go:{page:s.pageId,mod:m.id,sub:s.id}, locked:!!s.locked, teaser:s.teaser || (m.id + '.' + s.id), mod:m.id }))
      ]);
      const assets = E.data.assets.map(a => ({ kind:'asset', label:a.id, sub:a.zone }));
      /* D69: every viewer tool with its shortcut ("viewer" lists them all) */
      const tools = window.EKO_LAYOUTS.tools.all.filter(t => t.kind !== 'more').map(t => ({ kind:'tool', label:E.t('palTool',{t:E.t(t.label)}), sub:t.key, tool:t.id }));
      const hits = (q ? pages.filter(p=>p.label.toLowerCase().includes(q))
          .concat(tools.filter(t=>t.label.toLowerCase().includes(q)||t.sub.toLowerCase()===q))
          .concat(assets.filter(a=>a.label.toLowerCase().includes(q)||a.sub.toLowerCase().includes(q))) : pages).slice(0,8);
      E._palHits = hits;
      out += `<div class="scrim" data-born="${E.state.born==='dlg'?1:0}" data-act="closeDlg"></div>
      <div class="palbox" data-born="${E.state.born==='dlg'?1:0}" role="dialog" aria-label="${esc(E.t('searchW'))}">
        <div class="palrowin"><input id="palin" value="${esc(E.state.palQ||'')}" placeholder="${esc(E.t('palHint'))}" aria-label="${esc(E.t('searchW'))}">
        <button class="iconbtn icon26" data-act="closeDlg" aria-label="${esc(E.t('close'))}">${icon('x',12)}</button></div>
        <div class="col">${hits.length ? hits.map((h,i) => `<button class="palrow" data-on="${i===E.state.palSel}" data-act="palGo" data-i="${i}"${h.kind==='tool'?` data-tip="${esc(h.label)}" data-kbd="${esc(h.sub)}"`:''}>
            ${icon(h.kind==='asset'?'box':h.kind==='tool'?'tools':h.locked?'lock':'layout',14)}<span class="grow taS">${esc(h.label)}</span>
            ${h.kind==='tool'?'':h.locked?`<span class="tCap">${esc(E.t('lockedTip'))}</span>`:h.sub?`<span class="tCap">${esc(h.sub)}</span>`:''}</button>`).join('')
          : `<p class="alempty">${esc(E.t('palEmpty'))}</p>`}</div></div>`;
    }
    return out + (window.EKO_CTL ? window.EKO_CTL.overlays(E) : '') + (window.EKO_NF ? window.EKO_NF.overlays(E) : '') + (window.EKO_PWA ? window.EKO_PWA.overlays(E) : '');
  }

  /* -------------------------------- render --------------------------------- */
  const $ = id => document.getElementById(id);
  let keptHost = null;   /* live #enginehost, re-adopted across renders so the
                            scene never re-mounts (no image flash on clicks) */
  /* D86: markup is rebuilt on every state change, which would reset every
     scroller to the top (the alarms panel jumped when the account menu
     opened). Positions are captured before the rebuild and restored after,
     matched by selector and order. */
  const SCROLLERS = ['#modcontent', '.ovpad', '.apbody', '.nflist', '.regscroll', '.dgscroll', '.dlg', '.aclist', '.vplist', '#ekonav', '.rpwrap', '.rphub'];
  function keepScroll(){
    const saved = SCROLLERS.map(sel => [sel, [...document.querySelectorAll(sel)].map(el => el.scrollTop)]);
    return () => saved.forEach(([sel, tops]) => document.querySelectorAll(sel).forEach((el, i) => { if(tops[i]) el.scrollTop = tops[i]; }));
  }
  function render(){
    if(!$('topbar') || !$('ekonav') || !$('mount') || !$('mobtabs') || !$('overlays')) return;
    if(window.EKO_ADDONS) window.EKO_ADDONS.apply(E);   /* D125: entitlements stamp locked/hidden before anything reads the nav */
    if(E.state.wall && window.EKO_WALL){   /* D106: a display context — no rail, no ask bar, no overlays, no pointer */
      (window.DASHBOARD_ROOT||document.documentElement).setAttribute('data-wall', '1');
      const liveW = document.getElementById('enginehost'); if(liveW && liveW.dataset.live === '1') keptHost = liveW;
      $('mount').innerHTML = window.EKO_WALL.render(E);
      const freshW = document.getElementById('enginehost'); if(freshW && keptHost) freshW.replaceWith(keptHost);
      $('topbar').innerHTML = ''; $('ekonav').innerHTML = ''; $('mobtabs').innerHTML = ''; $('overlays').innerHTML = '';
      if(document.getElementById('enginehost')) window.EKO_V.mountEngine(E);
      window.EKO_WALL.mount();
      if (window.syncWallHole) {
        window.syncWallHole();
        requestAnimationFrame(window.syncWallHole);
      }
      E.state.born = null; return;
    }
    const restoreScroll = keepScroll();
    if(window.EKO_SURF) window.EKO_SURF.reconcile();            /* R2 (D67) */
    (window.DASHBOARD_ROOT||document.documentElement).setAttribute('data-nav', E.state.navMin ? 'min' : 'full');
    /* D94: the shell states CSS cannot see — stacked vs split, a short desktop window, the model mode */
    const stacked = E.stacked();
    (window.DASHBOARD_ROOT||document.documentElement).setAttribute('data-stacked', stacked ? '1' : '0');
    (window.DASHBOARD_ROOT||document.documentElement).setAttribute('data-short', (!stacked && window.innerHeight <= 820) ? '1' : '0');
    (window.DASHBOARD_ROOT||document.documentElement).setAttribute('data-modelfs', (stacked && E.state.modelFs) ? '1' : '0');
    (window.DASHBOARD_ROOT||document.documentElement).setAttribute('data-hist', E.state.histAge != null ? '1' : '0');
    const live = document.getElementById('enginehost');
    if(live && live.dataset.live === '1') keptHost = live;
    $('topbar').innerHTML = topbar();
    $('ekonav').setAttribute('aria-label', E.t('ariaModules')); $('mobtabs').setAttribute('aria-label', E.t('ariaModules'));   /* D122: static labels follow the language */
    $('ekonav').setAttribute('data-born',
      E.state.born === 'boot' ? 'boot'
      : E.state.born === 'navx' ? 'x'
      : (E.state.born === 'nav' || /^nsub:/.test(E.state.born || '')) ? '1' : '0');
    $('ekonav').innerHTML = navRail();
    $('mount').innerHTML = (stacked ? pagehead() : '') + P.renderPage(E);
    const fresh = document.getElementById('enginehost');
    if(fresh && keptHost) fresh.replaceWith(keptHost);
    $('mobtabs').innerHTML = mobtabs();
    $('overlays').innerHTML = overlays();
    if(document.getElementById('enginehost')) window.EKO_V.mountEngine(E);
    clock();
    const pal = $('palin'); if(pal){ pal.focus(); pal.setSelectionRange(pal.value.length, pal.value.length); }
    const drop = document.querySelector('.dlgdrop.dropMid');
    if(drop && E.state.dlg){
      const place = () => {
        const v = E.state.dlg;
        const openers = document.querySelectorAll('[data-act="dlg"][data-v="' + v + '"]');
        let opener = openers[0] || null;
        if(openers.length > 1 && E.state.dlgAnchor != null){
          let best = Infinity;
          openers.forEach(o => {
            const r = o.getBoundingClientRect();
            const d = Math.abs((r.left + r.right) / 2 - E.state.dlgAnchor);
            if(d < best){ best = d; opener = o; }
          });
        }
        const ovEl = $('overlays') || window.DASHBOARD_ROOT;
        if(!opener || !ovEl) return;
        const br = opener.getBoundingClientRect();
        const ov = ovEl.getBoundingClientRect();
        const w = Math.min(drop.classList.contains('dlgalerts') ? 360 : 300, Math.max(200, ov.width - 24));
        drop.style.position = 'absolute';
        drop.style.inset = 'auto';
        drop.style.insetInlineStart = 'auto';
        drop.style.insetInlineEnd = 'auto';
        drop.style.width = w + 'px';
        drop.style.maxWidth = 'none';
        drop.style.margin = '0';
        drop.style.right = 'auto';
        drop.style.bottom = 'auto';
        let x = br.left + br.width / 2 - ov.left - w / 2;
        x = Math.max(12, Math.min(x, ov.width - w - 12));
        const y = Math.max(8, br.bottom - ov.top + 6);
        drop.style.left = x.toFixed(0) + 'px';
        drop.style.top = y.toFixed(0) + 'px';
      };
      place();
      requestAnimationFrame(place);
    }
    restoreScroll();                                             /* D86 */
    if(window.EKO_BVA) window.EKO_BVA.mount(E);                   /* D96: pixel charts after the frame is built */
    if(window.EKO_DG) window.EKO_DG.mount();                       /* D100c: header fit + popovers under their opener */
    /* D87: attributes and inline sizes owned by the shell engines (panel
       compact variant, phone sheet heights) live on elements the rebuild
       just replaced — re-apply them in this same frame, never on the next
       300 ms tick, or the panel visibly re-lays out after every click. */
    if(window.EKO_SPLIT && window.EKO_SPLIT.sync) window.EKO_SPLIT.sync();
    if(window.EKO_SHEET && window.EKO_SHEET.sync) window.EKO_SHEET.sync();
    E.state.born = null;
    if(window.EKO_SURF) window.EKO_SURF.afterRender();          /* R5 (D67) */
    if(window.EKO_MAP && document.querySelector('.pfcard')) window.EKO_MAP.after();   /* D122: keep the marker card inside the map box */
    if(window.EKO_AI) window.EKO_AI.after();                     /* D132: the conversation panel's geometry and scroll */
  }
  function clock(){
    const el = $('clock'); if(!el) return;
    const d = new Date();
    el.textContent = String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');   /* D123: minutes only on the workstation; the wall keeps seconds */
  }
  setInterval(clock, 5000);

  /* ------------------------------- actions --------------------------------- */
  /* D75: every transient message goes through the ONE feedback toast */
  function toast(msg, tone, action){ if(window.EKO_FB) window.EKO_FB.toast({ text: msg, tone: tone || 'info', action }); }

  const ACTS = {
    goMod(el){ const m = E.nav.modules.find(x=>x.id===el.dataset.mod);
      if(!E.state.exp[m.id]) E.state.born = 'nsub:'+m.id;
      E.state.exp = { [m.id]: true }; E.state.moduleLabel = m.label;
      E.go(el.dataset.page || 'stub', m.id, null); },
    goSub(el){ E.go(el.dataset.page || 'stub', el.dataset.mod, el.dataset.sub); },
    /* D94: page-header sub tabs; model mode; the ask dialog on the stacked shell */
    phGo(el){ E.go(el.dataset.page || 'stub', el.dataset.mod, el.dataset.sub || null); },
    modelFs(){ E.set({ modelFs: !E.state.modelFs, born: E.state.modelFs ? null : 'dlg', mkPop:null }); },
    nfPage(){ E.go('notifications', 'overview', null); },
    bvaRange(el){ E.set({ bvaRange: el.dataset.v }); },   /* D96 */
    /* Widget maximise (client request): ⛶ opens the widget enlarged in a
       centred dialog — a live snapshot clone, closed by ✕, Esc or the
       backdrop. Charts scale up because they are width-relative SVGs. */
    wmax(el){
      const w = el.closest('.pwwidget,.pwtile,.alcard,.syscard,.ovk');
      if(!w) return;
      ACTS.wmaxClose();
      const ov = document.createElement('div');
      ov.id = 'wmaxov';
      const wl = w.querySelector('.alcardt, .ovklbl, .pwth'); const wlbl = wl ? wl.textContent.trim() : '';
      const wc = w.querySelector('.alcardm, .ovkcap'); const wcap = wc ? wc.textContent.trim() : '';
      ov.innerHTML = `<div class="wmaxbox" role="dialog" aria-modal="true">
        <button class="wmaxai aibtn tipU" data-act="aiOpen" data-ai-label="${C.esc(wlbl)}" data-ai-cap="${C.esc(wcap)}" data-tip="${C.esc(E.t('ai.about'))}" aria-label="${C.esc(E.t('ai.about'))}">${C.icon('spark', 16)}</button>
        <button class="wmaxx" data-act="wmaxClose" aria-label="${C.esc(E.t('close'))}">✕</button>
        <div class="wmaxbody"></div></div>`;
      const clone = w.cloneNode(true);
      clone.querySelectorAll('.wchrome').forEach(n => n.remove());
      ov.querySelector('.wmaxbody').appendChild(clone);
      ov.addEventListener('click', ev => { if(ev.target === ov) ACTS.wmaxClose(); });
      (window.DASHBOARD_ROOT || document.body).appendChild(ov);
      ov.querySelector('.wmaxx').focus();
    },
    wmaxClose(){ const ov = document.getElementById('wmaxov'); if(ov) ov.remove(); },
    /* Asset panel wide mode: a real state toggle (not a snapshot) so the
       tabs, work-order buttons and live values keep working while wide. */
    apWide(){ E.set({ apWide: !E.state.apWide }); },
    goPage(el){ E.go(el.dataset.page || 'stub', E.state.module, el.dataset.sub || null); },
    goAlarms(){ E.go('marsa-overview', 'overview', null); },
    teaser(el){ const m = E.nav.modules.find(x=>x.id===el.dataset.mod);
      if(m) E.state.moduleLabel = m.label;
      E.set({ born:'dlg', teaserKey: el.dataset.teaser, dlg:'teaser', mobMore:false }); },
    pageBack(){ if(window.EKO_SURF) window.EKO_SURF.back(); },
    /* D125/D126: add-ons — the administration page's switches */
    addonState(el){ window.EKO_ADDONS.setState(E, el.dataset.key, el.dataset.v); window.EKO_ADDONS.apply(E); if(E.state.module && window.EKO_ADDONS.lockFor(E, E.state.module, E.state.sub)){   /* re-stamp first: if the page we are on just became an add-on, go to the landing */ const l = E.landing(); E.state.pageId = l.pageId; E.state.module = l.module; E.state.sub = null; } render(); },
    addonShow(el){ window.EKO_ADDONS.setOption(E, 'showAddOns', el.dataset.v === '1'); render(); },
    addonReset(){ window.EKO_ADDONS.reset(); render(); },
    navExp(el, ev){ ev.stopPropagation(); const id = el.dataset.mod;
      const willOpen = !E.state.exp[id];
      E.state.exp = willOpen ? { [id]: true } : {};
      if(willOpen) E.state.born = 'nsub:'+id;
      render(); },
    navMin(){ E.state.navMin = !E.state.navMin; if(!E.state.navMin) E.state.born = 'navx';
      ls.set('eko-nav', E.state.navMin?'min':'full'); render(); },
    sysExpTgl(el, ev){ ev.stopPropagation(); const g = el.dataset.v;
      E.state.sysExp[g] = E.state.sysExp[g] === false; render(); },
    ovpMin(){ E.state.ovpMin = !E.state.ovpMin; ls.set('eko-ovp', E.state.ovpMin?'min':'full'); render(); },
    panMin(){ E.state.panMin = !E.state.panMin; ls.set('eko-pan', E.state.panMin?'min':'full'); render(); },
    regMin(){ E.state.regMin = !E.state.regMin; ls.set('eko-reg', E.state.regMin?'min':'full'); render(); },
    mobMore(){ E.set({ born: E.state.mobMore?null:'dlg', mobMore: !E.state.mobMore }); },

    lang(el){ E.lang = el.dataset.v; ls.set('eko-lang', E.lang); applyLang(); render(); },
    theme(el){ E.state.themeMode = el.dataset.v; ls.set('eko-theme-mode', el.dataset.v); applyTheme(); render(); },
    /* D129: the top-bar toggle cycles light and dark explicitly (Auto is a Settings choice) */
    themeToggle(){ const dark = (window.DASHBOARD_ROOT||document.documentElement).getAttribute('data-theme') !== 'light'; E.state.themeMode = dark ? 'light' : 'dark'; ls.set('eko-theme-mode', E.state.themeMode); applyTheme(); render(); },
    settingsTab(el){ E.state.rlAsk = false; E.set({ settingsTab: el.dataset.v }); },
    signOut(){ E.set({ born:'dlg', dlg:'signout' }); },
    signOut2(){ try{ if(window.EKO_CTL && window.EKO_CTL.ACTS.ctlLockNow) window.EKO_CTL.ACTS.ctlLockNow(); }catch(e){}   /* the control session ends with the user */
      if(window.EKO_SURF) window.EKO_SURF.closeAll(); E.state.rolePreview = null; E.set({ dlg:null, assetSel:null, mobMore:false, signedOut:true }); },
    signIn(){ location.reload(); },   /* prototype: production sends the user to the identity provider (production-readiness.md) */
    wallOpen(){ const url = wallUrl(wallScope(), 'tab', E.state.wallCfgId); E.state.dlg = null; if(window.__wallOpenHook) window.__wallOpenHook(url); else window.open(url, '_blank', 'noopener'); render(); },   /* D107 */
    /* D109: the control room settings dialog, per display */
    wallCfg(el){ const id = E.state.wallCfgId || 'default', k = el.dataset.k, v = el.value, patch = {};
      if(k === 'panel'){ const m = /^(\d+)x(\d+)$/.exec(v); patch.panelW = m ? +m[1] : null; patch.panelH = m ? +m[2] : null; }
      else { const n = parseFloat(v); if(!isFinite(n)) return; patch[k] = n; }
      window.EKO_WALL.saveSettings(id, patch); render(); },
    wallCfgPane(el){ const id = E.state.wallCfgId || 'default', s = window.EKO_WALL.settingsFor(E, id), set = new Set(s.panes); if(el.checked) set.add(el.value); else set.delete(el.value); window.EKO_WALL.saveSettings(id, { panes: window.EKO_WALL.PANES.filter(p => set.has(p)) }); render(); },
    wallCfgId(el){ E.state.wallCfgId = (String(el.value || '').trim().replace(/[^\w-]/g, '') || 'default'); render(); },
    wallCfgReset(){ window.EKO_WALL.resetSettings(E.state.wallCfgId || 'default'); render(); },
    /* D111: the wall's own controls */
    wallGear(el, ev){ window.EKO_WALL.ACTS.wallGear(el, ev); }, wallClose(el, ev){ window.EKO_WALL.ACTS.wallClose(el, ev); }, wallExit(el, ev){ window.EKO_WALL.ACTS.wallExit(el, ev); },
    wallLock(el, ev){ window.EKO_WALL.ACTS.wallLock(el, ev); }, wallSet(el, ev){ window.EKO_WALL.ACTS.wallSet(el, ev); },
    wallOpenAsset(el, ev){ window.EKO_WALL.ACTS.wallOpenAsset(el, ev); }, wallOpenSite(el, ev){ window.EKO_WALL.ACTS.wallOpenSite(el, ev); },
    disclose(el){ const k = el.dataset.v || el.dataset.k; E.state.disclose[k] = !E.disclose(k); saveDisclose(); render(); },
    discloseOff(el){ const k = el.dataset.v || el.dataset.k; E.state.disclose[k] = false; saveDisclose(); render(); },
    rolePreview(el){ const r = el.dataset.v; E.state.rolePreview = r === (E.data.user || {}).role ? null : r; ss.set('eko-role-preview', E.state.rolePreview || '');
      E.state.disclose = loadDisclose(); E.state.dlg = null; const l = E.landing(); E.go(l.pageId, l.module, null); },
    dlg(el){ const r = el.getBoundingClientRect();
      E.state.dlgAnchor = (r.left + r.right) / 2;
      E.state.dlgAnchorBottom = r.bottom;
      E.set({ born:'dlg', dlg: el.dataset.v, palQ:'', palSel:0, mobMore:false, helpTab: el.dataset.tab || 'legend', settingsTab: el.dataset.stab || E.state.settingsTab }); },   /* a menu closes on selection (R1) */
    helpTab(el){ E.set({ helpTab: el.dataset.v }); },
    closeDlg(){ E.state.rlAsk = false; E.set({ dlg:null, mobMore:false }); },
    none(){},

    /* Alarm filters change the display only, never the ribbon. */
    fltSev(el){ const s = E.state.alarmF.sev, v = el.dataset.v;
      s.has(v) ? s.delete(v) : s.add(v); render(); },
    ackTgl(){ E.set({ showAcked: !E.state.showAcked }); },
    fltReset(){ E.state.alarmF.sev.clear();
      ss.del('eko-mk'); E.set({ showAcked: true, markersOn: true }); },
    alertGo(el){ E.set({ born:'asset', dlg:null, assetSel: el.dataset.asset,
      apTab: E.state.apTab || 'alarms', mkPop: null }); },
    fltSys(el){ const s = E.state.alarmF.sys, v = el.dataset.v;
      s.has(v) ? s.delete(v) : s.add(v); render(); },
    tgTgl(el){ const g = el.dataset.g;
      E.state.triageOpen[g] = E.state.triageOpen[g] === false; render(); },

    /* Asset journey: any entry point opens the ONE docked panel. */
    openAsset(el){ E.set({ born: E.state.assetSel?null:'asset', assetSel: el.dataset.asset, apTab: E.state.apTab||'alarms', mkPop:null }); },
    closeAsset(){ E.set({ assetSel: null }); },
    apTab(el){ E.set({ apTab: el.dataset.v }); },
    alAll(){ E.set({ alAll: !E.state.alAll }); },
    resetLayout(){ E.set({ rlAsk:true }); },
    resetLayout2(){ E.state.rlAsk = false;
      ss.del('eko-mk'); E.state.markersOn = true;                     /* D70: markers visible again */
      if(window.EKO_SPLIT) window.EKO_SPLIT.resetAll(); else E.set({}); },
    cwo(el){ const id = el.dataset.asset;
      /* D50: optimistic create through the CMMS facade — the morph shows
         "Raising\u2026" until wo.accepted returns with the external number;
         a failure queues with backoff and raises ONE error notification
         with Retry (the button returns to idle so a manual re-raise works). */
      E.state.woPhase = E.state.woPhase || {};
      E.state.woPhase[id] = 'raising'; render();
      if(window.EKO_CMMS) window.EKO_CMMS.createWorkOrder({ assetId: id });
      else { delete E.state.woPhase[id]; render(); } },
    woOpen(el){ E.set({ assetSel: el.dataset.asset, apTab: 'activity' }); },
    locate(el){ const id = el.dataset.asset;
      const a = E.data.alarms.find(x => x.asset === id);
      if(!document.getElementById('vpmain'))
        E.state.pageId = 'marsa-overview', E.state.module = 'overview', E.state.sub = null;
      E.state.mkPulse = a ? a.id : null; render();
      E.engine.flyTo(id);
      setTimeout(() => { E.state.mkPulse = null; render(); }, 2200); },

    /* Viewport controls (D69): ONE handler for the bar, the More flyout /
       sheet rows, the radial, the palette and the shortcut keys. Select is
       the resting state; a disabled tool stays disabled (honest). */
    vtool(el){ const k = el.dataset.v, d = E.state.dock, VT = window.EKO_VT;
      const def = VT.byId(k);
      /* D74: a tool the engine cannot run says why when clicked */
      if(def && VT.state(E, def).dis){ toast(E.t('toolNeedsLive', { t: E.t(def.label) })); return; }
      const prev = d.bloom;
      E.state.radial = null;
      if(k === 'closeMore'){ d.bloom = null; render(); return; }
      if(k === 'reset'){ E.engine.resetView();
        E.set({ dock:{ tool:'select', bloom:null, style:'default', tone:'blue',
        level:'ALL', layer:'all', alerts:'all', minimap:false }, mkPop:null, histAge:null, measureResult:null }); return; }
      if(!def) return;
      if(def.kind === 'tool'){ d.tool = k; d.bloom = null; }
      else if(def.kind === 'toggle'){ d.minimap = !d.minimap; d.bloom = null; if(d.minimap) E.state.born = 'bloom'; }
      else if(def.kind === 'more'){ const inMore = ['more','layers','style'].includes(d.bloom);
        d.bloom = (el.classList && el.classList.contains && el.classList.contains('vmback')) ? 'more' : (inMore ? null : 'more'); }
      else if(def.kind === 'bloom'){ d.bloom = d.bloom === k ? null : k; }
      if(d.bloom && d.bloom !== prev) E.state.born = 'bloom';
      render(); },
    setLevel(el){ E.state.dock.level = el.dataset.v; E.state.dock.bloom = null; render(); },
    setLayer(el){ E.state.dock.layer = el.dataset.v; E.state.dock.bloom = null; render(); },
    setStyle(el){ E.state.dock.style = el.dataset.v; E.state.dock.bloom = null; render(); },   /* D72: every choice closes */
    /* D88–D91: reports — build → narrate → freeze → store → notify → preview */
    async rpRun(spec){ if(E.state.rpBusy) return; E.set({ rpBusy:true });
      try{ const doc = await window.EKO_R.generate(E, spec);
        E.state.rpBusy = false; E.state.report = doc; E.state.dlg = null; E.state.rp = { intent:null, text:'' }; E.state.askHint = null;
        E.go('report-preview', 'reports', null); }
      catch(err){ E.state.rpBusy = false; console.error(err); toast(E.t('rpFailed'), 'warn'); render(); } },
    rpGen(el){ ACTS.rpRun({ templateId: el.dataset.v, siteKey:E.data.key, period:null, params:{} }); },
    rpRegen(){ const d = E.state.report; if(d) ACTS.rpRun(JSON.parse(JSON.stringify(d.spec))); },
    rpSugg(){ const s = window.EKO_RI.suggest(E); ACTS.rpRun({ templateId:s.templateId, siteKey:E.data.key, period:s.period, params:s.params }); },
    rpPick(el){ const tpl = window.EKO_R.templates()[el.dataset.v];
      if(!tpl.needsAlarm){ ACTS.rpGen(el); return; }
      const s = window.EKO_RI.suggest(E);
      const intent = { text:'', templateId:tpl.id, period:tpl.defaultPeriod, params:{ alarmId: s.params.alarmId || E.data.alarms[0].id }, ambiguous:false };
      if(window.EKO_SURF) window.EKO_SURF.noteOpener({ act:'dlg', v:'rpconfirm' });
      E.set({ born:'dlg', dlg:'rpconfirm', rp:{ intent, text:'' } }); },
    /* D92: the ONE AI entry is the Ask EKO bar; a report ask opens the
       confirmation dialog with what was understood */
    rpAsk(el, text){ const q = String(text || '').trim(); if(!q) return;
      const intent = window.EKO_RI.parse(E, q);
      if(window.EKO_SURF) window.EKO_SURF.noteOpener({ act:'dlg', v:'rpconfirm' });
      E.set({ born:'dlg', dlg:'rpconfirm', rp:{ intent, text:q }, askHint:null }); },
    rpAskFocus(){ E.state.dlg = null; if(window.EKO_AI){ if(window.EKO_SURF) window.EKO_SURF.noteOpener({ act:'rpAskFocus' }); window.EKO_AI.open(null); } E.set({ askHint:'report', born:'ai' }); },   /* D133: the conversation opens in report mode */
    rpConfirm(){ const it = E.state.rp.intent; if(!it || !it.templateId) return;
      ACTS.rpRun({ templateId:it.templateId, siteKey:E.data.key, period:it.period || null, params:it.params || {} }); },
    rpHub(){ E.state.dlg = null; E.go('reports', 'reports', null); },
    rpHubF(el){ E.set({ rpHubF: el.dataset.v }); },
    rpHubRemoved(){ E.set({ rpHubRemoved: !E.state.rpHubRemoved }); },
    rpOpen(el){ const d = window.EKO_R.store.get(el.dataset.v); if(!d) return; E.state.report = d; E.state.dlg = null; E.go('report-preview', 'reports', null); },
    rpPdf(){ if(E.state.report){ window.EKO_RX.pdf(E, E.state.report); render(); } },
    rpPdfId(el){ const d = window.EKO_R.store.get(el.dataset.v); if(d){ window.EKO_RX.pdf(E, d); render(); } },
    rpXlsx(){ if(E.state.report){ window.EKO_RX.xlsx(E, E.state.report); toast(E.t('rpXlsxDone'), 'ok'); render(); } },
    /* removal is soft and undoable: the id stays citable, the audit says who and when */
    rpDel(el){ const id = el.dataset.v; window.EKO_R.store.remove(E, id);
      toast(E.t('rpRemovedToast', { id }), 'info', { label:E.t('rpUndo'), act:'rpRestore', v:id }); render(); },
    rpRestore(el){ const id = el.dataset.v; window.EKO_R.store.restore(E, id); toast(E.t('rpRestoredToast', { id }), 'ok'); render(); },
    /* D73: the bar collapses to one icon and back; persists like the nav */
    vbarTgl(){ E.state.vbarMin = !E.state.vbarMin; E.state.dock.bloom = null; ls.set('eko-vbar', E.state.vbarMin ? 'min' : 'full'); render(); },
    /* D72: floor stepper — levels are listed top to bottom in site data */
    lvlStep(el){ const lv = E.data.viewer.levels, d = E.state.dock;
      const i = lv.indexOf(d.level);
      let n;
      if(d.level === 'ALL') n = el.dataset.v === 'up' ? Math.max(0, lv.indexOf('GF')) : lv.length - 1;
      else n = el.dataset.v === 'up' ? i - 1 : i + 1;
      if(n < 0 || n >= lv.length) return;
      d.level = lv[n]; render(); },
    setTone(el){
      E.state.dock.tone = el.dataset.v;
      if (window.StudioViewer && window.StudioViewer.setXrayColor) window.StudioViewer.setXrayColor(el.dataset.v);
      else window.dispatchEvent(new CustomEvent('dashboard-event', { detail: { action: 'setXrayColor', color: el.dataset.v } }));
      render();
    },
    setAlerts(el){ E.state.dock.alerts = el.dataset.v === 'none' ? 'none' : el.dataset.v;
      E.state.dock.bloom = null; render(); },

    tlRange(el){ E.set({ tlRange: el.dataset.v }); },
    tlRangeSel(el){ E.set({ tlRange: el.value }); },
    /* D128 (restores the two-step over D69): a marker click opens the popup
       anchored to the marker; "Details" in the popup opens the panel. Clicking
       the open popup's own marker closes it. A cluster shows its worst alarm
       with the count. */
    mkOpen(el){ const al = E.alarm(el.dataset.alarm); if(!al) return;
      if(E.state.mkPop === al.id){ E.set({ mkPop:null, mkPopN:0 }); return; }
      E.set({ born:'pop', mkPop: al.id, mkPopN: 0 }); },
    mkToggle(){ const on = !E.state.markersOn; ss.set('eko-mk', on ? '1' : '0'); E.set({ markersOn: on }); },
    ackAlarm(el, ev){ ev.stopPropagation(); if(window.EKO_PWA) window.EKO_PWA.haptic('ack');
      const a = E.alarm(el.dataset.alarm);
      const d = new Date();
      a.ack = { time: String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'), who: 'AY' };
      render(); },
    /* By-system row: ONE click from the Overview filters the register to
       that system's alarmed assets (spec: filter by system, ≤2 clicks). */
    fltSysGo(el){ E.set({ pageId:'assets-register', module:'assets', sub:'reg',
      regQ:'', regStF:null, regSysF: el.dataset.v, regSevF:null }); },
    regSysClear(){ E.set({ regSysF:null }); },
    /* D100: a quick filter link ("2 stale") sets one grid filter */
    dgQuick(el){ const s = window.EKO_DG.st(E, window.EKO_DG.specs.assets); const f = s.filters[el.dataset.k]; s.filters[el.dataset.k] = (f && f.in && f.in.length === 1 && f.in[0] === el.dataset.v) ? {} : { in:[el.dataset.v] }; s.dirty = true; render(); },
    regSevClear(){ E.set({ regSevF:null }); },
    tlHist(){ if(E.state.histAge==null) E.set({ histAge: 2 }); },
    tlMetric(el){ E.set({ tlMetric: el.dataset.v }); },
    /* Timeline stepping walks the SAME derived event list the timeline draws
       (E.events(), ageH in hours) — D56 fix: it read a data field that does
       not exist and threw on every click. */
    tlPrev(){ const cur = E.state.histAge==null ? 0 : E.state.histAge;
      const older = E.events().filter(e=>e.ageH>cur+.01);
      if(older.length) E.set({ histAge: older.sort((a,b)=>a.ageH-b.ageH)[0].ageH }); },
    tlNext(){ const cur = E.state.histAge; if(cur==null) return;
      const newer = E.events().filter(e=>e.ageH<cur-.01);
      E.set({ histAge: newer.length ? newer.sort((a,b)=>b.ageH-a.ageH)[0].ageH : null }); },
    mkClu(el){ const al = (el && el.dataset.alarm && E.alarm(el.dataset.alarm)) || E.data.alarms.find(x=>x.sev==='critical') || E.data.alarms[0];
      if(E.state.mkPop === al.id){ E.set({ mkPop:null, mkPopN:0 }); return; }
      E.set({ born:'pop', mkPop: al.id, mkPopN: +((el && el.dataset.n) || 0) }); },
    mkClose(){ E.set({ mkPop: null, mkPopN: 0 }); },

    /* Timeline. */
    tlScrub(el, ev){ const r = el.getBoundingClientRect();
      let f = (ev.clientX - r.left) / r.width;
      if((window.DASHBOARD_ROOT||document.documentElement).dir === 'rtl') f = 1 - f;
      const age = (1 - Math.max(0, Math.min(1, f))) * (E.state.tlRange === '6h' ? 6 : 24);
      E.set({ histAge: age < 0.5 ? null : age }); },
    tlEvent(el, ev){ ev.stopPropagation(); E.set({ histAge: Number(el.dataset.age) }); },
    tlLive(){ E.set({ histAge: null }); },

    /* Palette + ask. */
    palGo(el){ const h = E._palHits[Number(el.dataset.i)];
      if(!h) return;
      if(h.kind === 'asset') E.set({ dlg:null, assetSel:h.label, pageId:'assets-register', module:'assets', sub:'reg' });
      else if(h.kind === 'tool'){ E.state.dlg = null;
        if(!document.getElementById('vbar')) E.go('marsa-overview', 'overview', null);
        ACTS.vtool({ dataset:{ v:h.tool } }); }
      else if(h.locked){ E.state.dlg = null; ACTS.teaser({ dataset:{ mod:h.mod, teaser:h.teaser } }); }   /* D122: a locked page opens its teaser, as the nav does */
      else { E.state.dlg = null; E.go(h.go.page, h.go.mod, h.go.sub || null); } },
    hmMode(el){ E.set({ hmMode: el.dataset.v }); },
    hmFloor(el){ E.set({ hmFloor: el.dataset.v }); },
    hmSel(el){ E.set({ hmSel: E.state.hmSel === el.dataset.v ? null : el.dataset.v }); },
    hmOutline(){ E.set({ hmOutline: !E.state.hmOutline }); },
    hmLayer(el){ const l = { ...E.state.hmLayers };
      l[el.dataset.v] = !l[el.dataset.v]; E.set({ hmLayers: l }); }
  };

  document.addEventListener('click', ev => {
    const el = ev.target.closest('[data-act]');
    if(!el) return;
    if(window.EKO_SURF) window.EKO_SURF.noteClick(el);           /* R5: remember the opener */
    const fn = ACTS[el.dataset.act] || (window.EKO_AI && window.EKO_AI.ACTS[el.dataset.act]) || (window.EKO_CTL && window.EKO_CTL.ACTS[el.dataset.act]) || (window.EKO_NF && window.EKO_NF.ACTS[el.dataset.act]) || (window.EKO_PWA && window.EKO_PWA.ACTS[el.dataset.act]) || (window.EKO_FB && window.EKO_FB.ACTS[el.dataset.act]) || (window.EKO_DG && window.EKO_DG.ACTS[el.dataset.act]) || (window.EKO_PF && window.EKO_PF.ACTS[el.dataset.act]);
    if(fn) fn(el, ev);
  });

  document.addEventListener('input', ev => {
    if(ev.target.matches && ev.target.matches('.hpq')){            /* D78: filter the legend in place */
      const q = ev.target.value.trim().toLowerCase(), box = ev.target.closest('.dlghelp');
      box.querySelectorAll('.hprow').forEach(r => { r.hidden = !!q && !(r.dataset.q || '').includes(q); });
      box.querySelectorAll('.hpsec').forEach(s => { s.hidden = !!q && ![...s.querySelectorAll('.hprow')].some(r => !r.hidden); });
      return; }
    if(ev.target.id === 'palin'){ E.state.palQ = ev.target.value; E.state.palSel = 0;
      $('overlays').innerHTML = overlays();
      const pal = $('palin'); pal.focus(); pal.setSelectionRange(pal.value.length, pal.value.length); }
    if(ev.target.matches('.rphubq')){ E.state.rpHubQ = ev.target.value;          /* D92 */
      const lib = document.querySelector('.rplib'); if(lib) lib.outerHTML = window.EKO_RV.library(E); return; }
    if(ev.target.matches('.regsearch')){ E.state.regQ = ev.target.value;
      const sc = document.querySelector('.regwrap');
      if(sc){ const doc = window.EKO_LAYOUTS[E.state.pageId];
        sc.outerHTML = C.registerTable(E, (doc.widgets.find(w=>w.type==='registerTable')||{}).binding||{});
        const inp = document.querySelector('.regsearch');
        inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); } }
  });
  /* D91: the intent confirmation form is editable before anything generates */
  document.addEventListener('change', ev => {
    if(!(ev.target.matches && ev.target.matches('.rpf')) || !E.state.rp || !E.state.rp.intent) return;
    const it = E.state.rp.intent, f = ev.target.dataset.f;
    if(f === 'templateId'){ it.templateId = ev.target.value || null; it.ambiguous = !it.templateId;
      const tpl = it.templateId && window.EKO_R.templates()[it.templateId];
      if(tpl && tpl.needsAlarm && !it.params.alarmId) it.params.alarmId = E.data.alarms[0].id;
      if(tpl && !it.period) it.period = tpl.defaultPeriod; }
    else if(f === 'period') it.period = window.EKO_R.periodOf(ev.target.value);
    else if(f === 'alarmId') it.params.alarmId = ev.target.value;
    else if(f === 'includeAlarms') it.params.includeAlarms = ev.target.checked;
    render();
  });
  document.addEventListener('click', ev => {
    const th = ev.target.closest('[data-act="regSort"]');
    if(th){ const k = th.dataset.k;
      if(E.state.regSort === k) E.state.regSortDir = E.state.regSortDir==='asc'?'desc':'asc';
      else { E.state.regSort = k; E.state.regSortDir = 'asc'; }
      render(); }
    const stf = ev.target.closest('[data-act="regStF"]');
    if(stf){ E.state.regStF = E.state.regStF === stf.dataset.v ? null : stf.dataset.v; render(); }
  });
  document.addEventListener('keydown', ev => {
    if(E.state.wall){ if(window.EKO_WALL) window.EKO_WALL.onKey(ev); return; }   /* D108: Escape exits; any other key only raises the exit hint */
    if(ev.key === 'Escape' && ev.target.id === 'aiin' && E.state.askHint){ E.set({ askHint:null }); return; }   /* D133: leave report mode, keep the conversation */
    if((ev.ctrlKey || ev.metaKey) && ev.key === '/' && !E.state.signedOut){ ev.preventDefault();   /* D133: the launcher's shortcut */
      if(window.EKO_SURF) window.EKO_SURF.noteOpener({ act:'aiOpen', id:'ailaunch' });
      if(window.EKO_AI){ window.EKO_AI.open(null); E.set({ born:'ai' }); } return; }
    if(ev.target.id === 'palin'){
      if(ev.key === 'Escape'){ ev.preventDefault(); if(window.EKO_SURF) window.EKO_SURF.escape(); return; }
      const n = (E._palHits||[]).length;
      if(ev.key === 'ArrowDown'){ E.state.palSel = Math.min(n-1, E.state.palSel+1); $('overlays').innerHTML = overlays(); ev.preventDefault(); }
      if(ev.key === 'ArrowUp'){ E.state.palSel = Math.max(0, E.state.palSel-1); $('overlays').innerHTML = overlays(); ev.preventDefault(); }
      if(ev.key === 'Enter'){ ev.preventDefault(); const h = E._palHits[E.state.palSel];   /* D121: preventDefault, or the opener that regains focus is activated by the same key and reopens the palette */
        if(h) ACTS.palGo({ dataset:{ i:String(E.state.palSel) } }); }
      return;
    }
    if(ev.target.matches && ev.target.matches('input') && ev.key !== 'Escape') return;
    /* D121: keyboard operability — Enter and Space activate any role=button element that is not a native control;
       arrows walk a menu's items (the surface manager focuses the first item on open) */
    if((ev.key === 'Enter' || ev.key === ' ') && ev.target instanceof Element && ev.target.matches('[role="button"][data-act]') && !ev.target.matches('button, a, input, select, textarea')){ ev.preventDefault(); ev.target.click(); return; }
    const menuRoot = ev.target instanceof Element && ev.target.closest('[role="menu"]');
    if(menuRoot && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(ev.key)){
      const items = [...menuRoot.querySelectorAll('[role^="menuitem"], button.accitem, button.palrow')].filter(el => !el.disabled && el.offsetParent !== null);
      if(items.length){ const i = items.indexOf(ev.target); const n = ev.key === 'Home' ? 0 : ev.key === 'End' ? items.length - 1 : ev.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length; items[n].focus(); ev.preventDefault(); return; }
    }
    /* R3 (D67): Escape closes the topmost surface only — the surface manager
       knows the stack; on a full page with nothing open it goes Back. */
    if(ev.key === 'Escape'){
      if(window.EKO_SURF) window.EKO_SURF.escape();
      return;
    }
    if(ev.key === '?' && !ev.ctrlKey && !ev.metaKey){ ev.preventDefault();
      if(window.EKO_SURF) window.EKO_SURF.noteOpener({ act:'dlg', v:'help' });
      E.set({ born:'dlg', dlg:'help', helpTab:'legend' }); return; }   /* D78 */
    /* D69: viewer tool shortcuts — plain keys, only while a controls bar exists */
    if(!ev.ctrlKey && !ev.metaKey && !ev.altKey && !ev.shiftKey && document.getElementById('vbar') && window.EKO_LAYOUTS.tools){
      if(ev.key === window.EKO_LAYOUTS.tools.expandKey && !window.EKO_VT.phone()){ ev.preventDefault(); ACTS.vbarTgl(); return; }
      const def = window.EKO_LAYOUTS.tools.all.find(t => t.key.toLowerCase() === ev.key.toLowerCase());
      if(def && def.kind !== 'more'){ ev.preventDefault(); ACTS.vtool({ dataset:{ v:def.id } }); return; }
    }
    if(ev.key === '[') ACTS.navMin();
    if((ev.ctrlKey||ev.metaKey) && ev.key.toLowerCase() === 'k'){ ev.preventDefault();
      if(window.EKO_SURF) window.EKO_SURF.noteOpener({ act:'dlg', v:'pal' });
      E.set({ dlg:'pal', palQ:'', palSel:0 }); }
    if(ev.key.toLowerCase() === 't' && !ev.ctrlKey && !ev.shiftKey){
      const seq = { auto:'light', light:'dark', dark:'auto' };
      E.state.themeMode = seq[E.state.themeMode]; ls.set('eko-theme-mode', E.state.themeMode);
      applyTheme(); render(); }
    if(ev.shiftKey && ev.key.toLowerCase() === 'r'){
      E.lang = E.lang === 'en' ? 'ar' : 'en'; ls.set('eko-lang', E.lang); applyLang(); render(); }
    if(ev.key === 'End' && E.state.histAge != null) E.set({ histAge:null });
  });
  document.addEventListener('keydown', ev => {
    if(ev.key === 'Enter' && ev.target.matches && ev.target.matches('tr[data-act]')){
      if(window.EKO_SURF) window.EKO_SURF.noteClick(ev.target); ACTS.openAsset(ev.target); }
  });
  document.addEventListener('change', ev => {
    const el = ev.target.closest && ev.target.closest('[data-chg]');
    const cfn = el && (ACTS[el.dataset.chg] || (window.EKO_AI && window.EKO_AI.ACTS[el.dataset.chg]) || (window.EKO_CTL && window.EKO_CTL.ACTS[el.dataset.chg]) || (window.EKO_NF && window.EKO_NF.ACTS[el.dataset.chg]) || (window.EKO_PWA && window.EKO_PWA.ACTS[el.dataset.chg]));
    if(cfn) cfn(el, ev);
  });

  /* D103: ?estate=1000 selects the 1,000-site test fixture; ?role=executive previews the executive landing */
  try{ const u = new URL(location.href), demo = !!(window.EKO_BUILD && window.EKO_BUILD.demo); if(demo && u.searchParams.get('estate') === '1000') E.state.estateFixture = '1000'; const lp = u.searchParams.get('lang'); if(lp === 'ar' || lp === 'en'){ E.lang = lp; ls.set('eko-lang', lp); }   /* D108: a kiosk URL fixes the wall's language */
    const rp = u.searchParams.get('role'); if(demo && rp && (E.data.roles || {})[rp]) E.state.rolePreview = rp; }catch(e){}
  if(E.state.rolePreview && !(E.data.roles || {})[E.state.rolePreview]) E.state.rolePreview = null;
  if(window.EKO_DG){ window.EKO_DG.specs.assets = window.EKO_GRIDS.assets(E); window.EKO_DG.specs.portfolio = window.EKO_GRIDS.portfolio(E); window.EKO_DG.init(E); }   /* D100 — registered before the first render: a role may land on the portfolio (D105) */
  if(window.EKO_PF) window.EKO_PF.init(E);   /* D103 */
  { const l = E.landing(); E.state.pageId = l.pageId; E.state.module = l.module; }   /* D105: the role picks the landing */
  try{ const u = new URL(location.href); if(u.searchParams.get('page') === 'portfolio' && (E.data.sites || []).length > 1 && u.searchParams.get('display') !== 'wall'){ E.state.pageId = 'portfolio'; E.state.module = 'overview'; } }catch(e){}   /* D108: the estate wall exits to the portfolio */
  E.state.disclose = loadDisclose();
  try{ const u = new URL(location.href); if(u.searchParams.get('display') === 'wall'){ E.state.wall = true; E.state.wallOpt = { scope: u.searchParams.get('scope') || null, distance: u.searchParams.get('distance'), dwell: u.searchParams.get('dwell'), brightness: u.searchParams.get('brightness'), motion: u.searchParams.get('motion'), shifts: u.searchParams.get('shifts'), scale: u.searchParams.get('scale'), panel: u.searchParams.get('panel'), panelIn: u.searchParams.get('panelIn'), theme: u.searchParams.get('theme'), lock: u.searchParams.get('lock'), id: u.searchParams.get('id') || 'default', viaTab: u.searchParams.get('via') === 'tab' }; if(window.EKO_WALL) window.EKO_WALL.start(E); } }catch(e){}   /* D106 */
  applyTheme(); applyLang(); E.state.born = 'boot'; render();
  try{ const op = new URL(location.href).searchParams.get('open'); if(op && !E.state.wall){ const [kind, id] = op.split(':'); if(kind === 'asset' && id) ACTS.openAsset({ dataset: { asset: id } }); else if(kind === 'site' && id && window.EKO_PF) window.EKO_PF.ACTS.siteGo({ dataset: { site: id } }); } }catch(e){}   /* D111: the wall hands a row to the workstation */
  if(window.EKO_NOTIF){
    window.EKO_NOTIF.hooks.onAdd = () => { render(); };
  }
  if(window.EKO_CMMS) window.EKO_CMMS.init(E);
  if(window.EKO_LLM) window.EKO_LLM.init(E);                       /* D91: the narration seam */
  if(window.EKO_AI){ window.EKO_AI.wire(E);                        /* D132: Ask EKO */
    window.EKO_AI.setRoute(q => { if(window.EKO_RI && (E.state.askHint === 'report' || window.EKO_RI.isReportRequest(q))){ ACTS.rpAsk(null, q); return true; } return false; }); }   /* D133: a report ask goes to the report engine */
  try{ E.state.tags = JSON.parse(localStorage.getItem('eko-tags-' + ((E.data.user && E.data.user.name) || 'user')) || '{}'); }catch(e){ E.state.tags = {}; }
  if(window.EKO_SPLIT) window.EKO_SPLIT.init(E);
  if(window.EKO_SHEET) window.EKO_SHEET.init(E);
  if(window.EKO_TIP) window.EKO_TIP.init(E);
  if(window.EKO_FB) window.EKO_FB.init(E);
  if(window.EKO_SURF) window.EKO_SURF.init(E);
  if(window.EKO_PWA) window.EKO_PWA.init(E);
  if(matchMedia) matchMedia('(prefers-color-scheme: light)').addEventListener?.('change', () => {
    if(E.state.themeMode === 'auto'){ applyTheme(); render(); } });

  /* Live resize: marker projection and chart geometry are computed at render
     time, so crossing a breakpoint by dragging the window must re-render. */
  let rzT = null;
  window.addEventListener('resize', () => {
    clearTimeout(rzT); rzT = setTimeout(render, 150);
  });
})();
