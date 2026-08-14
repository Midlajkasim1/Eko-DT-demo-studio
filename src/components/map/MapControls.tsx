import { useEffect, useRef } from 'react'
import type { MapEngine } from '@/lib/mapEngine'

interface MapControlsProps {
  engine: MapEngine | null
}

export function MapControls({ engine }: MapControlsProps) {
  const needleRef = useRef<SVGSVGElement>(null)

  // Written straight to a custom property so rotating the needle costs no React render
  useEffect(() => {
    if (!engine) return
    const apply = (bearing: number) => needleRef.current?.style.setProperty('--bearing', `${-bearing}deg`)
    apply(engine.getState().bearing)
    return engine.subscribe(s => apply(s.bearing))
  }, [engine])

  return (
    <div className="map-controls">
      <button className="map-btn" title="Zoom in" onClick={() => engine?.zoomBy(1)}>
        <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
          <path d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z" />
        </svg>
      </button>
      <button className="map-btn" title="Zoom out" onClick={() => engine?.zoomBy(-1)}>
        <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
          <path d="M6 9h8a1 1 0 110 2H6a1 1 0 110-2z" />
        </svg>
      </button>
      <button className="map-btn" title="Reset bearing" onClick={() => engine?.resetBearing()}>
        <svg ref={needleRef} className="map-compass-needle" viewBox="0 0 24 24" width="17" height="17" fill="none">
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" opacity="0.4" />
          <path d="M12 5.5 14.6 13 12 11.4 9.4 13Z" fill="#ff5a4a" />
          <path d="M12 18.5 9.4 11 12 12.6 14.6 11Z" fill="currentColor" />
        </svg>
      </button>
      <button className="map-btn" title="Back to overview" onClick={() => engine?.flyToOverview()}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" width="17" height="17">
          <path d="M3 11l9-7 9 7" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M5 10v9h14v-9" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  )
}
