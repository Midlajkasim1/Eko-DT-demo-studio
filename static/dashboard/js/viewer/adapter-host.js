(function () {
  'use strict';

  var STYLE = { default: 'default', photo: 'photoreal', minimal: 'minimal', studio: 'studio', xray: 'xray' };

  window.EKO_VIEWER.register('host', function () {
    var host = null;
    var markers = [];
    var viewpoints = {}, vpSeq = 0;
    var cbs ={ ready: [], error: [], camera: [], assetClick: [], markerClick: [], measure: [], section: [] };
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
      /* E15: a viewpoint is the Studio camera (captureCamera), restored with lookAtView */
      saveViewpoint: function () {
        var h = window.EKO_HOST_ENGINE, view = h && h.captureCamera ? h.captureCamera() : null;
        var id = 'vp-host-' + (++vpSeq);
        if (view) viewpoints[id] = view;
        return { id: id };
      },
      loadViewpoint: function (id) {
        var h = window.EKO_HOST_ENGINE, view = viewpoints[id && id.id ? id.id : id];
        return !!(view && h && h.lookAtView && h.lookAtView(view));
      },
      flyToViewpoint: function (vp) { return this.loadViewpoint(vp); },
      animating: function () { return false; },
      /* E15: an engine asset names its model element (gid) or room (roomGid); the Studio finds either */
      locatable: function (assetId) {
        var h = window.EKO_HOST_ENGINE;
        return !!(h && h.bimIdFor && h.bimIdFor(assetId));
      },
      flyToAssetAt: function (assetId) {
        if (!this.locatable(assetId)) return false;
        window.EKO_HOST_ENGINE.flyToAsset(assetId);
        return true;
      },
      flyToGid: function (gid) {
        if (gid && window.EKO_HOST_ENGINE && window.EKO_HOST_ENGINE.flyToAsset) window.EKO_HOST_ENGINE.flyToAsset(gid);
      },
      highlightGid: function (gid) {
        var h = window.EKO_HOST_ENGINE;
        if (!h) return;
        if (gid && h.highlightAsset) h.highlightAsset(gid);
        else if (!gid && h.clearHighlight) h.clearHighlight();
      },
      matchElements: function (items) {
        var h = window.EKO_HOST_ENGINE;
        return h && h.matchElements ? h.matchElements(items) : Promise.resolve({ ready: true, matched: 0 });
      },
      cameraSetup: function () {
        var h = window.EKO_HOST_ENGINE;
        return h && h.cameraSetup ? h.cameraSetup() : null;
      },
      currentGid: function (gid) {
        var h = window.EKO_HOST_ENGINE;
        return h && h.currentGid ? h.currentGid(gid) : gid;
      },
      projectAsset: function (assetId) {
        var h = window.EKO_HOST_ENGINE, p = h && h.projectPoint ? h.projectPoint({ asset: assetId }) : null;
        return p || { x: 0, y: 0, visible: false };
      },
      onCameraChange: on('camera'),
      /* E15 Show in the model: the asset in colour on the x-ray style, the floors above it cut, its floor outlined; null undoes each */
      setFocus: function (list, colour) {
        var h = window.EKO_HOST_ENGINE;
        if (h && h.focusAsset) h.focusAsset(list && list.length ? list[0] : null, colour);
      },
      cutAbove: function (assetId) {
        var h = window.EKO_HOST_ENGINE;
        if (h && h.cutAboveAsset) h.cutAboveAsset(assetId || null);
      },
      outlineLevel: function (assetId) {
        var h = window.EKO_HOST_ENGINE;
        if (h && h.outlineFloorOf) h.outlineFloorOf(assetId || null);
      },

      setStyle: function (mode) {
        var id = STYLE[mode] || 'photoreal';
        if (window.StudioViewer && window.StudioViewer.setStyle) window.StudioViewer.setStyle(id);
        else if (window.ViewerTemplates && window.ViewerTemplates.set) window.ViewerTemplates.set(id);
      },
      setAssetColor: noop,
      clearAssetColors: noop,

      isolateLevel: function (levelId, force) {
        if (window.EKO_HOST_ENGINE && window.EKO_HOST_ENGINE.isolateLevel) {
          window.EKO_HOST_ENGINE.isolateLevel(levelId, force);
        }
      },
      isolateLayer: function (layerId, force) {
        if (window.EKO_HOST_ENGINE && window.EKO_HOST_ENGINE.isolateLayer) {
          window.EKO_HOST_ENGINE.isolateLayer(layerId, force);
        }
      },
      showAllLevels: function () {
        if (window.EKO_HOST_ENGINE && window.EKO_HOST_ENGINE.isolateLevel) {
          window.EKO_HOST_ENGINE.isolateLevel('ALL');
        }
      },
      setLayerVisibility: function (layerId, force) {
        if (window.EKO_HOST_ENGINE && window.EKO_HOST_ENGINE.isolateLayer) {
          window.EKO_HOST_ENGINE.isolateLayer(layerId, force);
        }
      },
      fadeArch: function (on) {
        if (window.EKO_HOST_ENGINE && window.EKO_HOST_ENGINE.fadeArch) {
          window.EKO_HOST_ENGINE.fadeArch(!!on);
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
      onMarkerClick: on('markerClick'),
      attachMiniMap: function (el) {
        if (window.EKO_HOST_ENGINE && window.EKO_HOST_ENGINE.attachMiniMap) {
          window.EKO_HOST_ENGINE.attachMiniMap(el);
        }
      },
      setMiniMap: function (on) {
        if (window.EKO_HOST_ENGINE && window.EKO_HOST_ENGINE.setMiniMap) {
          window.EKO_HOST_ENGINE.setMiniMap(on);
        }
      }
    };
  });
})();
