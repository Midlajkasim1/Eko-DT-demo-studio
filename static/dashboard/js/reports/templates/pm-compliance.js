/* Template document — PM compliance (D89). The maintenance module is locked
   on this site: its sections say so and contribute nothing (governance rule).
   The work-order and service views come from the assets register, which is
   enabled. */
window.EKO_REPORTS = window.EKO_REPORTS || { templates: {} };
window.EKO_REPORTS.templates['pm-compliance'] = {
  "schemaVersion": 1, "id": "pm-compliance", "titleKey": "rpT.pmCompliance", "family": "maintenance", "descKey": "rpD.pmCompliance",
  "defaultPeriod": { "kind": "month" },
  "sources": ["cmms", "assets"],
  "sections": [
    { "id": "pmPlan", "titleKey": "rpS.pmPlan", "module": "maintenance", "moduleLabelKey": "modMaintenance", "widgets": [] },
    { "id": "pmOverdue", "titleKey": "rpS.pmOverdue", "module": "maintenance", "moduleLabelKey": "modMaintenance", "widgets": [] },
    { "id": "wo", "titleKey": "rpS.woMotion",
      "widgets": [ { "type": "figures", "items": ["wo.open", "wo.raisedToday", "assets.inAlarm", "assets.stale"] }, { "type": "table.wo", "labelKey": "rpW.woAll" } ] },
    { "id": "service", "titleKey": "rpS.service",
      "widgets": [ { "type": "table.service", "labelKey": "rpW.service" } ] },
    { "id": "stale", "titleKey": "rpS.staleAssets",
      "widgets": [ { "type": "table.stale", "labelKey": "rpW.stale" } ] }
  ]
};
