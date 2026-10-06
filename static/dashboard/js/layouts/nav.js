/* ============================================================================
   Navigation document — the left rail, the phone tab bar and the routes are
   all built from this one file. See /handoff/how-to-change.md §5–6.
   Locks are NOT declared here (D125): data.entitlements decides which modules
   are active, add-ons or hidden, and js/addons.js stamps that on this document.
   ============================================================================ */
window.EKO_LAYOUTS = window.EKO_LAYOUTS || {};
window.EKO_LAYOUTS.nav = {
  "schemaVersion": 1,
  "modules": [
    { "id": "overview",  "label": "modOverview",  "icon": "home",   "pageId": "marsa-overview", "mobile": "mobOverview" },
    { "id": "systems",   "label": "modSystems",   "icon": "grid",   "pageId": "systems",
      "subs": [
        { "id": "mechanical", "label": "sysMechanical", "pageId": "systems" },
        { "id": "electrical", "label": "sysElectrical", "pageId": "systems" },
        { "id": "ems",        "label": "sysEms", "pageId": "systems" },
        { "id": "utility",    "label": "sysUtility", "pageId": "systems" } ] },
    { "id": "energy",    "label": "modEnergy",    "icon": "bolt",   "pageId": "energy", "mobile": "mobEnergy",
      "subs": [
        { "id": "power", "label": "subPower", "pageId": "power" },
        { "id": "anom",  "label": "subAnom",  "pageId": "anom", "dot": "high" },
        { "id": "bench", "label": "subBench", "pageId": "bench" },
        { "id": "fcst",  "label": "subFcst",  "pageId": "fcst" } ] },
    { "id": "utilities", "label": "modUtilities", "icon": "drop",   "pageId": "utilities", "mobile": "mobUtilities",
      "subs": [
        { "id": "water", "label": "subWater", "pageId": "water" },
        { "id": "gas",   "label": "subGas",   "pageId": "gas" } ] },
    { "id": "assets",    "label": "modAssets",    "icon": "box",    "pageId": "assets", "mobile": "mobAssets",
      "subs": [
        { "id": "reg",   "label": "subRegister", "pageId": "assets-register" } ] },
    { "id": "spaces",    "label": "modSpaces",    "icon": "layout", "pageId": "spaces",
      "subs": [
        { "id": "heat",  "label": "subHeat", "pageId": "heatmap" } ] },
    { "id": "esg",         "label": "modEsg",         "icon": "leaf" },
    { "id": "maintenance", "label": "modMaintenance", "icon": "wrench" },
    { "id": "security",    "label": "modSecurity",    "icon": "shield" }
  ],
  "phoneTabs": ["overview", "energy", "utilities", "assets"]
};
