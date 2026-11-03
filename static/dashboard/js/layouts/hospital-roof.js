/* Eko Hospital roof HVAC schematic: a native SVG of the roof plant (cooling tower, condenser pumps, chiller, chilled-water pumps,
   boiler, BTU meter), drawn after the Hospital's FIN roof screen. Only for a project whose Hospital graphics are on
   (INJECTED_PROJECT_CONFIG.hospitalHvac, set by the Studio for the ekoHospital FIN project); it is opened from the Assets register.

   WHERE A VALUE COMES FROM. The dashboard's own live equipment feed (EKO.data.assets, filled by the same FIN polling as every other
   asset panel and refreshed on every 'dashboard-data' event). A value is shown only when ALL of these hold, otherwise it is "—":
     1. the slot (equipment) has been CONFIRMED in SLOTS below: `equip` is that FIN equipment's asset id, not a guess;
     2. that asset is in the live feed;
     3. one of the item's `names` equals a point name of THAT asset (folded: lower case, letters and digits only; never a partial
        or similar name, never a point of another equipment);
     4. the point is reporting, has a value, and the value fits the item's kind (a temperature is a number in range, a status is text).
   Nothing is invented: no fixed figure, no default, no value carried over from another point.

   MAPPING STATUS. The point names below were read from a photo of the FIN screen, which is not sharp enough to be certain of every
   letter. They are expectations to be checked against FIN, not verified references. No FIN equipment record or point list for the
   roof is in this repository, so every slot starts with `equip: null` ("requires confirmation"). To confirm a slot: open the
   equipment's asset panel, check its point names against `names`, then set `equip` to its asset id (and correct `names` as needed).
   The mapping status list in the schematic shows each slot's state and the feed's candidate equipment as suggestions only. */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.document) root.EKO_ROOF = api;
})(typeof window !== 'undefined' ? window : null, function (root) {
  'use strict';

  var VB = { w: 1280, h: 960 };

  /* ── mapping: slot (equipment) → asset id ──
     equip: the FIN equipment's asset id once confirmed, else null. hints: suggestions for the mapping list only. */
  var SLOTS = [
    { id: 'coolingTower',   label: 'Cooling tower',            equip: null, hints: ['coolingtower', 'cooltower', 'cwtower'] },
    { id: 'condenserPumps', label: 'Condenser water pumps',    equip: null, hints: ['condenserpump', 'condpump', 'cwpump'] },
    { id: 'chiller',        label: 'Chiller',                  equip: null, hints: ['chiller'] },
    { id: 'chilledPumps',   label: 'Chilled water pumps',      equip: null, hints: ['chilledwaterpump', 'chwpump', 'chilledpump'] },
    { id: 'boiler',         label: 'Boiler',                   equip: null, hints: ['boiler'] },
    { id: 'btu',            label: 'BTU meter',                equip: null, hints: ['btu', 'heatmeter', 'energymeter'] }
  ];

  /* ── what each slot's values are: kind decides what a valid value is ──
     temp: number -50..200 · pct: number 0..100 · num: any finite number · status: run status text · text: any text
     `read: 'uncertain'` marks a caption or name that could not be read with confidence from the photo. */
  var ITEMS = [
    /* values drawn on the diagram: x,y = top-left of the caption strip, w = width */
    { id: 'ctFanSpeed',  slot: 'coolingTower',   cap: 'FANSPEED',        names: ['fanspeed'],        kind: 'pct',    unit: ' %',  x: 170, y: 300, w: 86 },
    { id: 'ctFanRun',    slot: 'coolingTower',   cap: 'FANRUNSTATUS',    names: ['fanrunstatus'],    kind: 'status', unit: '',    x: 146, y: 548, w: 148 },
    { id: 'ctCwEnter',   slot: 'coolingTower',   cap: 'CWENTERINGTEMP',  names: ['cwenteringtemp'],  kind: 'temp',   unit: ' °C', x: 14,  y: 316, w: 88 },
    { id: 'ctCwLeave',   slot: 'coolingTower',   cap: 'CWLEAVINGTEMP',   names: ['cwleavingtemp'],   kind: 'temp',   unit: ' °C', x: 352, y: 320, w: 86 },
    { id: 'cpP1Run',     slot: 'condenserPumps', cap: 'PUMP1RUNSTATUS',  names: ['pump1runstatus'],  kind: 'status', unit: '',    x: 84,  y: 618, w: 88 },
    { id: 'cpP1Speed',   slot: 'condenserPumps', cap: 'PUMP1SPEED',      names: ['pump1speed'],      kind: 'pct',    unit: ' %',  x: 192, y: 620, w: 72 },
    { id: 'cpP2Run',     slot: 'condenserPumps', cap: 'PUMP2RUNSTATUS',  names: ['pump2runstatus'],  kind: 'status', unit: '',    x: 80,  y: 752, w: 88 },
    { id: 'cpP2Speed',   slot: 'condenserPumps', cap: 'PUMP2SPEED',      names: ['pump2speed'],      kind: 'pct',    unit: ' %',  x: 178, y: 752, w: 72 },
    { id: 'wpP1Speed',   slot: 'chilledPumps',   cap: 'PUMP1SPEED',      names: ['pump1speed'],      kind: 'pct',    unit: ' %',  x: 528, y: 358, w: 72 },
    { id: 'wpP1Run',     slot: 'chilledPumps',   cap: 'PUMP1RUNSTATUS',  names: ['pump1runstatus'],  kind: 'status', unit: '',    x: 622, y: 372, w: 88 },
    { id: 'wpP2Speed',   slot: 'chilledPumps',   cap: 'PUMP2SPEED',      names: ['pump2speed'],      kind: 'pct',    unit: ' %',  x: 528, y: 466, w: 72 },
    { id: 'wpP2Run',     slot: 'chilledPumps',   cap: 'PUMP2RUNSTATUS',  names: ['pump2runstatus'],  kind: 'status', unit: '',    x: 612, y: 546, w: 88 },
    { id: 'chRun',       slot: 'chiller',        cap: 'RUNSTATUS',       names: ['runstatus'],       kind: 'status', unit: '',    x: 376, y: 802, w: 146 },
    { id: 'chChwsTemp',  slot: 'chiller',        cap: 'CHWSTEMP',        names: ['chwstemp'],        kind: 'temp',   unit: ' °C', x: 580, y: 656, w: 62,  read: 'uncertain' },
    { id: 'chChwrTemp',  slot: 'chiller',        cap: 'CHWRTEMP',        names: ['chwrtemp'],        kind: 'temp',   unit: ' °C', x: 578, y: 816, w: 66,  read: 'uncertain' },
    { id: 'blRun',       slot: 'boiler',         cap: 'RUNSTATUS',       names: ['runstatus'],       kind: 'status', unit: '',    x: 880, y: 480, w: 76 },
    { id: 'blHwsTemp',   slot: 'boiler',         cap: 'HWSTEMP',         names: ['hwstemp'],         kind: 'temp',   unit: ' °C', x: 1040, y: 372, w: 62, read: 'uncertain' },
    { id: 'blHwrTemp',   slot: 'boiler',         cap: 'HWRTEMP',         names: ['hwrtemp'],         kind: 'temp',   unit: ' °C', x: 752, y: 370, w: 62,  read: 'uncertain' }
  ];

  /* the overview panels along the top: rows are label + value, drawn like the FIN screen's overview tables */
  var PANELS = [
    { id: 'ct', title: 'Cooling Tower Overview', slot: 'coolingTower', x: 68, w: 148, rows: [
      { id: 'ctFanEnable', cap: 'FANENABLECMD', names: ['fanenablecmd'], kind: 'text' },
      { id: 'ctFanTrip',   cap: 'FANTRIP',      names: ['fantrip'],      kind: 'text' },
      { id: 'ctHoa',       cap: 'HOA',          names: ['hoa'],          kind: 'text' },
      { id: 'ctCwLeaveSp', cap: 'CWLEAVINGTEMPSP', names: ['cwleavingtempsp'], kind: 'temp', unit: ' °C', read: 'uncertain' }] },
    { id: 'cp', title: 'Condenser Pumps Overview', slot: 'condenserPumps', x: 222, w: 148, rows: [
      { id: 'cpP1Cmd',  cap: 'PUMP1CMD',  names: ['pump1cmd'],  kind: 'text' },
      { id: 'cpP1Trip', cap: 'PUMP1TRIP', names: ['pump1trip'], kind: 'text' },
      { id: 'cpP2Cmd',  cap: 'PUMP2CMD',  names: ['pump2cmd'],  kind: 'text' },
      { id: 'cpP2Trip', cap: 'PUMP2TRIP', names: ['pump2trip'], kind: 'text' }] },
    { id: 'ch', title: 'Chiller Overview', slot: 'chiller', x: 378, w: 162, rows: [
      { id: 'chEnable', cap: 'ENABLECMD',      names: ['enablecmd'],      kind: 'text' },
      { id: 'chHours',  cap: 'OPERATINGHOURS', names: ['operatinghours'], kind: 'num', unit: ' h', read: 'uncertain' },
      { id: 'chPower',  cap: 'POWER',          names: ['power'],          kind: 'num', unit: ' kW' },
      { id: 'chAlarm',  cap: 'ALARMSTATUS',    names: ['alarmstatus'],    kind: 'text' }] },
    { id: 'wp', title: 'Chilled Water Pumps Overview', slot: 'chilledPumps', x: 548, w: 195, rows: [
      { id: 'wpDemand', cap: 'COOLINGDEMAND', names: ['coolingdemand'], kind: 'pct', unit: ' %' },
      { id: 'wpP1Cmd',  cap: 'PUMP1CMD',      names: ['pump1cmd'],      kind: 'text' },
      { id: 'wpP2Cmd',  cap: 'PUMP2CMD',      names: ['pump2cmd'],      kind: 'text', read: 'uncertain' },
      { id: 'wpP1Trip', cap: 'PUMP1TRIP',     names: ['pump1trip'],     kind: 'text' },
      { id: 'wpP2Trip', cap: 'PUMP2TRIP',     names: ['pump2trip'],     kind: 'text' }] },
    { id: 'bl', title: 'Boiler Overview', slot: 'boiler', x: 752, w: 178, rows: [
      { id: 'blAlarm',  cap: 'ALARMSTATUS', names: ['alarmstatus'], kind: 'text' },
      { id: 'blEnable', cap: 'ENABLECMD',   names: ['enablecmd'],   kind: 'text' },
      { id: 'blPower',  cap: 'POWER',       names: ['power'],       kind: 'num', unit: ' kW' },
      { id: 'blHwsSp',  cap: 'HWSTEMPSP',   names: ['hwstempsp'],   kind: 'temp', unit: ' °C', read: 'uncertain' }] },
    { id: 'bt', title: 'BTU Overview', slot: 'btu', x: 938, w: 197, rows: [
      { id: 'btFlow',   cap: 'CHWFLOW',       names: ['chwflow'],       kind: 'num',  unit: ' L/s', read: 'uncertain' },
      { id: 'btPower',  cap: 'COOLINGPOWER',  names: ['coolingpower'],  kind: 'num',  unit: ' kW',  read: 'uncertain' },
      { id: 'btRet',    cap: 'CHWRETURNTEMP', names: ['chwreturntemp'], kind: 'temp', unit: ' °C',  read: 'uncertain' },
      { id: 'btSup',    cap: 'CHWSUPPLYTEMP', names: ['chwsupplytemp'], kind: 'temp', unit: ' °C',  read: 'uncertain' }] }
  ];
  var PANEL_Y = 200, ROW_H = 17;

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

  var WHY = {
    unconfirmed: 'The equipment for this value is not confirmed yet',
    'not-in-feed': 'The confirmed equipment is not in the live FIN feed',
    'no-point': 'The equipment does not report this point',
    'not-reporting': 'FIN reports this point as not reporting',
    invalid: 'FIN sent a value that does not fit this reading',
    live: 'Live from FIN'
  };

  /* One item's reading: { state, text, raw, status, pointName } — state live only with a verified source, else "—" */
  function readItem(item, slot) {
    var out = { id: item.id, state: 'unconfirmed', text: '—', raw: null, status: null, pointName: null };
    if (!slot || slot.state !== 'ok') { out.state = slot && slot.state === 'not-in-feed' ? 'not-in-feed' : 'unconfirmed'; return out; }
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
      out.state = 'live'; out.text = format(item.kind, n2, item.unit); return out;
    }
    if (item.kind === 'status') { out.status = statusOf(raw); }
    out.state = 'live'; out.text = raw; return out;
  }

  /* Everything the drawing shows, from the live assets. The slot list and items are the module's own unless given (tests). */
  function model(assets, slots, items, panels) {
    var sl = resolveSlots(assets, slots);
    var by = {}; sl.forEach(function (s) { by[s.id] = s; });
    var all = (items || ITEMS).map(function (it) { return merge(it, readItem(it, by[it.slot])); });
    var pn = (panels || PANELS).map(function (p) {
      return { id: p.id, title: p.title, slot: p.slot, x: p.x, w: p.w, rows: p.rows.map(function (r) {
        return merge(merge(r, { slot: p.slot }), readItem(r, by[p.slot]));
      }) };
    });
    return { slots: sl, items: all, panels: pn };
  }
  function merge(a, b) { var o = {}, k; for (k in a) o[k] = a[k]; for (k in b) o[k] = b[k]; return o; }

  /* Candidate equipment in the feed for a slot: suggestions for whoever confirms the mapping; never used to read a value */
  function candidates(assets, slot) {
    var out = [];
    (Array.isArray(assets) ? assets : []).forEach(function (a) {
      if (!a) return;
      var key = fold(a.id) + ' ' + fold(a.typeEn);
      if (slot.hints.some(function (h) { return key.indexOf(h) !== -1; })) out.push(a.id);
    });
    return out.slice(0, 6);
  }

  /* ── drawing ── */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  var COL = { green: '#3fae49', blue: '#2b8cee', blueDark: '#2a6fb8', red: '#e53030', redDark: '#9c3b3b', body: '#b9bdc4', bodyDark: '#4a4f57', line: '#8d929b' };
  var STATE_FILL = { live: '#1a35b4', on: '#1d8f3f', off: '#555d73', fault: '#c62828', na: '#8791ad' };

  function pipe(d, color, extra) { return '<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="7" stroke-linejoin="round" stroke-linecap="butt"' + (extra || '') + '/>'; }

  function accentOf(m, slotId) {
    var run = null;
    m.items.forEach(function (it) { if (it.slot === slotId && it.kind === 'status' && it.state === 'live') run = run || it.status; });
    return run === 'on' ? STATE_FILL.on : run === 'fault' ? STATE_FILL.fault : run === 'off' ? '#7b8190' : COL.line;
  }

  function valueBox(it) {
    var h = 18, ch = 13, fill = it.state === 'live' ? (it.kind === 'status' && STATE_FILL[it.status] ? STATE_FILL[it.status] : STATE_FILL.live) : STATE_FILL.na;
    var tip = (WHY[it.state] || WHY.unconfirmed) + (it.pointName ? ' (' + it.pointName + ')' : '') + (it.read === 'uncertain' ? ' · name read from the FIN photo, to be confirmed' : '');
    return '<g class="rf-val" data-item="' + it.id + '" data-state="' + it.state + '"' + (it.status ? ' data-status="' + it.status + '"' : '') + '><title>' + esc(it.cap + ': ' + tip) + '</title>'
      + '<rect x="' + it.x + '" y="' + it.y + '" width="' + it.w + '" height="' + ch + '" fill="#d3d6dc" stroke="#a9adb5" stroke-width=".8"/>'
      + '<circle cx="' + (it.x + 7) + '" cy="' + (it.y + 6.5) + '" r="3.2" fill="#5775bd"/>'
      + '<text x="' + (it.x + 14) + '" y="' + (it.y + 9.4) + '" font-size="7" font-weight="700" fill="#2b2f36" class="rf-cap">' + esc(it.cap) + '</text>'
      + '<rect x="' + it.x + '" y="' + (it.y + ch) + '" width="' + it.w + '" height="' + h + '" fill="' + fill + '"/>'
      + '<text x="' + (it.x + it.w / 2) + '" y="' + (it.y + ch + 12.6) + '" font-size="11" font-weight="700" text-anchor="middle" fill="#fff" class="rf-txt">' + esc(it.text) + '</text></g>';
  }

  function panel(p) {
    var h = 24 + p.rows.length * ROW_H;
    var s = '<g class="rf-panel" data-panel="' + p.id + '"><rect x="' + p.x + '" y="' + PANEL_Y + '" width="' + p.w + '" height="' + h + '" fill="#dfe1e6" stroke="#b5b9c1" stroke-width=".8"/>'
      + '<circle cx="' + (p.x + 9) + '" cy="' + (PANEL_Y - 9) + '" r="5.5" fill="#2a4ea8"/>'
      + '<text x="' + (p.x + 19) + '" y="' + (PANEL_Y - 5.5) + '" font-size="8.5" font-weight="700" fill="#27304a">' + esc(p.title) + '</text>';
    p.rows.forEach(function (r, i) {
      var y = PANEL_Y + 8 + i * ROW_H, vw = 46;
      var fill = r.state === 'live' ? (r.kind === 'status' && STATE_FILL[r.status] ? STATE_FILL[r.status] : STATE_FILL.live) : STATE_FILL.na;
      var tip = (WHY[r.state] || WHY.unconfirmed) + (r.pointName ? ' (' + r.pointName + ')' : '') + (r.read === 'uncertain' ? ' · name read from the FIN photo, to be confirmed' : '');
      s += '<g class="rf-val" data-item="' + r.id + '" data-state="' + r.state + '"><title>' + esc(r.cap + ': ' + tip) + '</title>'
        + '<circle cx="' + (p.x + 9) + '" cy="' + (y + 7) + '" r="3" fill="#7d8bb0"/>'
        + '<text x="' + (p.x + 17) + '" y="' + (y + 10) + '" font-size="7" font-weight="700" fill="#2b2f36" class="rf-cap">' + esc(r.cap) + '</text>'
        + '<rect x="' + (p.x + p.w - vw - 5) + '" y="' + y + '" width="' + vw + '" height="14" fill="' + fill + '"/>'
        + '<text x="' + (p.x + p.w - vw / 2 - 5) + '" y="' + (y + 10.5) + '" font-size="9" font-weight="700" text-anchor="middle" fill="#fff" class="rf-txt">' + esc(r.text) + '</text></g>';
    });
    return s + '</g>';
  }

  function eq(m, slotId, inner, bbox) {
    var slot = null; m.slots.forEach(function (s) { if (s.id === slotId) slot = s; });
    var click = slot && slot.state === 'ok';
    var label = slot ? slot.label : slotId;
    return '<g class="rf-eq" data-slot="' + slotId + '" data-state="' + (slot ? slot.state : 'unconfirmed') + '"'
      + (click ? ' data-act="roofAsset" data-asset="' + esc(slot.equip) + '" tabindex="0" role="button" aria-label="' + esc(label + ': open asset ' + slot.equip) + '"'
               : ' role="img" aria-label="' + esc(label + ': equipment requires confirmation') + '"')
      + '><title>' + esc(click ? label + ' · ' + slot.equip : label + ' · equipment requires confirmation') + '</title>'
      + '<rect x="' + bbox[0] + '" y="' + bbox[1] + '" width="' + bbox[2] + '" height="' + bbox[3] + '" fill="transparent" class="rf-hit"/>'
      + inner + '</g>';
  }

  function pumpSym(cx, cy, accent) {
    return '<g><rect x="' + (cx - 34) + '" y="' + (cy - 14) + '" width="30" height="28" rx="3" fill="#2a63b4" stroke="' + accent + '" stroke-width="2"/>'
      + '<rect x="' + (cx - 40) + '" y="' + (cy - 8) + '" width="8" height="16" fill="#8f949c"/>'
      + '<circle cx="' + (cx + 6) + '" cy="' + cy + '" r="17" fill="#c9ccd2" stroke="' + accent + '" stroke-width="2"/>'
      + '<path d="M' + (cx - 1) + ',' + (cy - 9) + ' L' + (cx + 15) + ',' + cy + ' L' + (cx - 1) + ',' + (cy + 9) + ' Z" fill="#5d6470"/></g>';
  }

  /* the SVG markup for a model (a string: the page and the tests read the same thing) */
  function svg(m) {
    var a = function (id) { return accentOf(m, id); };
    var s = '<svg class="rf-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + VB.w + ' ' + VB.h + '" preserveAspectRatio="xMidYMid meet" role="group" aria-label="Hospital Roof HVAC schematic" font-family="Arial, Helvetica, sans-serif">'
      + '<rect width="' + VB.w + '" height="' + VB.h + '" fill="#e6e7ea"/>';
    /* title */
    s += '<g><rect x="415" y="143" width="206" height="30" fill="#d3d5da" stroke="#a9adb5"/><circle cx="427" cy="158" r="6" fill="#2a4ea8"/>'
      + '<text x="518" y="162" font-size="11" font-weight="700" text-anchor="middle" fill="#2b2f36">HOSPITAL ROOF</text></g>';
    m.panels.forEach(function (p) { s += panel(p); });
    /* pipes under the equipment */
    s += '<g class="rf-pipes">'
      + pipe('M112,368 H45 V795 H330', COL.green)
      + pipe('M335,372 H415 V610 H70 V795', COL.green)
      + pipe('M70,665 H240 V728 H70', COL.green)
      + pipe('M575,715 H685 V618 H440 V424 H505 V528', COL.blue)
      + pipe('M505,424 H540 M505,528 H550', COL.blue)
      + pipe('M603,424 H690 V528 H607', COL.blue)
      + pipe('M690,447 H765 V570', COL.blue)
      + pipe('M760,655 V785 H575', COL.blueDark)
      + pipe('M805,425 V515 H835 V570', COL.redDark)
      + pipe('M1030,430 H1040 V610 H890', COL.red)
      + '</g>';
    /* central building systems */
    s += '<g class="rf-sys"><rect x="720" y="570" width="86" height="86" fill="#6db7f4" stroke="#4a86bd"/><rect x="806" y="570" width="86" height="86" fill="#f28080" stroke="#c25b5b"/>'
      + '<text x="763" y="610" font-size="7.5" font-weight="700" text-anchor="middle" fill="#1b2a44">BUILDING CHILLED</text><text x="763" y="620" font-size="7.5" font-weight="700" text-anchor="middle" fill="#1b2a44">WATER SYSTEM</text>'
      + '<text x="849" y="610" font-size="7.5" font-weight="700" text-anchor="middle" fill="#4a1b1b">BUILDING HOT WATER</text><text x="849" y="620" font-size="7.5" font-weight="700" text-anchor="middle" fill="#4a1b1b">SYSTEM</text>'
      + '<text x="727" y="556" font-size="7" fill="#4b5160">Supply</text><text x="727" y="666" font-size="7" fill="#4b5160">Return</text></g>';
    /* cooling tower */
    var fan = ''; for (var i = 0; i < 6; i++) fan += '<ellipse cx="222" cy="388" rx="38" ry="8" transform="rotate(' + (i * 30) + ' 222 388)" fill="#d8dadf" stroke="#6b707a" stroke-width=".8"/>';
    var louvres = ''; for (var j = 0; j < 9; j++) louvres += '<line x1="114" y1="' + (440 + j * 9) + '" x2="332" y2="' + (440 + j * 9) + '" stroke="#8f949c" stroke-width="1.2"/>';
    s += eq(m, 'coolingTower',
      '<rect x="110" y="340" width="226" height="190" fill="' + COL.body + '" stroke="' + a('coolingTower') + '" stroke-width="3"/><rect x="110" y="340" width="226" height="86" fill="#c9ccd2" stroke="#7d828b"/>'
      + '<circle cx="222" cy="388" r="44" fill="#7a808a" stroke="#555a63" stroke-width="2"/>' + fan + '<circle cx="222" cy="388" r="7" fill="#444a53"/>' + louvres
      + '<rect x="110" y="524" width="226" height="12" fill="' + COL.bodyDark + '"/>', [104, 336, 238, 204]);
    /* condenser pumps */
    s += eq(m, 'condenserPumps', pumpSym(172, 665, a('condenserPumps')) + pumpSym(172, 728, a('condenserPumps')), [96, 640, 160, 110]);
    /* chiller */
    s += eq(m, 'chiller',
      '<rect x="330" y="708" width="240" height="78" rx="22" fill="#2f343b" stroke="' + a('chiller') + '" stroke-width="3"/>'
      + '<rect x="334" y="690" width="150" height="40" rx="6" fill="#cfd2d8" stroke="#7d828b"/><rect x="484" y="684" width="90" height="60" rx="4" fill="#b8bcc4" stroke="#7d828b"/>'
      + '<circle cx="528" cy="714" r="20" fill="#d9dbe0" stroke="#6b707a"/><rect x="334" y="786" width="236" height="10" fill="' + COL.bodyDark + '"/>', [326, 680, 252, 120]);
    /* chilled water pumps */
    s += eq(m, 'chilledPumps', pumpSym(580, 424, a('chilledPumps')) + pumpSym(590, 528, a('chilledPumps')), [536, 394, 150, 160]);
    /* boiler */
    s += eq(m, 'boiler',
      '<rect x="820" y="342" width="205" height="136" fill="#262a30" stroke="' + a('boiler') + '" stroke-width="3"/><rect x="896" y="312" width="56" height="34" fill="#c7cad0" stroke="#7d828b"/>'
      + '<ellipse cx="924" cy="312" rx="28" ry="9" fill="#d9dbe0" stroke="#7d828b"/><ellipse cx="924" cy="312" rx="16" ry="5" fill="#555a63"/>'
      + '<rect x="850" y="454" width="140" height="8" fill="#f0a030"/><rect x="850" y="462" width="140" height="6" fill="#d6541c"/>', [816, 304, 214, 178]);
    /* BTU meter on the return pipe */
    s += eq(m, 'btu', '<rect x="690" y="768" width="42" height="34" rx="5" fill="#2f343b" stroke="' + a('btu') + '" stroke-width="2.5"/><text x="711" y="790" font-size="10" font-weight="700" text-anchor="middle" fill="#e9eaee">BTU</text>', [686, 764, 50, 42]);
    m.items.forEach(function (it) { s += valueBox(it); });
    return s + '</svg>';
  }

  /* ── the popup (DOM): same frame as the O&M / warranty popup (#docov), so Escape and navigation close it ── */
  var ov = null, vb = null, raf = 0, onData = null;

  function E() { return root && root.EKO; }
  function tr(key, fb) { var e = E(), v = e && e.t ? e.t(key) : key; return v && v !== key ? v : fb; }
  function assets() { var e = E(); return (e && e.data && e.data.assets) || []; }

  function mappingList(m) {
    var as = assets();
    var rows = m.slots.map(function (s) {
      var n = m.items.concat([].concat.apply([], m.panels.map(function (p) { return p.rows; }))).filter(function (it) { return it.slot === s.id; });
      var live = n.filter(function (it) { return it.state === 'live'; }).length;
      var cand = s.state === 'unconfirmed' ? candidates(as, SLOTS.filter(function (x) { return x.id === s.id; })[0]) : [];
      return '<li data-slot="' + s.id + '" data-state="' + s.state + '"><b>' + esc(s.label) + '</b> · '
        + (s.state === 'ok' ? esc(tr('roofConfirmed', 'Confirmed')) + ': ' + esc(s.equip) : s.state === 'not-in-feed' ? esc(tr('roofNotInFeed', 'Confirmed equipment not in the live feed')) + ': ' + esc(s.equip) : esc(tr('roofUnconfirmed', 'Requires confirmation')))
        + ' · ' + live + '/' + n.length + ' ' + esc(tr('roofLive', 'values live'))
        + (cand.length ? '<br><span class="tCap">' + esc(tr('roofCandidates', 'Candidates in the FIN feed (suggestions only)')) + ': ' + esc(cand.join(', ')) + '</span>' : '') + '</li>';
    }).join('');
    return '<ul class="roofmaplist">' + rows + '</ul><p class="tCap">' + esc(tr('roofMapNote', 'Point names were read from a photo of the FIN screen and are expectations until checked against FIN. A value is shown only for confirmed equipment and an exactly matching point.')) + '</p>';
  }

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

  function paint() {
    if (!ov) return;
    var m = model(assets());
    var holder = ov.querySelector('.roofsvg');
    if (holder) { holder.innerHTML = svg(m); applyViewBox(); }
    var map = ov.querySelector('.roofmapbody');
    if (map) map.innerHTML = mappingList(m);
  }
  function schedule() {
    if (!ov || raf) return;
    raf = (root.requestAnimationFrame || function (f) { return setTimeout(f, 16); })(function () { raf = 0; paint(); });
  }

  function close() {
    var el = root.document.getElementById('docov');
    if (el) el.remove();
    ov = null; vb = null;
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
      + '<div class="roofbody"><div class="roofsvg"></div>'
      + '<details class="roofmap"><summary>' + esc(tr('roofMapping', 'Mapping status')) + '</summary><div class="roofmapbody"></div></details></div></div>';
    ov.addEventListener('click', function (ev) {
      if (ev.target === ov) { close(); return; }
      var b = ev.target.closest && ev.target.closest('[data-rf]');
      if (!b) return;
      if (b.dataset.rf === 'in') zoom(1.4); else if (b.dataset.rf === 'out') zoom(1 / 1.4); else fit();
    });
    ov.addEventListener('keydown', function (ev) {
      var g = ev.target.closest && ev.target.closest('.rf-eq[data-act]');
      if (g && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); g.dispatchEvent(new root.MouseEvent('click', { bubbles: true })); }
    });
    ov.addEventListener('wheel', function (ev) {
      var holder = ov.querySelector('.roofsvg'); if (!holder || !holder.contains(ev.target)) return;
      ev.preventDefault();
      var r = holder.getBoundingClientRect();
      zoom(ev.deltaY < 0 ? 1.15 : 1 / 1.15, (ev.clientX - r.left) / r.width, (ev.clientY - r.top) / r.height);
    }, { passive: false });
    ov.addEventListener('pointerdown', function (ev) {
      var holder = ov.querySelector('.roofsvg');
      if (ev.button !== 0 || !holder || !holder.contains(ev.target) || (ev.target.closest && ev.target.closest('.rf-eq[data-act]')) || !vb || vb.w >= VB.w) return;
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
    fit(); paint();
    onData = function () { if (!root.document.getElementById('docov') || !ov) { close(); return; } schedule(); };
    root.addEventListener('dashboard-data', onData);
    var x = ov.querySelector('.docx'); if (x) x.focus();
  }

  return {
    VB: VB, SLOTS: SLOTS, ITEMS: ITEMS, PANELS: PANELS,
    fold: fold, clean: clean, number: number, statusOf: statusOf, resolveSlots: resolveSlots, readItem: readItem,
    model: model, candidates: candidates, svg: svg, open: open, close: close, refresh: schedule
  };
});
