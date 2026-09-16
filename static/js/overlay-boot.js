(function () {
  'use strict';
  var root = document.querySelector('.dashboard-native-container') || document.documentElement;
  if (root === document.documentElement) root.classList.add('dashboard-native-container');
  window.DASHBOARD_ROOT = root;
  window.DASHBOARD_BASE = '/static/dashboard/';
  window.DASHBOARD_OVERLAY = root !== document.documentElement;

  window.syncWallHole = function () {
    var mount = document.getElementById('mount');
    var wall = mount && mount.querySelector('.wall');
    if (!mount) return;
    var fill = mount.querySelector('.wbgfill');
    if (!wall) {
      if (fill) fill.remove();
      return;
    }
    if (!fill) {
      fill = document.createElement('div');
      fill.className = 'wbgfill';
      fill.innerHTML = '<i class="wbg-t"></i><i class="wbg-l"></i><i class="wbg-r"></i><i class="wbg-b"></i>';
      mount.insertBefore(fill, mount.firstChild);
    }
    var t = fill.querySelector('.wbg-t');
    var l = fill.querySelector('.wbg-l');
    var r = fill.querySelector('.wbg-r');
    var b = fill.querySelector('.wbg-b');
    var hole = wall.querySelector('.wcentre[data-pane="model"]');
    if (!t || !l || !r || !b) return;
    if (!hole) {
      t.style.cssText = 'left:0;top:0;right:0;bottom:0';
      l.style.cssText = r.style.cssText = b.style.cssText = 'display:none';
      return;
    }
    var mr = mount.getBoundingClientRect();
    var hr = hole.getBoundingClientRect();
    var top = Math.max(0, hr.top - mr.top);
    var left = Math.max(0, hr.left - mr.left);
    var right = Math.max(0, mr.right - hr.right);
    var bottom = Math.max(0, mr.bottom - hr.bottom);
    t.style.cssText = 'display:block;left:0;top:0;right:0;height:' + top + 'px';
    b.style.cssText = 'display:block;left:0;bottom:0;right:0;height:' + bottom + 'px';
    l.style.cssText = 'display:block;left:0;top:' + top + 'px;width:' + left + 'px;height:' + hr.height + 'px';
    r.style.cssText = 'display:block;right:0;top:' + top + 'px;width:' + right + 'px;height:' + hr.height + 'px';
  };

  window.__wallOpenHook = function () {
    var E = window.EKO;
    if (!E) return;
    E.state.wall = true;
    E.state.wallOpt = {
      scope: (E.state.pageId === 'portfolio' || E.state.pageId === 'pfsite') ? 'estate' : 'site',
      id: E.state.wallCfgId || 'default',
      viaTab: false
    };
    if (window.EKO_WALL) window.EKO_WALL.start(E);
    window.dispatchEvent(new CustomEvent('dashboard-wall', { detail: { on: true } }));
  };

  window.__wallExitHook = function (info) {
    var E = window.EKO;
    if (!E) return;
    E.state.wall = false;
    E.state.wallOpt = null;
    E.state.wallCfgOpen = false;
    root.removeAttribute('data-wall');
    var open = '';
    try { open = new URL((info && info.url) || '', location.href).searchParams.get('open') || ''; } catch (e) {}
    if (open.indexOf('asset:') === 0) E.state.assetSel = open.slice(6);
    window.dispatchEvent(new CustomEvent('dashboard-wall', { detail: { on: false } }));
    var fill = document.querySelector('.wbgfill');
    if (fill) fill.remove();
    E.set({ born: 'boot' });
  };

  window.DashboardOverlayTeardown = function () {
    try { if (window.EKO_PWA && window.EKO_PWA.stop) window.EKO_PWA.stop(); } catch (e) {}
    try { if (window.EKO_SPLIT && window.EKO_SPLIT.stop) window.EKO_SPLIT.stop(); } catch (e) {}
    try { var tip = document.getElementById('ekotip'); if (tip) tip.remove(); } catch (e) {}
    try { if (window.EKO && window.EKO.engine && window.EKO.engine.destroy) window.EKO.engine.destroy(); } catch (e) {}
    window.EKO = undefined;
  };
})();
