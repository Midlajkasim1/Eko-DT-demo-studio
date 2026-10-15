(function () {
  'use strict';
  function liveRoot() {
    var el = document.querySelector('.dashboard-native-container');
    if (!el) el = document.documentElement;
    window.DASHBOARD_ROOT = el;
    window.DASHBOARD_OVERLAY = el !== document.documentElement;
    return el;
  }
  liveRoot();
  window.DASHBOARD_BASE = '/static/dashboard/';

  var orbitHit = null;
  function dropOrbitHit() {
    if (orbitHit && orbitHit.parentNode) orbitHit.parentNode.removeChild(orbitHit);
  }
  window.syncWallHole = function () {
    var mount = document.getElementById('mount');
    var wall = mount && mount.querySelector('.wall');
    if (!mount) return;
    var fill = mount.querySelector('.wbgfill');
    if (!wall) {
      if (fill) fill.remove();
      dropOrbitHit();
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
      dropOrbitHit();
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
    if (!orbitHit) {
      orbitHit = document.createElement('div');
      orbitHit.className = 'wmodelhit';
      orbitHit.setAttribute('aria-hidden', 'true');
      orbitHit.addEventListener('pointerdown', function (ev) {
        orbitHit.setAttribute('data-drag', '1');
        document.body.classList.add('wall-orbiting');
        try { var sel = window.getSelection(); if (sel) sel.removeAllRanges(); } catch (e) {}
        ev.preventDefault();
      });
      window.addEventListener('pointerup', function () {
        if (orbitHit) orbitHit.removeAttribute('data-drag');
        document.body.classList.remove('wall-orbiting');
      });
      window.addEventListener('pointercancel', function () {
        if (orbitHit) orbitHit.removeAttribute('data-drag');
        document.body.classList.remove('wall-orbiting');
      });
    }
    if (orbitHit.parentNode !== mount) mount.appendChild(orbitHit);
    orbitHit.style.cssText = 'position:absolute;left:' + left + 'px;top:' + top + 'px;width:' + hr.width + 'px;height:' + hr.height + 'px;z-index:8;cursor:grab;background:transparent';
    if (window.EKO_HOST_ENGINE && typeof window.EKO_HOST_ENGINE.bindWallOrbit === 'function') {
      window.EKO_HOST_ENGINE.bindWallOrbit();
    }
  };

  window.__wallOpenHook = function () {
    var E = window.EKO;
    if (!E) return;
    liveRoot().setAttribute('data-wall', '1');
    E.state.wall = true;
    E.state.wallOpt = {
      scope: (E.state.pageId === 'portfolio' || E.state.pageId === 'pfsite') ? 'estate' : 'site',
      id: E.state.wallCfgId || 'default',
      viaTab: false
    };
    if (window.EKO_WALL) window.EKO_WALL.start(E);
    window.dispatchEvent(new CustomEvent('dashboard-wall', { detail: { on: true } }));
    requestAnimationFrame(function () {
      if (window.syncWallHole) window.syncWallHole();
      if (window.EKO_HOST_ENGINE && window.EKO_HOST_ENGINE.bindWallOrbit) window.EKO_HOST_ENGINE.bindWallOrbit();
    });
  };

  window.__wallExitHook = function (info) {
    var E = window.EKO;
    if (!E) return;
    E.state.wall = false;
    E.state.wallOpt = null;
    E.state.wallCfgOpen = false;
    liveRoot().removeAttribute('data-wall');
    var open = '';
    try { open = new URL((info && info.url) || '', location.href).searchParams.get('open') || ''; } catch (e) {}
    if (open.indexOf('asset:') === 0) E.state.assetSel = open.slice(6);
    window.dispatchEvent(new CustomEvent('dashboard-wall', { detail: { on: false } }));
    var fill = document.querySelector('.wbgfill');
    if (fill) fill.remove();
    dropOrbitHit();
    if (window.EKO_HOST_ENGINE && window.EKO_HOST_ENGINE.bindWallOrbit) window.EKO_HOST_ENGINE.bindWallOrbit();
    E.set({ born: 'boot' });
  };

  window.DashboardOverlayTeardown = function () {
    try {
      if (window.EKO && window.EKO.state) {
        window.EKO.state.wall = false;
        window.EKO.state.wallOpt = null;
      }
    } catch (e) {}
    try { if (window.EKO_PWA && window.EKO_PWA.stop) window.EKO_PWA.stop(); } catch (e) {}
    try { if (window.EKO_SPLIT && window.EKO_SPLIT.stop) window.EKO_SPLIT.stop(); } catch (e) {}
    try { var tip = document.getElementById('ekotip'); if (tip) tip.remove(); } catch (e) {}
    try { var mx = document.getElementById('wmaxov'); if (mx) mx.remove(); } catch (e) {}
    try { if (window.EKO && window.EKO.engine && window.EKO.engine.destroy) window.EKO.engine.destroy(); } catch (e) {}
    window.EKO = undefined;
  };
})();
