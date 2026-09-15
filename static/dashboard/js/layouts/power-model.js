/* Layout document — Consumption model sub-view (D39, Final mock's
   "Model view"): viewer + consumption panel, no summary tier. */
window.EKO_LAYOUTS = window.EKO_LAYOUTS || {};
window.EKO_LAYOUTS["power-model"] = {
  "schemaVersion": 1,
  "pageId": "power-model",
  "archetype": "categoryLanding",
  "site": "marsa",
  "askChips": ["chipWasting", "chipCompareWk", "!chipLoadCurve"],
  "widgets": [
    { "id": "model", "type": "viewer3d", "grid": { "x": 0, "y": 0, "w": 18, "h": 12 },
      "config": { "markers": true, "timeline": true } },
    { "id": "panel", "type": "consModelPanel", "grid": { "x": 18, "y": 0, "w": 6, "h": 12 },
      "binding": { "metrics": "power.subview" } }
  ]
};
