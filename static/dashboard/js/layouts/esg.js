/* Layout documents: ESG (D175). The landing is a categoryLanding (the ESG
   OVERVIEW over the model, the module panel on the end side); the five
   sub-views are full-width detail pages, like Water and Benchmarking, because
   their tables need the width. D176 C6: Target vs Actual joined them. */
window.EKO_LAYOUTS = window.EKO_LAYOUTS || {};
window.EKO_LAYOUTS.esg = {
  "schemaVersion": 1, "pageId": "esg", "archetype": "categoryLanding", "site": "marsa",
  "askChips": [],
  "widgets": [
    { "id": "summary", "type": "esgSummary", "grid": { "x": 0, "y": 0, "w": 5, "h": 12 }, "binding": { "data": "esg" } },
    { "id": "model", "type": "viewer3d", "grid": { "x": 5, "y": 0, "w": 13, "h": 12 }, "config": { "markers": true, "timeline": false } },
    { "id": "panel", "type": "esgPanel", "grid": { "x": 18, "y": 0, "w": 6, "h": 12 }, "binding": { "data": "esg" } }
  ]
};
[["esg-tva", "esgTvaPage"], ["esg-nz", "esgNzPage"], ["esg-bills", "esgBillsPage"], ["esg-ieq", "esgIeqPage"], ["esg-rep", "esgRepPage"]].forEach(([id, type]) => {
  window.EKO_LAYOUTS[id] = { "schemaVersion": 1, "pageId": id, "archetype": "detailPage", "site": "marsa", "askChips": [],
    "widgets": [ { "id": "page", "type": type, "grid": { "x": 0, "y": 0, "w": 24, "h": 12 }, "binding": { "data": "esg" } } ] };
});
