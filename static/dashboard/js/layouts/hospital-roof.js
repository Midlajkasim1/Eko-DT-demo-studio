/* Eko Hospital roof plant as a BMS-style HVAC graphic: cooling tower, condenser water pumps, chiller, chilled water pumps, boiler and BTU
   meter, joined by chilled-water, condenser-water and hot-water pipework, drawn after the Hospital's FIN roof screen. Only for a project whose
   Hospital graphics are on (INJECTED_PROJECT_CONFIG.hospitalHvac, set by the Studio for the ekoHospital FIN project); opened from the Assets register.

   WHERE EVERY STATE COMES FROM. The dashboard's own live equipment feed (EKO.data.assets, filled by the same FIN polling as every asset panel and
   re-read on every 'dashboard-data' event). A reading counts only when ALL of these hold, otherwise the equipment stays unknown/unmapped:
     1. the slot (equipment) has been CONFIRMED in SLOTS below: `equip` is that FIN equipment's asset id, not a guess;
     2. that asset is in the live feed, is not stale, and FIN is connected (DashboardData.connected is not false);
     3. one of the point's `names` equals a point name of THAT asset (folded: lower case, letters and digits only; never a partial or similar name,
        never a point of another equipment);
     4. the point is reporting, has a value, and the value fits its kind (a temperature is a number in range, a status is text).
   Nothing is invented: a fan turns only while its own run-status point says On, a pump's impeller only while that pump's run status says On, and a
   pipe flows only while the pumps feeding it say so (or, for chilled water, while the BTU meter's measured flow is above zero).
   Hot-water flow: the original FIN graphic has no hot-water pump, so the hot loop follows the boiler's own run status (the only status it has);
   this is an inference from that one point and is stated here so it can be changed when a hot-water pump point is mapped.

   MAPPING STATUS. The point names were read from a photo of the FIN screen, which is not sharp enough to be certain of every letter; they are
   expectations to check against FIN, not verified references. No FIN equipment record or point list for the roof is in this repository, so every
   slot starts with `equip: null` (unmapped). To confirm a slot: open the equipment's asset panel, check its point names against `names`, then
   set `equip` to its asset id (and correct `names` as needed). Selecting an equipment in the graphic lists what it still needs. */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.document) root.EKO_ROOF = api;
})(typeof window !== 'undefined' ? window : null, function (root) {
  'use strict';

  var VB = { w: 1280, h: 780 };

  /* ── mapping: slot (equipment) → asset id ── equip: the FIN equipment's asset id once confirmed, else null. */
  var SLOTS = [
    { id: 'coolingTower',   label: 'Cooling tower',         equip: null },
    { id: 'condenserPumps', label: 'Condenser water pumps', equip: null },
    { id: 'chiller',        label: 'Chiller',               equip: null },
    { id: 'chilledPumps',   label: 'Chilled water pumps',   equip: null },
    { id: 'boiler',         label: 'Boiler',                equip: null },
    { id: 'btu',            label: 'BTU meter',             equip: null }
  ];

  /* ── the points each equipment is expected to report. kind decides what a valid value is:
     temp: number -50..200 · pct: number 0..100 · num: any finite number · status: run status text · text: any text.
     role orders the details panel. `read: 'uncertain'`: a name that could not be read with confidence from the photo. */
  var ITEMS = [
    { id: 'ctFanRun',    slot: 'coolingTower',   role: 'run',    label: 'Fan status',                  cap: 'FANRUNSTATUS',    names: ['fanrunstatus'],    kind: 'status' },
    { id: 'ctFanSpeed',  slot: 'coolingTower',   role: 'speed',  label: 'Fan speed',                   cap: 'FANSPEED',        names: ['fanspeed'],        kind: 'pct',  unit: ' %' },
    { id: 'ctCwEnter',   slot: 'coolingTower',   role: 'temp',   label: 'Entering water temperature',  cap: 'CWENTERINGTEMP',  names: ['cwenteringtemp'],  kind: 'temp', unit: ' °C' },
    { id: 'ctCwLeave',   slot: 'coolingTower',   role: 'temp',   label: 'Leaving water temperature',   cap: 'CWLEAVINGTEMP',   names: ['cwleavingtemp'],   kind: 'temp', unit: ' °C' },
    { id: 'ctCwLeaveSp', slot: 'coolingTower',   role: 'sp',     label: 'Leaving water set-point',     cap: 'CWLEAVINGTEMPSP', names: ['cwleavingtempsp'], kind: 'temp', unit: ' °C', read: 'uncertain' },
    { id: 'ctFanEnable', slot: 'coolingTower',   role: 'cmd',    label: 'Fan command',                 cap: 'FANENABLECMD',    names: ['fanenablecmd'],    kind: 'text' },
    { id: 'ctHoa',       slot: 'coolingTower',   role: 'mode',   label: 'Hand-Off-Auto',               cap: 'HOA',             names: ['hoa'],             kind: 'text' },
    { id: 'ctFanTrip',   slot: 'coolingTower',   role: 'alarm',  label: 'Fan trip',                    cap: 'FANTRIP',         names: ['fantrip'],         kind: 'text' },

    { id: 'cpP1Run',     slot: 'condenserPumps', role: 'run',    label: 'Pump 1 status',               cap: 'PUMP1RUNSTATUS',  names: ['pump1runstatus'],  kind: 'status' },
    { id: 'cpP2Run',     slot: 'condenserPumps', role: 'run',    label: 'Pump 2 status',               cap: 'PUMP2RUNSTATUS',  names: ['pump2runstatus'],  kind: 'status' },
    { id: 'cpP1Speed',   slot: 'condenserPumps', role: 'speed',  label: 'Pump 1 speed',                cap: 'PUMP1SPEED',      names: ['pump1speed'],      kind: 'pct',  unit: ' %' },
    { id: 'cpP2Speed',   slot: 'condenserPumps', role: 'speed',  label: 'Pump 2 speed',                cap: 'PUMP2SPEED',      names: ['pump2speed'],      kind: 'pct',  unit: ' %' },
    { id: 'cpP1Cmd',     slot: 'condenserPumps', role: 'cmd',    label: 'Pump 1 command',              cap: 'PUMP1CMD',        names: ['pump1cmd'],        kind: 'text' },
    { id: 'cpP2Cmd',     slot: 'condenserPumps', role: 'cmd',    label: 'Pump 2 command',              cap: 'PUMP2CMD',        names: ['pump2cmd'],        kind: 'text' },
    { id: 'cpP1Trip',    slot: 'condenserPumps', role: 'alarm',  label: 'Pump 1 trip',                 cap: 'PUMP1TRIP',       names: ['pump1trip'],       kind: 'text' },
    { id: 'cpP2Trip',    slot: 'condenserPumps', role: 'alarm',  label: 'Pump 2 trip',                 cap: 'PUMP2TRIP',       names: ['pump2trip'],       kind: 'text' },

    { id: 'chRun',       slot: 'chiller',        role: 'run',    label: 'Chiller status',              cap: 'RUNSTATUS',       names: ['runstatus'],       kind: 'status' },
    { id: 'chChwsTemp',  slot: 'chiller',        role: 'temp',   label: 'Chilled water supply temperature', cap: 'CHWSTEMP',   names: ['chwstemp'],        kind: 'temp', unit: ' °C', read: 'uncertain' },
    { id: 'chChwrTemp',  slot: 'chiller',        role: 'temp',   label: 'Chilled water return temperature', cap: 'CHWRTEMP',   names: ['chwrtemp'],        kind: 'temp', unit: ' °C', read: 'uncertain' },
    { id: 'chHours',     slot: 'chiller',        role: 'hours',  label: 'Operating hours',             cap: 'OPERATINGHOURS',  names: ['operatinghours'],  kind: 'num',  unit: ' h', read: 'uncertain' },
    { id: 'chPower',     slot: 'chiller',        role: 'power',  label: 'Power',                       cap: 'POWER',           names: ['power'],           kind: 'num',  unit: ' kW' },
    { id: 'chEnable',    slot: 'chiller',        role: 'cmd',    label: 'Enable command',              cap: 'ENABLECMD',       names: ['enablecmd'],       kind: 'text' },
    { id: 'chAlarm',     slot: 'chiller',        role: 'alarm',  label: 'Alarm status',                cap: 'ALARMSTATUS',     names: ['alarmstatus'],     kind: 'text' },

    { id: 'wpP1Run',     slot: 'chilledPumps',   role: 'run',    label: 'Pump 1 status',               cap: 'PUMP1RUNSTATUS',  names: ['pump1runstatus'],  kind: 'status' },
    { id: 'wpP2Run',     slot: 'chilledPumps',   role: 'run',    label: 'Pump 2 status',               cap: 'PUMP2RUNSTATUS',  names: ['pump2runstatus'],  kind: 'status' },
    { id: 'wpP1Speed',   slot: 'chilledPumps',   role: 'speed',  label: 'Pump 1 speed',                cap: 'PUMP1SPEED',      names: ['pump1speed'],      kind: 'pct',  unit: ' %' },
    { id: 'wpP2Speed',   slot: 'chilledPumps',   role: 'speed',  label: 'Pump 2 speed',                cap: 'PUMP2SPEED',      names: ['pump2speed'],      kind: 'pct',  unit: ' %' },
    { id: 'wpDemand',    slot: 'chilledPumps',   role: 'demand', label: 'Cooling demand',              cap: 'COOLINGDEMAND',   names: ['coolingdemand'],   kind: 'pct',  unit: ' %' },
    { id: 'wpP1Cmd',     slot: 'chilledPumps',   role: 'cmd',    label: 'Pump 1 command',              cap: 'PUMP1CMD',        names: ['pump1cmd'],        kind: 'text' },
    { id: 'wpP2Cmd',     slot: 'chilledPumps',   role: 'cmd',    label: 'Pump 2 command',              cap: 'PUMP2CMD',        names: ['pump2cmd'],        kind: 'text', read: 'uncertain' },
    { id: 'wpP1Trip',    slot: 'chilledPumps',   role: 'alarm',  label: 'Pump 1 trip',                 cap: 'PUMP1TRIP',       names: ['pump1trip'],       kind: 'text' },
    { id: 'wpP2Trip',    slot: 'chilledPumps',   role: 'alarm',  label: 'Pump 2 trip',                 cap: 'PUMP2TRIP',       names: ['pump2trip'],       kind: 'text' },

    { id: 'blRun',       slot: 'boiler',         role: 'run',    label: 'Boiler status',               cap: 'RUNSTATUS',       names: ['runstatus'],       kind: 'status' },
    { id: 'blHwsTemp',   slot: 'boiler',         role: 'temp',   label: 'Hot water supply temperature', cap: 'HWSTEMP',        names: ['hwstemp'],         kind: 'temp', unit: ' °C', read: 'uncertain' },
    { id: 'blHwrTemp',   slot: 'boiler',         role: 'temp',   label: 'Hot water return temperature', cap: 'HWRTEMP',        names: ['hwrtemp'],         kind: 'temp', unit: ' °C', read: 'uncertain' },
    { id: 'blHwsSp',     slot: 'boiler',         role: 'sp',     label: 'Supply set-point',            cap: 'HWSTEMPSP',       names: ['hwstempsp'],       kind: 'temp', unit: ' °C', read: 'uncertain' },
    { id: 'blPower',     slot: 'boiler',         role: 'power',  label: 'Power',                       cap: 'POWER',           names: ['power'],           kind: 'num',  unit: ' kW' },
    { id: 'blEnable',    slot: 'boiler',         role: 'cmd',    label: 'Enable command',              cap: 'ENABLECMD',       names: ['enablecmd'],       kind: 'text' },
    { id: 'blAlarm',     slot: 'boiler',         role: 'alarm',  label: 'Alarm status',                cap: 'ALARMSTATUS',     names: ['alarmstatus'],     kind: 'text' },

    { id: 'btFlow',      slot: 'btu',            role: 'flow',   label: 'Chilled water flow',          cap: 'CHWFLOW',         names: ['chwflow'],         kind: 'num',  unit: ' L/s', read: 'uncertain' },
    { id: 'btPower',     slot: 'btu',            role: 'power',  label: 'Cooling power',               cap: 'COOLINGPOWER',    names: ['coolingpower'],    kind: 'num',  unit: ' kW', read: 'uncertain' },
    { id: 'btSup',       slot: 'btu',            role: 'temp',   label: 'Supply temperature',          cap: 'CHWSUPPLYTEMP',   names: ['chwsupplytemp'],   kind: 'temp', unit: ' °C', read: 'uncertain' },
    { id: 'btRet',       slot: 'btu',            role: 'temp',   label: 'Return temperature',          cap: 'CHWRETURNTEMP',   names: ['chwreturntemp'],   kind: 'temp', unit: ' °C', read: 'uncertain' }
  ];

  /* the parts that turn or flame: each has its own run-status point. chip: where its state label sits. */
  var PARTS = [
    { id: 'fan',     slot: 'coolingTower',   run: 'ctFanRun', name: 'Fan',     chip: [180, 412] },
    { id: 'cp1',     slot: 'condenserPumps', run: 'cpP1Run',  name: 'P1',      chip: [178, 566] },
    { id: 'cp2',     slot: 'condenserPumps', run: 'cpP2Run',  name: 'P2',      chip: [178, 700] },
    { id: 'chiller', slot: 'chiller',        run: 'chRun',    name: '',        chip: [550, 702] },
    { id: 'wp1',     slot: 'chilledPumps',   run: 'wpP1Run',  name: 'P1',      chip: [830, 474] },
    { id: 'wp2',     slot: 'chilledPumps',   run: 'wpP2Run',  name: 'P2',      chip: [830, 606] },
    { id: 'boiler',  slot: 'boiler',         run: 'blRun',    name: '',        chip: [1135, 92] },
    { id: 'btu',     slot: 'btu',            run: null,       name: '',        chip: [870, 742] }
  ];

  var ROLE_ORDER = ['run', 'temp', 'pressure', 'flow', 'hours', 'speed', 'power', 'demand', 'sp', 'cmd', 'mode', 'alarm'];
  var BY_ID = {};
  ITEMS.forEach(function (i) { BY_ID[i.id] = i; });

  /* ── reading a value (pure: no DOM) ── */
  function fold(name) { return String(name == null ? '' : name).toLowerCase().replace(/[^a-z0-9]/g, ''); }

  /* The value of a point as text, or null when it has none ("no reading": empty, a dash, N/A, null) */
  function clean(v) {
    if (v == null) return null;
    var s = String(v).trim();
    if (!s || s === '—' || s === '--' || /^(n\/a|null|nan|undefined)$/i.test(s)) return null;
    return s;
  }
  function number(raw) {
    var m = String(raw).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
    if (!m) return null;
    var n = parseFloat(m[0]);
    return isFinite(n) ? n : null;
  }
  var RANGE = { temp: [-50, 200], pct: [0, 100] };
  var ON = /^(on|run|running|started|start|true|active|yes|1)$/i;
  var OFF = /^(off|stop|stopped|false|inactive|no|0)$/i;
  var FAULT = /^(fault|faulted|trip|tripped|alarm|fail|failed)$/i;
  /* on / off / fault / unknown for a run-status text */
  function statusOf(raw) {
    var s = String(raw == null ? '' : raw).trim();
    if (FAULT.test(s)) return 'fault';
    if (ON.test(s)) return 'on';
    if (OFF.test(s)) return 'off';
    return 'unknown';
  }
  function format(kind, n, unit) {
    var digits = kind === 'num' ? (Math.abs(n) >= 100 ? 1 : 2) : 1;
    return String(Number(n.toFixed(digits))) + (unit || '');
  }

  /* The asset of each slot: confirmed (its id is in the live feed) or not. A confirmed id is matched whole, never by similarity. */
  function resolveSlots(assets, slots) {
    var list = Array.isArray(assets) ? assets : [];
    return (slots || SLOTS).map(function (s) {
      var asset = null;
      if (s.equip) {
        for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === s.equip) { asset = list[i]; break; }
      }
      var state = !s.equip ? 'unconfirmed' : (asset ? 'ok' : 'not-in-feed');
      return { id: s.id, label: s.label, equip: s.equip || null, asset: asset, state: state };
    });
  }

  /* One point's reading: { state, text, raw, num, status, pointName } — state live only with a verified source, otherwise "—".
     states: live · unconfirmed · not-in-feed · disconnected · stale · no-point · not-reporting · invalid */
  function readItem(item, slot, connected) {
    var out = { id: item.id, state: 'unconfirmed', text: '—', raw: null, num: null, status: null, pointName: null };
    if (!slot || slot.state === 'unconfirmed') return out;
    if (slot.state === 'not-in-feed') { out.state = 'not-in-feed'; return out; }
    if (connected === false) { out.state = 'disconnected'; return out; }
    if (slot.asset && slot.asset.st === 'stale') { out.state = 'stale'; return out; }
    var points = (slot.asset && slot.asset.points) || [];
    var found = null;
    for (var n = 0; n < item.names.length && !found; n++) {
      for (var i = 0; i < points.length; i++) {
        var p = points[i];
        if (p && fold(p.navName != null ? p.navName : p[0]) === item.names[n]) { found = p; break; }
      }
    }
    if (!found) { out.state = 'no-point'; return out; }
    out.pointName = found.navName;
    if (found.reporting === false) { out.state = 'not-reporting'; return out; }
    var raw = clean(found.text != null && found.text !== '' ? found.text : found.currentValue);
    if (raw == null) raw = clean(found.currentValue);
    if (raw == null) { out.state = 'no-point'; return out; }
    out.raw = raw;
    if (item.kind === 'temp' || item.kind === 'pct' || item.kind === 'num') {
      var n2 = number(raw);
      var r = RANGE[item.kind];
      if (n2 == null || (r && (n2 < r[0] || n2 > r[1]))) { out.state = 'invalid'; return out; }
      out.state = 'live'; out.num = n2; out.text = format(item.kind, n2, item.unit); return out;
    }
    if (item.kind === 'status') out.status = statusOf(raw);
    out.state = 'live'; out.text = raw; return out;
  }

  /* running · stopped · fault · unknown · unmapped (online for the meter), from a part's own run-status reading */
  function partState(part, slot, reads) {
    if (!slot || slot.state === 'unconfirmed') return 'unmapped';
    if (!part.run) {
      for (var id in reads) if (reads[id].state === 'live' && BY_ID[id].slot === part.slot) return 'online';
      return 'unknown';
    }
    var r = reads[part.run];
    if (!r || r.state !== 'live') return 'unknown';
    return r.status === 'on' ? 'running' : r.status === 'off' ? 'stopped' : r.status === 'fault' ? 'fault' : 'unknown';
  }

  /* A loop's flow from the equipment that drives it: any one running = flowing; all known to be stopped/faulted = not flowing; else unknown */
  function flowOf(states) {
    if (states.indexOf('running') !== -1) return 'on';
    if (states.length && states.every(function (s) { return s === 'stopped' || s === 'fault'; })) return 'off';
    return 'unknown';
  }

  /* Everything the drawing shows, from the live assets. `opts.connected === false`: FIN is not connected, so nothing is read. */
  function model(assets, slots, opts) {
    var connected = !(opts && opts.connected === false);
    var sl = resolveSlots(assets, slots);
    var by = {}; sl.forEach(function (s) { by[s.id] = s; });
    var reads = {};
    ITEMS.forEach(function (it) { reads[it.id] = readItem(it, by[it.slot], connected); });
    var parts = {};
    PARTS.forEach(function (p) { parts[p.id] = partState(p, by[p.slot], reads); });
    var chilled = flowOf([parts.wp1, parts.wp2]);
    var fr = reads.btFlow;
    if (fr.state === 'live' && fr.num != null) chilled = fr.num > 0.05 ? 'on' : 'off';   // a measured flow is the evidence
    var loops = { condenser: flowOf([parts.cp1, parts.cp2]), chilled: chilled, hot: flowOf([parts.boiler]) };
    var slotState = {};
    sl.forEach(function (s) {
      var mine = PARTS.filter(function (p) { return p.slot === s.id; }).map(function (p) { return parts[p.id]; });
      slotState[s.id] = s.state === 'unconfirmed' ? 'unmapped'
        : mine.indexOf('fault') !== -1 ? 'fault'
        : mine.indexOf('running') !== -1 ? 'running'
        : mine.length && mine.every(function (x) { return x === 'stopped'; }) ? 'stopped'
        : mine.indexOf('online') !== -1 ? 'online' : 'unknown';
    });
    var mapped = sl.filter(function (s) { return s.state === 'ok'; }).length;
    var live = ITEMS.filter(function (i) { return reads[i.id].state === 'live'; }).length;
    return { slots: sl, reads: reads, parts: parts, loops: loops, slotState: slotState, connected: connected, mapped: mapped, total: sl.length, live: live };
  }

  /* ── text ── */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function E() { return root && root.EKO; }
  function tr(key, fb) { var e = E(), v = e && e.t ? e.t(key) : key; return v && v !== key ? v : fb; }
  var STATE_TEXT = {
    running: ['roofStRunning', 'RUNNING'], stopped: ['roofStStopped', 'STOPPED'], fault: ['roofStFault', 'FAULT'],
    unknown: ['roofStNoData', 'NO DATA'], unmapped: ['roofStUnmapped', 'UNMAPPED'], online: ['roofStOnline', 'ONLINE']
  };
  function stateText(s) { var t = STATE_TEXT[s] || STATE_TEXT.unknown; return tr(t[0], t[1]); }
  function stripText(m) {
    if (!m.connected) return tr('roofDisc', 'FIN disconnected – no live values');
    if (!m.mapped) return tr('roofNoLive', 'No live data – equipment not mapped yet');
    return tr('roofLive', 'Live') + ' · ' + m.mapped + '/' + m.total;
  }

  /* ── drawing ── */
  var COL = { condenser: '#35a853', chilled: '#2b7fdc', hot: '#e0453a' };
  /* Pipe paths run in the direction of flow, so the animated dashes travel the right way */
  var PIPES = {
    condenser: [
      'M110,372 V640 H255 V545 H380',      // tower basin → pumps → chiller condenser
      'M110,520 H255 V545',                 // pump 1 branch
      'M380,505 H335 V230 H300'             // chiller condenser → tower distribution
    ],
    chilled: [
      'M720,572 H770 V560 H890 V485 H930',  // chiller evaporator → pumps → building
      'M770,560 V430 H890 V485',            // pump 1 branch
      'M990,510 V700 H735 V598 H720'        // building return (through the BTU meter) → evaporator
    ],
    hot: [
      'M1100,312 V420',                     // boiler → building hot water system
      'M1170,420 V312'                      // building return → boiler
    ]
  };

  function pipe(d, color) {
    return '<path class="rf-pipe-o" d="' + d + '" fill="none" stroke="#1c2430" stroke-opacity=".55" stroke-width="12" stroke-linejoin="round"/>'
      + '<path class="rf-pipe" d="' + d + '" fill="none" stroke="' + color + '" stroke-width="8" stroke-linejoin="round"/>'
      + '<path d="' + d + '" fill="none" stroke="#fff" stroke-opacity=".28" stroke-width="2" stroke-linejoin="round"/>'
      + '<path class="rf-flow" d="' + d + '" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round" stroke-dasharray="1 15" stroke-linejoin="round"/>';
  }
  /* x, y, angle of a small direction arrow on a pipe, as the water flows */
  var ARROWS = {
    condenser: [[110, 440, 90], [300, 545, 0], [335, 400, -90]],
    chilled: [[750, 572, 0], [770, 500, -90], [910, 485, 0], [990, 600, 90], [830, 700, 180]],
    hot: [[1100, 370, 90], [1170, 370, -90]]
  };
  function arrows(id) {
    return ARROWS[id].map(function (a) { return '<path class="rf-arrow" d="M-6,-5 L6,0 L-6,5 Z" transform="translate(' + a[0] + ',' + a[1] + ') rotate(' + a[2] + ')"/>'; }).join('');
  }
  function loop(id, m) {
    return '<g class="rf-loop" data-loop="' + id + '" data-flow="' + m.loops[id] + '">' + PIPES[id].map(function (d) { return pipe(d, COL[id]); }).join('') + arrows(id) + '</g>';
  }

  function vanes(n, len, w, color) {
    var out = '';
    for (var i = 0; i < n; i++) out += '<path d="M0,0 Q' + (len * 0.3) + ',' + (-w) + ' ' + len + ',' + (-w * 1.6) + '" fill="none" stroke="' + color + '" stroke-width="3.2" stroke-linecap="round" transform="rotate(' + (i * 360 / n) + ')"/>';
    return out;
  }
  function blades(n, len, w) {
    var out = '';
    for (var i = 0; i < n; i++) out += '<path d="M0,0 C' + (len * 0.3) + ',' + (-w * 0.8) + ' ' + (len * 0.75) + ',' + (-w) + ' ' + len + ',' + (-w * 0.25) + ' C' + (len * 0.75) + ',' + (w * 0.55) + ' ' + (len * 0.3) + ',' + (w * 0.4) + ' 0,0 Z" transform="rotate(' + (i * 360 / n) + ')"/>';
    return out;
  }

  function defs() {
    return '<defs>'
      + '<linearGradient id="rf-metal" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f1f3f6"/><stop offset=".55" stop-color="#c3c9d1"/><stop offset="1" stop-color="#8b929d"/></linearGradient>'
      + '<linearGradient id="rf-cyl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6f7884"/><stop offset=".3" stop-color="#e3e7ec"/><stop offset=".62" stop-color="#b3bac4"/><stop offset="1" stop-color="#5f6874"/></linearGradient>'
      + '<linearGradient id="rf-motor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5b97e0"/><stop offset=".5" stop-color="#2f6cbc"/><stop offset="1" stop-color="#1b4685"/></linearGradient>'
      + '<linearGradient id="rf-dark" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#555d68"/><stop offset="1" stop-color="#262b32"/></linearGradient>'
      + '<linearGradient id="rf-tower" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b4c5d6"/><stop offset="1" stop-color="#7f96ad"/></linearGradient>'
      + '<linearGradient id="rf-water" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5aa3dc"/><stop offset="1" stop-color="#2f6fa8"/></linearGradient>'
      + '<radialGradient id="rf-volute" cx=".4" cy=".35" r=".8"><stop offset="0" stop-color="#f4f6f8"/><stop offset="1" stop-color="#9aa2ad"/></radialGradient>'
      + '</defs>';
  }

  function pumpSym(part, cx, cy) {
    var fins = ''; [-12, -4, 4, 12].forEach(function (d) { fins += '<line x1="' + (cx + d) + '" y1="' + (cy - 54) + '" x2="' + (cx + d) + '" y2="' + (cy - 22) + '"/>'; });
    return '<g data-part="' + part + '" data-run="off">'
      + '<rect x="' + (cx - 34) + '" y="' + (cy + 20) + '" width="68" height="8" rx="2" fill="#59606a"/>'
      + '<rect x="' + (cx - 20) + '" y="' + (cy - 58) + '" width="40" height="40" rx="6" fill="url(#rf-motor)" stroke="#143562" stroke-width="1.5"/>'
      + '<g stroke="#143562" stroke-opacity=".55" stroke-width="1.2">' + fins + '</g>'
      + '<rect x="' + (cx + 8) + '" y="' + (cy - 66) + '" width="14" height="9" rx="2" fill="#dfe3e8" stroke="#5d6570"/>'
      + '<rect x="' + (cx - 5) + '" y="' + (cy - 20) + '" width="10" height="8" fill="#8f96a1"/>'
      + '<rect x="' + (cx - 38) + '" y="' + (cy - 6) + '" width="14" height="12" rx="2" fill="#7a828c" stroke="#414850"/><rect x="' + (cx + 24) + '" y="' + (cy - 6) + '" width="14" height="12" rx="2" fill="#7a828c" stroke="#414850"/>'
      + '<circle cx="' + cx + '" cy="' + cy + '" r="22" fill="url(#rf-volute)" stroke="#434a53" stroke-width="2"/>'
      + '<g transform="translate(' + cx + ',' + cy + ')"><g class="rf-rot">' + vanes(6, 15, 4, '#3b424b') + '<circle r="4.5" fill="#59606a"/></g></g></g>';
  }

  function tower() {
    var louvres = ''; for (var y = 224; y < 366; y += 9) louvres += '<line x1="66" y1="' + y + '" x2="294" y2="' + y + '" stroke="#40566d" stroke-opacity=".55" stroke-width="1.6"/>';
    var fins = ''; [186, 194, 202, 210].forEach(function (x) { fins += '<line x1="' + x + '" y1="116" x2="' + x + '" y2="150"/>'; });
    return '<g data-part="fan" data-run="off">'
      + '<polygon points="300,210 340,172 340,334 300,372" fill="#6d849b" stroke="#41546a"/>'
      + '<rect x="60" y="210" width="240" height="162" fill="url(#rf-tower)" stroke="#41546a" stroke-width="1.5"/>' + louvres
      + '<polygon points="60,210 100,172 340,172 300,210" fill="#d8dee5" stroke="#41546a" stroke-width="1.5"/>'
      + '<rect x="60" y="358" width="240" height="16" fill="url(#rf-water)" stroke="#2f5c86"/>'
      + '<g transform="translate(200,191) scale(1,.42)"><circle r="72" fill="#7d858f" stroke="#444b54" stroke-width="5"/><circle r="64" fill="#4a5059"/>'
      + '<g class="rf-rot" fill="#c9cfd7" stroke="#6a727c" stroke-width="1.4">' + blades(6, 60, 17) + '</g><circle r="11" fill="#2f353c" stroke="#8b929d" stroke-width="2"/></g>'
      + '<rect x="196" y="150" width="8" height="30" fill="#8f96a1" stroke="#555d66"/>'
      + '<rect x="178" y="112" width="44" height="42" rx="7" fill="url(#rf-motor)" stroke="#143562" stroke-width="1.5"/>'
      + '<g stroke="#143562" stroke-opacity=".55" stroke-width="1.2">' + fins + '</g>'
      + '<rect x="288" y="222" width="20" height="16" rx="2" fill="#7a828c" stroke="#414850"/><rect x="102" y="372" width="16" height="12" rx="2" fill="#7a828c" stroke="#414850"/></g>';
  }

  function chillerLed(m) { return { running: '#2fd16f', stopped: '#8b929d', fault: '#ff4d3f', online: '#4aa3ff' }[m.parts.chiller] || '#b9a24a'; }

  function chiller(m) {
    var bands = ''; [470, 550, 630].forEach(function (x) { bands += '<line x1="' + x + '" y1="498" x2="' + x + '" y2="548"/><line x1="' + x + '" y1="564" x2="' + x + '" y2="614"/>'; });
    var fins = ''; [452, 466, 480, 494].forEach(function (x) { fins += '<line x1="' + x + '" y1="438" x2="' + x + '" y2="484"/>'; });
    return '<g data-part="chiller" data-run="off">'
      + '<rect x="380" y="646" width="350" height="12" rx="2" fill="#59606a"/>'
      + '<rect x="404" y="560" width="292" height="56" rx="28" fill="url(#rf-cyl)" stroke="#434a53" stroke-width="1.5"/>'
      + '<rect x="404" y="494" width="292" height="56" rx="28" fill="url(#rf-cyl)" stroke="#434a53" stroke-width="1.5"/><g stroke="#4d5560" stroke-opacity=".5">' + bands + '</g>'
      + '<rect x="392" y="494" width="18" height="56" rx="4" fill="#8d95a0" stroke="#434a53"/><rect x="690" y="560" width="18" height="56" rx="4" fill="#8d95a0" stroke="#434a53"/>'
      + '<rect x="374" y="498" width="18" height="14" rx="2" fill="#7a828c" stroke="#414850"/><rect x="374" y="538" width="18" height="14" rx="2" fill="#7a828c" stroke="#414850"/>'
      + '<rect x="708" y="565" width="18" height="14" rx="2" fill="#7a828c" stroke="#414850"/><rect x="708" y="591" width="18" height="14" rx="2" fill="#7a828c" stroke="#414850"/>'
      + '<rect x="520" y="424" width="112" height="72" rx="8" fill="url(#rf-metal)" stroke="#434a53" stroke-width="1.5"/><circle cx="576" cy="460" r="26" fill="#aeb5be" stroke="#555d66" stroke-width="2"/><circle cx="576" cy="460" r="12" fill="#6d7681" stroke="#434a53"/>'
      + '<rect x="430" y="434" width="92" height="54" rx="9" fill="url(#rf-motor)" stroke="#143562" stroke-width="1.5"/><g stroke="#143562" stroke-opacity=".55" stroke-width="1.2">' + fins + '</g>'
      + '<circle cx="418" cy="461" r="19" fill="#d9dde2" stroke="#555d66" stroke-width="2"/><g transform="translate(418,461)"><g class="rf-rot" fill="#7c848e">' + blades(8, 15, 5) + '</g><circle r="3.5" fill="#434a53"/></g>'
      + '<rect x="640" y="436" width="66" height="50" rx="4" fill="#dfe3e8" stroke="#5d6570"/><circle class="rf-led" cx="654" cy="450" r="4.5" fill="' + chillerLed(m) + '"/><rect x="664" y="443" width="34" height="18" rx="2" fill="#1b2a3a"/></g>';
  }

  function boiler() {
    return '<g data-part="boiler" data-run="off">'
      + '<rect x="1100" y="108" width="40" height="64" fill="url(#rf-metal)" stroke="#434a53"/><rect x="1093" y="102" width="54" height="10" rx="2" fill="#aeb5be" stroke="#434a53"/>'
      + '<rect x="1050" y="170" width="170" height="142" rx="9" fill="url(#rf-dark)" stroke="#14171b" stroke-width="1.5"/>'
      + '<rect x="1064" y="184" width="142" height="74" rx="5" fill="#2e343b" stroke="#444c56"/><circle cx="1135" cy="221" r="24" fill="#0e1114" stroke="#7b838d" stroke-width="3"/>'
      + '<g transform="translate(1135,243)"><g class="rf-flame"><path d="M0,0 C-14,-10 -9,-26 0,-40 C9,-26 14,-10 0,0Z" fill="#ff8f1f"/><path d="M0,0 C-7,-6 -4,-15 0,-24 C4,-15 7,-6 0,0Z" fill="#ffd45a"/></g></g>'
      + '<rect x="1006" y="222" width="46" height="58" rx="7" fill="url(#rf-metal)" stroke="#434a53" stroke-width="1.5"/><circle cx="1029" cy="251" r="15" fill="#aeb5be" stroke="#555d66" stroke-width="2"/><circle cx="1029" cy="251" r="6" fill="#59606a"/>'
      + '<rect x="1080" y="286" width="50" height="10" rx="2" fill="#59606a"/><rect x="1150" y="286" width="50" height="10" rx="2" fill="#59606a"/>'
      + '<rect x="1090" y="306" width="22" height="12" rx="2" fill="#7a828c" stroke="#414850"/><rect x="1159" y="306" width="22" height="12" rx="2" fill="#7a828c" stroke="#414850"/></g>';
  }

  function btu() {
    return '<g data-part="btu"><rect x="842" y="676" width="56" height="48" rx="7" fill="url(#rf-metal)" stroke="#434a53" stroke-width="1.5"/>'
      + '<circle cx="870" cy="696" r="14" fill="#f4f5f7" stroke="#555d66" stroke-width="2"/><line x1="870" y1="696" x2="870" y2="685" stroke="#555d66" stroke-width="2"/><circle cx="870" cy="696" r="2.5" fill="#434a53"/>'
      + '<rect x="852" y="713" width="36" height="8" rx="1.5" fill="#1b2a3a"/><rect x="834" y="693" width="10" height="14" rx="2" fill="#7a828c" stroke="#414850"/><rect x="896" y="693" width="10" height="14" rx="2" fill="#7a828c" stroke="#414850"/></g>';
  }

  function building() {
    var T = function (x, y, t, c) { return '<text x="' + x + '" y="' + y + '" font-size="11" font-weight="700" text-anchor="middle" fill="' + c + '">' + t + '</text>'; };
    return '<g class="rf-sys"><rect x="930" y="420" width="120" height="90" rx="6" fill="#cfe3f8" stroke="#2b7fdc" stroke-width="2"/>'
      + T(990, 458, 'BUILDING', '#17436f') + T(990, 472, 'CHILLED WATER', '#17436f') + T(990, 486, 'SYSTEM', '#17436f')
      + '<rect x="1075" y="420" width="190" height="90" rx="6" fill="#f9d6d2" stroke="#e0453a" stroke-width="2"/>'
      + T(1170, 458, 'BUILDING HOT WATER', '#7a1f19') + T(1170, 472, 'SYSTEM', '#7a1f19') + '</g>';
  }

  function labels() {
    var L = function (x, y, t) { return '<text class="rf-lbl" x="' + x + '" y="' + y + '" font-size="12" font-weight="700" letter-spacing=".4" text-anchor="middle" fill="#2b3340">' + t + '</text>'; };
    var S = function (x, y, t, anchor, color) { return '<text x="' + x + '" y="' + y + '" font-size="9.5" font-weight="600" text-anchor="' + anchor + '" fill="' + color + '">' + t + '</text>'; };
    return L(180, 398, 'COOLING TOWER') + L(178, 732, 'CONDENSER WATER PUMPS') + L(550, 684, 'CHILLER') + L(830, 646, 'CHILLED WATER PUMPS') + L(1135, 74, 'BOILER') + L(870, 768, 'BTU METER')
      + S(102, 450, 'CONDENSER WATER', 'end', COL.condenser) + S(102, 465, 'SUPPLY', 'end', COL.condenser) + S(342, 330, 'CONDENSER WATER RETURN', 'start', COL.condenser)
      + S(998, 600, 'CHW RETURN', 'start', COL.chilled)
      + S(1092, 372, 'HW SUPPLY', 'end', COL.hot) + S(1178, 372, 'HW RETURN', 'start', COL.hot);
  }

  function chip(p, m) {
    var st = m.parts[p.id], w = 96, x = p.chip[0] - w / 2, y = p.chip[1] - 9;
    var t = (p.name ? p.name + ' ' : '') + stateText(st);
    return '<g class="rf-chip" data-chip="' + p.id + '" data-state="' + st + '" transform="translate(' + x + ',' + y + ')">'
      + '<rect width="' + w + '" height="18" rx="9"/><circle cx="10" cy="9" r="4"/><text x="' + (w / 2 + 5) + '" y="12.6" text-anchor="middle">' + esc(t) + '</text></g>';
  }

  /* the equipment groups, each one a clickable selection target over its drawing */
  function eq(m, slotId, bbox, inner) {
    var s = m.slots.filter(function (x) { return x.id === slotId; })[0];
    return '<g class="rf-eq" data-slot="' + slotId + '" data-state="' + m.slotState[slotId] + '" tabindex="0" role="button" aria-label="' + esc(s.label) + '">'
      + '<title>' + esc(s.label) + '</title>' + inner
      + '<rect class="rf-hit" x="' + bbox[0] + '" y="' + bbox[1] + '" width="' + bbox[2] + '" height="' + bbox[3] + '" rx="8"/></g>';
  }

  function legend() {
    var item = function (x, color, text) { return '<g transform="translate(' + x + ',0)"><rect width="26" height="7" rx="3" y="-3" fill="' + color + '"/><text x="34" y="5" font-size="10.5" fill="#46505f">' + text + '</text></g>'; };
    return '<g class="rf-legend" transform="translate(30,748)">' + item(0, COL.chilled, 'Chilled water') + item(130, COL.condenser, 'Condenser water') + item(280, COL.hot, 'Hot water') + '</g>';
  }

  /* The SVG markup for a model: the first paint, and what the tests read. Later data changes go through apply(), which keeps the animations running. */
  function runAttr(st) { return st === 'running' ? 'on' : st === 'fault' ? 'fault' : 'off'; }
  function svg(m) {
    var out = svgMarkup(m);
    PARTS.forEach(function (p) { out = out.replace('data-part="' + p.id + '" data-run="off"', 'data-part="' + p.id + '" data-run="' + runAttr(m.parts[p.id]) + '"'); });
    return out;
  }
  function svgMarkup(m) {
    return '<svg class="rf-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + VB.w + ' ' + VB.h + '" preserveAspectRatio="xMidYMid meet" role="group" aria-label="Hospital Roof HVAC graphic" font-family="Segoe UI, Arial, Helvetica, sans-serif">'
      + defs() + '<rect class="rf-bg" width="' + VB.w + '" height="' + VB.h + '" fill="#e9ecf0"/>'
      + '<text x="30" y="38" font-size="19" font-weight="800" letter-spacing=".6" fill="#1f2937">HOSPITAL ROOF – HVAC</text>'
      + '<g class="rf-strip" data-live="' + (m.connected && m.mapped ? 'on' : 'off') + '" transform="translate(30,58)"><circle cx="5" cy="0" r="4.5"/><text x="16" y="4" font-size="11.5" font-weight="600" fill="#4b5563">' + esc(stripText(m)) + '</text></g>'
      + loop('condenser', m) + loop('chilled', m) + loop('hot', m) + building()
      + eq(m, 'coolingTower', [52, 104, 296, 292], tower())
      + eq(m, 'condenserPumps', [96, 440, 150, 290], pumpSym('cp1', 178, 520) + pumpSym('cp2', 178, 640))
      + eq(m, 'chiller', [366, 418, 372, 250], chiller(m))
      + eq(m, 'chilledPumps', [770, 360, 130, 300], pumpSym('wp1', 830, 430) + pumpSym('wp2', 830, 560))
      + eq(m, 'boiler', [1000, 96, 230, 238], boiler())
      + eq(m, 'btu', [828, 668, 90, 64], btu())
      + labels() + PARTS.map(function (p) { return chip(p, m); }).join('') + legend() + '</svg>';
  }

  /* Update a drawn SVG in place from a model: states, chips, loops. Nothing is rebuilt, so a turning fan keeps turning without a restart. */
  function apply(svgEl, m) {
    PARTS.forEach(function (p) {
      var g = svgEl.querySelector('[data-part="' + p.id + '"]');
      if (g) g.setAttribute('data-run', runAttr(m.parts[p.id]));
      var c = svgEl.querySelector('[data-chip="' + p.id + '"]');
      if (c) { c.setAttribute('data-state', m.parts[p.id]); c.querySelector('text').textContent = (p.name ? p.name + ' ' : '') + stateText(m.parts[p.id]); }
    });
    ['condenser', 'chilled', 'hot'].forEach(function (id) {
      var l = svgEl.querySelector('[data-loop="' + id + '"]'); if (l) l.setAttribute('data-flow', m.loops[id]);
    });
    m.slots.forEach(function (s) {
      var g = svgEl.querySelector('.rf-eq[data-slot="' + s.id + '"]'); if (g) g.setAttribute('data-state', m.slotState[s.id]);
    });
    var strip = svgEl.querySelector('.rf-strip');
    if (strip) { strip.setAttribute('data-live', m.connected && m.mapped ? 'on' : 'off'); strip.querySelector('text').textContent = stripText(m); }
    var led = svgEl.querySelector('.rf-led');
    if (led) led.setAttribute('fill', chillerLed(m));
  }

  /* The selected equipment's live information, as markup: only points that are mapped and reporting; otherwise what is still needed. */
  function details(m, slotId) {
    var slot = m.slots.filter(function (s) { return s.id === slotId; })[0];
    if (!slot) return '';
    var items = ITEMS.filter(function (i) { return i.slot === slotId; });
    var live = items.filter(function (i) { return m.reads[i.id].state === 'live'; })
      .sort(function (a, b) { return ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role); });
    var st = m.slotState[slotId];
    var h = '<div class="rd-head"><h3>' + esc(slot.label) + '</h3><span class="rd-pill" data-state="' + st + '">' + esc(stateText(st)) + '</span>'
      + '<button type="button" class="iconbtn rd-x" data-rf="closedet" aria-label="' + esc(tr('close', 'Close')) + '">✕</button></div>';
    if (slot.state === 'ok') {
      h += '<p class="rd-asset"><span class="tCap">' + esc(tr('roofAsset', 'FIN equipment')) + '</span> <b>' + esc(slot.equip) + '</b> '
        + '<button type="button" class="btnG btnSm" data-act="roofAsset" data-asset="' + esc(slot.equip) + '">' + esc(tr('roofOpenAsset', 'Open asset panel')) + '</button></p>';
    }
    if (live.length) {
      return h + '<dl class="rd-list">' + live.map(function (i) {
        var r = m.reads[i.id];
        return '<div class="rd-row" data-item="' + i.id + '"><dt>' + esc(i.label) + '</dt><dd' + (r.status ? ' data-status="' + r.status + '"' : '') + '>' + esc(r.text) + '</dd></div>';
      }).join('') + '</dl>';
    }
    var why = slot.state === 'unconfirmed' ? tr('roofNotMapped', 'Not mapped to a FIN equipment record yet.')
      : slot.state === 'not-in-feed' ? tr('roofNotInFeed', 'The confirmed equipment is not in the live FIN feed.')
      : !m.connected ? tr('roofDiscDet', 'FIN is disconnected, so no values are available.')
      : tr('roofNoPoints', 'FIN reports none of this equipment\'s expected points yet.');
    h += '<p class="rd-why">' + esc(why) + '</p>';
    if (slot.state === 'unconfirmed') {
      var caps = items.map(function (i) { return i.cap; }).filter(function (c, k, a) { return a.indexOf(c) === k; });
      h += '<p class="tCap">' + esc(tr('roofNeeds', 'To show live values: confirm the FIN equipment for this unit, then these points are read:')) + '</p>'
        + '<p class="rd-needs">' + esc(caps.join(' · ')) + '</p>';
    }
    return h;
  }

  /* ── the popup (DOM): same frame as the O&M / warranty popup (#docov), so Escape and navigation close it ── */
  var ov = null, vb = null, raf = 0, onData = null, selected = null;

  function assets() { var e = E(); return (e && e.data && e.data.assets) || []; }
  function connected() { var d = root && root.DashboardData; return !(d && d.connected === false); }
  function current() { return model(assets(), SLOTS, { connected: connected() }); }

  function applyViewBox() {
    var el = ov && ov.querySelector('.rf-svg');
    if (el && vb) el.setAttribute('viewBox', vb.x + ' ' + vb.y + ' ' + vb.w + ' ' + vb.h);
  }
  function fit() { vb = { x: 0, y: 0, w: VB.w, h: VB.h }; applyViewBox(); }
  function zoom(factor, cx, cy) {
    if (!vb) fit();
    var w = Math.max(VB.w / 8, Math.min(VB.w, vb.w / factor)), h = w * VB.h / VB.w;
    var fx = cx == null ? 0.5 : cx, fy = cy == null ? 0.5 : cy;
    var x = vb.x + (vb.w - w) * fx, y = vb.y + (vb.h - h) * fy;
    vb = { x: Math.max(0, Math.min(VB.w - w, x)), y: Math.max(0, Math.min(VB.h - h, y)), w: w, h: h };
    applyViewBox();
  }

  function paintDetails(m) {
    var panel = ov && ov.querySelector('.roofdet');
    if (!panel) return;
    panel.hidden = !selected;
    if (selected) panel.innerHTML = details(m, selected);
    ov.querySelectorAll('.rf-eq').forEach(function (g) { if (g.dataset.slot === selected) g.setAttribute('data-selected', ''); else g.removeAttribute('data-selected'); });
  }
  function paint(first) {
    if (!ov) return;
    var m = current();
    var holder = ov.querySelector('.rfwrap');
    if (first) { holder.innerHTML = svg(m); applyViewBox(); } else apply(holder.querySelector('.rf-svg'), m);
    paintDetails(m);
  }
  function schedule() {
    if (!ov || raf) return;
    raf = (root.requestAnimationFrame || function (f) { return setTimeout(f, 16); })(function () { raf = 0; paint(false); });
  }
  function select(slotId) { selected = selected === slotId ? null : slotId; paintDetails(current()); }

  function close() {
    var el = root.document.getElementById('docov');
    if (el) el.remove();
    ov = null; vb = null; selected = null;
    if (onData) { root.removeEventListener('dashboard-data', onData); onData = null; }
  }

  function open() {
    if (!E()) return;
    close();
    var title = tr('roofTitle', 'Hospital Roof – HVAC');
    ov = root.document.createElement('div');
    ov.id = 'docov';
    ov.innerHTML = '<div class="docbox roofbox" role="dialog" aria-modal="true" aria-label="' + esc(title) + '">'
      + '<div class="dochead"><h2 class="doctitle">' + esc(title) + '</h2><div class="docacts">'
      + '<button type="button" class="iconbtn" data-rf="out" aria-label="' + esc(tr('roofZoomOut', 'Zoom out')) + '">−</button>'
      + '<button type="button" class="iconbtn" data-rf="in" aria-label="' + esc(tr('roofZoomIn', 'Zoom in')) + '">+</button>'
      + '<button type="button" class="iconbtn" data-rf="fit" aria-label="' + esc(tr('roofFit', 'Fit to window')) + '">⤢</button></div>'
      + '<button type="button" class="wmaxx docx" data-act="docClose" aria-label="' + esc(tr('close', 'Close')) + '">✕</button></div>'
      + '<div class="roofbody"><div class="roofsvg"><div class="rfwrap"></div><aside class="roofdet" hidden aria-live="polite"></aside></div></div></div>';
    ov.addEventListener('click', function (ev) {
      if (ev.target === ov) { close(); return; }
      var t = ev.target.closest && ev.target.closest('[data-rf], .rf-eq');
      if (!t) return;
      if (t.classList.contains('rf-eq')) { select(t.dataset.slot); return; }
      var k = t.dataset.rf;
      if (k === 'in') zoom(1.4); else if (k === 'out') zoom(1 / 1.4); else if (k === 'fit') fit(); else if (k === 'closedet') { selected = null; paintDetails(current()); }
    });
    ov.addEventListener('keydown', function (ev) {
      var g = ev.target.closest && ev.target.closest('.rf-eq');
      if (g && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); select(g.dataset.slot); }
    });
    ov.addEventListener('wheel', function (ev) {
      var holder = ov.querySelector('.rfwrap'); if (!holder || !holder.contains(ev.target)) return;
      ev.preventDefault();
      var r = holder.getBoundingClientRect();
      zoom(ev.deltaY < 0 ? 1.15 : 1 / 1.15, (ev.clientX - r.left) / r.width, (ev.clientY - r.top) / r.height);
    }, { passive: false });
    ov.addEventListener('pointerdown', function (ev) {
      var holder = ov.querySelector('.rfwrap');
      if (ev.button !== 0 || !holder || !holder.contains(ev.target) || (ev.target.closest && ev.target.closest('.rf-eq')) || !vb || vb.w >= VB.w) return;
      var sx = ev.clientX, sy = ev.clientY, o = { x: vb.x, y: vb.y }, r = holder.getBoundingClientRect();
      var move = function (e) {
        vb.x = Math.max(0, Math.min(VB.w - vb.w, o.x - (e.clientX - sx) * vb.w / r.width));
        vb.y = Math.max(0, Math.min(VB.h - vb.h, o.y - (e.clientY - sy) * vb.h / r.height));
        applyViewBox();
      };
      var end = function () { root.document.removeEventListener('pointermove', move); root.document.removeEventListener('pointerup', end); };
      root.document.addEventListener('pointermove', move); root.document.addEventListener('pointerup', end);
    });
    (root.DASHBOARD_ROOT || root.document.body).appendChild(ov);
    fit(); paint(true);
    onData = function () { if (!root.document.getElementById('docov') || !ov) { close(); return; } schedule(); };
    root.addEventListener('dashboard-data', onData);
    var x = ov.querySelector('.docx'); if (x) x.focus();
  }

  return {
    VB: VB, SLOTS: SLOTS, ITEMS: ITEMS, PARTS: PARTS, PIPES: PIPES,
    fold: fold, clean: clean, number: number, statusOf: statusOf, resolveSlots: resolveSlots, readItem: readItem, flowOf: flowOf,
    model: model, svg: svg, apply: apply, details: details, open: open, close: close, refresh: schedule
  };
});
