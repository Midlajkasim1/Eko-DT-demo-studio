/* Layout documents — the four Systems sub-view KPI dashboards (D27).
   Archetype detailPage, exactly like Water/Gas/Power: full-width heroes +
   widgets, no summary panel, no viewer. One widget type (sysPage) bound to
   its group id; all values derive from systems.groups + the alarm list. */
window.EKO_LAYOUTS = window.EKO_LAYOUTS || {};
["mechanical", "electrical", "ems", "utility", "hvac", "life", "security"].forEach(function(gid){
  window.EKO_LAYOUTS["systems-" + gid] = {
    "schemaVersion": 1,
    "pageId": "systems-" + gid,
    "archetype": "detailPage",
    "site": "marsa",
    "askChips": ["chipFaults"],
    "widgets": [
      { "id": "page", "type": "sysPage", "grid": { "x": 0, "y": 0, "w": 24, "h": 12 },
        "binding": { "group": gid } }
    ]
  };
});
