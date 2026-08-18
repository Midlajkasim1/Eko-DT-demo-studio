import { Map as MaplibreMap, Marker, setWorkerUrl } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { boundsCenter, minZoomToCover, quadContains, quadUnion } from '@/lib/geo'
import { childrenOf, findLocation, overlaysForLevel } from '@/lib/mapConfig'
import type { AssetHandle, AssetResolver } from '@/lib/mapAssets'
import type { GeoQuad, MapCamera, MapConfig, MapLocation, MapOverlay } from '@/types'
import type { ImageSource, RasterLayerSpecification, StyleSpecification } from 'maplibre-gl'

setWorkerUrl(workerUrl)

const VOID_COLOR = '#0d1320'
const TRANSPARENT_PX =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

/** Lifts blacks per source so deep water reads teal rather than near-black */
const RASTER_GRADE = {
  'raster-brightness-min': 0.18,
  'raster-brightness-max': 1,
  'raster-contrast': -0.06,
  'raster-saturation': 0.12,
} as const

const DEFAULT_MIN_ZOOM = 1
const DEFAULT_MAX_ZOOM = 18.4
const DEFAULT_MAX_PITCH = 70

const OVERVIEW_DURATION = 1200
const FOCUS_DURATION = 1600
const LEVEL_DURATION = 1200
const ZOOM_STEP = 0.8
const ZOOM_DURATION = 280

/** Entering a level unmounts the pin that was clicked, so the double click has to be ruled out
 *  before that happens or it can never land. Comfortably inside a system double-click interval. */
const DOUBLE_CLICK_GRACE = 280

const overlayId = (overlay: MapOverlay) => `overlay-${overlay.id}`
const BASEMAP_SOURCE = 'basemap'

/** MapLibre throws on unsorted stops, so a fadeOut that starts before fadeIn ends is merged */
function opacityExpression(overlay: MapOverlay): unknown {
  const stops: [number, number][] = []
  if (overlay.fadeIn) stops.push([overlay.fadeIn[0], 0], [overlay.fadeIn[1], 1])
  if (overlay.fadeOut) stops.push([overlay.fadeOut[0], 1], [overlay.fadeOut[1], 0])
  if (!stops.length) return overlay.opacity ?? 1

  stops.sort((a, b) => a[0] - b[0])
  const flat: number[] = []
  for (const [zoom, value] of stops) {
    if (flat.length && flat[flat.length - 2] >= zoom) flat[flat.length - 1] = value
    else flat.push(zoom, value)
  }
  if (flat.length < 4) return overlay.opacity ?? 1
  return ['interpolate', ['linear'], ['zoom'], ...flat]
}

function overlayLayer(overlay: MapOverlay): RasterLayerSpecification {
  return {
    id: overlayId(overlay),
    type: 'raster',
    source: overlayId(overlay),
    paint: {
      'raster-opacity': opacityExpression(overlay) as never,
      'raster-fade-duration': 300,
      'raster-resampling': 'linear',
    },
  }
}

export function buildStyle(config: MapConfig): StyleSpecification {
  const sources: StyleSpecification['sources'] = {}
  const layers: StyleSpecification['layers'] = [
    { id: 'void', type: 'background', paint: { 'background-color': VOID_COLOR } },
  ]

  const basemap = config.basemap
  if (basemap.kind === 'image') {
    sources[BASEMAP_SOURCE] = { type: 'image', url: TRANSPARENT_PX, coordinates: basemap.coordinates }
    layers.push({ id: BASEMAP_SOURCE, type: 'raster', source: BASEMAP_SOURCE, paint: { ...RASTER_GRADE } })
  } else if (basemap.kind === 'xyz') {
    sources[BASEMAP_SOURCE] = {
      type: 'raster',
      tiles: [basemap.template],
      tileSize: basemap.tileSize ?? 256,
      maxzoom: basemap.maxzoom ?? 19,
      attribution: basemap.attribution,
    }
    layers.push({ id: BASEMAP_SOURCE, type: 'raster', source: BASEMAP_SOURCE, paint: { ...RASTER_GRADE } })
  }

  // No `sprite` and no `glyphs`: nothing here is a symbol layer, so the map issues
  // no request beyond its own sources — which is what makes it work offline.
  return { version: 8, sources, layers }
}

export interface MapEngineState {
  ready: boolean
  bearing: number
  pitch: number
  zoom: number
  center: [number, number]
}

export interface MapEngineOptions {
  config: MapConfig
  resolveAsset: AssetResolver
  levelId: string | null
  reducedMotion?: boolean
  /** A click: show this location */
  onSelectLocation?: (location: MapLocation) => void
  /** A click no second click followed: go into this location */
  onEnterLocation?: (location: MapLocation) => void
  /** A double click: open this location */
  onOpenLocation?: (location: MapLocation) => void
  onMapClick?: (lngLat: [number, number]) => void
  onLocationMoved?: (id: string, lngLat: [number, number]) => void
}

export interface MapEngine {
  readonly map: MaplibreMap
  setConfig(next: MapConfig): Promise<void>
  setLevel(levelId: string | null): void
  setSelected(id: string | null): void
  setDraggable(draggable: boolean): void
  flyToLocation(id: string): void
  flyToOverview(): void
  playIntro(): void
  zoomBy(delta: number): void
  resetBearing(): void
  getState(): MapEngineState
  subscribe(listener: (state: MapEngineState) => void): () => void
  resize(): void
  dispose(): void
}

interface MarkerEntry {
  marker: Marker
  root: HTMLDivElement
  body: HTMLElement
  spec: MapLocation
}

const Z_TIER: Record<string, number> = { pin: 5, place: 2, road: 2 }

export function createMapEngine(container: HTMLDivElement, options: MapEngineOptions): MapEngine {
  let config = options.config
  let levelId = options.levelId
  let selectedId: string | null = null
  let draggable = false
  let styleReady = false

  const teardown: (() => void)[] = []
  const listeners = new Set<(state: MapEngineState) => void>()
  const held = new Map<string, AssetHandle>()
  const markers = new Map<string, MarkerEntry>()
  let settleTimer = 0
  teardown.push(() => clearTimeout(settleTimer))

  const reduced = options.reducedMotion ??
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const duration = (ms: number) => (reduced ? 0 : ms)

  /** Inside a level, and under an image basemap, the imagery is one fixed rectangle: any bearing
   *  or pitch swings the viewport off it and exposes the void behind. */
  const flat = () =>
    levelId !== null || config.basemap.kind === 'void' || config.basemap.kind === 'image'

  const tiled = () =>
    levelId === null && (config.basemap.kind === 'xyz' || config.basemap.kind === 'pack')

  const map = new MaplibreMap({
    container,
    style: buildStyle(config),
    center: config.camera.center,
    zoom: config.camera.zoom,
    bearing: flat() ? 0 : config.camera.bearing ?? 0,
    pitch: flat() ? 0 : config.camera.pitch ?? 0,
    minZoom: config.minZoom ?? DEFAULT_MIN_ZOOM,
    maxZoom: config.maxZoom ?? DEFAULT_MAX_ZOOM,
    maxPitch: flat() ? 0 : config.maxPitch ?? DEFAULT_MAX_PITCH,
    renderWorldCopies: false,
    attributionControl: false,
    fadeDuration: reduced ? 0 : 200,
  })

  const on = (type: string, handler: never, layer?: string) => {
    if (layer) {
      map.on(type as never, layer, handler)
      teardown.push(() => map.off(type as never, layer, handler))
    } else {
      map.on(type as never, handler)
      teardown.push(() => map.off(type as never, handler))
    }
  }

  function applyInteractions() {
    if (flat()) {
      map.dragRotate.disable()
      map.touchPitch.disable()
      map.keyboard.disableRotation()
      map.setMaxPitch(0)
      if (map.getBearing() !== 0) map.jumpTo({ bearing: 0 })
      return
    }
    map.dragRotate.enable()
    map.touchPitch.enable()
    map.keyboard.enableRotation()
    map.setMaxPitch(config.maxPitch ?? DEFAULT_MAX_PITCH)
  }

  applyInteractions()

  /* ── Camera state, coalesced into one frame and quantised so idle costs nothing ── */

  let state: MapEngineState = {
    ready: false,
    bearing: map.getBearing(),
    pitch: map.getPitch(),
    zoom: map.getZoom(),
    center: config.camera.center,
  }
  let frame = 0

  const flush = () => {
    frame = 0
    const center = map.getCenter()
    const next: MapEngineState = {
      ready: state.ready,
      bearing: Math.round(map.getBearing() * 4) / 4,
      pitch: Math.round(map.getPitch() * 4) / 4,
      zoom: Math.round(map.getZoom() * 100) / 100,
      center: [center.lng, center.lat],
    }
    if (
      next.ready === state.ready && next.bearing === state.bearing && next.pitch === state.pitch &&
      next.zoom === state.zoom && next.center[0] === state.center[0] && next.center[1] === state.center[1]
    ) return
    state = next
    for (const listener of listeners) listener(state)
  }

  const mark = () => { if (!frame) frame = requestAnimationFrame(flush) }
  on('move', mark as never)
  on('moveend', mark as never)
  teardown.push(() => { if (frame) cancelAnimationFrame(frame) })

  /* ── Sizing: the sidebar and focus mode resize the container without a window event ── */

  let resizeFrame = 0
  const observer = new ResizeObserver(() => {
    if (resizeFrame) return
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0
      map.resize()
      if (styleReady) applyLimits()
    })
  })
  observer.observe(container)
  teardown.push(() => {
    observer.disconnect()
    if (resizeFrame) cancelAnimationFrame(resizeFrame)
  })

  /* ── Bounds, so the empty void is unreachable rather than merely unattractive ── */

  /** Only imagery constrains the camera. Pins alone must not, or a project with two pins and
   *  no renders would be locked into the degenerate box between them. */
  function imageryQuads(): GeoQuad[] {
    const quads = overlaysForLevel(config, levelId).map(o => o.coordinates)
    if (levelId === null && config.basemap.kind === 'image') quads.push(config.basemap.coordinates)
    return quads
  }

  function applyLimits() {
    const defaultMaxZoom = levelId === null ? 12 : DEFAULT_MAX_ZOOM
    const ceiling = config.maxZoom ?? defaultMaxZoom
    const floor = config.minZoom ?? DEFAULT_MIN_ZOOM

    // Tiles cover the world, so there is nothing to pull back from and nothing to pan off
    const bounds = tiled() ? null : quadUnion(imageryQuads())
    map.setMaxBounds(bounds as never)

    const cover = bounds
      ? minZoomToCover(bounds, container.clientWidth || 1, container.clientHeight || 1)
      : floor

    // widen before narrowing — MapLibre rejects a max that sits below the current min
    map.setMinZoom(0)
    map.setMaxZoom(ceiling)
    map.setMinZoom(Math.min(Math.max(floor, cover), ceiling))
  }

  /* ── Image sources: filled after creation so the studio can hand over a decoded bitmap ── */

  async function fillImage(sourceId: string, hash: string) {
    const previous = held.get(sourceId)
    let handle: AssetHandle | null
    try {
      handle = await options.resolveAsset(hash)
    } catch {
      return
    }
    if (!handle) return
    const source = map.getSource(sourceId) as ImageSource | undefined
    if (!source) {
      if ('release' in handle) handle.release()
      return
    }
    if ('image' in handle) source.updateImage({ image: handle.image })
    else source.updateImage({ url: handle.url })

    held.set(sourceId, handle)
    if (previous && 'release' in previous) previous.release()
  }

  function releaseAll() {
    for (const handle of held.values()) if ('release' in handle) handle.release()
    held.clear()
  }

  const sameQuad = (a: GeoQuad, b: GeoQuad) =>
    a.every((corner, i) => corner[0] === b[i][0] && corner[1] === b[i][1])

  const sameFade = (a: MapOverlay, b: MapOverlay) =>
    JSON.stringify([a.fadeIn, a.fadeOut, a.opacity]) === JSON.stringify([b.fadeIn, b.fadeOut, b.opacity])

  let visibleOverlays: MapOverlay[] = []

  async function syncOverlays() {
    const next = overlaysForLevel(config, levelId)
    const nextById = new Map(next.map(o => [overlayId(o), o]))
    const previousById = new Map(visibleOverlays.map(o => [overlayId(o), o]))

    for (const id of previousById.keys()) {
      if (nextById.has(id)) continue
      if (map.getLayer(id)) map.removeLayer(id)
      if (map.getSource(id)) map.removeSource(id)
      const handle = held.get(id)
      if (handle && 'release' in handle) handle.release()
      held.delete(id)
    }

    for (const [id, overlay] of nextById) {
      const mounted = !!map.getSource(id)
      if (!mounted) {
        map.addSource(id, { type: 'image', url: TRANSPARENT_PX, coordinates: overlay.coordinates })
      }
      if (!map.getLayer(id)) map.addLayer(overlayLayer(overlay))

      const previous = previousById.get(id)
      if (!previous || !mounted) {
        await fillImage(id, overlay.hash)
        continue
      }

      if (!sameQuad(previous.coordinates, overlay.coordinates)) {
        ;(map.getSource(id) as ImageSource).setCoordinates(overlay.coordinates as never)
      }
      // held is only set on a successful upload, so a source that never got its texture retries
      if (previous.hash !== overlay.hash || !held.has(id)) await fillImage(id, overlay.hash)
      if (!sameFade(previous, overlay)) {
        map.setPaintProperty(id, 'raster-opacity', opacityExpression(overlay) as never)
      }
    }

    // Config order is draw order, so an author can stack a detail render over a wider one
    const ordered = [...nextById.keys()].filter(id => map.getLayer(id))
    for (let i = ordered.length - 2; i >= 0; i--) map.moveLayer(ordered[i], ordered[i + 1])

    visibleOverlays = next
  }

  async function hydrateBasemap() {
    if (config.basemap.kind !== 'image') return
    await fillImage(BASEMAP_SOURCE, config.basemap.hash)
  }

  /** A level is a framed view of its own render, so the basemap under it would only show
   *  through at the edges */
  function syncBasemapVisibility() {
    if (!map.getLayer(BASEMAP_SOURCE)) return
    map.setLayoutProperty(BASEMAP_SOURCE, 'visibility', levelId === null ? 'visible' : 'none')
  }

  /* ── Markers: diffed by id, with every visual transform on an inner element because
        MapLibre rewrites the root's transform on every frame ── */

  function createMarkerElement(spec: MapLocation, interactive: boolean) {
    const root = document.createElement('div')
    root.className = 'map-marker'
    root.style.zIndex = String(Z_TIER[spec.kind ?? 'pin'] ?? 5)

    const body = document.createElement(interactive ? 'button' : 'div')
    if (body instanceof HTMLButtonElement) body.type = 'button'
    root.appendChild(body)
    return { root, body }
  }

  function paintMarker(entry: MarkerEntry, spec: MapLocation) {
    const kind = spec.kind ?? 'pin'
    const { body, root } = entry
    body.className = `map-marker-body map-marker-body--${kind}`
    body.style.setProperty('--marker-rotate', `${spec.rotation ?? 0}deg`)
    root.style.zIndex = String(Z_TIER[kind] ?? 5)

    if (kind === 'pin') {
      const children = childrenOf(config.locations, spec.id).length
      const models = spec.modelIds?.length ?? 0
      const count = children || models
      body.innerHTML =
        '<span class="map-marker-dot"></span><span class="map-marker-text"></span><span class="map-marker-count"></span>'
      body.querySelector('.map-marker-text')!.textContent = spec.name
      body.querySelector('.map-marker-count')!.textContent = count ? String(count) : ''
      if (spec.color) body.style.setProperty('--marker-accent', spec.color)
      body.setAttribute(
        'aria-label',
        children ? `${spec.name}, ${count} location${count === 1 ? '' : 's'}`
                 : `${spec.name}, ${count} model${count === 1 ? '' : 's'}`
      )
      const inert = !children && !models
      body.toggleAttribute('aria-disabled', inert)
      body.classList.toggle('map-marker-body--inert', inert)
    } else {
      body.textContent = spec.name
      body.removeAttribute('aria-label')
    }
  }

  function paintSelection() {
    for (const [id, entry] of markers) {
      entry.root.classList.toggle('map-marker-selected', id === selectedId)
    }
  }

  function syncMarkers() {
    const next = childrenOf(config.locations, levelId)
    const seen = new Set<string>()

    for (const spec of next) {
      seen.add(spec.id)
      const existing = markers.get(spec.id)
      if (existing) {
        if (existing.spec.position[0] !== spec.position[0] || existing.spec.position[1] !== spec.position[1]) {
          existing.marker.setLngLat(spec.position)
        }
        existing.spec = spec
        paintMarker(existing, spec)
        existing.marker.setDraggable(draggable && (spec.kind ?? 'pin') === 'pin')
        continue
      }

      const interactive = (spec.kind ?? 'pin') === 'pin'
      const { root, body } = createMarkerElement(spec, interactive)
      const marker = new Marker({ element: root, anchor: 'center', draggable: draggable && interactive })
        .setLngLat(spec.position)
        .addTo(map)
      const entry: MarkerEntry = { marker, root, body, spec }
      paintMarker(entry, spec)

      if (interactive) {
        body.addEventListener('click', event => {
          event.stopPropagation()
          // Read the live spec so a rename or re-point never fires a stale payload
          const current = markers.get(spec.id)?.spec
          if (!current) return
          options.onSelectLocation?.(current)
          clearTimeout(settleTimer)
          settleTimer = window.setTimeout(
            () => options.onEnterLocation?.(current),
            DOUBLE_CLICK_GRACE
          )
        })
        body.addEventListener('dblclick', event => {
          event.stopPropagation()
          clearTimeout(settleTimer)
          const current = markers.get(spec.id)?.spec
          if (current) options.onOpenLocation?.(current)
        })
        body.id = `map-pin-${spec.id}`
        marker.on('dragend', () => {
          const { lng, lat } = marker.getLngLat()
          options.onLocationMoved?.(spec.id, [lng, lat])
        })
      }
      markers.set(spec.id, entry)
    }

    for (const [id, entry] of markers) {
      if (seen.has(id)) continue
      entry.marker.remove()
      markers.delete(id)
    }

    paintSelection()
  }

  /* ── Camera ── */

  function flyToCamera(camera: MapCamera, ms: number) {
    map.flyTo({
      center: camera.center,
      zoom: camera.zoom,
      bearing: flat() ? 0 : camera.bearing ?? 0,
      pitch: flat() ? 0 : camera.pitch ?? 0,
      duration: duration(ms),
    })
  }

  /** The one place a level change moves the camera. Framing anywhere else races the limits
   *  applied alongside it, and the map visibly snaps back mid-flight. */
  function frameLevel(ms: number) {
    const level = findLocation(config.locations, levelId)
    if (level?.view) return flyToCamera(level.view, ms)
    if (!level) return flyToCamera(config.camera, ms)

    // getMinZoom is the zoom at which this level's imagery exactly covers the viewport
    const bounds = quadUnion(imageryQuads())
    if (bounds) return flyToCamera({ center: boundsCenter(bounds), zoom: map.getMinZoom() }, ms)
    flyToCamera({ center: level.position, zoom: map.getZoom() }, ms)
  }

  function flyToLocation(id: string) {
    const location = findLocation(config.locations, id)
    if (!location) return
    if (location.view) return flyToCamera(location.view, FOCUS_DURATION)

    // Flat renders look wrong under tilt, so pitch drops where one covers the pin
    const covered = overlaysForLevel(config, levelId)
      .some(o => quadContains(o.coordinates, ...location.position))
    map.flyTo({
      center: location.position,
      zoom: covered ? 13.8 : 13.2,
      pitch: flat() ? 0 : covered ? 30 : 58,
      bearing: flat() ? 0 : config.camera.bearing ?? 0,
      duration: duration(FOCUS_DURATION),
    })
  }

  function playIntro() {
    const intro = config.intro
    if (!intro?.enabled || reduced) return
    const bearing = flat() ? 0 : config.camera.bearing ?? 0
    map.jumpTo({
      center: config.camera.center,
      zoom: config.camera.zoom - intro.pullBack,
      bearing: bearing + (flat() ? 0 : intro.bearingOffset),
      pitch: 0,
    })
    map.once('idle', () => {
      map.flyTo({
        center: config.camera.center,
        zoom: config.camera.zoom,
        bearing,
        pitch: flat() ? 0 : config.camera.pitch ?? 0,
        duration: intro.duration,
        curve: 1.15,
      })
    })
  }

  /* ── Lifecycle: every style edit is serialised. Overlay sync awaits its textures, and two
        overlapping runs read the same "what is mounted" snapshot and unmount each other. ── */

  let queue: Promise<void> = Promise.resolve()

  function enqueue(task: () => Promise<void> | void): Promise<void> {
    queue = queue
      .then(() => (styleReady ? task() : undefined))
      .catch((error: unknown) => { console.error('[map] style update failed', error) })
    return queue
  }

  /** Resolves on the rebuilt style, or at once if the engine is disposed while waiting */
  function nextStyleData() {
    return new Promise<void>(resolve => {
      const done = () => resolve()
      map.once('styledata', done)
      teardown.push(done)
    })
  }

  map.once('load', () => {
    styleReady = true
    void enqueue(async () => {
      await hydrateBasemap()
      await syncOverlays()
      syncMarkers()
      syncBasemapVisibility()
      applyLimits()
      state = { ...state, ready: true }
      for (const listener of listeners) listener(state)
    })
    playIntro()
  })

  on('click', ((event: { lngLat: { lng: number; lat: number } }) => {
    options.onMapClick?.([event.lngLat.lng, event.lngLat.lat])
  }) as never)

  return {
    map,

    setConfig(next: MapConfig) {
      const basemapChanged = JSON.stringify(next.basemap) !== JSON.stringify(config.basemap)
      config = next
      return enqueue(async () => {
        if (basemapChanged) {
          releaseAll()
          visibleOverlays = []
          map.setStyle(buildStyle(config))
          await nextStyleData()
          if (!styleReady) return
        }
        applyInteractions()
        await hydrateBasemap()
        await syncOverlays()
        syncMarkers()
        syncBasemapVisibility()
        applyLimits()
      })
    },

    setLevel(next: string | null) {
      if (next === levelId) return
      levelId = next
      void enqueue(async () => {
        applyInteractions()
        await syncOverlays()
        syncMarkers()
        syncBasemapVisibility()
        applyLimits()
        frameLevel(LEVEL_DURATION)
      })
    },

    setSelected(id: string | null) {
      if (id === selectedId) return
      selectedId = id
      paintSelection()
    },

    setDraggable(next: boolean) {
      draggable = next
      for (const entry of markers.values()) {
        entry.marker.setDraggable(next && (entry.spec.kind ?? 'pin') === 'pin')
      }
    },

    flyToLocation,
    flyToOverview: () => frameLevel(OVERVIEW_DURATION),
    playIntro,

    zoomBy(delta: number) {
      const target = Math.min(map.getMaxZoom(), Math.max(map.getMinZoom(), map.getZoom() + delta * ZOOM_STEP))
      if (Math.abs(target - map.getZoom()) < 1e-3) return
      map.zoomTo(target, { duration: duration(ZOOM_DURATION) })
    },

    resetBearing: () => map.easeTo({ bearing: 0, pitch: 0, duration: duration(400) }),

    getState: () => state,

    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    resize: () => map.resize(),

    dispose() {
      styleReady = false
      for (const fn of teardown.splice(0)) fn()
      for (const entry of markers.values()) entry.marker.remove()
      markers.clear()
      listeners.clear()
      // remove() aborts in-flight image requests, so the bitmaps are only safe to close after
      map.remove()
      releaseAll()
    },
  }
}
