/* Template document — Alarm summary (D89). A layout document, not code. */
window.EKO_REPORTS = window.EKO_REPORTS || { templates: {} };
window.EKO_REPORTS.templates['alarm-summary'] = {
  "schemaVersion": 1, "id": "alarm-summary", "titleKey": "rpT.alarmSummary", "family": "alarms", "descKey": "rpD.alarmSummary",
  "defaultPeriod": { "kind": "today" },
  "sources": ["alarms", "assets", "cmms"],
  "sections": [
    { "id": "counts", "titleKey": "rpS.alarmCounts",
      "widgets": [ { "type": "figures", "items": ["alarms.open", "alarms.critical", "alarms.high", "alarms.medium", "alarms.acked", "derived.ackRatePct", "alarms.oldestH", "alarms.inWindow"] } ] },
    { "id": "bySystem", "titleKey": "rpS.alarmsBySystem",
      "widgets": [ { "type": "table.alarmsBySys", "labelKey": "rpW.alarmsBySys" } ] },
    { "id": "list", "titleKey": "rpS.alarms",
      "widgets": [ { "type": "table.alarms" } ] },
    { "id": "unacked", "titleKey": "rpS.unacked",
      "widgets": [ { "type": "table.alarms", "scope": "unacked", "hours": 8760 } ] },
    { "id": "wo", "titleKey": "rpS.woMotion",
      "widgets": [ { "type": "figures", "items": ["wo.open", "wo.raisedToday"] }, { "type": "table.wo", "scope": "alarmAssets", "labelKey": "rpW.woAlarmAssets" } ] }
  ]
};
