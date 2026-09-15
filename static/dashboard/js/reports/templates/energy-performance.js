/* Template document — Energy performance (D88). The benchmark sub-module is
   locked on this site: its section says so (governance rule, D89). */
window.EKO_REPORTS = window.EKO_REPORTS || { templates: {} };
window.EKO_REPORTS.templates['energy-performance'] = {
  "schemaVersion": 1, "id": "energy-performance", "titleKey": "rpT.energyPerformance", "family": "energy", "descKey": "rpD.energyPerformance",
  "defaultPeriod": { "kind": "today" },
  "sources": ["meters.main", "pmu", "model.opt", "model.anom", "bench"],
  "sections": [
    { "id": "period", "titleKey": "rpS.periodEnergy",
      "widgets": [ { "type": "period.energy" } ] },
    { "id": "hero", "titleKey": "rpS.energyHero",
      "widgets": [ { "type": "figures", "items": ["energy.currentKw", "energy.baselineKw", "energy.mtdKwh", "power.prevMonthKwh", "metrics.peakTodayMw", "metrics.pfNow", "derived.co2MtdT", "energy.performancePct"] } ] },
    { "id": "load", "titleKey": "rpS.load",
      "widgets": [ { "type": "chart.line", "series": "load24hMw", "unit": "MW", "labelKey": "rpW.load24", "sources": ["pmu"] }, { "type": "table.boards", "labelKey": "rpW.boards" } ] },
    { "id": "waste", "titleKey": "rpS.waste",
      "widgets": [ { "type": "figures", "items": ["derived.wasteAedMtd", "derived.avoidableAedMo"] }, { "type": "table.waste", "labelKey": "rpW.waste" } ] },
    { "id": "anom", "titleKey": "rpS.anomalies", "optional": true, "requires": ["anom.items"],
      "widgets": [ { "type": "table.anom", "labelKey": "rpW.anom" } ] },
    { "id": "bench", "titleKey": "rpS.bench", "optional": true, "sub": "bench", "moduleLabelKey": "subBench",
      "widgets": [ { "type": "table.bench", "labelKey": "rpW.bench" } ] }
  ]
};
