import { Fragment } from 'react'
import type { MapLocation } from '@/types'

interface MapBreadcrumbProps {
  projectName: string
  trail: MapLocation[]
  onGoTo: (id: string | null) => void
}

export function MapBreadcrumb({ projectName, trail, onGoTo }: MapBreadcrumbProps) {
  return (
    <nav className="map-crumbs" aria-label="Map level">
      <button
        className={`map-crumb ${trail.length === 0 ? 'map-crumb--current' : ''}`}
        onClick={() => onGoTo(null)}
        aria-current={trail.length === 0 ? 'true' : undefined}
      >
        {projectName}
      </button>
      {trail.map((location, i) => (
        <Fragment key={location.id}>
          <span className="map-crumb-sep" aria-hidden="true">/</span>
          <button
            className={`map-crumb ${i === trail.length - 1 ? 'map-crumb--current' : ''}`}
            onClick={() => onGoTo(location.id)}
            aria-current={i === trail.length - 1 ? 'true' : undefined}
          >
            {location.name}
          </button>
        </Fragment>
      ))}
    </nav>
  )
}
