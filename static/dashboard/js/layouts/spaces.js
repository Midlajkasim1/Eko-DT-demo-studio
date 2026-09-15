/* Layout document — Spaces landing. Archetype: categoryLanding. */
window.EKO_LAYOUTS = window.EKO_LAYOUTS || {};
window.EKO_LAYOUTS.spaces = {
  "schemaVersion": 1, "pageId": "spaces", "archetype": "categoryLanding", "site": "marsa",
  "askChips": ["chipEquip", "chipUnits", "!chipWaterwk"],
  "widgets": [
    { "id": "summary", "type": "spacesSummary", "grid": { "x": 0, "y": 0, "w": 5, "h": 12 },
      "binding": { "data": "spaces" } },
    { "id": "model", "type": "viewer3d", "grid": { "x": 5, "y": 0, "w": 13, "h": 12 },
      "config": { "markers": true, "timeline": true } },
    { "id": "panel", "type": "modRows", "grid": { "x": 18, "y": 0, "w": 6, "h": 12 },
      "binding": { "title": "modSpaces", "module": "spaces",
        "rows": [ { "label": "subHeat", "key": "heat", "sub": "heat", "pageId": "heatmap" } ] } }
  ]
};
