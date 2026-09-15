/* Layout document — Assets Register. Archetype: registerPage
   (table + docked asset panel + model kept visible). */
window.EKO_LAYOUTS = window.EKO_LAYOUTS || {};
window.EKO_LAYOUTS["assets-register"] = {
  "schemaVersion": 1,
  "pageId": "assets-register",
  "archetype": "registerPage",
  "site": "marsa",
  "askChips": ["chipFaults"],
  "widgets": [
    { "id": "model", "type": "viewerStrip", "grid": { "x": 0, "y": 0, "w": 6, "h": 12 },
      "config": { "markers": true, "dock": "none", "pills": false } },
    { "id": "table", "type": "registerTable", "grid": { "x": 6, "y": 0, "w": 18, "h": 12 },
      "binding": { "columns": ["id", "st", "floor", "zone", "wos", "wost"],
                   "search": true, "statusFilter": true } }
  ]
};
