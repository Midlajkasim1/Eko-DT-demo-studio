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
  const LS = 'eko-notifs-v2';   /* D122: v2 — the v1 seed carried English-only content */
  const SELF_CONFIRM = ['alarm.ack_recorded', 'wo.accepted', 'wo.rejected', 'report.ready'];   /* D90: the report you asked for is ready */
  const SITE = 'marsa';
  const ME = 'Arman Y.';

  let items = [];
  let seq = 0;

  /* -------- preferences (stage 4): per-type in-app delivery toggles ------- */
  const LSP = 'eko-notif-prefs';
  let prefs = {};
  function loadPrefs(){
    try{ prefs = JSON.parse(localStorage.getItem(LSP)||'{}'); }catch(e){ prefs = {}; }
  }
  function prefOn(type){
    if(type in prefs) return !!prefs[type];
    const def = TT().byType[type];
    return def ? def.defaultOn : true;
  }
  function setPref(type, on){ prefs[type] = !!on;
    try{ localStorage.setItem(LSP, JSON.stringify(prefs)); }catch(e){} }
  loadPrefs();

  function save(){ try{ localStorage.setItem(LS, JSON.stringify(items)); }catch(e){} }
  function load(){ try{ items = JSON.parse(localStorage.getItem(LS)||'[]'); }catch(e){ items = []; }
    const cutoff = Date.now() - TT().PURGE_DAYS*86400000;      /* retention purge */
    items = items.filter(n => new Date(n.createdAt).getTime() > cutoff);
    seq = items.length; return items.length; }

  function iso(minsAgo){ return new Date(Date.now() - minsAgo*60000).toISOString(); }

  /* ---- the single entry point: every rule that can be enforced on ADD ---- */
  function add(evt){
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

  function list(){ return items.filter(n => !n.archivedAt); }
  function unread(siteId){
    return list().filter(n => !n.readAt && (!siteId || n.siteId === siteId));
  }
  function otherUnread(){
    return list().filter(n => !n.readAt && n.siteId !== SITE);
  }
  function badge(siteId){
    const c = unread(siteId || SITE).length;
    return c === 0 ? '' : (c > TT().BADGE_CAP ? TT().BADGE_CAP + '+' : String(c));
  }
  function markRead(id){ const n = items.find(x => x.id === id);
    if(n && !n.readAt){ n.readAt = new Date().toISOString(); save(); } }
  function markAllRead(siteId){
    unread(siteId).forEach(n => { n.readAt = new Date().toISOString(); }); save(); }
  function archive(id){ const n = items.find(x => x.id === id);
    if(n){ n.archivedAt = new Date().toISOString(); save(); } return n; }
  function unarchive(id){ const n = items.find(x => x.id === id);
    if(n){ n.archivedAt = null; save(); } }
  function archiveRead(siteId){
    list().filter(n => n.readAt && (!siteId || n.siteId === siteId))
      .forEach(n => { n.archivedAt = new Date().toISOString(); }); save(); }

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

  if(!load() && (!window.EKO_BUILD || window.EKO_BUILD.demo)) seed();   /* D129: the seeded history is demo scaffolding; a client build starts empty */

  return { add, list, unread, badge, otherUnread, markRead, markAllRead, archive, unarchive,
           archiveRead, seed, startStream, stopStream, hooks, ME, SITE,
           prefOn, setPref };
})();
