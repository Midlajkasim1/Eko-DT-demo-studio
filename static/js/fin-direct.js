/* Standalone FIN reader*/
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FinDirect = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  var DEFAULT_WO = 'sqlQuery(read(sqlConn), "SELECT * FROM workOrderMarsa")';
  var DEFAULT_RT = {
    points: '/api/{project}/eval?expr=readAll(point+or+cmd+or+sensor+or+rule+or+diag)',
    equipment: '/api/{project}/read?filter=equip',
    alarms: '/api/{project}/eval?expr=readAll(equip+or+point).alarms(today)'
  };
  var DEFAULT_BANDS = { order: 'desc', critical: 250, warning: 150 };
  var DEFAULT_CLASSES = {
    system_tags: ['ahu', 'fahu', 'mahu', 'fcu', 'pump', 'sumpPump'],
    type_priority: ['ahu', 'fahu', 'mahu', 'fcu', 'vav', 'fan', 'exhaust', 'pump', 'sumpPump', 'meter', 'siteMeter', 'elecPanel', 'sitePanel', 'smdb', 'mcc', 'facp', 'fm200', 'lift', 'poolControl', 'coldRoom', 'iaq', 'is', 'kpiCalculation', 'calculation']
  };
  var DEFAULT_METER = {
    prefix: 'PMU',
    point_map: {
      active_power: ['active power', 'active_power', 'power', 'kw'],
      current: ['current', 'amps', 'amp', 'i avg', 'average current'],
      frequency: ['frequency', 'hz', 'freq'],
      total_energy: ['total energy', 'total_energy', 'energy', 'kwh', 'active energy'],
      voltage: ['voltage', 'volts', 'volt', 'v avg', 'vll', 'vln', 'average voltage']
    }
  };
  var AM_PM = ['12 am', '1 am', '2 am', '3 am', '4 am', '5 am', '6 am', '7 am', '8 am', '9 am', '10 am', '11 am', '12 pm', '1 pm', '2 pm', '3 pm', '4 pm', '5 pm', '6 pm', '7 pm', '8 pm', '9 pm', '10 pm', '11 pm'];
  var MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  var WO_CANON = {
    work_orders: 'id', workorders: 'id', work_order: 'id', wonum: 'id',
    equipment: 'equipment', equipment_description: 'description', equipment_organization: 'organization',
    position: 'position', asset_tag: 'assetTag', work_order_type: 'type', due_date: 'dueDate',
    period_uom: 'period', pm_schedule: 'pmSchedule', wo_created_date: 'created',
    schedule_start_date: 'startDate', schedule_end_date: 'endDate'
  };

  function nowIso() {
    var d = new Date();
    function p(n) { return String(n).padStart(2, '0'); }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  function filled(value) {
    if (value == null || value === '') return false;
    if (typeof value === 'object') return Object.keys(value).length > 0;
    return true;
  }

  function fillProject(template, project) {
    return String(template || '').split('{project}').join(project);
  }

  function evalPath(project, expr) {
    return '/api/' + encodeURIComponent(project) + '/eval?expr=' + encodeURIComponent(expr);
  }

  function decodeZinc(text) {
    return String(text || '').replace(/u([0-9a-fA-F]{4})/g, function (_, hex) {
      return String.fromCharCode(parseInt(hex, 16));
    });
  }

  function clipDecimals(text) {
    return String(text).replace(/(-?)(\d+)\.(\d{3,})/g, function (_, sign, whole, frac) {
      return sign + whole + '.' + frac.slice(0, 2);
    });
  }

  function trunc2(val) {
    var shown = clipDecimals(Number(val).toFixed(12)).replace(/0+$/, '').replace(/\.$/, '');
    return shown;
  }

  function safeGet(obj, key) {
    if (obj && typeof obj === 'object') return obj[key];
    return undefined;
  }

  function collapseMetadata(text) {
    if (text.indexOf('<<') < 0) return text;
    var out = [];
    var depth = 0;
    var i = 0;
    while (i < text.length) {
      var openAt = text.indexOf('<<', i);
      if (depth === 0) {
        if (openAt < 0) { out.push(text.slice(i)); break; }
        out.push(text.slice(i, openAt));
        out.push('"[METADATA_BLOCK]"');
        depth += 1;
        i = openAt + 2;
        continue;
      }
      var closeAt = text.indexOf('>>', i);
      if (openAt < 0 && closeAt < 0) break;
      if (closeAt < 0 || (openAt >= 0 && openAt < closeAt)) {
        out.push('"[METADATA_BLOCK]"');
        depth += 1;
        i = openAt + 2;
      } else {
        depth -= 1;
        i = closeAt + 2;
      }
    }
    return out.join('');
  }

  function splitZincLine(line) {
    var parts = [];
    var cur = [];
    var inQuote = false;
    var last = '';
    for (var i = 0; i < line.length; i++) {
      var ch = line.charAt(i);
      if (ch === '"' && last !== '\\') inQuote = !inQuote;
      else if (ch === ',' && !inQuote) {
        parts.push(cur.join('').trim());
        cur = [];
        last = ch;
        continue;
      }
      cur.push(ch);
      last = ch;
    }
    parts.push(cur.join('').trim());
    return parts;
  }

  function zincValue(val) {
    if (val.charAt(0) === '@') {
      var sp = val.indexOf(' ');
      var ref = sp < 0 ? val : val.slice(0, sp);
      var dis = sp < 0 ? '' : val.slice(sp + 1).trim();
      if (dis.charAt(0) === '"' && dis.charAt(dis.length - 1) === '"') dis = dis.slice(1, -1);
      return { val: ref, dis: decodeZinc(dis) };
    }
    if (val.charAt(0) === '"' && val.charAt(val.length - 1) === '"' && val.length >= 2) {
      return decodeZinc(val.slice(1, -1));
    }
    if (/^\d{4}-\d{2}-\d{2}T/.test(val)) return val;
    if (val === 'M') return true;
    if (val === '') return null;
    if (/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(val)) {
      var num = Number(val);
      if (isFinite(num)) return num;
    }
    return decodeZinc(val);
  }

  function parseZincCsv(text) {
    if (!text) return [];
    var lines = collapseMetadata(text).replace(/\r/g, '').trim().split('\n');
    var headerAt = -1;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (line.indexOf('id,') === 0 || (line.indexOf(',') >= 0 && line.indexOf('navName') >= 0) || (line.indexOf(',') >= 0 && line.indexOf('message') >= 0)) {
        headerAt = i;
        break;
      }
    }
    if (headerAt < 0) return [];
    var headers = lines[headerAt].split(',').map(function (h) { return h.trim(); });
    var rows = [];
    for (var r = headerAt + 1; r < lines.length; r++) {
      var raw = lines[r].trim();
      if (!raw) continue;
      var parts = splitZincLine(raw);
      var row = {};
      for (var c = 0; c < headers.length; c++) {
        if (c < parts.length) row[headers[c]] = zincValue(parts[c]);
      }
      rows.push(row);
    }
    return rows;
  }

  function cmmsId(value) {
    if (value == null || value === '') return '';
    if (typeof value === 'number' && isFinite(value) && Math.trunc(value) === value) return String(Math.trunc(value));
    var text = String(value).trim().replace(/^"|"$/g, '');
    if (/^\d+\.0+$/.test(text)) return text.split('.')[0];
    return text;
  }

  function normId(value) {
    if (value == null || value === '') return '';
    if (typeof value === 'object') value = value.dis || value.val || '';
    if (typeof value === 'boolean') return '';
    if (typeof value === 'number') {
      if (!isFinite(value)) return '';
      if (Math.trunc(value) === value) return String(Math.trunc(value));
      return String(value);
    }
    var text = String(value).trim().replace(/^"|"$/g, '');
    if (!text || text === 'N' || text === 'NA' || text === 'null') return '';
    if (/^\d+\.0+$/.test(text)) return text.split('.')[0];
    return text;
  }

  function displayCurVal(val, navLower, unit) {
    if (val && typeof val === 'object') val = val.dis || val.val;
    if (val == null || val === '' || val === 'N/A') return ['—', 'Null'];
    if (typeof val === 'boolean') return [val ? 'On' : 'Off', 'Bool'];
    if (typeof val === 'string') {
      var s = val.trim();
      var m = s.match(/^(T|F|true|false)\s*(?:"([^"]*)")?$/i);
      if (m) {
        var shown = decodeZinc((m[2] || '').trim());
        if (shown) return [shown, 'Bool'];
        return [m[1].charAt(0).toUpperCase() === 'T' ? 'On' : 'Off', 'Bool'];
      }
      var cleaned = s.replace(/[°CcFf%]+$/, '');
      var n = Number(cleaned);
      if (cleaned !== '' && isFinite(n) && /^-?\d+(?:\.\d+)?$/.test(cleaned)) val = n;
      else return [clipDecimals(s), 'Str'];
    }
    if (typeof val === 'number' && isFinite(val)) {
      var isFdd = navLower.indexOf('fd') === 0 || navLower.indexOf('fdd') >= 0 || navLower.indexOf('rule') === 0;
      if (!isFdd && (unit === '%' || /valve|coil|demand/.test(navLower))) return [String(Math.trunc(val)) + '%', 'Number'];
      var text = trunc2(val);
      if (unit) text += unit;
      return [text, 'Number'];
    }
    return [clipDecimals(String(val)), 'Str'];
  }

  function alarmIsOpen(row) {
    if (!row || row.alarm !== true || row.active !== true) return false;
    return String(row.message || '').toLowerCase().indexOf('return to normal') < 0;
  }

  function alarmDetailFromTable(body) {
    var texts = [];
    var numbers = [];
    String(body || '').split('\n').forEach(function (line) {
      line = line.trim();
      if (!line || line.indexOf('ver:') === 0 || line.indexOf('name,') === 0) return;
      var parts = splitZincLine(line);
      if (parts.length < 3) return;
      var name = decodeZinc(parts[0].replace(/^"|"$/g, '')).replace(/_/g, ' ').trim();
      var raw = parts[2].trim();
      if (raw.charAt(0) === '"' && raw.charAt(raw.length - 1) === '"') raw = raw.slice(1, -1);
      raw = decodeZinc(raw).trim();
      if (!raw || raw === 'T' || raw === 'F' || raw === 'true' || raw === 'false' || raw === 'M') return;
      var n = Number(raw);
      if (raw !== '' && isFinite(n) && /^-?\d+(?:\.\d+)?$/.test(raw)) numbers.push([name, n]);
      else texts.push(raw);
    });
    var fault = texts.filter(function (t) { return !/normal\.?$/i.test(t.trim()); });
    if (fault.length) return clipDecimals(fault[fault.length - 1]);
    if (numbers.length) return clipDecimals(numbers[0][0] + ' ' + trunc2(numbers[0][1]));
    return texts.length ? clipDecimals(texts[texts.length - 1]) : '';
  }

  function attachAlarmDetails(text, rows) {
    if (!text || !rows || !rows.length) return;
    var details = {};
    String(text).split(/(?=^@)/m).forEach(function (chunk) {
      if (chunk.charAt(0) !== '@') return;
      var idTok = chunk.split(' ')[0].trim();
      var found = chunk.match(/name,sourceRef,value\s*\n([\s\S]*?)\n\s*>>/);
      if (!found || !idTok) return;
      var detail = alarmDetailFromTable(found[1]);
      if (detail) details[idTok] = detail;
    });
    rows.forEach(function (row) {
      var val = safeGet(row.id, 'val');
      if (val && details[val]) row.detail = details[val];
    });
  }

  function parseAlarmFddPoints(text) {
    if (!text) return [];
    var points = [];
    var seen = {};
    var segments = String(text).split('<<');
    for (var s = 1; s < segments.length; s++) {
      var seg = segments[s];
      var end = seg.indexOf('>>');
      if (end < 0) continue;
      var block = seg.slice(0, end);
      var remainder = seg.slice(end + 2);
      var eq = remainder.match(/(@p:[^"\s,]+)\s+"([^"]+)"/);
      if (!eq) continue;
      var inTable = false;
      block.split('\n').forEach(function (line) {
        line = line.trim();
        if (!line) return;
        if (line.indexOf('name,sourceRef,value') === 0) { inTable = true; return; }
        if (!inTable) return;
        var parts = splitZincLine(line);
        if (parts.length < 3) return;
        var name = decodeZinc(parts[0].replace(/^"|"$/g, ''));
        var upper = name.toUpperCase();
        if (upper.indexOf('RULE_') !== 0 && upper.indexOf('FD&D_') !== 0) return;
        var id = 'fdd_' + eq[1] + '_' + name;
        if (seen[id]) return;
        seen[id] = true;
        var raw = decodeZinc(parts[2].trim().replace(/^"|"$/g, ''));
        var cur = raw;
        var kind = 'Bool';
        if (cur === 'T' || cur === 'true') cur = true;
        else if (cur === 'F' || cur === 'false') cur = false;
        else {
          var n = Number(cur);
          if (cur !== '' && isFinite(n) && /^-?\d+(?:\.\d+)?$/.test(String(cur))) { cur = n; kind = 'Number'; }
        }
        points.push({
          navName: name,
          id: { val: id, dis: eq[2] + ' ' + name },
          equipRef: { val: eq[1], dis: eq[2] },
          curVal: cur,
          kind: kind
        });
      });
    }
    return points;
  }

  function pointNav(p, equipName) {
    var nav = String(p.navName || '');
    if (!nav || nav === 'N/A') {
      var dis = safeGet(p.id, 'dis') || String(p.dis || '');
      if (dis && equipName) {
        var at = dis.toUpperCase().indexOf(String(equipName).toUpperCase());
        if (at >= 0) {
          var after = dis.slice(at + equipName.length).trim();
          if (after) nav = after;
        }
      }
      if (!nav || nav === 'N/A') nav = String(p.dis || 'N/A');
    }
    return decodeZinc(nav);
  }

  function buildRealtime(pointsText, equipText, alarmsText) {
    var points = parseZincCsv(pointsText);
    var equipment = parseZincCsv(equipText);
    var alarms = parseZincCsv(alarmsText);
    attachAlarmDetails(alarmsText || '', alarms);
    parseAlarmFddPoints(alarmsText).forEach(function (fp) {
      var fpNav = String(fp.navName || '').toUpperCase();
      var fpEq = safeGet(fp.equipRef, 'val');
      var fpDis = String(safeGet(fp.equipRef, 'dis') || '').toUpperCase();
      var existing = null;
      for (var i = 0; i < points.length; i++) {
        var p = points[i];
        if (String(p.navName || '').toUpperCase() !== fpNav) continue;
        if (safeGet(p.equipRef, 'val') === fpEq) { existing = p; break; }
        var idDis = String(safeGet(p.id, 'dis') || '').toUpperCase();
        if (fpDis && idDis.indexOf(fpDis) >= 0) { existing = p; break; }
      }
      if (existing) {
        existing.curVal = fp.curVal;
        if (!existing.equipRef) existing.equipRef = fp.equipRef;
      } else points.push(fp);
    });

    var floors = {};
    equipment.forEach(function (equip) {
      var navName = equip.navName;
      if (!navName) return;
      var equipId = safeGet(equip.id, 'val');
      var navNorm = String(navName).toUpperCase().replace(/[-_]/g, ' ').trim();
      var matched = points.filter(function (p) {
        if (safeGet(p.equipRef, 'val') === equipId) return true;
        var dis = String(safeGet(p.id, 'dis') || '').toUpperCase().replace(/[-_]/g, ' ');
        if (navNorm && dis.indexOf(navNorm) >= 0) return true;
        var pDis = String(p.dis || '').toUpperCase().replace(/[-_]/g, ' ');
        return !!(navNorm && pDis.indexOf(navNorm) >= 0);
      });
      var equipAlarms = [];
      alarms.forEach(function (a) {
        if (safeGet(a.sourceRef, 'val') === equipId && alarmIsOpen(a)) {
          equipAlarms.push({ alarm: a.message || 'N/A', priority: a.priority || 0 });
        }
      });
      var formatted = [];
      var seen = {};
      matched.forEach(function (p) {
        var pNav = pointNav(p, navName);
        var navLower = pNav.toLowerCase().trim();
        if (!navLower || navLower === 'n/a') return;
        var isRule = navLower.indexOf('rule') === 0;
        if (!isRule) {
          if (navLower.indexOf('metadata') >= 0 || navLower.indexOf('[metadata_block]') >= 0) return;
          if (navLower === 'start/stop' || navLower === 'start_stop' || navLower === 'startstop') return;
        }
        var val = p.curVal;
        if (val == null) val = p.val;
        if (val == null) val = p.v0;
        var isHis = p.his === true;
        var empty = val == null || val === '' || val === 'N/A';
        if (val && typeof val === 'object') empty = !(val.dis || val.val);
        var reporting = !empty;
        if (!reporting) {
          if (!isHis) return;
          val = null;
        }
        var unit = p.unit || '';
        var display = '—';
        var kind = 'Null';
        if (val != null) {
          var shown = displayCurVal(val, navLower, unit);
          display = shown[0];
          kind = shown[1];
        }
        var key = navLower.replace(/ /g, '_');
        if (seen[key]) return;
        seen[key] = true;
        formatted.push({
          navName: pNav,
          currentValue: display,
          status: p.status || p.curStatus || 'ok',
          id: String(safeGet(p.id, 'val') || '').replace(/^@/, ''),
          his: isHis,
          reporting: reporting,
          unit: unit,
          kind: kind
        });
      });
      var floor = safeGet(equip.floorRef, 'dis') || 'Unknown Floor';
      var bucket = String(navName).toLowerCase().indexOf('cctv') >= 0 ? 'cctv' : 'hvac';
      var tags = Object.keys(equip).filter(function (k) { return equip[k] === true && k !== 'equip' && k !== 'inAlarm'; });
      var sysRaw = equip.system;
      if (sysRaw && typeof sysRaw === 'object') sysRaw = sysRaw.dis || sysRaw.val;
      var row = {
        name: navName,
        bimId: equip.bimId || equipId || navName,
        equipId: cmmsId(equip.equipId),
        alarms: equipAlarms,
        points: formatted,
        tags: tags,
        system: String(sysRaw || '').trim().toLowerCase()
      };
      if (!floors[floor]) floors[floor] = { cctv: [], hvac: [] };
      floors[floor][bucket].push(row);
    });
    return { floors: floors, alarms: alarms, points: points };
  }

  function equipType(tags, priority) {
    var list = tags || [];
    for (var i = 0; i < (priority || []).length; i++) {
      if (list.indexOf(priority[i]) >= 0) return priority[i];
    }
    return 'other';
  }

  function flattenEquip(floors, classes) {
    classes = classes || {};
    var systemTags = classes.system_tags || [];
    var list = [];
    Object.keys(floors || {}).forEach(function (floorName) {
      var floor = floors[floorName] || {};
      Object.keys(floor).forEach(function (category) {
        var items = floor[category];
        if (!Array.isArray(items)) return;
        items.forEach(function (eq) {
          var name = eq.name || '';
          var upper = name.toUpperCase();
          if (upper.indexOf('ENERGY') >= 0 || upper.indexOf('USAGE') >= 0 || upper.indexOf('CALC') >= 0) return;
          var tags = eq.tags || [];
          var alarms = eq.alarms || [];
          list.push({
            name: name,
            floor: floorName,
            category: category,
            type: equipType(tags, classes.type_priority || []),
            tags: tags,
            system: String(eq.system || '').trim().toLowerCase(),
            isSystem: systemTags.length ? tags.some(function (t) { return systemTags.indexOf(t) >= 0; }) : true,
            inAlarm: alarms.length > 0,
            alarms: alarms,
            bimId: eq.bimId || '',
            equipId: eq.equipId || '',
            points: eq.points || []
          });
        });
      });
    });
    return list;
  }

  function severityFor(priority, bands) {
    bands = bands || DEFAULT_BANDS;
    if (typeof priority !== 'number' || !isFinite(priority)) return 'info';
    var crit = bands.critical != null ? bands.critical : 250;
    var warn = bands.warning != null ? bands.warning : 150;
    if (String(bands.order || 'desc').toLowerCase() === 'asc') {
      if (priority <= crit) return 'critical';
      return priority <= warn ? 'warning' : 'info';
    }
    if (priority >= crit) return 'critical';
    return priority >= warn ? 'warning' : 'info';
  }

  function flattenAlarms(rows, bands) {
    var alarms = [];
    var counts = { critical: 0, warning: 0, info: 0 };
    (rows || []).forEach(function (row) {
      if (!alarmIsOpen(row)) return;
      var priority = typeof row.priority === 'number' ? row.priority : null;
      var severity = severityFor(priority, bands);
      counts[severity] += 1;
      var source = row.sourceRef;
      var dispatcher = String(row.dispatcher || '').trim().toUpperCase() || null;
      var message = clipDecimals(String(row.message || ''));
      var detail = clipDecimals(String(row.detail || '').trim());
      if (detail.toLowerCase() === message.trim().toLowerCase()) detail = '';
      alarms.push({
        source: safeGet(source, 'dis') || safeGet(source, 'val') || '',
        message: message,
        detail: detail,
        priority: priority,
        severity: severity,
        dispatcher: dispatcher,
        diagnosed: dispatcher === 'CONTROL',
        occurred: row.occurred || row.created,
        state: row.state
      });
    });
    alarms.sort(function (a, b) { return String(b.occurred || '').localeCompare(String(a.occurred || '')); });
    return {
      timestamp: nowIso(),
      alarms: alarms,
      counts: { critical: counts.critical, warning: counts.warning, info: counts.info, total: counts.critical + counts.warning + counts.info }
    };
  }

  function sensorAverages(floors) {
    var temp = [];
    var hum = [];
    var co2 = [];
    Object.keys(floors || {}).forEach(function (floor) {
      ((floors[floor] || {}).hvac || []).forEach(function (eq) {
        (eq.points || []).forEach(function (pt) {
          var nav = String(pt.navName || '').toLowerCase();
          var num = parseFloat(String(pt.currentValue || '').replace(/[^0-9.\-]/g, ''));
          if (!isFinite(num)) return;
          if (nav.indexOf('temp') >= 0 && num > 10 && num < 50) temp.push(num);
          else if (nav.indexOf('humid') >= 0 && num > 5 && num < 100) hum.push(num);
          else if (nav.indexOf('co2') >= 0 && num > 100 && num < 5000) co2.push(num);
        });
      });
    });
    function avg(list) { return list.length ? Math.round((list.reduce(function (a, b) { return a + b; }, 0) / list.length) * 100) / 100 : null; }
    return { temp: avg(temp), humidity: avg(hum), co2: avg(co2) };
  }

  function fddSummary(floors) {
    var summary = [];
    Object.keys(floors || {}).forEach(function (floor) {
      ((floors[floor] || {}).hvac || []).forEach(function (eq) {
        var rules = {};
        (eq.points || []).forEach(function (pt) {
          var name = String(pt.navName || '');
          if (name.toUpperCase().indexOf('RULE_') === 0) rules[name] = String(pt.currentValue == null ? 'N/A' : pt.currentValue);
        });
        if (Object.keys(rules).length) summary.push({ equip: eq.name || 'Unknown', floor: floor, alarms: (eq.alarms || []).length, rules: rules });
      });
    });
    return summary;
  }

  function extractMeters(floors, profile) {
    profile = profile || {};
    var prefix = String(profile.prefix || '').toUpperCase();
    var pointMap = profile.point_map || {};
    if (!prefix || !Object.keys(pointMap).length) return {};
    var meters = {};
    Object.keys(floors || {}).forEach(function (floor) {
      var data = floors[floor];
      Object.keys(data || {}).forEach(function (bucket) {
        var items = data[bucket];
        if (!Array.isArray(items)) return;
        items.forEach(function (eq) {
          var name = String(eq.name || '');
          if (name.toUpperCase().indexOf(prefix) !== 0) return;
          var metrics = {};
          Object.keys(pointMap).forEach(function (key) { metrics[key] = null; });
          (eq.points || []).forEach(function (pt) {
            var nav = String(pt.navName || '').toLowerCase().replace(/[-_]/g, ' ');
            var best = null;
            var bestLen = -1;
            Object.keys(pointMap).forEach(function (key) {
              (pointMap[key] || []).forEach(function (alias) {
                if (nav.indexOf(alias) >= 0 && alias.length > bestLen) { best = key; bestLen = alias.length; }
              });
            });
            if (!best) return;
            var match = String(pt.currentValue || '').match(/-?\d+(?:\.\d+)?/);
            if (match) metrics[best] = parseFloat(match[0]);
          });
          meters[name] = metrics;
        });
      });
    });
    return meters;
  }

  function facilityServices(floors, classes) {
    classes = classes || {};
    var systemTags = classes.system_tags || [];
    var priority = classes.type_priority || [];
    var totalAlarms = 0;
    var totalFaults = 0;
    var totalMaintenance = 0;
    var totalEquipment = 0;
    var onlineEquipment = 0;
    var allEquipment = 0;
    var byType = {};
    Object.keys(floors || {}).forEach(function (floor) {
      ((floors[floor] || {}).hvac || []).forEach(function (equipment) {
        allEquipment += 1;
        var tags = equipment.tags || [];
        var etype = equipType(tags, priority);
        byType[etype] = (byType[etype] || 0) + 1;
        var isSystem = systemTags.length ? tags.some(function (t) { return systemTags.indexOf(t) >= 0; }) : true;
        if (isSystem) totalEquipment += 1;
        var points = equipment.points || [];
        var alarms = equipment.alarms || [];
        var hasConnectivity = points.some(function (p) { return p && p.reporting; });
        var isFaulty = false;
        if (alarms.length) totalAlarms += alarms.length;
        points.forEach(function (point) {
          if (!point) return;
          var pName = String(point.navName || '').toLowerCase();
          var pVal = String(point.currentValue || '').toLowerCase();
          var pStatus = String(point.status || 'ok').toLowerCase();
          var isTicket = /alarm|failure|broken|stuck|slippage|seizure|fault|error/.test(pVal);
          if (isTicket) { totalAlarms += 1; isFaulty = true; }
          var isIssue = /calibration|no response|working/.test(pVal) || pStatus !== 'ok';
          if (isTicket) isIssue = false;
          if (isIssue) totalFaults += 1;
          if ((pVal.indexOf('maintenance') >= 0 || pName.indexOf('maint') >= 0 || pVal.indexOf('manual') >= 0) && pVal.indexOf('maintaining setpoint') < 0) {
            totalMaintenance += 1;
          }
        });
        if (isSystem && hasConnectivity && !isFaulty) onlineEquipment += 1;
      });
    });
    var uptime = totalEquipment > 0 ? (onlineEquipment / totalEquipment) * 100 : 99.8;
    return {
      openTickets: totalAlarms,
      openIssues: totalFaults,
      maintenance: totalMaintenance,
      avgUptime: Math.round(uptime * 10) / 10,
      totalEquipment: totalEquipment,
      onlineEquipment: onlineEquipment,
      allEquipment: allEquipment,
      byType: byType
    };
  }

  function parseCsv(text) {
    var rows = [];
    var row = [];
    var cur = '';
    var inQ = false;
    var s = String(text || '').replace(/^\uFEFF/, '').replace(/\r/g, '');
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      if (inQ) {
        if (c === '"') {
          if (s.charAt(i + 1) === '"') { cur += '"'; i += 1; }
          else inQ = false;
        } else cur += c;
      } else if (c === '"') inQ = true;
      else if (c === ',') { row.push(cur); cur = ''; }
      else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
      else cur += c;
    }
    if (cur.length || row.length) { row.push(cur); rows.push(row); }
    return rows.filter(function (item) { return item.some(function (cell) { return String(cell).trim() !== ''; }); });
  }

  function woName(cell) {
    var token = String(cell || '').trim().split(/\s+/)[0].replace(/^"|"$/g, '');
    return WO_CANON[token.toLowerCase()] || token;
  }

  function parseMdy(value) {
    var text = String(value || '').trim().split(' ')[0];
    if (!text) return '';
    var m = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (m) {
      var year = parseInt(m[3], 10);
      if (year < 100) year += 2000;
      var month = parseInt(m[1], 10);
      var day = parseInt(m[2], 10);
      if (month < 1 || month > 12 || day < 1 || day > 31) return '';
      return year + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
    }
    var iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return iso ? iso[1] + '-' + iso[2] + '-' + iso[3] : '';
  }

  function parseWorkorderText(text) {
    var table = parseCsv(text);
    var headerAt = -1;
    var headers = [];
    for (var i = 0; i < table.length; i++) {
      var joined = table[i].join(',');
      if (joined.toLowerCase().indexOf('ver') === 0 && table[i].length === 1) continue;
      var names = table[i].map(woName);
      if (names.indexOf('equipment') >= 0 && names.indexOf('id') >= 0) {
        headerAt = i;
        headers = names;
        break;
      }
    }
    if (headerAt < 0) return [];
    var orders = [];
    for (var r = headerAt + 1; r < table.length; r++) {
      var raw = table[r];
      if (!raw || raw.length < 2) continue;
      var item = {};
      headers.forEach(function (name, index) {
        if (name && index < raw.length) item[name] = String(raw[index]).trim().replace(/^"|"$/g, '');
      });
      var equip = normId(item.equipment);
      var woId = normId(item.id);
      if (!equip || !woId) continue;
      orders.push({
        id: woId,
        equipment: equip,
        description: item.description || '',
        organization: item.organization || '',
        position: item.position || '',
        assetTag: item.assetTag || '',
        type: item.type || '',
        dueDate: item.dueDate || '',
        dueIso: parseMdy(item.dueDate || ''),
        period: item.period || '',
        pmSchedule: item.pmSchedule || '',
        created: item.created || '',
        startDate: item.startDate || '',
        endDate: item.endDate || ''
      });
    }
    return orders;
  }

  function finError(text) {
    if (!text) return 'FIN returned an empty work-order read';
    if (text.indexOf('errType') < 0 && text.indexOf('Unknown symbol') < 0) return '';
    var match = text.match(/dis:"([^"]+)"/);
    return match ? match[1].slice(0, 240) : 'FIN work-order read failed';
  }

  function liveWorkorderPayload(text) {
    var orders = parseWorkorderText(text);
    return { timestamp: nowIso(), source: 'fin', orders: orders, error: orders.length ? '' : finError(text) };
  }

  function ordersByEquipment(payload) {
    var grouped = {};
    ((payload && payload.orders) || []).forEach(function (order) {
      var id = normId(order.equipment);
      if (!id) return;
      if (!grouped[id]) grouped[id] = [];
      grouped[id].push(order);
    });
    return grouped;
  }

  function attachWorkOrders(equipment, payload) {
    var grouped = ordersByEquipment(payload);
    (equipment.equipment || []).forEach(function (eq) {
      eq.workOrders = (grouped[normId(eq.equipId)] || []).slice();
    });
    equipment.workOrderError = (payload && payload.error) || '';
  }

  function parseHistory(text) {
    var out = { rows: [], curVal: null, unit: '' };
    if (!text) return out;
    var lines = String(text).split('\n');
    for (var i = 0; i < Math.min(lines.length, 20); i++) {
      var cur = lines[i].match(/curVal:([\d.-]+)/);
      if (cur) {
        var n = parseFloat(cur[1]);
        if (isFinite(n)) out.curVal = n;
      }
      var unit = lines[i].match(/unit:"([^"]+)"/);
      if (unit) out.unit = unit[1].replace(' Dubai', '');
    }
    var start = -1;
    for (var j = 0; j < lines.length; j++) {
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(lines[j])) { start = j; break; }
    }
    if (start < 0) return out;
    for (var k = start; k < lines.length; k++) {
      var line = lines[k].trim();
      if (!line || line.indexOf(',') < 0) continue;
      var comma = line.indexOf(',');
      var ts = line.slice(0, comma).replace(' Dubai', '').trim().split('.')[0];
      var valStr = line.slice(comma + 1).replace(/[^0-9.-]/g, '');
      var val = parseFloat(valStr);
      var stamp = ts.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
      if (!stamp || !isFinite(val)) continue;
      out.rows.push({
        date: new Date(+stamp[1], +stamp[2] - 1, +stamp[3], +stamp[4], +stamp[5], +stamp[6]),
        value: val
      });
    }
    return out;
  }

  function aggregateHistory(rows) {
    if (!rows || !rows.length) return {};
    var ordered = rows.slice().sort(function (a, b) { return a.date - b.date; });
    var agg = {};
    ordered.forEach(function (item) {
      var dt = item.date;
      var key = dt.getFullYear() + '|' + dt.getMonth() + '|' + dt.getDate() + '|' + dt.getHours();
      if (!agg[key]) agg[key] = { sum: 0, count: 0, y: dt.getFullYear(), m: dt.getMonth(), d: dt.getDate(), h: dt.getHours() };
      agg[key].sum += item.value;
      agg[key].count += 1;
    });
    var nested = {};
    Object.keys(agg).forEach(function (key) {
      var item = agg[key];
      var year = String(item.y);
      var month = MONTHS[item.m];
      var day = month + ' ' + item.d;
      if (!nested[year]) nested[year] = {};
      if (!nested[year][month]) nested[year][month] = {};
      if (!nested[year][month][day]) {
        var hours = {};
        AM_PM.forEach(function (label) { hours[label] = null; });
        nested[year][month][day] = hours;
      }
      nested[year][month][day][AM_PM[item.h]] = String(Math.round((item.sum / item.count) * 100) / 100);
    });
    return nested;
  }

  function parseLiveValue(text) {
    if (!text || typeof text !== 'string') return null;
    var lines = text.trim().split('\n');
    if (lines.length < 3 || lines[0].indexOf('ver:') !== 0) return null;
    var headers = lines[1].split(',').map(function (h) { return h.trim(); });
    var idx = headers.indexOf('val');
    if (idx < 0) idx = headers.indexOf('curVal');
    if (idx < 0) return null;
    var parts = splitZincLine(lines[2]);
    if (idx >= parts.length) return null;
    var raw = parts[idx].trim();
    if (!raw || raw === 'N' || raw === 'NA' || raw === 'null' || raw === '—') return null;
    if (raw.indexOf('s:') === 0) raw = raw.slice(2);
    if ((raw.charAt(0) === '"' && raw.charAt(raw.length - 1) === '"')) raw = raw.slice(1, -1);
    if (/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(raw)) return Number(raw);
    var match = raw.match(/-?\d+(?:\.\d+)?/);
    if (match && /^-?\d+(?:\.\d+)?(?:\s*[a-zA-Z%°²³/]+)?$/.test(raw)) return parseFloat(match[0]);
    return raw || null;
  }

  function mapPool(items, limit, fn) {
    var list = items || [];
    var out = new Array(list.length);
    var next = 0;
    if (!list.length) return Promise.resolve(out);
    var workers = [];
    var n = Math.max(1, Math.min(limit, list.length));
    for (var w = 0; w < n; w++) {
      workers.push((async function () {
        while (next < list.length) {
          var i = next++;
          out[i] = await fn(list[i], i);
        }
      })());
    }
    return Promise.all(workers).then(function () { return out; });
  }

  function unauth(value) {
    return !!(value && typeof value === 'object' && value.__unauth);
  }

  function finText(path) {
    return fetch(path, {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { Accept: 'text/zinc, text/plain, */*' }
    }).then(function (res) {
      return res.text().then(function (text) {
        if (res.status === 401 || res.status === 403 || /^\s*</.test(text || '')) return { __unauth: true, status: res.status };
        if (!res.ok) return null;
        return text;
      });
    }).catch(function () { return null; });
  }

  function finalize(raw) {
    raw = raw || {};
    return {
      project: raw.project || '',
      livePoints: filled(raw.livePoints) ? raw.livePoints : {},
      powerEndpoints: filled(raw.powerEndpoints) ? raw.powerEndpoints : {},
      workorderExpr: raw.workorderExpr || DEFAULT_WO,
      meterProfile: filled(raw.meterProfile) ? raw.meterProfile : DEFAULT_METER,
      severityBands: filled(raw.severityBands) ? raw.severityBands : DEFAULT_BANDS,
      equipmentClasses: filled(raw.equipmentClasses) ? raw.equipmentClasses : DEFAULT_CLASSES,
      realtimeEndpoints: filled(raw.realtimeEndpoints) ? raw.realtimeEndpoints : DEFAULT_RT
    };
  }

  function ymd(date) {
    function p(n) { return String(n).padStart(2, '0'); }
    return date.getFullYear() + '-' + p(date.getMonth() + 1) + '-' + p(date.getDate());
  }

  function Session(raw) {
    this.cfg = finalize(raw);
    this.built = null;
    this.pointRows = [];
    this.sensor = { temp: null, humidity: null, co2: null };
    this.fdd = [];
    this.facility = {};
    this.workorderPayload = { timestamp: null, source: 'fin', orders: [], error: '' };
    this._flight = null;
    this._at = 0;
    this._docs = undefined;
  }

  Session.prototype._load = async function () {
    var cfg = this.cfg;
    var project = cfg.project;
    if (!project) return { unauthorized: true };
    var rt = cfg.realtimeEndpoints;
    var reads = await Promise.all([
      finText(fillProject(rt.points, project)),
      finText(fillProject(rt.equipment, project)),
      finText(fillProject(rt.alarms, project)),
      cfg.workorderExpr ? finText(evalPath(project, cfg.workorderExpr)) : Promise.resolve('')
    ]);
    if (reads.slice(0, 3).some(unauth)) return { unauthorized: true };
    if (reads[1] == null) return this._payload || { equipment: null, alarms: null, meters: null, workorders: null };
    var built = buildRealtime(reads[0] || '', reads[1] || '', reads[2] || '');
    this.built = built;
    this.pointRows = built.points;
    this.sensor = sensorAverages(built.floors);
    this.fdd = fddSummary(built.floors);
    this.facility = facilityServices(built.floors, cfg.equipmentClasses);
    var woText = reads[3];
    if (unauth(woText)) {
      this.workorderPayload = { timestamp: nowIso(), source: 'fin', orders: [], error: 'FIN session ended' };
    } else if (typeof woText === 'string') {
      this.workorderPayload = liveWorkorderPayload(woText);
    } else {
      this.workorderPayload = { timestamp: nowIso(), source: 'fin', orders: [], error: 'FIN work-order read failed' };
    }
    var equipment = {
      timestamp: nowIso(),
      equipment: flattenEquip(built.floors, cfg.equipmentClasses)
    };
    attachWorkOrders(equipment, this.workorderPayload);
    this._at = Date.now();
    return {
      equipment: equipment,
      alarms: flattenAlarms(built.alarms, cfg.severityBands),
      meters: extractMeters(built.floors, cfg.meterProfile),
      workorders: this.workorderPayload
    };
  };

  Session.prototype.bundle = function () {
    var self = this;
    if (self._flight) return self._flight;
    if (self._payload && Date.now() - self._at < 4000) return Promise.resolve(self._payload);
    self._flight = self._load().then(function (payload) {
      if (payload && payload.equipment) self._payload = payload;
      return payload;
    }).finally(function () { self._flight = null; });
    return self._flight;
  };

  Session.prototype.status = async function () {
    if (!this.cfg.project) return { connected: false, project_name: '' };
    var text = await finText('/api/' + encodeURIComponent(this.cfg.project) + '/read?filter=site');
    var ok = typeof text === 'string' && text.indexOf('errType') < 0;
    return { connected: ok, project_name: this.cfg.project, display_name: this.cfg.project };
  };

  function payloadOf(key) {
    return function (b) {
      if (!b) return null;
      if (b.unauthorized) return b;
      return b[key] || null;
    };
  }
  Session.prototype.equipment = function () { return this.bundle().then(payloadOf('equipment')); };
  Session.prototype.alarms = function () { return this.bundle().then(payloadOf('alarms')); };
  Session.prototype.meters = function () { return this.bundle().then(payloadOf('meters')); };
  Session.prototype.workorders = function () { return this.bundle().then(payloadOf('workorders')); };

  Session.prototype.live = async function () {
    var cfg = this.cfg;
    var keys = Object.keys(cfg.livePoints).filter(function (key) {
      var id = cfg.livePoints[key];
      return key.charAt(0) !== '_' && typeof id === 'string' && id.indexOf(':r:') >= 0;
    });
    var values = await mapPool(keys, 8, function (key) {
      return finText(evalPath(cfg.project, 'readById(@' + fillProject(cfg.livePoints[key], cfg.project) + ')'));
    });
    if (values.some(unauth)) return { unauthorized: true };
    var live = { timestamp: nowIso(), unit: 'kWh', fdd: this.fdd, facilityServices: this.facility };
    keys.forEach(function (key, i) {
      live[key] = typeof values[i] === 'string' ? parseLiveValue(values[i]) : null;
    });
    if (live.hourly_energy != null && live.total_power == null) live.total_power = live.hourly_energy;
    live.carbon_emission = live.carbon != null ? live.carbon : null;
    live.avg_temp = this.sensor.temp;
    live.avg_hum = this.sensor.humidity;
    live.avg_co2 = this.sensor.co2;
    return live;
  };

  Session.prototype.powerHistory = async function () {
    var cfg = this.cfg;
    var keys = Object.keys(cfg.powerEndpoints).filter(function (key) {
      var path = cfg.powerEndpoints[key];
      return key.charAt(0) !== '_' && typeof path === 'string' && path.charAt(0) === '/';
    });
    var texts = await mapPool(keys, 6, function (key) {
      return finText(fillProject(cfg.powerEndpoints[key], cfg.project));
    });
    if (texts.some(unauth)) return { unauthorized: true };
    var history = {};
    keys.forEach(function (key, i) {
      history[key] = aggregateHistory(parseHistory(typeof texts[i] === 'string' ? texts[i] : '').rows);
    });
    if (history.Hourly_Energy_Consumption_his && !history.Total_Power_Consumption_his) {
      history.Total_Power_Consumption_his = history.Hourly_Energy_Consumption_his;
    }
    return history;
  };

  Session.prototype.hisPoints = function () {
    var self = this;
    return this.bundle().then(function () {
      var out = [];
      (self.pointRows || []).forEach(function (row) {
        if (row.his !== true) return;
        var pid = safeGet(row.id, 'val');
        if (!pid) return;
        out.push({
          id: String(pid).replace(/^@/, ''),
          dis: safeGet(row.id, 'dis') || String(row.navName || ''),
          navName: String(row.navName || ''),
          equip: safeGet(row.equipRef, 'dis') || '',
          unit: row.unit || ''
        });
      });
      out.sort(function (a, b) { return (a.equip + a.dis).localeCompare(b.equip + b.dis); });
      return { timestamp: nowIso(), points: out };
    });
  };

  Session.prototype.pointHistory = async function (id, days) {
    var pid = String(id || '').replace(/^@/, '');
    if (!/^[A-Za-z0-9_:.\-]+$/.test(pid)) return null;
    days = Math.max(1, Math.min(parseInt(days, 10) || 7, 365));
    var start = new Date();
    start.setDate(start.getDate() - days);
    var expr = 'hisRead(@' + pid + ',' + ymd(start) + '..today(),{-limit})';
    var text = await finText(evalPath(this.cfg.project, expr));
    if (unauth(text)) return { unauthorized: true };
    if (typeof text !== 'string') return null;
    var parsed = parseHistory(text);
    return {
      id: pid,
      days: days,
      unit: parsed.unit || '',
      curVal: parsed.curVal,
      samples: parsed.rows.length,
      history: aggregateHistory(parsed.rows)
    };
  };

  Session.prototype.alarmHistory = async function (days) {
    days = Math.max(1, Math.min(parseInt(days, 10) || 30, 90));
    var start = new Date();
    start.setDate(start.getDate() - days);
    var expr = 'readAll(equip or point).alarms(' + ymd(start) + '..today())';
    var text = await finText(evalPath(this.cfg.project, expr));
    if (unauth(text)) return { unauthorized: true };
    if (typeof text !== 'string') return null;
    var byDay = {};
    var last24 = [];
    for (var h = 0; h < 24; h++) last24.push(0);
    var now = dubaiNow();
    var bands = this.cfg.severityBands;
    parseZincCsv(text).forEach(function (row) {
      if (row.alarm !== true) return;
      var occurred = row.occurred || row.created || '';
      var stamp = String(occurred).slice(0, 10);
      if (stamp) {
        if (!byDay[stamp]) byDay[stamp] = { critical: 0, warning: 0, info: 0 };
        byDay[stamp][severityFor(typeof row.priority === 'number' ? row.priority : null, bands)] += 1;
      }
      var match = String(occurred).match(/(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})/);
      if (!match || !now) return;
      var when = new Date(+match[1].slice(0, 4), +match[1].slice(5, 7) - 1, +match[1].slice(8, 10), +match[2], +match[3], +match[4]);
      var age = (now - when) / 36e5;
      if (age >= 0 && age < 24) last24[23 - Math.floor(age)] += 1;
    });
    var daysList = Object.keys(byDay).sort().map(function (day) {
      return { date: day, critical: byDay[day].critical, warning: byDay[day].warning, info: byDay[day].info };
    });
    return { days: days, retained: daysList.length > 0, byDay: daysList, last24: last24 };
  };

  Session.prototype.documents = async function () {
    if (this._docs !== undefined) return this._docs;
    var raw = null;
    var urls = ['om-warranty.json', '/backend/om-warranty.json'];
    for (var i = 0; i < urls.length; i++) {
      try {
        var res = await fetch(urls[i], { cache: 'no-store' });
        if (!res.ok) continue;
        var json = await res.json();
        if (json && Array.isArray(json.families)) { raw = json; break; }
      } catch (e) { /* catalog is optional */ }
    }
    if (!raw) return null;
    var project = this.cfg.project;
    this._docs = {
      families: raw.families.filter(function (fam) { return fam && typeof fam === 'object'; }).map(function (fam) {
        var item = {
          id: String(fam.id || ''),
          tags: fam.tags || [],
          codes: fam.codes || [],
          types: fam.types || [],
          names: fam.names || []
        };
        ['om', 'warranty'].forEach(function (kind) {
          var doc = fam[kind];
          if (!doc || !doc.ref) return;
          var ref = String(doc.ref);
          var rec = ref.charAt(0) === '@' ? ref.slice(1) : ref;
          item[kind] = {
            name: String(doc.name || ''),
            nameAr: String(doc.nameAr || ''),
            ref: ref,
            url: '/api/' + encodeURIComponent(project) + '/rec/' + encodeURIComponent(rec).replace(/%3A/gi, ':') + '/file'
          };
        });
        return item;
      })
    };
    return this._docs;
  };

  Session.prototype.evalQuery = async function (expr) {
    var text = String(expr || '');
    if (text.length > 2000 || !/^\s*(readById|readAll|hisRead)\s*\(/.test(text)) return null;
    if (/pointWrite|pointOverride|pointEmergency|pointSetDef|pointAuto|ioWrite|invoke|commit|recNew|recEdit|recRemove|eval\s*\(/i.test(text)) return null;
    var body = await finText(evalPath(this.cfg.project, text));
    return typeof body === 'string' ? body : null;
  };

  function dubaiNow() {
    try {
      var parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Dubai',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hourCycle: 'h23'
      }).formatToParts(new Date());
      function g(type) {
        var part = parts.filter(function (item) { return item.type === type; })[0];
        return part ? parseInt(part.value, 10) : 0;
      }
      return new Date(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'), g('second'));
    } catch (e) {
      return new Date();
    }
  }

  return {
    session: function (cfg) { return new Session(cfg); },
    parseWorkorderText: parseWorkorderText,
    liveWorkorderPayload: liveWorkorderPayload,
    parseZincCsv: parseZincCsv,
    buildRealtime: buildRealtime,
    flattenEquip: flattenEquip,
    flattenAlarms: flattenAlarms,
    extractMeters: extractMeters,
    severityFor: severityFor,
    aggregateHistory: aggregateHistory,
    parseHistory: parseHistory,
    cmmsId: cmmsId,
    normId: normId,
    DEFAULT_WO: DEFAULT_WO
  };
});
