import type { MeterLink, PowerBoard, ProjectApiSettings } from '@/types'
import { MAPPING_CATALOG, boardKey, historyExpression, isStandardHistory, meterHistoryKey, meterPrefixes, normalizeRef, pointRefOf } from '@/lib/finMappingCatalog'
import type { JsonObject } from '@/lib/mappingRows'
import { hospitalHvacEnabled } from '@/lib/hospitalHvac'

/** The apiSettings fields edited as JSON in Dashboard Settings → Data Mapping */
export type MappingField =
  | 'finLivePoints'
  | 'finEndpoints'
  | 'finEquipmentClasses'
  | 'finMeterProfile'
  | 'finSeverityBands'

export const MAPPING_FIELDS: MappingField[] = [
  'finLivePoints',
  'finEndpoints',
  'finEquipmentClasses',
  'finMeterProfile',
  'finSeverityBands',
]

export const MAPPING_TITLES: Record<MappingField, string> = {
  finLivePoints: 'Live readings (FIN Live Points)',
  finEndpoints: 'Chart history (FIN Historical Endpoints)',
  finEquipmentClasses: 'Equipment Classes',
  finMeterProfile: 'Meter Profile',
  finSeverityBands: 'Severity Configuration',
}

const isObject = (v: unknown): v is JsonObject =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const isStringArray = (v: unknown) => Array.isArray(v) && v.every(x => typeof x === 'string')

/** Structural check mirroring what the backend reads: a problem sentence, or null when fine. */
export function mappingProblem(field: MappingField, value: JsonObject): string | null {
  const title = MAPPING_TITLES[field]
  const problem = ((): string | null => {
    switch (field) {
      case 'finLivePoints':
      case 'finEndpoints':
        return Object.values(value).every(v => typeof v === 'string') ? null : 'every value must be a string'
      case 'finEquipmentClasses':
        return ['system_tags', 'meter_tags', 'type_priority'].every(k => value[k] === undefined || isStringArray(value[k]))
          ? null
          : 'system_tags, meter_tags and type_priority must be lists of strings'
      case 'finMeterProfile': {
        if (value.prefix !== undefined && typeof value.prefix !== 'string') return 'prefix must be text'
        const map = value.point_map
        if (map === undefined) return null
        return isObject(map) && Object.values(map).every(isStringArray)
          ? null
          : 'point_map must map each metric to a list of strings'
      }
      case 'finSeverityBands':
        if (value.order !== undefined && value.order !== 'asc' && value.order !== 'desc') return 'order must be asc or desc'
        return ['critical', 'warning'].every(k => value[k] === undefined || (typeof value[k] === 'number' && Number.isFinite(value[k])))
          ? null
          : 'critical and warning must be numbers'
    }
  })()
  return problem ? `${title}: ${problem}.` : null
}

export type MappingValues = Partial<Record<MappingField, JsonObject | undefined>>

/** Put each edited block into the settings; a block with no value is removed so the backend default applies. */
export function applyMappingValues(settings: ProjectApiSettings, values: MappingValues): ProjectApiSettings {
  const next: Record<string, unknown> = { ...settings }
  for (const field of MAPPING_FIELDS) {
    if (values[field] === undefined) delete next[field]
    else next[field] = values[field]
  }
  return next as ProjectApiSettings
}

/** apiSettings.schemaVersion written by Save Settings. A project saved before it existed has the
 *  same shape as version 1, so it opens unchanged and is stamped on its next save. */
export const FIN_SETTINGS_VERSION = 1

/** The site timezone when a project sets none: every site so far is in the UAE */
export const DEFAULT_SITE_TIMEZONE = 'Asia/Dubai'

export function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/** A board as typed in the editor: every field text, possibly blank. With `point`, the keys are made from the name. */
export interface PowerBoardRow { name: string; liveKey: string; historyKey: string; meter: string; point: string; history: string }

/** The boards to save: trimmed, wholly blank rows dropped, optional fields left out when empty.
 *  undefined when no board is left, so the project falls back to the built-in boards. */
export function powerBoardsFromRows(rows: PowerBoardRow[]): PowerBoard[] | undefined {
  const out: PowerBoard[] = []
  for (const row of rows) {
    const r = { name: row.name.trim(), liveKey: row.liveKey.trim(), historyKey: row.historyKey.trim(), meter: row.meter.trim(), point: row.point.trim(), history: row.history.trim() }
    if (!r.name && !r.liveKey && !r.historyKey && !r.meter && !r.point) continue
    if (r.point) {
      const key = boardKey(r.name)
      out.push({ name: r.name, liveKey: key, point: r.point, ...(r.history ? { historyKey: `${key}_his`, history: r.history } : {}), ...(r.meter ? { meter: r.meter } : {}) })
    } else {
      out.push({ name: r.name, liveKey: r.liveKey, ...(r.historyKey ? { historyKey: r.historyKey } : {}), ...(r.meter ? { meter: r.meter } : {}) })
    }
  }
  return out.length ? out : undefined
}

export function powerBoardRows(boards: PowerBoard[] | undefined): PowerBoardRow[] {
  return (boards ?? []).map(b => ({
    name: b.name ?? '', liveKey: b.point ? '' : b.liveKey ?? '', historyKey: b.point ? '' : b.historyKey ?? '',
    meter: b.meter ?? '', point: b.point ?? '', history: b.history ?? '',
  }))
}

/** Read as meters even when their name lacks the meter profile's prefix */
export const meterEquipNames = (s: ProjectApiSettings): string[] => (s.finMeters ?? []).map(m => m.equip.trim()).filter(Boolean)

/** Live points and history queries with each board's own point added, for whatever polls FIN with them */
export function pointsWithBoards(s: ProjectApiSettings): { live?: JsonObject; history?: JsonObject } {
  let live = s.finLivePoints
  let history = s.finEndpoints
  for (const b of s.finPowerBoards ?? []) {
    if (!b.point || !b.liveKey) continue
    live = { ...(live ?? {}), [b.liveKey]: b.point }
    if (b.history && b.historyKey) history = { ...(history ?? {}), [b.historyKey]: b.history }
  }
  for (const m of s.finMeters ?? []) {
    const expr = m.history || (m.point ? historyExpression(m.point) : '')
    if (m.name && expr) history = { ...(history ?? {}), [meterHistoryKey(m.name)]: expr }
  }
  return { live, history }
}

/** The Data Mapping keys a board can name: the keys the backend serves this project.
 *  config.json's keys only when the backend reports that it VERIFIED this Eko-DT project as
 *  config.json's site on the server it is signed in to (schema.standardProject/-Id), for the FIN
 *  project in the form; a matching name alone is never enough (another tenant can use the same
 *  name). Otherwise the project's own mapped keys. `unverifiedStandard`: the name matches
 *  config.json's site but nothing verified it, so its standard keys are not accepted. */
export function boardKeyOptions(
  projectId: string,
  finProjectName: string | undefined,
  own: { live?: JsonObject; history?: JsonObject },
  schema: { finLivePoints?: string[]; finEndpoints?: string[]; standardProject?: string; standardProjectId?: string; standardProfile?: string },
): { live: string[]; history: string[]; standard: boolean; unverifiedStandard: boolean } {
  const standard = !!schema.standardProject && schema.standardProjectId === projectId && finProjectName === schema.standardProject
  const unverifiedStandard = !standard && !!finProjectName && finProjectName === schema.standardProfile
  const catalogLive = MAPPING_CATALOG.filter(e => e.block === 'live').map(e => e.key)
  const catalogHistory = MAPPING_CATALOG.filter(e => e.block === 'history').map(e => e.key)
  const join = (...lists: (string[] | undefined)[]) => [...new Set(lists.flatMap(list => list ?? []))]
  return {
    live: join(catalogLive, schema.finLivePoints, Object.keys(own.live ?? {})),
    history: join(catalogHistory, schema.finEndpoints, Object.keys(own.history ?? {})),
    standard,
    unverifiedStandard,
  }
}

/** The first problem with the boards, or null when they can be saved */
export function powerBoardsProblem(
  boards: PowerBoard[] | undefined,
  keys: { live: string[]; history: string[] },
  meterPrefix?: string,
  meters?: MeterLink[],
): string | null {
  const prefixes = meterPrefixes(meterPrefix ?? '')
  const listed = new Set((meters ?? []).flatMap(m => [m.name, m.equip]).map(n => n.trim().toUpperCase()).filter(Boolean))
  const seen = new Set<string>()
  const keysSeen = new Set<string>()
  for (const [i, b] of (boards ?? []).entries()) {
    const at = `Power board ${i + 1}${b.name ? ` (${b.name})` : ''}`
    if (!b.name) return `${at}: a name is required.`
    const folded = b.name.toLowerCase()
    if (seen.has(folded)) return `${at}: another board already has this name.`
    seen.add(folded)
    if (b.point) {
      if (!normalizeRef(b.point)) return `${at}: "${b.point}" is not a FIN point ID.`
      if (keysSeen.has(b.liveKey)) return `${at}: the name is too close to another board's.`
      keysSeen.add(b.liveKey)
      if (b.history && !isStandardHistory(b.history)) return `${at}: its chart history is not a history query for one point.`
    } else {
      if (!b.liveKey) return `${at}: choose its FIN point.`
      if (!keys.live.includes(b.liveKey)) return `${at}: "${b.liveKey}" is not a key of this project's Live readings.`
      if (b.historyKey && !keys.history.includes(b.historyKey)) return `${at}: "${b.historyKey}" is not a key of this project's Chart history.`
    }
    const meter = b.meter?.trim().toUpperCase()
    if (meter && prefixes.length && !prefixes.some(p => meter.startsWith(p)) && ![...listed].some(n => n === meter || n.startsWith(meter + '_'))) {
      return `${at}: meter "${b.meter}" matches no meter prefix (${prefixes.join(', ')}) and is not in Meters. Add it to Meters, or add its prefix in Meter Profile.`
    }
  }
  return null
}

/** The currency shown with costs when a project sets none: every site so far is in the UAE */
export const DEFAULT_CURRENCY = 'AED'

/** A rate that can be used in a calculation: a finite number above zero, else null */
export function rateOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null
}

/** The problem with the reporting-basis fields as entered, or null when they can be saved */
export function basisProblem(s: ProjectApiSettings): string | null {
  for (const [key, label] of [['energyTariff', 'Electricity tariff'], ['gasTariff', 'Gas tariff'], ['co2Factor', 'CO₂ factor']] as const) {
    const v = s[key]
    if (v !== undefined && rateOrNull(v) === null) return `${label} must be a number above zero, or left empty.`
  }
  if (s.currency !== undefined && !/^[A-Z]{3}$/.test(s.currency)) return 'Currency must be a three-letter code such as AED.'
  return null
}

/** What the dashboard is told about the open project, beside its FIN connection settings.
 *  `projectId` lets it drop data the backend polled for another project; `site` names the site
 *  in the dashboard and reports and gives the day boundary for "today" readings; `basis` is the
 *  reporting basis (a rate the project did not set is null, never another site's); `demo` keeps
 *  the prototype's fixture figures on screen. */
export function dashboardProjectInfo(meta: { projectId: string; name: string; apiSettings?: ProjectApiSettings }) {
  const s = meta.apiSettings ?? {}
  return {
    projectId: meta.projectId,
    demo: s.dashboardDemo === true,
    /* the sample data set: the layout, and with demo off the figures the project maps no FIN data for; null = Marsa Al Arab */
    sampleData: s.dashboardSampleData === 'medical' ? 'medical' : null,
    /* the module set: 'extended' or 'standard' */
    modules: s.dashboardModules === 'extended' ? 'extended' : 'standard',
    /* Hospital HVAC graphics: the project whose FIN project is Eko Hospital's (hospitalHvac.ts); the dashboard's equipment mapping reads this too */
    hospitalHvac: hospitalHvacEnabled(meta),
    /* the project's own boards; null = the built-in board keys, where the project maps them */
    powerBoards: Array.isArray(s.finPowerBoards) && s.finPowerBoards.length ? s.finPowerBoards : null,
    /* the project's own meters; null = every meter FIN reports */
    meters: Array.isArray(s.finMeters) && s.finMeters.length
      ? s.finMeters.map(m => ({ name: m.name, equip: m.equip, his: (m.history || m.point) ? meterHistoryKey(m.name) : null, point: m.point || '', main: m.main === true }))
      : null,
    anomalyAllMeters: s.anomalyAllMeters === true,
    energyFromHourly: s.energyFromHourly === true,
    equipPoints: {
      ahuTemp: s.ahuTemp || '',
      ahuSetpoint: s.ahuSetpoint || '',
      fcuTemp: s.fcuTemp || '',
      fcuSetpoint: s.fcuSetpoint || '',
    },
    pointControl: s.pointControl && typeof s.pointControl === 'object' ? s.pointControl : null,
    energyMonthOwn: pointRefOf(s.finLivePoints?.current_month || '') != null
      && pointRefOf(s.finEndpoints?.Hourly_Energy_Consumption_his || '') != null
      && pointRefOf(s.finLivePoints?.current_month || '') !== pointRefOf(s.finEndpoints?.Hourly_Energy_Consumption_his || ''),
    site: {
      name: meta.name,
      displayName: s.finDisplayName || '',
      finProject: s.finProjectName || '',
      timezone: s.siteTimezone && isTimeZone(s.siteTimezone) ? s.siteTimezone : DEFAULT_SITE_TIMEZONE,
    },
    basis: {
      currency: s.currency || DEFAULT_CURRENCY,
      energyTariff: rateOrNull(s.energyTariff),
      tariffName: s.tariffName || '',
      gasTariff: rateOrNull(s.gasTariff),
      co2Factor: rateOrNull(s.co2Factor),
      co2FactorName: s.co2FactorName || '',
    },
    heatmap: s.heatmap && typeof s.heatmap === 'object' ? s.heatmap : null,
  }
}

/** api-config.json, written beside project.json for the standalone FIN viewer (direct mode) */
export function apiConfigFor(settings: ProjectApiSettings | undefined, fallbackName: string) {
  const s = settings ?? {}
  return {
    project_name: s.finProjectName || fallbackName,
    fin_server_url: s.finBaseUrl || 'https://localhost',
    display_name: s.finDisplayName,
    direct_mode: true, // Always true for FIN standalone viewer
    polling_interval: s.finInterval || 5000,
    live_point_ids: pointsWithBoards(s).live || {},
    power_endpoints: pointsWithBoards(s).history || {},
    equipment_classes: s.finEquipmentClasses,
    meter_profile: s.finMeterProfile,
    severity_bands: s.finSeverityBands,
    ...(Array.isArray(s.finDocuments) ? { documents: s.finDocuments } : {}),
    // Only a key the user entered for this project; no shared key is ever written into a project
    weather: {
      lat: s.weatherLat ?? 24.469,
      lon: s.weatherLon ?? 54.358,
      ...(s.weatherApiKey ? { apiKey: s.weatherApiKey } : {}),
    },
    navButtons: s.navButtons,
    leftCards: s.leftCards,
    rightCards: s.rightCards,
    sideButtons: s.sideButtons,
  }
}

/** config.json's FIN mapping blocks: the point IDs of config.json's own site */
const SITE_MAPPING_KEYS = ['live_point_ids', 'power_endpoints', 'equipment_classes', 'meter_profile', 'severity_bands']

/** The backend config.json shipped with an export. The repo file is config.json's own site; a
 *  project of another FIN project gets none of that site's point maps (an exported backend fills a
 *  block the project did not set from config.json, which would read the other site's IDs). */
export function exportedSiteConfig(cfg: JsonObject, settings: ProjectApiSettings | undefined): JsonObject {
  const out: JsonObject = { ...cfg }
  const s = settings ?? {}
  if (s.finProjectName && s.finProjectName !== cfg.project_name) {
    for (const key of SITE_MAPPING_KEYS) out[key] = {}
    out.workorder_expr = ''   // the site's work-order query reads its own table (workOrderMarsa)
  }
  if (s.finProjectName) out.project_name = s.finProjectName
  if (s.finBaseUrl) out.fin_server_url = s.finBaseUrl
  if (s.finInterval) out.polling = { ...(isObject(cfg.polling) ? cfg.polling : {}), live_ms: s.finInterval }
  // The export's Start_Viewer_Windows.bat may set up the local AI assistant (Ollama) on the machine it runs on; chat.local_ai = "auto" is what allows that.
  // An administrator's "off" stays off, and the other chat settings are the repo file's own.
  const chat = isObject(cfg.chat) ? cfg.chat : {}
  out.chat = { ...chat, local_ai: chat.local_ai ?? 'auto' }
  return out
}

/** The FIN viewer export's site blocks. config.json's audited maps only for config.json's own site
 *  (named, same FIN project); another or an unnamed project ships its own saved blocks. */
export function finExportMappings(cfg: JsonObject, settings: ProjectApiSettings | undefined) {
  const s = settings ?? {}
  const site = !!s.finProjectName && s.finProjectName === cfg.project_name
  const pick = <T>(value: unknown, own: T): T =>
    site && isObject(value) && Object.keys(value).length ? (value as T) : own
  return {
    finLivePoints: pick(cfg.live_point_ids, s.finLivePoints || {}),
    finEndpoints: pick(cfg.power_endpoints, s.finEndpoints || {}),
    finMeterProfile: pick(cfg.meter_profile, s.finMeterProfile),
    finSeverityBands: pick(cfg.severity_bands, s.finSeverityBands),
    finEquipmentClasses: pick(cfg.equipment_classes, s.finEquipmentClasses),
    finWorkorderExpr: site && typeof cfg.workorder_expr === 'string' ? cfg.workorder_expr : (s.finWorkorderExpr || ''),
  }
}

/** The part of apiSettings the backend uses to pick a project's FIN configuration.
 *  An allow-list on purpose: the weather key and dashboard layout stay in the browser. */
export function toBackendSettings(settings: ProjectApiSettings | undefined): ProjectApiSettings {
  const s = settings ?? {}
  const out: ProjectApiSettings = {}
  if (s.finBaseUrl) out.finBaseUrl = s.finBaseUrl
  if (s.finProjectName) out.finProjectName = s.finProjectName
  if (s.finDisplayName) out.finDisplayName = s.finDisplayName
  if (s.finInterval) out.finInterval = s.finInterval
  if (typeof s.notificationsCriticalAlarmsEnabled === 'boolean') out.notificationsCriticalAlarmsEnabled = s.notificationsCriticalAlarmsEnabled
  if (s.finWorkorderExpr?.trim()) out.finWorkorderExpr = s.finWorkorderExpr
  for (const field of MAPPING_FIELDS) {
    if (s[field]) Object.assign(out, { [field]: s[field] })
  }
  const energyRef = pointRefOf(out.finLivePoints?.current_month || '')
  const historyRef = pointRefOf(out.finEndpoints?.Hourly_Energy_Consumption_his || '')
  if (energyRef && !historyRef) {
    out.finEndpoints = { ...(out.finEndpoints || {}), Hourly_Energy_Consumption_his: historyExpression(energyRef) }
  }
  // Boards and meters name their own FIN points. The backend only polls history that is in these maps.
  const polled = pointsWithBoards({ ...s, finLivePoints: out.finLivePoints, finEndpoints: out.finEndpoints })
  if (polled.live) out.finLivePoints = polled.live
  if (polled.history) out.finEndpoints = polled.history
  if (Array.isArray(s.finPowerBoards) && s.finPowerBoards.length) out.finPowerBoards = s.finPowerBoards
  if (Array.isArray(s.finMeters) && s.finMeters.length) out.finMeters = s.finMeters
  if (Array.isArray(s.finDocuments)) out.finDocuments = s.finDocuments
  if (s.pointControl && typeof s.pointControl === 'object') out.pointControl = s.pointControl
  return out
}
