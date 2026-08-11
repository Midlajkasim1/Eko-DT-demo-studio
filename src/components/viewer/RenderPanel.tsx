import { useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  pickRenderSettings,
  SHADOW_MAP_SIZES,
  TONE_MAPPING_OPTIONS,
  type RenderSettings,
  type ToneMappingId,
} from '@/constants/renderSettings'
import { useAppStore } from '@/store/useAppStore'

// ─── Sky Presets ────────────────────────────────────────────────────────────
const DEFAULT_PRESET = {
  label: '⚙️ Default',
  params: {
    timeOfDay: 14.5, cloudDensity: 0.5, exposure: 0.85, fogDensity: 0.00015,
    visualTemperature: 6500, bloomStrength: 0.15, bloomThreshold: 1.5,
    lightIntensity: 1.2, ambientIntensity: 0.3, visualSaturation: 1.0,
    visualContrast: 1.0, visualVignette: 0.4, cloudSpeed: 1.0,
    skyTurbidity: 5.0, skyRayleigh: 2.0, skyMieCoefficient: 0.005,
    skyMieDirectionalG: 0.98, cloudColor: '#ffffff', fogColor: '#88aacc',
  },
}

const SKY_PRESETS: { label: string; params: Partial<RenderSettings> }[] = [
  DEFAULT_PRESET,
  {
    label: '☀️ Clear',
    params: {
      timeOfDay: 12.5, cloudDensity: 0.12, exposure: 1.05, fogDensity: 0.00006,
      visualTemperature: 7200, bloomStrength: 0.12, bloomThreshold: 1.2,
      lightIntensity: 2.0, ambientIntensity: 0.35, visualSaturation: 1.1,
      visualContrast: 1.05, visualVignette: 0.3,
      skyTurbidity: 2.5, skyRayleigh: 1.2, cloudColor: '#ffffff', fogColor: '#9dc4e8',
    },
  },
  {
    label: '🌅 Golden',
    params: {
      timeOfDay: 17.2, cloudDensity: 0.45, exposure: 1.4, fogDensity: 0.00022,
      visualTemperature: 4000, bloomStrength: 0.45, bloomThreshold: 0.85,
      lightIntensity: 1.1, ambientIntensity: 0.18, visualSaturation: 1.3,
      visualContrast: 1.1, visualVignette: 0.45,
      skyTurbidity: 8.0, skyRayleigh: 3.2, cloudColor: '#ffd9b0', fogColor: '#c99a63',
    },
  },
  {
    label: '⛅ Overcast',
    params: {
      timeOfDay: 12.0, cloudDensity: 0.92, exposure: 0.65, fogDensity: 0.00028,
      visualTemperature: 8000, bloomStrength: 0.03, bloomThreshold: 2.0,
      lightIntensity: 0.25, ambientIntensity: 0.85, visualSaturation: 0.9,
      visualContrast: 0.95, visualVignette: 0.2,
      skyTurbidity: 12.0, skyRayleigh: 0.6, cloudColor: '#c9cfd6', fogColor: '#9aa5b1',
    },
  },
  {
    label: '🌆 Blue Hour',
    params: {
      timeOfDay: 19.9, cloudDensity: 0.22, exposure: 0.52, fogDensity: 0.00010,
      visualTemperature: 9500, bloomStrength: 0.18, bloomThreshold: 1.0,
      lightIntensity: 0.3, ambientIntensity: 0.15, visualSaturation: 1.45,
      visualContrast: 1.15, visualVignette: 0.5,
      skyTurbidity: 4.0, skyRayleigh: 4.0, cloudColor: '#8fa3c8', fogColor: '#3a4a6b',
    },
  },
  {
    label: '🌫️ Hazy',
    params: {
      timeOfDay: 14.5, cloudDensity: 0.58, exposure: 1.15, fogDensity: 0.00075,
      visualTemperature: 5600, bloomStrength: 0.22, bloomThreshold: 1.3,
      lightIntensity: 0.9, ambientIntensity: 0.55, visualSaturation: 0.85,
      visualContrast: 0.9, visualVignette: 0.35,
      skyTurbidity: 14.0, skyRayleigh: 2.5, cloudColor: '#e2ded2', fogColor: '#c3c0b4',
    },
  },
]

// ─── Helper Components ───────────────────────────────────────────────────────
function Slider({
  label, value, min, max, step, format, onChange,
}: {
  label: string; value: number; min: number; max: number; step: number
  format?: (v: number) => string; onChange: (v: number) => void
}) {
  const display = format ? format(value) : value.toFixed(2)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--text-secondary)' }}>
        <span>{label}</span>
        <span>{display}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ width: '100%', accentColor: 'var(--accent)' }}
      />
    </div>
  )
}

function Toggle({
  label, checked, title, onChange,
}: { label: string; checked: boolean; title?: string; onChange: (v: boolean) => void }) {
  return (
    <label title={title} style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', gap: '8px', fontSize: '11px', fontWeight: 600, color: 'var(--text-primary)' }}>
      <input
        type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}
        style={{ accentColor: 'var(--accent)', width: '14px', height: '14px', cursor: 'pointer' }}
      />
      {label}
    </label>
  )
}

function Select({
  label, value, options, onChange,
}: {
  label: string; value: string
  options: { value: string; label: string }[]
  onChange: (v: string) => void
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>{label}</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          fontSize: '10px', padding: '4px 6px', borderRadius: '5px',
          border: '1px solid var(--border)', background: 'var(--bg-surface)',
          color: 'var(--text-primary)', cursor: 'pointer', width: '100%',
        }}
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  )
}

function ColorField({
  label, value, onChange,
}: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', fontSize: '10px', color: 'var(--text-secondary)' }}>
      <span>{label}</span>
      <input
        type="color" value={value} onChange={e => onChange(e.target.value)}
        style={{
          width: '36px', height: '20px', padding: 0, cursor: 'pointer',
          border: '1px solid var(--border)', borderRadius: '4px', background: 'none',
        }}
      />
    </div>
  )
}

function SectionDivider({ label }: { label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', margin: '4px 0 2px' }}>
      <div style={{ flex: 1, height: '1px', background: 'var(--border-soft)' }} />
      <span style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.06em', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>{label}</span>
      <div style={{ flex: 1, height: '1px', background: 'var(--border-soft)' }} />
    </div>
  )
}

// ─── RenderPanel ─────────────────────────────────────────────────────────────
export function RenderPanel() {
  const s = useAppStore(useShallow(pickRenderSettings))
  const setRealisticMode  = useAppStore(st => st.setRealisticMode)
  const setLightingParams = useAppStore(st => st.setLightingParams)

  const [open, setOpen] = useState(false)
  // Tracks which preset button is currently active (null = no preset / custom)
  const [activePreset, setActivePreset] = useState<string | null>(null)

  const formatTime = (time: number) => {
    const hours   = Math.floor(time)
    const minutes = Math.floor((time - hours) * 60)
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`
  }

  return (
    <div className={`position-panel ${open ? 'open' : ''}`}>
      {/* Toggle tab */}
      <button
        className="position-panel-tab"
        onClick={() => setOpen(v => !v)}
        title={open ? 'Close Render Panel' : 'Open Render Panel'}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
          <circle cx="12" cy="12" r="5" />
          <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
        </svg>
        <span>Render</span>
      </button>

      {/* Panel body */}
      <div className="position-panel-body" style={{ maxHeight: '290px', overflowY: 'auto' }}>
        <div className="position-panel-header">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14" style={{ color: 'var(--accent)' }}>
            <circle cx="12" cy="12" r="5" />
            <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
          </svg>
          <span>Rendering Engine</span>
        </div>

        <div className="position-field-group" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '10px' }}>
          <Toggle label="Advanced Rendering" checked={s.realisticMode} onChange={setRealisticMode} />
          <Toggle label="Ground Grid" checked={s.gridVisible}
            onChange={v => setLightingParams({ gridVisible: v })} />

          {s.realisticMode && (
            <div style={{
              display: 'flex', flexDirection: 'column', gap: '12px',
              width: '100%', marginTop: '12px', paddingLeft: '22px',
              paddingRight: '6px',
              maxHeight: '220px', overflowY: 'auto',
              scrollbarWidth: 'thin',
            }}>

              {/* ── Sky Presets ─────────────────────────────────────── */}
              <SectionDivider label="Sky Presets" />
              <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                {SKY_PRESETS.map(preset => {
                  const isActive = activePreset === preset.label
                  return (
                    <button
                      key={preset.label}
                      onClick={() => {
                        setLightingParams(preset.params)
                        setActivePreset(preset.label)
                      }}
                      title={preset.label}
                      style={{
                        fontSize: '9px', padding: '4px 7px', borderRadius: '5px',
                        border: `1px solid ${isActive ? 'var(--accent)' : 'var(--border)'}`,
                        background: isActive ? 'var(--accent)' : 'var(--bg-surface)',
                        color: isActive ? '#fff' : 'var(--text-primary)',
                        cursor: 'pointer', fontWeight: isActive ? 700 : 600,
                        transition: 'all 0.15s ease',
                        whiteSpace: 'nowrap',
                        boxShadow: isActive ? '0 0 0 2px rgba(var(--accent-rgb, 22,101,52), 0.18)' : 'none',
                      }}
                    >
                      {preset.label}
                    </button>
                  )
                })}
              </div>

              {/* ── Lighting ─────────────────────────────────────────── */}
              <SectionDivider label="Lighting" />
              <Slider label="Time of Day" value={s.timeOfDay} min={0} max={24} step={0.1}
                format={formatTime} onChange={v => setLightingParams({ timeOfDay: v })} />
              <Slider label="Exposure" value={s.exposure} min={0.1} max={3} step={0.05}
                onChange={v => setLightingParams({ exposure: v })} />
              <Select label="Tone Mapping" value={s.toneMapping} options={TONE_MAPPING_OPTIONS}
                onChange={v => setLightingParams({ toneMapping: v as ToneMappingId })} />
              <Slider label="Sun Intensity" value={s.lightIntensity} min={0} max={5} step={0.1}
                onChange={v => setLightingParams({ lightIntensity: v })} />
              <Slider label="Ambient Light" value={s.ambientIntensity} min={0} max={3} step={0.1}
                onChange={v => setLightingParams({ ambientIntensity: v })} />

              <SectionDivider label="HDRI Environment" />
              <Toggle label="Enable HDRI"
                checked={s.iblEnabled}
                onChange={v => setLightingParams({ iblEnabled: v })} />
              {s.iblEnabled && (
                <>
                  <Toggle label="Sync Rotation with Sun"
                    checked={s.syncIblWithSun}
                    onChange={v => setLightingParams({ syncIblWithSun: v })} />
                  <Slider label="HDRI Intensity" value={s.envIntensity} min={0} max={3} step={0.05}
                    onChange={v => setLightingParams({ envIntensity: v })} />
                  {!s.syncIblWithSun && (
                    <Slider label="HDRI Rotation" value={s.envRotation} min={0} max={6.28} step={0.01}
                      onChange={v => setLightingParams({ envRotation: v })} />
                  )}
                </>
              )}

              {/* ── Skybox ───────────────────────────────────────────── */}
              <SectionDivider label="Skybox" />
              <Toggle label="Show Skybox"
                checked={s.skyboxEnabled}
                onChange={v => setLightingParams({ skyboxEnabled: v })} />
              {s.skyboxEnabled && (
                <>
                  <Slider label="Turbidity (Haze)" value={s.skyTurbidity} min={0} max={20} step={0.1}
                    onChange={v => setLightingParams({ skyTurbidity: v })} />
                  <Slider label="Rayleigh (Blue Scatter)" value={s.skyRayleigh} min={0} max={5} step={0.05}
                    onChange={v => setLightingParams({ skyRayleigh: v })} />
                  <Slider label="Mie Coefficient" value={s.skyMieCoefficient} min={0} max={0.1} step={0.001}
                    format={v => v.toFixed(3)} onChange={v => setLightingParams({ skyMieCoefficient: v })} />
                  <Slider label="Sun Glow Spread" value={s.skyMieDirectionalG} min={0} max={0.999} step={0.001}
                    format={v => v.toFixed(3)} onChange={v => setLightingParams({ skyMieDirectionalG: v })} />
                </>
              )}

              {/* ── Clouds ───────────────────────────────────────────── */}
              <SectionDivider label="Clouds" />
              <Toggle label="Show Clouds"
                checked={s.cloudsEnabled}
                onChange={v => setLightingParams({ cloudsEnabled: v })} />
              {s.cloudsEnabled && (
                <>
                  <Slider label="Cloud Density" value={s.cloudDensity} min={0} max={1} step={0.01}
                    onChange={v => setLightingParams({ cloudDensity: v })} />
                  <Slider label="Cloud Speed" value={s.cloudSpeed} min={0} max={5} step={0.1}
                    onChange={v => setLightingParams({ cloudSpeed: v })} />
                  <ColorField label="Cloud Tint" value={s.cloudColor}
                    onChange={v => setLightingParams({ cloudColor: v })} />
                  <Toggle label="Cloud Shadows"
                    checked={s.cloudShadowsEnabled}
                    onChange={v => setLightingParams({ cloudShadowsEnabled: v })} />
                </>
              )}

              {/* ── Shadows ──────────────────────────────────────────── */}
              <SectionDivider label="Shadows" />
              <Toggle label="Cast Shadows"
                checked={s.shadowsEnabled}
                onChange={v => setLightingParams({ shadowsEnabled: v })} />
              {s.shadowsEnabled && (
                <>
                  <Toggle label="Soft Shadows"
                    title="PCF soft filtering — smoother edges, slightly slower"
                    checked={s.softShadows}
                    onChange={v => setLightingParams({ softShadows: v })} />
                  <Select label="Shadow Resolution" value={String(s.shadowMapSize)}
                    options={SHADOW_MAP_SIZES.map(size => ({ value: String(size), label: `${size} × ${size}` }))}
                    onChange={v => setLightingParams({ shadowMapSize: Number(v) })} />
                </>
              )}

              {/* ── Bloom ────────────────────────────────────────────── */}
              <SectionDivider label="Bloom" />
              <Toggle label="Enable Bloom"
                checked={s.bloomEnabled}
                onChange={v => setLightingParams({ bloomEnabled: v })} />
              {s.bloomEnabled && (
                <>
                  <Slider label="Bloom Strength" value={s.bloomStrength} min={0} max={2} step={0.01}
                    onChange={v => setLightingParams({ bloomStrength: v })} />
                  <Slider label="Bloom Radius" value={s.bloomRadius} min={0} max={1} step={0.01}
                    onChange={v => setLightingParams({ bloomRadius: v })} />
                  <Slider label="Bloom Threshold" value={s.bloomThreshold} min={0} max={3} step={0.01}
                    onChange={v => setLightingParams({ bloomThreshold: v })} />
                </>
              )}

              {/* ── God Rays ─────────────────────────────────────────── */}
              <SectionDivider label="God Rays" />
              <Toggle label="Volumetric God Rays"
                checked={s.godRaysEnabled}
                onChange={v => setLightingParams({ godRaysEnabled: v })} />
              {s.godRaysEnabled && (
                <Slider label="Ray Strength" value={s.godRayStrength} min={0} max={1.5} step={0.05}
                  onChange={v => setLightingParams({ godRayStrength: v })} />
              )}

              {/* ── Atmosphere ───────────────────────────────────────── */}
              <SectionDivider label="Atmosphere" />
              <Toggle label="Enable Fog"
                checked={s.fogEnabled}
                onChange={v => setLightingParams({ fogEnabled: v })} />
              {s.fogEnabled && (
                <>
                  <Slider label="Fog Density" value={s.fogDensity} min={0} max={0.005} step={0.00001}
                    format={v => v.toFixed(5)} onChange={v => setLightingParams({ fogDensity: v })} />
                  <ColorField label="Fog Color" value={s.fogColor}
                    onChange={v => setLightingParams({ fogColor: v })} />
                </>
              )}

              {/* ── Camera ───────────────────────────────────────────── */}
              <SectionDivider label="Camera" />
              <Toggle label="Depth of Field (Blur)"
                checked={s.dofEnabled}
                onChange={v => setLightingParams({ dofEnabled: v })} />
              {s.dofEnabled && (
                <>
                  <Toggle label="Auto-Focus (orbit target)"
                    checked={s.autoFocus}
                    onChange={v => setLightingParams({ autoFocus: v })} />
                  {!s.autoFocus && (
                    <Slider label="Focus Distance" value={s.dofFocus} min={100} max={20000} step={100}
                      format={v => v.toFixed(0)} onChange={v => setLightingParams({ dofFocus: v })} />
                  )}
                  <Slider label="Aperture" value={s.dofAperture} min={0.00001} max={0.0005} step={0.00001}
                    format={v => v.toFixed(5)} onChange={v => setLightingParams({ dofAperture: v })} />
                  <Slider label="Max Blur" value={s.dofMaxBlur} min={0} max={0.05} step={0.001}
                    format={v => v.toFixed(3)} onChange={v => setLightingParams({ dofMaxBlur: v })} />
                </>
              )}

              {/* ── Color Grading ────────────────────────────────────── */}
              <SectionDivider label="Color Grading" />
              <Slider label="Saturation" value={s.visualSaturation} min={0} max={2} step={0.05}
                onChange={v => setLightingParams({ visualSaturation: v })} />
              <Slider label="Temperature (K)" value={s.visualTemperature} min={4000} max={10000} step={100}
                format={v => v.toFixed(0)} onChange={v => setLightingParams({ visualTemperature: v })} />
              <Slider label="Contrast" value={s.visualContrast} min={0.5} max={2} step={0.05}
                onChange={v => setLightingParams({ visualContrast: v })} />
              <Slider label="Vignette" value={s.visualVignette} min={0} max={1} step={0.05}
                onChange={v => setLightingParams({ visualVignette: v })} />
              <Slider label="Chromatic Aberration" value={s.chromaticAberration} min={0} max={1} step={0.05}
                onChange={v => setLightingParams({ chromaticAberration: v })} />

              {/* ── Post-Processing ──────────────────────────────────── */}
              <SectionDivider label="Post-Processing" />
              <Toggle label="Anti-Aliasing (SMAA)"
                checked={s.antialiasing}
                onChange={v => setLightingParams({ antialiasing: v })} />
              <Toggle label="Ambient Occlusion"
                checked={s.ambientOcclusion}
                onChange={v => setLightingParams({ ambientOcclusion: v })} />
              {s.ambientOcclusion && (
                <>
                  <Slider label="AO Radius" value={s.aoRadius} min={1.0} max={200.0} step={1.0}
                    onChange={v => setLightingParams({ aoRadius: v })} />
                  <Slider label="AO Intensity" value={s.aoIntensity} min={0.0} max={20.0} step={0.1}
                    onChange={v => setLightingParams({ aoIntensity: v })} />
                </>
              )}
              <Toggle label="Fine Outlines"
                checked={s.outlineEdges}
                onChange={v => setLightingParams({ outlineEdges: v })} />
              <Toggle label="Screen-Space Reflections"
                title="Experimental — reflects every mesh, so flat ground turns mirror-like, and it redraws the scene over the ambient occlusion and bloom result"
                checked={s.ssrEnabled}
                onChange={v => setLightingParams({ ssrEnabled: v })} />

              {/* ── Materials ────────────────────────────────────────── */}
              <SectionDivider label="Materials" />
              <Toggle label="Enable PBR Materials"
                checked={s.pbrMaterials}
                onChange={v => setLightingParams({ pbrMaterials: v })} />

            </div>
          )}
        </div>
      </div>
    </div>
  )
}
