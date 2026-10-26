(function () {
  'use strict';
  if (!window.DASHBOARD_OVERLAY) return;

  /* Every dashboard load (a project switch, a settings save) runs this file again. Only the newest
     copy maps data: an older one, holding the previous project's history cache and requests still
     in flight, must not write into the next project's site data. */
  var instance = window.__ekoDataMapInstance = (window.__ekoDataMapInstance || 0) + 1;
  function current() { return instance === window.__ekoDataMapInstance; }

  /* The open project's site (DashboardOverlay.tsx injects it from the saved settings) */
  function siteInfo() {
    return (window.INJECTED_PROJECT_CONFIG && window.INJECTED_PROJECT_CONFIG.site) || null;
  }
  function siteTimezone() {
    var info = siteInfo();
    return (info && info.timezone) || 'Asia/Dubai';
  }

  /* The site data is the prototype's Marsa Al Arab fixture: the structure every page renders, and
     sample figures. In the Studio (a project injected) the dashboard is in REAL mode unless the
     project turns Demo figures on: it shows only FIN readings and the project's own settings.
     Without an injected project (the standalone prototype) everything stays as it was. */
  var injected = window.INJECTED_PROJECT_CONFIG || null;
  var realMode = !!(injected && injected.site) && injected.demo !== true;
  var fixtureSite = (function () {
    var site = window.EKO_DATA && window.EKO_DATA.marsa, info = siteInfo();
    return !info || (!!info.finProject && !!site && info.finProject === site.finProject);
  })();

  (function applySiteIdentity() {
    var site = window.EKO_DATA && window.EKO_DATA.marsa;
    var info = siteInfo();
    if (!site || !info) return;
    var name = info.displayName || (fixtureSite ? '' : info.name);
    if (name) {
      site.nameEn = name; site.nameAr = name;
      // the top bar names the site from its portfolio row
      var row = (window.EKO_DATA.portfolio || []).find(function (p) { return p.key === site.key; });
      if (row) { row.nameEn = name; row.nameAr = name; }
    }
    if (realMode) clearFixtureFigures(site);
    if (realMode) applyReportingBasis(site, injected.basis || {});
    if (realMode) clearFixtureServices(site);
  })();

  /* REAL mode: the prototype's people, systems and estate are not this project's.
     - user: the Studio has no dashboard sign-in, so no name (reports say "—"); not "Arman Y."
     - integrations: the actual FIN connection (state, points, last data), not a sample BMS row
     - CMMS and AI narration: none connected, so nothing is raised or written by a simulator
     - sites: only this project; the sample estate (other sites' figures) is empty */
  function clearFixtureServices(site) {
    site.user = Object.assign({}, site.user, { name: '', nameAr: '' });
    site.integrations = [{ name: 'FIN Framework' + (siteInfo().finProject ? ' · ' + siteInfo().finProject : ''), proto: '', st: 'Connecting', hb: '', pts: '' }];
    site.features = Object.assign({}, site.features, { cmms: 'none', llm: 'none', control: 'off' });
    var D = window.EKO_DATA || {};
    if (Array.isArray(D.portfolio)) D.portfolio = D.portfolio.filter(function (p) { return p.key === site.key; });
    if (D.estate && Array.isArray(D.estate.sites)) D.estate.sites = [];
    // adapters are chosen when the app starts, which may already have happened
    if (window.EKO && window.EKO_CMMS) window.EKO_CMMS.init(window.EKO);
    if (window.EKO_LLM && window.EKO_LLM.use) window.EKO_LLM.use('none');
  }

  /* The FIN integration row: what the backend actually reports */
  function finIntegration(patch) {
    var site = window.EKO_DATA && window.EKO_DATA.marsa;
    if (!realMode || !site || !site.integrations || !site.integrations[0]) return;
    Object.assign(site.integrations[0], patch);
    paint();
  }
  function hhmm() { var n = siteNow(); return String(n.h).padStart(2, '0') + ':' + String(n.min).padStart(2, '0'); }

  /* REAL mode: every sample figure FIN does not replace is cleared, for every project (Marsa's too,
     whose fixture figures are not FIN readings either). Lists start empty and fill from FIN;
     modules with no FIN source at all (anomalies, forecast, benchmark) are hidden. */
  function clearFixtureFigures(site) {
    if (site.metrics) { site.metrics.contractedKw = null; site.metrics.baselineKw = null; }
    site.load24hMw = null;
    site.alarms = [];
    site.assets = [];
    site.meters = [];   // the prototype's meter register and its data-quality states (no FIN source)
    if (site.power) {
      var pw = site.power;
      pw.prevMonthKwh = null; pw.contractedMw = null; pw.peakAvgKw = null;
      pw.subview = null; pw.bva = null; pw.pmuChips = [];
      pw.heroCharts = { current: null, peak: null, month: null };
      pw.boards = []; pw.zones = []; pw.zonesAr = []; pw.zoneHues = [];
      pw.zoneHourly = []; pw.pmus = []; pw.peakSeries = [];
    }
    if (site.anom) { site.anom.items = []; site.anom.flaggedKwhToday = null; }
    if (site.fcst) { site.fcst.monthEndMwh = null; site.fcst.peakMwh = null; site.fcst.peakPct = null; }
    if (site.bench) { site.bench.rows = []; site.bench.siteWhm2 = null; }
    site.entitlements = site.entitlements || {};
    site.entitlements.modules = Object.assign({}, site.entitlements.modules,
      { 'energy.anom': 'hidden', 'energy.fcst': 'hidden', 'energy.bench': 'hidden' });
  }

  /* REAL mode: costs and CO2 use only the rates saved for this project (Dashboard Settings → FIN
     Config); a rate it did not set is null, so every figure that needs it reads "—". The report
     window is the site clock now, not the prototype's fixed "14:00" and "1 Sep". */
  function applyReportingBasis(site, b) {
    var basis = site.basis = site.basis || {};
    var rate = b.energyTariff == null ? null : b.energyTariff;
    var factor = b.co2Factor == null ? null : b.co2Factor;
    basis.currency = b.currency || 'AED';
    basis.aedPerKwh = rate;
    basis.tariffId = rate == null ? null : (b.tariffName || 'Project tariff');
    basis.tariffVersion = '';
    basis.tariffStatus = rate == null ? 'missing' : 'configured';
    basis.co2KgPerKwh = factor;
    basis.co2FactorId = factor == null ? null : (b.co2FactorName || 'Project factor');
    basis.co2FactorStatus = factor == null ? 'missing' : 'configured';
    basis.gasTariffStatus = b.gasTariff == null ? 'missing' : 'configured';
    if (site.gas) site.gas.tariffAedM3 = b.gasTariff == null ? null : b.gasTariff;
    var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    Object.defineProperty(basis, 'asOf', { enumerable: true, configurable: true, get: function () {
      var n = siteNow(); return String(n.h).padStart(2, '0') + ':' + String(n.min).padStart(2, '0'); } });
    Object.defineProperty(basis, 'monthStart', { enumerable: true, configurable: true, get: function () {
      return '1 ' + MON[siteNow().m]; } });
  }

  /* The site clock: year, month (0-11), day, hour, minute in the site timezone */
  function siteNow() {
    try {
      var parts = new Intl.DateTimeFormat('en-GB', { timeZone: siteTimezone(), year: 'numeric', month: 'numeric',
        day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date());
      var g = function (t) { var x = parts.find(function (p) { return p.type === t; }); return x ? parseInt(x.value, 10) : NaN; };
      var h = g('hour');
      return { y: g('year'), m: g('month') - 1, d: g('day'), h: h === 24 ? 0 : h, min: g('minute') };
    } catch (e) {
      var d = new Date();
      return { y: d.getFullYear(), m: d.getMonth(), d: d.getDate(), h: d.getHours(), min: d.getMinutes() };
    }
  }

  function sev(s) {
    s = String(s || '').toLowerCase();
    if (s === 'critical') return 'critical';
    if (s === 'warning' || s === 'high') return 'high';
    return 'medium';
  }

  function parseWhen(occurred) {
    if (!occurred) return null;
    var d = new Date(String(occurred).replace(/ [A-Za-z_\/]+$/, ''));
    return isNaN(d.getTime()) ? null : d;
  }

  function ageH(occurred) {
    var d = parseWhen(occurred);
    if (!d) return 0;
    return Math.max(0, (Date.now() - d.getTime()) / 36e5);
  }

  function raised(occurred) {
    var d = parseWhen(occurred);
    if (!d) return '';
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  function assetId(source) {
    var s = String(source || '').trim();
    var m = s.match(/\b([A-Z]{2,}[-_A-Z0-9.]+)\b/);
    return m ? m[1] : (s.slice(0, 40) || 'FIN');
  }

  /* Systems overlay groups key on these labels: HVAC, Electrical, Life safety, Security. */
  var FIN_SYS = { mechanical: 'Mechanical', electrical: 'Electrical', ems: 'EMS', utility: 'Utilities', utilities: 'Utilities' };

  function sysFromFin(eq) {
    var fin = String((eq && eq.system) || '').toLowerCase().trim();
    if (FIN_SYS[fin]) return FIN_SYS[fin];
    return classifySys(((eq && eq.name) || '') + ' ' + ((eq && eq.type) || ''), null);
  }

  function classifySys(text, asset) {
    if (asset && asset.sys && FIN_SYS[String(asset.sys).toLowerCase()]) return FIN_SYS[String(asset.sys).toLowerCase()];
    if (asset && ['Mechanical', 'Electrical', 'EMS', 'Utilities', 'Life safety', 'Security'].indexOf(asset.sys) >= 0) return asset.sys;
    if (asset && asset.sys) {
      if (asset.sys === 'elec') return 'Electrical';
      if (asset.sys === 'ems') return 'EMS';
      if (asset.sys === 'util') return 'Utilities';
      if (asset.sys === 'fire') return 'Life safety';
      if (asset.sys === 'sec') return 'Security';
      if (asset.sys === 'hvac' || asset.sys === 'vent' || asset.sys === 'pumps') return 'Mechanical';
    }
    var s = String(text || (asset && (asset.id + ' ' + (asset.typeEn || ''))) || '').toLowerCase();
    function hit(words) {
      return words.some(function (w) {
        return new RegExp('(?:^|[^a-z0-9])' + w + '(?:[^a-z0-9]|\\d|$)').test(s);
      });
    }
    if (hit(['water', 'gas', 'plumbing'])) return 'Utilities';
    if (hit(['pmu'])) return 'EMS';
    if (hit(['mcc', 'smdb', 'lvfp', 'ats', 'edb', 'ups', 'elec', 'emcc', 'lighting']) || /(?:^|[^a-z0-9])db[-_]/.test(s)) return 'Electrical';
    if (hit(['facp', 'fm200', 'fire', 'smoke', 'sprinkler', 'detector']) || /(?:^|[^a-z0-9])fd[-_]/.test(s)) return 'Life safety';
    if (hit(['cctv', 'camera']) || /(?:^|[^a-z0-9])cam[-_]/.test(s)) return 'Security';
    return 'Mechanical';
  }

  /* a readable, stable id part (mapAlarm's alarm ids) */
  function slugId(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }
  function mapAlarm(a) {
    var src = a.source || '';
    var msg = a.message || src;
    var detail = String(a.detail || '').trim();
    if (detail.toLowerCase() === String(msg).trim().toLowerCase()) detail = '';
    var asset = assetId(src);
    var site = window.EKO_DATA && window.EKO_DATA.marsa;
    var matchedAsset = (site && site.assets || []).find(function(as) {
      return namesMatch(as.id, asset) || namesMatch(as.id, src);
    });
    return {
      // FIN's record id, else what the alarm is: never its place in the list, which moves when FIN
      // adds or drops a record and made the same alarm look new (and lose its acknowledgement)
      id: 'fin-' + slugId(a.id || [src, msg, a.occurred].join(' ')),
      fam: 'sys',
      asset: matchedAsset ? matchedAsset.id : asset,
      bimId: matchedAsset ? matchedAsset.bimId : null,
      sev: sev(a.severity),
      cat: a.diagnosed ? 'fdd' : 'sys',
      sys: classifySys(src + ' ' + msg, matchedAsset),
      ack: null,
      ageH: ageH(a.occurred),
      locEn: src,
      locAr: src,
      plainEn: msg,
      plainAr: msg,
      techEn: detail,
      techAr: detail,
      impactAedMo: null,
      raised: raised(a.occurred),
      raisedAt: (function () { var d = parseWhen(a.occurred); return d ? d.getTime() : null; })(),   /* the one stored time; labels derive from it */
      lifecycle: []
    };
  }

  function isOnVal(v) {
    var u = String(v == null ? '' : v).trim().toUpperCase();
    return u === 'T' || u === 'TRUE' || u === 'ON';
  }
  function isOffVal(v) {
    var u = String(v == null ? '' : v).trim().toUpperCase();
    return u === 'F' || u === 'FALSE' || u === 'OFF';
  }
  function fddLooksNormal(v) {
    var s = String(v == null ? '' : v).trim();
    if (!s || isOffVal(s)) return true;
    if (isOnVal(s)) return false;
    // " - Normal" or " : Normal"
    return /[-–:]\s*normal\s*$/i.test(s) || /^normal$/i.test(s);
  }
  function fddLooksFault(v) {
    var s = String(v == null ? '' : v).trim();
    if (!s || fddLooksNormal(s)) return false;
    if (isOnVal(s)) return true;
    return /possible\s+fault|not\s+maintaining|no\s+response|not\s+working|\bfault\b|\balarm\b|energy\s+waste/i.test(s);
  }
  function looksHealthy(v) {
    var s = String(v == null ? '' : v).trim();
    if (!s || s === '—' || s === '--' || isOffVal(s)) return true;
    if (/^-?\d+(?:\.\d+)?$/.test(s)) return Number(s) === 0;
    return /^(normal|ok|healthy|clean|closed?|inactive|none|no\s+(alarm|fault|trip))\b/i.test(s) || /[-–:]\s*normal\s*$/i.test(s);
  }
  /* A flag is in alarm unless its word is healthy; free text only when it reads as a fault */
  function readingInAlarm(v, isFlag) {
    return isFlag ? !looksHealthy(v) : fddLooksFault(v);
  }
  function fddGroup(name) {
    var u = String(name || '').toUpperCase();
    var m = u.match(/^(FD&D[_-]?\d+|FDD[_-]?\d+|RULE[_-][A-Z0-9]+)/);
    return m ? m[1].replace(/-/g, '_') : u;
  }
  /* In alarm only while FIN lists an alarm on it or flags it inAlarm */
  function linkAlarms(site) {
    if (!site || !Array.isArray(site.assets)) return;
    site.assets.forEach(function (asset) {
      asset.alarms = (site.alarms || []).filter(function (a) {
        return namesMatch(a.asset, asset.id) || (asset.bimId && a.bimId === asset.bimId);
      }).map(function (a) { return a.id; });
      if (asset.st !== 'stale') asset.st = asset.alarms.length || asset.inAlarm ? 'alarm' : 'ok';
    });
  }

  function applyAlarms(payload) {
    var site = window.EKO_DATA && window.EKO_DATA.marsa;
    if (!site || !payload || !Array.isArray(payload.alarms)) return;
    var acked = {};   // an acknowledgement made here lives on the alarm object: keep it across polls
    (site.alarms || []).forEach(function (a) { if (a && a.ack) acked[a.id] = a.ack; });
    site.alarms = payload.alarms.map(mapAlarm);
    site.alarms.forEach(function (a) { if (acked[a.id]) a.ack = acked[a.id]; });
    linkAlarms(site);
    if (window.EKO_HOST_ENGINE && typeof window.EKO_HOST_ENGINE.resolveAllAssetPositions === 'function') {
      window.EKO_HOST_ENGINE.resolveAllAssetPositions();
    }
    paint();
  }

  function asNum(v) {
    if (typeof v === 'number' && isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '') {
      var n = Number(v);
      if (isFinite(n)) return n;
    }
    return null;
  }

  function trunc1(v) {
    if (v == null || !isFinite(v)) return v;
    return Math.trunc(v * 10 + (v < 0 ? -1e-9 : 1e-9)) / 10;
  }

  function kpiStatus(v) {
    if (v == null || v === '') return { en: null, ar: null, tone: 'ok' };
    if (typeof v === 'number' && isFinite(v)) {
      var pct = Math.abs(v) <= 1 ? v * 100 : v;
      if (pct >= 80) return { en: 'Excellent', ar: 'ممتاز', tone: 'ok' };
      if (pct >= 50) return { en: 'Fair', ar: 'مقبول', tone: 'warn' };
      return { en: 'Poor', ar: 'ضعيف', tone: 'warn' };
    }
    var s = String(v).replace(/^s:/, '').replace(/^"|"$/g, '').trim();
    if (!s) return { en: null, ar: null, tone: 'ok' };
    var low = s.toLowerCase();
    var tone = /poor|crit|bad|alarm|fail|deviat/.test(low) ? 'warn' : /warn|fair|caution/.test(low) ? 'warn' : 'ok';
    return { en: s, ar: s, tone: tone };
  }

  function toMw(v) {
    return v > 50 ? v / 1000 : v;
  }

  /* Distribution boards: Eko-DT's board keys, as listed in Data Mapping (a live key and an hourly
     history endpoint each). A board is shown only when the project maps one of its keys, so a
     project that maps none has no boards, never Marsa's. `pmu` is the meter that feeds the board
     on Marsa Al Arab only (fixtureSite): another site's PMU numbers mean nothing here. */
  var BOARDS = [
    { name: "MCC 1",        live: "mcc1",      his: "Hourly_EC_MCC1_his",     pmu: "PMU09", hue: "#4EA3E8" },
    { name: "MCC 2",        live: "mcc2",      his: "Hourly_EC_MCC2_his",     pmu: "PMU04", hue: "#F0A93B" },
    { name: "Kitchen SMDB", live: "smdb_kit",  his: "Hourly_EC_SMDB_KIT_his", pmu: "PMU05", hue: "#45C79A" },
    { name: "LVFP",         live: "lvfp",      his: "Hourly_EC_LVFP_his",     pmu: "PMU06", hue: "#E48FC4" },
    { name: "ATS",          live: "ats",       his: "Hourly_EC_ATS_his",      pmu: "PMU07", hue: "#A78BFA" },
    { name: "Sump pump",    live: "sump_pump", his: "Hourly_EC_SP_his",       pmu: "PMU08", hue: "#E06C75" }
  ];
  /* The project's own boards (Dashboard Settings → Data Mapping → Power Boards), each naming Data
     Mapping keys. Always listed, so a board with no reading shows "--" rather than disappearing. */
  var HUES = ["#4EA3E8", "#F0A93B", "#45C79A", "#E48FC4", "#A78BFA", "#E06C75", "#5FC4C9", "#C9A65F", "#8FA3E4", "#E4A38F"];
  var CONFIGURED_BOARDS = (function () {
    var list = injected && Array.isArray(injected.powerBoards) ? injected.powerBoards : null;
    if (!list || !list.length) return null;
    return list.filter(function (b) { return b && b.name && b.liveKey; }).map(function (b, i) {
      return { name: String(b.name), live: String(b.liveKey), his: b.historyKey ? String(b.historyKey) : null,
        pmu: b.meter ? String(b.meter) : null, hue: HUES[i % HUES.length] };
    });
  })();
  /* Whose board ↔ meter links to trust: the project's configured ones, else Marsa Al Arab's own */
  var boardMeterLinks = !!CONFIGURED_BOARDS || fixtureSite;
  /* Configured boards are listed from the start, readings unknown ("--") until FIN answers for this
     project: never "not configured", and never the sample boards and their series */
  (function seedConfiguredBoards() {
    var pw = window.EKO_DATA && window.EKO_DATA.marsa && window.EKO_DATA.marsa.power;
    if (!CONFIGURED_BOARDS || !pw) return;
    pw.boards = CONFIGURED_BOARDS.map(function (b) { return [b.name, null]; });
    pw.zones = CONFIGURED_BOARDS.map(function (b) { return b.name; });
    pw.zonesAr = pw.zones.slice();
    pw.zoneHues = CONFIGURED_BOARDS.map(function (b) { return b.hue; });
    ["zoneHourly", "zoneLast24", "zoneWeekly", "zoneMonthly", "zoneWTD", "zoneMTD", "zoneYesterday", "zonePrevWeek", "zonePrevMonth"]
      .forEach(function (k) { pw[k] = []; });
    pw.pmuFlats = {};
  })();
  /* The boards to show: the configured ones; else the built-in ones this project maps (its live
     key is served, or its history endpoint is) */
  function mappedBoards(p) {
    if (CONFIGURED_BOARDS) return CONFIGURED_BOARDS;
    var hist = (p && p.power_history) || {};
    return BOARDS.filter(function (b) { return (p && b.live in p) || b.his in hist; });
  }
  var lastBoardKwh = {};

  function applyPower(p) {
    var site = window.EKO_DATA && window.EKO_DATA.marsa;
    if (!site || !p || !site.metrics) return;
    var m = site.metrics;
    var el = site.energyLanding;
    var changed = false;
    function set(obj, key, val) {
      if (!obj || val == null) return;
      if (obj[key] === val) return;
      obj[key] = val;
      changed = true;
    }
    var loadKw = asNum(p.hourly_energy != null ? p.hourly_energy : p.total_power);
    if (loadKw != null) { set(m, "loadNowMw", trunc1(toMw(loadKw))); set(el, "currentKw", trunc1(loadKw)); }
    var peak = asNum(p.peak_demand);
    if (peak != null && peak > 0) {
      set(m, "peakTodayKw", trunc1(peak));
      set(m, "peakTodayMw", trunc1(peak / 1000));
    } else {
      m.peakTodayKw = null;
      m.peakTodayMw = null;
    }
    var carbonKgH = asNum(p.carbon);
    if (carbonKgH != null) set(el, "carbonKgH", trunc1(carbonKgH));
    var iaq = asNum(p.iaq_index);
    if (iaq != null) {
      set(m, "iaq", trunc1(iaq));
      if (site.spaces) {
        set(site.spaces, "ieq", iaq);
        var q = iaq >= 80 ? "good" : iaq >= 60 ? "moderate" : "poor";
        set(site.spaces, "ieqCapEn", q + " · CO\u2082 within limits");
        set(site.spaces, "ieqCapAr", "جيد · CO\u2082 ضمن الحدود");
      }
    }
    var comfort = asNum(p.comfort_compliance);
    if (comfort != null) {
      set(m, "comfortIndex", trunc1(comfort));
      if (site.spaces) {
        set(site.spaces, "comfortPct", trunc1(comfort));
        set(site.spaces, "spComfortCap", "within target band");
      }
    }
    var water = asNum(p.total_water);
    if (water != null) {
      set(m, "waterTodayM3", trunc1(water));
      if (site.landing && site.landing.water) {
        set(site.landing.water, "headEn", trunc1(water) + " m³ today");
        set(site.landing.water, "headAr", trunc1(water) + " م³ اليوم");
      }
    }
    var gas = asNum(p.total_gas);
    if (gas != null) {
      set(m, "gasTodayM3", trunc1(gas));
      if (site.landing && site.landing.gas) {
        set(site.landing.gas, "headEn", trunc1(gas) + " m³ today");
        set(site.landing.gas, "headAr", trunc1(gas) + " م³ اليوم");
      }
    }
    var mtd = asNum(p.current_month);
    if (mtd != null) set(el, "mtdKwh", trunc1(mtd));
    var perf = asNum(p.energy_performance);
    if (perf != null && perf >= 0 && perf <= 500) {
      set(el, "performancePct", trunc1(perf));
    } else {
      el.performancePct = null;
    }

    // Wire live endpoints to Energy Landing summary cards
    if (el) {
      var rawOvernight = asNum(p.after_hours_deviation != null ? p.after_hours_deviation : p.energy_performance);
      var rawEnDev = asNum(p.energy_deviation);
      var overnight = rawOvernight;
      var enDev = (rawEnDev != null && rawEnDev >= -100 && rawEnDev <= 100) ? rawEnDev : null;
      var nightSt = kpiStatus(p.kpi_after_hours_ratio);

      if (overnight != null) set(el, "overnightDeviationPct", trunc1(overnight));
      else el.overnightDeviationPct = null;
      set(el, "overnightWordEn", nightSt.en);
      set(el, "overnightWordAr", nightSt.ar);
      set(el, "overnightTone", nightSt.tone);

      if (el.sumGauges) {
        el.sumGauges.forEach(function(g) {
          if (g.key === "enDev" && enDev != null) {
            set(g, "val", trunc1(enDev));
            set(g, "wordEn", Math.abs(enDev) <= 5 ? "Healthy" : "Deviation");
            set(g, "wordAr", Math.abs(enDev) <= 5 ? "سليم" : "انحراف");
            set(g, "tone", Math.abs(enDev) <= 5 ? "ok" : "warn");
          }
        });
      }

      if (el.kpis) {
        var lossIdle = asNum(p.energy_loss_idle);
        var lossHvac = asNum(p.energy_loss_hvac);
        var costIdle = asNum(p.cost_impact_idle);
        var costHvac = asNum(p.cost_impact_hvac);
        var eprVal = asNum(p.hvac_epr);
        var eprSt = kpiStatus(p.kpi_hvac_epr);
        el.kpis.forEach(function (k) {
          if (k.key === "overnight") {
            if (overnight != null) set(k, "gaugeVal", trunc1(overnight));
            set(k, "stateEn", nightSt.en);
            set(k, "stateAr", nightSt.ar);
            set(k, "tone", nightSt.tone);
            if (lossIdle != null) set(k, "wasteKwh", trunc1(lossIdle));
            if (costIdle != null) set(k, "costAed", trunc1(costIdle));
          }
          if (k.key === "epr") {
            if (eprVal != null) set(k, "gaugeVal", trunc1(eprVal));
            set(k, "stateEn", eprSt.en);
            set(k, "stateAr", eprSt.ar);
            set(k, "tone", eprSt.tone);
            if (lossHvac != null) set(k, "wasteKwh", trunc1(lossHvac));
            if (costHvac != null) set(k, "costAed", trunc1(costHvac));
          }
        });
        var wasteSum = 0, wasteN = 0, costSum = 0, costN = 0;
        el.kpis.forEach(function (k) {
          if (k.wasteKwh != null && isFinite(k.wasteKwh)) { wasteSum += k.wasteKwh; wasteN++; }
          if (k.costAed != null && isFinite(k.costAed)) { costSum += k.costAed; costN++; }
        });
        if (wasteN) set(el, "wasteTotalKwh", trunc1(wasteSum));
        if (costN) set(el, "wasteTotalAed", trunc1(costSum));
        /* Adnocwarsan risk: KPI waste kWh / current-month kWh, bar clamped 0–100. */
        var monthKwh = asNum(p.current_month);
        el.kpis.forEach(function (k) {
          if (monthKwh > 0 && k.wasteKwh != null && k.wasteKwh > 0) {
            set(k, "sharePct", trunc1(k.wasteKwh / monthKwh * 100));
          }
        });
      }
    }

    // Wire live endpoints to the Systems HVAC & Mechanical stat cards
    // Sanity-checked: reject any value outside a physically plausible range → stays null → shows '--'
    if (site.systems && site.systems.groups) {
      var hvacGrp = site.systems.groups.find(function(g) { return g.id === "mechanical" || g.id === "hvac"; });
      if (hvacGrp && hvacGrp.cards) {
        var rawTempDev  = asNum(p.temp_deviation);
        var rawEnPerf   = asNum(p.energy_performance);
        var rawComfIdx  = asNum(p.comfort_compliance);
        // Plausible ranges — anything outside is treated as null (raw FIN KPI calc artifact)
        var tempDev  = (rawTempDev  != null && rawTempDev  >= 0 && rawTempDev  <= 50)  ? rawTempDev  : null;
        var enPerf   = (rawEnPerf   != null && rawEnPerf   >= 0 && rawEnPerf   <= 5)   ? rawEnPerf   : null;
        var comfIdx  = (rawComfIdx  != null && rawComfIdx  >= 0 && rawComfIdx  <= 100) ? rawComfIdx  : null;
        hvacGrp.cards.forEach(function(c) {
          if (c.labelEn === "TEMPERATURE DEVIATION INDEX") {
            if (tempDev != null) {
              set(c, "v", trunc1(tempDev));
              set(c, "capEn", tempDev > 2 ? "Warning" : "Normal");
              set(c, "capAr", tempDev > 2 ? "تحذير" : "طبيعي");
              set(c, "tone", tempDev > 2 ? "warn" : "ok");
            }
          }
          if (c.labelEn === "ENERGY PERFORMANCE") {
            if (enPerf != null) {
              set(c, "v", trunc1(enPerf));
              set(c, "capEn", enPerf < 1.2 ? "Healthy" : "Above target");
              set(c, "capAr", enPerf < 1.2 ? "سليم" : "فوق الهدف");
              set(c, "tone", enPerf < 1.2 ? "ok" : "warn");
            }
          }
          if (c.labelEn === "COMFORT ENERGY INDEX") {
            if (comfIdx != null) {
              set(c, "v", trunc1(comfIdx));
              set(c, "capEn", comfIdx >= 60 ? "Good" : comfIdx >= 40 ? "Fair" : "Poor");
              set(c, "capAr", comfIdx >= 60 ? "جيد" : comfIdx >= 40 ? "مقبول" : "ضعيف");
              set(c, "tone", comfIdx >= 60 ? "ok" : "warn");
            }
          }
        });
      }
    }

    // Wire live endpoints to the Systems Electrical stat cards
    if (site.systems && site.systems.groups) {
      var elecGrp = site.systems.groups.find(function(g) { return g.id === "electrical"; });
      if (elecGrp && elecGrp.cards) {
        var rawEnDev = asNum(p.energy_deviation);
        var rawPeak  = asNum(p.peak_demand);
        // Plausible ranges
        var enDev = (rawEnDev != null && rawEnDev >= -100 && rawEnDev <= 100) ? rawEnDev : null;
        var peakD = (rawPeak  != null && rawPeak >= 0) ? rawPeak : null;

        elecGrp.cards.forEach(function(c) {
          if (c.labelEn === "ENERGY DEVIATION" && enDev != null) {
            set(c, "v", trunc1(enDev));
            set(c, "capEn", Math.abs(enDev) <= 5 ? "Healthy" : "Deviation");
            set(c, "capAr", Math.abs(enDev) <= 5 ? "سليم" : "انحراف");
            set(c, "tone", Math.abs(enDev) <= 5 ? "ok" : "warn");
          }
          if (c.labelEn === "PEAK DEMAND" && peakD != null) {
            set(c, "v", trunc1(peakD));
            set(c, "capEn", "Recorded");
            set(c, "capAr", "مسجل");
            set(c, "tone", "ok");
          }
        });
      }
    }

    if (p.power_history) {
      function extractDaily(histId) {
        var hist = p.power_history[histId];
        if (!hist) return [];
        var dArr = [];
        for (var year in hist) {
          for (var month in hist[year]) {
            for (var day in hist[year][month]) {
              var hData = hist[year][month][day];
              var sum = 0, count = 0;
              for (var hr in hData) {
                if (hData[hr] != null) { sum += parseFloat(hData[hr]); count++; }
              }
              if (count > 0) dArr.push(Math.trunc((sum / count) * 100) / 100);
            }
          }
        }
        return dArr.slice(-7);
      }

      function applySparkAndDelta(summaryObj, sparkArr) {
        if (!summaryObj) return;
        summaryObj.spark = sparkArr;
        if (sparkArr.length >= 2) {
          var last = sparkArr[sparkArr.length - 1];
          var prevSum = 0;
          for (var i = 0; i < sparkArr.length - 1; i++) prevSum += sparkArr[i];
          var typical = prevSum / (sparkArr.length - 1);
          if (typical > 0) {
            var pct = Math.round(((last - typical) / typical) * 100);
            var sign = pct > 0 ? "+" : "";
            summaryObj.deltaEn = sign + pct + "% vs typical";
            summaryObj.deltaAr = sign + pct + "% مقارنة بالمعتاد";
          } else {
            summaryObj.deltaEn = null; summaryObj.deltaAr = null;
          }
        } else {
          summaryObj.deltaEn = null; summaryObj.deltaAr = null;
        }
      }

      var enSpark = extractDaily("Hourly_Energy_Consumption_his");
      if (!enSpark.length) enSpark = extractDaily("Total_Power_Consumption_his");
      var wtSpark = extractDaily("Total_Water_Consumption_his");
      if (site.summary) { applySparkAndDelta(site.summary[1], wtSpark); changed = true; }
      var gsSpark = extractDaily("Total_Gas_Consumption_his");
      if (site.summary) { applySparkAndDelta(site.summary[2], gsSpark); changed = true; }

      if (el && enSpark.length > 0) {
        set(el, "perfSpark", enSpark);
        if (enSpark.length >= 2) {
          var last = enSpark[enSpark.length - 1];
          var prevSum = 0;
          for (var i = 0; i < enSpark.length - 1; i++) prevSum += enSpark[i];
          var typical = prevSum / (enSpark.length - 1);
          if (typical > 0) {
            var pct = Math.round(((last - typical) / typical) * 100);
            var sign = pct > 0 ? "+" : "";
            set(el, "perfDeltaEn", sign + pct + "% vs 7d avg");
            set(el, "perfDeltaAr", sign + pct + "% عن متوسط 7 أيام");
            set(el, "perfWordEn", pct <= 5 ? "Excellent" : "Check Load");
            set(el, "perfWordAr", pct <= 5 ? "ممتاز" : "فحص الحمل");
          }
        }
      }

      var MONTH_I = {
        january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
        july: 6, august: 7, september: 8, october: 9, november: 10, december: 11
      };
      var HOUR_I = {};
      (function () {
        var h, h12, ap, AP;
        for (h = 0; h < 24; h++) {
          h12 = h % 12 === 0 ? 12 : h % 12;
          ap = h < 12 ? "am" : "pm";
          AP = h < 12 ? "AM" : "PM";
          HOUR_I[h12 + " " + ap] = h;
          HOUR_I[String(h12).padStart(2, "0") + " " + ap] = h;
          HOUR_I[h12 + ":00 " + AP] = h;
          HOUR_I[h12 + ":00 " + ap] = h;
          HOUR_I[String(h12).padStart(2, "0") + ":00 " + AP] = h;
          HOUR_I[String(h12).padStart(2, "0") + ":00 " + ap] = h;
          HOUR_I[String(h)] = h;
        }
      })();
      var MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

      function flattenHist(hist) {
        var out = [];
        if (!hist) return out;
        Object.keys(hist).forEach(function (year) {
          var y = parseInt(year, 10);
          if (!isFinite(y)) return;
          Object.keys(hist[year] || {}).forEach(function (month) {
            var mo = MONTH_I[String(month).toLowerCase()];
            if (mo == null) {
              var mn = parseInt(month, 10);
              mo = isFinite(mn) ? mn - 1 : null;
            }
            if (mo == null) return;
            Object.keys(hist[year][month] || {}).forEach(function (day) {
              var da = parseInt(String(day).split(" ").pop(), 10);
              if (!isFinite(da)) return;
              var hData = hist[year][month][day];
              Object.keys(hData || {}).forEach(function (hr) {
                if (hData[hr] == null || hData[hr] === "") return;
                var v = parseFloat(hData[hr]);
                if (!isFinite(v)) return;
                var hi = HOUR_I[String(hr).toLowerCase()];
                if (hi == null) hi = HOUR_I[hr];
                if (hi == null) {
                  var hn = parseInt(hr, 10);
                  hi = isFinite(hn) ? hn : null;
                }
                if (hi == null) return;
                out.push({ y: y, m: mo, d: da, h: hi, val: v });
              });
            });
          });
        });
        out.sort(function (a, b) { return a.y - b.y || a.m - b.m || a.d - b.d || a.h - b.h; });
        return out;
      }

      function nowParts() {
        try {
          var parts = new Intl.DateTimeFormat("en-GB", {
            timeZone: siteTimezone(),
            year: "numeric",
            month: "numeric",
            day: "numeric",
            hour: "numeric",
            hourCycle: "h23"
          }).formatToParts(new Date());
          var get = function (t) {
            var x = parts.find(function (p) { return p.type === t; });
            return x ? parseInt(x.value, 10) : NaN;
          };
          var h = get("hour");
          if (h === 24) h = 0;
          return { y: get("year"), m: get("month") - 1, d: get("day"), h: h };
        } catch (e) {
          var n = new Date();
          return { y: n.getFullYear(), m: n.getMonth(), d: n.getDate(), h: n.getHours() };
        }
      }

      function shiftDay(y, m, d, delta) {
        var dt = new Date(Date.UTC(y, m, d));
        dt.setUTCDate(dt.getUTCDate() + delta);
        return { y: dt.getUTCFullYear(), m: dt.getUTCMonth(), d: dt.getUTCDate() };
      }

      function hoursThrough(flat, y, m, d, maxH) {
        var hours = [], i;
        for (i = 0; i <= maxH; i++) hours.push(null);
        (flat || []).forEach(function (pt) {
          if (pt.y === y && pt.m === m && pt.d === d && pt.h >= 0 && pt.h <= maxH) hours[pt.h] = pt.val;
        });
        return hours;
      }

      function sumKnown(arr) {
        var s = 0, n = 0;
        (arr || []).forEach(function (v) {
          if (v != null && isFinite(v)) { s += v; n++; }
        });
        return n ? s : null;
      }

      /* FIN nav name is Hourly_Energy_Consumption. Each sample is that hour's
         kWh. Energy today is midnight through the current hour, Dubai time.
         Yesterday uses the same hours so the percent and the spark match. */
      var hourlyFlat = flattenHist(
        p.power_history.Hourly_Energy_Consumption_his || p.power_history.Total_Power_Consumption_his
      );
      var nowP = nowParts();
      var yestP = shiftDay(nowP.y, nowP.m, nowP.d, -1);
      var todayHours = hoursThrough(hourlyFlat, nowP.y, nowP.m, nowP.d, nowP.h);
      var yestHours = hoursThrough(hourlyFlat, yestP.y, yestP.m, yestP.d, nowP.h);
      var todayKwh = sumKnown(todayHours);
      var yestKwh = sumKnown(yestHours);
      if (todayKwh != null && todayKwh > 0) {
        set(m, "energyTodayKwh", trunc1(todayKwh));
        set(m, "energyTodayMwh", todayKwh / 1000);
      } else {
        m.energyTodayKwh = null;
        m.energyTodayMwh = null;
      }
      // real mode's basis.asOf is already the live site clock (a getter, applyReportingBasis)
      if (site.basis && !realMode) site.basis.asOf = String(nowP.h).padStart(2, "0") + ":00";
      if (site.summary && site.summary[0]) {
        var energyRow = site.summary[0];
        energyRow.spark = todayHours;
        energyRow.sparkCompare = yestHours;
        if (todayKwh != null && yestKwh != null && yestKwh > 0) {
          var yPct = Math.round(((todayKwh - yestKwh) / yestKwh) * 100);
          var ySign = yPct > 0 ? "+" : "";
          energyRow.deltaEn = ySign + yPct + "% vs yesterday";
          energyRow.deltaAr = ySign + yPct + "% مقارنة بالأمس";
        } else {
          energyRow.deltaEn = null;
          energyRow.deltaAr = null;
        }
        changed = true;
      }

      if (site.power && site.power.bva && site.power.bva.ranges) {
        var bvaLabs = [], bvaI;
        for (bvaI = 0; bvaI < todayHours.length; bvaI++) bvaLabs.push(String(bvaI).padStart(2, "0"));
        site.power.bva.ranges.today = {
          unit: "kWh",
          labels: bvaLabs,
          actual: todayHours.map(function (v) { return v == null ? 0 : v; }),
          baseline: yestHours.map(function (v) { return v == null ? null : v; })
        };
        changed = true;
      }

      function todayHourly(flat) {
        var now = nowParts();
        var n = Math.min(24, Math.max(1, now.h + 1));
        var hours = [], i;
        for (i = 0; i < n; i++) hours[i] = 0;
        (flat || []).forEach(function (p) {
          if (p.y === now.y && p.m === now.m && p.d === now.d && p.h >= 0 && p.h < n) {
            hours[p.h] = Math.trunc(p.val * 100) / 100;
          }
        });
        return hours;
      }

      function cmpPoint(a, b) {
        return a.y - b.y || a.m - b.m || a.d - b.d || a.h - b.h;
      }

      function latestPoint(flats) {
        var latest = null;
        (flats || []).forEach(function (flat) {
          (flat || []).forEach(function (p) {
            if (!latest || cmpPoint(p, latest) > 0) latest = p;
          });
        });
        return latest;
      }

      function firstPoint(flats) {
        var first = null;
        (flats || []).forEach(function (flat) {
          (flat || []).forEach(function (p) {
            if (!first || cmpPoint(p, first) < 0) first = p;
          });
        });
        return first;
      }

      function mondayOf(p) {
        var dt = new Date(p.y, p.m, p.d);
        dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7));
        return dt;
      }

      function weekKey(dt) {
        return dt.getFullYear() + "-" + (dt.getMonth() + 1) + "-" + dt.getDate();
      }

      function lastNWeeks(flats, n) {
        var now = nowParts();
        var end = mondayOf(now);
        var keys = [], i, dt;
        for (i = n - 1; i >= 0; i--) {
          dt = new Date(end.getFullYear(), end.getMonth(), end.getDate() - i * 7);
          keys.push({ k: weekKey(dt), y: dt.getFullYear(), m: dt.getMonth(), d: dt.getDate() });
        }
        return keys;
      }

      function lastNMonths(flats, n) {
        var now = nowParts();
        var keys = [], i, mm, yy;
        for (i = n - 1; i >= 0; i--) {
          mm = now.m - i;
          yy = now.y;
          while (mm < 0) { mm += 12; yy -= 1; }
          keys.push({ k: yy + "-" + (mm + 1), y: yy, m: mm });
        }
        return keys;
      }

      function lastNHours(flats, n) {
        var now = nowParts();
        var end = new Date(now.y, now.m, now.d, now.h);
        var keys = [], i, dt;
        for (i = n - 1; i >= 0; i--) {
          dt = new Date(end.getTime() - i * 36e5);
          keys.push({
            k: dt.getFullYear() + "-" + (dt.getMonth() + 1) + "-" + dt.getDate() + "-" + dt.getHours(),
            y: dt.getFullYear(), m: dt.getMonth(), d: dt.getDate(), h: dt.getHours()
          });
        }
        return keys;
      }

      function bucket(flat, keyFn, keys, mode) {
        var map = {};
        (flat || []).forEach(function (p) {
          var k = keyFn(p);
          if (!map[k]) map[k] = { sum: 0, max: -Infinity };
          map[k].sum += p.val;
          if (p.val > map[k].max) map[k].max = p.val;
        });
        return keys.map(function (dk) {
          var row = map[dk.k];
          if (!row) return 0;
          var v = mode === "max" ? row.max : row.sum;
          return Math.trunc(v * 100) / 100;
        });
      }

      function pointWeekKey(p) {
        return weekKey(mondayOf(p));
      }

      function pointMonthKey(p) {
        return p.y + "-" + (p.m + 1);
      }

      function byHour(flat, keys) {
        var map = {};
        (flat || []).forEach(function (p) {
          map[p.y + "-" + (p.m + 1) + "-" + p.d + "-" + p.h] = p.val;
        });
        return keys.map(function (hk) {
          var v = map[hk.k];
          return v == null ? 0 : Math.trunc(v * 100) / 100;
        });
      }

      function weekBarLabels(keys) {
        return keys.map(function (dk) {
          var sun = new Date(dk.y, dk.m, dk.d + 6);
          return dk.d + "–" + sun.getDate();
        });
      }

      function weekSpanLabel(keys) {
        if (!keys.length) return "";
        var a = keys[0], b = keys[keys.length - 1];
        var sun = new Date(b.y, b.m, b.d + 6);
        if (a.m === sun.getMonth() && a.y === sun.getFullYear()) return a.d + "–" + sun.getDate();
        return a.d + " " + MON[a.m] + "–" + sun.getDate() + " " + MON[sun.getMonth()];
      }

      function monthLabels(keys) {
        var years = {};
        keys.forEach(function (dk) { years[dk.y] = 1; });
        var multi = Object.keys(years).length > 1;
        return keys.map(function (dk) {
          return multi ? MON[dk.m] + " " + String(dk.y).slice(2) : MON[dk.m];
        });
      }

      function hourLabels(n) {
        var out = [], i;
        for (i = 0; i < n; i++) out.push((i % 2 === 0 || i === n - 1) ? String(i).padStart(2, "0") : "");
        return out;
      }

      function hourLabelsFromKeys(keys) {
        return keys.map(function (hk, i) {
          return (i % 2 === 0) ? String(hk.h).padStart(2, "0") : "";
        });
      }

      function align(arr, len) {
        var a = arr.slice();
        while (a.length < len) a.push(0);
        return a.slice(0, len);
      }

      /* per board: an hour no meter reported is null (a gap), never 0 kWh */
      function todayHourlyGaps(flat) {
        var now = nowParts();
        var n = Math.min(24, Math.max(1, now.h + 1));
        var hours = [], i;
        for (i = 0; i < n; i++) hours[i] = null;
        (flat || []).forEach(function (pt) {
          if (pt.y === now.y && pt.m === now.m && pt.d === now.d && pt.h >= 0 && pt.h < n) hours[pt.h] = Math.trunc(pt.val * 100) / 100;
        });
        return hours;
      }
      function byHourGaps(flat, keys) {
        var map = {};
        (flat || []).forEach(function (pt) { map[pt.y + "-" + (pt.m + 1) + "-" + pt.d + "-" + pt.h] = pt.val; });
        return keys.map(function (hk) { var v = map[hk.k]; return v == null ? null : Math.trunc(v * 100) / 100; });
      }

      var boardList = mappedBoards(p);
      /* Demo figures (or the standalone prototype) with no board mapped: the sample boards stay */
      var ZONE_FIELDS = ["zones", "zonesAr", "zoneHues", "zoneHourly", "zoneLast24", "zoneWeekly", "zoneMonthly",
        "zoneWTD", "zoneMTD", "zoneYesterday", "zonePrevWeek", "zonePrevMonth", "pmuFlats"];
      var sampleBoards = null;
      if (site.power && !realMode && !boardList.length) {
        sampleBoards = {};
        ZONE_FIELDS.forEach(function (k) { if (k in site.power) sampleBoards[k] = site.power[k]; });
      }
      if (site.power) {
        var flats = boardList.map(function (b) { return flattenHist(p.power_history[b.his]); });
        site.power.pmuFlats = {};
        if (boardMeterLinks) {
          boardList.forEach(function (b, i) { if (b.pmu) site.power.pmuFlats[meterKey(b.pmu)] = flats[i]; });
        }
        var peakFlat = flattenHist(p.power_history.Peak_Demand_his);
        var allFlats = flats.concat([peakFlat]);
        site.power.zones = boardList.map(function (b) { return b.name; });
        site.power.zonesAr = site.power.zones.slice();
        site.power.zoneHues = boardList.map(function (b) { return b.hue; });
        var todayZ = flats.map(todayHourlyGaps);
        var todayLen = todayZ[0] ? todayZ[0].length : todayHourlyGaps([]).length;
        site.power.zoneHourly = todayZ;
        changed = true;
        var hourKeys = lastNHours(allFlats, 1);
        site.power.zoneLast24 = flats.map(function (f) { return byHourGaps(f, hourKeys); });
        site.power.peakLast24 = byHour(peakFlat, hourKeys);
        /* The viewer timeline: the site's load per clock hour over the last
           25 hours, oldest first, as the hourly average in kW. The zone meters
           report the energy used in each hour, and a kWh used over one hour is
           a 1 kW average, so their sum is the site's hourly-average load. Each
           hour keeps its real start (start + i × stepMs); an hour no meter has
           reported (the current one, usually) is null: a gap, never a dip to
           zero. AED/h and kg CO2/h derive from it at render. */
        var tlKeys = lastNHours(allFlats, 25);
        var tlSeen = {};
        flats.forEach(function (f) { f.forEach(function (pt) { tlSeen[pt.y + "-" + (pt.m + 1) + "-" + pt.d + "-" + pt.h] = 1; }); });
        var tlZones = flats.map(function (f) { return byHour(f, tlKeys); });
        var tlNow = Date.now();
        site.timeline24 = {
          /* the site clock (Dubai) is a whole-hour offset from UTC, so its
             hours start where UTC hours do */
          start: Math.floor(tlNow / 36e5) * 36e5 - (tlKeys.length - 1) * 36e5,
          stepMs: 36e5,
          asOf: tlNow,
          kw: tlKeys.map(function (hk, i) {
            if (!tlSeen[hk.k]) return null;
            var sum = 0;
            tlZones.forEach(function (z) { sum += z[i] || 0; });
            return Math.trunc(sum * 100) / 100;
          })
        };
        /* Today's peak demand for the timeline: the highest Peak_Demand_his
           value today (kW) and the clock hour it fell in. The curve is hourly,
           so the hour is as precise as the strip needs. */
        var tlToday = nowParts(), tlPk = null;
        peakFlat.forEach(function (pt) {
          if (pt.y !== tlToday.y || pt.m !== tlToday.m || pt.d !== tlToday.d) return;
          if (!tlPk || pt.val > tlPk.val) tlPk = pt;
        });
        site.timeline24.peak = tlPk
          ? { v: Math.trunc(tlPk.val * 100) / 100, t: Math.floor(tlNow / 36e5) * 36e5 - (tlToday.h - tlPk.h) * 36e5 }
          : null;
        var weekKeys = lastNWeeks(allFlats, 6);
        var monthKeys = lastNMonths(allFlats, 6);
        site.power.zoneWeekly = flats.map(function (f) { return bucket(f, pointWeekKey, weekKeys, "sum"); });
        site.power.peakWeekly = bucket(peakFlat, pointWeekKey, weekKeys, "max");
        site.power.weekRange = weekSpanLabel(weekKeys);
        if (monthKeys.length) {
          site.power.zoneMonthly = flats.map(function (f) { return bucket(f, pointMonthKey, monthKeys, "sum"); });
          site.power.peakMonthly = bucket(peakFlat, pointMonthKey, monthKeys, "max");
          changed = true;
        }
        var now = nowParts();
        var weekStart = mondayOf(now);
        function sumIf(flat, test) {
          var sum = 0, n = 0;
          (flat || []).forEach(function (pt) {
            if (test(pt)) { sum += pt.val; n++; }
          });
          return n ? Math.trunc(sum * 100) / 100 : null;
        }
        site.power.zoneWTD = flats.map(function (flat) {
          return sumIf(flat, function (pt) {
            var dt = new Date(pt.y, pt.m, pt.d);
            return dt.getTime() >= weekStart.getTime() && (pt.y < now.y || (pt.y === now.y && (pt.m < now.m || (pt.m === now.m && pt.d <= now.d))));
          });
        });
        site.power.zoneMTD = flats.map(function (flat) {
          return sumIf(flat, function (pt) { return pt.y === now.y && pt.m === now.m; });
        });
        var yest = new Date(now.y, now.m, now.d - 1);
        site.power.zoneYesterday = flats.map(function (flat) {
          return sumIf(flat, function (pt) {
            return pt.y === yest.getFullYear() && pt.m === yest.getMonth() && pt.d === yest.getDate();
          });
        });
        var prevMon = new Date(weekStart.getTime() - 7 * 864e5);
        var prevSun = new Date(weekStart.getTime() - 864e5);
        site.power.zonePrevWeek = flats.map(function (flat) {
          return sumIf(flat, function (pt) {
            var dt = new Date(pt.y, pt.m, pt.d);
            return dt.getTime() >= prevMon.getTime() && dt.getTime() <= prevSun.getTime();
          });
        });
        var pm = now.m - 1, py = now.y;
        if (pm < 0) { pm = 11; py -= 1; }
        site.power.zonePrevMonth = flats.map(function (flat) {
          return sumIf(flat, function (pt) { return pt.y === py && pt.m === pm; });
        });
        changed = true;
        var peakToday = todayHourly(peakFlat);
        site.power.peakSeries = align(peakToday, todayLen);
        if (peakToday.length) {
          var pkSum = 0;
          peakToday.forEach(function (v) { pkSum += v; });
          site.power.peakAvgKw = Math.trunc((pkSum / peakToday.length) * 10) / 10;
        }
        var nH = todayLen;
        var hourLab = hourKeys.length
          ? String(hourKeys[hourKeys.length - 1].h).padStart(2, "0") + ":00"
          : "";
        site.power.trendX = {
          hourly: hourLab ? [hourLab] : [],
          today: hourLabels(nH),
          weekly: weekBarLabels(weekKeys),
          monthly: monthLabels(monthKeys)
        };
        if (sampleBoards) Object.assign(site.power, sampleBoards);
        if (site.water) {
          site.water.todayM3 = null;
          site.water.avgDrawM3Day = null;
          site.water.sparkToday = [];
          site.water.hourly = [];
          site.water.todayH = [];
          site.water.weekly = [];
          site.water.monthly = [];
          var wRaw = flattenHist(p.power_history.Total_Water_Consumption_his);
          var wFlat = [];
          var wi;
          for (wi = 1; wi < wRaw.length; wi++) {
            var dlt = wRaw[wi].val - wRaw[wi - 1].val;
            if (!isFinite(dlt) || dlt < 0) dlt = 0;
            wFlat.push({ y: wRaw[wi].y, m: wRaw[wi].m, d: wRaw[wi].d, h: wRaw[wi].h, val: dlt });
          }
          if (wFlat.length) {
            var wToday = todayHourly(wFlat);
            var wHourK = lastNHours([wFlat], 1);
            var wWeekK = lastNWeeks([wFlat], 6);
            var wMonthK = lastNMonths([wFlat], 6);
            site.water.hourly = byHour(wFlat, wHourK);
            site.water.todayH = wToday;
            site.water.weekly = bucket(wFlat, pointWeekKey, wWeekK, "sum");
            site.water.monthly = bucket(wFlat, pointMonthKey, wMonthK, "sum");
            site.water.trendX = {
              hourly: wHourK.length ? [String(wHourK[wHourK.length - 1].h).padStart(2, "0") + ":00"] : [],
              today: hourLabels(wToday.length),
              weekly: weekBarLabels(wWeekK),
              monthly: monthLabels(wMonthK)
            };
            site.water.weekRange = weekSpanLabel(wWeekK);
            var wtSum = 0, wtN = 0;
            for (wi = 0; wi < wToday.length; wi++) {
              if (wToday[wi]) { wtSum += wToday[wi]; wtN++; }
            }
            if (wtN) {
              site.water.todayM3 = trunc1(wtSum);
              set(m, "waterTodayM3", site.water.todayM3);
            }
            var dayKeys7 = [], di, ddt;
            for (di = 6; di >= 0; di--) {
              ddt = new Date(now.y, now.m, now.d - di);
              dayKeys7.push({
                k: ddt.getFullYear() + "-" + (ddt.getMonth() + 1) + "-" + ddt.getDate(),
                y: ddt.getFullYear(), m: ddt.getMonth(), d: ddt.getDate()
              });
            }
            var last7 = bucket(wFlat, function (pt) { return pt.y + "-" + (pt.m + 1) + "-" + pt.d; }, dayKeys7, "sum");
            var a7 = 0, n7 = 0;
            last7.forEach(function (v) { if (v) { a7 += v; n7++; } });
            if (n7) site.water.avgDrawM3Day = trunc1(a7 / n7);
            if (wToday.length > 1) site.water.sparkToday = wToday;
            else if (n7) site.water.sparkToday = last7;
            changed = true;
          }
        }
      }

      // ---- GAS page wiring ------------------------------------------------
      if (site.gas) {
        if (asNum(p.total_gas) != null) {   // a non-numeric reading must not erase the last valid one
          site.gas.todayM3 = trunc1(asNum(p.total_gas));
          changed = true;
        }
        if (p.power_history && p.power_history.Total_Gas_Consumption_his) {
          // Gas meters report cumulative m³ — derive consumption via delta
          var gRaw = flattenHist(p.power_history.Total_Gas_Consumption_his);
          var gFlat = [];
          var gi;
          for (gi = 1; gi < gRaw.length; gi++) {
            var gdlt = gRaw[gi].val - gRaw[gi - 1].val;
            if (!isFinite(gdlt) || gdlt < 0) gdlt = 0;
            gFlat.push({ y: gRaw[gi].y, m: gRaw[gi].m, d: gRaw[gi].d, h: gRaw[gi].h, val: gdlt });
          }
          if (gFlat.length) {
            var gNow    = nowParts();
            var gToday  = todayHourly(gFlat);
            var gHourK  = lastNHours([gFlat], 1);
            var gWeekK  = lastNWeeks([gFlat], 6);
            var gMonthK = lastNMonths([gFlat], 6);

            site.gas.hourly  = byHour(gFlat, gHourK);
            site.gas.todayH  = gToday;
            site.gas.weekly  = bucket(gFlat, pointWeekKey, gWeekK, "sum");
            site.gas.monthly = bucket(gFlat, pointMonthKey, gMonthK, "sum");
            site.gas.trendX  = {
              hourly:  gHourK.length ? [String(gHourK[gHourK.length - 1].h).padStart(2, "0") + ":00"] : [],
              today:   hourLabels(gToday.length),
              weekly:  weekBarLabels(gWeekK),
              monthly: monthLabels(gMonthK)
            };
            site.gas.weekRange = weekSpanLabel(gWeekK);

            // Today total (sum of hourly deltas) overrides the scalar if history exists
            var gtSum = 0, gtN = 0;
            for (gi = 0; gi < gToday.length; gi++) {
              if (gToday[gi]) { gtSum += gToday[gi]; gtN++; }
            }
            if (gtN) {
              site.gas.todayM3 = trunc1(gtSum);
              set(m, "gasTodayM3", site.gas.todayM3);
            }

            // 7-day average
            var gDay7 = [], gdi, gddt;
            for (gdi = 6; gdi >= 0; gdi--) {
              gddt = new Date(gNow.y, gNow.m, gNow.d - gdi);
              gDay7.push({ k: gddt.getFullYear() + "-" + (gddt.getMonth() + 1) + "-" + gddt.getDate(),
                           y: gddt.getFullYear(), m: gddt.getMonth(), d: gddt.getDate() });
            }
            var gLast7 = bucket(gFlat, function(pt){ return pt.y + "-" + (pt.m + 1) + "-" + pt.d; }, gDay7, "sum");
            var ga7 = 0, gn7 = 0;
            gLast7.forEach(function(v){ if (v) { ga7 += v; gn7++; } });
            if (gn7) site.gas.avg7M3 = trunc1(ga7 / gn7);

            // Month-to-date
            var gmtdSum = 0;
            gFlat.forEach(function(pt){
              if (pt.y === gNow.y && pt.m === gNow.m) gmtdSum += pt.val;
            });
            if (gmtdSum > 0) site.gas.mtdM3 = trunc1(gmtdSum);

            // daily14 — last 14 days for the bar chart (replaces mock array)
            var g14 = [], g14i, g14dt;
            for (g14i = 13; g14i >= 0; g14i--) {
              g14dt = new Date(gNow.y, gNow.m, gNow.d - g14i);
              g14.push({ k: g14dt.getFullYear() + "-" + (g14dt.getMonth() + 1) + "-" + g14dt.getDate(),
                         y: g14dt.getFullYear(), m: g14dt.getMonth(), d: g14dt.getDate() });
            }
            var gDaily14 = bucket(gFlat, function(pt){ return pt.y + "-" + (pt.m + 1) + "-" + pt.d; }, g14, "sum");
            if (gDaily14.some(function(v){ return v > 0; })) {
              site.gas.daily14          = gDaily14.map(function(v){ return v || 0; });
              site.gas.daily14StartDay  = g14[0].d;
            }

            changed = true;
          }
        }
      }
    }
    if (site.power) {
      var list = mappedBoards(p);
      if (list.length || realMode) {
        /* the board's live key; else its latest reported hour; else null (shown --), never 0 */
        var latest = function (series, name) {
          var i = (site.power.zones || []).indexOf(name);
          var s = i >= 0 && series ? series[i] : null;
          var v = s && s.length ? s[s.length - 1] : null;
          return v == null ? null : v;
        };
        var boards = list.map(function (b) {
          var kw = asNum(p[b.live]);
          if (kw == null) kw = latest(site.power.zoneLast24, b.name);
          if (kw == null) kw = latest(site.power.zoneHourly, b.name);
          return [b.name, kw];
        });
        var prev = site.power.boards;
        var same = prev && prev.length === boards.length && boards.every(function (b, i) {
          return prev[i] && prev[i][0] === b[0] && prev[i][1] === b[1];
        });
        if (!same) {
          site.power.boards = boards;
          site.power.zones = list.map(function (b) { return b.name; });
          site.power.zonesAr = site.power.zones.slice();
          site.power.zoneHues = list.map(function (b) { return b.hue; });
          changed = true;
        }
      }
      // a board's meter: the project's configured link, else Marsa Al Arab's own (PMU09 = MCC 1, ...)
      if (boardMeterLinks) {
        list.forEach(function (b, i) {
          if (!b.pmu) return;
          var kwh = asNum(p[b.live]);
          if (kwh == null && site.power.boards && site.power.boards[i]) kwh = asNum(site.power.boards[i][1]);
          if (kwh != null) lastBoardKwh[meterKey(b.pmu)] = kwh;
        });
      }
      if (Array.isArray(site.power.pmus)) {
        site.power.pmus.forEach(function (row) {
          if (row && lastBoardKwh[row.id] != null) {
            var next = trunc1(lastBoardKwh[row.id]);
            if (row.kwh !== next) { row.kwh = next; changed = true; }
          }
        });
      }
    }
    if (m.energyTodayKwh == null && site.power && Array.isArray(site.power.zoneHourly) && site.power.zoneHourly.length) {
      var zhSum = 0, zhN = 0, zhH, zhR;
      var zhLen = site.power.zoneHourly[0] ? site.power.zoneHourly[0].length : 0;
      var zhHours = [];
      for (zhH = 0; zhH < zhLen; zhH++) {
        var hourSum = 0, hourAny = false;
        for (zhR = 0; zhR < site.power.zoneHourly.length; zhR++) {
          var zv = site.power.zoneHourly[zhR] && site.power.zoneHourly[zhR][zhH];
          if (zv != null && isFinite(zv)) { hourSum += zv; hourAny = true; }
        }
        zhHours.push(hourAny ? hourSum : null);
        if (hourAny && hourSum > 0) { zhSum += hourSum; zhN++; }
      }
      if (zhN && zhSum > 0) {
        set(m, "energyTodayKwh", trunc1(zhSum));
        set(m, "energyTodayMwh", zhSum / 1000);
        if (site.power.bva && site.power.bva.ranges) {
          var zhLabs = [], zhi;
          for (zhi = 0; zhi < zhHours.length; zhi++) zhLabs.push(String(zhi).padStart(2, "0"));
          var cur = site.power.bva.ranges.today;
          var hasAct = cur && Array.isArray(cur.actual) && cur.actual.some(function (v) { return v; });
          if (!hasAct) {
            site.power.bva.ranges.today = {
              unit: "kWh",
              labels: zhLabs,
              actual: zhHours.map(function (v) { return v == null ? 0 : v; }),
              baseline: (cur && cur.baseline) || zhHours.map(function () { return null; })
            };
          }
        }
      }
    }
    if (site.power && site.power.subview) {
      var sv = site.power.subview;
      sv.peakKw = m.peakTodayKw != null ? m.peakTodayKw : null;
      changed = true;
      var limitKw = m.contractedKw != null ? m.contractedKw : (site.power.contractedMw != null ? site.power.contractedMw * 1000 : null);
      if (limitKw) {
        sv.limitKw = limitKw;
        changed = true;
      }
      if (el && el.currentKw != null) sv.loadNowKw = el.currentKw;
    }
    countUtilityAndEmsMeters(site, site.assets);
    if (changed) paint();
  }

  function paint() {
    var E = window.EKO;
    if (E && typeof E.set === 'function') E.set({});
  }

  function norm(s) {
    return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  function namesMatch(a, b) {
    if (!a || !b) return false;
    var x = norm(a), y = norm(b);
    return x === y || (x.length >= 3 && y.indexOf(x) !== -1) || (y.length >= 3 && x.indexOf(y) !== -1);
  }

  var PMU_CANON = [
    { id: "PMU09", db: "MCC 1" },
    { id: "PMU04", db: "MCC 2" },
    { id: "PMU05", db: "Kitchen SMDB" },
    { id: "PMU06", db: "LVFP" },
    { id: "PMU07", db: "ATS" },
    { id: "PMU08", db: "Sump pump" }
  ];

  function pmuKey(s) {
    var m = String(s || "").toUpperCase().match(/PMU\d+/);
    return m ? m[0] : "";
  }
  /* How a meter is keyed: Marsa Al Arab's by PMU number (its names carry more), any other site's by name */
  function meterKey(name) {
    return (fixtureSite && pmuKey(name)) || String(name || "");
  }

  function applyMeters(meters) {
    var site = window.EKO_DATA && window.EKO_DATA.marsa;
    if (!site || !meters || !site.power) return;
    /* /pmu-live lists the meters the project's own meter profile matched (its prefix and point
       aliases), so every one is shown. Marsa Al Arab's are keyed by PMU number, which its board
       names and history follow; another site's meter keeps its own name. */
    var byKey = {};
    Object.keys(meters).forEach(function (name) {
      var k = meterKey(name);
      byKey[k] = { name: name, row: meters[name] || {} };
    });
    if (fixtureSite) {
      (site.assets || []).forEach(function (a) {
        var k = pmuKey(a.id);
        if (k && !byKey[k]) byKey[k] = { name: a.id, row: {} };
      });
    }
    function rowOf(meta, live) {
      var r = live && live.row;
      var db = meta.db;
      if (!db && live && live.name) db = live.name.replace(/^PMU\d+[_\- ]*/i, "").replace(/_/g, " ").trim();
      return {
        id: meta.id,
        db: db || meta.id,
        kw: r ? asNum(r.active_power) : null,
        a: r ? asNum(r.current) : null,
        hz: r ? asNum(r.frequency) : null,
        kwh: lastBoardKwh[meta.id] != null ? lastBoardKwh[meta.id] : (r ? asNum(r.total_energy) : null),
        v: r ? asNum(r.voltage) : null,
        pf: null
      };
    }
    /* each meter's board name: the project's configured boards, else Marsa Al Arab's own */
    var canonDb = {};
    if (CONFIGURED_BOARDS) CONFIGURED_BOARDS.forEach(function (b) { if (b.pmu) canonDb[meterKey(b.pmu)] = b.name; });
    else if (fixtureSite) PMU_CANON.forEach(function (m) { canonDb[m.id] = m.db; });
    var ids = Object.keys(byKey);
    ids.sort(function (a, b) {
      return (parseInt(a.replace(/\D/g, ""), 10) || 0) - (parseInt(b.replace(/\D/g, ""), 10) || 0) || (a < b ? -1 : a > b ? 1 : 0);
    });
    // no meter reported: the known meters are listed (readings "--"); a site that knows none lists none
    if (!ids.length) ids = Object.keys(canonDb);
    site.power.pmus = ids.map(function (id) {
      return rowOf({ id: id, db: canonDb[id] }, byKey[id]);
    });
    paint();
  }


  var historyCache = {};
  var HIST_DAYS = 31;
  var HIST_MONTHS = { january:0, february:1, march:2, april:3, may:4, june:5, july:6, august:7, september:8, october:9, november:10, december:11 };
  function foldPtName(n) {
    return String(n || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  }
  function ptNumVal(p) {
    if (!p) return null;
    var m = String(p.currentValue == null ? "" : p.currentValue).replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
    if (!m) return null;
    var n = parseFloat(m[0]);
    return isFinite(n) ? n : null;
  }
  function isSpName(k) {
    return k.indexOf("set") !== -1 || /sp$/.test(k);
  }
  function findPt(points, test) {
    for (var i = 0; i < (points || []).length; i++) {
      if (test(foldPtName(points[i].navName), points[i])) return points[i];
    }
    return null;
  }
  function makePair(points, key, actTest, spTest) {
    var a = findPt(points, actTest);
    var s = findPt(points, spTest);
    var av = ptNumVal(a);
    var sv = ptNumVal(s);
    if (av == null && sv == null) return null;
    return {
      key: key,
      actual: av,
      sp: sv,
      unit: (a && a.unit) || (s && s.unit) || "",
      actId: a && a.id,
      spId: s && s.id,
      actName: a && a.navName,
      spName: s && s.navName,
      actHis: !!(a && a.his && a.id),
      spHis: !!(s && s.his && s.id)
    };
  }
  function comparePairs(eq) {
    var points = eq.points || [];
    var id = String(eq.name || "").toUpperCase();
    var type = String(eq.type || "").toUpperCase();
    var kind = "gen";
    if (id.indexOf("FAHU") === 0 || type.indexOf("FAHU") !== -1) kind = "fahu";
    else if (id.indexOf("AHU") === 0 || type.indexOf("AHU") !== -1) kind = "ahu";
    else if (id.indexOf("FCU") === 0 || type.indexOf("FCU") !== -1) kind = "fcu";
    var specs = [];
    if (kind === "fcu") {
      specs = [
        makePair(points, "apCmpZone", function (k) { return k.indexOf("zonetemp") !== -1 && !isSpName(k); }, function (k) { return k.indexOf("zonetemp") !== -1 && isSpName(k); })
      ];
    } else if (kind === "ahu") {
      specs = [
        makePair(points, "apCmpRA", function (k) { return k.indexOf("ratemp") !== -1 && !isSpName(k); }, function (k) { return k.indexOf("ratemp") !== -1 && isSpName(k); }),
        makePair(points, "apCmpSA", function (k) { return k.indexOf("satemp") !== -1 && !isSpName(k); }, function (k) { return k.indexOf("satemp") !== -1 && isSpName(k); }),
        makePair(points, "apCmpRAHum", function (k) { return k.indexOf("rahum") !== -1 && !isSpName(k); }, function (k) { return k.indexOf("rahum") !== -1 && isSpName(k); }),
        makePair(points, "apCmpRACO2", function (k) { return (k.indexOf("raco2") !== -1 || k === "raco2" || (k.indexOf("co2") !== -1 && k.indexOf("ra") !== -1)) && !isSpName(k); }, function (k) { return k.indexOf("co2") !== -1 && isSpName(k); })
      ];
    } else if (kind === "fahu") {
      specs = [
        makePair(points, "apCmpFA", function (k) { return k.indexOf("fatemp") !== -1 && !isSpName(k); }, function (k) { return k.indexOf("fatemp") !== -1 && isSpName(k); }),
        makePair(points, "apCmpRA", function (k) { return k.indexOf("ratemp") !== -1 && k.indexOf("sensible") === -1 && !isSpName(k); }, function (k) { return k.indexOf("ratemp") !== -1 && k.indexOf("sensible") === -1 && isSpName(k); }),
        makePair(points, "apCmpSA", function (k) { return k.indexOf("satemp") !== -1 && !isSpName(k); }, function (k) { return k.indexOf("satemp") !== -1 && isSpName(k); }),
        makePair(points, "apCmpOffCoil", function (k) { return (k.indexOf("offcoil") !== -1 || (k.indexOf("off") !== -1 && k.indexOf("temp") !== -1 && k.indexOf("hum") === -1 && k.indexOf("sensible") === -1)) && !isSpName(k); }, function (k) { return (k.indexOf("offcoil") !== -1 || k.indexOf("offtemp") !== -1) && isSpName(k); })
      ];
    } else {
      specs = [
        makePair(points, "apCmpTemp", function (k) { return k.indexOf("temp") !== -1 && !isSpName(k); }, function (k) { return k.indexOf("temp") !== -1 && isSpName(k); })
      ];
    }
    return specs.filter(Boolean);
  }
  function histDaily(hist) {
    var rows = [];
    if (!hist) return rows;
    Object.keys(hist).forEach(function (year) {
      Object.keys(hist[year] || {}).forEach(function (month) {
        Object.keys(hist[year][month] || {}).forEach(function (day) {
          var hData = hist[year][month][day];
          var sum = 0, count = 0, hours = [];
          for (var h = 0; h < 24; h++) hours.push(null);
          Object.keys(hData || {}).forEach(function (hr) {
            var n = parseFloat(hData[hr]);
            if (!isFinite(n)) return;
            sum += n; count++;
            var at = HOUR_AT[String(hr).toLowerCase()];
            if (at != null) hours[at] = n;
          });
          if (!count) return;
          var mi = HIST_MONTHS[String(month).toLowerCase()];
          var dnum = parseInt(String(day).replace(/\D/g, ""), 10);
          rows.push({
            t: Date.UTC(+year, mi == null ? 0 : mi, dnum || 1),
            avg: Math.trunc((sum / count) * 100) / 100,
            label: String(dnum || day),
            hours: hours
          });
        });
      });
    });
    rows.sort(function (a, b) { return a.t - b.t; });
    return rows;
  }
  function applyEquipment(payload) {
    var site = window.EKO_DATA && window.EKO_DATA.marsa;
    var list = payload && payload.equipment;
    if (!site || !Array.isArray(list)) return;
    if (Object.prototype.hasOwnProperty.call(payload, 'workOrderError')) {
      site.workOrderError = payload.workOrderError || '';
      site.workOrderState = payload.workOrderState || '';
    }

    // Build fresh asset list from FIN live data
    var newAssets = list.map(function (eq) {
      var crit = "C";
      if (/chiller|pump|mcc|smdb|facp/i.test(eq.type)) crit = "A";
      else if (/ahu|fahu|mahu|lift/i.test(eq.type)) crit = "B";

      var sys = sysFromFin(eq);

      var wtyStart = null;
      var wtyEnd = null;
      var params = [];
      var analog = [];
      var alarmPts = [];
      var fddGroups = {};
      var fddOrder = [];
      (eq.points || []).forEach(function (p) {
        if (!p || !p.reporting) return;
        var folded = String(p.navName || "").toLowerCase().replace(/[^a-z0-9]/g, "");
        if (folded.indexOf("warrant") !== -1) {
          if (folded.indexOf("start") !== -1) { wtyStart = p.currentValue; return; }
          if (folded.indexOf("end") !== -1) { wtyEnd = p.currentValue; return; }
        }
        var raw = String(p.currentValue == null ? "" : p.currentValue).trim();
        if (!raw || raw === "—" || raw === "--") return;
        var rawU = raw.toUpperCase();
        var isFdd = folded.indexOf("fdd") === 0 || folded.indexOf("rule") === 0;
        var isAlarmPt = p.alarmPoint === true;
        var isFlag = p.kind === "Bool" || typeof p.bool === "boolean" || rawU === "T" || rawU === "F" || rawU === "TRUE" || rawU === "FALSE";
        // FIN's enum word (NORMAL, FAULT…), not On/Off
        var row = [p.navName, "", p.text || p.currentValue];
        if (isFdd) {
          // Shown while in fault; a message also beside its faulted flag
          var g = fddGroup(p.navName);
          if (!fddGroups[g]) { fddGroups[g] = { rows: [], flagOn: false }; fddOrder.push(g); }
          var active = readingInAlarm(row[2], isFlag);
          fddGroups[g].rows.push({ row: row, isFlag: isFlag, active: active });
          if (isFlag && active) fddGroups[g].flagOn = true;
        } else if (isAlarmPt) {
          // FD&D rules also carry alarmPoint, so they are checked first
          if (readingInAlarm(row[2], isFlag)) alarmPts.push(row);
        } else {
          // The backend's point_control decision: the asset panel marks the row editable
          if (p.control) row[4] = p;
          analog.push(row);
        }
      });
      fddOrder.forEach(function (g) {
        var fam = fddGroups[g];
        fam.rows.forEach(function (r) {
          if (r.active || (!r.isFlag && fam.flagOn && !looksHealthy(r.row[2]))) params.push(r.row);
        });
      });

      var alarmIds = (site.alarms || []).filter(function(a) { return namesMatch(a.asset, eq.name) || namesMatch(a.asset, eq.bimId); }).map(function(a) { return a.id; });
      var assetData = {
        id: eq.name,
        bimId: eq.bimId,
        sys: sys,
        crit: crit,
        wtyStart: wtyStart,
        wtyEnd: wtyEnd,
        tags: eq.tags || [],
        st: (alarmIds.length || eq.inAlarm) ? "alarm" : "ok",
        inAlarm: !!eq.inAlarm,
        alarms: alarmIds,
        floor: eq.floor || "Unknown",
        zone: "General",
        zoneAr: "عام",
        typeEn: (eq.type || "equipment").toUpperCase(),
        typeAr: (eq.type || "معدات").toUpperCase(),
        level: eq.floor || "Level",
        levelAr: eq.floor || "الطابق",
        equipId: normEquipId(eq.equipId),
        workOrders: Array.isArray(eq.workOrders) ? eq.workOrders : [],
        wos: 0,
        wost: null,
        make: "--",
        serial: "--",
        svc: "--",
        cafm: "--",
        trend7: null,
        compare: null,
        params: params,
        analog: analog,
        alarmPts: alarmPts,
        points: eq.points || [],
        activity: [],
        spark7: null   // set from FIN history below
      };

      var pairs = comparePairs(eq);
      var cached = historyCache[eq.name];
      assetData.compare = {
        pairs: pairs,
        days: (cached && cached.compareV === 2 && cached.compare && cached.compare.days) || [],
        hist: (cached && cached.compareV === 2 && cached.compare && cached.compare.hist) || [],
        unit: (cached && cached.compare && cached.compare.unit) || ((pairs[0] && pairs[0].unit) || ""),
        actName: (cached && cached.compare && cached.compare.actName) || (pairs[0] && pairs[0].actName) || "",
        spName: (cached && cached.compare && cached.compare.spName) || (pairs[0] && pairs[0].spName) || ""
      };
      if (cached && cached.trend7) {
        assetData.trend7 = cached.trend7;
        assetData.spark7 = cached.spark7;
      }

      var primary = pairs.filter(function (p) { return p.actHis; })[0] || pairs[0];
      if (primary && primary.actId && window.DashboardData && window.DashboardData.getPointHistory && !(cached && (cached.compareV === 2 || cached.fetching))) {
        historyCache[eq.name] = { fetching: true };
        var actP = window.DashboardData.getPointHistory(primary.actId, HIST_DAYS);
        var spP = (primary.spHis && primary.spId)
          ? window.DashboardData.getPointHistory(primary.spId, HIST_DAYS)
          : Promise.resolve(null);
        Promise.all([actP, spP]).then(function (both) {
          if (!current()) return;
          var actAll = histDaily(both[0] && both[0].history);
          var spAll = histDaily(both[1] && both[1].history);
          var actDays = actAll.slice(-7);
          var spByT = {};
          spAll.forEach(function (d) { spByT[d.t] = d; });
          var days = actDays.map(function (d) {
            return { label: d.label, actual: d.avg, sp: spByT[d.t] ? spByT[d.t].avg : undefined };
          });
          var hist = actAll.map(function (d) {
            var sp = spByT[d.t];
            return { t: d.t, a: d.hours, b: sp ? sp.hours : null, aAvg: d.avg, bAvg: sp ? sp.avg : null };
          });
          var vals = actDays.map(function (d) { return d.avg; });
          var spark7 = assetData.spark7;
          if (vals.length) {
            var mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals), range = mx - mn || 1;
            spark7 = vals.map(function (v) { return (v - mn) / range; });
          }
          var packed = {
            compareV: 2,
            compare: {
              days: days,
              hist: hist,
              unit: (both[0] && both[0].unit) || primary.unit || "",
              actName: primary.actName || "",
              spName: primary.spName || ""
            },
            trend7: vals.length ? { point: primary.actName, unit: (both[0] && both[0].unit) || primary.unit || "", vals: vals } : null,
            spark7: spark7
          };
          historyCache[eq.name] = packed;
          var live = window.EKO_DATA && window.EKO_DATA.marsa;
          if (live && Array.isArray(live.assets)) {
            live.assets.forEach(function (a) {
              if (a.id !== eq.name) return;
              a.compare = {
                pairs: (a.compare && a.compare.pairs) || pairs,
                days: packed.compare.days,
                hist: packed.compare.hist,
                unit: packed.compare.unit,
                actName: packed.compare.actName,
                spName: packed.compare.spName
              };
              a.trend7 = packed.trend7;
              a.spark7 = packed.spark7;
            });
          }
          paint();
        }).catch(function () {
          historyCache[eq.name] = { compareV: 2, failed: true, compare: { days: [], hist: [], unit: primary.unit, actName: primary.actName, spName: primary.spName } };
        });
      }

      return assetData;
    });

    site.assets = newAssets;
    site.registerTotal = newAssets.length;

    if (site.landing && site.landing.reg) {
      site.landing.reg.headEn = newAssets.length + " assets";
      site.landing.reg.headAr = newAssets.length + " أصلًا";
    }

    // Link FIN's alarms to their equipment
    newAssets.forEach(function(asset) {
      (site.alarms || []).forEach(function(al) {
        if (namesMatch(al.asset, asset.id) || (asset.bimId && al.bimId === asset.bimId)) {
          al.bimId = al.bimId || asset.bimId;
          al.sys = classifySys(al.locEn || al.asset, asset);
        }
      });
    });
    linkAlarms(site);

    if (site.power) {
      applyMeters((window.DashboardData && window.DashboardData.meters) || {});
    }

    if (window.EKO_HOST_ENGINE && typeof window.EKO_HOST_ENGINE.resolveAllAssetPositions === 'function') {
      window.EKO_HOST_ENGINE.resolveAllAssetPositions();
    } else if (window.EKO_HOST_ENGINE && typeof window.EKO_HOST_ENGINE.applyStatusColors === 'function') {
      window.EKO_HOST_ENGINE.applyStatusColors();
    }

    if (site.systems && site.systems.groups) {
      site.systems.groups.forEach(function (grp) {
        if (!grp.cards || grp.hidden) return;
        var keys = grp.sysKey || [];
        var list = newAssets.filter(function (a) { return keys.indexOf(a.sys) >= 0; });
        var total = list.length;
        var alarmN = list.filter(function (a) { return a.st === 'alarm'; }).length;
        var active = total - alarmN;
        var healthPct = total > 0 ? Math.round((active / total) * 1000) / 10 : null;
        grp.cards.forEach(function (c) {
          if (c.labelEn === 'OVERALL HEALTH' && healthPct != null) {
            c.v = String(healthPct);
            c.capEn = healthPct >= 95 ? 'Healthy' : healthPct >= 80 ? 'Fair' : 'Critical';
            c.capAr = healthPct >= 95 ? 'سليم' : healthPct >= 80 ? 'مقبول' : 'حرج';
            c.tone = healthPct >= 95 ? 'ok' : 'warn';
          }
          if (/EQUIPMENT|METERS/i.test(c.labelEn || '')) {
            if (total > 0) {
              c.v = active + ' / ' + total;
              c.capEn = 'Total: ' + total;
              c.capAr = 'الإجمالي: ' + total;
              c.chipEn = alarmN > 0 ? alarmN + ' inactive' : null;
              c.chipAr = alarmN > 0 ? alarmN + ' غير نشطة' : null;
              c.tone = alarmN > 0 ? 'warn' : 'ok';
            } else {
              c.capEn = 'No equipment connected';
              c.capAr = 'لا توجد معدات متصلة';
              c.tone = 'warn';
            }
          }
        });
      });
    }

    countUtilityAndEmsMeters(site, newAssets);

    applyHeat(list);
    stampWorkOrders();
    paint();
  }

  var woState = { byId: {} };

  function normEquipId(value) {
    if (value == null || value === '') return '';
    if (typeof value === 'number' && isFinite(value)) return String(Math.trunc(value));
    var text = String(value).trim().replace(/^"|"$/g, '');
    if (/^\d+\.0+$/.test(text)) return text.replace(/\.0+$/, '');
    return text;
  }

  function woDueStatus(order) {
    if (!order || !order.dueIso) return 'sched';
    var due = new Date(order.dueIso + 'T00:00:00');
    if (isNaN(due.getTime())) return 'sched';
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    if (due < today) return 'over';
    var limit = new Date(today);
    limit.setDate(limit.getDate() + 30);
    return due <= limit ? 'due' : 'sched';
  }

  function woStatusRank(status) {
    if (status === 'over') return 0;
    if (status === 'due') return 1;
    return 2;
  }

  function stampWorkOrders() {
    var site = window.EKO_DATA && window.EKO_DATA.marsa;
    if (!site || !Array.isArray(site.assets)) return;
    site.assets.forEach(function (asset) {
      var equipId = normEquipId(asset.equipId);
      asset.equipId = equipId;
      var fromIndex = equipId && woState.byId[equipId] ? woState.byId[equipId] : [];
      var embedded = asset.workOrders || [];
      var source = fromIndex.length >= embedded.length ? fromIndex : embedded;
      var list = source.map(function (order) {
        return Object.assign({}, order, { status: woDueStatus(order) });
      });
      list.sort(function (a, b) {
        var rank = woStatusRank(a.status) - woStatusRank(b.status);
        if (rank) return rank;
        return String(a.dueIso || '').localeCompare(String(b.dueIso || ''));
      });
      asset.workOrders = list;
      asset.wos = list.length;
      asset.wost = list.length
        ? (list.some(function (order) { return order.status === 'over'; }) ? 'over'
          : list.some(function (order) { return order.status === 'due'; }) ? 'due' : 'sched')
        : null;
    });
  }

  function applyWorkOrders(payload) {
    woState = { byId: {} };
    var site = window.EKO_DATA && window.EKO_DATA.marsa;
    if (site) {
      site.workOrderError = (payload && payload.error) || '';
      site.workOrderState = (payload && payload.state) || '';
    }
    ((payload && payload.orders) || []).forEach(function (order) {
      var equipId = normEquipId(order.equipment);
      if (!equipId) return;
      if (!woState.byId[equipId]) woState.byId[equipId] = [];
      woState.byId[equipId].push(order);
    });
    stampWorkOrders();
    paint();
  }

  function assetBlob(a) {
    return ((a && a.id) || '') + ' ' + ((a && a.typeEn) || '') + ' ' + ((a && a.tags) || []).join(' ') + ' ' + ((a && a.sys) || '');
  }

  function countUtilityAndEmsMeters(site, assets) {
    assets = assets || (site && site.assets) || [];
    function blob(a) { return assetBlob(a).toLowerCase(); }
    var gasList = assets.filter(function (a) {
      var b = blob(a);
      return /gas[_-]?meter|(?:^|[^a-z])gm[-_]|gas-meter/.test(b) || (a.sys === 'Utilities' && /gas/.test(b) && !/water/.test(b));
    });
    var waterList = assets.filter(function (a) {
      var b = blob(a);
      if (gasList.indexOf(a) >= 0) return false;
      if (a.sys === 'Utilities') return true;
      return /water[_-]?meter|wm[-_]/.test(b);
    });
    if (site && site.utilLanding) {
      var wAlarm = waterList.filter(function (a) { return a.st === 'alarm'; }).length;
      var gAlarm = gasList.filter(function (a) { return a.st === 'alarm'; }).length;
      site.utilLanding.waterMeters = waterList.length;
      site.utilLanding.waterActive = waterList.length - wAlarm;
      site.utilLanding.waterChipEn = wAlarm > 0 ? wAlarm + ' inactive' : null;
      site.utilLanding.waterChipAr = wAlarm > 0 ? wAlarm + ' غير نشطة' : null;
      site.utilLanding.gasMeters = gasList.length;
      site.utilLanding.gasActive = gasList.length - gAlarm;
      site.utilLanding.gasChipEn = gAlarm > 0 ? gAlarm + ' inactive' : null;
      site.utilLanding.gasChipAr = gAlarm > 0 ? gAlarm + ' غير نشطة' : null;
    }
    var emsList = assets.filter(function (a) {
      return a.sys === 'EMS' || /^pmu\d/i.test(a.id || '');
    });
    if (site && site.energyLanding) {
      var emsEl = site.energyLanding;
      var emsAlarm = emsList.filter(function (a) { return a.st === 'alarm'; }).length;
      emsEl.emsTotal = emsList.length;
      emsEl.emsActive = emsList.length - emsAlarm;
      emsEl.emsChipEn = emsAlarm > 0 ? emsAlarm + ' inactive' : null;
      emsEl.emsChipAr = emsAlarm > 0 ? emsAlarm + ' غير نشطة' : null;
      emsEl.emsTone = emsAlarm > 0 ? 'warn' : 'ok';
    }
  }

  function sensorKey(name) {
    var m = String(name || '').toUpperCase().match(/(IAQ|IS)[-_\s]?(\d+)/);
    if (!m || (m[1] === 'IS' && /IAQ/.test(String(name || '').toUpperCase()))) return '';
    return m[1] + String(parseInt(m[2], 10)).padStart(2, '0');
  }

  function sensorKind(name) {
    var key = sensorKey(name);
    if (key.indexOf('IAQ') === 0) return 'iaq';
    if (key.indexOf('IS') === 0) return 'is';
    return '';
  }

  /* IfcSpace GlobalIds from docs/Models/...Spaces_metadata.json.
     IS-01..07 → Space 22..28 one-to-one. IAQ-01..04 → two rooms each. */
  var SPACE_22 = { bimId: '0xfWWQLhfFUfSseiBChrCj', space: 'Space 22' };
  var SPACE_23 = { bimId: '0xfWWQLhfFUfSseiBChrCg', space: 'Space 23' };
  var SPACE_24 = { bimId: '0xfWWQLhfFUfSseiBChrCh', space: 'Space 24' };
  var SPACE_25 = { bimId: '0xfWWQLhfFUfSseiBChrCe', space: 'Space 25' };
  var SPACE_26 = { bimId: '0xfWWQLhfFUfSseiBChrCf', space: 'Space 26' };
  var SPACE_27 = { bimId: '0xfWWQLhfFUfSseiBChr3M', space: 'Space 27' };
  var SPACE_28 = { bimId: '0xfWWQLhfFUfSseiBChr3N', space: 'Space 28' };
  var SPACE_GUID = {
    IS01: [SPACE_22], IS02: [SPACE_23], IS03: [SPACE_24], IS04: [SPACE_25],
    IS05: [SPACE_26], IS06: [SPACE_27], IS07: [SPACE_28],
    IAQ01: [SPACE_22, SPACE_23],
    IAQ02: [SPACE_24, SPACE_25],
    IAQ03: [SPACE_26, SPACE_27],
    IAQ04: [SPACE_28]
  };

  function blankZone(key) {
    var kind = key.indexOf('IAQ') === 0 ? 'iaq' : 'is';
    var name = key.slice(0, kind === 'iaq' ? 3 : 2) + '-' + key.slice(kind === 'iaq' ? 3 : 2);
    var pins = SPACE_GUID[key] || [];
    return {
      nameEn: name, nameAr: name, floor: '', kind: kind,
      tempC: null, rh: null, co2: null, hours: [],
      bimId: pins[0] ? pins[0].bimId : '',
      bimIds: pins.map(function (p) { return p.bimId; }),
      spaceName: pins.map(function (p) { return p.space; }).join(' · ')
    };
  }

  function pointRef(eq, test) {
    var pts = eq.points || [];
    for (var i = 0; i < pts.length; i++) {
      if (!test(String(pts[i].navName || ''))) continue;
      var n = parseFloat(String(pts[i].currentValue == null ? '' : pts[i].currentValue).replace(/[^0-9.\-]/g, ''));
      return { id: pts[i].id || '', value: isFinite(n) ? n : null };
    }
    return { id: '', value: null };
  }

  var heatRange = 'today';
  var heatStep = null;
  var heatHist = {};
  var BANDS = ['12 am', '3 am', '6 am', '9 am', '12 pm', '3 pm', '6 pm', '9 pm'];
  var MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december'];
  var HOUR_AT = {
    '12 am': 0, '1 am': 1, '2 am': 2, '3 am': 3, '4 am': 4, '5 am': 5,
    '6 am': 6, '7 am': 7, '8 am': 8, '9 am': 9, '10 am': 10, '11 am': 11,
    '12 pm': 12, '1 pm': 13, '2 pm': 14, '3 pm': 15, '4 pm': 16, '5 pm': 17,
    '6 pm': 18, '7 pm': 19, '8 pm': 20, '9 pm': 21, '10 pm': 22, '11 pm': 23
  };

  function ymd(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function dailyMap(res) {
    var out = {};
    var hist = res && res.history;
    if (!hist) return out;
    Object.keys(hist).forEach(function (year) {
      Object.keys(hist[year] || {}).forEach(function (monthName) {
        var mi = MONTHS.indexOf(monthName);
        if (mi < 0) return;
        Object.keys(hist[year][monthName] || {}).forEach(function (dayKey) {
          var dm = String(dayKey).match(/(\d+)/);
          if (!dm) return;
          var hours = hist[year][monthName][dayKey] || {};
          var sum = 0, count = 0;
          var slotSum = [0, 0, 0, 0, 0, 0, 0, 0];
          var slotN = [0, 0, 0, 0, 0, 0, 0, 0];
          Object.keys(hours).forEach(function (hr) {
            var n = parseFloat(hours[hr]);
            var at = HOUR_AT[String(hr).toLowerCase()];
            if (!isFinite(n) || at == null) return;
            var band = Math.floor(at / 3);
            slotSum[band] += n;
            slotN[band]++;
            sum += n;
            count++;
          });
          if (!count) return;
          out[ymd(new Date(Number(year), mi, Number(dm[1])))] = {
            v: sum / count,
            slots: slotSum.map(function (s, i) { return slotN[i] ? s / slotN[i] : null; })
          };
        });
      });
    });
    return out;
  }

  function windowed(id, live, range) {
    var pack = id && heatHist[id];
    var days = pack && pack.days;
    if (!days) return live;
    var now = new Date();
    var start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (range === 'week') start.setDate(start.getDate() - 6);
    if (range === 'month') start.setDate(start.getDate() - 29);
    var from = ymd(start), to = ymd(now);
    var keys = Object.keys(days).filter(function (k) { return k >= from && k <= to && days[k] && isFinite(days[k].v); });
    if (!keys.length) return range === 'today' ? live : null;
    return keys.reduce(function (n, k) { return n + days[k].v; }, 0) / keys.length;
  }

  function rangeKeys(days, range) {
    var now = new Date();
    var start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (range === 'week') start.setDate(start.getDate() - 6);
    if (range === 'month') start.setDate(start.getDate() - 29);
    var from = ymd(start), to = ymd(now);
    return Object.keys(days).filter(function (k) { return k >= from && k <= to; });
  }

  function hourBands(id, range) {
    var days = id && heatHist[id] && heatHist[id].days;
    if (!days) return [];
    var keys = rangeKeys(days, range);
    var sum = [0, 0, 0, 0, 0, 0, 0, 0];
    var n = [0, 0, 0, 0, 0, 0, 0, 0];
    keys.forEach(function (k) {
      var slots = days[k] && days[k].slots;
      if (!slots) return;
      slots.forEach(function (v, i) {
        if (v == null || !isFinite(v)) return;
        sum[i] += v;
        n[i]++;
      });
    });
    var vals = sum.map(function (s, i) { return n[i] ? s / n[i] : null; });
    return vals.some(function (v) { return v != null; }) ? vals : [];
  }

  function playDates() {
    var n = heatRange === 'month' ? 30 : 7;
    var out = [];
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    for (var i = n - 1; i >= 0; i--) {
      var day = new Date(today);
      day.setDate(today.getDate() - i);
      out.push(ymd(day));
    }
    return out;
  }

  function sliceValue(id, live) {
    if (heatStep == null) return windowed(id, live, heatRange);
    var pack = id && heatHist[id] && heatHist[id].days;
    if (!pack) return null;
    if (heatRange === 'today') {
      var day = pack[ymd(new Date())];
      return day && day.slots ? day.slots[heatStep] : null;
    }
    var key = playDates()[heatStep];
    var hit = key && pack[key];
    return hit ? hit.v : null;
  }

  function playLabel() {
    if (heatStep == null) return '';
    if (heatRange === 'today') return BANDS[heatStep] || '';
    var key = playDates()[heatStep];
    if (!key) return '';
    var p = key.split('-');
    return Number(p[2]) + ' ' + MONTHS[Number(p[1]) - 1].slice(0, 3);
  }

  function shownId(z) {
    var mode = window.EKO && EKO.state && EKO.state.hmMode;
    if (mode === 'comfort') return z.co2Id;
    if (mode === 'hum' || mode === 'occ') return z.rhId;
    return z.tempId;
  }

  function applyShown() {
    var site = window.EKO_DATA && window.EKO_DATA.marsa;
    var zones = site && site.heat && site.heat.zones;
    if (!zones) return;
    zones.forEach(function (z) {
      z.tempC = sliceValue(z.tempId, z.liveTemp);
      z.rh = sliceValue(z.rhId, z.liveRh);
      z.co2 = sliceValue(z.co2Id, z.liveCo2);
      z.hours = hourBands(shownId(z), heatRange);
    });
  }

  function ensureHistory(id) {
    if (!id || heatHist[id]) return;
    heatHist[id] = { pending: true, days: null };
    var api = window.DashboardData;
    if (!api || !api.getPointHistory) {
      heatHist[id] = { pending: false, days: {} };
      return;
    }
    api.getPointHistory(id, 31).then(function (res) {
      if (!current()) return;
      heatHist[id] = { pending: false, days: dailyMap(res) };
      applyShown();
      paint();
    }).catch(function () {
      heatHist[id] = { pending: false, days: {} };
    });
  }

  function floorToken(floor) {
    var s = String(floor || '').toUpperCase();
    if (/ROOF|\bRF\b/.test(s)) return 'RF';
    if (/BASEMENT|\bBF\b/.test(s)) return 'BF';
    if (/GROUND|\bGF\b|LEVEL\s*0+/.test(s)) return 'GF';
    var m = s.match(/(?:LEVEL|FLOOR|FLR|L)\s*0*(\d+)/) || s.match(/\b(\d+)\s*F\b/);
    if (!m) return 'GF';
    var n = parseInt(m[1], 10);
    if (n <= 0) return 'GF';
    if (n === 1) return '1F';
    if (n === 2) return '2F';
    return n + 'F';
  }

  function applyHeat(list) {
    var site = window.EKO_DATA && window.EKO_DATA.marsa;
    if (!site || !site.heat || !Array.isArray(list)) return;
    var zones = [];
    for (var i = 1; i <= 4; i++) zones.push(blankZone('IAQ' + String(i).padStart(2, '0')));
    for (var j = 1; j <= 7; j++) zones.push(blankZone('IS' + String(j).padStart(2, '0')));
    var byKey = {};
    zones.forEach(function (z) { byKey[sensorKey(z.nameEn)] = z; });
    list.forEach(function (eq) {
      var key = sensorKey(eq.name);
      if (!key) return;
      var z = byKey[key];
      if (!z) {
        z = blankZone(key);
        zones.push(z);
        byKey[key] = z;
      }
      if (z.kind === 'is') {
        var temp = pointRef(eq, function (n) { return /zone[\s_-]*temp/i.test(n) && !/sp|setpoint/i.test(n); });
        var rh = pointRef(eq, function (n) { return /zone[\s_-]*humid/i.test(n); });
        z.tempId = temp.id; z.liveTemp = temp.value;
        z.rhId = rh.id; z.liveRh = rh.value;
      } else {
        var co2 = pointRef(eq, function (n) { return /co2/i.test(n); });
        z.co2Id = co2.id; z.liveCo2 = co2.value;
      }
      if (eq.floor) z.floor = floorToken(eq.floor);
    });
    zones.sort(function (a, b) { return a.nameEn.localeCompare(b.nameEn, undefined, { numeric: true }); });
    zones.forEach(function (z, i) {
      z.rect = [10 + (i % 4) * 22, 16 + Math.floor(i / 4) * 22, 18, 16];
    });
    var order = ['BF', 'GF', '1F', '2F', 'RF'];
    var seen = {};
    zones.forEach(function (z) { seen[z.floor] = true; });
    var floors = ['All'].concat(order.filter(function (f) { return seen[f]; }));
    Object.keys(seen).forEach(function (f) { if (order.indexOf(f) < 0) floors.push(f); });
    site.heat.zones = zones;
    site.heat.floors = floors;
    zones.forEach(function (z) { ensureHistory(z.tempId); ensureHistory(z.rhId); ensureHistory(z.co2Id); });
    applyShown();
  }

  window.EKO_HEAT = {
    apply: function (range) {
      heatRange = range === 'week' || range === 'month' ? range : 'today';
      heatStep = null;
      applyShown();
    },
    count: function () {
      return heatRange === 'today' ? BANDS.length : playDates().length;
    },
    step: function (i) {
      heatStep = i == null ? null : i;
      applyShown();
      return playLabel();
    }
  };

  function applyAlarmHistory(payload) {
    var site = window.EKO_DATA && window.EKO_DATA.marsa;
    if (!site || !payload) return;
    site.alarmHistory = payload;
    paint();
  }

  function applyDocuments(payload) {
    var site = window.EKO_DATA && window.EKO_DATA.marsa;
    var families = payload && payload.families;
    if (!site || !Array.isArray(families)) return;
    site.documents = families;
    paint();
  }

window.addEventListener('dashboard-data', function onData(e) {
    if (!current()) { window.removeEventListener('dashboard-data', onData); return; }
    var d = e.detail || {};
    if (d.type === 'alarms') applyAlarms(d.data);
    if (d.type === 'power') applyPower(d.data);
    if (d.type === 'meters') applyMeters(d.data);
    if (d.type === 'equipment') applyEquipment(d.data);
    if (d.type === 'documents') applyDocuments(d.data);
    if (d.type === 'workorders') applyWorkOrders(d.data);
    if (d.type === 'alarmHistory') applyAlarmHistory(d.data);
    if (d.type === 'status') finIntegration({ st: d.data && d.data.connected ? 'Live' : 'Not connected' });
    if (d.type === 'power' && d.data) finIntegration({ st: 'Live', hb: hhmm() });
    if (d.type === 'equipment' && d.data && Array.isArray(d.data.equipment)) {
      var pts = d.data.equipment.reduce(function (n, eq) { return n + ((eq && eq.points) || []).length; }, 0);
      finIntegration({ pts: pts + (pts === 1 ? ' point' : ' points'), hb: hhmm() });
    }
  });

  if (window.DashboardData && window.DashboardData.alarms) applyAlarms(window.DashboardData.alarms);
  if (window.DashboardData && window.DashboardData.power) applyPower(window.DashboardData.power);
  if (window.DashboardData && window.DashboardData.meters) applyMeters(window.DashboardData.meters);
  if (window.DashboardData && window.DashboardData.equipment) applyEquipment(window.DashboardData.equipment);
  if (window.DashboardData && window.DashboardData.documents) applyDocuments(window.DashboardData.documents);
  if (window.DashboardData && window.DashboardData.workorders) applyWorkOrders(window.DashboardData.workorders);
  if (window.DashboardData && window.DashboardData.alarmHistory) applyAlarmHistory(window.DashboardData.alarmHistory);
})();