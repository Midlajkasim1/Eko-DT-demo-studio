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
        { "id": "hvac",       "label": "sysHvacMech", "pageId": "systems" },
        { "id": "electrical", "label": "sysElectrical", "pageId": "systems" },
        { "id": "life",       "label": "sysLifeAmp", "pageId": "systems" },
        { "id": "security",   "label": "sysSecurity", "pageId": "systems" },
        /* E15 port: Other systems and Data health; hidden by entitlement where a site has no data for them */
        { "id": "other",      "label": "p2.nav.others", "pageId": "sys-other" },
        { "id": "data",       "label": "p2.nav.data",  "pageId": "sys-data" } ] },
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
        { "id": "heat",  "label": "subHeat", "pageId": "heatmap" },
        { "id": "occ",   "label": "p2.nav.occ", "pageId": "spaces-occ" } ] },   /* E15 port: Occupancy */
    /* E15 port: ESG, Maintenance and Security and life safety (replace the placeholder entries); the pack's sub-views and page ids */
    { "id": "esg",       "label": "modEsg",       "icon": "leaf",   "pageId": "esg",
      "subs": [
        { "id": "tva",   "label": "esgTva",   "pageId": "esg-tva" },
        { "id": "nz",    "label": "esgNz",    "pageId": "esg-nz" },
        { "id": "bills", "label": "esgBills", "pageId": "esg-bills" },
        { "id": "ieq",   "label": "esgIeq",   "pageId": "esg-ieq" },
        { "id": "rep",   "label": "esgRep",   "pageId": "esg-rep" } ] },
    { "id": "maintenance", "label": "modMaintenance", "icon": "wrench", "pageId": "mnt" },
    { "id": "security",    "label": "modSecLs",       "icon": "shield", "pageId": "sec",
      "subs": [
        { "id": "cams",   "label": "sec.nav.cams",   "pageId": "sec-cams" },
        { "id": "access", "label": "sec.nav.access", "pageId": "sec-access" },
        { "id": "intr",   "label": "p2.nav.intr",    "pageId": "sec-intr" },
        { "id": "fire",   "label": "sec.nav.fire",   "pageId": "sec-fire" },
        { "id": "power",  "label": "sec.nav.power",  "pageId": "sec-power" },
        { "id": "evac",   "label": "sec.nav.evac",   "pageId": "sec-evac" },
        { "id": "nurse",  "label": "sec.nav.nurse",  "pageId": "sec-nurse" },
        { "id": "health", "label": "p2.nav.health",  "pageId": "sec-health" } ] }
  ],
  "phoneTabs": ["overview", "energy", "utilities", "assets"]
};
