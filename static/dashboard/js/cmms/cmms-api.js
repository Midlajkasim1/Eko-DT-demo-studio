/* ============================================================================
   CMMS API (D50) — the pluggable contract, exactly like the viewer.
   ONE CONFIG LINE selects the adapter per site: data.features.cmms
   ("mock" | "hexagon"). Nothing CMMS-vendor-shaped may leak past the
   adapter boundary: field mappings, status values and endpoint shapes live
   in the adapter and its mapping table only.

   Adapter contract (every adapter implements):
     createWorkOrder(payload) -> Promise<{ externalId, number, status }>
     getWorkOrder(id)         -> Promise<workOrder | null>
     listWorkOrdersForAsset(assetId) -> Promise<workOrder[]>
     subscribe(onEvent)       -- normalized status events { number, assetId,
                                 status: accepted|assigned|started|onhold|
                                 completed|rejected, user? }
     capabilities = { create, statusSync, attachments, assignment, comments }

   WRITE-BACK LAW (lives HERE, adapter-agnostic): optimistic create with an
   idempotency key; the UI shows "sending"; success -> wo.accepted with the
   external number; failure -> ONE error notification (deduped) with a Retry
   action; failures queue in localStorage, survive a reload, and retry with
   exponential backoff. Status events map to the lifecycle notification
   types AND the register's WO STATUS column, so the table and the bell
   never disagree.
   ============================================================================ */
window.EKO_CMMS = (function(){
  'use strict';
  const LSQ = 'eko-cmms-queue';
  const BACKOFF_BASE_MS = 4000, BACKOFF_MAX_MS = 60000;
  let adapter = null, E = null, timer = null;
  const inflight = new Set();   /* idempotency guard across concurrent runs */

  /* status -> our notification type + register WO-state (OUR canon; the
     vendor-to-canon mapping lives in each adapter's table) */
  const STATUS = {
    accepted:  { type: 'wo.accepted',  wost: 'pend' },
    assigned:  { type: 'wo.assigned',  wost: 'asgn' },
    started:   { type: 'wo.started',   wost: 'prog' },
    onhold:    { type: 'wo.onhold',    wost: 'pend' },
    completed: { type: 'wo.completed', wost: 'done' },
    rejected:  { type: 'wo.rejected',  wost: null }
  };

  function init(app){
    E = app;
    const kind = (E.data.features || {}).cmms || 'mock';
    adapter = kind === 'hexagon' ? window.EKO_CMMS_HEXAGON : window.EKO_CMMS_MOCK;
    if(adapter.init) adapter.init();
    adapter.subscribe(onStatusEvent);
    processQueue();                       /* resume anything queued pre-reload */
  }

  /* ------------------------------ the queue -------------------------------- */
  function loadQ(){ try{ return JSON.parse(localStorage.getItem(LSQ)||'[]'); }catch(e){ return []; } }
  function saveQ(q){ try{ localStorage.setItem(LSQ, JSON.stringify(q)); }catch(e){} }

  function createWorkOrder(payload){
    const q = loadQ();
    const idem = payload.idem || ('idem-' + payload.assetId + '-' + Date.now());
    if(!q.some(x => x.idem === idem)){
      q.push({ idem, payload: Object.assign({}, payload, { idem }), attempts: 0, nextAt: Date.now() });
      saveQ(q);
    }
    processQueue();
    return idem;
  }
  function retryNow(){
    const q = loadQ(); q.forEach(x => { x.nextAt = Date.now(); }); saveQ(q);
    processQueue();
  }
  function processQueue(){
    if(!adapter) return;
    const q = loadQ();
    const due = q.filter(x => x.nextAt <= Date.now() && !inflight.has(x.idem));
    due.forEach(item => {
      inflight.add(item.idem);
      adapter.createWorkOrder(item.payload).then(res => {
        inflight.delete(item.idem);
        const q2 = loadQ().filter(x => x.idem !== item.idem); saveQ(q2);
        onCreated(item, res);
      }).catch(err => {
        inflight.delete(item.idem);
        const q2 = loadQ();
        const it = q2.find(x => x.idem === item.idem);
        if(it){
          it.attempts = (it.attempts||0) + 1;
          it.nextAt = Date.now() + Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * Math.pow(2, it.attempts - 1));
          saveQ(q2);
        }
        onFailed(item, err);
        schedule();
      });
    });
    schedule();
  }
  function schedule(){
    if(timer) clearTimeout(timer);
    const q = loadQ();
    if(!q.length) return;
    const next = Math.min.apply(null, q.map(x => x.nextAt));
    timer = setTimeout(processQueue, Math.max(500, next - Date.now()));
  }

  /* ----------------------------- outcomes ---------------------------------- */
  function onCreated(item, res){
    const id = item.payload.assetId;
    if(E){
      delete (E.state.woPhase || {})[id];
      E.state.woRaised[id] = res.number;
      E.state.woBorn = id;
      setTimeout(() => { E.state.woBorn = null; }, 900);
      const a = E.data.assets.find(x => x.id === id);
      if(a){ a.wost = STATUS.accepted.wost; a.wos = (a.wos||0) + 1; }
      /* D75: the moment's confirmation (the bell keeps the durable record) */
      if(window.EKO_FB) window.EKO_FB.toast({ tone:'ok', text: E.t('woRaised', { id: res.number }),
        action: { label: E.t('apActivityTab'), act:'woOpen', asset: id } });
    }
    if(window.EKO_NOTIF){
      window.EKO_NOTIF.add({ type: 'wo.accepted', actorId: window.EKO_NOTIF.ME,
        groupKey: 'wo:' + res.number,
        params: { system: adapter.displayName, wo: res.number, asset: id },
        source: { kind: 'workOrder', id: res.number },
        externalRef: { system: adapter.systemId, number: res.number } });
    } else if(E) E.set({});
  }
  function onFailed(item, err){
    /* one deduped error row with Retry; the button returns to idle so the
       user can also re-raise manually (log: phase not held through backoff) */
    if(E) delete (E.state.woPhase || {})[item.payload.assetId];
    if(window.EKO_NOTIF){
      window.EKO_NOTIF.add({ type: 'int.sync_failed', actorId: 'system',
        dedupKey: 'cmmsfail:' + item.idem,
        params: { system: adapter.displayName, reason: (err && err.message) || 'no response' },
        source: { kind: 'integration', id: adapter.systemId },
        actions: [ { labelKey: 'retryBtn', kind: 'primary', target: 'retryQueue' } ] });
    } else if(E) E.set({});
  }
  function onStatusEvent(ev){
    const map = STATUS[ev.status];
    if(!map) return;
    if(E && map.wost){
      const a = E.data.assets.find(x => x.id === ev.assetId);
      if(a) a.wost = map.wost;           /* the register and the bell agree */
    }
    if(window.EKO_NOTIF){
      window.EKO_NOTIF.add({ type: map.type, actorId: ev.user || 'system',
        groupKey: 'wo:' + ev.number,
        params: { wo: ev.number, asset: ev.assetId, user: ev.user || '', system: adapter.displayName, reason: ev.reason || '' },
        source: { kind: 'workOrder', id: ev.number } });
    } else if(E) E.set({});
  }

  function capabilities(){ return adapter ? adapter.capabilities : {}; }
  function queue(){ return loadQ(); }

  return { init, createWorkOrder, retryNow, processQueue, queue, capabilities,
           getWorkOrder: id => adapter.getWorkOrder(id),
           listWorkOrdersForAsset: a => adapter.listWorkOrdersForAsset(a) };
})();
