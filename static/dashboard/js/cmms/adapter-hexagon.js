/* ============================================================================
   HEXAGON EAM ADAPTER — DOCUMENTED STUB (D50). Not wired by default; select
   it with data.features.cmms = "hexagon". Every Hexagon-specific value below
   is marked TO CONFIRM WITH THE CLIENT — Shahid fills these from the live
   MAA integration. Nothing in this file may be imported by anything except
   cmms-api.js: Hexagon shapes never leak past the adapter.

   ENDPOINTS (TO CONFIRM WITH THE CLIENT — typical Hexagon EAM REST/OData):
     base:   https://<tenant>/axis/restproxy/... or /odata/...    [confirm]
     create: POST  .../workorders                                  [confirm]
     read:   GET   .../workorders('<WONUM>')                       [confirm]
     list:   GET   .../workorders?$filter=equipmentcode eq '<eq>'  [confirm]
   AUTH (TO CONFIRM): OAuth2 client credentials vs API key vs session; in
   production the BROWSER NEVER CALLS HEXAGON — an EKO backend proxy holds
   credentials and exposes our contract (see handoff/cmms-integration.md).
   EVENTS (TO CONFIRM): webhook if the tenant supports outbound messaging;
   otherwise poll `list` with a delta filter every 60–120 s. subscribe() is
   where either lands — both normalize to { number, assetId, status, user }.

   WHAT HEXAGON ACTUALLY RETURNS from create is an OPEN QUESTION — do not
   fabricate it. The mock returns OUR contract shape; this adapter's job in
   production is to map the real response into that shape.
   ============================================================================ */
window.EKO_CMMS_HEXAGON = (function(){
  'use strict';

  /* --------------- STATUS MAPPING TABLE (data, not code) -------------------
     Hexagon status value  ->  our canonical status (cmms-api STATUS keys).
     Every left-hand value: TO CONFIRM WITH THE CLIENT. */
  const STATUS_MAP = {
    'R'    : 'accepted',   /* Released            — TO CONFIRM */
    'ASSGN': 'assigned',   /* Assigned            — TO CONFIRM */
    'INPRG': 'started',    /* In progress         — TO CONFIRM */
    'HOLD' : 'onhold',     /* On hold             — TO CONFIRM */
    'C'    : 'completed',  /* Completed           — TO CONFIRM */
    'CAN'  : 'rejected'    /* Cancelled/rejected  — TO CONFIRM */
  };

  /* --------------- FIELD MAPPING (ours -> Hexagon, TO CONFIRM) -------------
     assetId        -> equipmentcode   (see the asset-id contract in
                                        handoff/data-contracts.md)
     titleEn        -> description
     priority       -> priority / worktype
     idem key       -> externalrefid (or a custom field — TO CONFIRM;
                       REQUIRED so a retried create never duplicates)     */

  const capabilities = { create: true, statusSync: true, attachments: false,
                         assignment: true, comments: false };  /* TO CONFIRM */

  const notConfigured = () => Promise.reject(
    new Error('Hexagon adapter is a documented stub — configure endpoints and auth first'));

  return {
    displayName: 'Hexagon EAM', systemId: 'hexagon',
    capabilities, STATUS_MAP,
    /* per-method guidance lives in handoff/cmms-integration.md */
    createWorkOrder: notConfigured,
    getWorkOrder: notConfigured,
    listWorkOrdersForAsset: notConfigured,
    subscribe(){ /* webhook receiver or poller lands here */ }
  };
})();
