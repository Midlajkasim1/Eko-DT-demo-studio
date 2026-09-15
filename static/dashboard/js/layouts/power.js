/* Layout document — Power detail. Archetype: detailPage (full-width
   analytics: hero KPI strip + widget grid). */
window.EKO_LAYOUTS = window.EKO_LAYOUTS || {};
window.EKO_LAYOUTS.power = {
  "schemaVersion": 1,
  "pageId": "power",
  "archetype": "detailPage",
  "site": "marsa",
  "askChips": ["chipWasting", "chipCompareWk", "!chipLoadCurve"],
  "widgets": [
    { "id": "page", "type": "powerPage", "grid": { "x": 0, "y": 0, "w": 24, "h": 12 },
      "binding": { "metrics": "power" } }
    /* D117: the D96 measurement-and-verification row (baseline versus actual, meter status) is off this page so it matches
       the Final mockup; the renderer (`powerMv`) and the data stay for the reports and the wall. Restore by adding
       { "id": "mv", "type": "powerMv", "grid": { "x": 0, "y": 12, "w": 24, "h": 8 }, "binding": { "layout": "side", "sideAbove": 1800, "cards": ["baselineVsActual", "meterStatus"] } } */
  ]
};
