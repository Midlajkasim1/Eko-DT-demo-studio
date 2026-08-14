import { useCallback, useRef, useState, useSyncExternalStore } from 'react'
import { useMapStore } from '@/store/useMapStore'
import { useProjectStore } from '@/store/useProjectStore'
import { gridForImage, gridPixelSize, gridToQuad, metersPerPixel } from '@/lib/geo'
import { newId } from '@/lib/mapConfig'
import { addOverlay, removeOverlay, updateOverlay } from '@/lib/mapDraft'
import type { MapEngine } from '@/lib/mapEngine'
import type { MapConfig, MapOverlay, ProjectMeta } from '@/types'

interface MapOverlayEditorProps {
  engine: MapEngine | null
  meta: ProjectMeta
  levelId: string | null
  patchDraft: (fn: (config: MapConfig) => MapConfig) => void
}

const MIN_Z = 10
const MAX_Z = 19

export function MapOverlayEditor({ engine, meta, levelId, patchDraft }: MapOverlayEditorProps) {
  const draft = useMapStore(s => s.draft)
  const selectedOverlayId = useMapStore(s => s.selectedOverlayId)
  const selectOverlay = useMapStore(s => s.selectOverlay)
  const addMapImage = useProjectStore(s => s.addMapImage)

  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The live caret on the zoom track follows the camera without re-rendering on every frame
  const zoom = useSyncExternalStore(
    useCallback((notify: () => void) => engine?.subscribe(notify) ?? (() => {}), [engine]),
    useCallback(() => engine?.getState().zoom ?? 13, [engine])
  )

  const overlays = (draft?.overlays ?? []).filter(o => (o.parentId ?? null) === levelId)
  const selected = overlays.find(o => o.id === selectedOverlayId) ?? null

  const handleFile = useCallback(async (file: File) => {
    if (!engine) return
    setBusy(true)
    setError(null)
    try {
      const asset = await addMapImage(file)
      if (!asset) throw new Error('Could not store the image in the project folder')

      const state = engine.getState()
      const width = asset.width ?? 1024
      const height = asset.height ?? 1024
      const grid = gridForImage(state.center, state.zoom, width, height)
      const overlay: MapOverlay = {
        id: newId('ovl'),
        hash: asset.hash,
        coordinates: gridToQuad(grid),
        grid,
        fadeIn: [Math.max(0, grid.z - 3.6), Math.max(0.1, grid.z - 3)],
        ...(levelId ? { parentId: levelId } : {}),
      }
      patchDraft(d => addOverlay(d, overlay))
      selectOverlay(overlay.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setBusy(false)
    }
  }, [engine, addMapImage, levelId, patchDraft, selectOverlay])

  const resnap = (overlay: MapOverlay, z: number) => {
    const asset = meta.mapAssets?.[overlay.hash]
    const centre = overlay.coordinates.reduce(
      (acc, [lon, lat]) => [acc[0] + lon / 4, acc[1] + lat / 4] as [number, number],
      [0, 0] as [number, number]
    )
    const grid = gridForImage(centre, z, asset?.width ?? 1024, asset?.height ?? 1024)
    patchDraft(d => updateOverlay(d, overlay.id, { grid, coordinates: gridToQuad(grid) }))
  }

  const setFade = (overlay: MapOverlay, key: 'fadeIn' | 'fadeOut', index: 0 | 1, value: number) => {
    const current = overlay[key] ?? [overlay.grid?.z ?? 13, (overlay.grid?.z ?? 13) + 0.6]
    const next: [number, number] = index === 0 ? [value, current[1]] : [current[0], value]
    patchDraft(d => updateOverlay(d, overlay.id, { [key]: next } as Partial<MapOverlay>))
  }

  const track = (from: number, to: number) => ({
    insetInlineStart: `${((Math.min(from, to) - MIN_Z) / (MAX_Z - MIN_Z)) * 100}%`,
    width: `${(Math.abs(to - from) / (MAX_Z - MIN_Z)) * 100}%`,
  })

  return (
    <>
      <div className="map-section-title">Renders ({overlays.length})</div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={e => {
          const file = e.target.files?.[0]
          if (file) void handleFile(file)
          e.target.value = ''
        }}
      />
      <button className="map-ghost-btn" onClick={() => fileRef.current?.click()} disabled={busy || !engine}>
        {busy ? 'Importing…' : '+ Add render here'}
      </button>
      {error && <p className="map-hint map-danger">{error}</p>}

      <div className="map-list">
        {overlays.map(overlay => {
          const asset = meta.mapAssets?.[overlay.hash]
          return (
            <div
              key={overlay.id}
              className={`map-list-row ${overlay.id === selectedOverlayId ? 'selected' : ''}`}
              onClick={() => selectOverlay(overlay.id === selectedOverlayId ? null : overlay.id)}
            >
              <span className="map-list-row-name">
                {overlay.grid ? `${overlay.grid.w}x${overlay.grid.h} @ z${overlay.grid.z}` : 'render'}
              </span>
              <span className="map-list-row-meta">
                {asset ? `${(asset.bytes / 1048576).toFixed(1)}MB` : 'missing'}
              </span>
            </div>
          )
        })}
        {!overlays.length && <p className="map-hint">No renders on this level.</p>}
      </div>

      {selected && (
        <>
          {selected.grid && (
            <p className="map-hint">
              {selected.grid.w}x{selected.grid.h} tiles @ z{selected.grid.z} ·{' '}
              {gridPixelSize(selected.grid)[0]}x{gridPixelSize(selected.grid)[1]} px native ·{' '}
              {metersPerPixel(selected.coordinates[0][1], selected.grid.z).toFixed(2)} m/px
              {meta.mapAssets?.[selected.hash] &&
                ` · supplied ${meta.mapAssets[selected.hash].width}x${meta.mapAssets[selected.hash].height}`}
            </p>
          )}

          <div className="map-field">
            <span className="map-label">Fit to tile grid</span>
            <div className="map-row">
              <button
                className="map-ghost-btn"
                onClick={() => resnap(selected, Math.max(MIN_Z, (selected.grid?.z ?? 13) - 1))}
              >
                − zoom
              </button>
              <button
                className="map-ghost-btn"
                onClick={() => resnap(selected, Math.min(MAX_Z, (selected.grid?.z ?? 13) + 1))}
              >
                + zoom
              </button>
            </div>
          </div>

          <div className="map-field">
            <span className="map-label">Visible zoom range</span>
            <div className="map-zoom-track">
              {selected.fadeIn && <div className="map-zoom-ramp" style={track(selected.fadeIn[0], selected.fadeIn[1])} />}
              {selected.fadeOut && <div className="map-zoom-ramp" style={track(selected.fadeOut[0], selected.fadeOut[1])} />}
              <div
                className="map-zoom-caret"
                style={{ insetInlineStart: `${((zoom - MIN_Z) / (MAX_Z - MIN_Z)) * 100}%` }}
              />
            </div>
            <div className="map-zoom-scale"><span>z{MIN_Z}</span><span>now z{zoom.toFixed(1)}</span><span>z{MAX_Z}</span></div>
          </div>

          <div className="map-row">
            <div className="map-field">
              <label className="map-label" htmlFor="ovl-in-a">Fade in from</label>
              <input
                id="ovl-in-a"
                className="map-input map-input-mono"
                type="number" step="0.1"
                value={selected.fadeIn?.[0] ?? ''}
                onChange={e => setFade(selected, 'fadeIn', 0, Number(e.target.value))}
              />
            </div>
            <div className="map-field">
              <label className="map-label" htmlFor="ovl-in-b">to</label>
              <input
                id="ovl-in-b"
                className="map-input map-input-mono"
                type="number" step="0.1"
                value={selected.fadeIn?.[1] ?? ''}
                onChange={e => setFade(selected, 'fadeIn', 1, Number(e.target.value))}
              />
            </div>
          </div>

          <label className="map-check">
            <input
              type="checkbox"
              checked={!!selected.fadeOut}
              onChange={e => patchDraft(d => updateOverlay(d, selected.id, {
                fadeOut: e.target.checked
                  ? [(selected.grid?.z ?? 13) + 2, (selected.grid?.z ?? 13) + 2.6]
                  : undefined,
              }))}
            />
            Fade out again when zooming past
          </label>

          {selected.fadeOut && (
            <div className="map-row">
              <div className="map-field">
                <label className="map-label" htmlFor="ovl-out-a">Fade out from</label>
                <input
                  id="ovl-out-a"
                  className="map-input map-input-mono"
                  type="number" step="0.1"
                  value={selected.fadeOut[0]}
                  onChange={e => setFade(selected, 'fadeOut', 0, Number(e.target.value))}
                />
              </div>
              <div className="map-field">
                <label className="map-label" htmlFor="ovl-out-b">to</label>
                <input
                  id="ovl-out-b"
                  className="map-input map-input-mono"
                  type="number" step="0.1"
                  value={selected.fadeOut[1]}
                  onChange={e => setFade(selected, 'fadeOut', 1, Number(e.target.value))}
                />
              </div>
            </div>
          )}

          <button
            className="map-ghost-btn"
            onClick={() => {
              patchDraft(d => removeOverlay(d, selected.id))
              selectOverlay(null)
            }}
          >
            Remove render
          </button>
        </>
      )}
    </>
  )
}
