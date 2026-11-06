/* The Eko Hospital roof plant: cooling tower, condenser water pumps, chiller, chilled water pumps, boiler and BTU meter, laid out after the client's reference
   videos of the screen they expect. The machines are drawn in hospital-roof-equipment.js, the pipework here is SVG routed between the nozzles of those drawings, and
   every tag beside a machine is a live FIN point. Only for a project whose Hospital graphics are on
   (INJECTED_PROJECT_CONFIG.hospitalHvac, set by the Studio for the ekoHospital FIN project); opened from the Assets register.

   WHERE EVERY VALUE COMES FROM. The dashboard's own live equipment feed (E.data.assets, filled by the same FIN polling as every asset panel). A tag
   shows a value only when all of these hold; otherwise it says why it has none and the machine stays drawn:
     1. its equipment is found in the feed: SLOTS below, by FIN name or tags, preferring equipment on the roof floor (`equip` pins a FIN name instead);
     2. one of the point's `names` equals a point name of that equipment (folded: lower case, letters and digits only; never a partial name);
     3. FIN is connected, the equipment is not stale, and the point is reporting a value that fits its kind.
   Nothing is invented: a fan or impeller turns and a boiler fires only while its own run status says On, the BTU wheel turns only while its measured flow is above zero,
   and a pipe flows only while what drives it runs. The hot loop has no pump on the screen, so it follows the boiler's run status; chilled water follows the BTU meter's
   flow when it has one.

   MAPPING STATUS. The point names were read from a photo of the FIN screen (the reference videos are too coarse to read the captions) and have not been checked against a live FIN server. A tag that says
   Unmapped names what it looked for in its tooltip: correct `names` here, or pin the equipment with `equip`. */
(function (root, factory) {
  var api = factory(root && root.EKO_ROOF_ART);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.document) root.EKO_ROOF = api;
})(typeof window !== 'undefined' ? window : null, function (ART_LIB) {
  'use strict';

  var VIEW = { x: -6, y: -16, w: 1452, h: 822 };

  /* ── mapping: which FIN equipment is each machine, and which of its points does the drawing read ── */
  function nameOf(asset) { return String((asset && asset.id) || ''); }
  function fold(name) { return String(name == null ? '' : name).toLowerCase().replace(/[^a-z0-9]/g, ''); }
  function hasTag(asset, tag) { return ((asset && asset.tags) || []).indexOf(tag) !== -1; }
  var NOT_PLANT = /fcu|fancoil|ahu|fahu|mahu|vav/;
  var SLOTS = [
    { id: 'coolingTower', equip: null, match: function (a, f) { return f.indexOf('coolingtower') !== -1 || /^ct(\d|$)/.test(f) || hasTag(a, 'coolingTower'); } },
    { id: 'condenserPumps', equip: null, match: function (a, f) { return /cdwp|cwp|cndp/.test(f) || (/pump/.test(f) && /condenser|cdw|cnd|^cw/.test(f)) || (hasTag(a, 'pump') && hasTag(a, 'condenser')); } },
    { id: 'chiller', equip: null, match: function (a, f) { return (f.indexOf('chiller') !== -1 && f.indexOf('pump') === -1) || /^ch\d/.test(f) || hasTag(a, 'chiller'); } },
    { id: 'chilledPumps', equip: null, match: function (a, f) { return f.indexOf('chwp') !== -1 || (/pump/.test(f) && /chilled|chw/.test(f)) || (hasTag(a, 'pump') && hasTag(a, 'chilled')); } },
    { id: 'boiler', equip: null, match: function (a, f) { return f.indexOf('boiler') !== -1 || /^blr/.test(f) || hasTag(a, 'boiler'); } },
    { id: 'btu', equip: null, match: function (a, f) { return f.indexOf('btu') !== -1 || hasTag(a, 'btu'); } }
  ];

  /* kind decides what a valid value is. temp: number -50..200 · pct: number 0..100 · num: any number · status: run status text · text: any text */
  var ITEMS = [
    { id: 'ctEnter',  slot: 'coolingTower',   cap: 'CWENTERINGTEMP', names: ['cwenteringtemp', 'cwentertemp', 'cdwenteringtemp', 'condenteringtemp'],   kind: 'temp' },
    { id: 'ctLeave',  slot: 'coolingTower',   cap: 'CWLEAVINGTEMP',  names: ['cwleavingtemp', 'cwleavetemp', 'cdwleavingtemp', 'condleavingtemp'],    kind: 'temp' },
    { id: 'ctSpeed',  slot: 'coolingTower',   cap: 'FANSPEED',       names: ['fanspeed'],                        kind: 'pct' },
    { id: 'ctRun',    slot: 'coolingTower',   cap: 'FANRUNSTATUS',   names: ['fanrunstatus'],                    kind: 'status', trip: 'ctTrip' },
    { id: 'ctTrip',   slot: 'coolingTower',   cap: 'FANTRIP',        names: ['fantrip'],                         kind: 'text' },
    { id: 'cp1Run',   slot: 'condenserPumps', cap: 'PUMP1RUNSTATUS', names: ['pump1runstatus'],                  kind: 'status', trip: 'cp1Trip' },
    { id: 'cp1Speed', slot: 'condenserPumps', cap: 'PUMP1SPEED',     names: ['pump1speed'],                      kind: 'pct' },
    { id: 'cp1Trip',  slot: 'condenserPumps', cap: 'PUMP1TRIP',      names: ['pump1trip'],                       kind: 'text' },
    { id: 'cp2Run',   slot: 'condenserPumps', cap: 'PUMP2RUNSTATUS', names: ['pump2runstatus'],                  kind: 'status', trip: 'cp2Trip' },
    { id: 'cp2Speed', slot: 'condenserPumps', cap: 'PUMP2SPEED',     names: ['pump2speed'],                      kind: 'pct' },
    { id: 'cp2Trip',  slot: 'condenserPumps', cap: 'PUMP2TRIP',      names: ['pump2trip'],                       kind: 'text' },
    { id: 'chRun',    slot: 'chiller',        cap: 'RUNSTATUS',      names: ['runstatus'],                       kind: 'status', trip: 'chAlarm' },
    { id: 'chAlarm',  slot: 'chiller',        cap: 'ALARMSTATUS',    names: ['alarmstatus'],                     kind: 'text' },
    { id: 'chSupply', slot: 'chiller',        cap: 'CHWSTEMP',       names: ['chwstemp', 'chwsupplytemp'],       kind: 'temp' },
    { id: 'chReturn', slot: 'chiller',        cap: 'CHWRTEMP',       names: ['chwrtemp', 'chwreturntemp'],       kind: 'temp' },
    { id: 'wp1Run',   slot: 'chilledPumps',   cap: 'PUMP1RUNSTATUS', names: ['pump1runstatus'],                  kind: 'status', trip: 'wp1Trip' },
    { id: 'wp1Speed', slot: 'chilledPumps',   cap: 'PUMP1SPEED',     names: ['pump1speed'],                      kind: 'pct' },
    { id: 'wp1Trip',  slot: 'chilledPumps',   cap: 'PUMP1TRIP',      names: ['pump1trip'],                       kind: 'text' },
    { id: 'wp2Run',   slot: 'chilledPumps',   cap: 'PUMP2RUNSTATUS', names: ['pump2runstatus'],                  kind: 'status', trip: 'wp2Trip' },
    { id: 'wp2Speed', slot: 'chilledPumps',   cap: 'PUMP2SPEED',     names: ['pump2speed'],                      kind: 'pct' },
    { id: 'wp2Trip',  slot: 'chilledPumps',   cap: 'PUMP2TRIP',      names: ['pump2trip'],                       kind: 'text' },
    { id: 'wpDemand', slot: 'chilledPumps',   cap: 'COOLINGDEMAND',  names: ['coolingdemand'],                   kind: 'pct' },
    { id: 'blRun',    slot: 'boiler',         cap: 'RUNSTATUS',      names: ['runstatus'],                       kind: 'status', trip: 'blAlarm', hot: true },
    { id: 'blAlarm',  slot: 'boiler',         cap: 'ALARMSTATUS',    names: ['alarmstatus'],                     kind: 'text' },
    { id: 'blSupply', slot: 'boiler',         cap: 'HWSTEMP',        names: ['hwstemp', 'hwsupplytemp'],         kind: 'temp' },
    { id: 'blReturn', slot: 'boiler',         cap: 'HWRTEMP',        names: ['hwrtemp', 'hwreturntemp'],         kind: 'temp' },
    { id: 'btFlow',   slot: 'btu',            cap: 'CHWFLOW',        names: ['chwflow'],                         kind: 'num' },
    { id: 'btPower',  slot: 'btu',            cap: 'COOLINGPOWER',   names: ['coolingpower'],                    kind: 'num' }
  ];

  /* what turns or fires: each follows its own run status. speed: the point that sets how fast it is drawn turning */
  var PARTS = [
    { id: 'fan',     run: 'ctRun',  speed: 'ctSpeed' },
    { id: 'cp1',     run: 'cp1Run', speed: 'cp1Speed' },
    { id: 'cp2',     run: 'cp2Run', speed: 'cp2Speed' },
    { id: 'chiller', run: 'chRun' },
    { id: 'wp1',     run: 'wp1Run', speed: 'wp1Speed' },
    { id: 'wp2',     run: 'wp2Run', speed: 'wp2Speed' },
    { id: 'boiler',  run: 'blRun' }
  ];
  var BY_ID = {};
  ITEMS.forEach(function (i) { BY_ID[i.id] = i; });

  /* ── reading a value (pure: no DOM) ── */
  function clean(v) {
    if (v == null) return null;
    var s = String(v).trim();
    if (!s || s === '—' || s === '--' || /^(n\/a|null|nan|undefined)$/i.test(s)) return null;
    return s;
  }
  var RANGE = { temp: [-50, 200], pct: [0, 100] };
  var ON = /^(on|run|running|started|start|true|active|yes|1)$/i;
  var OFF = /^(off|stop|stopped|false|inactive|no|0)$/i;
  var FAULT = /^(fault|faulted|trip|tripped|alarm|fail|failed)$/i;
  var HEALTHY = /^(normal|ok|off|clear|cleared|none|false|inactive|no|0)$/i;
  function statusOf(raw) {
    var s = String(raw == null ? '' : raw).trim();
    if (FAULT.test(s)) return 'fault';
    if (ON.test(s)) return 'on';
    if (OFF.test(s)) return 'off';
    return 'unknown';
  }

  /* The FIN equipment behind a machine. Several candidates are all kept (one may be a panel of the other): a point must then be on exactly one of them. */
  function resolveSlot(slot, assets) {
    var list = Array.isArray(assets) ? assets : [], found;
    if (slot.equip) {
      found = list.filter(function (a) { return a && fold(nameOf(a)) === fold(slot.equip); });
    } else {
      found = list.filter(function (a) {
        if (!a) return false;
        var f = fold(nameOf(a));
        return !NOT_PLANT.test(f) && slot.match(a, f);
      });
      var onRoof = found.filter(function (a) { return /roof/i.test(String(a.floor || '')); });
      if (onRoof.length) found = onRoof;
    }
    return { id: slot.id, assets: found };
  }

  /* One point's reading: { state, text, num, status, equip, pointName }. state: live · no-equip · no-point · ambiguous · disconnected · stale · not-reporting · invalid */
  function readItem(item, slot, connected) {
    var out = { id: item.id, state: 'no-equip', text: null, num: null, status: null, equip: null, pointName: null };
    /* with FIN gone the feed is empty or old, so a machine missing from it says nothing about the mapping: that is Offline, not Unmapped */
    if (connected === false) out.state = 'disconnected';
    if (!slot || !slot.assets.length) return out;
    var hits = [];
    slot.assets.forEach(function (a) {
      for (var n = 0; n < item.names.length; n++) {
        var p = (a.points || []).filter(function (x) { return x && fold(x.navName) === item.names[n]; })[0];
        if (p) { hits.push({ asset: a, point: p }); return; }
      }
    });
    if (!hits.length) { if (connected !== false) out.state = 'no-point'; return out; }
    if (hits.length > 1) { if (connected !== false) out.state = 'ambiguous'; return out; }
    var a = hits[0].asset, p = hits[0].point;
    out.equip = nameOf(a); out.pointName = p.navName;
    if (connected === false) { out.state = 'disconnected'; return out; }
    if (a.st === 'stale') { out.state = 'stale'; return out; }
    if (p.reporting === false) { out.state = 'not-reporting'; return out; }
    var raw = clean(p.text) || clean(p.currentValue);
    if (raw == null) { out.state = 'not-reporting'; return out; }
    if (item.kind === 'temp' || item.kind === 'pct' || item.kind === 'num') {
      var m = raw.replace(/,/g, '').match(/^(-?\d+(?:\.\d+)?)\s*(.*)$/);
      var n2 = m ? parseFloat(m[1]) : null, r = RANGE[item.kind];
      if (n2 == null || !isFinite(n2) || (r && (n2 < r[0] || n2 > r[1]))) { out.state = 'invalid'; return out; }
      var unit = m[2] || clean(p.unit) || '';
      out.state = 'live'; out.num = n2; out.text = m[1] + (unit ? ' ' + unit : '');
      return out;
    }
    if (item.kind === 'status') out.status = typeof p.bool === 'boolean' ? (p.bool ? 'on' : 'off') : statusOf(raw);
    out.state = 'live'; out.text = raw;
    return out;
  }

  /* running · stopped · fault · unknown, from a part's own run status; a trip or alarm point in alarm is a fault whatever the status says */
  function partState(part, reads) {
    var r = reads[part.run];
    if (!r || r.state !== 'live') return 'unknown';
    var trip = BY_ID[part.run].trip && reads[BY_ID[part.run].trip];
    if (trip && trip.state === 'live' && !HEALTHY.test(trip.text)) return 'fault';
    return r.status === 'on' ? 'running' : r.status === 'off' ? 'stopped' : r.status === 'fault' ? 'fault' : 'unknown';
  }
  /* A loop's flow from what drives it: any one running = flowing; all known to be stopped = not flowing; else unknown (drawn still, not claimed) */
  function flowOf(states) {
    if (states.indexOf('running') !== -1) return 'on';
    if (states.length && states.every(function (s) { return s === 'stopped' || s === 'fault'; })) return 'off';
    return 'unknown';
  }

  /* Everything the drawing shows, from the live assets. `opts.connected === false`: FIN is not connected, so nothing is read as live. */
  function model(assets, opts) {
    var connected = !(opts && opts.connected === false);
    var slots = {};
    SLOTS.forEach(function (s) { slots[s.id] = resolveSlot(s, assets); });
    var reads = {};
    ITEMS.forEach(function (it) { reads[it.id] = readItem(it, slots[it.slot], connected); });
    var parts = {};
    PARTS.forEach(function (p) { parts[p.id] = partState(p, reads); });
    /* the BTU wheel has no run status: it answers to the flow the meter itself measures, and to nothing else */
    parts.btu = reads.btFlow.state !== 'live' ? 'unknown' : reads.btFlow.num > 0.05 ? 'running' : 'stopped';
    var chilled = flowOf([parts.wp1, parts.wp2]);
    if (reads.btFlow.state === 'live') chilled = reads.btFlow.num > 0.05 ? 'on' : 'off';   /* a measured flow is the evidence */
    var flows = {
      condenser: flowOf([parts.cp1, parts.cp2]), cp1: flowOf([parts.cp1]), cp2: flowOf([parts.cp2]),
      chilled: chilled, wp1: flowOf([parts.wp1]), wp2: flowOf([parts.wp2]), hot: flowOf([parts.boiler])
    };
    /* the equipment a click opens: the candidate that gave the most readings */
    var open = {};
    SLOTS.forEach(function (s) {
      var count = {}, best = null;
      ITEMS.forEach(function (it) {
        var e = it.slot === s.id && reads[it.id].equip;
        if (e) { count[e] = (count[e] || 0) + 1; if (!best || count[e] > count[best]) best = e; }
      });
      open[s.id] = best || (slots[s.id].assets.length === 1 ? nameOf(slots[s.id].assets[0]) : null);
    });
    var live = TAGS.filter(function (t) { return reads[t.id].state === 'live'; }).length;
    return { connected: connected, slots: slots, reads: reads, parts: parts, flows: flows, open: open, live: live, total: TAGS.length };
  }

  /* ── the layout: coordinates are the client's reference screen, straightened (1440 x 800). Each machine is placed here and its pipe ends come from its own ports. ── */
  var MACHINES = ART_LIB.MACHINES;
  var PLACE = {
    coolingTower: { art: 'coolingTower', x: 137, y: 75, s: 1 },
    cp1: { art: 'cwPump', x: 161, y: 503, s: 0.2 },
    cp2: { art: 'cwPump', x: 161, y: 585, s: 0.2 },
    chiller: { art: 'chiller', x: 403, y: 505, s: 0.537 },
    /* the close-up has the motor on the left; the schematic has the volute on the left, so these two are mirrored */
    wp1: { art: 'chwPump', x: 685, y: 136, s: 0.315, flip: true },
    wp2: { art: 'chwPump', x: 680, y: 302, s: 0.315, flip: true },
    boiler: { art: 'boiler', x: 1088, y: 4, s: 0.455 },
    btu: { art: 'btuMeter', x: 838, y: 673.03, s: 0.19 }
  };
  function port(machine, name) {
    var pl = PLACE[machine], a = MACHINES[pl.art], p = a.ports[name];
    return [+((pl.flip ? pl.x + (a.w - p[0]) * pl.s : pl.x + p[0] * pl.s).toFixed(2)), +((pl.y + p[1] * pl.s).toFixed(2))];
  }
  var BUILDING = {
    chilled: { x: 928, y: 380, w: 109, h: 110 },
    hot: { x: 1037, y: 380, w: 110, h: 110 }
  };
  var PORTS = {
    'ct.in': port('coolingTower', 'waterIn'), 'ct.out': port('coolingTower', 'waterOut'),
    'ch.condIn': port('chiller', 'condIn'), 'ch.condOut': port('chiller', 'condOut'), 'ch.chwOut': port('chiller', 'chwOut'), 'ch.chwIn': port('chiller', 'chwIn'),
    'cp1.in': port('cp1', 'left'), 'cp1.out': port('cp1', 'right'), 'cp2.in': port('cp2', 'left'), 'cp2.out': port('cp2', 'right'),
    'wp1.in': port('wp1', 'side'), 'wp1.out': port('wp1', 'top'), 'wp2.in': port('wp2', 'side'), 'wp2.out': port('wp2', 'top'),
    'bl.return': port('boiler', 'hwReturn'), 'bl.supply': port('boiler', 'hwSupply'),
    'bt.in': port('btu', 'right'), 'bt.out': port('btu', 'left'),
    'bcw.supply': [985, BUILDING.chilled.y], 'bcw.return': [985, BUILDING.chilled.y + BUILDING.chilled.h],
    'bhw.supply': [BUILDING.hot.x + BUILDING.hot.w, 425], 'bhw.return': [1088, BUILDING.hot.y]
  };
  /* the tees where a line splits to the two pumps and joins again */
  var TEES = { cwIn: [104, PORTS['ch.condIn'][1]], cwOut: [300, PORTS['ch.condIn'][1]], chwIn: [600, PORTS['wp1.in'][1]], chwOut: [905, 213] };

  /* Each pipe runs in its flow direction: from where the water leaves to where it arrives, by alternating horizontal and vertical legs. */
  function route(from, to, legs) {
    var pts = [from.slice()], cur = from.slice();
    (legs || []).forEach(function (l) {
      if (l[0] === 'H') cur = [l[1], cur[1]]; else cur = [cur[0], l[1]];
      pts.push(cur);
    });
    pts.push(to.slice());
    return pts;
  }
  var P = PORTS;
  var PIPES = [
    /* condenser water: tower → pumps → chiller condenser → back to the tower */
    { id: 'cw-tower-pumps', loop: 'cw', flow: 'condenser', from: 'ct.out', to: 'tee.cwIn', pts: route(P['ct.out'], TEES.cwIn, [['H', 540], ['V', 450], ['H', 58], ['V', TEES.cwIn[1]]]) },
    { id: 'cw-p1-in', loop: 'cw', flow: 'cp1', from: 'tee.cwIn', to: 'cp1.in', pts: route(TEES.cwIn, P['cp1.in'], [['V', P['cp1.in'][1]]]) },
    { id: 'cw-p1-out', loop: 'cw', flow: 'cp1', from: 'cp1.out', to: 'tee.cwOut', pts: route(P['cp1.out'], TEES.cwOut, [['H', TEES.cwOut[0]]]) },
    { id: 'cw-p2-in', loop: 'cw', flow: 'cp2', from: 'tee.cwIn', to: 'cp2.in', pts: route(TEES.cwIn, P['cp2.in'], [['V', P['cp2.in'][1]]]) },
    { id: 'cw-p2-out', loop: 'cw', flow: 'cp2', from: 'cp2.out', to: 'tee.cwOut', pts: route(P['cp2.out'], TEES.cwOut, [['H', TEES.cwOut[0]]]) },
    { id: 'cw-pumps-chiller', loop: 'cw', flow: 'condenser', from: 'tee.cwOut', to: 'ch.condIn', pts: route(TEES.cwOut, P['ch.condIn']) },
    { id: 'cw-chiller-tower', loop: 'cw', flow: 'condenser', from: 'ch.condOut', to: 'ct.in', pts: route(P['ch.condOut'], P['ct.in'], [['H', 378], ['V', 770], ['H', 35], ['V', P['ct.in'][1]]]) },
    /* chilled water: chiller evaporator → pumps → building → BTU meter → back to the chiller */
    { id: 'chw-chiller-pumps', loop: 'chw', flow: 'chilled', from: 'ch.chwOut', to: 'tee.chwIn', pts: route(P['ch.chwOut'], TEES.chwIn, [['H', 885], ['V', 450], ['H', 563], ['V', TEES.chwIn[1]]]) },
    { id: 'chw-p1-in', loop: 'chw', flow: 'wp1', from: 'tee.chwIn', to: 'wp1.in', pts: route(TEES.chwIn, P['wp1.in']) },
    { id: 'chw-p1-out', loop: 'chw', flow: 'wp1', from: 'wp1.out', to: 'tee.chwOut', pts: route(P['wp1.out'], TEES.chwOut, [['V', 92], ['H', TEES.chwOut[0]]]) },
    { id: 'chw-p2-in', loop: 'chw', flow: 'wp2', from: 'tee.chwIn', to: 'wp2.in', pts: route(TEES.chwIn, P['wp2.in'], [['V', P['wp2.in'][1]]]) },
    { id: 'chw-p2-out', loop: 'chw', flow: 'wp2', from: 'wp2.out', to: 'tee.chwOut', pts: route(P['wp2.out'], TEES.chwOut, [['V', 258], ['H', TEES.chwOut[0]]]) },
    { id: 'chw-supply', loop: 'chw', flow: 'chilled', from: 'tee.chwOut', to: 'bcw.supply', pts: route(TEES.chwOut, P['bcw.supply'], [['H', P['bcw.supply'][0]]]) },
    { id: 'chw-return', loop: 'chwr', flow: 'chilled', from: 'bcw.return', to: 'bt.in', pts: route(P['bcw.return'], P['bt.in'], [['V', P['bt.in'][1]]]) },
    { id: 'chw-return-chiller', loop: 'chwr', flow: 'chilled', from: 'bt.out', to: 'ch.chwIn', pts: route(P['bt.out'], P['ch.chwIn']) },
    /* hot water: boiler → building → back to the boiler */
    { id: 'hw-supply', loop: 'hw', flow: 'hot', from: 'bl.supply', to: 'bhw.supply', pts: route(P['bl.supply'], P['bhw.supply'], [['H', 1335], ['V', P['bhw.supply'][1]]]) },
    { id: 'hw-return', loop: 'hwr', flow: 'hot', from: 'bhw.return', to: 'bl.return', pts: route(P['bhw.return'], P['bl.return'], [['V', 303], ['H', 1040], ['V', P['bl.return'][1]]]) }
  ];

  /* the tags beside the machines, where the reference has them. A tag is a caption band over a value band. Trip and alarm points are not tags: they turn the machine's
     own status red. Cooling demand, chilled water flow and cooling power are not on the reference: they are in their machine's tooltip and asset panel (HINTS). */
  var TAGS = [
    { id: 'ctEnter',  x: 0,    y: 40,  w: 118 },
    { id: 'ctSpeed',  x: 212,  y: 18,  w: 118 },
    { id: 'ctLeave',  x: 457,  y: 42,  w: 114 },
    { id: 'ctRun',    x: 172,  y: 370, w: 198 },
    { id: 'cp1Run',   x: 92,   y: 463, w: 130 },
    { id: 'cp1Speed', x: 237,  y: 463, w: 101 },
    { id: 'cp2Run',   x: 77,   y: 658, w: 129 },
    { id: 'cp2Speed', x: 222,  y: 658, w: 101 },
    { id: 'wp1Speed', x: 690,  y: 44,  w: 122 },
    { id: 'wp1Run',   x: 828,  y: 44,  w: 122 },
    { id: 'wp2Speed', x: 851,  y: 284, w: 108 },
    { id: 'wp2Run',   x: 849,  y: 333, w: 111 },
    { id: 'chRun',    x: 472,  y: 758, w: 193 },
    { id: 'chSupply', x: 787,  y: 596, w: 80 },
    { id: 'chReturn', x: 983,  y: 724, w: 85 },
    { id: 'blReturn', x: 978,  y: 86,  w: 97 },
    { id: 'blSupply', x: 1325, y: 89,  w: 97 },
    { id: 'blRun',    x: 1140, y: 256, w: 130 }
  ];
  var TAG_CAP_H = 18, TAG_VAL_H = 22;
  /* points shown in a machine's tooltip rather than as a tag */
  var HINTS = { chilledPumps: ['wpDemand'], btu: ['btFlow', 'btPower'] };

  /* ── drawing (a string, so it can be tested without a browser) ── */
  /* edge, body, the light dashes along the middle */
  var PIPE_COLOURS = {
    cw:   ['#0d6a14', '#2fb437', '#c9f8cb'],
    chw:  ['#0a57ad', '#2a8fe8', '#c8e6fd'],
    chwr: ['#27507f', '#3f76b5', '#c2d6ea'],
    hw:   ['#8d0c14', '#dd1f2b', '#ffc9c9'],
    hwr:  ['#3e0e0d', '#742a25', '#d9a9a3']
  };
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function pathOf(pts) {
    var r = 12, d = 'M' + pts[0][0] + ' ' + pts[0][1];
    for (var i = 1; i < pts.length; i++) {
      var p = pts[i], prev = pts[i - 1], next = pts[i + 1];
      if (!next) { d += ' L' + p[0] + ' ' + p[1]; break; }
      var inLen = Math.hypot(p[0] - prev[0], p[1] - prev[1]), outLen = Math.hypot(next[0] - p[0], next[1] - p[1]);
      if (inLen < 1e-6 || outLen < 1e-6) continue;
      var c = Math.min(r, inLen / 2, outLen / 2);
      var ax = p[0] - (p[0] - prev[0]) / inLen * c, ay = p[1] - (p[1] - prev[1]) / inLen * c;
      var bx = p[0] + (next[0] - p[0]) / outLen * c, by = p[1] + (next[1] - p[1]) / outLen * c;
      d += ' L' + ax.toFixed(2) + ' ' + ay.toFixed(2) + ' Q' + p[0] + ' ' + p[1] + ' ' + bx.toFixed(2) + ' ' + by.toFixed(2);
    }
    return d;
  }
  /* The straight legs of a pipe: each gets its couplings near both ends and, when long enough, a flow arrow at its middle. */
  function legsOf(pts) {
    var out = [];
    for (var i = 1; i < pts.length; i++) {
      var a = pts[i - 1], b = pts[i], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 1e-6) continue;
      out.push({ a: a, b: b, len: len, dx: (b[0] - a[0]) / len, dy: (b[1] - a[1]) / len });
    }
    return out;
  }
  function pipeSvg(pipe) {
    var col = PIPE_COLOURS[pipe.loop], d = pathOf(pipe.pts), joints = '', arrows = '';
    legsOf(pipe.pts).forEach(function (l) {
      if (l.len >= 44) [19, l.len - 19].forEach(function (at) {
        var x = l.a[0] + l.dx * at, y = l.a[1] + l.dy * at;
        joints += '<path d="M' + (x - l.dy * 8.6).toFixed(1) + ' ' + (y - l.dx * 8.6).toFixed(1) + ' L' + (x + l.dy * 8.6).toFixed(1) + ' ' + (y + l.dx * 8.6).toFixed(1) + '" stroke="' + col[0] + '" stroke-width="5"/>';
      });
      if (l.len >= 120) {
        var mx = l.a[0] + l.dx * l.len / 2, my = l.a[1] + l.dy * l.len / 2, s = 6;
        arrows += '<path class="rf-arrow" d="M' + (mx + l.dx * s).toFixed(1) + ' ' + (my + l.dy * s).toFixed(1) +
          ' L' + (mx - l.dx * s - l.dy * s).toFixed(1) + ' ' + (my - l.dy * s - l.dx * s).toFixed(1) +
          ' L' + (mx - l.dx * s + l.dy * s).toFixed(1) + ' ' + (my - l.dy * s + l.dx * s).toFixed(1) + 'Z" fill="#fff" stroke="' + col[0] + '" stroke-width="1.2"/>';
      }
    });
    return '<g class="rf-pipe" data-pipe="' + pipe.id + '" data-loop="' + pipe.loop + '" data-flow="unknown">' +
      '<path d="' + d + '" stroke="' + col[0] + '" stroke-width="13.4"/>' +
      '<path d="' + d + '" stroke="' + col[1] + '" stroke-width="10.2"/>' +
      '<path class="rf-flowline" d="' + d + '" stroke="' + col[2] + '" stroke-width="3.6"/>' + joints + arrows + '</g>';
  }
  /* where lines meet: a fitting over the edges of the pipes it joins */
  function teeSvg(t, loop) {
    var col = PIPE_COLOURS[loop];
    return '<circle cx="' + t[0] + '" cy="' + t[1] + '" r="5.1" fill="' + col[1] + '"/>';
  }
  function machine(id, slotPart) {
    var pl = PLACE[id], a = MACHINES[pl.art];
    var at = pl.flip ? 'translate(' + (pl.x + a.w * pl.s) + ' ' + pl.y + ') scale(' + (-pl.s) + ' ' + pl.s + ')' : 'translate(' + pl.x + ' ' + pl.y + ') scale(' + pl.s + ')';
    return '<g transform="' + at + '">' + a.draw(slotPart || id) + '</g>';
  }
  /* the caption's small cog, as on the reference */
  function tagIcon(x, y) {
    var spokes = '';
    for (var i = 0; i < 4; i++) spokes += '<path d="M0 -5.2 V5.2" transform="rotate(' + (i * 45) + ')"/>';
    return '<g class="rf-tagicon" transform="translate(' + x + ' ' + y + ')">' + spokes + '<circle r="2.6"/></g>';
  }
  function tagSvg(t, E) {
    var it = BY_ID[t.id], valY = t.y + TAG_CAP_H;
    return '<g class="rf-tag" data-tag="' + t.id + '" data-st="no-equip"' + (it.hot ? ' data-hot="1"' : '') + '>' +
      '<title></title>' +
      '<rect class="rf-tagcap" x="' + t.x + '" y="' + t.y + '" width="' + t.w + '" height="' + TAG_CAP_H + '"/>' +
      tagIcon(t.x + 9, t.y + 9) +
      '<text class="rf-tagname" x="' + (t.x + 17) + '" y="' + (t.y + 12.8) + '">' + esc(it.cap) + '</text>' +
      '<rect class="rf-tagval" x="' + t.x + '" y="' + valY + '" width="' + t.w + '" height="' + TAG_VAL_H + '"/>' +
      '<rect class="rf-tagedge" x="' + (t.x + t.w - 4) + '" y="' + valY + '" width="4" height="' + TAG_VAL_H + '"/>' +
      '<text class="rf-tagtxt" x="' + (t.x + (t.w - 4) / 2) + '" y="' + (valY + 16) + '">' + esc(tr(E, 'roofSt.no-equip')) + '</text></g>';
  }
  function tr(E, key, vars) { return E && E.t ? E.t(key, vars) : key; }
  /* a machine: its drawing and, once its FIN equipment is known, a click through to that equipment's asset panel (update() sets the target) */
  function eq(E, slot, inner) { return '<g class="rf-eq" data-slot="' + slot + '"><title>' + esc(tr(E, 'roofEq.' + slot)) + '</title>' + inner + '</g>'; }
  function textLines(x, y, lines) {
    return lines.map(function (l, i) { return '<text class="rf-bldg" x="' + x + '" y="' + (y + i * 15) + '">' + esc(l) + '</text>'; }).join('');
  }
  /* the building blocks' snowflake and droplet */
  function snowflake(x, y) {
    var arm = '<path d="M0 0 V-17 M0 -10 L-5 -15 M0 -10 L5 -15"/>', out = '';
    for (var i = 0; i < 6; i++) out += '<g transform="rotate(' + (i * 60) + ')">' + arm + '</g>';
    return '<g class="rf-snow" transform="translate(' + x + ' ' + y + ')">' + out + '</g>';
  }
  function droplet(x, y) {
    return '<path class="rf-drop" transform="translate(' + x + ' ' + y + ')" d="M0 -19 C5 -9 12 -3 12 6 A12 12 0 0 1 -12 6 C-12 -3 -5 -9 0 -19Z M0 -6 C2.6 -1 6 2 6 6 A6 6 0 0 1 -6 6 C-6 2 -2.6 -1 0 -6Z"/>';
  }
  function svg(E) {
    var B = BUILDING;
    var bcx = B.chilled.x + B.chilled.w / 2, hcx = B.hot.x + B.hot.w / 2;
    return '<svg class="roofsvg" xmlns="http://www.w3.org/2000/svg" viewBox="' + VIEW.x + ' ' + VIEW.y + ' ' + VIEW.w + ' ' + VIEW.h + '" preserveAspectRatio="xMidYMid meet" role="img" aria-label="' + esc(tr(E, 'roofTitle')) + '" dir="ltr">' +
      ART_LIB.defs() +
      '<g class="rf-pipes" fill="none" stroke-linecap="butt" stroke-linejoin="round">' + PIPES.map(pipeSvg).join('') + '</g>' +
      teeSvg(TEES.cwIn, 'cw') + teeSvg(TEES.cwOut, 'cw') + teeSvg(TEES.chwIn, 'chw') + teeSvg(TEES.chwOut, 'chw') +
      '<g class="rf-bldgs"><rect class="rf-bcw" x="' + B.chilled.x + '" y="' + B.chilled.y + '" width="' + B.chilled.w + '" height="' + B.chilled.h + '"/><rect class="rf-bhw" x="' + B.hot.x + '" y="' + B.hot.y + '" width="' + B.hot.w + '" height="' + B.hot.h + '"/>' +
      snowflake(bcx, B.chilled.y + 30) + droplet(hcx, B.hot.y + 30) +
      textLines(bcx, B.chilled.y + 68, tr(E, 'roofBldgChw').split('\n')) +
      textLines(hcx, B.hot.y + 68, tr(E, 'roofBldgHw').split('\n')) +
      '<text class="rf-flowname" x="997" y="366">' + esc(tr(E, 'roofSupply')) + '</text><text class="rf-flowname" x="997" y="512">' + esc(tr(E, 'roofReturn')) + '</text></g>' +
      eq(E, 'coolingTower', machine('coolingTower', 'fan')) +
      eq(E, 'condenserPumps', machine('cp1') + machine('cp2')) +
      eq(E, 'chiller', machine('chiller')) +
      eq(E, 'chilledPumps', machine('wp1') + machine('wp2')) +
      eq(E, 'boiler', machine('boiler')) +
      eq(E, 'btu', machine('btu')) +
      TAGS.map(function (t) { return tagSvg(t, E); }).join('') +
      '<g class="rf-live" data-on="0"><circle cx="1400" cy="20" r="6"/><text x="1411" y="25">' + esc(tr(E, 'roofLiveBadge')) + '</text></g>' +
      '</svg>';
  }

  /* ── the view: built once, then only its values change, so what is turning keeps turning across a data update ── */
  function liveAssets(E) { return (E && E.data && E.data.assets) || []; }
  function isConnected() { var d = (typeof window !== 'undefined') && window.DashboardData; return !(d && d.connected === false); }
  function setText(el, text) { if (el && el.textContent !== text) el.textContent = text; }
  function setAttr(el, name, value) {
    if (!el) return;
    if (value == null) { if (el.hasAttribute(name)) el.removeAttribute(name); }
    else if (el.getAttribute(name) !== String(value)) el.setAttribute(name, value);
  }
  /* A long enum word must not spill out of its tag: it is cut here and given whole in the tooltip */
  function fit(text, w) {
    var max = Math.floor((w - 12) / 8.2);
    return text.length > max ? text.slice(0, Math.max(1, max - 1)) + '…' : text;
  }
  function tagTitle(E, it, r) {
    var label = tr(E, 'roofPt.' + it.id);
    if (r.state === 'live') return label + ' · FIN: ' + r.equip + ' / ' + r.pointName;
    if (r.state === 'no-equip') return label + ' · ' + tr(E, 'roofWhy.no-equip');
    if (r.state === 'no-point' || r.state === 'ambiguous') return label + ' · ' + tr(E, 'roofWhy.' + r.state, { point: it.cap });
    return label + ' · ' + tr(E, 'roofWhy.' + r.state) + (r.equip ? ' · FIN: ' + r.equip + ' / ' + r.pointName : '');
  }
  function update(host, E) {
    if (!host) return null;
    var m = model(liveAssets(E), { connected: isConnected() });
    TAGS.forEach(function (t) {
      var it = BY_ID[t.id], r = m.reads[t.id], g = host.querySelector('[data-tag="' + t.id + '"]');
      if (!g) return;
      var st = r.state, part = it.kind === 'status' && PARTS.filter(function (p) { return p.run === t.id; })[0];
      var fault = st === 'live' && part && m.parts[part.id] === 'fault';
      setAttr(g, 'data-st', fault ? 'fault' : st);
      setAttr(g, 'data-on', st === 'live' && r.status === 'on' ? '1' : null);
      setText(g.querySelector('.rf-tagtxt'), fit(st === 'live' ? r.text : tr(E, 'roofSt.' + st), t.w));
      setText(g.querySelector('title'), tagTitle(E, it, r));
    });
    PARTS.concat({ id: 'btu' }).forEach(function (p) {
      var run = m.parts[p.id], speed = p.speed && m.reads[p.speed];
      host.querySelectorAll('[data-part="' + p.id + '"]').forEach(function (el) {
        setAttr(el, 'data-run', run);
        if (!el.classList.contains('rf-rot')) return;
        /* drawn turning at about the speed FIN reports; no reported speed, one steady pace */
        var dur = speed && speed.state === 'live' && speed.num > 0 ? (.5 + (100 - speed.num) / 100 * 2.5).toFixed(2) + 's' : '';
        if (el.style.animationDuration !== dur) el.style.animationDuration = dur;
      });
    });
    PIPES.forEach(function (pipe) {
      setAttr(host.querySelector('[data-pipe="' + pipe.id + '"]'), 'data-flow', m.flows[pipe.flow]);
    });
    SLOTS.forEach(function (s) {
      var g = host.querySelector('.rf-eq[data-slot="' + s.id + '"]'), id = m.open[s.id];
      setAttr(g, 'data-act', id ? 'openAsset' : null);
      setAttr(g, 'data-asset', id);
      setAttr(g, 'data-tab', id ? 'alarms' : null);
      setAttr(g, 'role', id ? 'button' : null);
      setAttr(g, 'tabindex', id ? '0' : null);
      var hints = (HINTS[s.id] || []).map(function (k) { return m.reads[k]; }).filter(function (r) { return r.state === 'live'; })
        .map(function (r) { return r.pointName + ' ' + r.text; });
      setText(g && g.querySelector('title'), [tr(E, 'roofEq.' + s.id)].concat(hints).join(' · '));
    });
    setAttr(host.querySelector('.rf-live'), 'data-on', m.connected && m.live ? '1' : '0');
    var status = host.querySelector('.roofstatus');
    if (status) {
      setAttr(status, 'data-st', !m.connected ? 'off' : m.live ? 'live' : 'none');
      setText(status, !m.connected ? tr(E, 'roofNotConnected') : tr(E, 'roofLive', { n: String(m.live), total: String(m.total) }));
    }
    return m;
  }
  function create(E) {
    var title = tr(E, 'roofTitle');
    var host = document.createElement('section');
    host.className = 'roofview';
    host.setAttribute('aria-label', title);
    var legend = [['cw', 'roofLoopCw'], ['chw', 'roofLoopChw'], ['hw', 'roofLoopHw']].map(function (l) {
      return '<span class="roofleg" data-loop="' + l[0] + '">' + esc(tr(E, l[1])) + '</span>';
    }).join('');
    host.innerHTML = '<div class="roofbar"><button type="button" class="btnG btnSm roofback" data-act="roofBack">' + esc(tr(E, 'roofBack')) + '</button>' +
      '<h2 class="roofttl">' + esc(title) + '</h2><div class="roofmeta">' + legend + '<span class="roofstatus" role="status"></span></div></div>' +
      '<div class="roofstage">' + svg(E) + '</div>';
    host.addEventListener('keydown', function (ev) {
      if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.classList && ev.target.classList.contains('rf-eq') && ev.target.dataset.act) {
        /* an SVG element has no click() for the dashboard's own role=button key handler to call, so this one answers and stops it there */
        ev.preventDefault();
        ev.stopPropagation();
        ev.target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }
    });
    update(host, E);
    return host;
  }

  return { VIEW: VIEW, SLOTS: SLOTS, ITEMS: ITEMS, PARTS: PARTS, PLACE: PLACE, MACHINES: MACHINES, TAG_H: TAG_CAP_H + TAG_VAL_H, PORTS: PORTS, TEES: TEES, PIPES: PIPES, TAGS: TAGS, model: model, svg: svg, pathOf: pathOf, legsOf: legsOf, create: create, update: update };
});
