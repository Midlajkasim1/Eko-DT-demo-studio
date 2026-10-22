import { useEffect, useRef } from 'react'
import { useLoadingProgressStore, sessionProgress } from '@/store/useLoadingProgressStore'
import type { ModelLoadProgress } from '@/store/useLoadingProgressStore'

function fmtMB(bytes: number) {
  return `${(bytes / 1048576).toFixed(1)} MB`
}

function fmtMs(ms?: number) {
  if (ms == null) return '—'
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`
}

function statusLabel(e: ModelLoadProgress, source: 'disk' | 'server' | null) {
  const readVerb = source === 'server' ? 'downloading' : 'reading'
  switch (e.phase) {
    case 'pending': return 'waiting'
    case 'reading': {
      const size = e.sizeBytes || 0
      return size ? `${readVerb} ${Math.min(100, Math.round((e.bytesRead / size) * 100))}%` : readVerb
    }
    case 'parsing':
      return e.parseProgress === undefined
        ? 'parsing…'
        : `parsing ${Math.min(100, Math.round(e.parseProgress * 100))}%`
    case 'done': return `done · ${fmtMs((e.readMs ?? 0) + (e.parseMs ?? 0))}`
    case 'error': return 'failed'
  }
}

export function ModelLoadingProgress() {
  const sessionActive = useLoadingProgressStore(s => s.sessionActive)
  const source = useLoadingProgressStore(s => s.source)
  const startedAt = useLoadingProgressStore(s => s.startedAt)
  const order = useLoadingProgressStore(s => s.order)
  const entries = useLoadingProgressStore(s => s.entries)
  const endSession = useLoadingProgressStore(s => s.endSession)

  const loggedRef = useRef(false)

  const models = order.map(id => entries[id]).filter(Boolean)
  const doneCount = models.filter(e => e.phase === 'done' || e.phase === 'error').length
  const allDone = models.length > 0 && doneCount === models.length
  const percent = allDone ? 100 : sessionProgress({ order, entries })

  useEffect(() => {
    if (!sessionActive) { loggedRef.current = false; return }
    if (!allDone || loggedRef.current) return
    loggedRef.current = true

    const totalMs = performance.now() - startedAt
    // console.groupCollapsed(`[ModelLoading] ${models.length} models in ${fmtMs(totalMs)} — timing breakdown`)
    console.table(models.map(e => ({
      model: e.name,
      size: fmtMB(e.sizeBytes || e.bytesRead),
      [source === 'server' ? 'download' : 'disk read']: fmtMs(e.readMs),
      'engine parse': fmtMs(e.parseMs),
      status: e.phase === 'error' ? `error: ${e.error}` : 'ok',
    })))
    console.groupEnd()

    const t = setTimeout(endSession, 1600)
    return () => clearTimeout(t)
  }, [sessionActive, allDone])

  if (!sessionActive || models.length === 0) return null

  const active =
    models.find(e => e.phase === 'reading' || e.phase === 'parsing') ??
    models.find(e => e.phase === 'pending') ??
    models[models.length - 1]

  return (
    <div className="model-loading-veil">
      <div className="model-loading-panel">
        <span className="model-loading-title">
          {allDone ? 'Models loaded' : 'Loading models'}
        </span>
        <span className="model-loading-name" title={active.name}>{active.name}</span>
        <div className="model-loading-bar">
          <div className="model-loading-bar-fill" style={{ width: `${percent}%` }} />
        </div>
        <span className="model-loading-stats">
          {Math.round(percent)}% · {doneCount}/{models.length} models
          {!allDone && ` · ${statusLabel(active, source)}`}
        </span>
      </div>
    </div>
  )
}
