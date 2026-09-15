(function () {
  'use strict';
  var root = document.querySelector('.dashboard-native-container') || document.documentElement;
  if (root === document.documentElement) root.classList.add('dashboard-native-container');
  window.DASHBOARD_ROOT = root;
  window.DASHBOARD_BASE = '/static/dashboard/';
  window.DASHBOARD_OVERLAY = root !== document.documentElement;

  window.DashboardOverlayTeardown = function () {
    try { if (window.EKO_PWA && window.EKO_PWA.stop) window.EKO_PWA.stop(); } catch (e) {}
    try { if (window.EKO_SPLIT && window.EKO_SPLIT.stop) window.EKO_SPLIT.stop(); } catch (e) {}
    try { var tip = document.getElementById('ekotip'); if (tip) tip.remove(); } catch (e) {}
    try { if (window.EKO && window.EKO.engine && window.EKO.engine.destroy) window.EKO.engine.destroy(); } catch (e) {}
    window.EKO = undefined;
  };
})();
