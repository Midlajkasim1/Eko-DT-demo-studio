import { useLoadingProgressStore, sessionProgress } from '@/store/useLoadingProgressStore'
import { EkoLoading } from '@/components/viewer/EkoLoading'

/** The map sits above the shared loading veil, so while a pin opens it shows progress itself */
export function MapLoadProgress({ branded = false }: { branded?: boolean }) {
  const sessionActive = useLoadingProgressStore(s => s.sessionActive)
  const order = useLoadingProgressStore(s => s.order)
  const entries = useLoadingProgressStore(s => s.entries)

  if (!sessionActive || order.length === 0) return null

  const models = order.map(id => entries[id]).filter(Boolean)
  if (!models.length) return null

  const done = models.filter(e => e.phase === 'done' || e.phase === 'error').length
  const allDone = done === models.length
  const percent = allDone ? 100 : sessionProgress({ order, entries })
  const active =
    models.find(e => e.phase === 'reading' || e.phase === 'parsing') ??
    models.find(e => e.phase === 'pending') ??
    models[models.length - 1]

  if (branded) return <EkoLoading percent={percent} />

  return (
    <div className="map-progress" role="status" aria-live="polite">
      <div className="map-progress-card">
        <span className="map-progress-title">{allDone ? 'Models loaded' : 'Loading models'}</span>
        <span className="map-progress-name" title={active.name}>{active.name}</span>
        <div className="map-progress-track">
          <div className="map-progress-fill" style={{ width: `${percent}%` }} />
        </div>
        <span className="map-progress-stats">
          {Math.round(percent)}% · {done}/{models.length} models
        </span>
      </div>
    </div>
  )
}
