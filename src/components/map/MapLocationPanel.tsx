import type { MapLocation } from '@/types'

interface MapLocationPanelProps {
  location: MapLocation
  childCount: number
  /** Only ever the models. Going into a level is what the click on the pin already did. */
  canExplore: boolean
  busy: boolean
  onExplore: () => void
  onClose: () => void
}

export function MapLocationPanel({
  location, childCount, canExplore, busy, onExplore, onClose,
}: MapLocationPanelProps) {
  const drills = childCount > 0
  const hasBody = drills || !!location.description || !!location.stats?.length

  return (
    <aside className="map-panel" role="dialog" aria-label={location.name}>
      <header className="map-panel-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="map-panel-eyebrow">{drills ? 'Level' : 'Location'}</div>
          <h2 className="map-panel-title">{location.name}</h2>
        </div>
        <button className="map-btn" onClick={onClose} title="Close" aria-label="Close">
          <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14">
            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </button>
      </header>

      {hasBody && (
      <div className="map-panel-body">
        {location.description && <p className="map-panel-text">{location.description}</p>}

        {!!location.stats?.length && (
          <div className="map-stats">
            {location.stats.map(stat => (
              <div className="map-stat" key={stat.label}>
                <div className="map-stat-label">{stat.label}</div>
                <div className="map-stat-value">{stat.value}</div>
              </div>
            ))}
          </div>
        )}

        {drills && (
          <p className="map-panel-text" style={{ marginTop: 14, opacity: 0.7 }}>
            {childCount} location{childCount === 1 ? '' : 's'} inside.
          </p>
        )}
      </div>
      )}

      {canExplore && (
        <footer className="map-panel-foot">
          <button className="map-cta" onClick={onExplore} disabled={busy}>
            {busy ? 'Loading…' : 'Explore'}
          </button>
        </footer>
      )}
    </aside>
  )
}
