/* Template document — Utilities: water and gas (D89). */
window.EKO_REPORTS = window.EKO_REPORTS || { templates: {} };
window.EKO_REPORTS.templates['utilities-water-gas'] = {
  "schemaVersion": 1, "id": "utilities-water-gas", "titleKey": "rpT.utilities", "family": "utilities", "descKey": "rpD.utilities",
  "defaultPeriod": { "kind": "today" },
  "sources": ["meter.W-01", "meter.G-01", "bms", "meter.MW-03", "meter.KG-02"],
  "sections": [
    { "id": "water", "titleKey": "rpS.water", "requires": ["water"],
      "widgets": [ { "type": "figures", "items": ["water.todayM3", "water.tankVolumeM3", "derived.waterAutonomyDays", "water.meterUptimePct"] } ] },
    { "id": "leak", "titleKey": "rpS.leak", "requires": ["water.leak"],
      "widgets": [ { "type": "status.leak" } ] },
    { "id": "waterAlarms", "titleKey": "rpS.waterAlarms", "requires": ["water.alarms"],
      "widgets": [ { "type": "table.utilAlarms", "kind": "water", "labelKey": "rpW.waterAlarms" } ] },
    { "id": "gas", "titleKey": "rpS.gas", "requires": ["gas"],
      "widgets": [ { "type": "figures", "items": ["gas.todayM3", "gas.avg7M3", "gas.mtdM3", "derived.gasCostMtdAed"] } ] },
    { "id": "gasAlarms", "titleKey": "rpS.gasAlarms", "requires": ["gas.alarms"],
      "widgets": [ { "type": "table.utilAlarms", "kind": "gas", "labelKey": "rpW.gasAlarms" } ] }
  ]
};
