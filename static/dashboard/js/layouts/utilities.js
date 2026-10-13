/* Layout document — Utilities landing. Archetype: categoryLanding. */
window.EKO_LAYOUTS = window.EKO_LAYOUTS || {};
window.EKO_LAYOUTS.utilities = {
  "schemaVersion": 1, "pageId": "utilities", "archetype": "categoryLanding", "site": "marsa",
  "askChips": ["chipEquip", "chipUnits", "!chipWaterwk"],
  "widgets": [
    { "id": "summary", "type": "utilitiesSummary", "grid": { "x": 0, "y": 0, "w": 5, "h": 12 },
      "binding": { "metrics": ["waterToday", "gasToday", "utilCost"] } },
    { "id": "model", "type": "viewer3d", "grid": { "x": 5, "y": 0, "w": 13, "h": 12 },
      "config": { "markers": true, "timeline": true } },
    { "id": "panel", "type": "utilitiesPanel", "grid": { "x": 18, "y": 0, "w": 6, "h": 12 },
      "binding": { "alarms": ["water.alarms", "gas.alarms"] } }
  ]
};
