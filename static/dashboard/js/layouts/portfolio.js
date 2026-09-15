/* Layout document — Portfolio landing (D103): the level above one twin. The
   page is one archetype (portfolioPage) whose body is the shared data grid
   with the estate spec (EKO_GRIDS.portfolio) and, behind a toggle, the map.
   No site data lives here; the estate fixture is js/data/portfolio.js. */
window.EKO_LAYOUTS = window.EKO_LAYOUTS || {};
window.EKO_LAYOUTS.portfolio = {
  "schemaVersion": 1, "pageId": "portfolio", "archetype": "portfolioPage", "site": null,
  "askChips": [],
  "kpiChips": ["energy", "wos", "alarms"],
  "windows": ["6h", "day"],
  "widgets": [ { "id": "estate", "type": "portfolioPage", "grid": { "x": 0, "y": 0, "w": 24, "h": 12 } } ]
};
/* The portfolio site detail (D104): a site that is metered without a 3D model. */
window.EKO_LAYOUTS.pfsite = { "schemaVersion": 1, "pageId": "pfsite", "archetype": "portfolioSite", "site": null, "askChips": [], "widgets": [ { "id": "site", "type": "portfolioSite", "grid": { "x": 0, "y": 0, "w": 24, "h": 12 } } ] };
