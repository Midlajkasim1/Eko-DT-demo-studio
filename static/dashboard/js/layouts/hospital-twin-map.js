/* The EKO Hospital Live Twin's mapping: which FIN equipment each drawn machine is, which FIN floor each drawn level is, how a FIN point, a FIN alarm and
   an FD&D point are read, and the reference schematic's equipment relationships (upstream / downstream, for trace and impact). Data and pure functions only (no DOM), used by hospital-twin.js and tested against the saved exports in spec/fixtures/eko-hospital.

   EVIDENCE (FIN exports of 6 Nov 2026, audited 7 Nov 2026):
     - equipment.json: the Studio's equipment feed as FIN gave it (64 equipment: name, FIN id, floor, type tags, BIM id, every live point). PRIMARY.
     - history-points.json: the historised points (supplementary: names and units only; it has no equipment ids, types or floors).
     - alarms.json: the open alarms with their FIN equipment ids and states (its `history` entries are cleared records, never active).
   A drawn machine is MAPPED only when one FIN equipment in the equipment export has that name (or the pinned name in PIN), its FIN type tag fits the drawn
   type (TYPE_TAG) and its FIN floor is the drawn level's (LEVELS). Everything else is UNMAPPED: no similar-name matching anywhere.
   At runtime the live feed must agree again: one asset with that navName, the same FIN id as REF, a fitting type tag, else AMBIGUOUS (or MISSING).
   FLOORS are FIN's floorRef names, verified by every mapped equipment of each level in the equipment export.
   PROJECT: this mapping is published (window.EKO_TWIN_MAP) only for a project whose Hospital graphics are on, the same gate as the Live Twin entry. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.document) {
    /* re-run on every dashboard load: a project without the Hospital graphics never keeps the Hospital's mapping */
    if ((root.INJECTED_PROJECT_CONFIG || {}).hospitalHvac === true) root.EKO_TWIN_MAP = api;
    else try { delete root.EKO_TWIN_MAP; } catch (e) { root.EKO_TWIN_MAP = undefined; }
  }
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  /* Every FIN equipment the twin draws, from equipment.json: FIN id, floor, type, type tags, BIM id (Zinc's \$ escape removed; null when FIN has none and
     the feed sent the FIN id instead) and points. A point is [navName, unit, flags, enum]: flags = FIN pointKind (B Bool, N Number, S Str) then
     h historised, a alarm point, s setpoint. Generated from spec/fixtures/eko-hospital/equipment.json; the tests check it still equals the export. */
  var REF = {
    "PMU_Main": { id: "p:ekoHospital:r:3260b50c-de068b48", floor: "LEVEL-01", type: "pmu", tags: ["elec", "main", "pmu"], bim: null, points: [
      ["Voltage", "V", "N"],
      ["TotalEnergy", "kWh", "Nh"],
      ["Frequency", "Hz", "N"],
      ["Current", "A", "N"],
      ["ActivePower", "kW", "Nh"],
      ["DEWA_SupplyLost", "", "B", "Normal,Supply Lost"]] },
    "AUTOMATIC_TRANSFER_SWITCH_01": { id: "p:ekoHospital:r:3260c251-6d293f64", floor: "LEVEL-01", type: "ats", tags: ["ats", "elec"], bim: null, points: [
      ["EmergencySupplySts", "", "B"],
      ["NormalSupplySts", "", "B"]] },
    /* SMDB_01, MCC_01, DB_01 and BTU: the 6 Nov export names these SMDB_GF, MCC_GF, DB_GF and BTU_01. The live FIN project (Phase 6A, 10 Nov) holds records named
       SMDB_01, MCC_01, DB_01 and BTU with the SAME FIN ids, floors and types, so the keys here are the live names and the ids are the export's. */
    "SMDB_01": { id: "p:ekoHospital:r:3260c26f-8dcc9eb8", floor: "LEVEL-01", type: "elecPanel", tags: ["elecPanel", "smdb"], bim: null, points: [
      ["Incomer_ON_OFF_Status", "", "B", "OFF,ON"],
      ["Incomer_Trip_Status", "", "B", "NORMAL,TRIP"]] },
    /* in the 6 Nov export these two have no points at all and no BIM id, only the FIN record id. */
    "MCC_01": { id: "p:ekoHospital:r:328032b7-6a718568", floor: "LEVEL-01", type: "elecPanel", tags: ["elecPanel", "mcc"], bim: null, points: [] },
    "DB_01": { id: "p:ekoHospital:r:328032b7-2fe18cc2", floor: "LEVEL-01", type: "elecPanel", tags: ["db", "elecPanel"], bim: null, points: [] },
    /* V2 equipment in the 6 Nov export with no points: the MDB (no BIM id), nine cameras and six medical devices (each with an IFC GlobalId from FIN, not
       yet checked against an Eko Hospital model: none is available). Electrical readings for the MDB come from PMU_Main, see BORROW. */
    "MDB": { id: "p:ekoHospital:r:328032b7-71b04cfa", floor: "LEVEL-01", type: "elecPanel", tags: ["elecPanel", "mdb"], bim: null, points: [] },
    "CCTV_01": { id: "p:ekoHospital:r:3275e82e-871268cf", floor: "LEVEL-01", type: "cctv", tags: ["cctv"], bim: "0N2_7qYhzV2fHjvUXsA3DL", points: [] },
    "CCTV_02": { id: "p:ekoHospital:r:3275e8e8-8f4d73dd", floor: "LEVEL-01", type: "cctv", tags: ["cctv"], bim: "15C9hkYjaryi3LYwxTUh8V", points: [] },
    "CCTV_03": { id: "p:ekoHospital:r:3275e8e8-9d10c0e0", floor: "LEVEL-01", type: "cctv", tags: ["cctv"], bim: "3Q9Xq9LpBbDdwClhPdvJRH", points: [] },
    "CCTV_04": { id: "p:ekoHospital:r:3275e929-77be7f12", floor: "LEVEL-02", type: "cctv", tags: ["cctv"], bim: "2oBWD5AX7I4YbN3hm5jA7n", points: [] },
    "CCTV_05": { id: "p:ekoHospital:r:3275e929-4a88af05", floor: "LEVEL-02", type: "cctv", tags: ["cctv"], bim: "1umrm_IMUgTv5M_dVjNDqY", points: [] },
    "CCTV_06": { id: "p:ekoHospital:r:3275e929-96575306", floor: "LEVEL-02", type: "cctv", tags: ["cctv"], bim: "07Qoc9Rf7_WYNDoVTV8asN", points: [] },
    "CCTV_07": { id: "p:ekoHospital:r:3275e995-ae7d12ee", floor: "LEVEL-03", type: "cctv", tags: ["cctv"], bim: "2zohlaY67QBMyMbPvDJknX", points: [] },
    "CCTV_08": { id: "p:ekoHospital:r:3275e995-8d710de2", floor: "LEVEL-03", type: "cctv", tags: ["cctv"], bim: "1M4EDLMPAjylxMUM4zwN_g", points: [] },
    "CCTV_09": { id: "p:ekoHospital:r:3275e995-3f772b87", floor: "LEVEL-03", type: "cctv", tags: ["cctv"], bim: "2d0CT5Eg_iv_DReyjENMUU", points: [] },
    "Dialysis Machine": { id: "p:ekoHospital:r:327c4826-23cfadc1", floor: "LEVEL-01", type: "other", tags: [], bim: "0q1KvvrGTE6OkpHWFiyqw6", points: [] },
    "Stretcher": { id: "p:ekoHospital:r:327c4848-25037d5c", floor: "LEVEL-01", type: "other", tags: [], bim: "3cnYKHgGPEL9y_WhisbBNm", points: [] },
    "Laser System": { id: "p:ekoHospital:r:327c487d-ef56d6c6", floor: "LEVEL-02", type: "other", tags: [], bim: "2RYeQGW$H2LvFkemIHa9aU", points: [] },
    "Refrigerator with Freezer": { id: "p:ekoHospital:r:327c4897-66c47bdf", floor: "LEVEL-02", type: "other", tags: [], bim: "1zLtYklgzEURMf8B9jsTZR", points: [] },
    "Ultrasound": { id: "p:ekoHospital:r:327c48b3-98b50ceb", floor: "LEVEL-02", type: "other", tags: [], bim: "0nTmzwD6rFwBly6r9SvQLo", points: [] },
    "Scale Clinical Bariatric": { id: "p:ekoHospital:r:327c48d0-4984fb0c", floor: "LEVEL-03", type: "other", tags: [], bim: "08C6n76h526AkJKCDGnceQ", points: [] },
    "BOOSTER_PUMP": { id: "p:ekoHospital:r:3260c3c7-fe81fee5", floor: "LEVEL-01", type: "pump", tags: ["booster", "plumbing", "pump"], bim: null, points: [
      ["CutOutPressure", "bar", "N"],
      ["Pump01RunStatus", "", "B"],
      ["Pump01Trip", "", "B", "Normal,Trip"],
      ["Pump02Cmd", "", "B", "Stop,Start"],
      ["CutInPressure", "bar", "N"],
      ["ActiveLoad", "kW", "N"],
      ["Pump02Trip", "", "B", "Normal,Trip"],
      ["Pump02RunStatus", "", "B"],
      ["DischargePressure", "bar", "N"],
      ["Pump01Cmd", "", "B", "Stop,Start"]] },
    "SUMP_PUMP": { id: "p:ekoHospital:r:3264826b-af1f8966", floor: "LEVEL-01", type: "pump", tags: ["plumbing", "pump", "sump"], bim: null, points: [
      ["Pump02Cmd", "", "B"],
      ["HighLevelFloat", "%", "B"],
      ["Pump01RunStatus", "", "B"],
      ["LowLevelFloat", "%", "B"],
      ["HighHighLevelFloat", "%", "B"],
      ["Pump01Trip", "", "B"],
      ["Pump02Trip", "", "B"],
      ["Pump01Cmd", "", "B"],
      ["PitLevel", "%", "N"],
      ["Pump02RunStatus", "", "B"]] },
    "WATER_METER_01": { id: "p:ekoHospital:r:3260c4c9-b51c33b4", floor: "LEVEL-01", type: "meter", tags: ["groundFloor", "meter", "plumbing", "water"], bim: null, points: [
      ["HourlyWaterConsumption", "m³", "Nh"],
      ["FlowRate", "m³/h", "Nh"],
      ["WaterConsumption", "m³", "Nh"]] },
    "OXYGEN_PLANT_01": { id: "p:ekoHospital:r:3260cce4-f1205690", floor: "LEVEL-01", type: "other", tags: ["gasSystem", "oxygen", "plant"], bim: null, points: [
      ["Pressure", "bar", "Nh"],
      ["Flow", "L/min", "Nh"],
      ["Purity", "%", "Nh"],
      ["AlarmStatus", "", "B", "Normal,Trip"],
      ["RunStatus", "", "B"]] },
    "MEDICAL_AIR_COMPRESSOR_01": { id: "p:ekoHospital:r:3260cde0-81b1872a", floor: "LEVEL-01", type: "compressor", tags: ["air", "compressor", "gasSystem", "medical"], bim: null, points: [
      ["AlarmStatus", "", "B", "Normal,Trip"],
      ["Current", "A", "Nh"],
      ["Flow", "L/min", "Nh"],
      ["Pressure", "bar", "Nh"],
      ["RunStatus", "", "B"]] },
    "FAHU_01": { id: "p:ekoHospital:r:32687d1b-619b456f", floor: "LEVEL-01", type: "fahu", tags: ["fahu", "hvac"], bim: "3uCC_Io_e1Wx1zGia9JSrf", points: [
      ["Dehumidification_Performance", "", "Sa"],
      ["ExhaustAirDamperPos", "%", "N"],
      ["Cooling_Performance_Not_Meeting_Setpoint", "", "Sa"],
      ["ExhaustFanCmd", "", "B", "Stop,Start"],
      ["ReturnAirTemp", "°C", "Nh"],
      ["ReturnAirHumidity", "%RH", "Nh"],
      ["OperatingHours", "h", "Nh"],
      ["SupplyAirHumidity", "%RH", "Nh"],
      ["SupplyFanStatus", "", "B"],
      ["Heat_Recovery_Performance", "", "Sa"],
      ["SupplyAirTempSp", "°C", "Ns"],
      ["HeatRecoveryWheelRunStatus", "", "B", "Off,On"],
      ["ExhaustFanTripStatus", "", "B", "Normal,Trip"],
      ["ExhaustFanSpeedCmd", "Hz", "N"],
      ["FD&D_5_Dehumidification_Performance", "", "Ba", "Normal,Fault"],
      ["SupplyFanTripStatus", "", "B", "Normal,Trip"],
      ["Sensor_Fault", "", "Sa"],
      ["ReturnFilterDirtyStatus", "", "B", "Clean,Dirty"],
      ["FD&D_4_Heat_Recovery_Performance", "", "Ba", "Normal,Fault"],
      ["FreshAirDamperPos", "%", "N"],
      ["Fan_Command/Status_Mismatch", "", "Sa"],
      ["SupplyAirTemp", "°C", "Nh"],
      ["FD&D_2_Sensor_Fault", "", "Ba", "Normal,Fault"],
      ["CoolingCoil", "%", "N"],
      ["PreFilterDirtyStatus", "", "B", "Clean,Dirty"],
      ["BagFilterDirtyStatus", "", "B", "Clean,Dirty"],
      ["FreshAirTemp", "°C", "Nh"],
      ["FD&D_3_Fan_Command/Status_Mismatch", "", "Ba", "Normal,Fault"],
      ["HeatRecoveryWheelAirHumidity", "%RH", "Nh"],
      ["HeatRecoveryWheelTripStatus", "", "B", "Normal,Trip"],
      ["FD&D_1_Cooling_Performance", "", "Ba", "Normal,Fault"],
      ["FreshAirHumidity", "%RH", "Nh"],
      ["HeatRecoveryWheelAirTemp", "°C", "Nh"],
      ["ExhaustFanStatus", "", "B", "Off,On"],
      ["SupplyFanCmd", "", "B", "Stop,Start"],
      ["SupplyFanSpeedCmd", "Hz", "N"]] },
    "AHU_01": { id: "p:ekoHospital:r:3260b5da-8173162b", floor: "LEVEL-01", type: "ahu", tags: ["ahu", "hvac"], bim: "2wLf9$IGsICFYFjFAcUnf2", points: [
      ["FD&D_5_CO2_Level_High", "", "Ba", "Normal,Fault"],
      ["RA CO2", "ppm", "Nh"],
      ["FD&D_1_Cooling_Performance", "", "Ba", "Normal,Fault"],
      ["SA Pressure", "Pa", "Nh"],
      ["SA Pressure Sp", "Pa", "Ns"],
      ["SA Temp", "°C", "Nh"],
      ["CoolingCoil", "%", "N"],
      ["BagFilter", "", "B", "Clean,Dirty"],
      ["OA Temp", "°C", "Nh"],
      ["MA Damper", "%", "N"],
      ["Sensor_Fault", "", "Sa"],
      ["RA Temp", "°C", "Nh"],
      ["MA Temp", "°C", "Nh"],
      ["CO2_Level_High", "", "Sa"],
      ["Fan_Command/Status_Mismatch", "", "Sa"],
      ["RA Fan Cmd", "", "B", "Stop,Start"],
      ["OA Damper", "%", "N"],
      ["FD&D_3_Fan_Command/Status_Mismatch", "", "Ba", "Normal,Fault"],
      ["Overcooling", "", "Sa"],
      ["Cooling_Performance_Not_Meeting_Setpoint", "", "Sa"],
      ["SA Fan Status", "", "B"],
      ["AlarmStatus", "", "B", "Normal,Trip"],
      ["SA Humidity", "%RH", "Nh"],
      ["RA Fan Status", "", "B", "Off,On"],
      ["PreFilter", "", "B", "Clean,Dirty"],
      ["OA Humidity", "%RH", "Nh"],
      ["RA Humidity", "%RH", "Nh"],
      ["SA Fan Cmd", "", "B", "Stop,Start"],
      ["SA Temp Sp", "°C", "Ns"],
      ["FD&D_2_Sensor_Fault", "", "Ba", "Normal,Fault"],
      ["OperatingHours", "h", "Nh"],
      ["EA Damper", "%", "N"],
      ["RF VFD", "Hz", "N"],
      ["FD&D_4_Overcooling", "", "Ba", "Normal,Fault"],
      ["SF VFD", "Hz", "N"],
      ["RA CO2 Sp", "ppm", "Ns"]] },
    "EXHAUST_FAN_01": { id: "p:ekoHospital:r:3260bf39-c1c5ae30", floor: "LEVEL-01", type: "fan", tags: ["exhaust", "fan", "hvac"], bim: null, points: [
      ["EF_Run_Sts", "", "B", "Off,On"],
      ["ActiveLoad", "kW", "N"],
      ["EF_Trip", "", "B", "Normal,Trip"],
      ["EF_HOA", "", "B", "Hand,Auto"],
      ["EF_SS_Cmd", "", "B", "Off,On"],
      ["EF_Damper_Sts", "", "B", "Close,Open"]] },
    "EXHAUST_FAN_02": { id: "p:ekoHospital:r:3264d6e3-12143441", floor: "LEVEL-01", type: "fan", tags: ["exhaust", "fan", "hvac"], bim: null, points: [
      ["ActiveLoad", "kW", "N"],
      ["EF_Trip", "", "B", "Normal,Trip"],
      ["EF_SS_Cmd", "", "B", "OFF,ON"],
      ["EF_Damper_Sts", "", "B", "Close,Open"],
      ["EF_Run_sts", "", "B", "OFF,ON"],
      ["EF_HOA", "", "B", "Hand,Auto"]] },
    "FCU_01": { id: "p:ekoHospital:r:3260bab0-fdffa381", floor: "LEVEL-01", type: "fcu", tags: ["fcu", "hvac", "left"], bim: "2lKtHzKnXV4lhlO967Ii_y", points: [
      ["AlarmStatus", "", "B", "Normal,Trip"],
      ["Cooling_Performance_Not_Meeting_Setpoint", "", "Sa"],
      ["Filter", "", "B", "Clean,Dirty"],
      ["FD&D_3_Fan_Command/Status_Mismatch", "", "Ba", "Normal,Fault"],
      ["FD&D_1_Cooling_Performance", "", "Ba", "Normal,Fault"],
      ["ActiveLoad", "kW", "N"],
      ["ZoneHumidity", "%RH", "Nh"],
      ["FD&D_2_Sensor_Fault", "", "Ba", "Normal,Fault"],
      ["ZoneTemp", "°C", "Nh"],
      ["CoolingDemand", "%", "N"],
      ["FanSpeed", "", "S", "Auto,Low,Medium,High"],
      ["FanRunStatus", "", "B"],
      ["Fan_Command/Status_Mismatch", "", "Sa"],
      ["OperatingHours", "h", "Nh"],
      ["CoolingValve", "%", "N"],
      ["FD&D_4_Overcooling", "", "Ba", "Normal,Fault"],
      ["Zone_Temperature_Sensor_Fault", "", "Sa"],
      ["Overcooling", "", "Sa"],
      ["FanCmd", "", "B", "Stop,Start"],
      ["Occupancy", "", "B", "Empty,Occupied"],
      ["ZoneTempSp", "°C", "Ns"]] },
    "FCU_02": { id: "p:ekoHospital:r:3260bab9-4b8768f5", floor: "LEVEL-01", type: "fcu", tags: ["fcu", "hvac", "right"], bim: "1fghmEQqL1k$KXz$ssQdfF", points: [
      ["FD&D_3_Fan_Command/Status_Mismatch", "", "Ba", "Normal,Fault"],
      ["FD&D_1_Cooling_Performance", "", "Ba", "Normal,Fault"],
      ["FanCmd", "", "B", "Stop,Start"],
      ["ZoneTemp", "°C", "Nh"],
      ["CoolingDemand", "%", "N"],
      ["FanSpeed", "", "S", "Auto,Low,Medium,High"],
      ["Zone_Temperature_Sensor_Fault", "", "Sa"],
      ["ZoneTempSp", "°C", "Ns"],
      ["OperatingHours", "h", "Nh"],
      ["Cooling_Performance_Not_Meeting_Setpoint", "", "Sa"],
      ["CoolingValve", "%", "N"],
      ["Overcooling", "", "Sa"],
      ["Occupancy", "", "B", "Empty,Occupied"],
      ["FanRunStatus", "", "B"],
      ["FD&D_4_Overcooling", "", "Ba", "Normal,Fault"],
      ["ActiveLoad", "kW", "N"],
      ["AlarmStatus", "", "B", "Normal,Trip"],
      ["ZoneHumidity", "%RH", "Nh"],
      ["Fan_Command/Status_Mismatch", "", "Sa"],
      ["Filter", "", "B", "Clean,Dirty"],
      ["FD&D_2_Sensor_Fault", "", "Ba", "Normal,Fault"]] },
    "VAV_01": { id: "p:ekoHospital:r:3260bcc2-f0ad20a7", floor: "LEVEL-01", type: "vav", tags: ["farLeft", "hvac", "vav"], bim: "3ktpS_lo4ED20ohEQe2kZC", points: [
      ["ZoneTemp", "°C", "Nh"],
      ["DamperPos", "%", "N"],
      ["FD&D_1_Airflow_Performance", "", "Ba", "Normal,Fault"],
      ["ZoneHumidity", "%RH", "Nh"],
      ["Airflow_Performance", "", "Sa"],
      ["Status", "", "B"],
      ["ZoneTempSp", "°C", "Ns"],
      ["AlarmStatus", "", "B", "Normal,Trip"],
      ["Airflow", "cfm", "N"]] },
    "VAV_02": { id: "p:ekoHospital:r:3260bccb-17316b91", floor: "LEVEL-01", type: "vav", tags: ["hvac", "left", "vav"], bim: "23yaPFQ5meWrHllS192G3C", points: [
      ["FD&D_1_Airflow_Performance", "", "Ba", "Normal,Fault"],
      ["Status", "", "B"],
      ["Airflow", "cfm", "N"],
      ["AlarmStatus", "", "B", "Normal,Trip"],
      ["ZoneTemp", "°C", "Nh"],
      ["Airflow_Performance", "", "Sa"],
      ["DamperPos", "%", "N"],
      ["ZoneHumidity", "%RH", "Nh"],
      ["ZoneTempSp", "°C", "Ns"]] },
    "VAV_03": { id: "p:ekoHospital:r:3260bccb-b3f500c6", floor: "LEVEL-01", type: "vav", tags: ["center", "hvac", "vav"], bim: "1bdVDp2sfD5mmOxkY5qzYy", points: [
      ["ZoneTempSp", "°C", "Ns"],
      ["ZoneTemp", "°C", "Nh"],
      ["FD&D_1_Airflow_Performance", "", "Ba", "Normal,Fault"],
      ["ZoneHumidity", "%RH", "Nh"],
      ["Status", "", "B"],
      ["AlarmStatus", "", "B", "Normal,Trip"],
      ["DamperPos", "%", "N"],
      ["Airflow_Performance", "", "Sa"],
      ["Airflow", "cfm", "N"]] },
    "VAV_04": { id: "p:ekoHospital:r:3260bccb-5aa93061", floor: "LEVEL-01", type: "vav", tags: ["hvac", "right", "vav"], bim: "21dwPLJ5q5efIeicxg4Y6B", points: [
      ["ZoneHumidity", "%RH", "Nh"],
      ["ZoneTempSp", "°C", "Ns"],
      ["Airflow", "cfm", "N"],
      ["AlarmStatus", "", "B", "Normal,Trip"],
      ["Status", "", "B"],
      ["DamperPos", "%", "N"],
      ["ZoneTemp", "°C", "Nh"],
      ["FD&D_1_Airflow_Performance", "", "Ba", "Normal,Fault"],
      ["Airflow_Performance", "", "Sa"]] },
    "VAV_05": { id: "p:ekoHospital:r:3260bccb-f1905ca6", floor: "LEVEL-01", type: "vav", tags: ["farRight", "hvac", "vav"], bim: "1f4QuL6_FTViGnuRIPjja2", points: [
      ["FD&D_1_Airflow_Performance", "", "Ba", "Normal,Fault"],
      ["Status", "", "B"],
      ["Airflow", "cfm", "N"],
      ["AlarmStatus", "", "B", "Normal,Trip"],
      ["ZoneTemp", "°C", "Nh"],
      ["ZoneTempSp", "°C", "Ns"],
      ["ZoneHumidity", "%RH", "Nh"],
      ["DamperPos", "%", "N"],
      ["Airflow_Performance", "", "Sa"]] },
    "SMDB_02": { id: "p:ekoHospital:r:32635d99-40273b12", floor: "LEVEL-02", type: "elecPanel", tags: ["elecPanel", "smdb"], bim: null, points: [
      ["Incomer_ON_OFF_Status", "", "B", "OFF,ON"],
      ["Incomer_Trip_Status", "", "B", "NORMAL,TRIP"]] },
    "WATER_METER_02": { id: "p:ekoHospital:r:326480fb-8fe5770c", floor: "LEVEL-02", type: "meter", tags: ["firstFloor", "meter", "plumbing", "water"], bim: null, points: [
      ["HourlyWaterConsumption", "m³", "Nh"],
      ["FlowRate", "m³/h", "Nh"],
      ["WaterConsumption", "m³", "Nh"]] },
    "FAHU_02": { id: "p:ekoHospital:r:32631d10-2a645828", floor: "LEVEL-02", type: "fahu", tags: ["fahu", "hvac"], bim: "2o_HmTG50PP4EclEtJ_Di6", points: [
      ["HeatRecoveryWheelAirHumidity", "%RH", "Nh"],
      ["FD&D_5_Dehumidification_Performance", "", "Ba", "Normal,Fault"],
      ["Sensor_Fault", "", "Sa"],
      ["FreshAirDamperPos", "%", "N"],
      ["ExhaustFanCmd", "", "B", "Stop,Start"],
      ["BagFilterDirtyStatus", "", "B", "Clean,Dirty"],
      ["SupplyAirTemp", "°C", "Nh"],
      ["ExhaustFanStatus", "", "B", "Off,On"],
      ["HeatRecoveryWheelAirTemp", "°C", "Nh"],
      ["ReturnAirHumidity", "%RH", "Nh"],
      ["Heat_Recovery_Performance", "", "Sa"],
      ["SupplyFanTripStatus", "", "B", "Normal,Trip"],
      ["SupplyFanStatus", "", "B"],
      ["Cooling_Performance_Not_Meeting_Setpoint", "", "Sa"],
      ["SupplyFanSpeedCmd", "Hz", "N"],
      ["ExhaustAirDamperPos", "%", "N"],
      ["FD&D_1_Cooling_Performance", "", "Ba", "Normal,Fault"],
      ["FD&D_2_Sensor_Fault", "", "Ba", "Normal,Fault"],
      ["Dehumidification_Performance", "", "Sa"],
      ["FreshAirTemp", "°C", "Nh"],
      ["ExhaustFanSpeedCmd", "Hz", "N"],
      ["ExhaustFanTripStatus", "", "B", "Normal,Trip"],
      ["CoolingCoil", "%", "N"],
      ["FreshAirHumidity", "%RH", "Nh"],
      ["OperatingHours", "h", "Nh"],
      ["Fan_Command/Status_Mismatch", "", "Sa"],
      ["SupplyAirTempSp", "°C", "Ns"],
      ["FD&D_4_Heat_Recovery_Performance", "", "Ba", "Normal,Fault"],
      ["SupplyFanCmd", "", "B", "Stop,Start"],
      ["HeatRecoveryWheelTripStatus", "", "B", "Normal,Trip"],
      ["ReturnAirTemp", "°C", "Nh"],
      ["SupplyAirHumidity", "%RH", "Nh"],
      ["FD&D_3_Fan_Command/Status_Mismatch", "", "Ba", "Normal,Fault"],
      ["PreFilterDirtyStatus", "", "B", "Clean,Dirty"],
      ["HeatRecoveryWheelRunStatus", "", "B", "Off,On"],
      ["ReturnFilterDirtyStatus", "", "B", "Clean,Dirty"]] },
    "AHU_02": { id: "p:ekoHospital:r:3260b5eb-692b5f51", floor: "LEVEL-02", type: "ahu", tags: ["ahu", "hvac"], bim: "2hjSAudzFcu8PZ2kGCcXaC", points: [
      ["MA Temp", "°C", "Nh"],
      ["Fan_Command/Status_Mismatch", "", "Sa"],
      ["SA Fan Status", "", "B"],
      ["RA Fan Status", "", "B", "Off,On"],
      ["CoolingCoil", "%", "N"],
      ["SA Fan Cmd", "", "B", "Stop,Start"],
      ["OA Damper", "%", "N"],
      ["FD&D_2_Sensor_Fault", "", "Ba", "Normal,Fault"],
      ["PreFilter", "", "B", "Clean,Dirty"],
      ["FD&D_1_Cooling_Performance", "", "Ba", "Normal,Fault"],
      ["RA CO2 Sp", "ppm", "Ns"],
      ["SA Pressure Sp", "Pa", "Ns"],
      ["RA CO2", "ppm", "Nh"],
      ["RA Temp", "°C", "Nh"],
      ["RF VFD", "Hz", "N"],
      ["SA Humidity", "%RH", "Nh"],
      ["Cooling_Performance_Not_Meeting_Setpoint", "", "Sa"],
      ["FD&D_5_CO2_Level_High", "", "Ba", "Normal,Fault"],
      ["SA Temp", "°C", "Nh"],
      ["AlarmStatus", "", "B", "Normal,Trip"],
      ["OA Humidity", "%RH", "Nh"],
      ["SF VFD", "Hz", "N"],
      ["SA Pressure", "Pa", "Nh"],
      ["RA Fan Cmd", "", "B", "Stop,Start"],
      ["OperatingHours", "h", "Nh"],
      ["BagFilter", "", "B", "Clean,Dirty"],
      ["OA Temp", "°C", "Nh"],
      ["RA Humidity", "%RH", "Nh"],
      ["Overcooling", "", "Sa"],
      ["CO2_Level_High", "", "Sa"],
      ["EA Damper", "%", "N"],
      ["Sensor_Fault", "", "Sa"],
      ["SA Temp Sp", "°C", "Ns"],
      ["MA Damper", "%", "N"],
      ["FD&D_3_Fan_Command/Status_Mismatch", "", "Ba", "Normal,Fault"],
      ["FD&D_4_Overcooling", "", "Ba", "Normal,Fault"]] },
    "EXHAUST_FAN_03": { id: "p:ekoHospital:r:3264d6e3-c5c6d458", floor: "LEVEL-02", type: "fan", tags: ["exhaust", "fan", "hvac"], bim: null, points: [
      ["EF_HOA", "", "B", "Hand,Auto"],
      ["EF_Trip", "", "B", "Normal,Trip"],
      ["EF_Damper_Sts", "", "B", "Close,Open"],
      ["EF_Run_sts", "", "B", "OFF,ON"],
      ["EF_SS_Cmd", "", "B", "OFF,ON"]] },
    "EXHAUST_FAN_04": { id: "p:ekoHospital:r:3264d70e-62eab993", floor: "LEVEL-02", type: "fan", tags: ["exhaust", "fan", "hvac"], bim: null, points: [
      ["EF_Damper_Sts", "", "B", "Close,Open"],
      ["EF_HOA", "", "B", "Hand,Auto"],
      ["EF_Run_sts", "", "B", "OFF,ON"],
      ["EF_SS_Cmd", "", "B", "OFF,ON"],
      ["EF_Trip", "", "B", "Normal,Trip"]] },
    "FCU_03": { id: "p:ekoHospital:r:3260bad7-66788963", floor: "LEVEL-02", type: "fcu", tags: ["fcu", "hvac", "left"], bim: "2aE8gItfPHGJVv7s4eW1Jy", points: [
      ["Overcooling", "", "Sa"],
      ["FanCmd", "", "B", "Stop,Start"],
      ["ZoneHumidity", "%RH", "Nh"],
      ["FD&D_2_Sensor_Fault", "", "Ba", "Normal,Fault"],
      ["Fan_Command/Status_Mismatch", "", "Sa"],
      ["FD&D_4_Overcooling", "", "Ba", "Normal,Fault"],
      ["Filter", "", "B", "Clean,Dirty"],
      ["Zone_Temperature_Sensor_Fault", "", "Sa"],
      ["AlarmStatus", "", "B", "Normal,Trip"],
      ["FanSpeed", "", "S", "Auto,Low,Medium,High"],
      ["CoolingDemand", "%", "N"],
      ["Cooling_Performance_Not_Meeting_Setpoint", "", "Sa"],
      ["OperatingHours", "h", "Nh"],
      ["ZoneTemp", "°C", "Nh"],
      ["ZoneTempSp", "°C", "Ns"],
      ["FD&D_3_Fan_Command/Status_Mismatch", "", "Ba", "Normal,Fault"],
      ["FanRunStatus", "", "B"],
      ["FD&D_1_Cooling_Performance", "", "Ba", "Normal,Fault"],
      ["CoolingValve", "%", "N"],
      ["Occupancy", "", "Bh", "Empty,Occupied"]] },
    "FCU_04": { id: "p:ekoHospital:r:3260bade-4db1576c", floor: "LEVEL-02", type: "fcu", tags: ["fcu", "hvac", "right"], bim: "3h1E2N$3NjVA21uQvq7hrv", points: [
      ["ZoneTemp", "°C", "Nh"],
      ["FanSpeed", "", "S", "Auto,Low,Medium,High"],
      ["CoolingValve", "%", "N"],
      ["Zone_Temperature_Sensor_Fault", "", "Sa"],
      ["FD&D_2_Sensor_Fault", "", "Ba", "Normal,Fault"],
      ["Overcooling", "", "Sa"],
      ["Fan_Command/Status_Mismatch", "", "Sa"],
      ["CoolingDemand", "%", "N"],
      ["FanCmd", "", "B", "Stop,Start"],
      ["FanRunStatus", "", "B"],
      ["Occupancy", "", "B", "Empty,Occupied"],
      ["FD&D_3_Fan_Command/Status_Mismatch", "", "Ba", "Normal,Fault"],
      ["OperatingHours", "h", "Nh"],
      ["ZoneTempSp", "°C", "Ns"],
      ["FD&D_1_Cooling_Performance", "", "Ba", "Normal,Fault"],
      ["ZoneHumidity", "%RH", "Nh"],
      ["FD&D_4_Overcooling", "", "Ba", "Normal,Fault"],
      ["Cooling_Performance_Not_Meeting_Setpoint", "", "Sa"]] },
    "VAV_06": { id: "p:ekoHospital:r:3260bccb-eaf561a6", floor: "LEVEL-02", type: "vav", tags: ["farLeft", "hvac", "vav"], bim: "1elc06NuoRovwIQu1eMrtK", points: [
      ["DamperPos", "%", "N"],
      ["AlarmStatus", "", "B", "Normal,Trip"],
      ["ZoneHumidity", "%RH", "Nh"],
      ["ZoneTemp", "°C", "Nh"],
      ["Airflow_Performance", "", "Sa"],
      ["ZoneTempSp", "°C", "Ns"],
      ["FD&D_1_Airflow_Performance", "", "Ba", "Normal,Fault"],
      ["Airflow", "cfm", "N"],
      ["Status", "", "B"]] },
    "VAV_07": { id: "p:ekoHospital:r:3260bccb-e5b07606", floor: "LEVEL-02", type: "vav", tags: ["hvac", "left", "vav"], bim: "3K5$E6kNGqVKt9RN46SB4E", points: [
      ["AlarmStatus", "", "B", "Normal,Trip"],
      ["Airflow", "cfm", "N"],
      ["DamperPos", "%", "N"],
      ["Status", "", "B"],
      ["Airflow_Performance", "", "Sa"],
      ["ZoneHumidity", "%RH", "Nh"],
      ["ZoneTemp", "°C", "Nh"],
      ["FD&D_1_Airflow_Performance", "", "Ba", "Normal,Fault"],
      ["ZoneTempSp", "°C", "Ns"]] },
    "VAV_08": { id: "p:ekoHospital:r:3260bccb-35a92d36", floor: "LEVEL-02", type: "vav", tags: ["center", "hvac", "vav"], bim: "0vy9wSR9OlxZhVZQB2X$lT", points: [
      ["Status", "", "B"],
      ["DamperPos", "%", "N"],
      ["Airflow_Performance", "", "Sa"],
      ["ZoneHumidity", "%RH", "Nh"],
      ["ZoneTemp", "°C", "Nh"],
      ["ZoneTempSp", "°C", "Ns"],
      ["Airflow", "cfm", "N"],
      ["AlarmStatus", "", "B", "Normal,Trip"],
      ["FD&D_1_Airflow_Performance", "", "Ba", "Normal,Fault"]] },
    "VAV_09": { id: "p:ekoHospital:r:3260bccb-536b25af", floor: "LEVEL-02", type: "vav", tags: ["hvac", "right", "vav"], bim: "0A4kP2qXmSyRZxgQjNzubO", points: [
      ["DamperPos", "%", "N"],
      ["FD&D_1_Airflow_Performance", "", "Ba", "Normal,Fault"],
      ["Airflow", "cfm", "N"],
      ["ZoneTempSp", "°C", "Ns"],
      ["ZoneTemp", "°C", "Nh"],
      ["ZoneHumidity", "%RH", "Nh"],
      ["AlarmStatus", "", "B", "Normal,Trip"],
      ["Status", "", "B"],
      ["Airflow_Performance", "", "Sa"]] },
    "VAV_10": { id: "p:ekoHospital:r:3260bccb-a2421bd7", floor: "LEVEL-02", type: "vav", tags: ["farRight", "hvac", "vav"], bim: "3K5$E6kNGqVKt9RN46SB4E", points: [
      ["DamperPos", "%", "N"],
      ["Airflow", "cfm", "N"],
      ["ZoneHumidity", "%RH", "Nh"],
      ["AlarmStatus", "", "B", "Normal,Trip"],
      ["Airflow_Performance", "", "Sa"],
      ["FD&D_1_Airflow_Performance", "", "Ba", "Normal,Fault"],
      ["Status", "", "B"],
      ["ZoneTemp", "°C", "Nh"],
      ["ZoneTempSp", "°C", "Ns"]] },
    "SMDB_03": { id: "p:ekoHospital:r:32635d99-f2953795", floor: "LEVEL-03", type: "elecPanel", tags: ["elecPanel", "smdb"], bim: null, points: [
      ["Incomer_ON_OFF_Status", "", "B", "Off,On"],
      ["Incomer_Trip_Status", "", "B", "Normal,Trip"]] },
    "WATER_METER_03": { id: "p:ekoHospital:r:326480fb-d042dcec", floor: "LEVEL-03", type: "meter", tags: ["meter", "plumbing", "secondFloor", "water"], bim: null, points: [
      ["HourlyWaterConsumption", "m³", "Nh"],
      ["WaterConsumption", "m³", "Nh"],
      ["FlowRate", "m³/h", "Nh"]] },
    "FAHU_03": { id: "p:ekoHospital:r:32631d10-0ab7a6bb", floor: "LEVEL-03", type: "fahu", tags: ["fahu", "hvac"], bim: "10c1UNcpOtj2wssWiNxPVh", points: [
      ["SupplyFanCmd", "", "B", "Stop,Start"],
      ["PreFilterDirtyStatus", "", "B", "Clean,Dirty"],
      ["SupplyAirHumidity", "%RH", "Nh"],
      ["Heat_Recovery_Performance", "", "Sa"],
      ["SupplyFanTripStatus", "", "B", "Normal,Trip"],
      ["SupplyAirTemp", "°C", "Nh"],
      ["SupplyFanStatus", "", "B"],
      ["ReturnAirHumidity", "%RH", "Nh"],
      ["SupplyAirTempSp", "°C", "Ns"],
      ["BagFilterDirtyStatus", "", "B", "Clean,Dirty"],
      ["ExhaustAirDamperPos", "%", "N"],
      ["ReturnFilterDirtyStatus", "", "B", "Clean,Dirty"],
      ["ExhaustFanCmd", "", "B", "Stop,Start"],
      ["HeatRecoveryWheelTripStatus", "", "B", "Normal,Trip"],
      ["Fan_Command/Status_Mismatch", "", "Sa"],
      ["FreshAirHumidity", "%RH", "Nh"],
      ["HeatRecoveryWheelAirHumidity", "%RH", "Nh"],
      ["FD&D_2_Sensor_Fault", "", "Ba", "Normal,Fault"],
      ["FD&D_3_Fan_Command/Status_Mismatch", "", "Ba", "Normal,Fault"],
      ["OperatingHours", "h", "Nh"],
      ["HeatRecoveryWheelRunStatus", "", "B", "Off,On"],
      ["HeatRecoveryWheelAirTemp", "°C", "Nh"],
      ["ExhaustFanSpeedCmd", "Hz", "N"],
      ["FreshAirTemp", "°C", "Nh"],
      ["Dehumidification_Performance", "", "Sa"],
      ["ExhaustFanStatus", "", "B", "Off,On"],
      ["ExhaustFanTripStatus", "", "B", "Normal,Trip"],
      ["FD&D_4_Heat_Recovery_Performance", "", "Ba", "Normal,Fault"],
      ["FD&D_1_Cooling_Performance", "", "Ba", "Normal,Fault"],
      ["ReturnAirTemp", "°C", "Nh"],
      ["FD&D_5_Dehumidification_Performance", "", "Ba", "Normal,Fault"],
      ["Cooling_Performance_Not_Meeting_Setpoint", "", "Sa"],
      ["FreshAirDamperPos", "%", "N"],
      ["CoolingCoil", "%", "N"],
      ["SupplyFanSpeedCmd", "Hz", "N"],
      ["Sensor_Fault", "", "Sa"]] },
    "AHU_03": { id: "p:ekoHospital:r:32631956-941f3d03", floor: "LEVEL-03", type: "ahu", tags: ["ahu", "hvac"], bim: "1SBcQiIXfkLdE$oiETTGNU", points: [
      ["FD&D_1_Cooling_Performance", "", "Ba", "Normal,Fault"],
      ["EA Damper", "%", "N"],
      ["Overcooling", "", "Sa"],
      ["Cooling_Performance_Not_Meeting_Setpoint", "", "Sa"],
      ["MA Temp", "°C", "Nh"],
      ["RA Temp", "°C", "Nh"],
      ["MA Damper", "%", "N"],
      ["SF VFD", "Hz", "N"],
      ["RA Humidity", "%RH", "Nh"],
      ["SA Humidity", "%RH", "Nh"],
      ["OA Damper", "%", "N"],
      ["FD&D_3_Fan_Command/Status_Mismatch", "", "Ba", "Normal,Fault"],
      ["BagFilter", "", "B", "Clean,Dirty"],
      ["SA Pressure Sp", "Pa", "Ns"],
      ["RA CO2 Sp", "ppm", "Ns"],
      ["RA CO2", "ppm", "Nh"],
      ["Fan_Command/Status_Mismatch", "", "Sa"],
      ["FD&D_2_Sensor_Fault", "", "Ba", "Normal,Fault"],
      ["SA Pressure", "Pa", "Nh"],
      ["RF VFD", "Hz", "N"],
      ["CO2_Level_High", "", "Sa"],
      ["CoolingCoil", "%", "N"],
      ["Sensor_Fault", "", "Sa"],
      ["OA Temp", "°C", "Nh"],
      ["FD&D_5_CO2_Level_High", "", "Ba", "Normal,Fault"],
      ["RA Fan Status", "", "B", "Off,On"],
      ["FD&D_4_Overcooling", "", "Ba", "Normal,Fault"],
      ["AlarmStatus", "", "B", "Normal,Trip"],
      ["SA Temp", "°C", "Nh"],
      ["OA Humidity", "%RH", "Nh"],
      ["SA Fan Cmd", "", "B", "Stop,Start"],
      ["PreFilter", "", "B", "Clean,Dirty"],
      ["RA Fan Cmd", "", "B", "Stop,Start"],
      ["SA Temp Sp", "°C", "Ns"],
      ["OperatingHours", "h", "Nh"],
      ["SA Fan Status", "", "B"]] },
    "EXHAUST_FAN_05": { id: "p:ekoHospital:r:3264d70e-0ecfa4e5", floor: "LEVEL-03", type: "fan", tags: ["exhaust", "fan", "hvac"], bim: null, points: [
      ["EF_Run_sts", "", "B", "OFF,ON"],
      ["EF_SS_Cmd", "", "B", "OFF,ON"],
      ["EF_HOA", "", "B", "Hand,Auto"],
      ["EF_Damper_Sts", "", "B", "Close,Open"],
      ["EF_Trip", "", "B", "Normal,Trip"]] },
    "EXHAUST_FAN_06": { id: "p:ekoHospital:r:3264d70e-ea02745c", floor: "LEVEL-03", type: "fan", tags: ["exhaust", "fan", "hvac"], bim: null, points: [
      ["EF_Trip", "", "B", "Normal,Trip"],
      ["EF_HOA", "", "B", "Hand,Auto"],
      ["EF_Run_sts", "", "B", "OFF,ON"],
      ["EF_SS_Cmd", "", "B", "OFF,ON"],
      ["EF_Damper_Sts", "", "B", "Close,Open"]] },
    "FCU_05": { id: "p:ekoHospital:r:32631e63-38fdb747", floor: "LEVEL-03", type: "fcu", tags: ["fcu", "hvac", "left"], bim: "0K2lVyX9Qb__Dq_MuYvV6W", points: [
      ["CoolingValve", "%", "N"],
      ["Overcooling", "", "Sa"],
      ["Fan_Command/Status_Mismatch", "", "Sa"],
      ["Filter", "", "B", "Clean,Dirty"],
      ["FanSpeed", "", "S", "Auto,Low,Medium,High"],
      ["FD&D_1_Cooling_Performance", "", "Ba", "Normal,Fault"],
      ["Occupancy", "", "B", "Empty,Occupied"],
      ["ZoneTemp", "°C", "Nh"],
      ["FD&D_4_Overcooling", "", "Ba", "Normal,Fault"],
      ["FD&D_2_Sensor_Fault", "", "Ba", "Normal,Fault"],
      ["FD&D_3_Fan_Command/Status_Mismatch", "", "Ba", "Normal,Fault"],
      ["FanRunStatus", "", "B"],
      ["Cooling_Performance_Not_Meeting_Setpoint", "", "Sa"],
      ["ZoneTempSp", "°C", "Ns"],
      ["FanCmd", "", "B", "Stop,Start"],
      ["OperatingHours", "h", "Nh"],
      ["CoolingDemand", "%", "N"],
      ["Zone_Temperature_Sensor_Fault", "", "Sa"],
      ["AlarmStatus", "", "B", "Normal,Trip"],
      ["ZoneHumidity", "%RH", "Nh"]] },
    "FCU_06": { id: "p:ekoHospital:r:32631e63-cdcac850", floor: "LEVEL-03", type: "fcu", tags: ["fcu", "hvac", "right"], bim: "2QOOtwm7OqakFHatYQUAbk", points: [
      ["Zone_Temperature_Sensor_Fault", "", "Sa"],
      ["ZoneTempSp", "°C", "Ns"],
      ["FD&D_1_Cooling_Performance", "", "Ba", "Normal,Fault"],
      ["Overcooling", "", "Sa"],
      ["FanSpeed", "", "S", "Auto,Low,Medium,High"],
      ["CoolingDemand", "%", "N"],
      ["FanCmd", "", "B", "Stop,Start"],
      ["Occupancy", "", "Bh", "Empty,Occupied"],
      ["FD&D_3_Fan_Command/Status_Mismatch", "", "Ba", "Normal,Fault"],
      ["ZoneTemp", "°C", "Nh"],
      ["OperatingHours", "h", "Nh"],
      ["Cooling_Performance_Not_Meeting_Setpoint", "", "Sa"],
      ["FD&D_2_Sensor_Fault", "", "Ba", "Normal,Fault"],
      ["FanRunStatus", "", "B"],
      ["Fan_Command/Status_Mismatch", "", "Sa"],
      ["CoolingValve", "%", "N"],
      ["FD&D_4_Overcooling", "", "Ba", "Normal,Fault"],
      ["ZoneHumidity", "%RH", "Nh"]] },
    "COOLING_TOWER_01": { id: "p:ekoHospital:r:3264da3e-c3fe4b91", floor: "ROOF", type: "coolingTower", tags: ["coolingTower", "hvac"], bim: "2CMX9MDYT2to3Gr2HnD_3j", points: [
      ["FanTrip", "", "B", "Normal,Trip"],
      ["FanRunStatus", "", "B"],
      ["CHWLeavingTempSp", "°C", "Ns"],
      ["CHWLeavingTemp", "°C", "Nh"],
      ["FanEnableCmd", "", "B", "Disable,Enable"],
      ["OperatingHours", "h", "Nh"],
      ["FanSpeed", "%", "N"],
      ["CHWEnteringTemp", "°C", "Nh"],
      ["HOA", "", "B", "HAND,AUTO"]] },
    "CONDENSER_WATER_PUMP": { id: "p:ekoHospital:r:3264d7d8-29f8bb34", floor: "ROOF", type: "pump", tags: ["condenser", "pump", "water"], bim: "3sDXFTL1PtzTC1FEWFBG3Q", points: [
      ["Pump01Speed", "%", "N"],
      ["Pump01Cmd", "", "B", "Stop,Start"],
      ["Pump02RunStatus", "", "B"],
      ["Pump01RunStatus", "", "B"],
      ["Pump02Trip", "", "B", "NORMAL,TRIP"],
      ["Pump02Cmd", "", "B", "Stop,Start"],
      ["Pump01Trip", "", "B", "NORMAL,TRIP"],
      ["Pump02Speed", "%", "N"]] },
    "CHILLER_01": { id: "p:ekoHospital:r:3260ac07-19aa0e85", floor: "ROOF", type: "chiller", tags: ["chiller", "hvac"], bim: "3m5IrqWH1JDH7hfYYN8kjc", points: [
      ["CHWSTemp", "°C", "Nh"],
      ["Power", "kW", "Nh"],
      ["CHWSTempSp", "°C", "Ns"],
      ["RunStatus", "", "B"],
      ["AlarmStatus", "", "B", "Normal,Trip"],
      ["EnableCmd", "", "B", "Disable,Enable"],
      ["CHWRTemp", "°C", "Nh"],
      ["OperatingHours", "h", "Nh"]] },
    "CHILLED_WATER_PUMP": { id: "p:ekoHospital:r:326476ac-e28fc39e", floor: "ROOF", type: "pump", tags: ["chilled", "pump", "water"], bim: "3l7_mV0ADRc2jnKkqqisu3", points: [
      ["Pump01Cmd", "", "B"],
      ["DifferentialPressure", "kPa", "Nh"],
      ["Pump02RunStatus", "", "B"],
      ["CoolingDemand", "%", "N"],
      ["Pump02Speed", "%", "N"],
      ["Pump02Cmd", "", "B"],
      ["Pump01Trip", "", "B", "NORMAL,ALARM"],
      ["DifferentialPressureSp", "kPa", "Ns"],
      ["Pump01Speed", "%", "N"],
      ["Pump01RunStatus", "", "B"],
      ["Pump02Trip", "", "B", "NORMAL,ALARM"]] },
    /* Phase 6C: six boards the 6 Nov export does not have. The live FIN project lists them (Phase 6A diagnostic, 10 Nov): exact name, FIN id and floor below, type ELECPANEL.
       The diagnostic gave a point COUNT for each but no point names, kinds, units or tags, so none is listed here: the panel shows whatever points the live feed holds on them, and the
       type tag is checked only if the live record carries tags. */
    "MCC_02": { id: "p:ekoHospital:r:3283053f-a3ebc379", floor: "LEVEL-02", type: "elecPanel", tags: [], bim: null, points: [] },
    "DB_02": { id: "p:ekoHospital:r:32830521-9d9e9fc8", floor: "LEVEL-02", type: "elecPanel", tags: [], bim: null, points: [] },
    "MCC_03": { id: "p:ekoHospital:r:3283058e-0f03e17d", floor: "LEVEL-03", type: "elecPanel", tags: [], bim: null, points: [] },
    "DB_03": { id: "p:ekoHospital:r:3283056f-0c9ade56", floor: "LEVEL-03", type: "elecPanel", tags: [], bim: null, points: [] },
    "SMDB_04": { id: "p:ekoHospital:r:328305c6-9c9cc2b5", floor: "ROOF", type: "elecPanel", tags: [], bim: null, points: [] },
    "MCC_04": { id: "p:ekoHospital:r:328305ce-812006ab", floor: "ROOF", type: "elecPanel", tags: [], bim: null, points: [] },
    "BTU": { id: "p:ekoHospital:r:32686e8e-a7370a0d", floor: "ROOF", type: "meter", tags: ["btu", "hvac", "meter"], bim: null, points: [
      ["CoolingPower", "kW", "Nh"],
      ["CHWSupplyTemp", "°C", "Nh"],
      ["CHWFlow", "L/s", "Nh"],
      ["CHWReturnTemp", "°C", "Nh"]] },
    "BOILER_01": { id: "p:ekoHospital:r:3268757c-28285c2b", floor: "ROOF", type: "boiler", tags: ["boiler", "hvac"], bim: "3Xu8YI6zCHCzDnFZln_K5l", points: [
      ["OperatingHours", "h", "Nh"],
      ["AlarmStatus", "", "B", "Normal,Trip"],
      ["EnableCmd", "", "B", "Disabled,Enable"],
      ["RunStatus", "", "B"],
      ["Power", "kW", "Nh"],
      ["HWSTempSp", "°C", "Ns"],
      ["HWSTemp", "°C", "Nh"],
      ["HWRTemp", "°C", "Nh"]] }
  };
  /* drawn ids whose FIN name differs. Each is the only FIN equipment with that type tag on that floor in the equipment export (the tests check this); BTU_01 is pinned by FIN id (live record BTU, Phase 6A). */
  var PIN = { CHILLED_WATER_PUMP_01: 'CHILLED_WATER_PUMP', CONDENSER_WATER_PUMP_01: 'CONDENSER_WATER_PUMP', SP_01: 'SUMP_PUMP', BTU_01: 'BTU' };
  /* PROVISIONAL pins: a name the client assumed but nothing proves. None now: SMDB_01, MCC_01, DB_01 and BTU were confirmed by their FIN ids on the live server (Phase 6B).
     resolve() reports `provisional` for a key listed here, so the view can say so. */
  var PROVISIONAL = {};
  /* the FIN type tag a drawn type must carry */
  var TYPE_TAG = { CHILLER: 'chiller', CT: 'coolingTower', PUMPSET: 'pump', BTU: 'btu', BOILER: 'boiler', AHU: 'ahu', FAHU: 'fahu', FCU: 'fcu', VAV: 'vav',
    EF: 'exhaust', PMU: 'pmu', ATS: 'ats', MDB: 'mdb', SMDB: 'smdb', MCC: 'mcc', DB: 'db', CCTV: 'cctv', WM: 'water', BOOSTER: 'booster', SUMP: 'sump',
    O2: 'oxygen', MAC: 'compressor' };
  /* (the six medical devices have FIN type "other" and no tags: nothing to check, so they map by exact name and floor only) */
  /* FIN's floor for each drawn level (floorRef names in the equipment export), V2's numbering: L1 is FIN LEVEL-01, the ground floor. */
  var LEVELS = { L1: 'LEVEL-01', L2: 'LEVEL-02', L3: 'LEVEL-03', RF: 'ROOF' };
  /* V1's level keys (GF, L1, L2, RF) to V2's. Use only on a value known to be V1's: its L1 and L2 are V2's L2 and L3, so a bare key cannot be told apart.
     No V1 level key is stored anywhere (the twin keeps only fly-to and labels per session); the twin's setLevel takes 'GF', which has one meaning. */
  var LEGACY_LEVELS = { GF: 'L1', L1: 'L2', L2: 'L3', RF: 'RF' };
  /* named only by the history export, with energy points and nothing else: no FIN id, type or floor to confirm them, and the Studio backend leaves
     equipment named ENERGY / USAGE / CALC out of the feed (main.py _flatten_equip). Shown as candidates, never mapped. */
  var NAME_ONLY = { GF_ENERGY: 'GF_ENERGY', '1F_ENERGY': '1F_ENERGY', '2F_ENERGY': '2F_ENERGY', RF_ENERGY: 'RF_ENERGY' };

  function fold(s) { return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, ''); }
  function bareId(s) { return String(s == null ? '' : s).trim().replace(/^@/, ''); }
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  /* the FIN name a drawn machine is mapped to, or null */
  function finName(e) {
    if (!e || e.nonFin) return null;
    var n = has(PIN, e.id) ? PIN[e.id] : e.id;
    return has(REF, n) ? n : null;
  }
  /* the expected points of a FIN equipment as { name, unit, kind, his, alarm, sp, enum } */
  function refPoints(fin) {
    return ((REF[fin] || {}).points || []).map(function (p) {
      var f = p[2] || '';
      return { name: p[0], unit: p[1] || '', kind: f[0] === 'B' ? 'Bool' : f[0] === 'N' ? 'Number' : f[0] === 'S' ? 'Str' : null,
        his: f.indexOf('h') > 0, alarm: f.indexOf('a') > 0, sp: f.indexOf('s') > 0, enumText: p[3] || null };
    });
  }
  /* A BIM id from the feed, or null: an IFC GUID is 22 characters of 0-9 A-Z a-z _ $. Zinc's escaped \$ is read as $. The backend's fallback (the FIN id
     or the name, when FIN has no bimId) is not a BIM id. */
  function bimOf(asset) {
    var b = asset && asset.bimId != null ? String(asset.bimId).trim().replace(/\\\$/g, '$') : '';
    return /^[0-9A-Za-z_$]{22}$/.test(b) && fold(b) !== fold(asset.id) ? b : null;
  }
  /* the feed by folded navName; every asset is kept, so a duplicate is seen. Also which BIM ids more than one asset carries. */
  function index(assets) {
    var by = {}, bims = {};
    (Array.isArray(assets) ? assets : []).forEach(function (a) {
      var k = a && fold(a.id); if (!k) return;
      (by[k] = by[k] || []).push(a);
      var b = bimOf(a); if (b) bims[b] = (bims[b] || 0) + 1;
    });
    Object.defineProperty(by, '_bims', { value: bims, enumerable: false });
    return by;
  }
  /* A drawn machine against the live feed.
     state: not-fin · unmapped · offline · missing · ambiguous · stale · mapped.
     reason: name-only · no-evidence · not-in-feed · duplicate · id-differs · type-differs. Nothing is read that the feed does not hold. */
  function resolve(e, idx, connected) {
    var fin = finName(e), ref = fin ? REF[fin] : null;
    var out = { id: e.id, level: e.level, fin: fin, finId: ref ? ref.id : null, refFloor: ref ? ref.floor : null, expected: fin ? refPoints(fin) : [],
      pinned: has(PIN, e.id), provisional: has(PROVISIONAL, e.id) && PROVISIONAL[e.id] === PIN[e.id], candidate: null, asset: null, floor: null, floorDiffers: false, bimId: null, bimShared: false, type: null, state: null, reason: null };
    if (e.nonFin) { out.state = 'not-fin'; return out; }
    if (!fin) { out.state = 'unmapped'; out.reason = has(NAME_ONLY, e.id) ? 'name-only' : 'no-evidence'; out.candidate = NAME_ONLY[e.id] || null; return out; }
    if (connected === false) { out.state = 'offline'; return out; }
    var hits = (idx || {})[fold(fin)] || [];
    if (!hits.length) { out.state = 'missing'; out.reason = 'not-in-feed'; return out; }
    if (hits.length > 1) { out.state = 'ambiguous'; out.reason = 'duplicate'; return out; }
    var a = hits[0], liveId = bareId(a.finId), tags = Array.isArray(a.tags) ? a.tags : [];
    if (liveId && liveId !== bareId(ref.id)) { out.state = 'ambiguous'; out.reason = 'id-differs'; return out; }
    if (tags.length && TYPE_TAG[e.type] && tags.indexOf(TYPE_TAG[e.type]) === -1) { out.state = 'ambiguous'; out.reason = 'type-differs'; return out; }
    out.asset = a;
    out.finId = liveId || ref.id;
    out.type = a.typeEn || a.type || ref.type;
    out.floor = a.floor && !/^unknown( floor)?$/i.test(String(a.floor)) ? String(a.floor) : null;
    out.floorDiffers = !!(out.floor && LEVELS[e.level] && out.floor !== LEVELS[e.level]);
    out.bimId = bimOf(a);
    out.bimShared = !!(out.bimId && idx && idx._bims && idx._bims[out.bimId] > 1);
    out.state = a.st === 'stale' ? 'stale' : 'mapped';
    return out;
  }

  /* ── a point's reading ── */
  var NO_VALUE = /^(|—|--|n\/a|null|nan|undefined)$/i;
  function statusWord(p) {
    var s = p && p.status;
    if (s && typeof s === 'object') s = s.val || s.dis;
    return s == null ? '' : String(s).trim().toLowerCase();
  }
  /* One FIN point as the feed gives it: { name, state, type, value, text, unit, status, his, alarm, sp, enumText, id }.
     state: live · missing · not-reporting · stale · unavailable · offline. type: bool · number · text.
     A boolean comes from the point's own `bool` field only, never from how its text reads. FIN's declared pointKind decides a number, before the
     backend's display kind (which calls "800ppm" a Str). */
  function readPoint(p, ctx) {
    ctx = ctx || {};
    var out = { name: p ? p.navName : ctx.name, state: 'missing', type: null, value: null, text: null, unit: (p && p.unit) || ctx.unit || '',
      status: statusWord(p) || null, his: p ? p.his === true : !!ctx.his, alarm: p ? p.alarmPoint === true : !!ctx.alarm, sp: p ? p.sp === true : !!ctx.sp,
      enumText: (p && typeof p.enum === 'string' && p.enum) || ctx.enumText || null, id: (p && p.id) || null };
    if (ctx.connected === false) { out.state = 'offline'; return out; }
    if (!p) return out;
    if (ctx.stale) { out.state = 'stale'; return out; }
    var raw = p.currentValue == null ? '' : String(p.currentValue).trim();
    if (p.reporting === false || NO_VALUE.test(raw)) { out.state = 'not-reporting'; return out; }
    if (out.status && out.status !== 'ok') { out.state = out.status === 'stale' ? 'stale' : 'unavailable'; return out; }
    out.state = 'live';
    if (typeof p.bool === 'boolean') {
      out.type = 'bool'; out.value = p.bool;
      var t = p.text == null ? '' : String(p.text).trim();
      out.text = t && !/^(true|false)$/i.test(t) ? t : null;   /* FIN's enum word (NORMAL, FAULT...) when it has one; else the caller says On / Off */
      return out;
    }
    var kind = p.pointKind || p.kind;
    var m = raw.replace(/,/g, '').match(/^(-?\d+(?:\.\d+)?)\s*(.*)$/);
    if (kind === 'Number' || (m && kind !== 'Str')) {
      if (!m) { out.state = 'unavailable'; return out; }
      out.type = 'number'; out.value = parseFloat(m[1]); out.text = m[1];
      if (!out.unit && m[2]) out.unit = m[2];
      return out;
    }
    out.type = 'text'; out.text = p.text != null && String(p.text).trim() ? String(p.text).trim() : raw; out.value = out.text;
    return out;
  }
  /* The rows the details panel lists: the equipment export's points first (each read, or missing), then any other point the feed has on it */
  function pointRows(r, connected) {
    var a = r.asset, pts = (a && Array.isArray(a.points) ? a.points : []).filter(function (p) { return p && p.navName; });
    var by = {}, used = {}, stale = r.state === 'stale';
    pts.forEach(function (p) { var k = fold(p.navName); if (!has(by, k)) by[k] = p; });
    var rows = (r.expected || []).map(function (x) {
      var k = fold(x.name); used[k] = 1;
      return readPoint(by[k] || null, { name: x.name, unit: x.unit, his: x.his, alarm: x.alarm, sp: x.sp, enumText: x.enumText, connected: connected, stale: stale });
    });
    pts.forEach(function (p) { var k = fold(p.navName); if (!used[k]) { used[k] = 1; rows.push(readPoint(p, { connected: connected, stale: stale })); } });
    return rows;
  }

  /* ── what the mapping itself says of a drawn machine, before any live data (evidence: the 6 Nov export, never the live server) ──
     mapping: confirmed (its exact FIN name, or a pin the export proves) · provisional (PROVISIONAL) · unmapped · not-fin.
     noPoints: mapped, but FIN lists no point on it. bim: 'unverified' (FIN gives an IFC GlobalId; no Eko Hospital model has been checked) · 'none'. */
  function mapStatus(e) {
    var fin = finName(e), ref = fin ? REF[fin] : null;
    return { id: e.id, level: e.level, fin: fin, finId: ref ? ref.id : null, floor: ref ? ref.floor : null,
      floorDiffers: !!(ref && LEVELS[e.level] && ref.floor !== LEVELS[e.level]),
      mapping: e.nonFin ? 'not-fin' : !ref ? 'unmapped' : PROVISIONAL[e.id] === fin ? 'provisional' : 'confirmed',
      points: ref ? ref.points.length : 0, noPoints: !!ref && !ref.points.length, bim: ref && ref.bim ? 'unverified' : 'none' };
  }

  /* ── another FIN equipment's readings shown on a drawn machine's panel, always labelled with their source ──
     The MDB has no points in FIN; its electrical readings are PMU_Main's. PMU_Main stays its own FIN equipment (resolved here like any other, never mapped
     to the MDB), and each row carries source: 'PMU_Main'. When PMU_Main is not in the feed, every row says unavailable. */
  var BORROW = { MDB: { from: 'PMU_Main', type: 'PMU', level: 'L1', points: ['Voltage', 'Frequency', 'Current', 'ActivePower', 'TotalEnergy', 'DEWA_SupplyLost'] } };
  function borrowedRows(id, idx, connected, stale) {
    var b = has(BORROW, id) ? BORROW[id] : null; if (!b) return [];
    var src = resolve({ id: b.from, type: b.type, level: b.level }, idx, connected);
    if (stale && src.state === 'mapped') src.state = 'stale';
    var ok = src.state === 'mapped' || src.state === 'stale';
    return pointRows(ok ? src : { expected: src.expected, asset: null, state: src.state }, connected)
      .filter(function (r) { return b.points.indexOf(r.name) >= 0; })
      .sort(function (x, y) { return b.points.indexOf(x.name) - b.points.indexOf(y.name); })
      .map(function (r) { r.source = b.from; if (r.state === 'missing') r.state = 'unavailable'; return r; });
  }

  /* ── alarms ── */
  /* The FIN alarm point an alarm is on: the longest alarm-point name its state ends with ("ahu_valSim_FD&D_4_Overcooling" -> FD&D_4_Overcooling, not the
     shorter Overcooling text point). null when none fits. */
  function alarmPointOf(state, points) {
    var s = String(state == null ? '' : state), best = null;
    (points || []).forEach(function (p) {
      var n = p && (p.navName || p.name), isAlarm = p && (p.alarmPoint === true || p.alarm === true);
      if (!n || !isAlarm || s.length < n.length || s.slice(-n.length) !== n) return;
      if (s.length > n.length && s.charAt(s.length - n.length - 1) !== '_') return;
      if (!best || n.length > best.length) best = n;
    });
    return best;
  }
  /* the open alarms on a mapped machine: matched by FIN equipment id only (never by name). alarms: the dashboard's (data-map mapAlarm: sourceId, state,
     plainEn, sev). Cleared records (an alarm's hist) are never counted. */
  /* An open FIN alarm as the dashboard holds it: the backend sends open alarms only; a record whose own message is "Return to normal" is a cleared one
     and never active. Its earlier records (hist) are cleared too: only counted, never shown as active. */
  function isActive(a) { return !!(a && !/^return to normal$/i.test(String(a.plainEn || '').trim())); }
  function alarmsFor(r, alarms) {
    var id = bareId(r && r.finId);
    if (!id || !r.asset) return [];
    return (Array.isArray(alarms) ? alarms : []).filter(function (a) { return isActive(a) && bareId(a.sourceId) === id; }).map(function (a) {
      return { id: a.id, message: a.plainEn || '', detail: a.techEn || '', sev: a.sev || null, finSeverity: a.finSeverity || null,
        priority: typeof a.priority === 'number' ? a.priority : null, sourceId: bareId(a.sourceId), ack: a.ack || null,
        cleared: (a.hist || []).filter(function (h) { return h && h.open !== true; }).length, point: alarmPointOf(a.state, r.asset.points),
        at: typeof a.raisedAt === 'number' ? a.raisedAt : null,
        /* the alarm's earlier records that returned to normal, as sent: never active, shown as recently cleared */
        clearedRecs: (a.hist || []).filter(function (h) { return h && h.open !== true; }).map(function (h) {
          return { id: h.id || null, message: h.msg || '', detail: h.tech || '', at: typeof h.at === 'number' ? h.at : null, point: alarmPointOf(h.state, r.asset.points) };
        }) };
    });
  }
  /* Every open FIN alarm against the drawn machines: { by: { drawnId: [alarm] }, unlinked: [alarm] } (unlinked: on FIN equipment the twin does not draw) */
  function alarmIndex(res, alarms) {
    var by = {}, used = {};
    Object.keys(res || {}).forEach(function (id) {
      var list = alarmsFor(res[id], alarms);
      if (list.length) { by[id] = list; list.forEach(function (a) { used[a.id] = 1; }); }
    });
    var unlinked = (Array.isArray(alarms) ? alarms : []).filter(function (a) { return isActive(a) && !used[a.id]; })
      .map(function (a) { return { id: a.id, message: a.plainEn || '', source: a.locEn || a.asset || '', sourceId: bareId(a.sourceId) || null, finSeverity: a.finSeverity || null, priority: typeof a.priority === 'number' ? a.priority : null }; });
    return { by: by, unlinked: unlinked };
  }

  /* ── FDD: the equipment's FD&D_n_<Rule> points ── */
  var FDD = /^FD&D_\d+_/i;
  var HEALTHY = /^(normal|ok|clear|cleared|none|false|no fault)$/i;
  /* One row per FD&D point the equipment export lists (and any other the feed has): { name, status: fault · normal · unavailable, reading, message,
     messageFrom: alarm · point · null, alarm }. The message is FIN's own: the open alarm's detail on that point, else the text alarm point named exactly as
     the rule (FD&D_4_Overcooling -> Overcooling), else none. A point FIN lists but the feed lacks is unavailable. */
  function fddRows(r, alarms, connected) {
    if (!r || !r.fin) return [];
    var rows = pointRows(r, connected), byName = {};
    rows.forEach(function (x) { byName[x.name] = x; });
    var mine = alarmsFor(r, alarms);
    return rows.filter(function (x) { return FDD.test(x.name || ''); }).map(function (x) {
      var fault = x.state === 'live' && x.type === 'bool' && x.value === true && !HEALTHY.test(x.text || '');
      var al = mine.filter(function (a) { return a.point === x.name; })[0] || null;
      var partner = byName[String(x.name).replace(FDD, '')];
      var msg = al && al.detail ? al.detail : partner && partner.state === 'live' && partner.type === 'text' ? partner.text : null;
      return { name: x.name, status: x.state !== 'live' ? 'unavailable' : fault ? 'fault' : 'normal', reading: x, message: msg,
        messageFrom: al && al.detail ? 'alarm' : msg ? 'point' : null, alarm: al ? al.id : null };
    });
  }

  /* ── equipment relationships: the client's reference relationships (V2 design, EKO_Live_Twin_Schematic_Version2.html), generated by rules on the drawn machines and
     kept apart from the pipe geometry. They are reference relationships, not engineering-verified. ──
     kind: stop (the receiver stops or loses its function) · shift (its values change). prop: the effect keeps spreading (every stop; some shifts). */
  function buildLinks(EQUIP) {
    var L = [], EQ = {};
    EQUIP.forEach(function (e) { EQ[e.id] = e; });
    function LK(from, to, kind, what, prop) { L.push({ from: from, to: to, kind: kind, what: what, prop: prop == null ? kind === 'stop' : !!prop }); }
    var ATS = 'AUTOMATIC_TRANSFER_SWITCH_01', by = function (f) { return EQUIP.filter(f); };
    var BOARD = { ATS: 1, MDB: 1, SMDB: 1, MCC: 1, DB: 1 };
    /* power: DEWA and the generator reach the ATS, the ATS feeds the MDB, the MDB the SMDBs, each SMDB its MCC and DB (the DB only where one is drawn), and every
       board the equipment it powers (its `feed`). Each powered item also reports its load back to its board. */
    LK('DEWA_SUPPLY', 'MDB', 'shift', 'Mains voltage and frequency', true);
    LK('MDB', ATS, 'shift', 'Voltage, frequency \u2192 transfer to the generator', true);
    LK('GENERATOR', ATS, 'shift', 'Emergency supply');
    LK(ATS, 'MDB', 'stop', 'Supply to the main board (PowerAvailable)');
    by(function (e) { return e.feed && e.feed !== ATS; }).forEach(function (e) {
      var bt = EQ[e.feed] && EQ[e.feed].type;
      LK(e.feed, e.id, 'stop', bt === 'MDB' ? 'PowerAvailable \u2192 floor board' : bt === 'SMDB' ? 'PowerAvailable \u2192 board' : 'Power');
      LK(e.id, e.feed, 'shift', BOARD[e.type] ? 'Loads (kW) \u2192 board meters' : 'ActiveLoad (kW)');
    });
    LK(ATS, 'MDB', 'shift', 'On generator \u2192 building meters read 0');
    LK('CHILLER_01', 'CHILLED_WATER_PUMP_01', 'stop', 'EnableCmd, AlarmStatus');
    LK('CHILLER_01', 'CONDENSER_WATER_PUMP_01', 'stop', 'EnableCmd, AlarmStatus');
    LK('CHILLED_WATER_PUMP_01', 'CHILLER_01', 'stop', 'Flow proof, cooling demand');
    LK('CONDENSER_WATER_PUMP_01', 'CHILLER_01', 'stop', 'Flow proof');
    LK('CONDENSER_WATER_PUMP_01', 'COOLING_TOWER_01', 'stop', 'Condenser flow \u2192 fan enable');
    LK('CHILLER_01', 'COOLING_TOWER_01', 'shift', 'Heat to reject');
    LK('COOLING_TOWER_01', 'CHILLER_01', 'shift', 'Condenser water temperature \u2192 head pressure', true);
    LK('CHILLER_01', 'BTU_01', 'shift', 'Supply / return temperatures', true);
    LK('CHILLED_WATER_PUMP_01', 'BTU_01', 'shift', 'Pump speed \u2192 flow', true);
    LK('WEATHER', 'COOLING_TOWER_01', 'shift', 'Wet bulb');
    by(function (e) { return e.type === 'AHU' || e.type === 'FAHU' || e.type === 'FCU'; }).forEach(function (e) {
      LK('CHILLER_01', e.id, 'shift', 'Chilled water available', true);
      LK('CHILLED_WATER_PUMP_01', e.id, 'shift', 'Chilled water flow', true);
      LK(e.id, 'CHILLED_WATER_PUMP_01', 'shift', 'Coil demand');
    });
    by(function (e) { return e.type === 'FAHU'; }).forEach(function (e) { LK('WEATHER', e.id, 'shift', 'Outdoor air'); });
    by(function (e) { return e.type === 'AHU'; }).forEach(function (e) {
      LK(e.id.replace('AHU', 'FAHU'), e.id, 'shift', 'Pre-treated fresh air (OA Temp / Humidity)', true);
      (e.vavs || []).forEach(function (v) { LK(e.id, v, 'stop', 'Supply air, fan status'); });
    });
    by(function (e) { return e.type === 'EF'; }).forEach(function (e) { LK(e.fahu, e.id, 'stop', 'Supply fan status (Auto)'); });
    by(function (e) { return e.type === 'FCU'; }).forEach(function (e) { LK(e.fahu, e.id, 'shift', 'Fresh air to the room', true); LK(e.id, e.fahu, 'shift', 'Return air to the heat wheel');
      LK(e.id, e.feed, 'shift', 'Occupancy \u2192 lighting and small power');
    });
    by(function (e) { return e.type === 'WM'; }).forEach(function (w) {
      (w.fcus || []).forEach(function (f) { LK(f, w.id, 'shift', 'Occupancy \u2192 water use'); });
      LK(w.id, 'BOILER_01', 'shift', 'Hot water demand');
      LK(w.id, 'BOOSTER_PUMP', 'shift', 'Water demand');
      LK(w.id, 'SUMP_PUMP', 'shift', 'Drainage inflow');
      LK('BOOSTER_PUMP', w.id, 'shift', 'Riser pressure \u2192 floor flow', true);
    });
    by(function (e) { return e.type === 'FCU'; }).forEach(function (e) {
      LK(e.id, 'OXYGEN_PLANT_01', 'shift', 'Occupancy \u2192 oxygen demand');
      LK(e.id, 'MEDICAL_AIR_COMPRESSOR_01', 'shift', 'Occupancy \u2192 air demand');
    });
    /* One edge per from > to pair, nothing lost. An exact repeat (same wording) is dropped. A second relationship between the same two machines is kept on the
       edge as `also` ({ kind, what, prop }); where one is a stop and the other a shift, the stop is the edge (a physical dependency) and the shift is its note. */
    var out = [], at = {};
    L.filter(function (l) { return EQ[l.from] && EQ[l.to]; }).forEach(function (l) {
      var k = l.from + '>' + l.to, e = at[k];
      if (!e) { e = at[k] = { from: l.from, to: l.to, kind: l.kind, what: l.what, prop: l.prop, also: [] }; out.push(e); return; }
      if (e.what === l.what && e.kind === l.kind) return;
      if (l.kind === 'stop' && e.kind !== 'stop') {
        e.also.push({ kind: e.kind, what: e.what, prop: e.prop }); e.kind = l.kind; e.what = l.what; e.prop = l.prop;
      } else if (!e.also.some(function (x) { return x.kind === l.kind && x.what === l.what; })) e.also.push({ kind: l.kind, what: l.what, prop: l.prop });
    });
    return out;
  }
  /* The graph over the drawn machines. downstream(id): what id stopping reaches, as the reference's downstream(): { id: { state: fail · warn, step, via,
     weak } } (fail = would stop; warn = values would change; weak = only through a measurement, the effect stops there). upstream(id): every machine whose
     downstream() reaches id, with how. direct(id): the links into and out of id. */
  function graph(EQUIP) {
    var links = buildLinks(EQUIP), cache = {};
    function downstream(seed) {
      if (cache[seed]) return cache[seed];
      var res = {}, q = [seed];
      res[seed] = { state: 'fail', step: 0, via: null, weak: false };
      while (q.length) {
        var cur = q.shift(), here = res[cur];
        links.forEach(function (l) {
          if (l.from !== cur) return;
          var prev = res[l.to];
          if (l.kind === 'stop' && here.state === 'fail') {
            if (prev && prev.state === 'fail') return;
            res[l.to] = { state: 'fail', step: here.step + 1, via: l, weak: false }; q.push(l.to);
          } else if (!prev) {
            res[l.to] = { state: 'warn', step: here.step + 1, via: l, weak: !l.prop };
            if (l.prop) q.push(l.to);
          }
        });
      }
      cache[seed] = res;
      return res;
    }
    function upstream(id) {
      var out = {};
      EQUIP.forEach(function (e) { if (e.id === id) return; var d = downstream(e.id)[id]; if (d) out[e.id] = { state: d.state, step: d.step, weak: d.weak }; });
      return out;
    }
    function direct(id) { return { up: links.filter(function (l) { return l.to === id; }), down: links.filter(function (l) { return l.from === id; }) }; }
    return { links: links, downstream: downstream, upstream: upstream, direct: direct };
  }

  /* Root-cause and impact evidence for one drawn machine, in four kinds that are never mixed:
       alarms     - CONFIRMED: open FIN alarms on it (by FIN id) and FD&D points in fault;
       upstream   - REFERENCE relationships: every machine upstream of it (the reference schematic's links, not verified engineering);
       possible   - POSSIBLE upstream causes: upstream machines that themselves have an open FIN alarm or an FD&D fault. Not a proven cause;
       impacts    - POTENTIAL downstream impact: what it reaches downstream. Nothing here says any of it has happened. */
  function evidence(g, id, res, alarmIdx, faultsBy) {
    var faults = faultsBy || {}, al = (alarmIdx && alarmIdx.by) || {};
    var up = g.upstream(id), down = g.downstream(id);
    var upList = Object.keys(up).map(function (k) { return { id: k, state: up[k].state, weak: up[k].weak, step: up[k].step, alarms: al[k] || [], faults: faults[k] || [], mapState: res && res[k] ? res[k].state : null }; })
      .sort(function (a, b) { return a.step - b.step || (a.id < b.id ? -1 : 1); });
    return {
      alarms: al[id] || [], faults: faults[id] || [],
      upstream: upList,
      possible: upList.filter(function (u) { return u.alarms.length || u.faults.length; }),
      impacts: Object.keys(down).filter(function (k) { return k !== id; }).map(function (k) { return { id: k, state: down[k].state, weak: down[k].weak, step: down[k].step, mapState: res && res[k] ? res[k].state : null }; })
        .sort(function (a, b) { return a.step - b.step || (a.id < b.id ? -1 : 1); })
    };
  }

  /* The FIN floors each drawn level's mapped equipment report: { GF: { floors: { 'LEVEL-01': 22 }, conflict, fin }, ... }.
     conflict: a level's equipment report a floor other than its FIN floor. */
  function floorCheck(resolved) {
    var out = {};
    Object.keys(LEVELS).forEach(function (lv) { out[lv] = { floors: {}, conflict: false, fin: LEVELS[lv] }; });
    (resolved || []).forEach(function (r) {
      if (!r || !out[r.level] || !r.floor) return;
      out[r.level].floors[r.floor] = (out[r.level].floors[r.floor] || 0) + 1;
    });
    Object.keys(out).forEach(function (lv) { out[lv].conflict = Object.keys(out[lv].floors).some(function (f) { return f !== out[lv].fin; }); });
    return out;
  }

  /* ── BIM: one IFC GlobalId per drawn machine, or why there is none ──
     Sources: the FIN equipment's own bimId (bimOf: a 22-character IFC GUID, never the FIN id or name the backend falls back to) and the Studio project's
     equipment links (EKO_HOST_ENGINE.listMapped(): [{ id: FIN name, bimId: GlobalId }]). Nothing else, and no guess.
     state: verified (source fin · link · both) · missing · shared (another equipment has the same GlobalId) · conflict (the sources disagree) ·
            unconfirmed (no FIN equipment confirmed in the feed) · not-fin.
     Returns { by: { drawnId: { state, guid, source, fin, link, with } }, guid: { GlobalId: drawnId } } (guid: verified ones only). */
  var GUID = /^[0-9A-Za-z_$]{22}$/;
  function bimLinks(res, idx, links) {
    var owners = {}, linked = {};
    function own(g, name) { var k = fold(name); if (!k) return; (owners[g] = owners[g] || {})[k] = name; }
    Object.keys(idx || {}).forEach(function (k) { idx[k].forEach(function (a) { var g = bimOf(a); if (g) own(g, a.id); }); });
    (Array.isArray(links) ? links : []).forEach(function (l) {
      var g = l && l.bimId != null ? String(l.bimId).trim() : '', k = l && fold(l.id);
      if (!k || !GUID.test(g)) return;
      own(g, l.id);
      (linked[k] = linked[k] || []).indexOf(g) === -1 && linked[k].push(g);
    });
    var by = {}, guid = {};
    Object.keys(res || {}).forEach(function (id) {
      var r = res[id], out = { state: null, guid: null, source: null, fin: null, link: null, with: [] };
      by[id] = out;
      if (r.state === 'not-fin') { out.state = 'not-fin'; return; }
      if (!r.asset || (r.state !== 'mapped' && r.state !== 'stale')) { out.state = 'unconfirmed'; return; }
      var me = fold(r.fin), ls = linked[me] || [];
      out.fin = r.bimId || null;
      out.link = ls.length === 1 ? ls[0] : null;
      var cands = [];
      [out.fin].concat(ls).forEach(function (g) { if (g && cands.indexOf(g) === -1) cands.push(g); });
      if (!cands.length) { out.state = 'missing'; return; }
      if (cands.length > 1) { out.state = 'conflict'; out.with = cands; return; }
      var g = cands[0], others = Object.keys(owners[g] || {}).filter(function (k) { return k !== me; });
      out.guid = g;
      if (others.length) { out.state = 'shared'; out.with = others.map(function (k) { return owners[g][k]; }).sort(); return; }
      out.state = 'verified';
      out.source = out.fin && out.link ? 'both' : out.fin ? 'fin' : 'link';
      guid[g] = id;
    });
    return { by: by, guid: guid };
  }
  /* The model storey for a FIN floor: only one whose name is the FIN floor's own name (folded), and only when exactly one is. Else null. */
  function modelLevel(finFloor, levels) {
    var k = fold(finFloor);
    var hits = k ? (Array.isArray(levels) ? levels : []).filter(function (l) { return l && fold(l.name) === k; }) : [];
    return hits.length === 1 ? hits[0] : null;
  }

  /* ── equipment the backend leaves out of its list (its ENERGY / USAGE / CALC name rule), held apart in E.data.finExcluded ──
     A drawn energy meter whose exact history name is there exactly once: an UNVERIFIED candidate. It is not mapped: nothing here proves the record is
     that meter, so it is never counted, and no alarm or FDD is put on it. { state: none · one · several, asset } */
  function candidateFor(e, excluded) {
    var name = NAME_ONLY[e.id];
    if (!name) return { state: 'none', asset: null };
    var hits = (Array.isArray(excluded) ? excluded : []).filter(function (a) { return a && fold(a.id) === fold(name); });
    return { state: hits.length === 1 ? 'one' : hits.length ? 'several' : 'none', asset: hits.length === 1 ? hits[0] : null };
  }

  /* The feed is stale when the backend's last equipment read is older than maxMs (it keeps the old list when FIN stops answering).
     shortcut: a fixed age, not the backend's own polling interval (30 s in config.json); pass that interval times a few when it reaches the page. */
  var STALE_MS = 5 * 60 * 1000;
  function feedStale(at, now, maxMs) {
    var t = at ? Date.parse(at) : NaN;
    return isFinite(t) && (now - t) > (maxMs || STALE_MS);
  }

  /* ── live flow evidence for a drawn pipe, duct or cable ──
     measure: live meters on that network ([drawnId, point]); run: the equipment's own run status points. A run status never stands for measured flow.
     Chilled-water coil branches have neither (no meter or valve reading on the branch). */
  var RUNPTS = { PUMPSET: ['Pump01RunStatus', 'Pump02RunStatus'], BOOSTER: ['Pump01RunStatus', 'Pump02RunStatus'], SUMP: ['Pump01RunStatus', 'Pump02RunStatus'],
    BOILER: ['RunStatus'], CHILLER: ['RunStatus'], AHU: ['SA Fan Status'], FAHU: ['SupplyFanStatus'], EF: ['EF_Run_Sts'], CT: ['FanRunStatus'], FCU: ['FanRunStatus'],
    VAV: ['Status'], O2: ['RunStatus'], MAC: ['RunStatus'], ATS: ['NormalSupplySts', 'EmergencySupplySts'], SMDB: ['Incomer_ON_OFF_Status'] };
  function flowRule(p, EQ) {
    var t = EQ[p.src] && EQ[p.src].type, M = [], R = [];
    var run = function (id) { (RUNPTS[EQ[id] && EQ[id].type] || []).forEach(function (n) { R.push([id, n]); }); };
    if (p.sys === 'chws' || p.sys === 'chwr') { if (t === 'PUMPSET') { M.push(['BTU_01', 'CHWFlow']); run(p.src); } }
    else if (t === 'WM') M.push([p.src, 'FlowRate']);
    else if (t === 'VAV') M.push([p.src, 'Airflow']);
    else if (t === 'O2' || t === 'MAC') M.push([p.src, 'Flow']);
    else if (p.src === 'DEWA_SUPPLY' || t === 'PMU') M.push(['PMU_Main', 'ActivePower']);
    else if (p.src === 'GENERATOR') R.push(['AUTOMATIC_TRANSFER_SWITCH_01', 'EmergencySupplySts']);
    else run(p.src);
    return { measure: M, run: R };
  }
  /* a point of a confirmed (mapped, not stale) machine, read live; else null */
  function liveReading(r, name) {
    if (!r || !r.asset || r.state !== 'mapped') return null;
    var pts = r.asset.points || [], k = fold(name);
    for (var i = 0; i < pts.length; i++) if (pts[i] && fold(pts[i].navName) === k) { var x = readPoint(pts[i], { connected: true }); return x.state === 'live' ? x : null; }
    return null;
  }
  /* measured: a live meter reads above 0 · running: only a run status is on · stopped: the meter reads 0, or every run status is off · unknown: nothing live */
  function flowState(rule, res, connected) {
    if (connected === false || !rule) return 'unknown';
    var m = rule.measure.map(function (q) { return liveReading(res[q[0]], q[1]); }).filter(function (x) { return x && x.type === 'number'; });
    if (m.length) return m.some(function (x) { return x.value > 0; }) ? 'measured' : 'stopped';
    var rr = rule.run.map(function (q) { return liveReading(res[q[0]], q[1]); }).filter(function (x) { return x && x.type === 'bool'; });
    if (!rr.length) return 'unknown';
    return rr.some(function (x) { return x.value; }) ? 'running' : rr.length === rule.run.length ? 'stopped' : 'unknown';
  }
  /* a machine's own run status: on · off · null (none live) */
  function runState(id, type, res, connected) {
    if (connected === false) return null;
    var rr = (RUNPTS[type] || []).map(function (n) { return liveReading(res[id], n); }).filter(function (x) { return x && x.type === 'bool'; });
    return rr.length ? (rr.some(function (x) { return x.value; }) ? 'on' : 'off') : null;
  }

  return { REF: REF, PIN: PIN, PROVISIONAL: PROVISIONAL, TYPE_TAG: TYPE_TAG, LEVELS: LEVELS, LEGACY_LEVELS: LEGACY_LEVELS, NAME_ONLY: NAME_ONLY,
    BORROW: BORROW, mapStatus: mapStatus, borrowedRows: borrowedRows, fold: fold, finName: finName, refPoints: refPoints, bimOf: bimOf,
    index: index, resolve: resolve, readPoint: readPoint, pointRows: pointRows, alarmPointOf: alarmPointOf, alarmsFor: alarmsFor, alarmIndex: alarmIndex,
    isActive: isActive, fddRows: fddRows, buildLinks: buildLinks, graph: graph, evidence: evidence, floorCheck: floorCheck,
    bimLinks: bimLinks, modelLevel: modelLevel, candidateFor: candidateFor, feedStale: feedStale, STALE_MS: STALE_MS,
    RUNPTS: RUNPTS, flowRule: flowRule, flowState: flowState, runState: runState, liveReading: liveReading };
});
