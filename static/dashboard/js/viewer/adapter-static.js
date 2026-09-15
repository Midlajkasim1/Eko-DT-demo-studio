/* ============================================================================
   Static-image adapter — renders the mockup scene exactly the way the
   approved reference does: a stack of full-bleed viewport renders at
   inset:-7% (photo base; minimal and x-ray cross-fade above it via opacity),
   a dot-tone overlay, and pan/zoom as a CSS transform with the reference's
   clamp maths. Declares only what it can honestly do: styles are real
   images, picking/markers/flyTo are real; levels, layers, section and
   measure are NOT fakeable on a flat image, so their flags are false and
   the dock disables those tools with a tooltip.
   ============================================================================ */
(function(){
  'use strict';

  window.EKO_VIEWER.register('static', function(){
    let host = null, v3d = null, sceneRef = null;
    let markers = [];                       // [{id, assetId, world:{x,y}}] — % of the scene IMAGE
    let nat = null;                         // natural size of the scene render
    const vw = { x: 0, y: 0, s: 1 };        // pan/zoom state (reference vw)
    const cbs = { ready: [], error: [], camera: [], assetClick: [], markerClick: [], measure: [], section: [] };
    const fire = (k, arg) => cbs[k].forEach(f => f(arg));
    let vpSeq = 0; const viewpoints = {};

    /* World anchors are % of the scene IMAGE, not of the host box: the
       stack draws at inset:-7% with background-size:cover, so the part of
       the picture behind a given host-% shifts with the window's aspect
       ratio. Anchoring to the image keeps markers glued to the same
       building feature at every window shape. dims() returns the drawn
       image size in host pixels (image and box share the host's centre). */
    function dims(){
      const r = host.getBoundingClientRect();
      if(!nat) return { W: r.width, H: r.height, r };
      const k = Math.max(r.width * 1.14 / nat.w, r.height * 1.14 / nat.h);
      return { W: nat.w * k, H: nat.h * k, r };
    }

    /* Reference clamp: slack lets the edge peek 5.5% past centre. */
    function apply(smooth){
      if(!host || !v3d) return;
      const r = host.getBoundingClientRect();
      const slack = Math.min(90, r.width * 0.055);
      const mx = (vw.s - 1) * r.width / 2 + slack, my = (vw.s - 1) * r.height / 2 + slack;
      vw.x = Math.max(-mx, Math.min(mx, vw.x));
      vw.y = Math.max(-my, Math.min(my, vw.y));
      v3d.style.transition = smooth ? 'transform .3s ease' : 'none';
      v3d.style.transform = 'translate(' + vw.x.toFixed(1) + 'px,' + vw.y.toFixed(1) + 'px) scale(' + vw.s.toFixed(3) + ')';
      fire('camera');
    }

    return {
      capabilities: {
        style: true,          /* four real renders + tone overlay            */
        sectionPlane: false,  /* cannot cut a flat image                     */
        measure: false,       /* no geometry to measure                      */
        levels: false,        /* cannot isolate a storey in a still         */
        layers: false,        /* no discipline geometry                      */
        viewpoints: true,     /* honest: camera = {x,y,s}, restorable        */
        picking: true,        /* markers carry the interaction               */
        isolate: false,       /* a flat render has no element to isolate     */
        orbit: false          /* no camera to orbit: the drag pans instead   */
      },

      init(container, ref){
        host = container; sceneRef = ref;
        /* Layer stack copied from the reference (.v3d / .v3dot / tint). */
        host.innerHTML =
          '<div class="v3d" aria-hidden="true" style="background-image:url(\'' + ref.images.photo + '\')">' +
            '<div class="v3dl" data-sty="bw"      style="background-image:url(\'' + ref.images.photo + '\')"></div>' +
            '<div class="v3dl" data-sty="minimal" style="background-image:url(\'' + ref.images.minimal + '\')"></div>' +
            '<div class="v3dl" data-sty="xray"    style="background-image:url(\'' + ref.images.xray + '\')"></div>' +
          '</div>' +
          '<div class="v3dot" aria-hidden="true"></div>' +
          '<div class="v3tint" aria-hidden="true"></div>';
        v3d = host.querySelector('.v3d');
        /* Natural size drives the cover-fit maths in dims(); until it is
           known, projection falls back to host-% and self-corrects here. */
        const probe = new Image();
        probe.onload = () => { nat = { w: probe.naturalWidth, h: probe.naturalHeight }; if(host) apply(false); };
        probe.src = ref.images.photo;
        /* Input belongs to the engine surface: drag pans, wheel zooms at the
           cursor (reference zoomAt maths, scale clamped 1–2.6). */
        if(!host._ekoInput){
          host._ekoInput = true;
          /* Direct manipulation, no tool armed (D69): one pointer (any
             button, so right-drag too) pans; two pointers pan by their
             midpoint and pinch-zoom by their distance; the wheel zooms at
             the cursor. Orbit is impossible on a flat render
             (capabilities.orbit:false) — the drag pans, the honest stand-in. */
          const IGN = '.mk,.mkpop,#vbar,.mzfly,.vradial,.vsheet,.scrim,.vfab,.scrubbar,.minimap';
          const pts = new Map();
          let mid = null, dist = 0;
          const zoomAt = (cx, cy, k0) => {
            const r = host.getBoundingClientRect();
            const s0 = vw.s, s1 = Math.max(1, Math.min(2.6, s0 * k0));
            if(s1 === s0) return false;
            const k = s1 / s0;
            const px = cx - (r.left + r.width / 2), py = cy - (r.top + r.height / 2);
            vw.x = px - (px - vw.x) * k; vw.y = py - (py - vw.y) * k; vw.s = s1;
            return true;
          };
          const geom = () => { const [a, b] = [...pts.values()];
            return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) }; };
          host.addEventListener('pointerdown', e => {
            if(e.target.closest(IGN)) return;
            pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
            try{ host.setPointerCapture(e.pointerId) }catch(err){}
            if(pts.size === 2){ const g = geom(); mid = { x: g.x, y: g.y }; dist = g.d; }
          });
          host.addEventListener('pointermove', e => {
            const p = pts.get(e.pointerId);
            if(!p) return;
            if(pts.size === 1){
              vw.x += e.clientX - p.x; vw.y += e.clientY - p.y;
              p.x = e.clientX; p.y = e.clientY;
              apply(false);
            } else {
              p.x = e.clientX; p.y = e.clientY;
              const g = geom();
              if(mid){ vw.x += g.x - mid.x; vw.y += g.y - mid.y; }
              if(dist > 0 && g.d > 0) zoomAt(g.x, g.y, g.d / dist);
              mid = { x: g.x, y: g.y }; dist = g.d;
              apply(false);
            }
          });
          const lift = e => { pts.delete(e.pointerId); mid = null; dist = 0; };
          host.addEventListener('pointerup', lift);
          host.addEventListener('pointercancel', lift);
          host.addEventListener('wheel', e => {
            e.preventDefault();
            if(zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.12 : 0.89)) apply(false);
          }, { passive: false });
        }
        apply(false);
        fire('ready');
      },
      destroy(){ if(host) host.innerHTML = ''; host = v3d = null; },
      onReady(cb){ cbs.ready.push(cb); },
      onError(cb){ cbs.error.push(cb); },

      /* ------------------------------- camera ----------------------------- */
      flyTo(assetId){
        const m = markers.find(x => x.assetId === assetId);
        if(!m){ console.warn('static adapter: flyTo unknown asset', assetId); return; }
        if(!host) return;
        const d = dims(), sN = 1.7;
        vw.s = sN;
        vw.x = -(m.world.x / 100 - 0.5) * d.W * sN;
        vw.y = -(m.world.y / 100 - 0.5) * d.H * sN;
        apply(true);
      },
      resetView(){ vw.x = 0; vw.y = 0; vw.s = 1; apply(true); },
      cameraMoved(){ return Math.abs(vw.x) > 0.5 || Math.abs(vw.y) > 0.5 || Math.abs(vw.s - 1) > 0.001; },   /* D71 */
      /* Frame the spot under a double-click / double-tap (D69). A flat
         render cannot isolate an element (capabilities.isolate:false), so
         this frames: zoom to p.scale centred on the point, animated. */
      focusAt(p){
        if(!host) return;
        const d = dims(), r = d.r, s0 = vw.s, sN = p.scale || 1.7;
        const wx = (p.x - vw.x - r.width / 2) / (d.W * s0) + 0.5;
        const wy = (p.y - vw.y - r.height / 2) / (d.H * s0) + 0.5;
        vw.s = sN; vw.x = -(wx - 0.5) * d.W * sN; vw.y = -(wy - 0.5) * d.H * sN;
        apply(true);
      },
      saveViewpoint(){ const id = 'vp' + (++vpSeq); viewpoints[id] = { ...vw }; return { id }; },
      loadViewpoint(id){ const v = viewpoints[id]; if(v){ Object.assign(vw, v); apply(true); } },
      onCameraChange(cb){ cbs.camera.push(cb); },

      /* ----------------------------- appearance --------------------------- */
      /* Reference behaviour: layers cross-fade by opacity; 'bw' greys the
         photo; x-ray 'dot' shows the dot-tone overlay (the reference applies
         no filter for gray/bluegray/sepia — swatch only). */
      setStyle(mode, tone){
        if(!host) return;
        host.setAttribute('data-vst', mode === 'xray' ? ('xray-' + (tone || 'gray')) : mode);
        host.querySelectorAll('.v3dl').forEach(l =>
          l.style.opacity = l.dataset.sty === mode ? '1' : '0');
      },
      setAssetColor(){ /* colour rides on the shell's marker layer here — a
                          flat render has no per-asset geometry to tint */ },
      clearAssetColors(){},

      /* ----------------------------- structure ---------------------------- */
      isolateLevel(){ console.warn('static adapter: levels not supported'); },
      showAllLevels(){},
      setLayerVisibility(){ console.warn('static adapter: layers not supported'); },

      /* --------------------------- section & slice ------------------------ */
      setSectionPlane(){ console.warn('static adapter: sectionPlane not supported'); },
      clearSection(){},
      onSectionHandle(cb){ cbs.section.push(cb); },

      /* ------------------------------ measure ----------------------------- */
      startMeasure(){ console.warn('static adapter: measure not supported'); },
      cancelMeasure(){},
      onMeasureResult(cb){ cbs.measure.push(cb); },

      /* ------------------------- selection & markers ----------------------- */
      highlightAsset(){ /* handled by marker pulse in the shell layer */ },
      clearHighlight(){},
      setMarkers(list){ markers = list || []; },
      /* Static "world" is {x, y} in percent OF THE SCENE IMAGE; project
         through the cover-fit and the current pan/zoom so markers track
         both the picture and the camera at any window aspect. */
      worldToScreen(p){
        if(!host) return { x: 0, y: 0, visible: false };
        const d = dims(), r = d.r;
        const x = (p.x / 100 - 0.5) * d.W * vw.s + r.width / 2 + vw.x;
        const y = (p.y / 100 - 0.5) * d.H * vw.s + r.height / 2 + vw.y;
        return { x, y, visible: x >= 0 && x <= r.width && y >= 0 && y <= r.height };
      },
      screenToWorld(p){
        if(!host) return null;
        const d = dims(), r = d.r;
        return { x: ((p.x - vw.x - r.width / 2) / (d.W * vw.s) + 0.5) * 100,
                 y: ((p.y - vw.y - r.height / 2) / (d.H * vw.s) + 0.5) * 100 };
      },
      onAssetClick(cb){ cbs.assetClick.push(cb); },
      onMarkerClick(cb){ cbs.markerClick.push(cb); },
      _fireMarkerClick(id){ fire('markerClick', id); }   /* shell marker layer relays */
    };
  });
})();
