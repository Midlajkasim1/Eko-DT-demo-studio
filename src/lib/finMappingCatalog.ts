import type { FinResource } from '@/lib/finProjects'
import type { JsonObject } from '@/lib/mappingRows'

/** live = FIN Live Points (one point per key), history = FIN Historical Endpoints (a hisRead query per key) */
export type MappingBlock = 'live' | 'history'

export interface CatalogEntry {
  key: string
  block: MappingBlock
  group: string
  label: string
  /** Where the dashboard shows it, and in what unit */
  shows: string
  /** Units a fitting FIN point has; a point with another unit ranks lower */
  units?: string[]
  /** Str for a FIN status word; otherwise a Number point fits */
  kind?: 'Str'
  /** FIN point names that fit, folded (lower case, letters and digits only) */
  words: string[]
  /** false: in the backend's key list, but no dashboard page reads it */
  used: boolean
}

export const GROUP_UNUSED = 'Not shown on the dashboard yet'
export const GROUP_MARSA = 'Marsa Al Arab boards'

const live = (key: string, group: string, label: string, shows: string, words: string[], units?: string[], kind?: 'Str'): CatalogEntry =>
  ({ key, block: 'live', group, label, shows, words, units, kind, used: group !== GROUP_UNUSED })
const hist = (key: string, group: string, label: string, shows: string, words: string[], units?: string[]): CatalogEntry =>
  ({ key, block: 'history', group, label, shows, words, units, used: group !== GROUP_UNUSED })

const ENERGY = 'Energy and power'
const KPIS = 'Energy KPIs'
const COMFORT = 'Comfort and air'
const UTIL = 'Water and gas'
const CHARTS = 'Charts'

const BOARDS: [string, string, string][] = [
  ['mcc1', 'Hourly_EC_MCC1_his', 'MCC 1'], ['mcc2', 'Hourly_EC_MCC2_his', 'MCC 2'], ['smdb_kit', 'Hourly_EC_SMDB_KIT_his', 'Kitchen SMDB'],
  ['lvfp', 'Hourly_EC_LVFP_his', 'LVFP'], ['ats', 'Hourly_EC_ATS_his', 'ATS'], ['sump_pump', 'Hourly_EC_SP_his', 'Sump pump'],
]

export const MAPPING_CATALOG: CatalogEntry[] = [
  live('hourly_energy', ENERGY, 'Building load now', 'Load now on the Overview and Energy pages, in kW. An hourly kWh reading also fits: one hour\'s kWh is that hour\'s average kW.',
    ['hourlyenergyconsumption', 'activepower', 'totalpower', 'hourlyenergy'], ['kW', 'kWh']),
  live('total_power', ENERGY, 'Total power (fallback)', 'Used for the load now only when Building load now is not mapped, in kW.',
    ['totalpower', 'activepower', 'hourlyenergyconsumption'], ['kW', 'kWh']),
  live('peak_demand', ENERGY, 'Peak demand today', 'Today\'s highest demand on the Energy and Power pages, in kW.', ['peakdemand', 'maxdemand'], ['kW']),
  live('current_month', ENERGY, 'Energy this month', 'Month to date on the Energy page, in kWh.', ['currentmonth', 'monthtodate', 'monthlyenergy', 'mtdenergy'], ['kWh', 'MWh']),
  live('carbon', ENERGY, 'Carbon emissions', 'Carbon on the Energy page, in kg CO₂ per hour.', ['carbonemissions', 'carbonemission', 'carbon', 'co2emissions'], ['kg', 'kgCO2', 'kgCO₂']),
  live('energy_performance', KPIS, 'Energy performance', 'Performance on the Energy page, in %.', ['energyperformance'], ['%']),
  live('energy_deviation', KPIS, 'Energy deviation', 'The energy deviation gauge on the Energy page, in %.', ['energydeviation'], ['%']),
  live('after_hours_deviation', KPIS, 'Overnight load against normal', 'Overnight card on the Energy page, in %.', ['afterhoursdeviation', 'overnightdeviation'], ['%']),
  live('kpi_after_hours_ratio', KPIS, 'Overnight status', 'The status word FIN\'s KPI gives the overnight card (for example Normal).', ['kpiafterhoursratio', 'afterhoursratio'], undefined, 'Str'),
  live('hvac_epr', KPIS, 'HVAC energy performance ratio', 'HVAC performance card on the Energy page.', ['hvacepr', 'hvacenergyperformanceratio'], undefined),
  live('kpi_hvac_epr', KPIS, 'HVAC performance status', 'The status word FIN\'s KPI gives the HVAC performance card.', ['kpihvacepr'], undefined, 'Str'),
  live('energy_loss_idle', KPIS, 'Energy lost to idle load', 'Waste on the overnight card, in kWh.', ['energylossidle', 'idleloss'], ['kWh']),
  live('energy_loss_hvac', KPIS, 'Energy lost to HVAC performance', 'Waste on the HVAC card, in kWh.', ['energylosshvac', 'hvacloss'], ['kWh']),
  live('cost_impact_idle', KPIS, 'Cost of idle load', 'Cost on the overnight card, in the project currency.', ['costimpactidle']),
  live('cost_impact_hvac', KPIS, 'Cost of HVAC performance', 'Cost on the HVAC card, in the project currency.', ['costimpacthvac']),
  live('comfort_compliance', COMFORT, 'Comfort index', 'Comfort on the Overview and Spaces pages, in %.', ['thermalcomfortcompliance', 'comfortcompliance', 'comfortindex', 'comfort'], ['%']),
  live('iaq_index', COMFORT, 'Indoor air quality index', 'IAQ on the Overview and Spaces pages, 0 to 100.', ['iaqindex', 'iaq', 'indoorairquality']),
  live('temp_deviation', COMFORT, 'Temperature deviation index', 'HVAC card on the Systems page.', ['tempdeviation', 'temperaturedeviation'], ['°C', 'K', '%']),
  live('total_water', UTIL, 'Water today', 'Water today on the Overview, in m³.', ['waterconsumption', 'totalwater', 'waterusage'], ['m³', 'm3']),
  live('total_gas', UTIL, 'Gas today', 'Gas today on the Overview and Gas page, in m³.', ['gasconsumption', 'totalgas'], ['m³', 'm3']),
  ...BOARDS.map(([k, , name]) => live(k, GROUP_MARSA, name, `Marsa Al Arab's built-in ${name} board, kW now on the Power page. For another site, add your own key and list it under Power Boards.`, [k], ['kW', 'kWh'])),
  live('energy_intensity', GROUP_UNUSED, 'Energy use intensity', '', ['energyuseintensity', 'eui', 'hvaceui'], ['kWh/m²']),
  live('after_hours_load', GROUP_UNUSED, 'After-hours load', '', ['afterhoursload'], ['kW', 'kWh']),
  live('daily_energy', GROUP_UNUSED, 'Energy today', '', ['dailyenergy', 'dailyenergyconsumption'], ['kWh']),
  live('target_monthly', GROUP_UNUSED, 'Monthly energy target', '', ['targetmonthly', 'monthlytarget'], ['kWh']),
  live('target_current', GROUP_UNUSED, 'Energy target to date', '', ['targetcurrent'], ['kWh']),
  ...['mcc1', 'mcc2', 'lvfp', 'ats', 'sp', 'smdb'].map(b => live(`peak_demand_${b}`, GROUP_UNUSED, `Peak demand, ${b.toUpperCase()}`, '', [`peakdemand${b}`], ['kW'])),
  live('saving_idle_load', GROUP_UNUSED, 'Saving from idle load', '', ['savingidleload'], ['kWh']),
  live('saving_hvac_epr', GROUP_UNUSED, 'Saving from HVAC performance', '', ['savinghvacepr'], ['kWh']),
  live('avg_zone_temp', GROUP_UNUSED, 'Average zone temperature', '', ['avgzonetemp', 'averagezonetemp'], ['°C']),
  live('avg_zone_temp_sp', GROUP_UNUSED, 'Average zone set point', '', ['avgzonetempsp'], ['°C']),
  live('ra_co2', GROUP_UNUSED, 'Return air CO₂', '', ['raco2', 'returnairco2'], ['ppm']),

  hist('Hourly_Energy_Consumption_his', CHARTS, 'Energy by hour', 'Energy today, the hourly chart and the 7-day trend. Each sample is that hour\'s kWh.',
    ['hourlyenergyconsumption', 'energyconsumption', 'hourlyenergy'], ['kWh']),
  hist('Total_Power_Consumption_his', CHARTS, 'Energy by hour (fallback)', 'Used only when Energy by hour is not mapped, kWh each hour.', ['totalpowerconsumption', 'hourlyenergyconsumption'], ['kWh']),
  hist('Peak_Demand_his', CHARTS, 'Peak demand history', 'Peak demand by hour, week and month on the Power page, in kW.', ['peakdemand'], ['kW']),
  hist('Total_Water_Consumption_his', CHARTS, 'Water meter history', 'Water by hour, day and month on the Water page. The meter\'s running total, in m³.', ['waterconsumption', 'totalwaterconsumption'], ['m³', 'm3']),
  hist('Total_Gas_Consumption_his', CHARTS, 'Gas meter history', 'Gas by hour, day and month on the Gas page. The meter\'s running total, in m³.', ['gasconsumption', 'totalgasconsumption'], ['m³', 'm3']),
  ...BOARDS.map(([k, h, name]) => hist(h, GROUP_MARSA, name, `Marsa Al Arab's built-in ${name} board, kWh each hour. For another site, add your own key and list it under Power Boards.`, [k], ['kWh'])),
  hist('Energy_Deviation_his', GROUP_UNUSED, 'Energy deviation history', '', ['energydeviation'], ['%']),
  hist('Energy_Use_Intensity_his', GROUP_UNUSED, 'Energy use intensity history', '', ['energyuseintensity', 'hvaceui'], ['kWh/m²']),
  hist('Carbon_Emissions_his', GROUP_UNUSED, 'Carbon emissions history', '', ['carbonemissions'], ['kg']),
  hist('Daily_Energy_Consumption_his', GROUP_UNUSED, 'Energy by day', '', ['dailyenergyconsumption'], ['kWh']),
  hist('After_Hours_Load_his', GROUP_UNUSED, 'After-hours load history', '', ['afterhoursload'], ['kW', 'kWh']),
]

export const LIVE_GROUPS = [ENERGY, KPIS, COMFORT, UTIL, GROUP_MARSA, GROUP_UNUSED]
export const HISTORY_GROUPS = [CHARTS, GROUP_MARSA, GROUP_UNUSED]

export const catalogFor = (block: MappingBlock) => MAPPING_CATALOG.filter(e => e.block === block)
export const catalogEntry = (block: MappingBlock, key: string) => MAPPING_CATALOG.find(e => e.block === block && e.key === key)

export const foldName = (s: string) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')

/** A FIN point as the editor shows it: the equipment and point names FIN uses, without the site name in front */
export interface PointView {
  ref: string
  equip: string
  point: string
  unit: string
  kind: string
  his: boolean
  /** FIN's own display name, as in the point list */
  fin: string
  search: string
}

/** The site name every equipment name starts with ("HOSPITAL "), or '' */
export function sitePrefix(points: FinResource[]): string {
  const firsts = points.map(p => (p.equip || '').split(' ')).filter(w => w.length > 1).map(w => w[0])
  if (firsts.length < 2) return ''
  const counts = new Map<string, number>()
  firsts.forEach(w => counts.set(w, (counts.get(w) ?? 0) + 1))
  const [top, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
  return n >= firsts.length * 0.6 ? top + ' ' : ''
}

const stripMacro = (s: string) => s.replace(/^\\?\$\w+Ref\s+/, '')

export function pointView(r: FinResource, prefix: string): PointView {
  const equipFull = r.equip || ''
  const equip = prefix && equipFull.startsWith(prefix) ? equipFull.slice(prefix.length) : equipFull
  let point = stripMacro(r.navName || r.name || '')
  for (const lead of [equipFull + ' ', equip + ' ']) if (lead.trim() && point.startsWith(lead)) point = point.slice(lead.length)
  if (prefix && point.startsWith(prefix)) point = point.slice(prefix.length)
  const fin = /\$/.test(r.name || '') ? `${equipFull} ${point}`.trim() : (r.name || '')
  const view = { ref: r.ref, equip, point: point || r.ref, unit: r.unit || '', kind: r.kind || '', his: !!r.his, fin }
  return { ...view, search: `${equip} ${point} ${view.unit} ${fin} ${r.ref}`.toLowerCase() }
}

export const pointViews = (points: FinResource[] | undefined): PointView[] => {
  const list = points ?? []
  const prefix = sitePrefix(list)
  return list.map(p => pointView(p, prefix)).sort((a, b) => pointTitle(a).localeCompare(pointTitle(b), undefined, { numeric: true }))
}

export const pointTitle = (v: PointView) => (v.equip ? `${v.equip} › ${v.point}` : v.point)

/** How well a point fits a key; 0 or less does not fit. A history key only takes a point that keeps history. */
export function pointScore(entry: CatalogEntry, v: PointView): number {
  if (entry.block === 'history' && !v.his) return 0
  const name = foldName(v.point)
  let score = 0
  entry.words.forEach((w, i) => {
    const bonus = Math.max(0, 3 - i)
    if (name === w) score = Math.max(score, 12 + bonus)
    else if (name.includes(w)) score = Math.max(score, 7 + bonus)
  })
  if (!score) return 0
  if (entry.units?.length && v.unit) score += entry.units.includes(v.unit) ? 4 : -5
  const wantStr = entry.kind === 'Str'
  if (v.kind === 'Bool') score -= 10
  else if (v.kind === 'Str' && !wantStr) score -= 10
  else if (v.kind === 'Number' && wantStr) score -= 4
  if (/fd&d|fault|alarm/i.test(v.point)) score -= 6
  return score
}

export function rankPoints(entry: CatalogEntry, views: PointView[], max = 5): PointView[] {
  return views.map(v => ({ v, s: pointScore(entry, v) })).filter(x => x.s >= 8)
    .sort((a, b) => b.s - a.s || pointTitle(a.v).localeCompare(pointTitle(b.v))).slice(0, max).map(x => x.v)
}

/** Any spelling of a point ID (@p:ekoHospital:r:…, p:{project}:r:…, r:…, the bare ref) as a mapping stores it */
export function normalizeRef(text: string): string | null {
  const s = String(text || '').trim().replace(/^@/, '').replace(/^"|"$/g, '')
  let m = /^p:[^:\s]+:r:([\w.-]+)$/.exec(s)
  if (m) return `p:{project}:r:${m[1]}`
  m = /^r:([\w.-]+)$/.exec(s)
  if (m) return `p:{project}:r:${m[1]}`
  if (/^[0-9a-f]{8}-[0-9a-f]{8}$/i.test(s)) return `p:{project}:r:${s}`
  return null
}

/** The point a stored value names: a live point ID, or the point a hisRead query reads */
export function pointRefOf(value: string): string | null {
  const direct = normalizeRef(value)
  if (direct) return direct
  let text = String(value || '')
  try { text = decodeURIComponent(text.replace(/\+/g, ' ')) } catch { /* read it as written */ }
  const m = /(?:hisRead|readById)\(@?(p:[^:,)\s]+:r:[\w.-]+)/.exec(text)
  return m ? normalizeRef(m[1]) : null
}

/** The history query the backend reads for a point: the same shape as config.json's, from the first of the month six months back */
export function historyExpression(ref: string, now = new Date()): string {
  const start = new Date(now.getFullYear(), now.getMonth() - 6, 1)
  const ymd = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-01`
  return `/api/{project}/eval?expr=hisRead(@${ref},${ymd}..today()%2C%7B-limit%7D)`
}

/** A query in historyExpression's shape (any start date), so the point alone describes it */
export const isStandardHistory = (value: string) =>
  /^\/api\/\{project\}\/eval\?expr=hisRead\(@p:\{project\}:r:[\w.-]+,\d{4}-\d{2}-\d{2}\.\.today\(\)%2C%7B-limit%7D\)$/.test(value)

/** A point named as people write it: "AHU_01 › RA Temp", "AHU_01/RA Temp", or FIN's display name */
export function findPointByName(text: string, views: PointView[]): PointView | null {
  const want = foldName(text)
  if (!want) return null
  return views.find(v => foldName(pointTitle(v)) === want || foldName(v.fin) === want || foldName(`${v.equip} ${v.point}`) === want) ?? null
}

/* ------------------------------------------------------------------ CSV */

export function toCsv(rows: string[][]): string {
  const cell = (s: string) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
  return rows.map(r => r.map(c => cell(String(c ?? ''))).join(',')).join('\r\n') + '\r\n'
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  const s = text.replace(/^\uFEFF/, '')
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { cell += '"'; i++ }
      else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(cell); cell = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++
      row.push(cell); cell = ''
      if (row.some(x => x.trim())) rows.push(row)
      row = []
    } else cell += c
  }
  row.push(cell)
  if (row.some(x => x.trim())) rows.push(row)
  return rows
}

const MAPPING_HEADER = ['block', 'key', 'reading', 'shown_on_dashboard', 'fin_point_id', 'fin_point_name', 'unit']

/** Every key of both blocks, with the point each one is mapped to now. The same columns import back. */
export function mappingCsv(liveValue: JsonObject | undefined, historyValue: JsonObject | undefined, views: PointView[], extraKeys: { live?: string[]; history?: string[] } = {}): string {
  const byRef = new Map(views.map(v => [v.ref, v]))
  const rows: string[][] = [MAPPING_HEADER]
  for (const [block, value, extra] of [['live', liveValue, extraKeys.live], ['history', historyValue, extraKeys.history]] as const) {
    const keys = [...catalogFor(block).map(e => e.key), ...(extra ?? []), ...Object.keys(value ?? {})]
    for (const key of keys.filter((k, i) => keys.indexOf(k) === i)) {
      const entry = catalogEntry(block, key)
      const raw = typeof value?.[key] === 'string' ? (value[key] as string) : ''
      const ref = raw ? pointRefOf(raw) : null
      const view = ref ? byRef.get(ref) : undefined
      const id = block === 'history' && !isStandardHistory(raw) ? raw : (ref ?? raw)
      rows.push([block, key, entry?.label ?? '', entry ? (entry.used ? 'yes' : 'no') : 'own key', id, view ? pointTitle(view) : '', view?.unit ?? ''])
    }
  }
  return toCsv(rows)
}

export function pointListCsv(views: PointView[]): string {
  return toCsv([['fin_point_id', 'equipment', 'point', 'unit', 'kind', 'keeps_history', 'fin_name'],
    ...views.map(v => [v.ref, v.equip, v.point, v.unit, v.kind, v.his ? 'yes' : 'no', v.fin])])
}

export interface CsvImport {
  live: Record<string, string>
  history: Record<string, string>
  applied: number
  /** rows whose point could not be found by its name */
  unresolved: string[]
  error?: string
}

const BLOCK_NAMES: Record<string, MappingBlock> = {
  live: 'live', readings: 'live', finlivepoints: 'live', livepoints: 'live',
  history: 'history', finendpoints: 'history', endpoints: 'history', historicalendpoints: 'history',
}

/** A mapping CSV back into entries. A blank point leaves the key as it is; a history point becomes its hisRead query. */
export function importMappingCsv(text: string, views: PointView[], now = new Date()): CsvImport {
  const out: CsvImport = { live: {}, history: {}, applied: 0, unresolved: [] }
  const rows = parseCsv(text)
  if (!rows.length) return { ...out, error: 'The file is empty.' }
  const head = rows[0].map(h => foldName(h))
  const col = (...names: string[]) => head.findIndex(h => names.includes(h))
  const cBlock = col('block'), cKey = col('key'), cId = col('finpointid', 'finpoint', 'pointid', 'value'), cName = col('finpointname', 'pointname')
  if (cKey < 0 || (cId < 0 && cName < 0)) return { ...out, error: 'The file needs a key column and a fin_point_id or fin_point_name column.' }
  for (const r of rows.slice(1)) {
    const key = (r[cKey] ?? '').trim()
    if (!key) continue
    const blockText = cBlock >= 0 ? foldName(r[cBlock] ?? '') : ''
    const block: MappingBlock | undefined = BLOCK_NAMES[blockText] ?? (cBlock < 0 ? (/_his$/i.test(key) ? 'history' : 'live') : undefined)
    if (!block) continue
    const idText = cId >= 0 ? (r[cId] ?? '').trim() : ''
    const nameText = cName >= 0 ? (r[cName] ?? '').trim() : ''
    const asValue = (ref: string) => (block === 'history' ? historyExpression(ref, now) : ref)
    let value: string | null = null
    if (block === 'history' && idText.startsWith('/')) value = idText
    else if (idText && normalizeRef(idText)) value = asValue(normalizeRef(idText) as string)
    else {
      const named = findPointByName(nameText || idText, views)
      if (named) value = asValue(named.ref)
      else if (idText && block === 'live') value = idText
      else if (idText || nameText) { out.unresolved.push(`${key}: ${nameText || idText}`); continue }
    }
    if (!value) continue
    out[block][key] = value
    out.applied++
  }
  return out
}
