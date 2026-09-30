(function () {
  'use strict';

  var STYLE = { default: 'default', photo: 'photoreal', minimal: 'minimal', xray: 'xray' };

  window.EKO_VIEWER.register('host', function () {
    var host = null;
    var markers = [];
    var cbs = { ready: [], error: [], camera: [], assetClick: [], markerClick: [], measure: [], section: [] };
    var on = function (k) { return function (cb) { cbs[k].push(cb); }; };
    var fire = function (k, arg) { cbs[k].forEach(function (f) { f(arg); }); };
    var noop = function () {};

    return {
      capabilities: {
        style: true,
        sectionPlane: true,
        measure: true,
        levels: true,
        layers: true,
        viewpoints: false,
        picking: true,
        isolate: true,
        orbit: true
      },

      init: function (container) {
        host = container;
        if (host) host.style.pointerEvents = 'none';
        setTimeout(function () { fire('ready'); }, 0);
      },
      destroy: function () { host = null; markers = []; },
      onReady: on('ready'),
      onError: on('error'),

      fireCameraChange: function () { fire('camera'); },

      flyTo: function (assetId) {
        if (window.EKO_HOST_ENGINE && window.EKO_HOST_ENGINE.flyToAsset) {
          window.EKO_HOST_ENGINE.flyToAsset(assetId);
        }
      },
      resetView: function () {
        if (window.EKO_HOST_ENGINE && window.EKO_HOST_ENGINE.resetView) window.EKO_HOST_ENGINE.resetView();
      },
      cameraMoved: function () { return false; },
      saveViewpoint: function () { return { id: 'vp-host' }; },
      loadViewpoint: noop,
      onCameraChange: on('camera'),

      setStyle: function (mode) {
        var id = STYLE[mode] || 'photoreal';
        if (window.StudioViewer && window.StudioViewer.setStyle) window.StudioViewer.setStyle(id);
        else if (window.ViewerTemplates && window.ViewerTemplates.set) window.ViewerTemplates.set(id);
      },
      setAssetColor: noop,
      clearAssetColors: noop,

      isolateLevel: function (levelId) {
        if (window.EKO_HOST_ENGINE && window.EKO_HOST_ENGINE.isolateLevel) {
          window.EKO_HOST_ENGINE.isolateLevel(levelId);
        }
      },
      showAllLevels: function () {
        if (window.EKO_HOST_ENGINE && window.EKO_HOST_ENGINE.isolateLevel) {
          window.EKO_HOST_ENGINE.isolateLevel('ALL');
        }
      },
      setLayerVisibility: function (layerId) {
        if (window.EKO_HOST_ENGINE && window.EKO_HOST_ENGINE.isolateLayer) {
          window.EKO_HOST_ENGINE.isolateLayer(layerId);
        }
      },

      setSectionPlane: noop,
      startSlice: function () {
        if (window.EKO_HOST_ENGINE && window.EKO_HOST_ENGINE.startSlice) window.EKO_HOST_ENGINE.startSlice();
      },
      stopSlice: function () {
        if (window.EKO_HOST_ENGINE && window.EKO_HOST_ENGINE.stopSlice) window.EKO_HOST_ENGINE.stopSlice();
      },
      clearSection: function () {
        if (window.EKO_HOST_ENGINE && window.EKO_HOST_ENGINE.clearSection) window.EKO_HOST_ENGINE.clearSection();
      },
      onSectionHandle: on('section'),

      startMeasure: function () {
        var eng = window.EKO_HOST_ENGINE;
        var report = function (r) { fire('measure', r); };
        window.EKO_REPORT_MEASURE = report;
        if (!eng) return;
        eng.reportMeasure = report;
        if (eng.startMeasure) eng.startMeasure();
      },
      cancelMeasure: function () {
        if (window.EKO_HOST_ENGINE && window.EKO_HOST_ENGINE.cancelMeasure) {
          window.EKO_HOST_ENGINE.cancelMeasure();
        }
      },
      finishMeasure: function () {
        var eng = window.EKO_HOST_ENGINE;
        var report = function (r) { fire('measure', r); };
        window.EKO_REPORT_MEASURE = report;
        if (eng) eng.reportMeasure = report;
        if (eng && eng.finishMeasure) eng.finishMeasure();
      },
      clearMeasure: function () {
        var eng = window.EKO_HOST_ENGINE;
        var report = function (r) { fire('measure', r); };
        window.EKO_REPORT_MEASURE = report;
        if (eng) eng.reportMeasure = report;
        if (eng && eng.clearMeasure) eng.clearMeasure();
        else fire('measure', null);
      },
      onMeasureResult: on('measure'),

      highlightAsset: function (id) {
        if (window.EKO_HOST_ENGINE && window.EKO_HOST_ENGINE.highlightAsset) {
          window.EKO_HOST_ENGINE.highlightAsset(id);
        }
      },
      clearHighlight: function () {
        if (window.EKO_HOST_ENGINE && window.EKO_HOST_ENGINE.clearHighlight) {
          window.EKO_HOST_ENGINE.clearHighlight();
        }
      },
      setMarkers: function (list) { markers = list || []; },
      worldToScreen: function (point) {
        if (window.EKO_HOST_ENGINE && window.EKO_HOST_ENGINE.projectPoint) {
          var p = window.EKO_HOST_ENGINE.projectPoint(point);
          if (p) return p;
        }
        if (!host || !point) return { x: 0, y: 0, visible: false };
        var r = host.getBoundingClientRect();
        var x = Number(point.x);
        var y = Number(point.y);
        if (!isFinite(x) || !isFinite(y)) return { x: 0, y: 0, visible: false };
        return { x: r.width * x / 100, y: r.height * y / 100, visible: true };
      },
      screenToWorld: function () { return null; },
      onAssetClick: on('assetClick'),
      onMarkerClick: on('markerClick')
    };
  });
})();
