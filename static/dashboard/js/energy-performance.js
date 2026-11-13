/* Energy Performance KPI (FIN point EnergyPerformance, a % Number): the status bands, the 7-day comparison and the chart geometry.
   Pure functions, no DOM and no FIN access: data-map.js feeds it the FIN readings, widgets.js draws what it returns. Loaded in the browser as
   window.EKO_ENERGY_PERF and by the unit tests as a module.

   THRESHOLDS are the client's table. Change them here only:
     below 60 Unhealthy | 60 to below 70 Poor | 70 to below 80 Acceptable / Good | 80 to 90 Excellent | above 90 Unhealthy
   The last rule (above 90 is also Unhealthy) is the client's wording and is NOT yet confirmed by them: to change it, edit OVER. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.document) root.EKO_ENERGY_PERF = api;
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  var STATUS = {
    unhealthy: { key: 'unhealthy', en: 'Unhealthy', ar: 'غير سليم', tone: 'warn', dot: 'crit' },
    poor: { key: 'poor', en: 'Poor', ar: 'ضعيف', tone: 'warn', dot: 'warn' },
    acceptable: { key: 'acceptable', en: 'Acceptable / Good', ar: 'مقبول / جيد', tone: 'pos', dot: 'ok' },
    excellent: { key: 'excellent', en: 'Excellent', ar: 'ممتاز', tone: 'pos', dot: 'ok' }
  };
  /* ascending: the first band the value falls in. below = exclusive upper bound, atMost = inclusive upper bound */
  var BANDS = [
    { below: 60, status: 'unhealthy' },
    { below: 70, status: 'poor' },
    { below: 80, status: 'acceptable' },
    { atMost: 90, status: 'excellent' }
  ];
  var OVER = 'unhealthy';

  /* A reading is a finite number; null, undefined, '', booleans, NaN and Infinity get no status (0 is a real reading) */
  function isReading(v) { return typeof v === 'number' && isFinite(v); }

  function status(v) {
    if (!isReading(v)) return null;
    for (var i = 0; i < BANDS.length; i++) {
      var b = BANDS[i];
      if (b.below != null ? v < b.below : v <= b.atMost) return STATUS[b.status];
    }
    return STATUS[OVER];
  }

  var HOUR = 3600000, DAY = 86400000;
  var WINDOW_DAYS = 7;
  /* fewer distinct days than this is not a 7-day comparison */
  var MIN_DAYS = 2;

  /* The site's wall-clock now as a number (its fields read as UTC), the same scale as a history reading's time */
  function localNow(timeZone, date) {
    var d = date || new Date();
    try {
      var o = {};
      new Intl.DateTimeFormat('en-GB', { timeZone: timeZone, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric',
        second: 'numeric', hourCycle: 'h23' }).formatToParts(d).forEach(function (p) { o[p.type] = parseInt(p.value, 10); });
      return Date.UTC(o.year, o.month - 1, o.day, o.hour % 24, o.minute, o.second);
    } catch (e) {
      return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds());
    }
  }

  /* readings: [{t, v}] (t = site wall-clock time, see localNow). The previous 7 days: from now - 7 days up to the start of the current hour
     (that hour is still being recorded, and the live reading stands for it). Chronological, one reading per time, nothing in the future,
     nothing made up. state: 'none' no reading in the window, 'few' too few days for an average, 'ok'. */
  function history(readings, now) {
    var end = Math.floor(now / HOUR) * HOUR, start = now - WINDOW_DAYS * DAY, seen = {}, pts = [];
    (readings || []).forEach(function (r) {
      if (!r || !isReading(r.t) || !isReading(r.v) || r.t < start || r.t >= end || seen[r.t]) return;
      seen[r.t] = 1;
      pts.push({ t: r.t, v: r.v });
    });
    pts.sort(function (a, b) { return a.t - b.t; });
    var days = {}, sum = 0;
    pts.forEach(function (p) { days[Math.floor(p.t / DAY)] = 1; sum += p.v; });
    var nDays = Object.keys(days).length;
    var state = !pts.length ? 'none' : nDays < MIN_DAYS ? 'few' : 'ok';
    return { points: pts, days: nDays, avg: state === 'ok' ? sum / pts.length : null, state: state, start: start, end: now };
  }

  var round1 = function (x) { return Math.round(x * 10) / 10; };

  /* The comparison of the current reading with the 7-day average: the difference is in percentage points. null when there is no average. */
  function compare(current, h) {
    if (!isReading(current) || h.avg == null) return null;
    var diff = round1(current - h.avg);
    return { avg: round1(h.avg), diff: diff, trend: diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat' };
  }

  /* Chart geometry in a w x h box with margins: x is time over the 7-day window (history then the current reading at its right edge), y is %.
     Returns scaled points, the average line, the current marker and the axis ticks (a tick at each site midnight), or null with no history. */
  function chart(h, current, w, ht, m) {
    if (!h || !h.points.length) return null;
    m = m || { l: 30, r: 8, t: 8, b: 18 };
    var vals = h.points.map(function (p) { return p.v; });
    if (isReading(current)) vals.push(current);
    if (h.avg != null) vals.push(h.avg);
    var lo = Math.floor((Math.min.apply(null, vals) - 1) / 5) * 5, hi = Math.ceil((Math.max.apply(null, vals) + 1) / 5) * 5;
    if (hi <= lo) hi = lo + 5;
    var pw = w - m.l - m.r, ph = ht - m.t - m.b;
    var x = function (t) { return round1(m.l + (t - h.start) / (h.end - h.start) * pw); };
    var y = function (v) { return round1(m.t + (hi - v) / (hi - lo) * ph); };
    var xt = [];
    for (var d = Math.ceil(h.start / DAY) * DAY; d <= h.end; d += DAY) xt.push({ t: d, x: x(d) });
    return {
      w: w, h: ht, m: m, lo: lo, hi: hi,
      points: h.points.map(function (p) { return { t: p.t, v: p.v, x: x(p.t), y: y(p.v) }; }),
      avg: h.avg == null ? null : { v: h.avg, y: y(h.avg) },
      now: isReading(current) ? { t: h.end, v: current, x: x(h.end), y: y(current) } : null,
      xTicks: xt, yTicks: [lo, hi].map(function (v) { return { v: v, y: y(v) }; })
    };
  }

  return { STATUS: STATUS, BANDS: BANDS, OVER: OVER, MIN_DAYS: MIN_DAYS, status: status, isReading: isReading, localNow: localNow,
    history: history, compare: compare, chart: chart };
});
