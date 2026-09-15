/* ============================================================================
   CMMS MOCK ADAPTER (D50) — fixture-driven, used by the prototype.
   Simulates the full work-order lifecycle on a timer and returns OUR
   contract's shape (never a fabricated vendor shape). Set
   `window.EKO_CMMS_FAIL = true` to simulate a connector failure
   (acceptance test 9); clear it to let retries succeed.
   ============================================================================ */
window.EKO_CMMS_MOCK = (function(){
  'use strict';
  let onEvent = null;
  let counter = 2341;
  const wos = {};

  const capabilities = { create: true, statusSync: true, attachments: false,
                         assignment: true, comments: false };

  function createWorkOrder(payload){
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        if(window.EKO_CMMS_FAIL){ reject(new Error('connector timeout')); return; }
        const number = 'WO-' + (counter++);
        wos[number] = { externalId: number, number, status: 'accepted',
                        assetId: payload.assetId, createdAt: new Date().toISOString() };
        resolve({ externalId: number, number, status: 'accepted' });
        /* scripted lifecycle: assigned then completed, via subscribe() */
        setTimeout(() => emit(number, payload.assetId, 'assigned', 'S. Khan'), 6000);
        setTimeout(() => emit(number, payload.assetId, 'completed', 'S. Khan'), 14000);
      }, 600);
    });
  }
  function emit(number, assetId, status, user){
    if(wos[number]) wos[number].status = status;
    if(onEvent) onEvent({ number, assetId, status, user });
  }
  function getWorkOrder(id){ return Promise.resolve(wos[id] || null); }
  function listWorkOrdersForAsset(assetId){
    return Promise.resolve(Object.values(wos).filter(w => w.assetId === assetId));
  }
  function subscribe(cb){ onEvent = cb; }

  return { displayName: 'Hexagon EAM (mock)', systemId: 'mock',
           capabilities, createWorkOrder, getWorkOrder,
           listWorkOrdersForAsset, subscribe };
})();
