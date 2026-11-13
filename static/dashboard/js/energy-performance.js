/* Energy Performance KPI (FIN point EnergyPerformance, a % Number): the status bands, the 7-day comparison.
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
     nothing made up. state: 'none' no reading in the window, else 'ok'. days = distinct site days with a reading; avg = mean of the readings. */
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
    return { points: pts, days: nDays, avg: pts.length ? sum / pts.length : null, state: pts.length ? 'ok' : 'none', start: start, end: now };
  }

  var round1 = function (x) { return Math.round(x * 10) / 10; };

  /* The comparison of the current reading with the best reference the history allows, in this order:
       week: 7 or more days with readings -> the average of the window
       day:  the reading 24 hours earlier (same hour yesterday, a reading within an hour of it)
       last: the latest reading before now
     Returns {mode, base, t (the reference reading's time; null for week), diff (percentage points), pct (change relative to base, null when base is 0), trend},
     or null with no valid current reading or no history: the card then shows the value alone. */
  function compare(current, h) {
    if (!isReading(current) || !h || !h.points.length) return null;
    var mode = 'week', base = h.avg, t = null;
    if (h.days < WINDOW_DAYS) {
      var want = Math.floor(h.end / HOUR) * HOUR - DAY, near = null;
      h.points.forEach(function (p) { if (Math.abs(p.t - want) <= HOUR && (!near || Math.abs(p.t - want) < Math.abs(near.t - want))) near = p; });
      mode = near ? 'day' : 'last';
      var ref = near || h.points[h.points.length - 1];
      base = ref.v; t = ref.t;
    }
    var diff = round1(current - base);
    return { mode: mode, base: round1(base), t: t, diff: diff, pct: base === 0 ? null : round1((current - base) / Math.abs(base) * 100), trend: diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat' };
  }

  return { STATUS: STATUS, BANDS: BANDS, OVER: OVER, status: status, isReading: isReading, localNow: localNow,
    history: history, compare: compare };
});
