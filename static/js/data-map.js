(function () {
  'use strict';
  if (!window.DASHBOARD_OVERLAY) return;

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

  function mapAlarm(a, i) {
    var src = a.source || '';
    var msg = a.message || src;
    return {
      id: 'fin-' + i + '-' + String(a.occurred || '').replace(/\W/g, '').slice(0, 16),
      fam: 'sys',
      asset: assetId(src),
      sev: sev(a.severity),
      cat: a.diagnosed ? 'fdd' : 'sys',
      sys: src || 'FIN',
      ack: null,
      ageH: ageH(a.occurred),
      locEn: src,
      locAr: src,
      plainEn: msg,
      plainAr: msg,
      techEn: msg,
      techAr: msg,
      impactAedMo: null,
      raised: raised(a.occurred),
      lifecycle: []
    };
  }

  function applyAlarms(payload) {
    var site = window.EKO_DATA && window.EKO_DATA.marsa;
    if (!site || !payload || !Array.isArray(payload.alarms)) return;
    site.alarms = payload.alarms.map(mapAlarm);
    var E = window.EKO;
    if (E && typeof E.set === 'function') E.set({});
  }

  window.addEventListener('dashboard-data', function (e) {
    var d = e.detail || {};
    if (d.type === 'alarms') applyAlarms(d.data);
  });

  if (window.DashboardData && window.DashboardData.alarms) applyAlarms(window.DashboardData.alarms);
})();
