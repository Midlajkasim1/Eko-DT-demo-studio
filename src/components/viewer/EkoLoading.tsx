import { useId } from 'react'

/** Packaged viewer splash. The wordmark, Loading, a bar, and the percentage. */

export function EkoLoading({ percent }: { percent?: number }) {
  const shown = typeof percent === 'number' && Number.isFinite(percent)
    ? Math.min(100, Math.max(0, Math.round(percent)))
    : null
  const gradId = `eko-load-${useId().replace(/:/g, '')}`

  return (
    <div
      className="eko-loading"
      role="status"
      aria-live="polite"
      aria-label={shown == null ? 'Loading' : `Loading ${shown}%`}
    >
      <div className="eko-loading-stack">
        <svg className="eko-loading-logo" viewBox="0 0 240 78" role="img" aria-label="EKO">
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#1E3A9E" />
              <stop offset="50%" stopColor="#2E7D6B" />
              <stop offset="100%" stopColor="#5AA51F" />
            </linearGradient>
          </defs>
          <text
            x="120"
            y="62"
            textAnchor="middle"
            fontFamily="Futura, 'Century Gothic', 'Avenir Next', 'Nunito Sans', system-ui, sans-serif"
            fontSize="72"
            fontWeight="500"
            letterSpacing="-1.5"
            fill={`url(#${gradId})`}
          >
            eko
          </text>
        </svg>
        <p className="eko-loading-label">Loading</p>
        <div className="eko-loading-bar" aria-hidden="true">
          <div
            className="eko-loading-bar-fill"
            data-wait={shown == null ? '' : undefined}
            style={shown == null ? undefined : { width: `${shown}%` }}
          />
        </div>
        {shown != null && <p className="eko-loading-pct">{shown}%</p>}
      </div>
    </div>
  )
}
