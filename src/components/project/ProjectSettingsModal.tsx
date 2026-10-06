import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useProjectStore } from '@/store/useProjectStore'
import { writeJson } from '@/lib/projectDb'
import type { ProjectApiSettings } from '@/types'

const DEFAULT_FIN_LIVE_POINTS = {
  "total_power": "p:{project}:r:31034e49-1f300fe1",
  "carbon": "p:{project}:r:3105de9e-0091a3a6",
  "current_month": "p:{project}:r:31034e49-4c6c035e",
  "previous_month": "p:{project}:r:3105c5a1-a272e1a7",
  "target_monthly": "p:{project}:r:3105c687-98bd4374",
  "ahu": "p:{project}:r:31034e49-b986583a",
  "fcu": "p:{project}:r:3105c687-8436b4e7",
  "boiler": "p:{project}:r:3105cf6b-faa023ca",
  "chiller": "p:{project}:r:3105cf6b-d483c5f7",
  "cooling_tower": "p:{project}:r:3105cf6b-ae5752c0",
  "vav": "p:{project}:r:31034e49-efdd0bc0",
  "lighting": "p:{project}:r:3105c687-d66c2275",
  "power_sockets": "p:{project}:r:3105c687-d5277330",
  "pumps": "p:{project}:r:3105cf6b-c3032a1e"
}

const DEFAULT_FIN_ENDPOINTS = {
  "Total_Power_Consumption_his": "/api/{project}/eval?expr=hisRead(@p:{project}:r:31034e49-1f300fe1,2026-01-01..today()%2C%7B-limit%7D)",
  "AHU_Usage_his": "/api/{project}/eval?expr=hisRead(@p:{project}:r:31034e49-b986583a,2026-01-01..today()%2C%7B-limit%7D)",
  "BOILER_Usage_his": "/api/{project}/eval?expr=hisRead(@p:{project}:r:3105cf6b-faa023ca,2026-01-01..today()%2C%7B-limit%7D)",
  "CHILLER_Usage_his": "/api/{project}/eval?expr=hisRead(@p:{project}:r:3105cf6b-d483c5f7,2026-01-01..today()%2C%7B-limit%7D)",
  "COOLING_TOWER_Usage_his": "/api/{project}/eval?expr=hisRead(@p:{project}:r:3105cf6b-ae5752c0,2026-01-01..today()%2C%7B-limit%7D)",
  "FCU_Usage_his": "/api/{project}/eval?expr=hisRead(@p:{project}:r:3105c687-8436b4e7,2026-01-01..today()%2C%7B-limit%7D)",
  "Lighting_Usage_his": "/api/{project}/eval?expr=hisRead(@p:{project}:r:3105c687-d66c2275,2026-01-01..today()%2C%7B-limit%7D)",
  "PUMPs_Usage_his": "/api/{project}/eval?expr=hisRead(@p:{project}:r:3105cf6b-c3032a1e,2026-01-01..today()%2C%7B-limit%7D)",
  "Power_Usage_his": "/api/{project}/eval?expr=hisRead(@p:{project}:r:3105c687-d5277330,2026-01-01..today()%2C%7B-limit%7D)",
  "VAV_Consumption_his": "/api/{project}/eval?expr=hisRead(@p:{project}:r:31034e49-efdd0bc0,2026-01-01..today()%2C%7B-limit%7D)",
  "Water_Consumption_his": "/api/{project}/eval?expr=hisRead(@p:{project}:r:310346fb-95c42637,2026-01-01..today()%2C%7B-limit%7D)",
  "Carbon_Emission_his": "/api/{project}/eval?expr=hisRead(@p:{project}:r:3105de9e-0091a3a6,2026-01-01..today()%2C%7B-limit%7D)"
}

// Site preset — must stay in sync with backend/config.json (single source of truth)
const SITE_FIN_LIVE_POINTS = {
  "hourly_energy": "p:{project}:r:3181ee6e-67dac181",
  "peak_demand": "p:{project}:r:3181f788-2d229f48",
  "energy_deviation": "p:{project}:r:3181f71f-2f0083d7",
  "energy_intensity": "p:{project}:r:3181f767-e5cb6329",
  "energy_performance": "p:{project}:r:3182117b-3c286f7b",
  "after_hours_deviation": "p:{project}:r:3182117b-3c286f7b",
  "kpi_after_hours_ratio": "p:{project}:r:31820fc9-da2fb148",
  "hvac_epr": "p:{project}:r:31a2ee82-319eb82f",
  "kpi_hvac_epr": "p:{project}:r:31820fc9-580b36d6",
  "carbon": "p:{project}:r:3181f7a2-4652169b",
  "water_consumption": "p:{project}:r:310346fb-95c42637",
  "current_month": "p:{project}:r:31034e49-4c6c035e",
  "previous_month": "p:{project}:r:3105c5a1-a272e1a7",
  "target_monthly": "p:{project}:r:31a06992-90fb9d52",
  "target_current": "p:{project}:r:3196cd3e-505a1625",
  "comfort_compliance": "p:{project}:r:319d6f6b-b5411f43",
  "ra_co2": "p:{project}:r:318b19b8-0df2b231",
  "ahu": "p:{project}:r:31034e49-b986583a",
  "fcu": "p:{project}:r:3105c687-8436b4e7",
  "boiler": "p:{project}:r:3105cf6b-faa023ca",
  "chiller": "p:{project}:r:3105cf6b-d483c5f7",
  "cooling_tower": "p:{project}:r:3105cf6b-ae5752c0",
  "vav": "p:{project}:r:31034e49-efdd0bc0",
  "lighting": "p:{project}:r:3105c687-d66c2275",
  "power_sockets": "p:{project}:r:3105c687-d5277330",
  "pumps": "p:{project}:r:3105cf6b-c3032a1e",
  "mcc1": "p:{project}:r:3195bbf6-c7b4de9a",
  "mcc2": "p:{project}:r:3195bc40-ac80ac08"
}

const SITE_FIN_ENDPOINTS = {
  "Hourly_Energy_Consumption_his": "/api/{project}/eval?expr=hisRead(@p:{project}:r:3181ee6e-67dac181,2026-05-21..today()%2C%7B-limit%7D)",
  "Power_Usage_his": "/api/{project}/eval?expr=hisRead(@p:{project}:r:3181ee6e-67dac181,2026-05-21..today()%2C%7B-limit%7D)",
  "Peak_Demand_his": "/api/{project}/eval?expr=hisRead(@p:{project}:r:3181f788-2d229f48,2026-05-21..today()%2C%7B-limit%7D)",
  "Energy_Deviation_his": "/api/{project}/eval?expr=hisRead(@p:{project}:r:3181f71f-2f0083d7,2026-05-21..today()%2C%7B-limit%7D)",
  "Energy_Use_Intensity_his": "/api/{project}/eval?expr=hisRead(@p:{project}:r:3181f767-e5cb6329,2026-05-21..today()%2C%7B-limit%7D)",
  "VAV_Consumption_his": "/api/{project}/eval?expr=hisRead(@p:{project}:r:31034e49-efdd0bc0,2026-01-01..today()%2C%7B-limit%7D)",
  "Water_Consumption_his": "/api/{project}/eval?expr=hisRead(@p:{project}:r:310346fb-95c42637,2026-01-01..today()%2C%7B-limit%7D)",
  "Carbon_Emission_his": "/api/{project}/eval?expr=hisRead(@p:{project}:r:3105de9e-0091a3a6,2026-01-01..today()%2C%7B-limit%7D)",
  "Carbon_Points_his": "/api/{project}/eval?expr=hisRead(@p:{project}:r:3181f7a2-4652169b,2026-05-21..today()%2C%7B-limit%7D)",
  "Consumption_Level1_his": "/api/{project}/eval?expr=hisRead(@p:{project}:r:310346fb-ce2c6cd5,2025-01-01..today()%2C%7B-limit%7D)",
  "Consumption_Level2_his": "/api/{project}/eval?expr=hisRead(@p:{project}:r:31034e49-cd80ee43,2025-01-01..today()%2C%7B-limit%7D)",
  "Consumption_Level3_his": "/api/{project}/eval?expr=hisRead(@p:{project}:r:31034e49-2b40797d,2025-01-01..today()%2C%7B-limit%7D)",
  "PMU04_his": "/api/{project}/eval?expr=hisRead(@p:{project}:r:3195bc40-ac80ac08,2026-05-21..today()%2C%7B-limit%7D)",
  "PMU05_his": "/api/{project}/eval?expr=hisRead(@p:{project}:r:3195bc40-9a32d7b7,2026-05-21..today()%2C%7B-limit%7D)",
  "PMU06_his": "/api/{project}/eval?expr=hisRead(@p:{project}:r:3195bc40-6c15d0fe,2026-05-21..today()%2C%7B-limit%7D)",
  "PMU07_his": "/api/{project}/eval?expr=hisRead(@p:{project}:r:3195bc40-eede63ec,2026-05-21..today()%2C%7B-limit%7D)",
  "PMU08_his": "/api/{project}/eval?expr=hisRead(@p:{project}:r:3195bc40-ff5411e5,2026-05-21..today()%2C%7B-limit%7D)",
  "PMU09_his": "/api/{project}/eval?expr=hisRead(@p:{project}:r:3195bbf6-c7b4de9a,2026-05-21..today()%2C%7B-limit%7D)",
  "WM_BF_Cold_Wtr_his": "/api/{project}/eval?expr=hisRead(@p:{project}:r:31b02214-cfdc6152,2026-05-21..today()%2C%7B-limit%7D)",
  "WM_FF_Ret_Hot_Wtr_his": "/api/{project}/eval?expr=hisRead(@p:{project}:r:31b02287-41e84804,2026-05-21..today()%2C%7B-limit%7D)",
  "WM_FF_Sup_Cold_Wtr_his": "/api/{project}/eval?expr=hisRead(@p:{project}:r:31b02287-f021f2a0,2026-05-21..today()%2C%7B-limit%7D)",
  "WM_FF_Sup_Hot_Wtr_his": "/api/{project}/eval?expr=hisRead(@p:{project}:r:31b02287-40064c83,2026-05-21..today()%2C%7B-limit%7D)",
  "GM_GF_01_his": "/api/{project}/eval?expr=hisRead(@p:{project}:r:31b02287-febfc212,2026-05-21..today()%2C%7B-limit%7D)",
  "GM_GF_02_his": "/api/{project}/eval?expr=hisRead(@p:{project}:r:31b022c7-cd184ea5,2026-05-21..today()%2C%7B-limit%7D)",
  "GM_GF_03_his": "/api/{project}/eval?expr=hisRead(@p:{project}:r:31b022c7-06dbd6f5,2026-05-21..today()%2C%7B-limit%7D)"
}

interface ProjectSettingsModalProps {
  visible: boolean
  onClose: () => void
}

const DEFAULT_DASHBOARD_CONFIG = {
  navButtons: [
    { id: "floor-nav", icon: "bx bx-show", tooltip: "Navigate Floors", action: "toggle-panel", panel: "floorIsolation" },
    { id: "layers", icon: "bx bx-layer", tooltip: "Layers", action: "toggle-panel", panel: "treeViewer" },
    { id: "tree-viewer", icon: "bx bx-cube", tooltip: "Tree Viewer", action: "toggle-panel", panel: "treeViewer" },
    { id: "ruler", icon: "bx bx-ruler", tooltip: "Measure", action: "toggle-panel", panel: "rulerPanel" },
    { id: "pointer", icon: "bx bx-pointer", tooltip: "Select", action: "emit", event: "obj-select" },
    { id: "reset", icon: "bx bx-refresh", tooltip: "Reset View", action: "emit", event: "reset-viewer" },
    { id: "slice", icon: "bx bx-cut", tooltip: "Slice", action: "emit", event: "slice-model" },
    { id: "brush", icon: "bx bx-paint", tooltip: "Visual Settings", action: "toggle-panel", panel: "visualSettings" },
    { id: "settings", icon: "bx bx-cog", tooltip: "Settings", action: "toggle-panel", panel: "settingsPanel" },
    { id: "help", icon: "bx bx-help-circle", tooltip: "Help", action: "emit", event: "help" },
  ],
  leftCards: [
    { id: "date", label: "Date", icon: "bx bx-calendar", accent: "date", source: "clock", format: "date" },
    { id: "time", label: "Time", icon: "bx bx-time", accent: "time", source: "clock", format: "time" },
    { id: "temp", label: "Temp", icon: "bx bx-sun", accent: "temp", source: "weather", field: "temp" },
  ],
  rightCards: [
    { id: "humid", label: "Humidity", icon: "bx bx-droplet", accent: "humid", source: "weather", field: "humidity" },
    { id: "aqi", label: "Air Quality", icon: "bx bx-leaf", accent: "air", source: "weather", field: "aqi" },
    { id: "sky", label: "Weather", icon: "bx bx-cloud", accent: "sky", source: "weather", field: "description" },
  ],
  sideButtons: [
    { id: "overview", icon: "bx bx-bar-chart-alt-2", label: "Overview", action: "show-dashboard", dashboard: "overview", enabled: true },
    { id: "asset-reg", icon: "bx bx-book", label: "Asset Register", action: "show-dashboard", dashboard: "assetRegister", enabled: true },
    { id: "power-kpi", icon: "bx bx-bolt-circle", label: "Power KPI", action: "show-dashboard", dashboard: "powerAnalysis", enabled: true },
    { id: "hvac-kpi", icon: "bx bx-wind", label: "HVAC KPI", action: "show-dashboard", dashboard: "hvacStats", enabled: true },
    { id: "water-kpi", icon: "bx bx-water", label: "Water KPI", action: "show-dashboard", dashboard: "waterKPI", enabled: true },
    { id: "maintenance", icon: "bx bx-calendar-check", label: "Maintenance", action: "show-dashboard", dashboard: "maintenance", enabled: true },
    { id: "cctv", icon: "bx bx-camera", label: "CCTV Controller", action: "show-dashboard", dashboard: "cctv", enabled: false },
    { id: "heatmap", icon: "bx bx-map", label: "Crowd Heatmap", action: "show-dashboard", dashboard: "heatmap", enabled: false },
    { id: "queue", icon: "bx bx-group", label: "QueManagement", action: "show-dashboard", dashboard: "queManagement", enabled: false },
    { id: "ai-assistant", icon: "bx bx-bot", label: "AI Assistant", action: "show-dashboard", dashboard: "aiAssistant", enabled: false },
    { id: "equipment", icon: "bx bx-chip", label: "Equipment Analytics", action: "show-dashboard", dashboard: "equipment", enabled: true },
    { id: "codeblue", icon: "bx bx-plus-medical", label: "Code Blue Dashboard", action: "show-dashboard", dashboard: "codeBlue", enabled: false },
  ]
}

export function ProjectSettingsModal({ visible, onClose }: ProjectSettingsModalProps) {
  const currentProject = useProjectStore(s => s.currentProject)
  const folderHandle = useProjectStore(s => s.folderHandle)

  const [activeTab, setActiveTab] = useState<'nav'|'info'|'side'|'fin'|'data'>('fin')
  
  const [settings, setSettings] = useState<ProjectApiSettings>({
    finBaseUrl: 'https://localhost',
    finProjectName: '',
    finInterval: 5000,
    weatherApiKey: '',
    weatherLat: 24.469,
    weatherLon: 54.358,
    ...DEFAULT_DASHBOARD_CONFIG
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (visible && currentProject) {
      const savedSettings = currentProject.apiSettings || {}
      const mergedSettings: any = { 
        ...DEFAULT_DASHBOARD_CONFIG,
        ...savedSettings 
      }
      
      // Ensure any newly added default items that aren't in the saved database are appended
      const arrayKeys = ['navButtons', 'leftCards', 'rightCards', 'sideButtons'] as const;
      arrayKeys.forEach(key => {
        if (savedSettings[key]) {
          const savedIds = new Set(savedSettings[key].map((item: any) => item.id))
          const missingItems = DEFAULT_DASHBOARD_CONFIG[key].filter((item: any) => !savedIds.has(item.id))
          mergedSettings[key] = [...savedSettings[key], ...missingItems]
        }
      })

      setSettings(prev => ({ 
        ...prev, 
        ...mergedSettings 
      }))
    }
  }, [visible, currentProject])

  if (!visible || !currentProject) return null

  const handleSave = async () => {
    if (!folderHandle) return
    setSaving(true)
    try {
      const updatedMeta = {
        ...currentProject,
        apiSettings: settings,
        updatedAt: Date.now(),
      }
      await writeJson(folderHandle, 'project.json', updatedMeta)
      useProjectStore.setState({ currentProject: updatedMeta })

      // Always write api-config.json for FIN projects so the standalone viewer has it
      if (currentProject.isFinProject) {
        const apiConfig = {
          project_name: settings.finProjectName || currentProject.name,
          fin_server_url: settings.finBaseUrl || 'https://localhost',
          direct_mode: true, // Always true for FIN standalone viewer
          polling_interval: settings.finInterval || 5000,
          live_point_ids: settings.finLivePoints || {},
          power_endpoints: settings.finEndpoints || {},
          weather: {
            lat: settings.weatherLat ?? 24.469,
            lon: settings.weatherLon ?? 54.358,
            apiKey: settings.weatherApiKey || '88214bff7aa566e9f6ff1ba5db38f65f',
          },
          navButtons: settings.navButtons,
          leftCards: settings.leftCards,
          rightCards: settings.rightCards,
          sideButtons: settings.sideButtons,
        }
        await writeJson(folderHandle, 'api-config.json', apiConfig)
      }

      onClose()
    } finally {
      setSaving(false)
    }
  }

  const update = (field: keyof ProjectApiSettings, value: any) => {
    setSettings(prev => ({ ...prev, [field]: value }))
  }

  const moveItem = (arrayKey: keyof ProjectApiSettings, index: number, direction: 'up' | 'down') => {
    const arr = [...(settings[arrayKey] as any[])]
    if (direction === 'up' && index > 0) {
      const temp = arr[index]
      arr[index] = arr[index - 1]
      arr[index - 1] = temp
    } else if (direction === 'down' && index < arr.length - 1) {
      const temp = arr[index]
      arr[index] = arr[index + 1]
      arr[index + 1] = temp
    }
    update(arrayKey, arr)
  }

  const toggleSideButton = (index: number) => {
    const arr = [...(settings.sideButtons || [])]
    arr[index].enabled = arr[index].enabled === false ? true : false
    update('sideButtons', arr)
  }

  const renameSideButton = (index: number, newLabel: string) => {
    const arr = [...(settings.sideButtons || [])]
    arr[index].label = newLabel
    update('sideButtons', arr)
  }

  return createPortal(
    <div className="dashboard-settings-overlay" onClick={onClose}>
      <div className="dashboard-settings-modal" onClick={e => e.stopPropagation()}>
        <div className="dashboard-settings-header">
          <h2>
            <i className="bx bx-slider-alt" style={{ marginRight: '8px' }}></i>
            Dashboard Settings
          </h2>
          <button className="ds-close-btn" onClick={onClose}>×</button>
        </div>

        <div className="dashboard-settings-tabs">
          <button className={`ds-tab ${activeTab === 'fin' ? 'active' : ''}`} onClick={() => setActiveTab('fin')}>FIN Config</button>
          <button className={`ds-tab ${activeTab === 'data' ? 'active' : ''}`} onClick={() => setActiveTab('data')}>Data Mapping</button>
          <button className={`ds-tab ${activeTab === 'nav' ? 'active' : ''}`} onClick={() => setActiveTab('nav')}>Nav Buttons</button>
          <button className={`ds-tab ${activeTab === 'info' ? 'active' : ''}`} onClick={() => setActiveTab('info')}>Info Cards</button>
          <button className={`ds-tab ${activeTab === 'side' ? 'active' : ''}`} onClick={() => setActiveTab('side')}>Side Panel Dashboards</button>
        </div>

        <div className="dashboard-settings-body">
          
          {activeTab === 'fin' && (
            <div className="ds-pane">
              <h3 className="ds-section-title">FIN Framework Connection</h3>
              <div className="ds-field">
                <label>FIN Base URL</label>
                <input type="text" value={settings.finBaseUrl || ''} onChange={e => update('finBaseUrl', e.target.value)} />
              </div>
              <div className="ds-field">
                <label>FIN Project Name</label>
                <input type="text" value={settings.finProjectName || ''} onChange={e => update('finProjectName', e.target.value)} />
              </div>
              <div className="ds-field">
                <label>Polling Interval (ms)</label>
                <input type="number" value={settings.finInterval || 5000} onChange={e => update('finInterval', parseInt(e.target.value) || 5000)} />
              </div>

              <h3 className="ds-section-title" style={{ marginTop: '24px' }}>Weather API</h3>
              <div className="ds-field">
                <label>OpenWeatherMap API Key</label>
                <input type="text" value={settings.weatherApiKey || ''} onChange={e => update('weatherApiKey', e.target.value)} />
              </div>
              <div className="ds-field-row">
                <div className="ds-field">
                  <label>Latitude</label>
                  <input type="number" value={settings.weatherLat ?? 0} onChange={e => update('weatherLat', parseFloat(e.target.value) || 0)} />
                </div>
                <div className="ds-field">
                  <label>Longitude</label>
                  <input type="number" value={settings.weatherLon ?? 0} onChange={e => update('weatherLon', parseFloat(e.target.value) || 0)} />
                </div>
              </div>
            </div>
          )}

          {activeTab === 'data' && (
            <div className="ds-pane">
              <h3 className="ds-section-title">Standalone Mode (Direct API)</h3>
              <p className="ds-hint">Enable this to bypass the Python backend and fetch data directly from FIN (useful when hosting this viewer inside the FIN framework).</p>
              <div className="ds-field">
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                  <input 
                    type="checkbox" 
                    checked={settings.finDirectMode || false} 
                    onChange={e => update('finDirectMode', e.target.checked)} 
                    style={{ width: 'auto' }}
                  />
                  Use Direct FIN API (No Backend)
                </label>
              </div>

              <h3 className="ds-section-title" style={{ marginTop: '24px' }}>FIN Live Points Mapping</h3>
              <p className="ds-hint">Map your dashboard metrics (e.g. total_power) to specific FIN point IDs.</p>
              
              <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                <button 
                  className="ds-btn ds-btn-secondary" 
                  style={{ padding: '4px 12px', fontSize: '12px' }}
                  onClick={() => update('finLivePoints', DEFAULT_FIN_LIVE_POINTS)}
                >
                  Load Default (EkoMedical)
                </button>
                <button 
                  className="ds-btn ds-btn-secondary" 
                  style={{ padding: '4px 12px', fontSize: '12px' }}
                  onClick={() => update('finLivePoints', SITE_FIN_LIVE_POINTS)}
                >
                  Load Marsa Al Arab
                </button>
              </div>

              <div className="ds-field">
                <textarea 
                  rows={12}
                  style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-primary)', padding: '10px 12px', borderRadius: '6px', fontSize: '13px', fontFamily: 'monospace' }}
                  value={settings.finLivePoints ? JSON.stringify(settings.finLivePoints, null, 2) : JSON.stringify(DEFAULT_FIN_LIVE_POINTS, null, 2)}
                  onChange={e => {
                    try {
                      update('finLivePoints', JSON.parse(e.target.value))
                    } catch(err) {
                      // ignore parse errors while typing
                    }
                  }}
                />
              </div>

              <h3 className="ds-section-title" style={{ marginTop: '24px' }}>FIN Endpoints Mapping</h3>
              <p className="ds-hint">Map history queries (e.g. AHU_Usage_his) to API expressions.</p>

              <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                <button 
                  className="ds-btn ds-btn-secondary" 
                  style={{ padding: '4px 12px', fontSize: '12px' }}
                  onClick={() => update('finEndpoints', DEFAULT_FIN_ENDPOINTS)}
                >
                  Load Default (EkoMedical)
                </button>
                <button 
                  className="ds-btn ds-btn-secondary" 
                  style={{ padding: '4px 12px', fontSize: '12px' }}
                  onClick={() => update('finEndpoints', SITE_FIN_ENDPOINTS)}
                >
                  Load Marsa Al Arab
                </button>
              </div>

              <div className="ds-field">
                <textarea 
                  rows={12}
                  style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-primary)', padding: '10px 12px', borderRadius: '6px', fontSize: '13px', fontFamily: 'monospace' }}
                  value={settings.finEndpoints ? JSON.stringify(settings.finEndpoints, null, 2) : JSON.stringify(DEFAULT_FIN_ENDPOINTS, null, 2)}
                  onChange={e => {
                    try {
                      update('finEndpoints', JSON.parse(e.target.value))
                    } catch(err) {
                      // ignore parse errors while typing
                    }
                  }}
                />
              </div>
            </div>
          )}

          {activeTab === 'nav' && (
            <div className="ds-pane">
              <h3 className="ds-section-title">Header Navigation Buttons</h3>
              <p className="ds-hint">Reorder the buttons shown in the top header bar.</p>
              <div className="ds-list">
                {settings.navButtons?.map((btn, i) => (
                  <div key={btn.id} className="ds-list-item">
                    <div className="ds-list-controls">
                      <button onClick={() => moveItem('navButtons', i, 'up')} disabled={i===0}>▲</button>
                      <button onClick={() => moveItem('navButtons', i, 'down')} disabled={i===(settings.navButtons?.length||0)-1}>▼</button>
                    </div>
                    <div className="ds-list-content">
                      <i className={btn.icon}></i> {btn.tooltip}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'info' && (
            <div className="ds-pane">
              <h3 className="ds-section-title">Left Cards (Date/Time)</h3>
              <div className="ds-list">
                {settings.leftCards?.map((c, i) => (
                  <div key={c.id} className="ds-list-item">
                    <div className="ds-list-controls">
                      <button onClick={() => moveItem('leftCards', i, 'up')} disabled={i===0}>▲</button>
                      <button onClick={() => moveItem('leftCards', i, 'down')} disabled={i===(settings.leftCards?.length||0)-1}>▼</button>
                    </div>
                    <div className="ds-list-content"><i className={c.icon}></i> {c.label}</div>
                  </div>
                ))}
              </div>

              <h3 className="ds-section-title" style={{ marginTop: '24px' }}>Right Cards (Weather/Environment)</h3>
              <div className="ds-list">
                {settings.rightCards?.map((c, i) => (
                  <div key={c.id} className="ds-list-item">
                    <div className="ds-list-controls">
                      <button onClick={() => moveItem('rightCards', i, 'up')} disabled={i===0}>▲</button>
                      <button onClick={() => moveItem('rightCards', i, 'down')} disabled={i===(settings.rightCards?.length||0)-1}>▼</button>
                    </div>
                    <div className="ds-list-content"><i className={c.icon}></i> {c.label}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'side' && (
            <div className="ds-pane">
              <h3 className="ds-section-title">Dashboard Menus</h3>
              <p className="ds-hint">Enable, disable, and reorder the dashboards available in the left side drawer.</p>
              <div className="ds-list">
                {settings.sideButtons?.map((btn, i) => {
                  const isEnabled = btn.enabled !== false;
                  return (
                    <div key={btn.id} className="ds-list-item" style={{ opacity: isEnabled ? 1 : 0.5 }}>
                      <div className="ds-list-controls">
                        <button onClick={() => moveItem('sideButtons', i, 'up')} disabled={i===0}>▲</button>
                        <button onClick={() => moveItem('sideButtons', i, 'down')} disabled={i===(settings.sideButtons?.length||0)-1}>▼</button>
                      </div>
                      <div className="ds-list-content" style={{ flex: 1, gap: '12px' }}>
                        <i className={btn.icon}></i> 
                        <input 
                          type="text" 
                          value={btn.label || ''} 
                          onChange={(e) => renameSideButton(i, e.target.value)}
                          style={{ 
                            background: 'transparent', 
                            border: '1px solid transparent', 
                            color: 'inherit',
                            fontFamily: 'inherit',
                            fontSize: 'inherit',
                            padding: '4px 8px',
                            width: '100%',
                            borderRadius: '4px',
                            outline: 'none'
                          }}
                          onFocus={(e) => e.target.style.border = '1px solid var(--border)'}
                          onBlur={(e) => e.target.style.border = '1px solid transparent'}
                        />
                      </div>
                      <button 
                        className={`ds-toggle-btn ${isEnabled ? 'active' : ''}`}
                        onClick={() => toggleSideButton(i)}
                      >
                        {isEnabled ? 'Enabled' : 'Disabled'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

        </div>

        <div className="dashboard-settings-footer">
          <button className="ds-btn ds-btn-secondary" onClick={onClose}>Cancel</button>
          <button className="ds-btn ds-btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
