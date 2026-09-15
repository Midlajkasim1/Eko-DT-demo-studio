/* Layout document — Heat Map (energy + comfort modes). Archetype:
   categoryLanding in heat mode: the model carries the zone overlay, the
   module panel carries the controls. */
window.EKO_LAYOUTS = window.EKO_LAYOUTS || {};
window.EKO_LAYOUTS.heatmap = {
  "schemaVersion": 1, "pageId": "heatmap", "archetype": "categoryLanding", "site": "marsa",
  "askChips": ["chipWaste"],
  "heatMode": true,
  "widgets": [
    { "id": "model", "type": "viewer3d", "grid": { "x": 0, "y": 0, "w": 18, "h": 12 },
      "config": { "markers": false, "heat": true, "pills": false } },
    { "id": "panel", "type": "heatPanel", "grid": { "x": 18, "y": 0, "w": 6, "h": 12 },
      "binding": { "data": "heat" } }
  ]
};
