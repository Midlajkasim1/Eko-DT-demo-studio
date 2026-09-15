/* Layout document — Systems landing + its four sub-views (state.sub picks
   the group; the same document serves all five). Archetype: categoryLanding. */
window.EKO_LAYOUTS = window.EKO_LAYOUTS || {};
window.EKO_LAYOUTS.systems = {
  "schemaVersion": 1,
  "pageId": "systems",
  "archetype": "categoryLanding",
  "site": "marsa",
  "askChips": ["chipEquip", "chipUnits", "!chipWaterwk"],
  "widgets": [
    { "id": "summary", "type": "systemsSummary", "grid": { "x": 0, "y": 0, "w": 5, "h": 12 },
      "binding": { "groups": "systems.groups" } },
    { "id": "model", "type": "viewer3d", "grid": { "x": 5, "y": 0, "w": 13, "h": 12 },
      "config": { "markers": true, "timeline": true } },
    { "id": "panel", "type": "systemsPanel", "grid": { "x": 18, "y": 0, "w": 6, "h": 12 },
      "binding": { "alarms": "alarms" } }
  ]
};
