/* ============================================================================
   Fragments adapter — DOCUMENTED STUB with the production signatures.
   In production this wraps That Open Engine (@thatopen/components +
   @thatopen/fragments). Each method's comment states exactly how it is
   implemented there; see /handoff/viewer-integration.md for the step-by-step
   replacement guide and the IFC-GUID ↔ asset-id mapping contract.

   Until the Fragments runtime is wired in, init() reports a clean onError so
   the shell shows its honest "engine unavailable" state instead of a broken
   canvas. Selecting this adapter is one config line: data.viewer.engine.
   ============================================================================ */
(function(){
  'use strict';

  window.EKO_VIEWER.register('fragments', function(){
    const cbs = { ready: [], error: [], camera: [], assetClick: [], markerClick: [], measure: [], section: [] };
    const on = k => cb => cbs[k].push(cb);
    const stub = name => () => console.warn('fragments adapter stub: ' + name + '() — see viewer-integration.md');

    return {
      /* Fragments renders real geometry, so everything is supported. */
      capabilities: { style: true, sectionPlane: true, measure: true,
                      levels: true, layers: true, viewpoints: true, picking: true,
                      isolate: true, orbit: true },

      /* PRODUCTION: create a Components instance, a SimpleScene/PostproRenderer
         world bound to `container`, then FragmentsManager.load() the .frag
         file named by sceneRef.fragments (with its .json properties sidecar).
         IfcRelDefines properties are indexed here so asset-id lookups are O(1).
         Fire onReady after the first frame; onError on load/webgl failure. */
      init(container, sceneRef){
        setTimeout(() => cbs.error.forEach(f => f({
          code: 'ENGINE_NOT_INSTALLED',
          message: 'Fragments runtime not bundled in the mockup. sceneRef.fragments="' + (sceneRef && sceneRef.fragments || '') + '"'
        })), 0);
      },
      /* PRODUCTION: components.dispose() — releases workers, GPU buffers. */
      destroy: stub('destroy'),
      onReady: on('ready'),
      onError: on('error'),

      /* PRODUCTION: resolve asset-id → expressIDs via the mapping table, then
         world.camera.controls.fitToSphere(boundingSphereOf(ids), true). */
      flyTo: stub('flyTo'),
      /* PRODUCTION: camera.controls.setLookAt(home) captured after load. */
      resetView: stub('resetView'),
      /* PRODUCTION: compare camera position/target with the captured home. */
      cameraMoved: () => false,
      /* PRODUCTION: serialize camera.controls.getPosition/getTarget → id. */
      saveViewpoint: () => ({ id: 'vp-stub' }),
      loadViewpoint: stub('loadViewpoint'),
      /* PRODUCTION: camera.controls.addEventListener('update', cb) throttled
         to rAF — the shell re-projects markers on each tick. */
      onCameraChange: on('camera'),

      /* PRODUCTION:
         photo   → default materials, postproduction on (shade + shadow).
         minimal → white material override (MaterialManager backgroundColor +
                   mesh material swap), edges on.
         bw      → grayscale postproduction pass.
         xray    → FragmentsManager transparent material override; tones map
                   to the override's color/opacity; alarm colours stay SOLID
                   (excluded from the transparent override list). */
      setStyle: stub('setStyle'),
      /* PRODUCTION: Highlighter.highlightByID('alarm-'+color, {fragmentMap})
         with a named selection per colour; null removes the asset from every
         alarm selection. This is where "colour only on assets in alarm" is
         enforced — the shell sends colours, the engine just paints. */
      setAssetColor: stub('setAssetColor'),
      /* PRODUCTION: Highlighter.clear('alarm-*'). */
      clearAssetColors: stub('clearAssetColors'),

      /* PRODUCTION: Classifier.byIfcBuildingStorey → fragment map per level;
         Hider.set(false) everything, then Hider.set(true, levelMap). */
      isolateLevel: stub('isolateLevel'),
      showAllLevels: stub('showAllLevels'),
      /* PRODUCTION: Classifier.byEntity/byPredefinedType grouped into the
         shell's discipline layers (arch/elec/int/mech/str) via the layer map
         in the site data; Hider.set(visible, groupMap). */
      setLayerVisibility: stub('setLayerVisibility'),

      /* PRODUCTION: Clipper.create() with a plane normal to `axis`, offset by
         `position` across the model bounds; enabled toggles plane.enabled.
         The shell's drag handle drives position via onSectionHandle. */
      setSectionPlane: stub('setSectionPlane'),
      clearSection: stub('clearSection'),
      onSectionHandle: on('section'),

      /* PRODUCTION: LengthMeasurement / AreaMeasurement components; their
         'onAfterCreate' event is re-fired as onMeasureResult({value, unit,
         points}) — the ENGINE draws nothing UI-side; our readout renders. */
      startMeasure: stub('startMeasure'),
      cancelMeasure: stub('cancelMeasure'),
      onMeasureResult: on('measure'),

      /* PRODUCTION: Highlighter.highlightByID('select', map) with the outline
         postpro pass; clear('select') on clearHighlight. */
      highlightAsset: stub('highlightAsset'),
      clearHighlight: stub('clearHighlight'),
      /* PRODUCTION: markers anchor to expressID centroids resolved once at
         load; world = THREE.Vector3. */
      setMarkers: stub('setMarkers'),
      /* PRODUCTION: project world Vector3 through camera; visible=false when
         behind the camera or outside the frustum (the shell hides that
         marker rather than pinning it to an edge). */
      worldToScreen: () => ({ x: 0, y: 0, visible: false }),
      /* PRODUCTION: raycast from NDC into the fragment meshes. */
      screenToWorld: () => null,
      /* PRODUCTION: Highlighter 'onHighlight' → resolve expressID → asset id
         via the mapping table → cb(assetId). */
      onAssetClick: on('assetClick'),
      onMarkerClick: on('markerClick')
    };
  });
})();
