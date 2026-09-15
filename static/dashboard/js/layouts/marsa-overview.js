/* Layout document — Site Overview (Marsa). Archetype: siteOverview.
   A page is this document plus a data binding: reorder, remove or add
   widgets here without touching component code. */
window.EKO_LAYOUTS = window.EKO_LAYOUTS || {};
window.EKO_LAYOUTS["marsa-overview"] = {
  "schemaVersion": 1,
  "pageId": "marsa-overview",
  "archetype": "siteOverview",
  "site": "marsa",
  "featureFlags": { "cctv": false, "aed": true, "coBrand": false },
  "askChips": ["chipEquip", "chipUnits", "!chipWaterwk"],
  "widgets": [
    { "id": "summary", "type": "executiveSummary", "grid": { "x": 0, "y": 0, "w": 5, "h": 12 },
      "binding": { "metrics": "summary" } },
    { "id": "model", "type": "viewer3d", "grid": { "x": 5, "y": 0, "w": 13, "h": 10 },
      "config": { "markers": true, "dock": "full", "timeline": true } },
    { "id": "alarms", "type": "alarmPanel", "grid": { "x": 18, "y": 0, "w": 6, "h": 12 },
      "config": { "systemFilter": true, "severityFilter": true } }
  ]
};
