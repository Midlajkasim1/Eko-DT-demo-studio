/* Report template — Morning brief. A layout document: sections, the widgets
   per section with their data bindings, the default period, the required
   sources, and which sections are optional when their data is unavailable.
   Adding a report = a file like this + i18n keys (rpT.* / rpS.* / rpW.*). */
window.EKO_REPORTS = window.EKO_REPORTS || { templates: {} };
window.EKO_REPORTS.templates['morning-brief'] = {
  "schemaVersion": 1,
  "id": "morning-brief",
  "titleKey": "rpT.morningBrief", "family": "site", "descKey": "rpD.morningBrief",
  "defaultPeriod": { "kind": "today" },
  "sources": ["meters.main", "bms", "pmu", "alarms"],
  "sections": [
    { "id": "headline", "titleKey": "rpS.headline", "widgets": [
      { "type": "figures", "items": ["metrics.energyTodayMwh", "derived.energyCostTodayAed", "derived.co2TodayT", "metrics.comfortIndex", "metrics.iaq"] } ] },
    { "id": "load", "titleKey": "rpS.load", "widgets": [
      { "type": "chart.line", "series": "load24hMw", "unit": "MW", "labelKey": "rpW.load24", "sources": ["pmu"] },
      { "type": "figures", "items": ["metrics.loadNowMw", "metrics.peakTodayMw", "metrics.pfNow"] } ] },
    { "id": "alarms", "titleKey": "rpS.alarms", "widgets": [ { "type": "table.alarms" } ] },
    { "id": "water", "titleKey": "rpS.water", "optional": true, "requires": ["water"], "widgets": [
      { "type": "figures", "items": ["water.todayM3", "water.tankVolumeM3", "derived.waterAutonomyDays"] },
      { "type": "status.leak" } ] },
    { "id": "gas", "titleKey": "rpS.gas", "optional": true, "requires": ["gas"], "widgets": [
      { "type": "figures", "items": ["gas.todayM3", "gas.mtdM3", "derived.gasCostMtdAed"] } ] }
  ]
};
