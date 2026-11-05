// TypeScript interfaces for FIN Framework data
// These match the JSON payloads from the FastAPI backend

export interface FinEquipmentPoint {
  navName: string
  currentValue: string
  /** FIN's curStatus */
  status: string | null
  kind?: 'Bool' | 'Number' | 'Str' | 'Null'
  /** A Bool point's state and its enum word */
  bool?: boolean | null
  text?: string | null
  alarmPoint?: boolean
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
  /** FIN's equipment record id */
  finId?: string
  type?: string
  tags?: string[]
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
  /** null/absent = not checked. true = the project name resolved on the FIN server and was readable. */
  project_validated?: boolean | null
  /** Where project_name came from. FIN never supplies it: "request" (typed at sign-in),
   *  "project" (the open project's FIN Project Name), "default" (backend config.json, standalone
   *  viewer only) or "unset" (the open project has no FIN Project Name, so nothing is polled). */
  project_source?: 'request' | 'project' | 'default' | 'unset' | null
  /** The Digital Twin project the backend session currently serves */
  project_id?: string | null
}

/** /api/auth/me: who this browser is signed in as. The role is the site's own mapping (null when none). */
export interface FinSession {
  user_id: string
  site: string
  role: string | null
  expires_at: string
}

export interface FinLoginRequest {
  username: string
  password: string
  server_url?: string
  project_name?: string
  /** The open project's FIN configuration, set by the store; never credentials */
  settings?: Record<string, unknown>
  project_id?: string
}
