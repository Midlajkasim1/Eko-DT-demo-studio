// TypeScript interfaces for FIN Framework data
// These match the JSON payloads from the FastAPI backend

export interface FinEquipmentPoint {
  navName: string
  currentValue: string
  status: string
  kind?: 'Bool' | 'Number' | 'Str' | 'Null'
}

export interface FinAlarm {
  alarm: string
  priority: number
}

export interface FinEquipment {
  name: string
  floor: string
  category: 'hvac' | 'cctv'
  inAlarm: boolean
  alarms: FinAlarm[]
  bimId: string
  points: FinEquipmentPoint[]
}

export interface FinEquipLiveResponse {
  timestamp: string | null
  equipment: FinEquipment[]
}

export interface FinFddRule {
  equip: string
  floor: string
  alarms: number
  rules: Record<string, string>
}

/**
 * Live point values are keyed by the backend config's live_point_ids;
 * a failed read is null (never a fake 0).
 */
export interface FinPowerLiveResponse {
  timestamp: string
  hourly_energy: number | null
  total_power: number | null
  peak_demand: number | null
  energy_deviation: number | null
  energy_intensity: number | null
  energy_performance: number | null
  carbon: number | null
  carbon_emission: number | null
  water_consumption: number | null
  current_month: number | null
  previous_month: number | null
  target_monthly: number | null
  target_current: number | null
  comfort_compliance: number | null
  ra_co2: number | null
  ahu: number | null
  fcu: number | null
  boiler: number | null
  chiller: number | null
  cooling_tower: number | null
  vav: number | null
  lighting: number | null
  power_sockets: number | null
  pumps: number | null
  mcc1: number | null
  mcc2: number | null
  avg_temp: number
  avg_hum: number
  avg_co2: number
  unit: string
  /** Served by /api/fin/power-history and spliced in by data-provider, not by power-live */
  power_history?: Record<string, unknown>
  fdd: FinFddRule[]
}

export interface FinStatusResponse {
  connected: boolean
  project_name: string
  server_url: string
  display_name: string
}

export interface FinLoginRequest {
  username: string
  password: string
  server_url?: string
  project_name?: string
}
