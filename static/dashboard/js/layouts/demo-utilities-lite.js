/* ============================================================================
   ACCEPTANCE TEST 8 DEMONSTRATION — this page was created with NOTHING but
   this layout document (plus two i18n labels). No component or page code was
   written or changed. It composes three existing widget types over existing
   data bindings. It has no nav entry, so it is not in the rail or the search
   palette: open it with EKO.go('demo-utilities-lite','utilities',null).
   ============================================================================ */
window.EKO_LAYOUTS = window.EKO_LAYOUTS || {};
window.EKO_LAYOUTS["demo-utilities-lite"] = {
  "schemaVersion": 1,
  "pageId": "demo-utilities-lite",
  "archetype": "categoryLanding",
  "site": "marsa",
  "askChips": ["chipWaste"],
  "widgets": [
    { "id": "summary", "type": "utilitiesSummary", "grid": { "x": 0, "y": 0, "w": 5, "h": 12 },
      "binding": { "metrics": ["waterToday", "gasToday", "utilCost"] } },
    { "id": "model", "type": "viewer3d", "grid": { "x": 5, "y": 0, "w": 13, "h": 12 },
      "config": { "markers": true } },
    { "id": "panel", "type": "modRows", "grid": { "x": 18, "y": 0, "w": 6, "h": 12 },
      "binding": { "title": "demoLiteT", "module": "utilities",
        "rows": [ { "label": "subWater", "key": "water", "sub": "water", "pageId": "water" },
                  { "label": "subGas", "key": "gas", "sub": "gas", "pageId": "gas" } ] } }
  ]
};
