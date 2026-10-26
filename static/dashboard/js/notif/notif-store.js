/* ============================================================================
   Notification STORE + MOCK GENERATOR (D48 stage 1).
   The store holds notification objects per the contract in
   handoff/data-contracts.md and persists them (localStorage, documented
   mock — production is a server store). The generator seeds a realistic
   history and can emit a scripted live stream. LAWS enforced at the door:
   an unknown type is refused, and no type for an alarm raise exists at all;
   SELF-ACTION is refused unless the type is a system confirmation.
   Dedup / threading / flood-control PIPELINE lands in stage 3 — the object
   already carries dedupKey and groupKey.
   ============================================================================ */
window.EKO_NOTIF = (function(){
  'use strict';
  const TT = () => window.EKO_NOTIF_TYPES;
  const SELF_CONFIRM = ['alarm.ack_recorded', 'wo.accepted', 'wo.rejected', 'report.ready'];   /* D90: the report you asked for is ready */
  const ME = 'Arman Y.';

  /* Whose notifications these are. The dashboard's own rule (data-map.js realMode): a project the
     Studio or an exported viewer injects is REAL unless it turns Demo figures on; no injected
     project is the standalone prototype. The dashboard re-runs this file for every project it
     opens, so each project reads only its own key. */
  const INJ = window.INJECTED_PROJECT_CONFIG || null;
  const REAL = !!(INJ && INJ.site) && INJ.demo !== true;
  const PROJECT_ID = INJ && typeof INJ.projectId === 'string' && INJ.projectId ? INJ.projectId : null;
  /* a real project's notifications carry its id; 'marsa' is the demo fixture's own site key */
  const SITE = REAL ? PROJECT_ID : 'marsa';
  /* seed only an explicitly demo build outside a real project: an unknown build never seeds */
  const SEEDS = !REAL && !!(window.EKO_BUILD && window.EKO_BUILD.demo === true);
  /* v3: one key per mode and project, so demo-seeded rows can never surface in a real project
     (not even the same project with Demo figures turned off). The shared v2 key is left as it
     was and never read: its rows were stamped 'marsa' whatever project made them. A real project
     with no id stores nothing rather than guess. */
  const LS = SITE ? 'eko-notifs-v3:' + (REAL ? 'real' : 'demo') + ':' + (PROJECT_ID || 'prototype') : null;

  let items = [];
  let seq = 0;

  /* ---- the project's server notifications (real mode with a backend) ----
     A real project reads the backend's project-scoped notifications: their read and dismissed
     state is the signed-in USER's own on this project (the server takes the user from this
     browser's session cookie, never from a request); another user's actions do not change it.
     They are read only once THIS browser's sign-in is confirmed (/api/auth/me):
     another browser having connected FIN signs nobody in here. The browser's own report.ready
     rows stay in the local store (no event ingestion yet). Direct mode (FIN-hosted, no Python
     service) and demo keep the local store only. */
  const REMOTE = REAL && !!PROJECT_ID && !(INJ.fin && INJ.fin.directMode) && typeof fetch === 'function';
  const API = '/api/notifications/v1', REMOTE_LIMIT = 100, REFRESH_MS = 30000;
  let remote = [], remoteUnread = 0, remoteMore = false, remotePrefs = null, remoteError = null, timer = null, self = null;
  /* checking | ok | signin (401: no session here) | mismatch (409) | error (network/server: retryable) */
  let remoteState = 'checking', remoteCode = null;
  const live = () => window.EKO_NOTIF === self;   /* a switched-away project's store stops talking */
  const changed = () => { if(hooks.onAdd) hooks.onAdd(null); };
  function api(method, path, body){
    return fetch(API + path, { method, cache: 'no-store', credentials: 'same-origin',
      headers: Object.assign({ 'X-Eko-Project': encodeURIComponent(PROJECT_ID) }, body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined })
      .then(res => {
        const stamp = res.headers.get('X-Eko-Project');   /* never another project's answer */
        if(stamp !== null && decodeURIComponent(stamp) !== PROJECT_ID) throw failure(409, 'project_mismatch');
        if(!res.ok) return res.json().catch(() => ({})).then(b => { throw failure(res.status, b && b.error && b.error.code); });
        return res.json();
      });
  }
  function failure(status, code){ const e = new Error('HTTP ' + status); e.status = status; e.code = code || null; return e; }
  function clearRemote(){ remote = []; remoteUnread = 0; remoteMore = false; remotePrefs = null; }
  /* 401: this browser is not signed in (or no longer). Nothing of the last session stays on
     screen: the server rows, and this browser's own rows for the project, go. 409: kept polling,
     the backend may switch back. Anything else: retryable, the last good rows stay. */
  function failed(err){
    if(!live()) return;
    const status = err && err.status;
    remoteError = String((err && err.message) || err);
    remoteCode = (err && err.code) || null;
    if(status === 401){
      stop(); clearRemote(); remoteState = 'signin';
      items = []; if(LS){ try{ localStorage.removeItem(LS); }catch(e){} }
    } else if(status === 409){ clearRemote(); remoteState = 'mismatch'; }
    else remoteState = 'error';
    changed();
  }
  /* Who this browser is, from its own session cookie; only then are notifications read */
  function confirmSession(){
    if(!REMOTE) return Promise.resolve();
    if(!live()){ stop(); return Promise.resolve(); }
    if(remoteState !== 'ok'){ remoteState = 'checking'; changed(); }
    return fetch('/api/auth/me', { cache: 'no-store', credentials: 'same-origin' })
      .then(res => {
        if(!res.ok) return res.json().catch(() => ({})).then(b => { throw failure(res.status, b && b.error && b.error.code); });
        if(!timer) timer = setInterval(refresh, REFRESH_MS);
        return refresh();
      })
      .catch(failed);
  }
  /* a server row in the bell's own shape; a type the registry does not know is not shown */
  function fromServer(r){
    const def = r && TT().byType[r.type];
    if(!def) return null;
    return { id: r.id, type: r.type, category: def.category, level: def.level, titleKey: def.titleKey, bodyKey: def.bodyKey,
             params: r.params || {}, source: r.source || null, externalRef: null, siteId: SITE, actorId: 'system',
             targetUsers: [], createdAt: r.created_at, readAt: r.opened_at || null, archivedAt: r.dismissed_at || null,
             dedupKey: null, groupKey: null, actions: [], children: null, remote: true };
  }
  function refresh(){
    if(!REMOTE) return Promise.resolve();
    if(!live()){ stop(); return Promise.resolve(); }
    return Promise.all([api('GET', '/notifications?limit=' + REMOTE_LIMIT), api('GET', '/preferences')])
      .then(([page, p]) => {
        if(!live()) return;
        remotePrefs = p && typeof p === 'object' ? p : null;
        /* the server already leaves out what this user switched off, so its rows, pages and count agree */
        remote = (page.items || []).map(fromServer).filter(Boolean);
        remoteMore = !!page.next_cursor;                 /* another page exists on the server */
        remoteUnread = typeof page.unread_count === 'number' ? page.unread_count : 0;
        remoteError = null; remoteCode = null; remoteState = 'ok'; changed();
      })
      .catch(failed);
  }
  function stop(){ if(timer){ clearInterval(timer); timer = null; } }
  /* optimistic: the cache changes now; a refused request puts it back, then the server's truth */
  function send(method, path, body, undo){
    return api(method, path, body).catch(() => { if(live()){ undo(); changed(); } }).then(() => refresh());
  }
  const remoteFind = id => remote.find(x => x.id === id);
  const enc = id => encodeURIComponent(id);
  /* the server's count when the cache holds only a page of them, else the cache's own */
  const remoteUnreadNow = () => !remoteMore
    ? remote.filter(n => !n.readAt && !n.archivedAt).length : remoteUnread;

  /* -------- preferences (stage 4): per-type in-app delivery toggles ------- */
  const LSP = 'eko-notif-prefs';
  let prefs = {};
  function loadPrefs(){
    try{ prefs = JSON.parse(localStorage.getItem(LSP)||'{}'); }catch(e){ prefs = {}; }
  }
  function prefOn(type){
    if(REMOTE && remotePrefs){   /* this user's preferences on the project, master toggle first */
      if(remotePrefs.master_enabled === false) return false;
      if(remotePrefs.types && type in remotePrefs.types) return !!remotePrefs.types[type];
    } else if(type in prefs) return !!prefs[type];
    const def = TT().byType[type];
    return def ? def.defaultOn : true;
  }
  /* whether the SITE creates critical-alarm notifications (the server's word, read only): true | false, or
     null when it is not known (no backend, an older one, or the answer is missing): never assumed on */
  function siteCritical(){
    const s = REMOTE && remotePrefs && remotePrefs.site;
    return s && typeof s.critical_alarms === 'boolean' ? s.critical_alarms : null;
  }
  function setPref(type, on){
    if(REMOTE){
      const p = remotePrefs = remotePrefs || { master_enabled: true, types: {} };
      p.types = p.types || {};
      const had = type in p.types, was = p.types[type];
      p.types[type] = !!on; changed();
      return send('PUT', '/preferences', { types: { [type]: !!on } }, () => { if(had) p.types[type] = was; else delete p.types[type]; });
    }
    prefs[type] = !!on;
    try{ localStorage.setItem(LSP, JSON.stringify(prefs)); }catch(e){} }
  loadPrefs();

  function save(){ if(!LS) return; try{ localStorage.setItem(LS, JSON.stringify(items)); }catch(e){} }
  function load(){ if(!LS){ items = []; seq = 0; return 0; }
    try{ items = JSON.parse(localStorage.getItem(LS)||'[]'); }catch(e){ items = []; }
    const cutoff = Date.now() - TT().PURGE_DAYS*86400000;      /* retention purge */
    items = items.filter(n => new Date(n.createdAt).getTime() > cutoff);
    seq = items.length; return items.length; }

  function iso(minsAgo){ return new Date(Date.now() - minsAgo*60000).toISOString(); }

  /* ---- the single entry point: every rule that can be enforced on ADD ---- */
  function add(evt){
    if(!SITE){ console.warn('[notif] no open project: not recorded:', evt && evt.type); return null; }
    const def = TT().byType[evt.type];
    if(!def){ console.error('[notif] unknown type refused:', evt.type); return null; }
    if(evt.actorId === ME && !SELF_CONFIRM.includes(evt.type)){
      /* never notify a user about their own action */
      return null;
    }
    if(!prefOn(evt.type)) return null;      /* stage 4: prefs honoured here */
    const now = evt.createdAt ? new Date(evt.createdAt).getTime() : Date.now();
    /* DEDUP (stage 3): identical dedupKey within the window collapses into
       one row carrying a count; the row's children list the items. */
    if(evt.dedupKey){
      const ex = items.find(x => x.dedupKey === evt.dedupKey && !x.archivedAt
        && (now - new Date(x.createdAt).getTime()) < TT().DEDUP_WINDOW_MIN*60000);
      if(ex){
        ex.children = (ex.children||[]).concat(evt.children || (evt.childId ? [evt.childId] : []));
        ex.params = Object.assign({}, ex.params, evt.params,
          { n: ex.children.length || ((ex.params.n||1) + 1) });
        ex.createdAt = new Date(now).toISOString();
        ex.readAt = null;
        save(); if(hooks.onAdd) hooks.onAdd(ex);
        return ex;
      }
    }
    /* FLOOD CONTROL (stage 3): more than FLOOD_N of one category within the
       window collapse into a single summary row (absorbing the burst). */
    const cat = def.category;
    if(!evt._noFlood){
      const recent = items.filter(x => x.category === cat && !x.archivedAt
        && x.type !== 'flood.summary'
        && (now - new Date(x.createdAt).getTime()) < TT().FLOOD_WINDOW_S*1000);
      const sum = items.find(x => x.type === 'flood.summary' && x.category === cat
        && (now - new Date(x.createdAt).getTime()) < TT().FLOOD_WINDOW_S*1000);
      if(sum){
        sum.params.n = (sum.params.n||0) + 1;
        sum.createdAt = new Date(now).toISOString(); sum.readAt = null;
        save(); if(hooks.onAdd) hooks.onAdd(sum);
        return sum;
      }
      if(recent.length >= TT().FLOOD_N){
        recent.forEach(x => { items.splice(items.indexOf(x), 1); });
        const fs = {
          id: 'n-' + Date.now() + '-' + (seq++),
          type: 'flood.summary', category: cat, level: 'info',
          titleKey: 'nfFlood.t', bodyKey: 'nfFlood.b',
          params: { n: recent.length + 1, catKey: TT().CATEGORIES[cat].labelKey },
          source: null, externalRef: null, siteId: evt.siteId || SITE,
          actorId: 'system', targetUsers: [ME],
          createdAt: new Date(now).toISOString(), readAt: null, archivedAt: null,
          dedupKey: null, groupKey: null, actions: [],
          children: recent.map(x => x.type)
        };
        items.unshift(fs); save();
        if(hooks.onAdd) hooks.onAdd(fs);
        return fs;
      }
    }
    const n = {
      id: 'n-' + Date.now() + '-' + (seq++),
      type: evt.type,
      category: def.category,
      level: def.level,
      titleKey: def.titleKey,
      bodyKey: def.bodyKey,
      params: evt.params || {},
      source: evt.source || null,
      externalRef: evt.externalRef || null,
      siteId: evt.siteId || SITE,
      actorId: evt.actorId || 'system',
      targetUsers: evt.targetUsers || [ME],
      createdAt: evt.createdAt || new Date().toISOString(),
      readAt: null,
      archivedAt: null,
      dedupKey: evt.dedupKey || null,
      groupKey: evt.groupKey || null,
      actions: evt.actions || [],
      children: evt.children || (evt.childId ? [evt.childId] : null)   /* detail list (dedup) */
    };
    items.unshift(n);
    save();
    if(hooks.onAdd) hooks.onAdd(n);
    return n;
  }

  function list(){ return items.filter(n => !n.archivedAt).concat(remote.filter(n => !n.archivedAt)); }
  function unread(siteId){
    return list().filter(n => !n.readAt && (!siteId || n.siteId === siteId));
  }
  function otherUnread(){
    return list().filter(n => !n.readAt && n.siteId !== SITE);
  }
  function badge(siteId){
    const site = siteId || SITE;
    const c = items.filter(n => !n.archivedAt && !n.readAt && n.siteId === site).length
            + (site === SITE ? remoteUnreadNow() : 0);
    return c === 0 ? '' : (c > TT().BADGE_CAP ? TT().BADGE_CAP + '+' : String(c));
  }
  function markRead(id){ const n = items.find(x => x.id === id);
    if(n && !n.readAt){ n.readAt = new Date().toISOString(); save(); return; }
    const r = remoteFind(id);
    if(r && !r.readAt){ r.readAt = new Date().toISOString(); changed();
      send('POST', '/notifications/' + enc(id) + '/opened', null, () => { r.readAt = null; }); } }
  function markAllRead(siteId){
    const now = new Date().toISOString();
    items.filter(n => !n.archivedAt && !n.readAt && (!siteId || n.siteId === siteId)).forEach(n => { n.readAt = now; }); save();
    const opened = (!siteId || siteId === SITE) ? remote.filter(n => !n.archivedAt && !n.readAt) : [];
    if(opened.length || (REMOTE && remoteUnread)){ opened.forEach(n => { n.readAt = now; }); changed();
      send('POST', '/notifications/opened-all', null, () => { opened.forEach(n => { n.readAt = null; }); }); } }
  function archive(id){ const n = items.find(x => x.id === id);
    if(n){ n.archivedAt = new Date().toISOString(); save(); return n; }
    const r = remoteFind(id);
    if(r && !r.archivedAt){ r.archivedAt = new Date().toISOString(); changed();
      send('POST', '/notifications/' + enc(id) + '/dismiss', null, () => { r.archivedAt = null; }); }
    return r; }
  function unarchive(id){ const n = items.find(x => x.id === id);
    if(n){ n.archivedAt = null; save(); return; }
    if(!REMOTE || typeof id !== 'string') return;
    const r = remoteFind(id), was = r ? r.archivedAt : null;   /* a refresh may already have dropped it */
    if(r){ r.archivedAt = null; changed(); }
    send('DELETE', '/notifications/' + enc(id) + '/dismiss', null, () => { if(r) r.archivedAt = was; }); }
  function archiveRead(siteId){
    const now = new Date().toISOString();
    items.filter(n => !n.archivedAt && n.readAt && (!siteId || n.siteId === siteId)).forEach(n => { n.archivedAt = now; }); save();
    const gone = (!siteId || siteId === SITE) ? remote.filter(n => !n.archivedAt && n.readAt) : [];
    if(gone.length){ gone.forEach(n => { n.archivedAt = now; }); changed();
      send('POST', '/notifications/dismiss-opened', null, () => { gone.forEach(n => { n.archivedAt = null; }); }); } }

  const hooks = { onAdd: null };

  /* ------------------------- realistic seed fixture ------------------------
     Content params are BILINGUAL or RESOLVED FROM DATA (D122): a site param
     names the site by id (the renderer takes nameEn/nameAr from the estate),
     an alarm param resolves through source.id to techEn/techAr, and free
     text (report titles, comment excerpts) is an {en, ar} pair. Names,
     connector phrases and point names go through EKO_I18N.paramAr. Codes
     (WO-2287, CH-2) stay Latin by law. tools/parity.js checks every param. */
  const B = (en, ar) => ({ en, ar });
  function seed(){
    if(!SEEDS) return 0;   /* demo scaffolding: never written into a real project, whoever calls */
    items = []; seq = 0;
    const S = (mins, evt) => { const n = add(Object.assign({ createdAt: iso(mins) }, evt)); return n; };
    /* yesterday */
    S(1560, { type: 'digest.morning', actorId: 'system',
      siteId: 'marsa', params: { site: 'marsa', alarms: 12, wos: 9, delta: '+4%' } });
    S(1500, { type: 'wo.assigned', actorId: 'system', groupKey: 'wo:WO-2287',
      params: { wo: 'WO-2287', asset: 'CH-2', user: 'S. Khan' },
      source: { kind: 'workOrder', id: 'WO-2287' },
      externalRef: { system: 'hexagon', number: 'WO-2287' } });
    S(1380, { type: 'wo.started', actorId: 'S. Khan', groupKey: 'wo:WO-2287',
      params: { wo: 'WO-2287', asset: 'CH-2', user: 'S. Khan' },
      source: { kind: 'workOrder', id: 'WO-2287' } });
    S(1300, { type: 'admin.setpoint_changed', actorId: 'S. Khan',
      params: { user: 'S. Khan', point: 'Temp setpoint', asset: 'AHU-A2-RF-01',
                value: '22.0 °C', expiry: 'expires in 3 days' },
      source: { kind: 'asset', id: 'AHU-A2-RF-01' } });
    S(1250, { type: 'report.ready', actorId: 'system',
      params: { report: B('August energy summary', 'ملخص طاقة أغسطس') }, source: { kind: 'report', id: 'rep-aug' } });
    /* today */
    S(430, { type: 'digest.morning', actorId: 'system',
      siteId: 'marsa', params: { site: 'marsa', alarms: 12, wos: 8, delta: '+2%' } });
    S(300, { type: 'int.points_stale', actorId: 'system',
      dedupKey: 'stale:main-poll',
      params: { n: 6, dur: '26h' },
      children: ['FCU-L1-02','VAV-L2-03','FCU-GF-02','VAV-L2-04','EF-RF-01','CT-RF-01'],
      source: { kind: 'integration', id: 'bms-poll' },
      actions: [ { labelKey: 'na.viewStale', kind: 'primary', target: 'staleAssets' } ] });
    S(220, { type: 'alarm.ack_recorded', actorId: ME,
      params: { alarm: 'al-vav', asset: 'VAV-L11-W' },
      source: { kind: 'alarm', id: 'al-vav' } });
    S(150, { type: 'shift.handover', actorId: 'M. Haddad',
      params: { user: 'M. Haddad', n: 4 }, source: { kind: 'user', id: 'mhaddad' } });
    S(95, { type: 'int.connector_restored', actorId: 'system',
      params: { connector: 'Hexagon EAM', dur: '18m' },
      source: { kind: 'integration', id: 'hexagon' } });
    S(60, { type: 'mention.comment', actorId: 'S. Khan',
      params: { user: 'S. Khan', asset: 'CH-2', excerpt: B('can you check the approach trend before Thursday?', 'هل يمكنك مراجعة اتجاه التقارب قبل الخميس؟') },
      source: { kind: 'asset', id: 'CH-2' } });
    S(24, { type: 'wo.completed', actorId: 'S. Khan', groupKey: 'wo:WO-2287',
      params: { wo: 'WO-2287', asset: 'CH-2', user: 'S. Khan' },
      source: { kind: 'workOrder', id: 'WO-2287' },
      actions: [ { labelKey: 'na.viewWo', kind: 'primary', target: 'workOrder' } ] });
    S(700, { type: 'admin.module_unlocked', actorId: 'system', siteId: 'kz-dxb2',
      params: { module: 'Control', site: 'kz-dxb2' } });
    S(12, { type: 'wo.sla_risk', actorId: 'system', groupKey: 'wo:WO-2320',
      params: { wo: 'WO-2320', asset: 'AHU-L12-03', h: 4 },
      source: { kind: 'workOrder', id: 'WO-2320' },
      externalRef: { system: 'hexagon', number: 'WO-2320' } });
    save();
    return items.length;
  }

  /* --------------- scripted live stream (started by the UI) ---------------- */
  const SCRIPT = [
    { type: 'wo.accepted', actorId: ME, groupKey: 'wo:WO-2341',
      params: { system: 'Hexagon EAM', wo: 'WO-2341', asset: 'CH-2' },
      source: { kind: 'workOrder', id: 'WO-2341' },
      externalRef: { system: 'hexagon', number: 'WO-2341' } },
    { type: 'wo.assigned', actorId: 'system', groupKey: 'wo:WO-2341',
      params: { wo: 'WO-2341', asset: 'CH-2', user: 'S. Khan' },
      source: { kind: 'workOrder', id: 'WO-2341' } },
    { type: 'int.connector_down', actorId: 'system',
      params: { connector: 'BMS poll', time: 'now' },
      source: { kind: 'integration', id: 'bms-poll' },
      actions: [ { labelKey: 'na.retrySync', kind: 'primary', target: 'integration' } ] },
    { type: 'int.connector_restored', actorId: 'system',
      params: { connector: 'BMS poll', dur: '2m' },
      source: { kind: 'integration', id: 'bms-poll' } },
    { type: 'wo.completed', actorId: 'S. Khan', groupKey: 'wo:WO-2341',
      params: { wo: 'WO-2341', asset: 'CH-2', user: 'S. Khan' },
      source: { kind: 'workOrder', id: 'WO-2341' } }
  ];
  let streamTimer = null, streamIdx = 0;
  function startStream(intervalMs){
    if(streamTimer) return;
    streamTimer = setInterval(() => {
      if(streamIdx >= SCRIPT.length){ stopStream(); return; }
      add(SCRIPT[streamIdx++]);
    }, intervalMs || 45000);
  }
  function stopStream(){ if(streamTimer){ clearInterval(streamTimer); streamTimer = null; } }

  if(!load() && SEEDS) seed();   /* D129: the seeded history is demo scaffolding; a client build or a real project starts empty */

  self = { add, list, unread, badge, otherUnread, markRead, markAllRead, archive, unarchive,
           archiveRead, seed, startStream, stopStream, hooks, ME, SITE,
           prefOn, setPref, siteCritical, REMOTE, refresh, confirmSession, remoteError: () => remoteError,
           remoteState: () => remoteState, remoteCode: () => remoteCode };
  if(REMOTE){   /* after this file returns, so live() sees this store as window.EKO_NOTIF */
    setTimeout(confirmSession, 0);
    /* a sign-in or sign-out in this browser (Studio Connect/Disconnect, the viewer's sign-in, the
       dashboard's Sign out): ask the server again. The event carries nothing to trust. */
    const onAuth = () => { if(live()) confirmSession(); else window.removeEventListener('eko-auth-changed', onAuth); };
    window.addEventListener('eko-auth-changed', onAuth);
  }
  return self;
})();
