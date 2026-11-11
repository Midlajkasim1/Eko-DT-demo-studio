/* The Eko Hospital Live Twin (Phase 1): a 2.5D cutaway of the hospital, roof plant and three floors, drawn in SVG after the client's EKO_Live_Twin.html.
   Opened from Systems > Live Twin in the dashboard's content area (#mount), only for a project whose Hospital graphics are on
   (INJECTED_PROJECT_CONFIG.hospitalHvac; app.js hides the entry elsewhere).

   NOTHING HERE IS SIMULATED and nothing here talks to FIN: the reference's simulation, fault injection, FD&D rules and its own FIN client are left out.
   The one data source is the dashboard's own live equipment feed (E.data.assets). Which FIN equipment each drawn machine is, and how its points are read,
   is hospital-twin-map.js (Phase 2): the details panel shows the mapping state, FIN floor and ids, and each point as FIN reports it. No machine is drawn
   running, no pipe flows and no alarm is raised.

   POSITIONS ARE ILLUSTRATIVE. Coordinates are the reference file's schematic layout (world units ~ metres, x = length 0..60, y = depth 0..16, z = height,
   floors spread apart so each stays visible). They are not surveyed positions. Drawn ids are the reference's names; the FIN name of each is the map's. */
(function (root, factory) {
  var api = factory(root && root.EKO_TWIN_MAP);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.document) {
    /* the Hospital's drawing, like its mapping, exists only for a project whose Hospital graphics are on; another project's load withdraws it */
    if ((root.INJECTED_PROJECT_CONFIG || {}).hospitalHvac === true) root.EKO_TWIN = api;
    else try { delete root.EKO_TWIN; } catch (e) { root.EKO_TWIN = undefined; }
  }
})(typeof window !== 'undefined' ? window : null, function (MAP) {
  'use strict';

  /* ── the building model (pure data, as in the reference) ── */
  var LZ = { RF: 66, L3: 44, L2: 22, L1: 0, EXT: 0 };
  var LEVELS = ['RF', 'L3', 'L2', 'L1'];
  /* equipment sizes [w (x), d (y), h (z)] by drawing type (client design V2) */
  var SIZE = {
    CHILLER: [10, 4.2, 4.2], CT: [7, 6, 6.2], PUMPSET: [6, 3, 2.4], BTU: [2.4, 1.4, 2.2], BOILER: [3.2, 3.2, 5.4],
    AHU: [9, 3.6, 3.6], FAHU: [9, 3.6, 3.6], FCU: [2.6, 2.6, 1.1], VAV: [1.8, 1.4, 0.9], EF: [2.2, 2.2, 2],
    ATS: [3, 1.4, 3.6], MDB: [3.4, 1.2, 3.6], SMDB: [2.6, 1, 3.2], MCC: [2.6, 1.2, 3.4], DB: [1.4, 0.6, 2.0], WM: [1.6, 1, 1.3],
    BOOSTER: [6, 4, 3.4], SUMP: [4, 4, 1.4], O2: [5, 3, 5.4], MAC: [5, 2.8, 3.4], DEWA: [4, 3, 3.4], GEN: [6, 3, 3.2], WX: [1, 1, 4],
    CCTV: [0.8, 0.8, 0.6], DIALYSIS: [1.0, 0.9, 1.6], STRETCHER: [2.2, 0.9, 0.95], LASER: [1.3, 1.0, 1.5], FRIDGE: [1.1, 0.9, 2.0],
    ULTRASOUND: [1.0, 0.9, 1.5], SCALE: [1.2, 1.2, 1.4]
  };
  var EQUIP = [];
  function E(id, type, level, x, y, o) {
    o = o || {};
    var s = SIZE[type], e = { id: id, type: type, level: level, x: x, y: y, z: LZ[level] + (o.dz || 0), w: s[0], d: s[1], h: s[2], label: id };
    for (var k in o) e[k] = o[k];
    EQUIP.push(e);
  }
  function p2(n) { return (n < 10 ? '0' : '') + n; }
  /* the 72 items of the client's V2 design. Ids are the drawn ids the mapping resolves (hospital-twin-map.js); feed is the board that powers the item, as in V2. */
  E('DEWA_SUPPLY', 'DEWA', 'EXT', -11, 7.5, { label: 'DEWA supply', nonFin: true });
  E('GENERATOR', 'GEN', 'EXT', -12, 12.4, { label: 'Standby generator', nonFin: true });
  /* electrical rooms: one row along the back-left of every floor. There is no DB on the roof, and no DB_04. */
  E('AUTOMATIC_TRANSFER_SWITCH_01', 'ATS', 'L1', 0.2, 12.2, { label: 'ATS 01' });
  E('MDB', 'MDB', 'L1', 3.8, 12.4, { label: 'MDB', feed: 'AUTOMATIC_TRANSFER_SWITCH_01', tagLift: 2.4 });
  var ROOM = { L1: { smdb: 7.8, mcc: 11.0, db: 14.0 }, L2: { smdb: 3.6, mcc: 7.0, db: 10.4 }, L3: { smdb: 3.6, mcc: 7.0, db: 10.4 }, RF: { smdb: 53.0, mcc: 56.0 } };
  var FLOORPLAN = [
    { lv: 'L1', n: 1, fcu: [1, 2], ef: [1, 2], vav: [1, 2, 3, 4, 5], cctv: [1, 2, 3] },
    { lv: 'L2', n: 2, fcu: [3, 4], ef: [3, 4], vav: [6, 7, 8, 9, 10], cctv: [4, 5, 6] },
    { lv: 'L3', n: 3, fcu: [5, 6], ef: [5, 6], vav: [], cctv: [7, 8, 9] }
  ];
  var SMDB_OF = { L1: 'SMDB_01', L2: 'SMDB_02', L3: 'SMDB_03', RF: 'SMDB_04' };
  var MCC_OF = { L1: 'MCC_01', L2: 'MCC_02', L3: 'MCC_03', RF: 'MCC_04' };
  var DB_OF = { L1: 'DB_01', L2: 'DB_02', L3: 'DB_03' };
  ['L1', 'L2', 'L3', 'RF'].forEach(function (lv) {
    var r = ROOM[lv], sm = SMDB_OF[lv];
    E(sm, 'SMDB', lv, r.smdb, 12.6, { label: sm.replace('_', ' '), feed: 'MDB' });
    E(MCC_OF[lv], 'MCC', lv, r.mcc, 12.4, { label: MCC_OF[lv].replace('_', ' '), feed: sm, tagLift: 2.4 });
    if (DB_OF[lv]) E(DB_OF[lv], 'DB', lv, r.db, 12.9, { label: DB_OF[lv].replace('_', ' '), feed: sm, dz: 0.6 });
  });
  /* level 1 plant */
  E('BOOSTER_PUMP', 'BOOSTER', 'L1', 1.2, 1.6, { label: 'Booster pump', feed: 'MCC_01' });
  E('SUMP_PUMP', 'SUMP', 'L1', 8.4, 2.0, { label: 'Sump pump', feed: 'MCC_01' });
  E('OXYGEN_PLANT_01', 'O2', 'L1', 15.8, 10.4, { label: 'Oxygen plant 01', feed: 'MCC_01' });
  E('MEDICAL_AIR_COMPRESSOR_01', 'MAC', 'L1', 21.0, 11.0, { label: 'Medical air 01', feed: 'MCC_01' });
  /* air side, water meters and cameras on every floor */
  FLOORPLAN.forEach(function (f) {
    var n = p2(f.n), mcc = MCC_OF[f.lv], db = DB_OF[f.lv];
    E('WATER_METER_' + n, 'WM', f.lv, 12.8, 8.9, { label: 'Water meter ' + n, dz: 1.0, feed: mcc, fcus: f.fcu.map(function (k) { return 'FCU_' + p2(k); }) });
    E('FAHU_' + n, 'FAHU', f.lv, 26.6, 11.6, { label: 'FAHU ' + n, feed: mcc });
    E('AHU_' + n, 'AHU', f.lv, 38.0, 11.6, { label: 'AHU ' + n, feed: mcc, vavs: f.vav.map(function (k) { return 'VAV_' + p2(k); }) });
    E('EXHAUST_FAN_' + p2(f.ef[0]), 'EF', f.lv, 48.6, 13.2, { label: 'Exhaust fan ' + p2(f.ef[0]), feed: db, fahu: 'FAHU_' + n });
    E('EXHAUST_FAN_' + p2(f.ef[1]), 'EF', f.lv, 56.4, 13.2, { label: 'Exhaust fan ' + p2(f.ef[1]), feed: db, fahu: 'FAHU_' + n });
    E('FCU_' + p2(f.fcu[0]), 'FCU', f.lv, 19.2, 3.0, { label: 'FCU ' + p2(f.fcu[0]), dz: 3.3, feed: db, fahu: 'FAHU_' + n });
    E('FCU_' + p2(f.fcu[1]), 'FCU', f.lv, 54.6, 3.0, { label: 'FCU ' + p2(f.fcu[1]), dz: 3.3, feed: db, fahu: 'FAHU_' + n });
    f.vav.forEach(function (k, i) { E('VAV_' + p2(k), 'VAV', f.lv, 27.6 + i * 5, 3.2, { label: 'VAV ' + p2(k), dz: 3.4, feed: db }); });
    [0.2, 24.6, 59.0].forEach(function (x, i) { E('CCTV_' + p2(f.cctv[i]), 'CCTV', f.lv, x, 0.2, { label: 'CCTV ' + p2(f.cctv[i]), dz: 4.1, feed: db }); });
  });
  /* medical devices on the floor DB, in the patient rooms */
  E('Dialysis Machine', 'DIALYSIS', 'L1', 16.0, 1.0, { label: 'Dialysis Machine', feed: 'DB_01' });
  E('Stretcher', 'STRETCHER', 'L1', 51.8, 1.2, { label: 'Stretcher', feed: 'DB_01' });
  E('Laser System', 'LASER', 'L2', 16.0, 1.0, { label: 'Laser System', feed: 'DB_02' });
  E('Refrigerator with Freezer', 'FRIDGE', 'L2', 23.4, 1.0, { label: 'Refrigerator with Freezer', feed: 'DB_02' });
  E('Ultrasound', 'ULTRASOUND', 'L2', 52.2, 1.0, { label: 'Ultrasound', feed: 'DB_02' });
  E('Scale Clinical Bariatric', 'SCALE', 'L3', 16.4, 1.2, { label: 'Scale Clinical Bariatric', feed: 'DB_03' });
  /* roof plant */
  E('COOLING_TOWER_01', 'CT', 'RF', 1.6, 8.6, { label: 'Cooling tower 01', feed: 'MCC_04' });
  E('CONDENSER_WATER_PUMP_01', 'PUMPSET', 'RF', 12.2, 2.4, { label: 'CW pumps 01', feed: 'MCC_04' });
  E('CHILLER_01', 'CHILLER', 'RF', 21.0, 9.2, { label: 'Chiller 01', feed: 'MCC_04' });
  E('CHILLED_WATER_PUMP_01', 'PUMPSET', 'RF', 34.0, 2.4, { label: 'CHW pumps 01', feed: 'MCC_04' });
  E('BTU_01', 'BTU', 'RF', 43.4, 11.9, { label: 'BTU meter 01', feed: 'MCC_04' });
  E('BOILER_01', 'BOILER', 'RF', 46.6, 9.8, { label: 'Boiler 01', feed: 'MCC_04' });
  E('WEATHER', 'WX', 'RF', 58.0, 2.0, { label: 'Outdoor air', nonFin: true });
  /* floor patches under the ceiling units, as the reference's zones (x, y, width, depth). Each shows the room temperature its unit reports; nothing is estimated. */
  var ZONES = [];
  EQUIP.forEach(function (e) {
    if (e.type === 'FCU') ZONES.push({ level: e.level, rect: e.x < 30 ? [15, 0, 11, 8] : [51, 0, 9, 8], src: e.id, pt: 'ZoneTemp', sp: 'ZoneTempSp' });
    else if (e.type === 'VAV') ZONES.push({ level: e.level, rect: [e.x - 1.6, 0, 5, 8], src: e.id, pt: 'ZoneTemp', sp: 'ZoneTempSp' });
  });
  ZONES.push({ level: 'L3', rect: [26, 0, 25, 8], src: 'AHU_03', pt: 'RA Temp', sp: null });
  var EQ = {};
  EQUIP.forEach(function (e) { EQ[e.id] = e; });
  /* the small items whose name tag shows only when zoomed in (or selected) */
  var MINOR = { VAV: 1, FCU: 1, EF: 1, WM: 1, SMDB: 1, MCC: 1, DB: 1, BTU: 1, ATS: 1, WX: 1, CCTV: 1, DIALYSIS: 1, STRETCHER: 1, LASER: 1, FRIDGE: 1, ULTRASOUND: 1, SCALE: 1 };

  /* pipes, ducts and cables: drawn still (no flow is claimed here), coloured by system: air green/cyan, water blue/orange, power yellow, medical gas pink/magenta */
  var SYSTEMS = {
    chws: ['#2f6bff', 'chw'], chwr: ['#8fc2ff', 'chw'], cws: ['#12a7c9', 'cw'], cwr: ['#ffb347', 'cw'],
    hw: ['#ff6a3d', 'water'], dcw: ['#4aa8ff', 'water'], drn: ['#c98b3a', 'water'],
    sa: ['#2de0b0', 'air'], fa: ['#8be26f', 'air'], ea: ['#7aa890', 'air'],
    pwr: ['#ffd23f', 'power'], gen: ['#ffb800', 'power'], o2: ['#ff5ccf', 'gas'], ma: ['#f4a6ff', 'gas']
  };
  var LAYERS = ['chw', 'cw', 'air', 'water', 'power', 'gas'];
  var PIPES = [];
  function PI(id, sys, src, pts, kind) { PIPES.push({ id: id, sys: sys, src: src, pts: pts, kind: kind || (sys === 'sa' || sys === 'fa' || sys === 'ea' ? 'duct' : 'pipe') }); }
  var RZ = LZ.RF;
  PI('cws_ct_cwp', 'cws', 'CONDENSER_WATER_PUMP_01', [[8.6, 10.4, RZ + 0.8], [11, 10.4, RZ + 0.8], [11, 3.9, RZ + 0.8], [12.2, 3.9, RZ + 0.8]]);
  PI('cws_cwp_ch', 'cws', 'CONDENSER_WATER_PUMP_01', [[18.2, 3.9, RZ + 0.8], [19.6, 3.9, RZ + 0.8], [19.6, 10.3, RZ + 0.8], [21, 10.3, RZ + 1.0]]);
  PI('cwr_ch_ct', 'cwr', 'CONDENSER_WATER_PUMP_01', [[22, 13.4, RZ + 3.4], [22, 14.6, RZ + 5.4], [5.1, 14.6, RZ + 5.4], [5.1, 12.6, RZ + 5.4], [5.1, 12.6, RZ + 6.4]]);
  PI('chwr_riser_chwp', 'chwr', 'CHILLED_WATER_PUMP_01', [[50.2, 15.2, RZ + 0.9], [50.2, 6.6, RZ + 0.9], [40.6, 6.6, RZ + 0.9], [40.6, 3.9, RZ + 0.9], [40, 3.9, RZ + 0.9]]);
  PI('chwr_chwp_ch', 'chwr', 'CHILLED_WATER_PUMP_01', [[34, 3.9, RZ + 0.9], [32.4, 3.9, RZ + 0.9], [32.4, 10.6, RZ + 0.9], [31, 10.6, RZ + 1.0]]);
  PI('chws_ch_btu', 'chws', 'CHILLED_WATER_PUMP_01', [[31, 12.4, RZ + 2.6], [33, 12.4, RZ + 2.6], [33, 12.6, RZ + 1.2], [43.4, 12.6, RZ + 1.2]]);
  PI('chws_btu_riser', 'chws', 'CHILLED_WATER_PUMP_01', [[45.8, 12.6, RZ + 1.2], [51, 12.6, RZ + 1.2], [51, 15.2, RZ + 1.2]]);
  PI('hw_boiler_riser', 'hw', 'BOILER_01', [[49.8, 11.4, RZ + 1.4], [52, 11.4, RZ + 1.4], [52, 15.2, RZ + 1.4]]);
  /* risers (one segment per floor gap is cut from these when the scene is drawn) */
  var RISERS = [
    { sys: 'chws', src: 'CHILLED_WATER_PUMP_01', x: 51.0, y: 15.2, top: RZ + 1.2, bottom: 4.6, down: true }, { sys: 'chwr', src: 'CHILLED_WATER_PUMP_01', x: 50.2, y: 15.2, top: RZ + 0.9, bottom: 4.9 },
    { sys: 'hw', src: 'BOILER_01', x: 52.0, y: 15.2, top: RZ + 1.4, bottom: 4.2, down: true }, { sys: 'dcw', src: 'BOOSTER_PUMP', x: 13.6, y: 10.6, top: LZ.L3 + 1.8, bottom: 1.6 },
    { sys: 'o2', src: 'OXYGEN_PLANT_01', x: 24.4, y: 15.2, top: LZ.L3 + 3.2, bottom: 3.2 }, { sys: 'ma', src: 'MEDICAL_AIR_COMPRESSOR_01', x: 25.1, y: 15.2, top: LZ.L3 + 3.6, bottom: 3.6 },
    { sys: 'pwr', src: 'MDB', x: 5.6, y: 15.5, top: RZ + 3.6, bottom: 3.9, kind: 'cable' }
  ];
  FLOORPLAN.forEach(function (f) {
    var z = LZ[f.lv], n = p2(f.n);
    PI('chws_hdr_' + f.lv, 'chws', 'CHILLED_WATER_PUMP_01', [[51, 15.2, z + 4.6], [20.4, 15.2, z + 4.6]]);
    PI('chwr_hdr_' + f.lv, 'chwr', 'CHILLED_WATER_PUMP_01', [[21.2, 15.0, z + 4.9], [50.2, 15.0, z + 4.9]]);
    PI('chws_hdr2_' + f.lv, 'chws', 'CHILLED_WATER_PUMP_01', [[51, 15.2, z + 4.6], [56.2, 15.2, z + 4.6], [56.2, 5.4, z + 4.6], [56.2, 4.6, z + 4.4]]);
    PI('chws_fahu_' + f.lv, 'chws', 'FAHU_' + n, [[31.2, 15.2, z + 4.6], [31.2, 14.6, z + 3.6]]);
    PI('chws_ahu_' + f.lv, 'chws', 'AHU_' + n, [[42.6, 15.2, z + 4.6], [42.6, 14.6, z + 3.6]]);
    PI('chws_fcuL_' + f.lv, 'chws', 'FCU_' + p2(f.fcu[0]), [[20.4, 15.2, z + 4.6], [20.4, 5.6, z + 4.6], [20.4, 4.4, z + 4.4]]);
    PI('chwr_fcuL_' + f.lv, 'chwr', 'FCU_' + p2(f.fcu[0]), [[21.2, 4.6, z + 4.5], [21.2, 15.0, z + 4.9]]);
    PI('fa_in_' + f.lv, 'fa', 'FAHU_' + n, [[31.0, 17.4, z + 2.0], [31.0, 15.2, z + 2.0]]);
    PI('fa_ahu_' + f.lv, 'fa', 'FAHU_' + n, [[35.6, 13.4, z + 2.0], [38.0, 13.4, z + 2.0]]);
    PI('fa_fcuL_' + f.lv, 'fa', 'FAHU_' + n, [[28.2, 11.6, z + 3.0], [28.2, 9.4, z + 4.2], [22.6, 9.4, z + 4.2], [22.6, 5.8, z + 4.2]]);
    PI('fa_fcuR_' + f.lv, 'fa', 'FAHU_' + n, [[29.6, 11.6, z + 3.0], [29.6, 9.8, z + 4.3], [57.6, 9.8, z + 4.3], [57.6, 5.8, z + 4.3]]);
    f.ef.forEach(function (k, i) { var x = i ? 57.5 : 49.7; PI('ea_' + p2(k), 'ea', 'EXHAUST_FAN_' + p2(k), [[x, 15.4, z + 1.0], [x, 17.6, z + 1.0]]); });
    if (f.vav.length) {
      PI('sa_main_' + f.lv, 'sa', 'AHU_' + n, [[42.6, 11.6, z + 2.4], [42.6, 8.0, z + 3.9], [28.4, 8.0, z + 3.9]]);
      PI('sa_main2_' + f.lv, 'sa', 'AHU_' + n, [[42.6, 8.0, z + 3.9], [48.6, 8.0, z + 3.9]]);
      f.vav.forEach(function (k, i) { PI('sa_vav_' + p2(k), 'sa', 'VAV_' + p2(k), [[28.5 + i * 5, 8.0, z + 3.9], [28.5 + i * 5, 4.6, z + 3.9]]); });
    } else {
      PI('sa_main_' + f.lv, 'sa', 'AHU_' + n, [[42.6, 11.6, z + 2.4], [42.6, 7.0, z + 3.9], [28.0, 7.0, z + 3.9]]);
      PI('sa_main2_' + f.lv, 'sa', 'AHU_' + n, [[42.6, 7.0, z + 3.9], [49.4, 7.0, z + 3.9]]);
    }
    PI('dcw_' + f.lv, 'dcw', 'WATER_METER_' + n, [[13.6, 10.6, z + 1.6], [13.6, 9.4, z + 1.6], [26, 9.4, z + 1.6]]);
    PI('hw_' + f.lv, 'hw', 'BOILER_01', [[52, 15.2, z + 4.2], [52, 13.0, z + 4.2], [59, 13.0, z + 4.2]]);
    PI('o2_' + f.lv, 'o2', 'OXYGEN_PLANT_01', [[24.4, 15.2, z + 3.2], [24.4, 6.4, z + 3.2], [16.4, 6.4, z + 3.2]]);
    PI('ma_' + f.lv, 'ma', 'MEDICAL_AIR_COMPRESSOR_01', [[25.1, 15.2, z + 3.6], [25.1, 6.9, z + 3.6], [16.4, 6.9, z + 3.6]]);
  });
  /* power: riser, SMDB, then the MCC (floor bus) and the DB (ceiling bus) */
  ['L1', 'L2', 'L3', 'RF'].forEach(function (lv) {
    var z = LZ[lv], r = ROOM[lv], sm = SMDB_OF[lv], mcc = MCC_OF[lv], db = DB_OF[lv], sx = r.smdb, mx = r.mcc;
    if (lv === 'RF') PI('pwr_riser_RF', 'pwr', 'MDB', [[5.6, 15.5, z + 3.6], [5.6, 15.5, z + 4.2], [sx + 1.3, 15.5, z + 4.2], [sx + 1.3, 13.1, z + 4.2], [sx + 1.3, 13.1, z + 3.2]], 'cable');
    else if (lv !== 'L1') PI('pwr_riser_' + lv, 'pwr', 'MDB', [[5.6, 15.5, z + 3.6], [5.6, 13.1, z + 3.6], [5.6, 13.1, z + 3.2]], 'cable');
    PI('pwr_' + sm + '_' + mcc, 'pwr', sm, [[sx + 1.6, 13.1, z + 3.2], [sx + 1.6, 13.1, z + 3.9], [mx + 1.3, 13.0, z + 3.9], [mx + 1.3, 13.0, z + 3.4]], 'cable');
    if (db) {
      var dx = r.db;
      PI('pwr_' + sm + '_' + db, 'pwr', sm, [[sx + 2.2, 13.4, z + 3.2], [sx + 2.2, 14.4, z + 4.1], [dx + 0.7, 14.4, z + 4.1], [dx + 0.7, 13.2, z + 2.6]], 'cable');
      PI('pwr_bus_' + db, 'pwr', db, [[dx + 1.1, 13.5, z + 2.4], [dx + 1.1, 15.8, z + 4.4], [59.4, 15.8, z + 4.4]], 'cable');
    }
    if (lv === 'RF') PI('pwr_bus_' + mcc, 'pwr', mcc, [[mx + 1.3, 13.6, z + 0.3], [mx + 1.3, 15.8, z + 0.3], [1.0, 15.8, z + 0.3]], 'cable');
    else PI('pwr_bus_' + mcc, 'pwr', mcc, [[mx + 1.3, 13.6, z + 0.3], [mx + 1.3, 15.7, z + 0.3], [47.0, 15.7, z + 0.3]], 'cable');
  });
  /* level 1: the incoming supplies, ATS and MDB */
  PI('pwr_dewa_ats', 'pwr', 'DEWA_SUPPLY', [[-7, 9.0, 0.6], [1.0, 9.0, 0.6], [1.0, 12.2, 0.6]], 'cable');
  PI('gen_ats', 'gen', 'GENERATOR', [[-6, 14.6, 0.6], [2.6, 14.6, 0.6], [2.6, 13.6, 0.6]], 'cable');
  PI('pwr_ats_mdb', 'pwr', 'AUTOMATIC_TRANSFER_SWITCH_01', [[1.7, 12.9, 3.6], [1.7, 12.9, 4.2], [4.6, 13.0, 4.2], [4.6, 13.0, 3.6]], 'cable');
  PI('pwr_mdb_smdb1', 'pwr', 'MDB', [[6.6, 13.0, 3.6], [6.6, 13.0, 4.1], [9.1, 13.1, 4.1], [9.1, 13.1, 3.2]], 'cable');
  PI('pwr_mdb_riser', 'pwr', 'MDB', [[5.6, 13.6, 3.6], [5.6, 15.5, 3.9]], 'cable');
  PI('pwr_mcc1_plumbing', 'pwr', 'MCC_01', [[12.3, 12.4, 0.25], [12.3, 7.2, 0.25], [4.2, 7.2, 0.25], [4.2, 5.6, 0.25]], 'cable');
  PI('pwr_mcc1_sump', 'pwr', 'MCC_01', [[10.4, 7.2, 0.25], [10.4, 6.0, 0.25]], 'cable');
  /* what each cable from the MDB, an MCC or a DB reaches, from the drawing's own feed relationships: those boards have no status point in FIN, so the
     cable's evidence is at its other end (MAP.flowRule): the receiving SMDB's incomer, or the run status of the machines the board feeds */
  (function () {
    var pipe = function (id) { return PIPES.filter(function (p) { return p.id === id; })[0]; };
    var fedBy = function (b) { return EQUIP.filter(function (e) { return e.feed === b; }).map(function (e) { return e.id; }); };
    pipe('pwr_mdb_smdb1').to = [SMDB_OF.L1];
    pipe('pwr_mdb_riser').to = [SMDB_OF.L2, SMDB_OF.L3, SMDB_OF.RF];
    ['L2', 'L3', 'RF'].forEach(function (lv) { pipe('pwr_riser_' + lv).to = [SMDB_OF[lv]]; });
    ['L1', 'L2', 'L3', 'RF'].forEach(function (lv) { pipe('pwr_bus_' + MCC_OF[lv]).to = fedBy(MCC_OF[lv]); if (DB_OF[lv]) pipe('pwr_bus_' + DB_OF[lv]).to = fedBy(DB_OF[lv]); });
    pipe('pwr_mcc1_plumbing').to = ['BOOSTER_PUMP'];
    pipe('pwr_mcc1_sump').to = ['SUMP_PUMP'];
  })();
  PI('dcw_booster', 'dcw', 'BOOSTER_PUMP', [[7.2, 3.4, 1.6], [13.6, 3.4, 1.6], [13.6, 10.6, 1.6]]);
  PI('drn_floor', 'drn', 'SUMP_PUMP', [[14.6, 8.2, 0.3], [11.4, 8.2, 0.3], [11.4, 6.0, 0.3]]);
  PI('drn_out', 'drn', 'SUMP_PUMP', [[10.4, 2.0, 1.2], [10.4, -1.8, 1.2]]);
  PI('o2_l1', 'o2', 'OXYGEN_PLANT_01', [[20.8, 11.8, 3.2], [24.4, 11.8, 3.2], [24.4, 15.2, 3.2]]);
  PI('ma_l1', 'ma', 'MEDICAL_AIR_COMPRESSOR_01', [[26.0, 12.4, 3.6], [25.1, 12.4, 3.6], [25.1, 15.2, 3.6]]);

  /* ── projection: x runs right/down, y runs into the building, z up ── */
  var K = 10, AX0 = { x: [0.97, 0.16], y: [0.58, -0.46] }, AX = { x: AX0.x.slice(), y: AX0.y.slice() }, VIEW = { yaw: 0, tilt: 1, zs: 1, gap: 0 };
  /* the view turns within the front-right quadrant only, so the faces that are drawn stay the faces that are seen (client design V2) */
  var YAW_MIN = -40, YAW_MAX = 15, TILT_MIN = 0.6, TILT_MAX = 1.55;
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  /* turn the world about the vertical axis (yaw, degrees) and tilt it (a scale on the floor axes' vertical part). setView(0, 1) is the original view, exactly. */
  function setView(yaw, tilt) {
    VIEW.yaw = clamp(yaw, YAW_MIN, YAW_MAX); VIEW.tilt = clamp(tilt, TILT_MIN, TILT_MAX);
    var a = VIEW.yaw * Math.PI / 180, c = Math.cos(a), sn = Math.sin(a), ex = AX0.x, ey = AX0.y;
    AX.x = [c * ex[0] + sn * ey[0], (c * ex[1] + sn * ey[1]) * VIEW.tilt];
    AX.y = [-sn * ex[0] + c * ey[0], (-sn * ex[1] + c * ey[1]) * VIEW.tilt];
    VIEW.zs = VIEW.tilt > 1 ? 1 - 0.32 * (VIEW.tilt - 1) : 1;
    /* a turned floor takes more screen height: open the gap between floors so they never overlap */
    var ext = function (v) { return 60 * Math.abs(v.x[1]) + 16 * Math.abs(v.y[1]); };
    VIEW.gap = Math.max(0, ext(AX) - ext(AX0)) / VIEW.zs * 1.1;
  }
  /* floors are 22 m apart; the extra gap is added in the empty air between a floor's services and the slab above */
  function zmap(z) {
    if (!VIEW.gap) return z;
    var i = Math.max(0, Math.min(3, Math.floor((z + 0.7) / 22))), zin = z - 22 * i;
    return z + VIEW.gap * (i + (i < 3 ? Math.max(0, Math.min(1, (zin - 8) / 13.3)) : 0));
  }
  function P(x, y, z) { return [(x * AX.x[0] + y * AX.y[0]) * K, (x * AX.x[1] + y * AX.y[1] - zmap(z) * VIEW.zs) * K]; }
  function fmt(v) { return v.toFixed(1); }
  /* the whole drawing's bounds, from the site's corners: needs no layout, so the camera can frame it before the view is on screen */
  function worldBounds() {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    [-20, 66].forEach(function (x) { [-6, 23].forEach(function (y) { [-0.7, LZ.RF + 8].forEach(function (z) {
      var p = P(x, y, z); x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]);
    }); }); });
    return { x: x0 - 90, y: y0, w: x1 - x0 + 90, h: y1 - y0 };   /* 90: room for the level names on the left */
  }
  /* where on screen a level sits, to zoom onto it */
  function levelBounds(lv) {
    var z = LZ[lv], xs = [], ys = [];
    [[-1, -1, z - 1], [61, -1, z], [-1, 17, z + 6], [61, 17, z + 6]].forEach(function (q) { var p = P(q[0], q[1], q[2]); xs.push(p[0]); ys.push(p[1]); });
    var x0 = Math.min.apply(null, xs), y0 = Math.min.apply(null, ys);
    return { x: x0 - 120, y: y0 - 40, w: Math.max.apply(null, xs) - x0 + 140, h: Math.max.apply(null, ys) - y0 + 60 };
  }
  /* a box onto the given aspect (height / width), padded */
  function fit(b, aspect, pad) {
    pad = pad == null ? 10 : pad;
    var w = b.w + pad * 2, h = b.h + pad * 2;
    if (h / w > aspect) w = h / aspect; else h = w * aspect;
    return { x: b.x + b.w / 2 - w / 2, y: b.y + b.h / 2 - h / 2, w: w, h: h };
  }

  /* ── FIN feed: every drawn machine resolved through the map (hospital-twin-map.js) ── */
  function resolveAll(assets, connected, stale) {
    var idx = MAP.index(assets), out = {};
    EQUIP.forEach(function (e) { var r = MAP.resolve(e, idx, connected); if (stale && r.state === 'mapped') r.state = 'stale'; out[e.id] = r; });
    Object.defineProperty(out, '_idx', { value: idx, enumerable: false });
    /* PMU_Main is FIN equipment the design does not draw (its readings show on the MDB panel and drive the mains cable): resolved for those reads only,
       kept out of the drawn list so it is never counted, listed or given an alarm as a drawn machine */
    var pmu = MAP.resolve({ id: 'PMU_Main', type: 'PMU', level: 'L1' }, idx, connected); if (stale && pmu.state === 'mapped') pmu.state = 'stale';
    Object.defineProperty(out, 'PMU_Main', { value: pmu, enumerable: false });
    return out;
  }
  /* the Studio's BIM bridge, read only through its existing methods (DashboardOverlay.tsx); absent outside the Studio */
  function host3d() { return typeof window !== 'undefined' && window.EKO_HOST_ENGINE ? window.EKO_HOST_ENGINE : null; }
  function call3d(name) { var h = host3d(); try { return h && typeof h[name] === 'function' ? h[name].apply(h, [].slice.call(arguments, 1)) : undefined; } catch (e) { return undefined; } }
  /* the rotors of one machine, found once per drawing */
  function rotorsOf(s, id) { return s.rot[id] || (s.rot[id] = [].slice.call(s.eqs[id].querySelectorAll('.rotor'))); }
  function feedStale(E) { return MAP.feedStale(E && E.data && E.data.equipmentAt, Date.now()); }
  /* everything the panel and the BIM link read, for the dashboard's current data */
  function current(E) {
    var connected = isConnected(), stale = connected && feedStale(E), res = resolveAll(E && E.data && E.data.assets, connected, stale);
    return { connected: connected, stale: stale, res: res, bim: MAP.bimLinks(res, res._idx, call3d('listMapped')) };
  }
  var PICK = null, LAST = null;
  if (typeof document !== 'undefined' && document.addEventListener) document.addEventListener('visibilitychange', function () {
    var s = LAST && STATE && STATE.get(LAST); if (s) s.svg.classList.toggle('paused', !!document.hidden);
  });
  if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('viewer-command', function (ev) {
    var d = ev && ev.detail || {};
    if (d.action !== 'openAssetByBimId' || !d.bimId || (window.INJECTED_PROJECT_CONFIG || {}).hospitalHvac !== true || !window.EKO) return;
    var id = machineForBim(window.EKO, d.bimId);
    PICK = id ? { id: id, bimId: String(d.bimId) } : null;
    var s = LAST && STATE && STATE.get(LAST);
    if (PICK && s && LAST.isConnected && window.EKO.state && window.EKO.state.pageId === 'live-twin') { var pk = PICK; PICK = null; goTo(LAST, pk.id); s.picked = pk; update(LAST, s.E); }
  });
  /* the drawn machine a BIM GlobalId belongs to, or null: only a verified, unshared link counts */
  function machineForBim(E, guid) { return current(E).bim.guid[String(guid || '')] || null; }
  /* what a point row says: a boolean is FIN's enum word or On / Off; a number keeps the unit; a point with no reading says why */
  function pointShown(E, r) {
    if (r.state !== 'live') return tr(E, 'twinPt.' + r.state) + (r.state === 'unavailable' && r.status ? ' (' + r.status + ')' : '');
    if (r.type === 'bool') return r.text || tr(E, r.value ? 'twinOn' : 'twinOff');
    return r.text + (r.type === 'number' && r.unit ? ' ' + r.unit : '');
  }

  /* ── SVG drawing helpers (ported from the reference) ── */
  var NS = 'http://www.w3.org/2000/svg';
  function el(tag, a, parent) {
    var e = document.createElementNS(NS, tag);
    if (a) for (var k in a) e.setAttribute(k, a[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function ptsStr(arr) { return arr.map(function (q) { var p = P(q[0], q[1], q[2]); return fmt(p[0]) + ',' + fmt(p[1]); }).join(' '); }
  function face(g, arr, fill, cls, stroke) { var a = { points: ptsStr(arr), fill: fill, 'class': cls || 'face' }; if (stroke) a.stroke = stroke; return el('polygon', a, g); }
  var PAL = {
    metal: { top: '#5d7186', front: '#3f4e60', side: '#2f3b49', edge: '#7c92a9' },
    steel: { top: '#6a7b8d', front: '#4a596a', side: '#374352', edge: '#8ea2b6' },
    panel: { top: '#525b6b', front: '#3a414f', side: '#2c323d', edge: '#6d7788' },
    dark: { top: '#353d4a', front: '#262c36', side: '#1d222a', edge: '#4a5363' },
    blue: { top: '#5c87b5', front: '#3e6590', side: '#2f4e70', edge: '#83abd6' },
    teal: { top: '#4f8f8c', front: '#386e6b', side: '#2a5452', edge: '#73b4b0' },
    red: { top: '#b56060', front: '#8e4444', side: '#6c3333', edge: '#d68585' },
    white: { top: '#dfe6ee', front: '#b9c4d0', side: '#94a1b0', edge: '#f2f6fa' },
    green: { top: '#5f9a72', front: '#477a57', side: '#355c41', edge: '#86c29a' },
    amber: { top: '#c49a4a', front: '#9a7634', side: '#755926', edge: '#e2bd73' },
    concrete: { top: '#4c535c', front: '#3a4047', side: '#2d3238', edge: '#626a74' },
    louver: { top: '#56697c', front: '#33414f', side: '#27323d', edge: '#6f8499' }
  };
  var SLAB = { top: '#1a2330', front: '#121923', side: '#0e141c', edge: '#2b3a4d' };
  function box(g, x, y, z, w, d, h, pal, cls) {
    var c = PAL[pal] || pal, b = el('g', { 'class': cls || 'box' }, g);
    face(b, [[x, y, z + h], [x + w, y, z + h], [x + w, y + d, z + h], [x, y + d, z + h]], c.top, 'face top', c.edge);
    face(b, [[x, y, z], [x + w, y, z], [x + w, y, z + h], [x, y, z + h]], c.front, 'face front', c.edge);
    face(b, [[x + w, y, z], [x + w, y + d, z], [x + w, y + d, z + h], [x + w, y, z + h]], c.side, 'face side', c.edge);
    return b;
  }
  function hull(p) {
    p = p.slice().sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    function cr(o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); }
    var lo = [], up = [], i, q;
    for (i = 0; i < p.length; i++) { q = p[i]; while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
    for (i = p.length - 1; i >= 0; i--) { q = p[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
    return lo.slice(0, -1).concat(up.slice(0, -1));
  }
  function poly2(g, p, a) { a = a || {}; a.points = p.map(function (q) { return fmt(q[0]) + ',' + fmt(q[1]); }).join(' '); return el('polygon', a, g); }
  function ring(cx, cy, cz, r, plane, n) {
    n = n || 28;
    var out = [];
    for (var i = 0; i < n; i++) {
      var a = i / n * Math.PI * 2, c = Math.cos(a) * r, s = Math.sin(a) * r;
      out.push(plane === 'xy' ? [cx + c, cy + s, cz] : plane === 'yz' ? [cx, cy + c, cz + s] : [cx + c, cy, cz + s]);
    }
    return out;
  }
  function proj(arr) { return arr.map(function (q) { return P(q[0], q[1], q[2]); }); }
  function cylV(g, cx, cy, z, r, h, pal) {
    var c = PAL[pal], b = el('g', { 'class': 'cyl' }, g);
    var bot = proj(ring(cx, cy, z, r, 'xy')), top = proj(ring(cx, cy, z + h, r, 'xy'));
    poly2(b, hull(bot.concat(top)), { fill: 'url(#twgv_' + pal + ')', stroke: c.edge, 'stroke-width': 0.5 });
    poly2(b, top, { fill: c.top, stroke: c.edge, 'stroke-width': 0.5 });
    return b;
  }
  function cylX(g, x0, x1, cy, cz, r, pal) {
    var c = PAL[pal], b = el('g', { 'class': 'cyl' }, g);
    var a = proj(ring(x0, cy, cz, r, 'yz')), e = proj(ring(x1, cy, cz, r, 'yz'));
    poly2(b, hull(a.concat(e)), { fill: 'url(#twgh_' + pal + ')', stroke: c.edge, 'stroke-width': 0.5 });
    poly2(b, e, { fill: c.side, stroke: c.edge, 'stroke-width': 0.5 });
    return b;
  }
  function cylY(g, cx, y0, y1, cz, r, pal) {
    var c = PAL[pal], b = el('g', { 'class': 'cyl' }, g);
    var a = proj(ring(cx, y0, cz, r, 'xz')), e = proj(ring(cx, y1, cz, r, 'xz'));
    poly2(b, hull(a.concat(e)), { fill: 'url(#twgh_' + pal + ')', stroke: c.edge, 'stroke-width': 0.5 });
    poly2(b, a, { fill: c.front, stroke: c.edge, 'stroke-width': 0.5 });
    return b;
  }
  function planeGroup(g, cx, cy, cz, r, plane) {
    var o = P(cx, cy, cz), ux = plane === 'yz' ? P(cx, cy + 1, cz) : P(cx + 1, cy, cz), vy = plane === 'xy' ? P(cx, cy + 1, cz) : P(cx, cy, cz - 1);
    var m = [(ux[0] - o[0]) * r, (ux[1] - o[1]) * r, (vy[0] - o[0]) * r, (vy[1] - o[1]) * r, o[0], o[1]];
    return el('g', { transform: 'matrix(' + m.map(fmt).join(',') + ')' }, g);
  }
  /* a fan, pump impeller or heat wheel, drawn still; update() turns it (data-spin) only while FIN says the part is running. role: a part with its own status (a pump of a set, the heat wheel). */
  function rotor(g, cx, cy, cz, r, plane, blades, style, role) {
    var pg = planeGroup(g, cx, cy, cz, r, plane);
    el('circle', { r: 1, 'class': 'rotor-house', 'vector-effect': 'non-scaling-stroke' }, pg);
    var rot = el('g', role ? { 'class': 'rotor', 'data-role': role } : { 'class': 'rotor' }, pg), i, a;
    if (style === 'wheel') {
      el('circle', { r: 0.96, 'class': 'wheel-face', 'vector-effect': 'non-scaling-stroke' }, rot);
      for (i = 0; i < 12; i++) { a = i / 12 * Math.PI * 2; el('line', { x1: 0, y1: 0, x2: Math.cos(a) * 0.95, y2: Math.sin(a) * 0.95, 'class': 'spoke', 'vector-effect': 'non-scaling-stroke' }, rot); }
    } else {
      for (i = 0; i < (blades || 5); i++) el('path', { d: 'M0.12,-0.08 C0.45,-0.34 0.9,-0.28 0.94,-0.02 C0.7,0.1 0.4,0.14 0.12,0.08 Z', 'class': 'blade', transform: 'rotate(' + (i / (blades || 5) * 360) + ')' }, rot);
    }
    el('circle', { r: 0.16, 'class': 'hub' }, rot);
    return rot;
  }
  function faceText(g, x, y, z, txt, size, plane, cls) {
    var o = P(x, y, z), a = plane === 'yz' ? AX.y : AX.x;
    var grp = el('g', { transform: 'matrix(' + a[0] + ',' + a[1] + ',0,' + VIEW.zs + ',' + fmt(o[0]) + ',' + fmt(o[1]) + ')' }, g);
    var t = el('text', { x: 0, y: 0, 'class': cls || 'lcd-t', 'font-size': size || 7 }, grp);
    t.textContent = txt;
    return t;
  }
  /* a display panel on a machine: left blank, it will carry a live value in a later phase */
  function lcd(g, x, y, z, w, h, plane) {
    var pts = plane === 'yz' ? [[x, y, z], [x, y + w, z], [x, y + w, z + h], [x, y, z + h]] : [[x, y, z], [x + w, y, z], [x + w, y, z + h], [x, y, z + h]];
    face(g, pts, '#0b1622', 'lcd', '#2b3f55');
  }
  function lamp(g, x, y, z, r) { var p = P(x, y, z); return el('circle', { cx: fmt(p[0]), cy: fmt(p[1]), r: r || 3.2, 'class': 'lamp' }, g); }
  function slats(g, x, y, z, w, h, n, plane) {
    for (var i = 1; i < n; i++) {
      var zz = z + h * i / n, a = P(x, y, zz), b = plane === 'yz' ? P(x, y + w, zz) : P(x + w, y, zz);
      el('line', { x1: fmt(a[0]), y1: fmt(a[1]), x2: fmt(b[0]), y2: fmt(b[1]), 'class': 'slat' }, g);
    }
  }
  function vlines(g, x, y, z, w, h, n, plane, cls) {
    for (var i = 1; i < n; i++) {
      var xx = plane === 'yz' ? x : x + w * i / n, yy = plane === 'yz' ? y + w * i / n : y, a = P(xx, yy, z), b = P(xx, yy, z + h);
      el('line', { x1: fmt(a[0]), y1: fmt(a[1]), x2: fmt(b[0]), y2: fmt(b[1]), 'class': cls || 'slat' }, g);
    }
  }
  function seg(g, a, b, cls) { var p = P(a[0], a[1], a[2]), q = P(b[0], b[1], b[2]); return el('line', { x1: fmt(p[0]), y1: fmt(p[1]), x2: fmt(q[0]), y2: fmt(q[1]), 'class': cls }, g); }
  function halo(g, e) {
    return poly2(g, proj(ring(e.x + e.w / 2, e.y + e.d / 2, e.z + 0.05, Math.max(e.w, e.d) * 0.72, 'xy', 32)), { 'class': 'halo' });
  }

  /* ── the machines, one drawing per type (ported from the reference, values and animation left out) ── */
  var DRAW = {};
  DRAW.CHILLER = function (g, e) {
    var x = e.x, y = e.y, z = e.z, w = e.w, d = e.d;
    box(g, x, y, z, w, d, 0.45, 'dark');
    [[x + 1.2, y + 0.6], [x + 8.2, y + 0.6], [x + 1.2, y + 3.0], [x + 8.2, y + 3.0]].forEach(function (q) { box(g, q[0], q[1], z + 0.45, 0.5, 0.5, 0.5, 'dark'); });
    cylX(g, x + 0.4, x + 9.0, y + 2.95, z + 1.65, 1.1, 'teal');
    cylX(g, x + 0.4, x + 9.0, y + 1.25, z + 1.45, 1.0, 'blue');
    cylV(g, x + 5.6, y + 2.1, z + 2.6, 0.85, 1.2, 'steel');
    cylX(g, x + 3.6, x + 5.2, y + 2.1, z + 3.35, 0.55, 'metal');
    box(g, x + 9.05, y + 0.2, z + 0.45, 0.9, 1.8, 3.5, 'panel');
    lcd(g, x + 9.12, y + 0.2, z + 2.6, 0.75, 0.7);
    lamp(g, x + 9.5, y + 0.2, z + 3.6);
    [[x + 9.0, y + 0.8, z + 1.0, 'chws'], [x + 9.0, y + 1.7, z + 1.9, 'chwr'], [x + 9.0, y + 2.6, z + 1.4, 'cws'], [x + 9.0, y + 3.4, z + 2.3, 'cwr']].forEach(function (q) {
      var p = P(q[0], q[1], q[2]); el('circle', { cx: fmt(p[0]), cy: fmt(p[1]), r: 2.4, fill: SYSTEMS[q[3]][0], 'class': 'nozzle' }, g);
    });
  };
  DRAW.CT = function (g, e) {
    var x = e.x, y = e.y, z = e.z, w = e.w, d = e.d, h = e.h;
    box(g, x, y, z, w, d, 0.8, 'concrete');
    box(g, x + 0.2, y + 0.2, z + 0.8, w - 0.4, d - 0.4, h - 1.6, 'louver');
    slats(g, x + 0.2, y + 0.2, z + 0.9, w - 0.4, h - 1.8, 9, 'xz');
    slats(g, x + w - 0.2, y + 0.2, z + 0.9, d - 0.4, h - 1.8, 9, 'yz');
    box(g, x, y, z + h - 0.8, w, d, 0.25, 'steel');
    cylV(g, x + w / 2, y + d / 2, z + h - 0.55, 2.1, 0.9, 'steel');
    rotor(g, x + w / 2, y + d / 2, z + h + 0.36, 1.9, 'xy', 6);
    lcd(g, x + w - 0.19, y + 0.5, z + 1.2, 2.4, 0.8, 'yz');
    lamp(g, x + w - 0.19, y + 3.3, z + 1.6);
  };
  DRAW.PUMPSET = function (g, e) {
    var x = e.x, y = e.y, z = e.z, w = e.w;
    box(g, x, y, z, w, 3, 0.3, 'dark');
    [y + 2.15, y + 0.85].forEach(function (yy, pi) {
      box(g, x + 0.5, yy - 0.55, z + 0.3, 1.3, 1.1, 1.0, 'steel');
      cylV(g, x + 1.15, yy, z + 1.3, 0.3, 0.5, 'steel');
      cylX(g, x + 1.8, x + 4.6, yy, z + 0.9, 0.52, 'blue');
      rotor(g, x + 4.62, yy, z + 0.9, 0.42, 'yz', 7, null, 'p' + (pi + 1));
      lamp(g, x + 5.2, yy - 0.5, z + 0.35, 2.6);
    });
    lcd(g, x + 5.1, y, z + 1.1, 0.85, 0.55);
  };
  DRAW.BTU = function (g, e) {
    cylX(g, e.x, e.x + 2.4, e.y + 0.7, e.z + 1.2, 0.45, 'steel');
    box(g, e.x + 0.6, e.y + 0.35, e.z + 1.6, 1.2, 0.7, 0.9, 'panel');
    lcd(g, e.x + 0.65, e.y + 0.35, e.z + 1.75, 1.1, 0.6);
  };
  DRAW.BOILER = function (g, e) {
    var x = e.x, y = e.y, z = e.z;
    box(g, x, y, z, 3.2, 3.2, 0.3, 'dark');
    cylV(g, x + 1.6, y + 1.6, z + 0.3, 1.45, 4.4, 'red');
    cylV(g, x + 2.2, y + 2.3, z + 4.7, 0.32, 1.6, 'steel');
    box(g, x + 0.6, y - 0.25, z + 0.4, 1.9, 0.55, 1.3, 'panel');
    el('circle', { r: 1, 'class': 'flame-window', 'vector-effect': 'non-scaling-stroke' }, planeGroup(g, x + 1.55, y - 0.26, z + 1.05, 0.45, 'xz'));
    lcd(g, x + 2.62, y + 0.6, z + 3.0, 1.4, 0.7, 'yz');
    lamp(g, x + 2.62, y + 2.4, z + 3.9);
  };
  function airUnit(g, e, isFahu) {
    var x = e.x, y = e.y, z = e.z, w = e.w, d = e.d, h = e.h, fx = x + 0.4, fz = z + 0.7, cx0 = isFahu ? x + 4.6 : x + 2.6;
    box(g, x, y, z, w, d, 0.3, 'dark');
    box(g, x, y, z + 0.3, w, d, h - 0.3, 'metal');
    vlines(g, x, y, z + 0.3, w, h - 0.3, isFahu ? 4 : 3, 'xz', 'seam');
    face(g, [[fx, y - 0.01, fz], [fx + 1.6, y - 0.01, fz], [fx + 1.6, y - 0.01, fz + 2.3], [fx, y - 0.01, fz + 2.3]], 'url(#twhatch)', 'filter-panel');
    face(g, [[cx0, y - 0.01, fz], [cx0 + 1.5, y - 0.01, fz], [cx0 + 1.5, y - 0.01, fz + 2.3], [cx0, y - 0.01, fz + 2.3]], 'url(#twfins)', 'coil-panel');
    if (isFahu) {
      rotor(g, x + 3.1, y - 0.03, z + 1.85, 1.2, 'xz', 0, 'wheel', 'wheel');
      rotor(g, x + 7.3, y - 0.03, z + 1.85, 1.05, 'xz', 6);
    } else rotor(g, x + 6.6, y - 0.03, z + 1.85, 1.15, 'xz', 6);
    lcd(g, x + w + 0.01, y + 0.4, z + 2.2, 2.0, 0.7, 'yz');
    lamp(g, x + w + 0.01, y + 3.0, z + 3.0);
  }
  DRAW.AHU = function (g, e) { airUnit(g, e, false); };
  DRAW.FAHU = function (g, e) { airUnit(g, e, true); };
  /* the supply-air cone under a ceiling unit: drawn always, shown (CSS) only while the unit's own run status reads on */
  function airCone(g, e) {
    poly2(g, hull(proj(ring(e.x + e.w / 2, e.y + e.d / 2, e.z, 0.55, 'xy', 18).concat(ring(e.x + e.w / 2, e.y + e.d / 2, LZ[e.level] + 0.05, 1.9, 'xy', 18)))), { 'class': 'aircone' });
  }
  DRAW.FCU = function (g, e) {
    var x = e.x, y = e.y, z = e.z, w = e.w, d = e.d, h = e.h;
    airCone(g, e);
    [[x + 0.3, y + 0.3], [x + w - 0.3, y + 0.3], [x + 0.3, y + d - 0.3], [x + w - 0.3, y + d - 0.3]].forEach(function (q) { seg(g, [q[0], q[1], z + h], [q[0], q[1], z + h + 0.9], 'hanger'); });
    box(g, x, y, z, w, d, h, 'steel');
    rotor(g, x + w / 2, y + d / 2, z + h + 0.01, 0.95, 'xy', 5);
    lamp(g, x + w, y + 0.2, z + 0.55, 2.6);
  };
  DRAW.VAV = function (g, e) {
    var x = e.x, y = e.y, z = e.z, w = e.w, d = e.d, h = e.h;
    airCone(g, e);
    seg(g, [x + w / 2, y + d / 2, z + h], [x + w / 2, y + d / 2, z + h + 0.6], 'hanger');
    cylY(g, x + w / 2, y + d, y + d + 0.25, z + h / 2, 0.32, 'steel');
    box(g, x, y, z, w, d, h, 'steel');
    var pg = planeGroup(g, x + w + 0.01, y + d / 2, z + h / 2, 0.38, 'yz');
    el('circle', { r: 1, 'class': 'damper-ring', 'vector-effect': 'non-scaling-stroke' }, pg);
    el('line', { x1: -0.9, y1: 0, x2: 0.9, y2: 0, 'class': 'damper-blade', 'vector-effect': 'non-scaling-stroke' }, pg);
    lamp(g, x + 0.2, y, z + 0.5, 2.4);
  };
  DRAW.EF = function (g, e) {
    box(g, e.x, e.y, e.z, 2.2, 2.2, 0.3, 'dark');
    cylY(g, e.x + 1.1, e.y + 0.2, e.y + 2.2, e.z + 1.15, 0.85, 'steel');
    rotor(g, e.x + 1.1, e.y + 0.19, e.z + 1.15, 0.72, 'xz', 7);
    lamp(g, e.x + 2.0, e.y, e.z + 0.45, 2.4);
  };
  DRAW.ATS = function (g, e) {
    var x = e.x, y = e.y, z = e.z;
    box(g, x, y, z, e.w, e.d, e.h, 'panel');
    vlines(g, x, y, z, e.w, e.h, 2, 'xz', 'seam');
    lamp(g, x + 0.5, y, z + 3.1, 2.8); lamp(g, x + 2.4, y, z + 3.1, 2.8);
    faceText(g, x + 0.32, y - 0.01, z + 2.6, 'N', 4.6, 'xz', 'face-lbl'); faceText(g, x + 2.25, y - 0.01, z + 2.6, 'E', 4.6, 'xz', 'face-lbl');
    lcd(g, x + 0.3, y - 0.01, z + 0.5, 2.4, 0.6);
  };
  DRAW.SMDB = function (g, e) {
    box(g, e.x, e.y, e.z, e.w, e.d, e.h, 'panel');
    for (var r = 0; r < 4; r++) for (var c = 0; c < 5; c++) {
      var bx = e.x + 0.25 + c * 0.44, bz = e.z + 0.5 + r * 0.5;
      face(g, [[bx, e.y - 0.01, bz], [bx + 0.3, e.y - 0.01, bz], [bx + 0.3, e.y - 0.01, bz + 0.36], [bx, e.y - 0.01, bz + 0.36]], '#1b2028', 'breaker');
    }
    lamp(g, e.x + 1.3, e.y, e.z + 2.85, 2.8);
  };
  DRAW.MDB = function (g, e) {
    var x = e.x, y = e.y, z = e.z;
    box(g, x, y, z, e.w, e.d, e.h, 'panel');
    vlines(g, x, y, z, e.w, e.h, 3, 'xz', 'seam');
    [0, 1, 2].forEach(function (i) { var bx = x + 0.28 + i * 1.12; face(g, [[bx, y - 0.01, z + 0.5], [bx + 0.6, y - 0.01, z + 0.5], [bx + 0.6, y - 0.01, z + 1.4], [bx, y - 0.01, z + 1.4]], '#1b2028', 'breaker'); });
    lcd(g, x + 0.3, y - 0.01, z + 2.25, 1.9, 0.75);
    faceText(g, x + 2.4, y - 0.01, z + 2.5, 'MDB', 5.2, 'xz', 'face-lbl');
    lamp(g, x + 3.0, y, z + 3.25, 2.8);
  };
  DRAW.MCC = function (g, e) {
    var x = e.x, y = e.y, z = e.z;
    box(g, x, y, z, e.w, e.d, e.h, 'steel');
    vlines(g, x, y, z, e.w, e.h, 2, 'xz', 'seam');
    for (var r = 0; r < 4; r++) for (var c = 0; c < 2; c++) {
      var bx = x + 0.15 + c * 1.3, bz = z + 0.3 + r * 0.55;
      face(g, [[bx, y - 0.01, bz], [bx + 1.0, y - 0.01, bz], [bx + 1.0, y - 0.01, bz + 0.45], [bx, y - 0.01, bz + 0.45]], '#2a3340', 'breaker');
    }
    lcd(g, x + 0.25, y - 0.01, z + 2.6, 1.5, 0.5);
    lamp(g, x + 2.2, y, z + 2.85, 2.6);
  };
  DRAW.DB = function (g, e) {
    var x = e.x, y = e.y, z = e.z, w = e.w, h = e.h;
    box(g, x, y, z, w, e.d, h, 'panel');
    face(g, [[x + 0.12, y - 0.01, z + 0.15], [x + w - 0.12, y - 0.01, z + 0.15], [x + w - 0.12, y - 0.01, z + h - 0.15], [x + 0.12, y - 0.01, z + h - 0.15]], '#323a47', 'breaker');
    for (var r = 0; r < 3; r++) seg(g, [x + 0.22, y - 0.02, z + 0.45 + r * 0.38], [x + w - 0.22, y - 0.02, z + 0.45 + r * 0.38], 'seam');
    lcd(g, x + 0.2, y - 0.02, z + 1.45, 1.0, 0.35);
    lamp(g, x + w - 0.22, y, z + h - 0.25, 2.4);
  };
  DRAW.CCTV = function (g, e) {
    var x = e.x, y = e.y, z = e.z, w = e.w, d = e.d, h = e.h;
    box(g, x, y, z + h - 0.1, w, d, 0.1, 'dark');
    seg(g, [x + w / 2, y + d / 2, z + h - 0.1], [x + w / 2, y + d / 2, z + 0.3], 'hanger');
    cylX(g, x + 0.05, x + 0.8, y + d / 2, z + 0.25, 0.17, 'white');
    poly2(g, proj(ring(x + 0.8, y + d / 2, z + 0.25, 0.1, 'yz', 14)), { fill: '#0b1622', stroke: '#2b3f55', 'stroke-width': 0.4 });
    lamp(g, x + 0.25, y + d / 2 - 0.17, z + 0.38, 1.6);
  };
  /* medical devices: small power on the floor DB. Drawn only; no state is shown (FIN lists no point on them). */
  DRAW.DIALYSIS = function (g, e) {
    var x = e.x, y = e.y, z = e.z;
    box(g, x, y, z, 1.0, 0.9, 0.22, 'dark');
    box(g, x + 0.1, y + 0.1, z + 0.22, 0.8, 0.7, 1.05, 'white');
    seg(g, [x + 0.5, y + 0.45, z + 1.27], [x + 0.5, y + 0.45, z + 1.75], 'hanger');
    cylV(g, x + 0.3, y + 0.45, z + 1.3, 0.09, 0.35, 'red'); cylV(g, x + 0.7, y + 0.45, z + 1.3, 0.09, 0.35, 'blue');
    lcd(g, x + 0.18, y + 0.09, z + 0.85, 0.64, 0.32);
    lamp(g, x + 0.8, y + 0.1, z + 0.45, 2);
  };
  DRAW.STRETCHER = function (g, e) {
    var x = e.x, y = e.y, z = e.z;
    [[x + 0.15, y + 0.12], [x + 2.05, y + 0.12], [x + 0.15, y + 0.78], [x + 2.05, y + 0.78]].forEach(function (q) { seg(g, [q[0], q[1], z + 0.1], [q[0], q[1], z + 0.62], 'hanger'); });
    box(g, x, y, z + 0.55, 2.2, 0.9, 0.12, 'steel');
    box(g, x + 0.05, y + 0.05, z + 0.67, 2.1, 0.8, 0.16, 'blue');
    box(g, x + 1.6, y + 0.15, z + 0.83, 0.5, 0.6, 0.1, 'white');
    seg(g, [x, y, z + 1.0], [x + 2.2, y, z + 1.0], 'hanger');
    lamp(g, x + 2.2, y, z + 0.6, 1.8);
  };
  DRAW.LASER = function (g, e) {
    var x = e.x, y = e.y, z = e.z;
    box(g, x, y, z, 1.0, 0.9, 1.0, 'panel');
    cylV(g, x + 0.8, y + 0.5, z + 1.0, 0.08, 0.55, 'steel');
    cylX(g, x + 0.25, x + 0.85, y + 0.5, z + 1.5, 0.07, 'steel');
    cylV(g, x + 0.25, y + 0.5, z + 1.15, 0.1, 0.35, 'white');
    lcd(g, x + 0.12, y - 0.01, z + 0.6, 0.76, 0.28);
    lamp(g, x + 0.85, y, z + 0.25, 2);
  };
  DRAW.FRIDGE = function (g, e) {
    var x = e.x, y = e.y, z = e.z;
    box(g, x, y, z, 1.1, 0.9, 2.0, 'white');
    seg(g, [x, y - 0.01, z + 0.75], [x + 1.1, y - 0.01, z + 0.75], 'seam');
    seg(g, [x + 0.9, y - 0.02, z + 0.85], [x + 0.9, y - 0.02, z + 1.6], 'hanger');
    seg(g, [x + 0.9, y - 0.02, z + 0.2], [x + 0.9, y - 0.02, z + 0.6], 'hanger');
    lcd(g, x + 0.15, y - 0.02, z + 1.65, 0.55, 0.22);
    lamp(g, x + 0.82, y, z + 1.76, 1.8);
  };
  DRAW.ULTRASOUND = function (g, e) {
    var x = e.x, y = e.y, z = e.z;
    box(g, x, y, z, 1.0, 0.9, 0.18, 'dark');
    box(g, x + 0.2, y + 0.2, z + 0.18, 0.6, 0.5, 0.7, 'white');
    box(g, x + 0.05, y + 0.05, z + 0.88, 0.9, 0.7, 0.1, 'steel');
    seg(g, [x + 0.5, y + 0.75, z + 0.98], [x + 0.5, y + 0.75, z + 1.15], 'hanger');
    box(g, x + 0.1, y + 0.7, z + 1.15, 0.8, 0.08, 0.5, 'dark');
    lcd(g, x + 0.14, y + 0.69, z + 1.2, 0.72, 0.38);
    lamp(g, x + 0.85, y + 0.05, z + 0.95, 1.8);
  };
  DRAW.SCALE = function (g, e) {
    var x = e.x, y = e.y, z = e.z;
    box(g, x, y, z, 1.2, 1.2, 0.12, 'steel');
    cylV(g, x + 0.6, y + 1.05, z + 0.12, 0.05, 1.05, 'steel');
    box(g, x + 0.3, y + 0.95, z + 1.12, 0.6, 0.2, 0.3, 'panel');
    lcd(g, x + 0.36, y + 0.94, z + 1.17, 0.48, 0.2);
    lamp(g, x + 0.85, y + 0.95, z + 1.36, 1.6);
  };
  DRAW.WM = function (g, e) {
    cylX(g, e.x, e.x + 1.6, e.y + 0.5, e.z + 0.35, 0.32, 'steel');
    cylV(g, e.x + 0.8, e.y + 0.5, e.z + 0.55, 0.42, 0.35, 'amber');
  };
  DRAW.BOOSTER = function (g, e) {
    var x = e.x, y = e.y, z = e.z;
    box(g, x, y, z, 6, 4, 0.3, 'dark');
    cylV(g, x + 1.2, y + 2.6, z + 0.3, 0.95, 2.8, 'blue');
    [x + 4.6, x + 3.2].forEach(function (px, pi) {
      cylV(g, px, y + 1.2, z + 0.3, 0.32, 1.7, 'steel');
      cylV(g, px, y + 1.2, z + 2.0, 0.45, 0.85, 'blue');
      rotor(g, px, y + 1.2, z + 2.86, 0.38, 'xy', 5, null, 'p' + (pi + 1));
      lamp(g, px + 0.5, y + 0.7, z + 0.4, 2.4);
    });
    lcd(g, x + 3.4, y - 0.01, z + 0.9, 1.6, 0.5);
  };
  DRAW.SUMP = function (g, e) {
    var x = e.x, y = e.y, z = e.z;
    box(g, x, y, z - 1.4, 4, 4, 1.6, 'concrete');
    face(g, [[x + 0.3, y + 0.3, z + 0.21], [x + 3.7, y + 0.3, z + 0.21], [x + 3.7, y + 3.7, z + 0.21], [x + 0.3, y + 3.7, z + 0.21]], '#0a0e13', 'pit');
    [[x + 1.2, y + 2.6], [x + 2.8, y + 2.6]].forEach(function (q) { cylV(g, q[0], q[1], z + 0.2, 0.3, 0.7, 'steel'); lamp(g, q[0] + 0.4, q[1] - 0.4, z + 0.9, 2.4); });
  };
  DRAW.O2 = function (g, e) {
    var x = e.x, y = e.y, z = e.z;
    box(g, x, y, z, 5, 3, 0.3, 'dark');
    cylV(g, x + 1.0, y + 1.9, z + 0.3, 0.62, 4.6, 'white');
    cylV(g, x + 2.4, y + 1.9, z + 0.3, 0.62, 4.6, 'white');
    cylV(g, x + 3.9, y + 1.8, z + 0.3, 0.8, 3.4, 'green');
    box(g, x + 3.2, y + 0.1, z + 0.3, 1.6, 0.8, 2.4, 'panel');
    lcd(g, x + 3.28, y + 0.09, z + 1.7, 1.4, 0.5);
    lamp(g, x + 4.6, y + 0.1, z + 2.45, 2.6);
  };
  DRAW.MAC = function (g, e) {
    var x = e.x, y = e.y, z = e.z;
    [[x + 0.8, y + 0.6], [x + 4, y + 0.6], [x + 0.8, y + 2], [x + 4, y + 2]].forEach(function (q) { box(g, q[0], q[1], z, 0.3, 0.3, 0.7, 'dark'); });
    cylX(g, x + 0.3, x + 4.8, y + 1.4, z + 1.45, 0.85, 'amber');
    box(g, x + 1.4, y + 0.5, z + 2.3, 2.4, 1.7, 1.1, 'steel');
    rotor(g, x + 2.6, y + 0.49, z + 2.85, 0.45, 'xz', 6);
    lcd(g, x + 3.85, y + 0.7, z + 2.5, 1.2, 0.5, 'yz');
    lamp(g, x + 1.6, y + 0.5, z + 3.25, 2.6);
  };
  DRAW.DEWA = function (g, e) {
    var x = e.x, y = e.y, z = e.z;
    box(g, x, y, z, 4, 3, 0.35, 'concrete');
    box(g, x + 0.4, y + 0.4, z + 0.35, 3.2, 2.2, 2.4, 'green');
    vlines(g, x + 0.4, y + 0.4, z + 0.5, 3.2, 2.0, 9, 'xz', 'fin');
    [1.2, 2, 2.8].forEach(function (a) { cylV(g, x + a, y + 1.5, z + 2.75, 0.18, 0.7, 'white'); });
    lamp(g, x + 3.4, y + 0.4, z + 2.4, 3);
  };
  DRAW.GEN = function (g, e) {
    var x = e.x, y = e.y, z = e.z;
    box(g, x, y, z, 6, 3, 0.3, 'concrete');
    box(g, x + 0.2, y + 0.2, z + 0.3, 5.6, 2.6, 2.4, 'amber');
    slats(g, x + 3.6, y + 0.19, z + 0.6, 2, 1.6, 6, 'xz');
    cylV(g, x + 1.2, y + 2.0, z + 2.7, 0.22, 1.2, 'dark');
    lamp(g, x + 5.4, y + 0.2, z + 2.4, 3);
  };
  DRAW.WX = function (g, e) {
    cylV(g, e.x + 0.5, e.y + 0.5, e.z, 0.08, 3.8, 'steel');
    box(g, e.x + 0.15, e.y + 0.15, e.z + 3.3, 0.7, 0.7, 0.6, 'white');
  };

  function defs(svg) {
    var df = el('defs', {}, svg);
    Object.keys(PAL).forEach(function (k) {
      var c = PAL[k], gv = el('linearGradient', { id: 'twgv_' + k, x1: 0, y1: 0, x2: 1, y2: 0 }, df);
      el('stop', { offset: '0', 'stop-color': c.side }, gv); el('stop', { offset: '.28', 'stop-color': c.top }, gv);
      el('stop', { offset: '.55', 'stop-color': c.front }, gv); el('stop', { offset: '1', 'stop-color': c.side }, gv);
      var gh = el('linearGradient', { id: 'twgh_' + k, x1: 0, y1: 0, x2: 0, y2: 1 }, df);
      el('stop', { offset: '0', 'stop-color': c.top }, gh); el('stop', { offset: '.45', 'stop-color': c.front }, gh); el('stop', { offset: '1', 'stop-color': c.side }, gh);
    });
    var h = el('pattern', { id: 'twhatch', width: 4, height: 4, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, df);
    el('rect', { width: 4, height: 4, fill: '#47566a' }, h); el('line', { x1: 0, y1: 0, x2: 0, y2: 4, stroke: '#8a9bb0', 'stroke-width': 1 }, h);
    var f = el('pattern', { id: 'twfins', width: 2.4, height: 4, patternUnits: 'userSpaceOnUse' }, df);
    el('rect', { width: 2.4, height: 4, fill: '#33587f' }, f); el('line', { x1: 1.2, y1: 0, x2: 1.2, y2: 4, stroke: '#7fb0e6', 'stroke-width': 0.7 }, f);
    var gs = el('radialGradient', { id: 'twglowS' }, df);
    el('stop', { offset: '0', 'stop-color': '#5cc8ff', 'stop-opacity': '.55' }, gs); el('stop', { offset: '1', 'stop-color': '#5cc8ff', 'stop-opacity': '0' }, gs);
    var wg = el('linearGradient', { id: 'twwall', x1: 0, y1: 0, x2: 0, y2: 1 }, df);
    el('stop', { offset: '0', 'stop-color': '#5b7ea6', 'stop-opacity': '.10' }, wg); el('stop', { offset: '1', 'stop-color': '#5b7ea6', 'stop-opacity': '.02' }, wg);
  }
  function pathD(pts) { return pts.map(function (q, i) { var p = P(q[0], q[1], q[2]); return (i ? 'L' : 'M') + fmt(p[0]) + ',' + fmt(p[1]); }).join(' '); }
  /* one pipe, duct or cable. data-src: the machine the reference ties it to (selection highlights it). The .flow overlay is drawn once; update() only sets
     data-flow (measured · running · stopped · tripped · stale · offline · unknown, MAP.flowState) and CSS animates measured and running flow only. The path runs the way the
     fluid, air or current goes, so the moving dashes show the direction. */
  function drawPipe(g, p, refs) {
    var d = pathD(p.pts), grp = el('g', { 'class': 'pipe k-' + p.kind, 'data-pipe': p.id, 'data-sys': p.sys, 'data-layer': SYSTEMS[p.sys][1], 'data-src': p.src, 'data-flow': 'unknown' }, g);
    el('path', { d: d, 'class': 'casing' }, grp);
    el('path', { d: d, 'class': 'core', stroke: SYSTEMS[p.sys][0] }, grp);
    el('path', { d: d, 'class': 'flow', stroke: SYSTEMS[p.sys][0] }, grp);
    if (refs) { (refs.pipes[p.src] = refs.pipes[p.src] || []).push(grp); if (refs.flows) refs.flows.push({ g: grp, p: p, rule: MAP && MAP.flowRule(p, EQ) }); }
  }
  function minZ(p) { return Math.min.apply(null, p.pts.map(function (q) { return q[2]; })); }
  function levelOfZ(z) { return z >= LZ.RF ? 'RF' : z >= LZ.L3 ? 'L3' : z >= LZ.L2 ? 'L2' : 'L1'; }
  function pipeLevel(p) { return p.pts[0][0] < 0 ? 'EXT' : levelOfZ(minZ(p)); }

  /* ── the scene: built once per view ── */
  function scene(svg, T, refs) {
    defs(svg);
    var world = el('g', { 'class': 'tw-world' }, svg);
    var gnd = el('g', { 'class': 'tw-ground' }, world);
    face(gnd, [[-20, -6, -0.7], [66, -6, -0.7], [66, 23, -0.7], [-20, 23, -0.7]], '#0d131b', 'site');
    for (var gx = -20; gx <= 66; gx += 4) seg(gnd, [gx, -6, -0.7], [gx, 23, -0.7], 'grid');
    for (var gy = -6; gy <= 23; gy += 4) seg(gnd, [-20, gy, -0.7], [66, gy, -0.7], 'grid');
    var sortKey = function (e) { return P(e.x + e.w / 2, e.y + e.d / 2, 0)[1]; };
    /* upper floors first, so the risers that run up through the building show in front of the floor slabs (the original look; the floors never overlap on screen) */
    ['RF', 'L3', 'L2', 'EXT', 'L1'].forEach(function (lv) {
      /* outside equipment belongs with the ground floor when a floor is picked */
      var g = el('g', { 'class': 'tw-level', 'data-level': lv === 'EXT' ? 'L1' : lv }, world), z = LZ[lv];
      if (lv !== 'EXT') {
        var wh = lv === 'RF' ? 1.0 : 4.8;
        face(g, [[0, 16.5, z], [60.5, 16.5, z], [60.5, 16.5, z + wh], [0, 16.5, z + wh]], 'url(#twwall)', 'wall');
        face(g, [[-0.5, -0.5, z], [-0.5, 16.5, z], [-0.5, 16.5, z + wh], [-0.5, -0.5, z + wh]], 'url(#twwall)', 'wall');
        box(g, -0.5, -0.5, z - 0.7, 61, 17, 0.7, SLAB, 'slab');
        for (var fx = 5; fx < 60; fx += 5) seg(g, [fx, -0.5, z + 0.01], [fx, 16.5, z + 0.01], 'floor-grid');
        seg(g, [-0.5, 8.2, z + 0.01], [60.5, 8.2, z + 0.01], 'floor-grid');
        ZONES.filter(function (zn) { return zn.level === lv; }).forEach(function (zn) {
          var r = zn.rect, c = P(r[0] + r[2] / 2, r[1] + r[3] / 2, z + 0.02);
          var poly = face(g, [[r[0] + 0.15, r[1] + 0.15, z + 0.02], [r[0] + r[2] - 0.15, r[1] + 0.15, z + 0.02], [r[0] + r[2] - 0.15, r[1] + r[3] - 0.15, z + 0.02], [r[0] + 0.15, r[1] + r[3] - 0.15, z + 0.02]], 'transparent', 'zone z-none');
          var tt = el('text', { x: fmt(c[0]), y: fmt(c[1]), 'class': 'zone-t', 'text-anchor': 'middle' }, g);
          refs.zones.push({ zn: zn, poly: poly, tt: tt });
        });
        var lp = P(-0.5, -0.5, z - 0.35), t = el('text', { x: fmt(lp[0] - 14), y: fmt(lp[1] + 4), 'class': 'level-name', 'text-anchor': 'end' }, g);
        t.textContent = T('twinLv.' + lv).toUpperCase();
        RISERS.forEach(function (r) {
          var up = { L1: LZ.L2, L2: LZ.L3, L3: LZ.RF, RF: 999 }[lv], a = Math.max(r.bottom, z), b = Math.min(r.top, up - 0.7);
          /* the power riser's segment on a floor carries the feeders of the SMDBs on that floor and above (Level 1's SMDB has its own cable) */
          var to = r.sys === 'pwr' ? ['L2', 'L3', 'RF'].filter(function (l) { return LZ[l] >= z; }).map(function (l) { return SMDB_OF[l]; }) : undefined;
          if (b > a + 0.2) drawPipe(g, { id: 'riser_' + r.sys + '_' + lv, sys: r.sys, src: r.src, kind: r.kind || 'pipe', to: to, pts: r.down ? [[r.x, r.y, b], [r.x, r.y, a]] : [[r.x, r.y, a], [r.x, r.y, b]] }, refs);
        });
      }
      var floorTop = LZ[lv === 'EXT' ? 'L1' : lv] + 3.2;
      PIPES.filter(function (p) { return pipeLevel(p) === lv && minZ(p) < floorTop; }).forEach(function (p) { drawPipe(g, p, refs); });
      var list = EQUIP.filter(function (e) { return e.level === lv; });
      list.filter(function (e) { return e.type !== 'FCU' && e.type !== 'VAV'; }).sort(function (a, b) { return sortKey(a) - sortKey(b); }).forEach(function (e) { drawEquip(g, e, T, refs); });
      /* ceiling services, then the ceiling units under them */
      PIPES.filter(function (p) { return pipeLevel(p) === lv && minZ(p) >= floorTop; }).forEach(function (p) { drawPipe(g, p, refs); });
      list.filter(function (e) { return e.type === 'FCU' || e.type === 'VAV'; }).sort(function (a, b) { return sortKey(a) - sortKey(b); }).forEach(function (e) { drawEquip(g, e, T, refs); });
    });
    var tags = el('g', { 'class': 'tw-tags' }, world);
    EQUIP.forEach(function (e) { refs.tags[e.id] = tag(tags, e); });
  }
  function drawEquip(parent, e, T, refs) {
    var g = el('g', { 'class': 'equip', 'data-id': e.id, 'data-level': e.level === 'EXT' ? 'L1' : e.level, 'data-fin': e.nonFin ? 'not-fin' : 'missing',
      tabindex: '0', role: 'button', 'aria-label': e.label + ' · ' + T('twinT.' + e.type) }, parent);
    /* what the mapping says before any live data (MAP.mapStatus, from the saved export): shown on the drawing so an unmapped, provisional or point-less item is never mistaken for a live one */
    var ms = MAP.mapStatus(e);
    g.setAttribute('data-map', ms.mapping); if (ms.noPoints) g.setAttribute('data-nopts', '1');
    halo(g, e);
    DRAW[e.type](g, e);
    refs.eqs[e.id] = g;
  }
  function tag(parent, e) {
    var top = P(e.x + e.w / 2, e.y + e.d / 2, e.z + e.h + (e.type === 'FCU' || e.type === 'VAV' ? 0.9 : 1.1) + (e.tagLift || 0));
    var g = el('g', { 'class': 'tag' + (MINOR[e.type] ? ' minor' : ''), 'data-id': e.id, 'data-level': e.level === 'EXT' ? 'L1' : e.level,
      'data-map': MAP.mapStatus(e).mapping, transform: 'translate(' + fmt(top[0]) + ',' + fmt(top[1]) + ')' }, parent);
    var w = Math.max(40, e.label.length * 3.7 + 16);
    /* the label is drawn in an inner group that is scaled to keep its size on screen (see tagLayout); g itself stays put at the machine */
    var inn = el('g', { 'class': 'tag-in' }, g);
    el('line', { x1: 0, y1: 0, x2: 0, y2: -6, 'class': 'tag-stem' }, inn);
    el('rect', { x: fmt(-w / 2), y: -17, width: fmt(w), height: 11, rx: 2.5, 'class': 'tag-bg' }, inn);
    el('circle', { cx: fmt(-w / 2 + 5), cy: -11.5, r: 2.2, 'class': 'tag-dot' }, inn);
    var t = el('text', { x: fmt(-w / 2 + 10), y: -9, 'class': 'tag-name' }, inn);
    t.textContent = e.label;
    g.__tag = { x: top[0], y: top[1], w: w, inn: inn, minor: !!MINOR[e.type], id: e.id, level: e.level === 'EXT' ? 'L1' : e.level };
    return g;
  }

  /* ── the view ── */
  function tr(E, key, vars) { return E && E.t ? E.t(key, vars) : key; }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function isConnected() { var d = typeof window !== 'undefined' && window.DashboardData; return !(d && d.connected === false); }
  var STATE = typeof WeakMap === 'function' ? new WeakMap() : null;
  function when(E, ms) { return ms == null ? '' : new Date(ms).toLocaleString(E && E.lang === 'ar' ? 'ar-AE' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }
  /* Exhibition settings, kept for this project in this browser session: fly to new alarms (on), labels (auto) */
  function exKey() { return 'eko-twin-ex:' + (((typeof window !== 'undefined' && window.INJECTED_PROJECT_CONFIG) || {}).projectId || ''); }
  function exLoad() { var x = {}; try { x = JSON.parse(window.sessionStorage.getItem(exKey())) || {}; } catch (e) {} return { fly: x.fly !== false, labels: ['auto', 'always', 'off'].indexOf(x.labels) >= 0 ? x.labels : 'auto' }; }
  function exSave(ex) { try { window.sessionStorage.setItem(exKey(), JSON.stringify(ex)); } catch (e) {} }
  var HIDDEN = {};   /* the system layers switched off, for the page session */

  /* the floor mapping, with no machine selected: what FIN floor each drawn level's mapped equipment report */
  /* a machine's floor in the list: its own drawn level; the outside machines (DEWA supply, the generator: level EXT) are listed under Level 1, the floor goTo shows them on.
     Only the list grouping: their drawn level, position and relationships stay EXT. */
  function lvOf(e) { return e.level === 'EXT' ? 'L1' : e.level; }
  /* top to bottom as the building is drawn; Outside only when something is drawn outside */
  var FLOOR_ORDER = ['RF', 'L3', 'L2', 'L1'];
  /* the Equipment tab with nothing selected: one expandable row per floor (name, count from EQUIP), the open floor's machines under it; one floor open at a time */
  function equipNavHtml(E, s) {
    return '<p class="twpick">' + esc(tr(E, 'twinFloorPick')) + '</p><div class="twacc">' + FLOOR_ORDER.map(function (lv) {
      var list = EQUIP.filter(function (e) { return lvOf(e) === lv; }), open = s.flr === lv;
      if (!list.length) return '';
      var code = MAP.LEVELS[lv] ? lv + ' \u00b7 ' + MAP.LEVELS[lv] : '';
      return '<section class="twaccf" data-lv="' + lv + '" data-open="' + (open ? 1 : 0) + '"><button type="button" class="twaccrow" data-tw="floor" data-lv="' + lv + '" aria-expanded="' + open + '" aria-controls="twacc-' + lv + '">' +
        '<i class="twaccarr" aria-hidden="true"></i><span class="twaccn"><b>' + esc(tr(E, 'twinLv.' + lv)) + '</b>' + (code ? '<small>' + esc(code) + '</small>' : '') + '</span>' +
        '<span class="twaccc" aria-label="' + esc(tr(E, 'twinFloorCount', { n: String(list.length) })) + '">' + list.length + '</span></button>' +
        (open ? '<ul class="twelist" id="twacc-' + lv + '">' + list.map(function (e) {
          var st = s.res[e.id].state, al = (s.alIdx.by[e.id] || []).length;
          return '<li>' + goBtn(e.id, '<b>' + esc(e.label) + '</b><span class="twchip" data-fin="' + st + '">' + esc(tr(E, 'twinFin.' + st)) + '</span>' +
            (MAP.RUNPTS[e.type] ? '<span class="twchip" data-run="' + (s.run[e.id] || 'unknown') + '">' + esc(tr(E, 'twinRun.' + (s.run[e.id] || 'unknown'))) + '</span>' : '') +
            (al ? '<span class="twchip" data-al="1">' + esc(tr(E, 'twinAlarms', { n: String(al) })) + '</span>' : '')) + '</li>';
        }).join('') + '</ul>' : '') + '</section>';
    }).join('') + '</div>';
  }
  /* the systems, flow and layout key, from SYSTEMS / LAYERS; opened from the Legend button on the drawing */
  function legendHtml(E) {
    return '<h3 class="twsub">' + esc(tr(E, 'twinSystems')) + '</h3><dl class="twlegend">' +
      LAYERS.map(function (l) {
        return '<div data-layer="' + l + '"><dt>' + esc(tr(E, 'twinLayer.' + l)) + '</dt>' + Object.keys(SYSTEMS).filter(function (k) { return SYSTEMS[k][1] === l; }).map(function (k) {
          return '<dd><i class="twkey" data-sys="' + k + '" style="background:' + SYSTEMS[k][0] + '"></i>' + esc(tr(E, 'twinSys.' + k)) + '</dd>';
        }).join('') + '</div>';
      }).join('') + '</dl><h3 class="twsub">' + esc(tr(E, 'twinFlowT')) + '</h3><ul class="twflowkey">' + ['measured', 'running', 'stopped', 'tripped', 'stale', 'offline', 'unknown'].map(function (k) {
        return '<li><i class="twfk" data-flow="' + k + '"></i>' + esc(tr(E, 'twinFlow.' + k)) + '</li>';
      }).join('') + '</ul>';
  }
  function label(id) { return EQ[id] ? EQ[id].label : id; }
  /* a machine's name as a button that selects it (and shows its floor) */
  function goBtn(id, inner) { return '<button type="button" class="twgo" data-tw="go" data-id="' + esc(id) + '">' + inner + '</button>'; }
  /* With nothing selected: every open FIN alarm (a click goes to its equipment), the floor mapping, the legend */
  function alarmListHtml(E, s) {
    var by = s.alIdx.by, ids = Object.keys(by), n = ids.reduce(function (k, id) { return k + by[id].length; }, 0) + s.alIdx.unlinked.length;
    var rows = ids.sort(function (a, b) { return EQUIP.indexOf(EQ[a]) - EQUIP.indexOf(EQ[b]); }).map(function (id) {
      return by[id].map(function (a) {
        return '<li data-sev="' + esc(a.sev || '') + '">' + goBtn(id, '<b>' + esc(a.message) + '</b><span>' + esc(label(id) + ' · ' + tr(E, 'twinLv.' + EQ[id].level) + ' · ' +
          tr(E, a.ack ? 'twinAlAcked' : 'twinAlOpen') + alarmFacts(E, a) + (a.at != null ? ' · ' + when(E, a.at) : '')) + '</span>' + (a.detail ? '<span class="twaldet">' + esc(a.detail) + '</span>' : '')) + '</li>';
      }).join('');
    }).join('') + s.alIdx.unlinked.map(function (a) {
      return '<li data-linked="0"><b>' + esc(a.message) + '</b><span>' + esc(tr(E, 'twinAlUnlinked', { source: a.source || a.sourceId || '?' })) + '</span></li>';
    }).join('');
    return '<h3 class="twsub">' + esc(tr(E, 'twinAlarmsAll', { n: String(n) })) + '</h3>' + (n ? '<ul class="twalarms twallist">' + rows + '</ul>' : '<p class="twnote">' + esc(tr(E, 'twinAlNone')) + '</p>');
  }
  /* the earlier records of the open alarms that returned to normal, newest first: never counted as active */
  function clearedHtml(E, s) {
    var seen = {}, rows = [];
    Object.keys(s.alIdx.by).forEach(function (id) { s.alIdx.by[id].forEach(function (a) { (a.clearedRecs || []).forEach(function (c) {
      var k = c.id || id + c.point + c.at; if (seen[k]) return; seen[k] = 1; rows.push({ id: id, c: c });
    }); }); });
    rows.sort(function (a, b) { return (b.c.at || 0) - (a.c.at || 0); });
    rows = rows.slice(0, 12);
    return '<h3 class="twsub">' + esc(tr(E, 'twinCleared', { n: String(rows.length) })) + '</h3>' + (rows.length ? '<ul class="twalarms twcleared">' + rows.map(function (x) {
      return '<li data-cleared="1">' + goBtn(x.id, '<b>' + esc(label(x.id)) + '</b><span>' + esc(tr(E, 'twinClearedRow') + (x.c.point ? ' · ' + x.c.point : '') + (x.c.at != null ? ' · ' + when(E, x.c.at) : '')) + '</span>' +
        (x.c.detail ? '<span class="twaldet">' + esc(x.c.detail) + '</span>' : '')) + '</li>';
    }).join('') + '</ul>' : '<p class="twnote">' + esc(tr(E, 'twinClearedNone')) + '</p>');
  }
  /* what the source says of an alarm, and nothing else: its severity word and priority as sent */
  function alarmFacts(E, a) {
    return (a.finSeverity ? ' · ' + tr(E, 'twinAlSevV', { v: a.finSeverity }) : '') + (a.priority != null ? ' · ' + tr(E, 'twinAlPriV', { v: String(a.priority) }) : '');
  }
  function alarmsHtml(E, als) {
    if (!als.length) return '';
    return '<h3 class="twsub">' + esc(tr(E, 'twinAlarms', { n: String(als.length) })) + '</h3><ul class="twalarms">' + als.map(function (a) {
      var dl = [[tr(E, 'twinAlStatus'), tr(E, 'twinAlOpen') + (a.ack ? ' · ' + tr(E, 'twinAlAckHere', { time: a.ack.time, who: a.ack.who }) : '')],
        [tr(E, 'twinAlSev'), a.finSeverity || tr(E, 'twinNone')], [tr(E, 'twinAlPri'), a.priority != null ? String(a.priority) : tr(E, 'twinNone')],
        [tr(E, 'twinAlSrc'), a.sourceId || tr(E, 'twinNone')], [tr(E, 'twinAlPoint'), a.point || tr(E, 'twinNone')]];
      return '<li data-sev="' + esc(a.sev || '') + '"><b>' + esc(a.message) + '</b>' + (a.detail ? '<span>' + esc(a.detail) + '</span>' : '') +
        '<dl class="twdl twaldl">' + dl.map(function (x) { return '<div><dt>' + esc(x[0]) + '</dt><dd>' + esc(x[1]) + '</dd></div>'; }).join('') + '</dl>' +
        (a.cleared ? '<span>' + esc(tr(E, 'twinAlCleared', { n: String(a.cleared) })) + '</span>' : '') + '</li>';
    }).join('') + '</ul>';
  }
  function fddHtml(E, rows) {
    if (!rows.length) return '';
    var nf = rows.filter(function (r) { return r.status === 'fault'; }).length;
    return '<h3 class="twsub">' + esc(tr(E, 'twinFdd', { n: String(nf), total: String(rows.length) })) + '</h3><ul class="twfdd">' + rows.map(function (r) {
      var why = r.status === 'unavailable' ? tr(E, 'twinPt.' + r.reading.state) : r.reading.text || tr(E, r.reading.value ? 'twinOn' : 'twinOff');
      if (String(why).trim().toLowerCase() === tr(E, 'twinFdd.' + r.status).toLowerCase()) why = '';
      var msg = r.message ? '<span class="twfddmsg">' + esc(r.message) + '</span><em>' + esc(r.messageFrom === 'alarm' ? tr(E, 'twinFddFromAlarm') : tr(E, 'twinFddFromPoint', { point: String(r.name).replace(/^FD&D_\d+_/i, '') })) + '</em>'
        : '<em>' + esc(tr(E, 'twinFddNoMsg')) + '</em>';
      return '<li data-st="' + r.status + '"><div><b>' + esc(r.name) + '</b><span class="twfddst">' + esc(tr(E, 'twinFdd.' + r.status)) + (why ? ' · ' + esc(why) : '') + (r.alarm ? ' · ' + esc(tr(E, 'twinFddAlarm')) : '') + '</span></div>' + msg + '</li>';
    }).join('') + '</ul>';
  }
  /* the four kinds of evidence, never mixed (MAP.evidence) */
  function evidenceHtml(E, s, id) {
    var ev = MAP.evidence(s.graph, id, s.res, s.alIdx, s.faults);
    /* an FD&D fault an open alarm already names is listed once, with the alarm */
    var bare = function (als, fs) { return fs.filter(function (f) { return !als.some(function (a) { return a.point === f; }); }); };
    if (!ev.alarms.length && !ev.faults.length) return '';
    var cap = function (list, f) { var max = 8, out = list.slice(0, max).map(f).join(''); return out + (list.length > max ? '<li class="twmore">' + esc(tr(E, 'twinEvMore', { n: String(list.length - max) })) + '</li>' : ''); };
    var relWord = function (x) { return tr(E, x.state === 'fail' ? 'twinRelStop' : 'twinRelShift') + (x.weak ? ' · ' + tr(E, 'twinRelWeak') : ''); };
    return '<section class="twev"><h3 class="twsub">' + esc(tr(E, 'twinEv')) + '</h3>' +
      '<h4 data-k="confirmed">' + esc(tr(E, 'twinEvAlarm')) + '</h4><ul>' + ev.alarms.map(function (a) { return '<li>' + esc(a.message) + (a.point ? ' · ' + esc(a.point) : '') + '</li>'; }).join('') +
        bare(ev.alarms, ev.faults).map(function (f) { return '<li>' + esc(f) + '</li>'; }).join('') + '</ul>' +
      '<h4 data-k="reference">' + esc(tr(E, 'twinEvRel', { up: String(ev.upstream.length), down: String(ev.impacts.length) })) + '</h4>' +
      '<h4 data-k="possible">' + esc(tr(E, 'twinEvPossible')) + '</h4>' + (ev.possible.length ? '<ul>' + cap(ev.possible, function (u) {
        return '<li>' + goBtn(u.id, esc(label(u.id))) + ' <span>' + esc(relWord(u)) + '</span>' + u.alarms.map(function (a) { return '<span class="twevfact">' + esc(tr(E, 'twinEvHasAlarm', { msg: a.message })) + (a.point ? ' · ' + esc(a.point) : '') + '</span>'; }).join('') +
          bare(u.alarms, u.faults).map(function (f) { return '<span class="twevfact">' + esc(tr(E, 'twinEvHasFault', { point: f })) + '</span>'; }).join('') + '</li>';
      }) + '</ul>' : '<p class="twnote">' + esc(tr(E, 'twinEvNoPossible')) + '</p>') +
      '<h4 data-k="impact">' + esc(tr(E, 'twinEvImpact')) + '</h4>' + (ev.impacts.length ? '<ul>' + cap(ev.impacts, function (x) {
        return '<li>' + goBtn(x.id, esc(label(x.id))) + ' <span>' + esc(relWord(x)) + '</span></li>';
      }) + '</ul>' : '<p class="twnote">' + esc(tr(E, 'twinEvNoImpact')) + '</p>') +
      '<p class="twnote">' + esc(tr(E, 'twinTraceNote')) + '</p></section>';
  }
  /* the reference's direct relationships into and out of a machine */
  function depsHtml(E, s, id) {
    var d = s.graph.direct(id);
    var row = function (other, l) { return '<li>' + goBtn(other, esc(label(other))) + ' <span>' + esc(tr(E, l.kind === 'stop' ? 'twinRelStop' : 'twinRelShift')) + '</span><em>' + esc(l.what) + '</em>' +
      (l.also || []).map(function (x) { return '<em class="twalso">' + esc(tr(E, 'twinRelAlso', { what: x.what })) + '</em>'; }).join('') + '</li>'; };
    return '<h3 class="twsub">' + esc(tr(E, 'twinDeps', { n: String(d.up.length) })) + '</h3>' + (d.up.length ? '<ul class="twrel">' + d.up.map(function (l) { return row(l.from, l); }).join('') + '</ul>' : '') +
      '<h3 class="twsub">' + esc(tr(E, 'twinAffects', { n: String(d.down.length) })) + '</h3>' + (d.down.length ? '<ul class="twrel">' + d.down.map(function (l) { return row(l.to, l); }).join('') + '</ul>' : '');
  }
  /* an energy meter's record among what the backend leaves out of its list: shown for checking, never as a mapping */
  function candHtml(E, s, id, connected) {
    var c = s.cands[id];
    if (!c || c.state === 'none') return '';
    if (c.state === 'several') return '<p class="twnote twwarn">' + esc(tr(E, 'twinCandSeveral', { name: MAP.NAME_ONLY[id] })) + '</p>';
    var a = c.asset, pts = (a.points || []).filter(function (p) { return p && p.navName; }).map(function (p) { return MAP.readPoint(p, { connected: connected, stale: s.stale }); });
    var rows = [[tr(E, 'twinFinName'), a.id], [tr(E, 'twinFinId'), a.finId || tr(E, 'twinNone')], [tr(E, 'twinFinType'), a.typeEn || tr(E, 'twinNone')],
      [tr(E, 'twinFinFloor'), a.floor || tr(E, 'twinNone')], [tr(E, 'twinCandTags'), (a.tags || []).join(', ') || tr(E, 'twinNone')]];
    return '<section class="twcand"><h3 class="twsub">' + esc(tr(E, 'twinCandT')) + '</h3><p class="twnote twwarn">' + esc(tr(E, 'twinCandNote')) + '</p>' +
      '<dl class="twdl">' + rows.map(function (x) { return '<div><dt>' + esc(x[0]) + '</dt><dd>' + esc(x[1]) + '</dd></div>'; }).join('') + '</dl>' +
      (pts.length ? '<table class="twpts">' + pts.map(function (p) { return '<tr data-st="' + p.state + '"><th>' + esc(p.name) + '</th><td>' + esc(pointShown(E, p)) + '</td></tr>'; }).join('') + '</table>' : '') + '</section>';
  }
  function panelHtml(E, s, connected) {
    var id = s.sel, res = s.res;
    if (!id) return equipNavHtml(E, s);
    var e = EQ[id], r = res[id], st = r.state, none = tr(E, 'twinNone');
    var rows = [[tr(E, 'twinType'), tr(E, 'twinT.' + e.type)], [tr(E, 'twinLevel'), tr(E, 'twinLv.' + e.level)]];
    if (!e.nonFin) {
      rows.push([tr(E, 'twinFinName'), r.fin || none], [tr(E, 'twinFinId'), r.finId || none], [tr(E, 'twinFinType'), r.type || none],
        [tr(E, 'twinFinFloor'), r.floor || none], [tr(E, 'twinBim'), r.bimId ? r.bimId + (r.bimShared ? ' · ' + tr(E, 'twinBimShared') : '') : none]);
    }
    if (e.feed) rows.push([tr(E, 'twinFeed'), label(e.feed)]);
    var why = (r.reason ? '<p class="twnote">' + esc(tr(E, 'twinWhy.' + r.reason, { fin: r.fin || r.candidate || '', id: id })) + '</p>' : '') +
      (r.provisional ? '<p class="twnote twwarn">' + esc(tr(E, 'twinProvNote', { fin: r.fin })) + '</p>' : '') +
      (r.floorDiffers ? '<p class="twnote twwarn">' + esc(tr(E, 'twinFloorDiffers', { floor: r.floor, want: MAP.LEVELS[e.level] })) + '</p>' : '');
    var tracing = s.trace && s.trace.seed === id;
    var actions = '<div class="twacts">' +
      '<button type="button" class="btnG btnSm" data-tw="trace" data-dir="up" aria-pressed="' + !!(tracing && s.trace.dir === 'up') + '">' + esc(tr(E, 'twinTraceUp')) + '</button>' +
      '<button type="button" class="btnG btnSm" data-tw="trace" data-dir="down" aria-pressed="' + !!(tracing && s.trace.dir === 'down') + '">' + esc(tr(E, 'twinTraceDown')) + '</button>' +
      (s.bim.by[id] && s.bim.by[id].state === 'verified' && host3d() ? '<button type="button" class="btnG btnSm" data-tw="bim">' + esc(tr(E, 'twinBimShow')) + '</button>' : '') +
      (s.trace ? '<button type="button" class="btnG btnSm" data-tw="untrace">' + esc(tr(E, 'twinTraceClear')) + '</button>' : '') + '</div>';
    return '<div class="twnav"><button type="button" class="btnG btnSm" data-tw="back">\u2190 ' + esc(tr(E, 'twinBack', { floor: tr(E, 'twinLv.' + lvOf(e)) })) + '</button>' +
      '<button type="button" class="btnG btnSm" data-tw="floors">' + esc(tr(E, 'twinAllFloors')) + '</button></div>' +
      '<div class="twdh"><div><h3 class="twdt">' + esc(e.label) + '</h3><code class="twdid">' + esc(e.nonFin ? tr(E, 'twinNotFinId') : id) + '</code></div>' +
      '<button type="button" class="btnG btnSm twclose" data-tw="close" aria-label="' + esc(tr(E, 'twinClose')) + '">✕</button></div>' +
      (st === 'mapped' ? '' : '<span class="twchip" data-fin="' + st + '">' + esc(tr(E, 'twinFin.' + st)) + '</span>') +
      (r.provisional ? ' <span class="twchip" data-prov="1">' + esc(tr(E, 'twinProv')) + '</span>' : '') +
      (MAP.RUNPTS[e.type] ? ' <span class="twchip" data-run="' + (s.run[id] || 'unknown') + '">' + esc(tr(E, 'twinRun.' + (s.run[id] || 'unknown'))) + '</span>' : '') + why +
      (s.picked && s.picked.id === id ? '<p class="twnote">' + esc(tr(E, 'twinPicked', { guid: s.picked.bimId })) + '</p>' : '') + actions +
      '<dl class="twdl">' + rows.map(function (x) { return '<div><dt>' + esc(x[0]) + '</dt><dd>' + esc(x[1]) + '</dd></div>'; }).join('') + '</dl>' +
      candHtml(E, s, id, connected) +
      alarmsHtml(E, s.alIdx.by[id] || []) + fddHtml(E, s.fdd[id] || []) + evidenceHtml(E, s, id) + depsHtml(E, s, id) +
      borrowedHtml(E, s, id, connected) + netsHtml(E, id) + '<p class="twnote">' + esc(tr(E, 'twinLayoutNote')) + '</p>';
  }
  /* readings of another FIN equipment shown on this machine's panel (the MDB shows PMU_Main's), each labelled with its source and never a measurement of this machine */
  function borrowedHtml(E, s, id, connected) {
    var b = MAP.BORROW[id]; if (!b) return '';
    var rows = MAP.borrowedRows(id, s.res._idx, connected, s.stale);
    return '<section class="twborrow" data-from="' + esc(b.from) + '"><h3 class="twsub">' + esc(tr(E, 'twinBorrowT', { src: b.from })) + '</h3><p class="twnote">' + esc(tr(E, 'twinBorrowNote', { src: b.from, id: id })) + '</p>' +
      '<table class="twpts">' + rows.map(function (p) {
        return '<tr data-st="' + p.state + '" data-src="' + esc(p.source) + '"><th>' + esc(p.name) + '<abbr class="twflag" title="' + esc(tr(E, 'twinBorrowSrc', { src: p.source })) + '">' + esc(p.source) + '</abbr></th><td>' + esc(pointShown(E, p)) + '</td></tr>';
      }).join('') + '</table></section>';
  }
  /* the systems of the pipes the reference ties to this machine (its `src`); no state of theirs is claimed */
  function netsHtml(E, id) {
    var sys = [];
    PIPES.concat(RISERS).forEach(function (p) { if (p.src === id && sys.indexOf(p.sys) === -1) sys.push(p.sys); });
    if (!sys.length) return '';
    sys.sort(function (a, b) { return Object.keys(SYSTEMS).indexOf(a) - Object.keys(SYSTEMS).indexOf(b); });
    return '<h3 class="twsub">' + esc(tr(E, 'twinNets')) + '</h3><ul class="twnets">' + sys.map(function (k) {
      return '<li><i class="twkey" style="background:' + SYSTEMS[k][0] + '"></i>' + esc(tr(E, 'twinSys.' + k)) + '</li>';
    }).join('') + '</ul><p class="twnote">' + esc(tr(E, 'twinNetsNote')) + '</p>';
  }

  /* the 3D view controls, on the stage: turn, tilt, drag-to-turn, reset (they sit at the top, clear of the notification toast and the Ask button at the bottom) */
  function camHtml(E) {
    var b = function (c, glyph, key) { return '<button type="button" class="twcamb" data-tw="cam" data-cam="' + c + '" title="' + esc(tr(E, key)) + '" aria-label="' + esc(tr(E, key)) + '">' + glyph + '</button>'; };
    return '<div class="twcam" role="group" aria-label="' + esc(tr(E, 'twinCam')) + '"><button type="button" class="twcamb twcamt" data-tw="cam" data-cam="toggle" aria-expanded="false" aria-label="' + esc(tr(E, 'twinCam')) + '">3D</button><span class="twcamh">' + esc(tr(E, 'twinCam')) + ' <b class="twcamr">0\u00b0 \u00b7 0\u00b0</b></span>' +
      '<span class="twcamrow">' + b('yawL', '\u27f2', 'twinCamL') + b('yawR', '\u27f3', 'twinCamR') + b('tiltU', '\u25b2', 'twinCamU') + b('tiltD', '\u25bc', 'twinCamD') + '</span>' +
      '<span class="twcamrow"><button type="button" class="twcamb twcamw" data-tw="cam" data-cam="mode" data-g="⇄" aria-pressed="false" aria-label="' + esc(tr(E, 'twinCamTurn')) + '" title="' + esc(tr(E, 'twinCamTurnTip')) + '">' + esc(tr(E, 'twinCamTurn')) + '</button>' +
      '<button type="button" class="twcamb twcamw" data-tw="cam" data-cam="reset" data-g="◎" aria-label="' + esc(tr(E, 'twinCamReset')) + '" title="' + esc(tr(E, 'twinCamReset')) + '">' + esc(tr(E, 'twinCamReset')) + '</button></span></div>';
  }

  function create(E) {
    var host = document.createElement('section'), ex = exLoad();
    host.className = 'twinview';
    host.setAttribute('aria-label', tr(E, 'twinTitle'));
    var floors = ['ALL'].concat(LEVELS).map(function (lv) {
      return '<button type="button" data-tw="level" data-lv="' + lv + '" aria-pressed="' + (lv === 'ALL') + '">' + esc(tr(E, 'twinBtn.' + lv)) + '</button>';
    }).join('');
    var layerChips = LAYERS.map(function (l) {
      var sw = Object.keys(SYSTEMS).filter(function (k) { return SYSTEMS[k][1] === l; }).map(function (k) { return '<i style="background:' + SYSTEMS[k][0] + '"></i>'; }).join('');
      return '<button type="button" data-tw="layer" data-layer="' + l + '" aria-pressed="' + !HIDDEN[l] + '"><span class="twsw">' + sw + '</span>' + esc(tr(E, 'twinLayer.' + l)) + '</button>';
    }).join('');
    host.innerHTML = '<div class="twbar"><h2 class="twttl">' + esc(tr(E, 'twinTitle')) + '</h2>' +
      '<div class="twseg" role="group" aria-label="' + esc(tr(E, 'twinFloors')) + '">' + floors + '</div>' +
      '<span class="twmeta"><span class="twstatus" role="status" hidden></span></span></div>' +
      '<div class="twlayers" role="group" aria-label="' + esc(tr(E, 'twinSystems')) + '">' + layerChips +
      '<span class="twex" role="group" aria-label="' + esc(tr(E, 'twinEx')) + '">' +
      '<label>' + esc(tr(E, 'twinExLabels')) + ' <select data-tw-ex="labels">' + ['auto', 'always', 'off'].map(function (v) {
        return '<option value="' + v + '"' + (ex.labels === v ? ' selected' : '') + '>' + esc(tr(E, 'twinExLbl.' + v)) + '</option>'; }).join('') + '</select></label></span></div>' +
      '<div class="twbody"><div class="twstage"><div class="twtrace" hidden><span class="twtracet"></span><button type="button" class="btnG btnSm" data-tw="untrace">' + esc(tr(E, 'twinTraceClear')) + '</button></div>' +
      camHtml(E) + '<div class="twlegwrap"><button type="button" class="btnG btnSm twlegbtn" data-tw="legend" aria-expanded="false" aria-controls="twlegpop">' + esc(tr(E, 'twinLegend')) + '</button>' +
      '<div class="twlegpop" id="twlegpop" role="region" aria-label="' + esc(tr(E, 'twinLegend')) + '" hidden>' + legendHtml(E) + '</div></div></div>' +
      '<aside class="twside"><div class="twtabs" role="tablist"><button type="button" role="tab" data-tw="tab" data-tab="alarms" aria-selected="true"></button>' +
      '<button type="button" role="tab" data-tw="tab" data-tab="equip" aria-selected="false">' + esc(tr(E, 'twinTabEquip')) + '</button>' +
      '</div><div class="twpane" aria-live="polite"></div></aside></div>';
    var stage = host.querySelector('.twstage');
    var svg = el('svg', { 'class': 'twsvg', role: 'img', 'aria-label': tr(E, 'twinTitle'), dir: 'ltr', 'data-level': 'ALL', 'data-labels': ex.labels, preserveAspectRatio: 'xMidYMid meet' }, stage);
    var s = { E: E, host: host, view: null, cam: 'fit', turnMode: false, tagKs: null, svg: svg, side: host.querySelector('.twpane'), tabs: host.querySelectorAll('.twtabs button'), tab: 'alarms', flr: null, ex: ex, flows: [], zones: [], run: {}, seen: {}, opened: Date.now(), lastUser: 0, status: host.querySelector('.twstatus'), sel: null, level: 'ALL', eqs: {}, tags: {}, pipes: {}, rot: {}, vb: null, home: null, panel: '',
      graph: MAP.graph(EQUIP), trace: null, traceBar: host.querySelector('.twtrace'), res: {}, alIdx: { by: {}, unlinked: [] }, fdd: {}, faults: {},
      bim: { by: {}, guid: {} }, cands: {}, stale: false, lit: null, picked: null };
    LAYERS.forEach(function (l) { if (HIDDEN[l]) svg.classList.add('hide-' + l); });
    setView(0, 1);   /* a view opens on the original camera */
    var T = function (k) { return tr(E, k); };
    scene(svg, T, s);
    if (STATE) STATE.set(host, s);
    LAST = host;
    camera(s);
    var refocus = function (sel) { var t = sel && host.querySelector('.twside ' + sel); if (t) try { t.focus({ preventScroll: true }); } catch (e) {} };
    host.addEventListener('click', function (ev) {
      var b = ev.target.closest && ev.target.closest('[data-tw]');
      if (!b) return;
      if (b.dataset.tw === 'level') setLevel(host, b.dataset.lv);
      else if (b.dataset.tw === 'close') select(host, null);
      else if (b.dataset.tw === 'layer') setLayer(host, b.dataset.layer, b.getAttribute('aria-pressed') !== 'true');
      else if (b.dataset.tw === 'trace') { trace(host, s.sel, b.dataset.dir); refocus('[data-tw="trace"][data-dir="' + b.dataset.dir + '"]'); }
      else if (b.dataset.tw === 'untrace') { trace(host, null); refocus(s.sel ? '[data-tw="trace"]' : null); }
      else if (b.dataset.tw === 'go') goTo(host, b.dataset.id);
      else if (b.dataset.tw === 'bim') showInModel(host, s.sel);
      else if (b.dataset.tw === 'legend') setLegend(host);
      else if (b.dataset.tw === 'floor') { s.flr = s.flr === b.dataset.lv ? null : b.dataset.lv; update(host, s.E); refocus('[data-tw="floor"][data-lv="' + b.dataset.lv + '"]'); }
      else if (b.dataset.tw === 'floors') { s.flr = null; s.side.scrollTop = 0; select(host, null); }
      else if (b.dataset.tw === 'back') { s.side.scrollTop = 0; select(host, null); }
      else if (b.dataset.tw === 'tab') { s.tab = b.dataset.tab; update(host, s.E); }
      else if (b.dataset.tw === 'cam') camAction(host, b.dataset.cam);
    });
    /* a click anywhere outside the open legend closes it; the listener removes itself once the view has left the page */
    var outside = function (ev) {
      if (!host.isConnected) return document.removeEventListener('pointerdown', outside, true);
      if (!ev.target.closest || !ev.target.closest('.twlegwrap')) setLegend(host, false);
    };
    document.addEventListener('pointerdown', outside, true);
    host.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') setLegend(host, false); });
    host.addEventListener('change', function (ev) {
      var k = ev.target.getAttribute && ev.target.getAttribute('data-tw-ex'); if (!k) return;
      if (k === 'fly') s.ex.fly = !!ev.target.checked;
      if (k === 'labels') { s.ex.labels = ev.target.value; svg.setAttribute('data-labels', s.ex.labels); tagLayout(s); }
      exSave(s.ex);
    });
    /* a person working in the view is not moved by Fly to new alarms */
    ['pointerdown', 'keydown', 'wheel'].forEach(function (t) { host.addEventListener(t, function () { s.lastUser = Date.now(); }, { passive: true }); });
    host.addEventListener('keydown', function (ev) {
      var g = ev.target.closest && ev.target.closest('.equip');
      if (g && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); ev.stopPropagation(); select(host, g.getAttribute('data-id')); }
      else if (ev.key === 'Escape' && s.trace) { ev.stopPropagation(); trace(host, null); refocus('[data-tw="trace"]'); }
      else if (ev.key === 'Escape' && s.sel) { ev.stopPropagation(); select(host, null); }
    });
    update(host, E);
    return host;
  }

  /* ── camera: pan, zoom, frame a level (viewBox only: nothing is redrawn); turn and tilt (the drawing is rebuilt at most once per frame, every state kept) ── */
  var ANCHOR = [30, 8, 33];   /* the building's centre: the point that stays put on screen when a zoomed-in view turns */
  var TARGET_PX = 10.5;       /* a label's text height on screen, whatever the zoom */
  function reducedMotion() { return typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  function applyVB(s) {
    var v = s.vb;
    s.svg.setAttribute('viewBox', v.x.toFixed(1) + ' ' + v.y.toFixed(1) + ' ' + v.w.toFixed(1) + ' ' + v.h.toFixed(1));
    var zoom = s.home ? s.home.w / v.w : 1;
    s.svg.setAttribute('data-zoom', zoom > 1.9 ? 'near' : zoom > 1.2 ? 'mid' : 'far');
    tagsSoon(s);
  }
  /* the stage's shape, kept from the resize observer: reading it from the page would force a layout of the whole drawing on every turn */
  function aspect(s) { if (s.sz) return s.sz.h / s.sz.w; var r = s.svg.getBoundingClientRect(); return r.width && r.height ? r.height / r.width : 0.6; }
  function frame(s) {
    var a = aspect(s);
    s.home = fit(worldBounds(), a, 10);
    s.vb = s.level === 'ALL' ? s.home : fit(levelBounds(s.level), a, 10);
    s.cam = 'fit';
    applyVB(s);
  }

  /* ── labels: a constant size on screen, and only as many as fit. Done on the label's own inner group, nothing about the machine moves. ──
     Priority when two would overlap: the selected one, one in a trace, one with an alarm or FD&D fault, a main machine, a small one. A label that would leave the
     view is left out (except the selected one). Only in Auto: Always shows every label, Off none. */
  function tagsSoon(s) {
    if (s.tagRaf || typeof requestAnimationFrame !== 'function') return;
    s.tagRaf = requestAnimationFrame(function () { s.tagRaf = 0; tagLayout(s); });
  }
  function tagLayout(s) {
    var r = s.sz || s.svg.getBoundingClientRect(), v = s.vb; if (!v || !r.width && !r.w || !(r.height || r.h)) return;
    var rw = r.w || r.width, rh = r.h || r.height;
    var k = clamp(TARGET_PX / (6.4 * Math.min(rw / v.w, rh / v.h)), 0.5, 6), ks = k.toFixed(3), ids = Object.keys(s.tags);
    if (s.tagKs !== ks) { s.tagKs = ks; ids.forEach(function (id) { s.tags[id].__tag.inn.setAttribute('transform', 'scale(' + ks + ')'); }); }
    var hide = function (t, h) { if (h) { if (t.getAttribute('data-hide') !== '1') t.setAttribute('data-hide', '1'); } else if (t.hasAttribute('data-hide')) t.removeAttribute('data-hide'); };
    if (s.ex.labels !== 'auto') { ids.forEach(function (id) { hide(s.tags[id], false); }); return; }
    var rank = function (id) { var t = s.tags[id]; return id === s.sel ? 0 : t.hasAttribute('data-tr') ? 1 : t.hasAttribute('data-al') ? 2 : t.__tag.minor ? 4 : 3; };
    var seen = ids.filter(function (id) { var d = s.tags[id].__tag; return (s.level === 'ALL' || d.level === s.level) && (!s.trace || id === s.sel || s.tags[id].hasAttribute('data-tr')); });
    ids.forEach(function (id) { if (seen.indexOf(id) === -1) hide(s.tags[id], false); });
    seen.sort(function (a, b) { return rank(a) - rank(b) || EQUIP.indexOf(EQ[a]) - EQUIP.indexOf(EQ[b]); });
    var placed = [], x0 = v.x + 2, y0 = v.y + 2, x1 = v.x + v.w - 2, y1 = v.y + v.h - 2, pad = 1.5 * k;
    seen.forEach(function (id) {
      var t = s.tags[id], d = t.__tag, hw = d.w * k / 2, c = [d.x - hw, d.y - 17 * k, d.x + hw, d.y];
      var inside = c[0] >= x0 && c[2] <= x1 && c[1] >= y0 && c[3] <= y1, hit = false;
      for (var i = 0; i < placed.length && !hit; i++) { var p = placed[i]; hit = c[0] < p[2] + pad && c[2] > p[0] - pad && c[1] < p[3] + pad && c[3] > p[1] - pad; }
      var show = id === s.sel || (inside && !hit);
      if (show) placed.push(c);
      hide(t, !show);
    });
  }

  /* ── turning: the drawing is built for one view, so a new view rebuilds it. What the person has set is carried over by snapshot, not recomputed: each machine's
     and label's state attributes, the selection, the trace marks, each pipe's flow state, the room patches, the keyboard focus. ── */
  var SNAP = ['data-fin', 'data-bim', 'data-al', 'data-run', 'data-tr'];
  function snapshot(s) {
    var o = { eqs: {}, pipes: {}, rot: {}, zones: s.zones.map(function (z) { return [z.poly.getAttribute('class'), z.tt.textContent]; }) };
    Object.keys(s.eqs).forEach(function (id) {
      var one = function (n) { var a = {}; SNAP.forEach(function (k) { if (n.hasAttribute(k)) a[k] = n.getAttribute(k); }); a.sel = n.classList.contains('sel'); return a; };
      o.eqs[id] = [one(s.eqs[id]), one(s.tags[id])];
    });
    Object.keys(s.eqs).forEach(function (id) { o.rot[id] = rotorsOf(s, id).map(function (r) { return r.getAttribute('data-spin'); }); });
    Object.keys(s.pipes).forEach(function (k) { o.pipes[k] = s.pipes[k].map(function (g) { return [g.getAttribute('data-flow'), g.classList.contains('conn'), g.classList.contains('tr-on')]; }); });
    return o;
  }
  function restore(s, o) {
    Object.keys(o.eqs).forEach(function (id) {
      [s.eqs[id], s.tags[id]].forEach(function (n, i) { var a = o.eqs[id][i]; SNAP.forEach(function (k) { if (k in a) n.setAttribute(k, a[k]); else n.removeAttribute(k); }); n.classList.toggle('sel', a.sel); });
    });
    Object.keys(o.pipes).forEach(function (k) { (s.pipes[k] || []).forEach(function (g, i) { var a = o.pipes[k][i]; if (!a) return; g.setAttribute('data-flow', a[0]); g.classList.toggle('conn', a[1]); g.classList.toggle('tr-on', a[2]); }); });
    Object.keys(o.rot).forEach(function (id) { rotorsOf(s, id).forEach(function (r, i) { if (o.rot[id][i]) r.setAttribute('data-spin', o.rot[id][i]); }); });
    s.zones.forEach(function (z, i) { if (o.zones[i]) { z.poly.setAttribute('class', o.zones[i][0]); z.tt.textContent = o.zones[i][1]; } });
  }
  function rebuild(s) {
    var snap = snapshot(s), ae = document.activeElement, fe = ae && s.svg.contains(ae) && ae.closest ? ae.closest('.equip') : null, fid = fe ? fe.getAttribute('data-id') : null;
    s.eqs = {}; s.tags = {}; s.pipes = {}; s.flows = []; s.zones = []; s.rot = {}; s.tagKs = null;
    /* built apart from the page and put in with one replace: the browser styles and paints the new drawing once, not as it is made */
    var fresh = document.createElementNS(NS, 'svg');
    scene(fresh, function (k) { return tr(s.E, k); }, s);
    if (s.svg.replaceChildren) s.svg.replaceChildren.apply(s.svg, [].slice.call(fresh.childNodes));
    else { while (s.svg.firstChild) s.svg.removeChild(s.svg.firstChild); while (fresh.firstChild) s.svg.appendChild(fresh.firstChild); }
    restore(s, snap);
    if (fid && s.eqs[fid]) try { s.eqs[fid].focus({ preventScroll: true }); } catch (e) {}
    tagsSoon(s);
  }
  /* the world point that stays where it is on screen when a zoomed-in view turns: the selected machine, else the floor in view, else the building's centre */
  function anchorOf(s) {
    var e = s.sel && EQ[s.sel];
    if (e) return [e.x + e.w / 2, e.y + e.d / 2, e.z + e.h / 2];
    return s.level === 'ALL' ? ANCHOR : [30, 8, LZ[s.level] + 3];
  }
  function camLabel(s) {
    var b = s.host && s.host.querySelector('.twcamr'); if (b) b.textContent = Math.round(-VIEW.yaw) + '° · ' + Math.round((VIEW.tilt - 1) * 40) + '°';
    var set = function (sel, off) { var n = s.host && s.host.querySelector(sel); if (n) n.disabled = off; };
    set('[data-cam="yawL"]', VIEW.yaw >= YAW_MAX - 1e-6); set('[data-cam="yawR"]', VIEW.yaw <= YAW_MIN + 1e-6);
    set('[data-cam="tiltU"]', VIEW.tilt >= TILT_MAX - 1e-6); set('[data-cam="tiltD"]', VIEW.tilt <= TILT_MIN + 1e-6);
  }
  /* Turn to yaw, tilt. A view that is framed (the building, or a floor) is framed again for the new shape, so the whole of it stays centred and inside the view;
     a view the person has zoomed or moved keeps its scale and the anchor point where it was on screen. Floor, selection, layers and trace are not touched. */
  function turn(host, yaw, tilt) {
    var s = host && STATE && STATE.get(host); if (!s) return;
    yaw = clamp(yaw, YAW_MIN, YAW_MAX); tilt = clamp(tilt, TILT_MIN, TILT_MAX);
    if (Math.abs(yaw - VIEW.yaw) < 1e-4 && Math.abs(tilt - VIEW.tilt) < 1e-5) return;
    var an = anchorOf(s), b = P(an[0], an[1], an[2]), a0 = aspect(s);
    var framed = s.cam === 'fit' || s.vb.w >= s.home.w * 0.97;
    setView(yaw, tilt);
    rebuild(s);
    s.home = fit(worldBounds(), a0, 10);
    if (framed) { s.vb = s.level === 'ALL' ? s.home : fit(levelBounds(s.level), a0, 10); s.cam = 'fit'; }
    else { var a = P(an[0], an[1], an[2]); s.vb = { x: s.vb.x + a[0] - b[0], y: s.vb.y + a[1] - b[1], w: s.vb.w, h: s.vb.h }; }
    applyVB(s); tagLayout(s); camLabel(s);   /* labels sized and decluttered in the same frame as the new drawing, not a frame later */
  }
  function turnAnim(host, yaw, tilt, ms) {
    var s = host && STATE && STATE.get(host); if (!s) return;
    yaw = clamp(yaw, YAW_MIN, YAW_MAX); tilt = clamp(tilt, TILT_MIN, TILT_MAX);
    var id = s.animId = (s.animId || 0) + 1, y0 = VIEW.yaw, t0 = VIEW.tilt;
    if (reducedMotion() || !ms || typeof requestAnimationFrame !== 'function') { turn(host, yaw, tilt); return; }
    var st = null;
    (function step(now) {
      if (s.animId !== id) return;
      if (st === null) st = now;
      var k = Math.min(1, (now - st) / ms), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      turn(host, y0 + (yaw - y0) * e, t0 + (tilt - t0) * e);
      if (k < 1) requestAnimationFrame(step);
    })(typeof performance !== 'undefined' ? performance.now() : 0);
  }
  /* dragging turns the building: the movement is gathered and applied once per frame, never per pointer event */
  function turnDrag(host, dYaw, dTilt) {
    var s = STATE.get(host); s.animId = (s.animId || 0) + 1;
    var q = s.turnQ = s.turnQ || { yaw: VIEW.yaw, tilt: VIEW.tilt };
    q.yaw = clamp(q.yaw + dYaw, YAW_MIN, YAW_MAX); q.tilt = clamp(q.tilt + dTilt, TILT_MIN, TILT_MAX);
    if (s.turnRaf) return;
    var go = function () { s.turnRaf = 0; var t = s.turnQ; s.turnQ = null; if (t) turn(host, t.yaw, t.tilt); };
    s.turnRaf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(go) : (go(), 0);
  }
  /* the original view and the framing of the floor in view; the floor, selection, layers and trace stay as they are */
  function resetView(host) {
    var s = host && STATE && STATE.get(host); if (!s) return;
    s.cam = 'fit';
    if (!reducedMotion() && typeof requestAnimationFrame === 'function') turnAnim(host, 0, 1, 320); else turn(host, 0, 1);
    if (Math.abs(VIEW.yaw) < 1e-4 && Math.abs(VIEW.tilt - 1) < 1e-5) { frame(s); camLabel(s); }
  }
  function camAction(host, what) {
    var s = host && STATE && STATE.get(host); if (!s) return;
    if (what === 'yawL') turnAnim(host, VIEW.yaw + 15, VIEW.tilt, 260);
    else if (what === 'yawR') turnAnim(host, VIEW.yaw - 15, VIEW.tilt, 260);
    else if (what === 'tiltU') turnAnim(host, VIEW.yaw, VIEW.tilt + 0.2, 260);
    else if (what === 'tiltD') turnAnim(host, VIEW.yaw, VIEW.tilt - 0.2, 260);
    else if (what === 'reset') resetView(host);
    else if (what === 'toggle') { var c = host.querySelector('.twcam'), on = c.getAttribute('data-open') !== '1'; if (on) c.setAttribute('data-open', '1'); else c.removeAttribute('data-open'); var t = host.querySelector('[data-cam="toggle"]'); if (t) t.setAttribute('aria-expanded', String(on)); }
    else if (what === 'mode') { s.turnMode = !s.turnMode; s.svg.classList.toggle('turnmode', s.turnMode); var b = host.querySelector('[data-cam="mode"]'); if (b) b.setAttribute('aria-pressed', String(s.turnMode)); }
  }

  function camera(s) {
    var svg = s.svg, pts = {}, n = 0, moved = 0, downId = null, turning = false;
    frame(s);
    function toW(cx, cy) { var r = svg.getBoundingClientRect(); return { x: s.vb.x + (cx - r.left) / r.width * s.vb.w, y: s.vb.y + (cy - r.top) / r.height * s.vb.h }; }
    function zoomAt(p, f) {
      var nw = Math.max(160, Math.min(s.vb.w * f, s.home.w * 2.2)); f = nw / s.vb.w;
      s.vb = { x: p.x - (p.x - s.vb.x) * f, y: p.y - (p.y - s.vb.y) * f, w: s.vb.w * f, h: s.vb.h * f };
      s.cam = 'free';
      applyVB(s);
    }
    svg.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    svg.addEventListener('wheel', function (e) { e.preventDefault(); zoomAt(toW(e.clientX, e.clientY), Math.exp(e.deltaY * 0.0015)); }, { passive: false });
    svg.addEventListener('pointerdown', function (e) {
      pts[e.pointerId] = { x: e.clientX, y: e.clientY }; n++;
      if (n === 1) { var q = e.target.closest && e.target.closest('.equip'); moved = 0; downId = q ? q.getAttribute('data-id') : null; turning = !!(s.turnMode || e.button === 2 || e.shiftKey || e.altKey); }
      try { svg.setPointerCapture(e.pointerId); } catch (x) {}
    });
    svg.addEventListener('pointermove', function (e) {
      var pv = pts[e.pointerId]; if (!pv) return;
      var cu = { x: e.clientX, y: e.clientY }, r = svg.getBoundingClientRect();
      if (n === 1) {
        var dx = cu.x - pv.x, dy = cu.y - pv.y; moved += Math.abs(dx) + Math.abs(dy);
        if (moved > 4 && r.width) {
          if (turning) turnDrag(svg.closest('.twinview'), -dx * 0.22, dy * 0.004);
          else { s.vb.x -= dx / r.width * s.vb.w; s.vb.y -= dy / r.height * s.vb.h; s.cam = 'free'; applyVB(s); }
        }
      } else if (n === 2) {
        var oid = Object.keys(pts).filter(function (k) { return k !== String(e.pointerId); })[0], o = pts[oid];
        var d0 = Math.hypot(pv.x - o.x, pv.y - o.y), d1 = Math.hypot(cu.x - o.x, cu.y - o.y);
        if (d0 && d1) zoomAt(toW((cu.x + o.x) / 2, (cu.y + o.y) / 2), d0 / d1);
        moved += 20;
      }
      pts[e.pointerId] = cu;
    });
    function end(e) {
      if (!pts[e.pointerId]) return;
      delete pts[e.pointerId]; n--;
      /* a tap (not a drag) on a machine selects it; on empty ground it clears the selection */
      if (!n && e.type === 'pointerup' && moved <= 4) select(svg.closest('.twinview'), downId);
    }
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', end);
    /* the view is built before it is on screen: frame it once it has a size, and keep the frame when the stage is resized */
    if (typeof ResizeObserver === 'function') {
      var last = 0;
      new ResizeObserver(function (entries) {
        var cr = entries && entries[0] && entries[0].contentRect; if (cr && cr.width && cr.height) s.sz = { w: cr.width, h: cr.height };
        var a = aspect(s); if (!a || Math.abs(a - last) < 1e-3) { if (a) tagsSoon(s); return; }
        if (!last) frame(s);
        else if (s.cam === 'fit') frame(s);
        else { var cy = s.vb.y + s.vb.h / 2; s.vb.h = s.vb.w * a; s.vb.y = cy - s.vb.h / 2; s.home = fit(worldBounds(), a, 10); applyVB(s); }
        last = a;
      }).observe(svg);
    }
  }
  function setLevel(host, lv) {
    if (lv === 'GF') lv = 'L1';   /* V1's ground-floor key; its old L1/L2 cannot be told from V2's, see MAP.LEGACY_LEVELS */
    var s = STATE && STATE.get(host); if (!s || (lv !== 'ALL' && LEVELS.indexOf(lv) === -1)) return;
    s.level = lv;
    s.svg.setAttribute('data-level', lv);
    [].forEach.call(host.querySelectorAll('[data-tw="level"]'), function (b) { b.setAttribute('aria-pressed', String(b.dataset.lv === lv)); });
    frame(s);
  }
  function setLegend(host, on) {
    var b = host.querySelector('.twlegbtn'), p = host.querySelector('.twlegpop'); if (!b || !p) return;
    if (on == null) on = p.hidden;
    p.hidden = !on; b.setAttribute('aria-expanded', String(!!on));
  }
  function select(host, id) {
    var s = host && STATE && STATE.get(host); if (!s) return;
    s.sel = id && EQ[id] ? id : null;
    if (s.sel) { s.tab = 'equip'; s.flr = lvOf(EQ[s.sel]); }
    if (s.picked && s.picked.id !== s.sel) s.picked = null;
    if (s.trace && s.trace.seed !== s.sel) trace(host, null, true);
    Object.keys(s.eqs).forEach(function (k) { s.eqs[k].classList.toggle('sel', k === s.sel); s.tags[k].classList.toggle('sel', k === s.sel); });
    /* its own pipes stand out, the rest step back; only class changes, and only on a selection (never on a data update) */
    Object.keys(s.pipes).forEach(function (k) { s.pipes[k].forEach(function (g) { g.classList.toggle('conn', k === s.sel); }); });
    s.svg.setAttribute('data-conn', s.sel && s.pipes[s.sel] ? '1' : '0');
    tagsSoon(s);
    update(host, s.E);
  }
  /* from an alarm or a relationship: select the machine and show its floor */
  function goTo(host, id) {
    var s = host && STATE && STATE.get(host); if (!s || !EQ[id]) return;
    setLevel(host, EQ[id].level === 'EXT' ? 'L1' : EQ[id].level);
    select(host, id);
    var g = s.eqs[id]; if (g && g.focus) try { g.focus({ preventScroll: true }); } catch (e) {}
  }
  /* Trace the reference relationships from a machine, upstream or downstream, over all four floors (the whole building is shown when the trace leaves the
     floor in view). Only classes change: machines, tags and pipes in the trace stand out, the rest step back. dir null clears. */
  function trace(host, seed, dir, quiet) {
    var s = host && STATE && STATE.get(host); if (!s) return;
    var on = {}, all = Object.keys(s.eqs);
    if (seed && EQ[seed] && (dir === 'up' || dir === 'down')) {
      var rel = dir === 'down' ? s.graph.downstream(seed) : s.graph.upstream(seed);
      Object.keys(rel).forEach(function (k) { if (k !== seed) on[k] = dir + '-' + (rel[k].state === 'fail' ? 'stop' : 'shift') + (rel[k].weak ? '-weak' : ''); });
      on[seed] = 'src';
      s.trace = { seed: seed, dir: dir };
    } else { s.trace = null; }
    all.forEach(function (k) {
      var t = on[k] || null;
      if (t) { s.eqs[k].setAttribute('data-tr', t); s.tags[k].setAttribute('data-tr', t); } else { s.eqs[k].removeAttribute('data-tr'); s.tags[k].removeAttribute('data-tr'); }
    });
    Object.keys(s.pipes).forEach(function (k) { s.pipes[k].forEach(function (g) { g.classList.toggle('tr-on', !!on[k]); }); });
    s.svg.classList.toggle('tracing', !!s.trace);
    s.svg.setAttribute('data-trace', s.trace ? s.trace.dir : '');
    if (s.trace) {
      var levels = {}; Object.keys(on).forEach(function (k) { levels[EQ[k].level === 'EXT' ? 'L1' : EQ[k].level] = 1; });
      if (s.level !== 'ALL' && Object.keys(levels).length > 1) setLevel(host, 'ALL');
      var n = { stop: 0, shift: 0 }; Object.keys(on).forEach(function (k) { if (k !== seed) n[/-stop/.test(on[k]) ? 'stop' : 'shift']++; });
      s.traceBar.querySelector('.twtracet').textContent = tr(s.E, dir === 'down' ? 'twinTracingDown' : 'twinTracingUp', { name: label(seed), stop: String(n.stop), shift: String(n.shift) });
    }
    s.traceBar.hidden = !s.trace;
    tagsSoon(s);
    if (!quiet) update(host, s.E);
  }
  /* Show the selected machine in the Studio's BIM model, the way Locate in 3D does (app.js locate): the Overview's model (on a phone or tablet its
     full-screen model, whose Back returns here), the camera on the verified GlobalId, the element highlighted, and its storey alone when a model storey
     carries the FIN floor's own name. Only for a verified GlobalId. */
  function showInModel(host, id) {
    var s = host && STATE && STATE.get(host), b = s && s.bim.by[id]; if (!b || b.state !== 'verified') return false;
    var E = s.E, from = { pageId: E.state.pageId, module: E.state.module, sub: E.state.sub };
    var lv = s.res[id] && s.res[id].floor ? MAP.modelLevel(s.res[id].floor, call3d('listLevels')) : null;
    E.go(E.overviewId ? E.overviewId() : 'marsa-overview', 'overview', null);
    /* the way back is stored here, not guessed: the model's "Back to Schematic" (app.js bimBack) returns to this page, whose view is kept */
    E.state.bimBack = { from: from, labelKey: 'twinBackSchematic' };
    if (E.stacked && E.stacked()) E.state.modelFs = true;
    if (lv && E.state.dock) E.state.dock.level = lv.id;
    E.set({});
    var eng = E.engine, n = 0;
    (function go() {
      if (!(eng && (!eng.ready || eng.ready()))) { if (n++ < 60) setTimeout(go, 100); return; }
      if (lv && eng.isolateLevel) eng.isolateLevel(lv.id);
      if (eng.flyToGid) eng.flyToGid(b.guid);
      if (eng.highlightGid) eng.highlightGid(b.guid);
    })();
    return true;
  }
  /* the twin's own highlight in the model ends when the Live Twin is left (app.js) */
  function release(host) {
    var s = host && STATE && STATE.get(host); if (!s || !s.lit) return;
    s.lit = null; call3d('clearHighlight');
  }
  /* show or hide one system layer: a class on the drawing, nothing redrawn. Kept for the session (a new language rebuilds the view with it). */
  function setLayer(host, layer, on) {
    var s = host && STATE && STATE.get(host); if (!s || LAYERS.indexOf(layer) === -1) return;
    HIDDEN[layer] = !on;
    s.svg.classList.toggle('hide-' + layer, !on);
    [].forEach.call(host.querySelectorAll('[data-tw="layer"][data-layer="' + layer + '"]'), function (b) { b.setAttribute('aria-pressed', String(!!on)); });
  }

  /* only what changed is written: the dashboard calls this on every render, and the view is kept between renders */
  function update(host, E) {
    var s = host && STATE && STATE.get(host); if (!s) return null;
    s.E = E;
    var cur = current(E), connected = cur.connected, res = cur.res, found = 0, fin = 0;
    s.bim = cur.bim; s.stale = cur.stale; s.cands = {};
    EQUIP.forEach(function (e) { if (MAP.NAME_ONLY[e.id]) s.cands[e.id] = MAP.candidateFor(e, E && E.data && E.data.finExcluded); });
    if (PICK) { var pk = PICK; PICK = null; if (EQ[pk.id]) { s.sel = null; goTo(host, pk.id); s.picked = pk; } }
    EQUIP.forEach(function (e) {
      var st = res[e.id].state;
      if (res[e.id].fin) { fin++; if (st === 'mapped' || st === 'stale') found++; }
      if (s.eqs[e.id].getAttribute('data-fin') !== st) { s.eqs[e.id].setAttribute('data-fin', st); s.tags[e.id].setAttribute('data-fin', st); }
    });
    var stTxt = !connected ? tr(E, 'twinFin.offline') : s.stale ? tr(E, 'twinStaleFeed', { time: String(E.data.equipmentAt).replace('T', ' ').slice(0, 16) })
      : tr(E, 'twinFound', { n: String(found), total: String(fin) });
    if (s.status.textContent !== stTxt) s.status.textContent = stTxt;
    s.status.setAttribute('data-st', !connected ? 'off' : s.stale ? 'stale' : found ? 'live' : 'none');
    EQUIP.forEach(function (e) { var b = s.bim.by[e.id].state; if (s.eqs[e.id].getAttribute('data-bim') !== b) s.eqs[e.id].setAttribute('data-bim', b); });
    /* the selection's BIM element is highlighted in the Studio's model when, and only when, its GlobalId is verified */
    var want = s.sel && s.bim.by[s.sel] && s.bim.by[s.sel].state === 'verified' ? s.bim.by[s.sel].guid : null;
    if (want !== s.lit) { s.lit = want; if (want) call3d('highlightAsset', want); else call3d('clearHighlight'); }
    var alarms = E && E.data && E.data.alarms;
    s.res = res; s.alIdx = MAP.alarmIndex(res, alarms); s.fdd = {}; s.faults = {};
    EQUIP.forEach(function (e) {
      var rows = MAP.fddRows(res[e.id], alarms, connected);
      if (rows.length) { s.fdd[e.id] = rows; var f = rows.filter(function (x) { return x.status === 'fault'; }).map(function (x) { return x.name; }); if (f.length) s.faults[e.id] = f; }
      var flag = s.alIdx.by[e.id] ? 'alarm' : s.faults[e.id] ? 'fault' : null;
      if (s.eqs[e.id].getAttribute('data-al') !== flag) { if (flag) { s.eqs[e.id].setAttribute('data-al', flag); s.tags[e.id].setAttribute('data-al', flag); } else { s.eqs[e.id].removeAttribute('data-al'); s.tags[e.id].removeAttribute('data-al'); } }
    });
    s.flows.forEach(function (f) { var st = MAP.flowState(f.rule, res, connected); if (f.g.getAttribute('data-flow') !== st) f.g.setAttribute('data-flow', st); });
    EQUIP.forEach(function (e) {
      var rs = MAP.runState(e.id, e.type, res, connected); s.run[e.id] = rs;
      if (s.eqs[e.id].getAttribute('data-run') !== rs) { var tg = s.tags[e.id]; if (rs) { s.eqs[e.id].setAttribute('data-run', rs); tg.setAttribute('data-run', rs); } else { s.eqs[e.id].removeAttribute('data-run'); tg.removeAttribute('data-run'); } }
      /* each rotor turns only while the status that drives it says on: the machine's own, or its part's (a pump of a set, the heat wheel) */
      rotorsOf(s, e.id).forEach(function (r) { var role = r.getAttribute('data-role'), st = role ? MAP.rotorState(e.id, e.type, role, res, connected) : rs, v = st === 'on' ? 'on' : null; if (r.getAttribute('data-spin') !== v) { if (v) r.setAttribute('data-spin', v); else r.removeAttribute('data-spin'); } });
    });
    /* room temperature under each ceiling unit, as that unit reports it; without a live setpoint the patch is tinted neutral (no judgement is made) */
    s.zones.forEach(function (z) {
      var r = res[z.zn.src], v = MAP.liveReading(r, z.zn.pt), sp = z.zn.sp ? MAP.liveReading(r, z.zn.sp) : null, cls = 'zone z-none', txt = '';
      if (v && v.type === 'number' && isFinite(v.value)) {
        if (v.value < 5 || v.value > 45) { cls = 'zone z-bad'; txt = tr(E, 'twinZoneBad'); }
        else {
          txt = v.value.toFixed(1) + '\u00b0C';
          if (sp && sp.type === 'number') { var dv = v.value - sp.value; cls = 'zone ' + (dv <= -1.5 ? 'z-cold' : dv <= 1.5 ? 'z-ok' : dv <= 2.5 ? 'z-warm' : 'z-hot'); }
          else cls = 'zone z-temp';
        }
      }
      if (z.poly.getAttribute('class') !== cls) z.poly.setAttribute('class', cls);
      if (z.tt.textContent !== txt) z.tt.textContent = txt;
    });
    /* Fly to new alarms: an alarm raised after the view opened (by its own time; none without one), not flown to before, takes the view to its machine
       once; not while the person is working on another machine or tracing, nor within 15 s of their last action */
    var act = {}, fly = null;
    Object.keys(s.alIdx.by).forEach(function (id) { s.alIdx.by[id].forEach(function (a) {
      act[a.id] = id;
      if (!fly && !s.seen[a.id] && a.at != null && a.at > s.opened) fly = id;
      s.seen[a.id] = 1;
    }); });
    if (fly && !(s.ex.fly && !s.trace && (!s.sel || s.sel === fly) && Date.now() - s.lastUser > 15000)) fly = null;
    var nAct = Object.keys(act).length + s.alIdx.unlinked.length, tabTxt = tr(E, 'twinTabAlarms', { n: String(nAct) });
    [].forEach.call(s.tabs, function (b) { b.setAttribute('aria-selected', String(b.dataset.tab === s.tab)); });
    if (s.tabs[0].textContent !== tabTxt) s.tabs[0].textContent = tabTxt;
    var html = s.tab === 'alarms' ? alarmListHtml(E, s) + clearedHtml(E, s) : panelHtml(E, s, connected);
    if (html !== s.panel) { s.side.innerHTML = html; s.panel = html; }
    if (fly) goTo(host, fly);
    host.setAttribute('data-sel', s.sel ? '1' : '0');
    tagsSoon(s);
    return { found: found, total: fin };
  }

  return { LZ: LZ, LEVELS: LEVELS, EQUIP: EQUIP, PIPES: PIPES, SYSTEMS: SYSTEMS, LAYERS: LAYERS, P: P, worldBounds: worldBounds, levelBounds: levelBounds, fit: fit, RISERS: RISERS, create: create, update: update, setLevel: setLevel, setLayer: setLayer, select: select, trace: trace, goTo: goTo,
    showInModel: showInModel, release: release, machineForBim: machineForBim,
    setView: setView, view: function (host, yaw, tilt) { turn(host, yaw, tilt); }, getView: function () { return { yaw: VIEW.yaw, tilt: VIEW.tilt }; }, resetView: resetView, tagLayout: function (host) { var s = host && STATE && STATE.get(host); if (s) tagLayout(s); },
    YAW: [YAW_MIN, YAW_MAX], TILT: [TILT_MIN, TILT_MAX] };
});
