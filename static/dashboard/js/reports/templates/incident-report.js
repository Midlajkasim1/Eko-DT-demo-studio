/* Template document — Incident report (D89): generated from ONE alarm
   (params.alarmId). Every section that needs the alarm says so when none is
   given. */
window.EKO_REPORTS = window.EKO_REPORTS || { templates: {} };
window.EKO_REPORTS.templates['incident-report'] = {
  "schemaVersion": 1, "id": "incident-report", "titleKey": "rpT.incident", "family": "incident", "descKey": "rpD.incident",
  "defaultPeriod": { "kind": "today" }, "needsAlarm": true,
  "sources": ["alarms", "assets", "bms", "cmms", "model.opt"],
  "sections": [
    { "id": "alarm", "titleKey": "rpS.incidentAlarm", "needsIncident": true,
      "widgets": [ { "type": "kv.alarm", "labelKey": "rpW.alarmDetail" }, { "type": "figures", "items": ["incident.ageH", "incident.impactAedMo"] } ] },
    { "id": "asset", "titleKey": "rpS.incidentAsset", "needsIncident": true,
      "widgets": [ { "type": "kv.asset", "labelKey": "rpW.assetDetail" } ] },
    { "id": "lifecycle", "titleKey": "rpS.lifecycle", "needsIncident": true,
      "widgets": [ { "type": "table.lifecycle", "labelKey": "rpW.lifecycle" } ] },
    { "id": "related", "titleKey": "rpS.relatedAlarms", "needsIncident": true,
      "widgets": [ { "type": "table.alarms", "scope": "asset", "hours": 8760 } ] },
    { "id": "wo", "titleKey": "rpS.woAsset", "needsIncident": true,
      "widgets": [ { "type": "table.wo", "scope": "asset", "labelKey": "rpW.woAsset" } ] },
    { "id": "load", "titleKey": "rpS.loadContext",
      "widgets": [ { "type": "chart.line", "series": "load24hMw", "unit": "MW", "labelKey": "rpW.load24", "sources": ["pmu"] } ] }
  ]
};
