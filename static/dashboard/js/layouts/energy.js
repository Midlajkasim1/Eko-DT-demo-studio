/* Layout document — Energy landing. Archetype: categoryLanding. */
window.EKO_LAYOUTS = window.EKO_LAYOUTS || {};
window.EKO_LAYOUTS.energy = {
  "schemaVersion": 1,
  "pageId": "energy",
  "archetype": "categoryLanding",
  "site": "marsa",
  "askChips": ["chipWasting", "chipCompareWk", "!chipLoadCurve"],
  "widgets": [
    { "id": "summary", "type": "energySummary", "grid": { "x": 0, "y": 0, "w": 5, "h": 12 },
      "binding": { "metrics": "energyLanding" } },
    { "id": "model", "type": "viewer3d", "grid": { "x": 5, "y": 0, "w": 13, "h": 12 },
      "config": { "markers": true, "timeline": true, "pmuChips": true } },
    { "id": "panel", "type": "energyPanel", "grid": { "x": 18, "y": 0, "w": 6, "h": 12 },
      "binding": { "cards": "energyLanding.kpis" } }
  ]
};
