/* Template document — Shift handover (D89): the last 12 hours. */
window.EKO_REPORTS = window.EKO_REPORTS || { templates: {} };
window.EKO_REPORTS.templates['shift-handover'] = {
  "schemaVersion": 1, "id": "shift-handover", "titleKey": "rpT.shiftHandover", "family": "operations", "descKey": "rpD.shiftHandover",
  "defaultPeriod": { "kind": "last", "h": 12 },
  "sources": ["alarms", "pmu", "cmms", "meter.W-01", "meter.G-01", "model.anom"],
  "sections": [
    { "id": "status", "titleKey": "rpS.siteStatus",
      "widgets": [ { "type": "figures", "items": ["metrics.loadNowMw", "metrics.pfNow", "alarms.open", "alarms.critical", "alarms.inWindow", "wo.raisedToday"] } ] },
    { "id": "alarms", "titleKey": "rpS.alarmsShift",
      "widgets": [ { "type": "table.alarms" } ] },
    { "id": "acked", "titleKey": "rpS.ackedShift",
      "widgets": [ { "type": "table.alarms", "scope": "acked", "hours": 8760 } ] },
    { "id": "wo", "titleKey": "rpS.woToday",
      "widgets": [ { "type": "table.wo", "scope": "today", "labelKey": "rpW.woToday" } ] },
    { "id": "utilities", "titleKey": "rpS.utilSnapshot",
      "widgets": [ { "type": "figures", "items": ["water.tankVolumeM3", "derived.waterAutonomyDays", "gas.avg7M3"] } ] },
    { "id": "anom", "titleKey": "rpS.anomalies", "optional": true, "requires": ["anom.items"],
      "widgets": [ { "type": "table.anom", "labelKey": "rpW.anom" } ] },
    { "id": "notes", "titleKey": "rpS.notes",
      "widgets": [ { "type": "text.notes", "labelKey": "rpW.notes" } ] }
  ]
};
