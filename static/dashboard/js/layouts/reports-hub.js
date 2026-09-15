/* Layout document — Reports hub (D92/D93): the page behind the top-bar
   report icon's "All reports". Families give every template its icon, drawn
   from the app's own icon set (the nav and alarm surfaces), and its colour:
   `hueKey` names the Overview summary row whose identity hue it reuses
   (energy, water, gas …), so a colour means the same domain everywhere in the
   product. Families without a domain hue are neutral by design. Archetype:
   reportsHub. */
window.EKO_LAYOUTS = window.EKO_LAYOUTS || {};
window.EKO_LAYOUTS.reports = {
  "schemaVersion": 1, "pageId": "reports", "archetype": "reportsHub", "site": "marsa",
  "families": {
    "site":        { "icon": "home",   "labelKey": "rpFam.site" },
    "energy":      { "icon": "bolt",   "hueKey": "energy", "labelKey": "rpFam.energy" },
    "alarms":      { "icon": "warn",   "labelKey": "rpFam.alarms" },
    "utilities":   { "icon": "drop",   "hueKey": "water",  "labelKey": "rpFam.utilities" },
    "maintenance": { "icon": "wrench", "labelKey": "rpFam.maintenance" },
    "operations":  { "icon": "clock",  "labelKey": "rpFam.operations" },
    "incident":    { "icon": "doc",    "labelKey": "rpFam.incident" },
    "executive":   { "icon": "gauge",  "labelKey": "rpFam.executive" }
  },
  "libraryPageSize": 20,
  "widgets": [ { "id": "hub", "type": "reportsHub", "grid": { "x": 0, "y": 0, "w": 24, "h": 12 } } ]
};
