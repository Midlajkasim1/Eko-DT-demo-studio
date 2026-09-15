/* Layout document — Assets landing. Archetype: categoryLanding. */
window.EKO_LAYOUTS = window.EKO_LAYOUTS || {};
window.EKO_LAYOUTS.assets = {
  "schemaVersion": 1, "pageId": "assets", "archetype": "categoryLanding", "site": "marsa",
  "askChips": ["chipEquip", "chipUnits", "!chipWaterwk"],
  "widgets": [
    { "id": "summary", "type": "assetsSummary", "grid": { "x": 0, "y": 0, "w": 5, "h": 12 },
      "binding": { "data": "assets" } },
    { "id": "model", "type": "viewer3d", "grid": { "x": 5, "y": 0, "w": 13, "h": 12 },
      "config": { "markers": true, "timeline": true } },
    { "id": "panel", "type": "modRows", "grid": { "x": 18, "y": 0, "w": 6, "h": 12 },
      "binding": { "title": "modAssets", "module": "assets",
        "rows": [ { "label": "subRegister", "key": "reg", "sub": "reg", "pageId": "assets-register" } ] } }
  ]
};
