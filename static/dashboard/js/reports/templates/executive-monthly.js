/* Template document — Executive monthly (D89): month to date. The forecast
   sub-module is locked on this site: its section says so. */
window.EKO_REPORTS = window.EKO_REPORTS || { templates: {} };
window.EKO_REPORTS.templates['executive-monthly'] = {
  "schemaVersion": 1, "id": "executive-monthly", "titleKey": "rpT.executive", "family": "executive", "descKey": "rpD.executive",
  "defaultPeriod": { "kind": "month" },
  "sources": ["meters.main", "pmu", "model.opt", "model.anom", "bench", "alarms", "meter.G-01", "meter.W-01"],
  "sections": [
    { "id": "energy", "titleKey": "rpS.energyMonth",
      "widgets": [ { "type": "figures", "items": ["energy.mtdKwh", "derived.energyCostMtdAed", "derived.co2MtdT", "power.prevMonthKwh", "derived.energyCostPrevMonthAed", "derived.co2PrevMonthT", "energy.performancePct", "power.contractedKw"] } ] },
    { "id": "waste", "titleKey": "rpS.waste",
      "widgets": [ { "type": "figures", "items": ["derived.wasteAedMtd", "derived.avoidableAedMo"] }, { "type": "table.waste", "labelKey": "rpW.waste" } ] },
    { "id": "anom", "titleKey": "rpS.anomalies", "optional": true, "requires": ["anom.items"],
      "widgets": [ { "type": "table.anom", "labelKey": "rpW.anom" } ] },
    { "id": "bench", "titleKey": "rpS.bench", "sub": "bench", "moduleLabelKey": "subBench",
      "widgets": [ { "type": "table.bench", "labelKey": "rpW.bench" } ] },
    { "id": "fcst", "titleKey": "rpS.forecast", "sub": "fcst", "moduleLabelKey": "subFcst",
      "widgets": [ { "type": "figures", "items": ["fcst.monthEndMwh"] } ] },
    { "id": "utilities", "titleKey": "rpS.utilMonth",
      "widgets": [ { "type": "figures", "items": ["gas.mtdM3", "derived.gasCostMtdAed", "water.tankVolumeM3", "derived.waterAutonomyDays"] } ] },
    { "id": "alarms", "titleKey": "rpS.alarmCounts",
      "widgets": [ { "type": "figures", "items": ["alarms.open", "alarms.critical", "alarms.high", "alarms.medium", "derived.ackRatePct"] }, { "type": "table.alarmsBySys", "labelKey": "rpW.alarmsBySys" } ] },
    { "id": "spaces", "titleKey": "rpS.spaces",
      "widgets": [ { "type": "figures", "items": ["spaces.comfortPct", "spaces.occupiedPct"] } ] }
  ]
};
