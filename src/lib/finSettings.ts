import type { ProjectApiSettings } from '@/types'
import type { JsonObject } from '@/lib/mappingRows'

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
  finLivePoints: 'FIN Live Points Mapping',
  finEndpoints: 'FIN Historical Endpoints',
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

/** The part of apiSettings the backend uses to pick a project's FIN configuration.
 *  An allow-list on purpose: the weather key and dashboard layout stay in the browser. */
export function toBackendSettings(settings: ProjectApiSettings | undefined): ProjectApiSettings {
  const s = settings ?? {}
  const out: ProjectApiSettings = {}
  if (s.finBaseUrl) out.finBaseUrl = s.finBaseUrl
  if (s.finProjectName) out.finProjectName = s.finProjectName
  if (s.finDisplayName) out.finDisplayName = s.finDisplayName
  if (s.finInterval) out.finInterval = s.finInterval
  for (const field of MAPPING_FIELDS) {
    if (s[field]) Object.assign(out, { [field]: s[field] })
  }
  return out
}
