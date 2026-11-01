/* Layout documents: Security and life safety (D180). The landing is the
   overview over the model (archetype securityLanding: the status summary on
   the start side, the open events in the panel); the views are full-width
   detail pages, like the ESG sub-views. Rendered by js/security.js (and
   js/evacuation.js for Evacuation). */
window.EKO_LAYOUTS = window.EKO_LAYOUTS || {};
window.EKO_LAYOUTS.sec = {
  "schemaVersion": 1, "pageId": "sec", "archetype": "securityLanding", "site": "marsa", "askChips": [],
  "widgets": [
    { "id": "summary", "type": "secSummary", "grid": { "x": 0, "y": 0, "w": 5, "h": 12 }, "binding": { "data": "security" } },
    { "id": "model", "type": "viewer3d", "grid": { "x": 5, "y": 0, "w": 13, "h": 12 }, "config": { "markers": true, "timeline": false } },
    { "id": "panel", "type": "secPanel", "grid": { "x": 18, "y": 0, "w": 6, "h": 12 }, "binding": { "data": "security" } }
  ]
};
[["sec-cams", "secCamsPage"], ["sec-access", "secAccessPage"], ["sec-fire", "secFirePage"], ["sec-power", "secPowerPage"], ["sec-evac", "secEvacPage"], ["sec-nurse", "secNursePage"], ["sec-intr", "p2Intr"], ["sec-health", "p2Health"], ["sys-data", "p2Data"], ["sys-other", "p2Other"], ["spaces-occ", "p2Occ"]].forEach(([id, type]) => {
  window.EKO_LAYOUTS[id] = { "schemaVersion": 1, "pageId": id, "archetype": "detailPage", "site": "marsa", "askChips": [],
    "widgets": [ { "id": "page", "type": type, "grid": { "x": 0, "y": 0, "w": 24, "h": 12 }, "binding": { "data": "security" } } ] };
});
