/* ============================================================================
   EKO viewer API — THE boundary between the shell and any 3D engine.
   In production the model is rendered by That Open / Fragments; in this
   mockup by a static-image adapter. The rest of the app talks ONLY to this
   surface. No component may reach past it into engine internals.

   THE CHROME STAYS OURS: dock, flyouts, markers, measure readout, level and
   layer lists, viewpoint list, alarm colouring rules are shell components.
   The adapter only executes.

   Full contracts, payload shapes and the Fragments replacement guide:
   /handoff/viewer-integration.md
   ============================================================================ */
window.EKO_VIEWER = (function(){
  'use strict';

  /* --------------------------------------------------------------------------
     INTERFACE (duck-typed; adapter-fragments.js documents each method's
     production implementation).

     lifecycle
       init(container, sceneRef)      mount into a DOM node. sceneRef is the
                                      site's scene descriptor from /js/data
                                      (images for static; fragments/IFC refs
                                      for real engines). Returns nothing;
                                      readiness is signalled via onReady.
       destroy()                      release DOM/GPU resources.
       onReady(cb)                    cb() once the scene is displayable.
       onError(cb)                    cb({code, message}) on failure.

     camera
       flyTo(assetId)                 frame the asset. No-op + warn if unknown.
       resetView()                    home camera.
       cameraMoved() → bool           D71 (optional): camera differs from home —
                                      drives the Reset button's live state.
       focusAt({x, y, scale})         D69: frame the spot under a double-click
                                      (container px). Engines that can isolate
                                      (capabilities.isolate) also isolate the
                                      picked element; the static adapter frames.
       saveViewpoint()                → {id} persistable token.
       loadViewpoint(id)
       onCameraChange(cb)             cb() after any camera movement — the
                                      shell re-projects its marker layer here.

     appearance
       setStyle(mode, tone)           mode: 'photo'|'minimal'|'bw'|'xray';
                                      tone (xray only): 'gray'|'bluegray'|'dot'|'sepia'.
       setAssetColor(assetId, colorOrNull)   per-asset alarm colouring; null clears one.
       clearAssetColors()

     structure
       isolateLevel(levelId)          show one level; levelId from site data.
       showAllLevels()
       setLayerVisibility(layerId, visible)  discipline layers (arch/elec/…).

     section & slice
       setSectionPlane({axis:'x'|'y'|'z', position:0..1, enabled:true})
       clearSection()
       onSectionHandle(cb)            cb({screenX, screenY}) — where the shell
                                      should draw its drag handle.

     measure
       startMeasure(mode)             'point'|'area'.
       cancelMeasure()
       onMeasureResult(cb)            cb({value, unit, points:[{x,y,z}…]}) —
                                      the SHELL renders the readout.

     selection & markers
       highlightAsset(id) / clearHighlight()
       setMarkers(list)               [{id, assetId, world:{…}}] — anchor set.
       worldToScreen(point) → {x, y, visible}   px in container space.
       screenToWorld({x, y}) → point|null
       onAssetClick(cb)               cb(assetId) — engine picking.
       onMarkerClick(cb)              cb(markerId).

     capabilities  (see below)
     -------------------------------------------------------------------------- */

  /* Every adapter MUST expose this shape. The dock reads it and renders
     unsupported tools disabled with the i18n tooltip 'capNotSupported' —
     never a broken control, never a hidden feature. */
  const CAPABILITY_KEYS = ['style','sectionPlane','measure','levels','layers','viewpoints','picking','isolate','orbit'];

  const registry = {};

  function register(name, factory){ registry[name] = factory; }

  /* One config line per site picks the adapter: data.viewer.engine. */
  function create(name){
    const f = registry[name];
    if(!f) throw new Error('EKO_VIEWER: no adapter registered as "' + name + '"');
    const a = f();
    /* Contract check: fail loudly at boot, not mid-demo. */
    const missing = CAPABILITY_KEYS.filter(k => !(k in (a.capabilities || {})));
    if(missing.length) throw new Error('EKO_VIEWER: adapter "' + name + '" missing capability flags: ' + missing.join(', '));
    ['init','destroy','flyTo','resetView','setStyle','setMarkers','worldToScreen'].forEach(m => {
      if(typeof a[m] !== 'function') throw new Error('EKO_VIEWER: adapter "' + name + '" missing ' + m + '()');
    });
    return a;
  }

  return { register, create, CAPABILITY_KEYS };
})();
