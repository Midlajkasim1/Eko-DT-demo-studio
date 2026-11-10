/* The Hospital Roof machines, one drawing each, redrawn from the client's close-up reference videos: cooling tower, chilled water pump, inline circulation
   pump, screw chiller, hot water boiler and BTU meter. They are SVG strings so a machine stays sharp at any size and its moving parts are its own elements.
   Pipework, tags and placement are not here: they are in hospital-roof.js.

   Each machine has its own units (its close-up's pixels, straightened) and gives { w, h, ports, draw(part) }:
     ports  where a pipe connects, in the machine's units. The layout turns these into schematic coordinates, so a pipe always ends on a nozzle.
     draw   the machine's markup. Anything that moves carries data-part and data-run; hospital-roof.js sets data-run from that machine's FIN status, and the CSS
            in components.css animates it only while data-run says running. Nothing here reads FIN. The chiller's bar display and gauge are the reference's
            activity indicators, not readings: they show the machine is running, and no value is taken from them. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.EKO_ROOF_ART = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  function grad(id, stops, x2, y2) {
    return '<linearGradient id="rf-' + id + '" x1="0" y1="0" x2="' + (x2 == null ? 0 : x2) + '" y2="' + (y2 == null ? 1 : y2) + '">' +
      stops.map(function (s) { return '<stop offset="' + s[0] + '" stop-color="' + s[1] + '"/>'; }).join('') + '</linearGradient>';
  }
  function radial(id, stops) {
    return '<radialGradient id="rf-' + id + '">' +
      stops.map(function (s) { return '<stop offset="' + s[0] + '" stop-color="' + s[1] + '"' + (s[2] == null ? '' : ' stop-opacity="' + s[2] + '"') + '/>'; }).join('') + '</radialGradient>';
  }
  /* Shared paint. objectBoundingBox gradients, so each follows the part it fills. */
  function defs() {
    return '<defs>' +
      grad('metalH', [[0, '#6f7377'], [.22, '#c4c7ca'], [.48, '#f1f2f3'], [.74, '#b4b7ba'], [1, '#65696d']], 1, 0) +
      grad('metalV', [[0, '#f0f1f2'], [.45, '#c3c6c9'], [1, '#75797d']]) +
      grad('blockV', [[0, '#9fa3a6'], [.55, '#63676b'], [1, '#2f3236']]) +
      grad('disc', [[0, '#e6e7e8'], [.55, '#b3b5b8'], [1, '#85888c']]) +
      grad('darkShell', [[0, '#44484c'], [.14, '#26292c'], [.62, '#17191b'], [1, '#0b0c0d']]) +
      grad('blackBand', [[0, '#3d3f42'], [.5, '#141516'], [1, '#050506']]) +
      grad('rail', [[0, '#55585c'], [.45, '#2a2c2f'], [1, '#101113']]) +
      /* the tower */
      grad('deck', [[0, '#a6a9ac'], [.16, '#d4d6d8'], [.5, '#e3e4e5'], [.84, '#cfd1d3'], [1, '#9da0a3']], 1, 0) +
      grad('deckTop', [[0, '#8d9093', 1], [1, '#d6d8da']]) +
      grad('hatch', [[0, '#f1f2f2'], [1, '#d9dbdc']]) +
      grad('ring', [[0, '#fbfbfb'], [.5, '#c5c7c9'], [1, '#8d9093']], 1, 1) +
      grad('blade', [[0, '#f4f5f6'], [.55, '#c2c5c8'], [1, '#7e8285']], 1, 0) +
      grad('frame', [[0, '#eeeff0'], [.5, '#c9cbcd'], [1, '#8f9295']], 1, 0) +
      grad('slat', [[0, '#f6f7f7'], [.45, '#d5d7d9'], [.8, '#9a9da0'], [1, '#5a5d60']]) +
      '<pattern id="rf-slats" patternUnits="userSpaceOnUse" width="10" height="7.3"><rect width="10" height="7.3" fill="url(#rf-slat)"/></pattern>' +
      /* the pumps */
      grad('motor', [[0, '#79b9e4'], [.09, '#3f9be8'], [.3, '#1f73e0'], [.72, '#1450b4'], [1, '#0d3385']]) +
      grad('motorEnd', [[0, '#2b6fd2'], [1, '#123f9c']]) +
      grad('plate', [[0, '#d3d5d7'], [1, '#9b9ea2']]) +
      /* the chiller */
      grad('cream', [[0, '#efe3c3'], [.28, '#e6d6ae'], [.72, '#d8c595'], [1, '#b7a273']]) +
      grad('creamEnd', [[0, '#e9d9b3'], [1, '#c7b384']]) +
      grad('ribbed', [[0, '#3c3f43'], [.3, '#222427'], [1, '#0d0e10']]) +
      grad('silver', [[0, '#f1f2f3'], [.35, '#c9cbce'], [1, '#6f7377']]) +
      /* the boiler */
      grad('cabinet', [[0, '#35373a'], [.1, '#232527'], [1, '#121315']]) +
      grad('fireBack', [[0, '#16040a'], [1, '#2b0608']]) +
      grad('fireGlow', [[0, '#3f0a0a'], [1, '#8f170f']]) +
      grad('flameOut', [[0, '#ffb01f'], [.5, '#ff6a12'], [1, '#e8290d']]) +
      grad('flameIn', [[0, '#fff06a'], [1, '#ffa414']]) +
      radial('dial', [[0, '#ffffff', 1], [.8, '#eeeeec', 1], [1, '#b9bbbd', 1]]) +
      radial('smoke', [[0, '#7f8387', .75], [1, '#8d9195', .1]]) +
      /* the BTU meter */
      grad('stub', [[0, '#8fc0e6'], [.5, '#4a8fc9'], [1, '#27588f']]) +
      grad('btuBlade', [[0, '#7ee3f5'], [1, '#22aee0']], 1, 0) +
      /* the floor shadow every machine sits on */
      radial('shadow', [[0, '#42464a', .42], [.7, '#42464a', .22], [1, '#42464a', 0]]) +
      '</defs>';
  }

  function shadow(cx, cy, rx, ry) { return '<ellipse cx="' + cx + '" cy="' + cy + '" rx="' + rx + '" ry="' + ry + '" fill="url(#rf-shadow)"/>'; }
  /* n copies of a part round a centre */
  function around(n, one) {
    var out = '';
    for (var i = 0; i < n; i++) out += '<g transform="rotate(' + (i * 360 / n).toFixed(2) + ')">' + one + '</g>';
    return out;
  }
  function bolts(cx, cy, r, n, size, fill, start) {
    var out = '';
    for (var i = 0; i < n; i++) {
      var a = (start || 0) + i / n * Math.PI * 2;
      out += '<circle cx="' + (cx + Math.cos(a) * r).toFixed(1) + '" cy="' + (cy + Math.sin(a) * r).toFixed(1) + '" r="' + size + '" fill="' + fill + '"/>';
    }
    return out;
  }
  /* A rotor is drawn round 0,0 inside a group moved to its axle. The empty circle is what makes the group's box square on the axle, so it turns about its centre. */
  function rotor(part, cx, cy, r, inner) {
    return '<g transform="translate(' + cx + ' ' + cy + ')"><g class="rf-rot" data-part="' + part + '" data-run="unknown"><circle r="' + r + '" fill="none"/>' + inner + '</g></g>';
  }

  /* ── cooling tower: fan deck with its two hatches, twin louvre banks, black basin ── */
  var coolingTower = {
    w: 293, h: 300,
    ports: { waterIn: [0, 43], waterOut: [293, 43] },
    draw: function () {
      var cx = 146, fy = 68;
      var blade = '<path d="M-2.6 -15 L-6.6 -52 Q0 -54.5 8 -51 L3 -15Z" fill="url(#rf-blade)"/>';
      var hatch = function (d, bx) {
        return '<path d="' + d + '" fill="url(#rf-hatch)" stroke="#8d9093" stroke-width="1"/>' +
          '<circle cx="' + bx + '" cy="60" r="13" fill="#f6f6f6" stroke="#85888c" stroke-width="1.4"/><circle cx="' + bx + '" cy="60" r="9.2" fill="url(#rf-disc)" stroke="#6f7377" stroke-width=".7"/>' +
          '<ellipse cx="' + bx + '" cy="60" rx="4.2" ry="3" fill="#2a2c2f"/><rect x="' + (bx - 8.6) + '" y="59.3" width="17.2" height="1.4" fill="#3a3c3f"/>' +
          '<rect x="' + (bx - 18) + '" y="91" width="36" height="3" fill="#a3a6a9"/>';
      };
      var flange = function (x) {
        return '<rect x="' + x + '" y="28" width="6" height="30" rx="1.2" fill="#17181a"/>';
      };
      return shadow(146, 290, 150, 9) +
        /* vapour off the fan, only while it runs */
        '<g class="rf-vapor" data-part="fan" data-run="unknown"><circle cx="134" cy="-14" r="17" fill="url(#rf-smoke)"/><circle cx="154" cy="-20" r="20" fill="url(#rf-smoke)"/></g>' +
        /* the nozzles stand off the casing on short stubs */
        '<rect x="5" y="36" width="12" height="14" fill="url(#rf-blockV)"/><rect x="276" y="36" width="12" height="14" fill="url(#rf-blockV)"/>' + flange(0) + flange(287) +
        '<path d="M18 0 L275 0 L291 135 L2 135Z" fill="url(#rf-deck)" stroke="#7c7f83" stroke-width="1"/>' +
        '<path d="M18 0 L275 0 L277 17 L16 17Z" fill="url(#rf-deckTop)" opacity=".85"/>' +
        hatch('M23 22 L71 21 L72 118 L12 119Z', 41) + hatch('M222 21 L270 22 L281 119 L221 118Z', 252) +
        /* the fan: silver shroud, black well, then the blades and hub that turn */
        '<circle cx="' + cx + '" cy="' + fy + '" r="68" fill="url(#rf-ring)" stroke="#75797d" stroke-width="1"/>' +
        '<circle cx="' + cx + '" cy="' + fy + '" r="56.5" fill="#0c0d0e" stroke="#4d5053" stroke-width="1.2"/>' +
        rotor('fan', cx, fy, 55, around(14, blade) +
          '<circle r="14.5" fill="#e6e8e9" stroke="#3a3c3f" stroke-width="1.2"/><circle r="8" fill="#1d1f22"/><circle r="3.4" fill="#6f7377"/>') +
        /* the louvres: an outer frame, a centre post, a bank of slats either side */
        '<rect x="2" y="135" width="289" height="126" fill="url(#rf-frame)" stroke="#7c7f83" stroke-width=".8"/>' +
        '<rect x="9" y="140" width="130" height="119" fill="url(#rf-slats)"/><rect x="154" y="140" width="131" height="119" fill="url(#rf-slats)"/>' +
        '<rect x="141" y="136" width="11" height="124" fill="url(#rf-metalH)"/>' +
        '<rect x="0" y="260" width="293" height="24" fill="url(#rf-blackBand)"/>';
    }
  };

  /* ── chilled water pump: blue ribbed motor, bedplate, silver volute with the gold impeller. Close-up orientation: motor left, volute right. ── */
  var chwPump = {
    w: 540, h: 345,
    ports: { side: [540, 180], top: [412, 3] },
    draw: function (part) {
      var ribs = '';
      for (var x = 62; x <= 286; x += 16) ribs += '<rect x="' + x + '" y="116" width="3.4" height="150" rx="1.4" fill="#0a2a78"/><rect x="' + (x + 3.4) + '" y="116" width="3" height="150" fill="#7cc0f5" opacity=".6"/>';
      var blade = '<path d="M-8 -12 C-14 -30 -4 -50 27 -52" fill="none" stroke="#6b4c07" stroke-width="9.6" stroke-linecap="round"/>' +
        '<path d="M-8 -12 C-14 -30 -4 -50 27 -52" fill="none" stroke="#efbe22" stroke-width="7.6" stroke-linecap="round"/>';
      return shadow(265, 336, 265, 9) +
        '<rect x="15" y="300" width="500" height="34" rx="2" fill="url(#rf-rail)"/><circle cx="44" cy="318" r="6" fill="#0c0d0e"/><circle cx="486" cy="312" r="6" fill="#0c0d0e"/>' +
        '<rect x="70" y="262" width="198" height="42" fill="#102f7c"/>' +
        '<rect x="0" y="130" width="42" height="142" rx="14" fill="url(#rf-motorEnd)"/>' +
        '<rect x="20" y="95" width="278" height="180" rx="24" fill="url(#rf-motor)"/>' + ribs +
        /* the terminal box and its lamp: red while the pump is stopped or faulted */
        '<rect x="108" y="40" width="104" height="68" rx="9" fill="url(#rf-plate)" stroke="#3a3c3f" stroke-width="2.4"/>' +
        '<circle cx="124" cy="60" r="5" fill="#1b1c1e"/><circle cx="196" cy="58" r="5" fill="#1b1c1e"/>' +
        '<circle class="rf-lamp rf-lamp-stop" data-part="' + part + '" data-run="unknown" cx="160" cy="78" r="9"/>' +
        /* coupling guard */
        '<rect x="296" y="124" width="46" height="122" rx="6" fill="url(#rf-disc)" stroke="#85888c" stroke-width="1"/>' +
        [150, 168, 186, 204, 222].map(function (y) { return '<rect x="322" y="' + y + '" width="18" height="3.4" fill="#4b4e52"/>'; }).join('') +
        /* the suction neck and flange on top, the side connection on the right */
        '<rect x="378" y="36" width="74" height="72" fill="url(#rf-metalH)"/>' +
        '<rect x="358" y="3" width="108" height="36" rx="3" fill="url(#rf-metalV)" stroke="#6f7377" stroke-width="1.4"/>' +
        '<rect x="505" y="146" width="26" height="74" fill="url(#rf-metalV)"/>' +
        '<rect x="525" y="130" width="15" height="100" fill="url(#rf-blockV)"/>' +
        /* the volute */
        '<circle cx="420" cy="190" r="108" fill="url(#rf-disc)" stroke="#27292c" stroke-width="3.4"/>' +
        '<circle cx="420" cy="190" r="79" fill="#a7aaad" stroke="#74777b" stroke-width="2"/>' +
        bolts(420, 190, 93, 8, 8, '#232528', .39) +
        '<circle cx="420" cy="190" r="60" fill="#08090a"/>' +
        rotor(part, 420, 190, 58, around(6, blade) + '<circle r="15" fill="url(#rf-disc)"/>');
    }
  };

  /* ── inline circulation pump: a disc between its two flanged blocks, with the blue impeller ── */
  var cwPump = {
    w: 410, h: 340,
    ports: { left: [0, 160], right: [410, 160] },
    draw: function (part) {
      var cx = 205, cy = 160;
      var blade = '<path d="M-12 -18 C-24 -50 -14 -84 20 -98" fill="none" stroke="#2fa6e8" stroke-width="14" stroke-linecap="round"/>';
      return shadow(cx, 322, 150, 14) +
        '<rect x="0" y="62" width="56" height="196" fill="url(#rf-blockV)"/><rect x="354" y="62" width="56" height="196" fill="url(#rf-blockV)"/>' +
        '<circle cx="' + cx + '" cy="' + cy + '" r="150" fill="url(#rf-disc)" stroke="#1d1f22" stroke-width="8"/>' +
        bolts(cx, cy, 122, 12, 10, '#2c2e31', .26) +
        '<circle cx="' + cx + '" cy="' + cy + '" r="93" fill="#070809" stroke="#8f9295" stroke-width="2"/>' +
        rotor(part, cx, cy, 104, around(6, blade) + '<circle r="24" fill="url(#rf-dial)" stroke="#a8abae" stroke-width="1"/>');
    }
  };

  /* ── screw chiller: cream condenser over the black evaporator, compressor and motor on top, control display at the left ── */
  var chiller = {
    w: 650, h: 450,
    ports: { condIn: [0, 125], condOut: [0, 199], chwOut: [650, 288], chwIn: [650, 372] },
    draw: function () {
      var ribs = function (x0, x1, y0, y1, step, a, b) {
        var out = '';
        for (var x = x0; x <= x1; x += step) out += '<rect x="' + x + '" y="' + y0 + '" width="3.6" height="' + (y1 - y0) + '" rx="1.4" fill="' + a + '"/>' + (b ? '<rect x="' + (x + 3.6) + '" y="' + y0 + '" width="1.6" height="' + (y1 - y0) + '" fill="' + b + '"/>' : '');
        return out;
      };
      var ticks = '';
      for (var i = 0; i < 12; i++) ticks += '<rect x="-.7" y="-29" width="1.4" height="5" fill="#4b4e52" transform="rotate(' + (i * 30) + ')"/>';
      var bars = [[100, 30], [118, 26], [137, 15], [155, 11], [173, 15]].map(function (b, n) {
        return '<rect style="animation-delay:' + (-n * .37).toFixed(2) + 's" x="' + b[0] + '" y="' + (340 - b[1]) + '" width="13" height="' + b[1] + '"/>';
      }).join('');
      return shadow(330, 438, 320, 11) +
        /* base rail and its feet */
        '<rect x="16" y="402" width="604" height="24" rx="3" fill="url(#rf-rail)"/><rect x="26" y="424" width="58" height="16" fill="#101113"/><rect x="552" y="424" width="58" height="16" fill="#101113"/>' +
        /* the cream shell, its flanged left end, its stubs */
        '<rect x="0" y="107" width="24" height="36" rx="5" fill="url(#rf-blockV)"/><rect x="0" y="181" width="24" height="36" rx="5" fill="url(#rf-blockV)"/>' +
        '<path d="M70 122 L545 122 Q605 122 605 192 Q605 262 545 262 L70 262Z" fill="url(#rf-cream)"/>' +
        '<rect x="179" y="122" width="2" height="140" fill="#b6a273"/><rect x="465" y="122" width="2" height="140" fill="#b6a273"/>' +
        '<rect x="16" y="102" width="58" height="136" rx="7" fill="url(#rf-creamEnd)" stroke="#8a7a54" stroke-width="1.4"/>' +
        '<circle cx="46" cy="122" r="5" fill="#3a2e1b"/><circle cx="46" cy="170" r="5" fill="#3a2e1b"/><circle cx="46" cy="218" r="5" fill="#3a2e1b"/>' +
        /* the gauge: its needle moves only while the chiller runs */
        '<circle cx="115" cy="176" r="33" fill="url(#rf-dial)" stroke="#6f7377" stroke-width="2.2"/>' +
        '<g transform="translate(115 176)">' + ticks + '<g class="rf-needle" data-part="chiller" data-run="unknown"><circle r="24" fill="none"/><path d="M-1.8 0 L0 -20 L1.8 0Z" fill="#1d1f22" transform="rotate(-22)"/></g><circle r="3.6" fill="#1d1f22"/></g>' +
        '<rect x="402" y="164" width="112" height="70" fill="#f1e9d5" stroke="#a79a78" stroke-width="1.4"/>' +
        '<rect x="416" y="180" width="82" height="3.2" fill="#736a53"/><rect x="416" y="194" width="82" height="3.2" fill="#736a53"/><rect x="416" y="208" width="58" height="3.2" fill="#736a53"/>' +
        /* the black evaporator with its panel seams, flanged right end and stubs */
        '<rect x="636" y="272" width="14" height="32" rx="3" fill="url(#rf-blockV)"/><rect x="636" y="356" width="14" height="32" rx="3" fill="url(#rf-blockV)"/>' +
        '<rect x="10" y="262" width="588" height="142" rx="66" fill="url(#rf-darkShell)"/>' +
        '<rect x="66" y="271" width="526" height="4" rx="2" fill="#6a6e72" opacity=".75"/>' +
        '<rect x="329" y="264" width="1.8" height="138" fill="#050506"/><rect x="465" y="264" width="1.8" height="138" fill="#050506"/>' +
        '<rect x="590" y="258" width="50" height="146" rx="9" fill="url(#rf-rail)" stroke="#4b4e52" stroke-width="1"/>' +
        '<circle cx="615" cy="282" r="5" fill="#0a0a0b" stroke="#6a6e72"/><circle cx="615" cy="330" r="5" fill="#0a0a0b" stroke="#6a6e72"/><circle cx="615" cy="378" r="5" fill="#0a0a0b" stroke="#6a6e72"/>' +
        /* the control display */
        '<g transform="translate(-22 -9)"><rect x="74" y="290" width="192" height="100" rx="6" fill="#0a0b0c" stroke="#8d9093" stroke-width="1.6"/>' +
        '<g class="rf-bars" data-part="chiller" data-run="unknown">' + bars + '</g>' +
        '<circle class="rf-lamp" style="--on:#31e36b" data-part="chiller" data-run="unknown" cx="222" cy="312" r="8"/><circle cx="244" cy="312" r="7" fill="#3a3c3f"/>' +
        '<text class="rf-eqtext" x="233" y="353" font-size="15">CH-01</text>' +
        '<rect x="92" y="357" width="36" height="20" rx="3" fill="#3a3d41"/><rect x="135" y="357" width="36" height="20" rx="3" fill="#3a3d41"/><rect x="178" y="357" width="36" height="20" rx="3" fill="#3a3d41"/></g>' +
        /* the column up to the compressor */
        '<rect x="340" y="125" width="34" height="139" fill="url(#rf-metalH)"/><g transform="translate(0 -25)">' +
        /* the motor behind the compressor, its rods, its caps */
        '<rect x="488" y="12" width="58" height="34" rx="7" fill="#17181a"/>' +
        '<rect x="418" y="60" width="42" height="9" fill="url(#rf-metalV)"/><rect x="418" y="79" width="42" height="9" fill="url(#rf-metalV)"/><rect x="418" y="98" width="42" height="9" fill="url(#rf-metalV)"/>' +
        '<rect x="578" y="52" width="27" height="74" rx="8" fill="#15161a"/>' +
        '<rect x="455" y="36" width="130" height="112" rx="20" fill="url(#rf-silver)" stroke="#6f7377" stroke-width="1"/>' + ribs(470, 572, 44, 140, 11, '#74777b', '#f3f4f5') +
        /* the compressor */
        '<rect x="268" y="8" width="42" height="24" fill="#1d1f22"/><rect x="262" y="2" width="56" height="10" rx="4" fill="#a7aaad"/>' +
        '<rect x="235" y="26" width="186" height="132" rx="19" fill="url(#rf-ribbed)"/>' + ribs(262, 400, 40, 118, 15.5, '#050506', '#3f4246') +
        '<circle cx="267" cy="128" r="15" fill="#d9dbdd"/><circle cx="267" cy="128" r="10" fill="#17181a"/><circle cx="267" cy="128" r="5.4" fill="#9fa3a6"/></g>';
    }
  };

  /* ── hot water boiler: black cabinet, gauge panel, firebox window, stack with its smoke. Flame and smoke show only while it fires. ── */
  var FLAMES = [[66, 42], [90, 26], [116, 58], [146, 70], [172, 44], [198, 32], [226, 84], [254, 66], [284, 40], [312, 74], [338, 88], [372, 38]];
  var boiler = {
    w: 440, h: 540,
    ports: { hwReturn: [-22, 321], hwSupply: [462, 321] },
    draw: function () {
      var gauge = function (cx) {
        return '<circle cx="' + cx + '" cy="298" r="23" fill="url(#rf-dial)" stroke="#8d9093" stroke-width="1.6"/><path d="M' + (cx - 1.4) + ' 299 L' + (cx + 7) + ' 283 L' + (cx + 1.4) + ' 300Z" fill="#c9221c"/><circle cx="' + cx + '" cy="298" r="3" fill="#1d1f22"/>';
      };
      var tongue = function (cx, h, wide, grad_, delay) {
        var w = wide, b = 481;
        return '<path style="animation-delay:' + delay + 's" d="M' + (cx - w) + ' ' + b + ' C' + (cx - w * .7) + ' ' + (b - h * .4) + ' ' + (cx - w * .25) + ' ' + (b - h * .62) + ' ' + cx + ' ' + (b - h) +
          ' C' + (cx + w * .3) + ' ' + (b - h * .6) + ' ' + (cx + w * .78) + ' ' + (b - h * .36) + ' ' + (cx + w) + ' ' + b + 'Z" fill="url(#rf-' + grad_ + ')"/>';
      };
      var outer = FLAMES.map(function (f, i) { return tongue(f[0], f[1] * .82, 21, 'flameOut', (-(i * 7 % 11) * .11).toFixed(2)); }).join('');
      var inner = FLAMES.map(function (f, i) { return tongue(f[0], f[1] * .46, 11, 'flameIn', (-(i * 5 % 11) * .11).toFixed(2)); }).join('');
      var side = function (bx, rx) {
        return '<rect x="' + bx + '" y="296" width="11" height="50" rx="2" fill="#17181a"/><rect x="' + rx + '" y="307" width="14" height="28" rx="3" fill="#e0261c"/><rect x="' + rx + '" y="307" width="14" height="8" rx="3" fill="#ff7a6e" opacity=".55"/>';
      };
      return shadow(220, 526, 225, 12) +
        '<g class="rf-smoke" data-part="boiler" data-run="unknown"><circle cx="204" cy="34" r="16" fill="url(#rf-smoke)"/><circle cx="224" cy="24" r="15" fill="url(#rf-smoke)"/><circle cx="222" cy="44" r="14" fill="url(#rf-smoke)"/></g>' +
        '<rect x="155" y="74" width="110" height="146" fill="url(#rf-metalH)"/>' +
        '<ellipse cx="210" cy="74" rx="55" ry="13" fill="#c7c9cc" stroke="#6f7377" stroke-width="1.2"/><ellipse cx="210" cy="75" rx="48" ry="10" fill="#0d0e0f"/>' +
        side(-9, -22) + side(438, 448) +
        '<rect x="60" y="490" width="76" height="38" fill="url(#rf-rail)"/><rect x="350" y="490" width="76" height="38" fill="url(#rf-rail)"/>' +
        '<rect x="0" y="222" width="440" height="282" rx="17" fill="url(#rf-cabinet)" stroke="#4d5053" stroke-width="1.2"/>' +
        '<rect x="150" y="207" width="136" height="24" fill="url(#rf-metalV)" stroke="#8d9093" stroke-width=".8"/>' +
        '<rect x="37" y="246" width="368" height="96" rx="7" fill="#0a0b0c"/>' +
        gauge(90) + gauge(158) + gauge(230) +
        '<text class="rf-eqtext" x="340" y="285" font-size="19">HW BOILER</text>' +
        '<circle cx="303" cy="306" r="6" fill="#55585c"/><circle class="rf-lamp" style="--on:#ff9a1f" data-part="boiler" data-run="unknown" cx="327" cy="306" r="6"/>' +
        '<rect x="50" y="358" width="360" height="129" rx="8" fill="url(#rf-fireBack)" stroke="#e0e1e2" stroke-width="3"/>' +
        '<g class="rf-flame" data-part="boiler" data-run="unknown"><path d="M58 484 A172 78 0 0 1 402 484Z" fill="url(#rf-fireGlow)"/>' + outer + inner + '</g>';
    }
  };

  /* ── BTU meter: gold-edged black housing, three-bladed flow wheel, blue pipe stubs either side ── */
  var btuMeter = {
    w: 405, h: 345,
    ports: { left: [0, 167], right: [405, 167] },
    draw: function () {
      var corner = function (x, y) { return '<rect x="' + x + '" y="' + y + '" width="30" height="30" fill="#ecac28"/>'; };
      var blade = '<path d="M-7 -11 L-8.5 -67 L8.5 -67 L7 -11Z" fill="url(#rf-btuBlade)"/>';
      return shadow(202, 326, 128, 15) +
        '<rect x="0" y="140" width="50" height="54" fill="url(#rf-stub)"/><rect x="355" y="140" width="50" height="54" fill="url(#rf-stub)"/>' +
        '<rect x="38" y="112" width="18" height="110" fill="#14151a"/><rect x="349" y="112" width="18" height="110" fill="#14151a"/>' +
        '<rect x="52" y="2" width="301" height="295" rx="38" fill="#0e0f12" stroke="#e5a42a" stroke-width="8"/>' +
        corner(68, 18) + corner(307, 18) + corner(68, 249) + corner(307, 249) +
        /* the lamp sits on the top right corner: flow measured */
        '<circle class="rf-lamp rf-lamp-blink" style="--on:#31d46b" data-part="btu" data-run="unknown" cx="322" cy="33" r="10"/>' +
        '<circle cx="203" cy="120" r="72" fill="#0a0b0d" stroke="#dfe2e5" stroke-width="6.5"/>' +
        rotor('btu', 203, 120, 69, around(3, blade) + '<circle r="13" fill="#d7dadd"/>') +
        '<text class="rf-eqtext" x="203" y="263" font-size="66">BTU</text>';
    }
  };

  return { defs: defs, MACHINES: { coolingTower: coolingTower, chwPump: chwPump, cwPump: cwPump, chiller: chiller, boiler: boiler, btuMeter: btuMeter } };
});
