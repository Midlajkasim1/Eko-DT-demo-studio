/* Layout document — locked top-level modules (ESG / Maintenance / Security).
   D27: every top level opens a summary page in the same shell; locked ones
   show the honest available-on-demand state (lockedSummary) over the live
   model. Which KPIs appear once activated is an open question. */
window.EKO_LAYOUTS = window.EKO_LAYOUTS || {};
window.EKO_LAYOUTS["module-locked"] = {
  "schemaVersion": 1,
  "pageId": "module-locked",
  "archetype": "categoryLanding",
  "site": "marsa",
  "askChips": [],
  "widgets": [
    { "id": "summary", "type": "lockedSummary", "grid": { "x": 0, "y": 0, "w": 5, "h": 12 } },
    { "id": "model", "type": "viewer3d", "grid": { "x": 5, "y": 0, "w": 19, "h": 12 },
      "config": { "markers": true } }
  ]
};
