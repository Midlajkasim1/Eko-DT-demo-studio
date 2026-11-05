/* Layout document: Maintenance (D180). Archetype detailPage: one full-width
   page, like Water and the ESG sub-views. Rendered by js/maintenance.js. */
window.EKO_LAYOUTS = window.EKO_LAYOUTS || {};
window.EKO_LAYOUTS.mnt = {
  "schemaVersion": 1, "pageId": "mnt", "archetype": "detailPage", "site": "marsa",
  "askChips": [],
  "widgets": [ { "id": "page", "type": "mntPage", "grid": { "x": 0, "y": 0, "w": 24, "h": 12 }, "binding": { "data": "maintenance" } } ]
};
/* E13: the executive summary (js/personas.js), a full-width page */
/* E14: the prediction and the proof (js/e14.js), full-width pages reached from the asset drawer and the engineer's landing */
window.EKO_LAYOUTS.predict = { "schemaVersion": 1, "pageId": "predict", "archetype": "detailPage", "site": "marsa", "askChips": [],
  "widgets": [ { "id": "page", "type": "predictPage", "grid": { "x": 0, "y": 0, "w": 24, "h": 12 }, "binding": { "data": "prove" } } ] };
window.EKO_LAYOUTS.prove = { "schemaVersion": 1, "pageId": "prove", "archetype": "detailPage", "site": "marsa", "askChips": [],
  "widgets": [ { "id": "page", "type": "provePage", "grid": { "x": 0, "y": 0, "w": 24, "h": 12 }, "binding": { "data": "prove" } } ] };
window.EKO_LAYOUTS.exec = { "schemaVersion": 1, "pageId": "exec", "archetype": "detailPage", "site": "marsa", "askChips": [],
  "widgets": [ { "id": "page", "type": "execPage", "grid": { "x": 0, "y": 0, "w": 24, "h": 12 }, "binding": { "data": "energy" } } ] };
