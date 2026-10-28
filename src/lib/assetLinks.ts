import type { AssetLink } from '@/types'

/** IFC GlobalIds are 22 chars of [0-9A-Za-z_$] */
export const isGuid = (id: unknown): id is string => typeof id === 'string' && /^[0-9A-Za-z_$]{22}$/.test(id)

/** FIN names differ from the dashboard's asset ids by the ast- prefix, spaces and dashes ("FCU ANC09 GF 02") */
export const foldName = (id: string) => (id.startsWith('ast-') ? id.substring(4) : id).toUpperCase().replace(/[^A-Z0-9]/g, '')

export interface LinkIndex {
  list: AssetLink[]
  byFold: Map<string, AssetLink>
}

export function indexLinks(links: AssetLink[] | undefined): LinkIndex {
  const list = (links ?? []).filter(l => l.equip && isGuid(l.guid))
  return { list, byFold: new Map(list.map(l => [foldName(l.equip), l])) }
}

/** Words that name each equipment type in a model element's name, type or class */
const TYPE_WORDS: Record<string, string[]> = {
  FCU: ['FCU', 'FAN COIL'],
  AHU: ['AHU', 'AIR HANDLING'],
  FAHU: ['FAHU', 'FRESH AIR'],
  MAHU: ['MAHU', 'MAU', 'MAKE UP AIR', 'MAKEUP AIR'],
  ECO: ['ECO', 'ECOLOGY'],
  VAV: ['VAV'],
  EF: ['EF', 'EXHAUST'],
  PUMP: ['PUMP'],
  HWRP: ['PUMP'],
  LIFT: ['LIFT', 'ELEVATOR', 'IFCTRANSPORTELEMENT'],
  METER: ['METER', 'PMU', 'IFCFLOWMETER'],
  SMDB: ['SMDB', 'DISTRIBUTION BOARD', 'IFCELECTRICDISTRIBUTIONBOARD'],
  MCC: ['MCC', 'MOTOR CONTROL'],
  EMCC: ['EMCC', 'MCC'],
  ATS: ['ATS', 'TRANSFER SWITCH'],
  FACP: ['FACP', 'FIRE ALARM'],
  FM200: ['FM200', 'FM 200'],
}

export const KNOWN_TYPES = Object.keys(TYPE_WORDS)

export interface ModelElement {
  guid: string
  name: string
  objectType: string
  tag: string
  category: string
  modelName: string
}

/** The FIN equipment fields the linking screen reads */
export interface LinkEquipment {
  name: string
  floor?: string
  type?: string
  bimId?: string
  finId?: string
}

export interface Suggestion {
  guid: string
  score: number
  reason: string
}

/** The type a new link starts with: a known name prefix (FCU-…), else FIN's own type */
export function defaultType(eq: LinkEquipment): string {
  const prefix = eq.name.toUpperCase().match(/^[A-Z]+[0-9]*/)?.[0] ?? ''
  if (TYPE_WORDS[prefix]) return prefix
  const letters = prefix.replace(/[0-9]+$/, '')
  if (TYPE_WORDS[letters]) return letters
  const fin = (eq.type || '').toUpperCase()
  return fin && fin !== 'OTHER' ? fin : letters
}

const tokens = (s: string) => s.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean)
// Only whole numbers count: the 1 in "SSO1" is not unit 01
const numbers = (toks: string[]) => toks.filter(t => /^\d+$/.test(t)).map(t => String(parseInt(t, 10)))

export interface PreparedElement {
  el: ModelElement
  folds: string[]
  hay: string
  tokens: Set<string>
  numbers: Set<string>
}

/** Done once per model scan, not once per equipment */
export function prepareElements(elements: ModelElement[]): PreparedElement[] {
  return elements.map(el => {
    const text = `${el.name} ${el.objectType} ${el.tag}`
    // Revit names are "Family:Type:Id"; the type part is usually the equipment's own name
    const parts = [el.name, el.objectType, el.tag, ...el.name.split(':'), ...el.objectType.split(':')]
    const toks = tokens(text)
    return {
      el,
      folds: [...new Set(parts.map(foldName).filter(Boolean))],
      hay: ` ${tokens(`${text} ${el.category}`).join(' ')} `,
      tokens: new Set(toks),
      numbers: new Set(numbers(toks)),
    }
  })
}

function scoreOne(eq: LinkEquipment, eqFold: string, eqTokens: string[], eqLastNumber: string | undefined, words: string[], p: PreparedElement): Suggestion | null {
  if (p.folds.includes(eqFold)) return { guid: p.el.guid, score: 0.99, reason: 'Same name' }
  const shared = eqTokens.filter(t => p.tokens.has(t)).length
  const contains = eqFold.length >= 4 && p.folds.some(f => f.includes(eqFold))
  if (!shared && !contains) return null
  const typeHit = words.length ? (words.some(w => p.hay.includes(` ${w} `)) ? 1 : 0) : 0.5
  const numberHit = eqLastNumber === undefined ? 0.5 : p.numbers.has(eqLastNumber) ? 1 : 0
  let score = 0.45 * (shared / eqTokens.length) + 0.3 * typeHit + 0.25 * numberHit
  if (contains) score = Math.max(score, 0.9)
  else if (words.length && !typeHit) score *= 0.7
  // A different unit number is a different unit, however close the rest of the name is
  if (eqLastNumber !== undefined && !numberHit) score = Math.min(score, 0.4)
  const why = contains ? [`Name contains ${eq.name}`] : [`${shared}/${eqTokens.length} name parts`]
  if (typeHit === 1) why.push('type')
  if (numberHit === 1) why.push('number')
  return { guid: p.el.guid, score: Math.round(score * 100) / 100, reason: why.join(', ') }
}

/** The likeliest model elements for one FIN equipment, best first */
export function suggest(eq: LinkEquipment, elements: PreparedElement[], limit = 3, min = 0.5): Suggestion[] {
  if (isGuid(eq.bimId) && elements.some(p => p.el.guid === eq.bimId)) {
    return [{ guid: eq.bimId, score: 1, reason: 'FIN bimId tag' }]
  }
  const eqFold = foldName(eq.name)
  const eqTokens = tokens(eq.name)
  if (!eqFold || !eqTokens.length) return []
  const nums = numbers(eqTokens)
  const words = TYPE_WORDS[defaultType(eq)] ?? []
  const out: Suggestion[] = []
  for (const p of elements) {
    const s = scoreOne(eq, eqFold, eqTokens, nums[nums.length - 1], words, p)
    if (s && s.score >= min) out.push(s)
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit)
}

/** Links for every unlinked equipment whose best suggestion clears the bar, one element per equipment, best scores first */
export function bestMatches(
  unlinked: LinkEquipment[],
  suggestions: Map<string, Suggestion[]>,
  taken: Set<string>,
  min = 0.8,
): { eq: LinkEquipment; s: Suggestion }[] {
  const pairs = unlinked.flatMap(eq => (suggestions.get(foldName(eq.name)) ?? []).filter(s => s.score >= min).map(s => ({ eq, s })))
  pairs.sort((a, b) => b.s.score - a.s.score)
  const used = new Set(taken)
  const done = new Set<string>()
  const out: { eq: LinkEquipment; s: Suggestion }[] = []
  for (const pair of pairs) {
    const key = foldName(pair.eq.name)
    if (done.has(key) || used.has(pair.s.guid)) continue
    done.add(key)
    used.add(pair.s.guid)
    out.push(pair)
  }
  return out
}

function csvCells(line: string): string[] {
  const cells: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++ }
      else if (c === '"') quoted = false
      else cur += c
    } else if (c === '"') quoted = true
    else if (c === ',') { cells.push(cur); cur = '' }
    else cur += c
  }
  cells.push(cur)
  return cells.map(c => c.trim())
}

const CSV_COLUMNS = ['equip', 'guid', 'type', 'finId', 'element'] as const

function linkFrom(rec: Record<string, unknown>): AssetLink | string {
  const equip = String(rec.equip ?? rec.name ?? rec.id ?? '').trim()
  const guid = String(rec.guid ?? rec.bimId ?? '').trim()
  if (!equip) return 'a link has no equipment name'
  if (!isGuid(guid)) return `"${equip}" has no valid IFC GlobalId`
  const link: AssetLink = { equip, guid, type: String(rec.type ?? '').trim() || defaultType({ name: equip }) }
  if (rec.finId) link.finId = String(rec.finId).trim()
  if (rec.element) link.element = String(rec.element).trim()
  return link
}

/** A JSON list of links, the old { name: { bimId, type } } table, or CSV with an equip,guid,type,finId,element header */
export function parseLinks(text: string): { links?: AssetLink[]; error?: string } {
  const trimmed = text.trim()
  if (!trimmed) return { error: 'Nothing to import.' }
  const out: AssetLink[] = []
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch (e) {
      return { error: `Invalid JSON. ${e instanceof Error ? e.message : ''}`.trim() }
    }
    if (Array.isArray(parsed)) {
      for (const rec of parsed) {
        const link = typeof rec === 'object' && rec ? linkFrom(rec as Record<string, unknown>) : 'every entry must be an object'
        if (typeof link === 'string') return { error: `Not imported: ${link}.` }
        out.push(link)
      }
    } else if (parsed && typeof parsed === 'object') {
      // Old table: entries with no element only carried a type, so they are not links
      for (const [equip, rec] of Object.entries(parsed as Record<string, { bimId?: unknown; type?: unknown }>)) {
        if (!rec || !isGuid(rec.bimId)) continue
        const link = linkFrom({ equip, guid: rec.bimId, type: rec.type })
        if (typeof link !== 'string') out.push(link)
      }
    }
  } else {
    const lines = trimmed.split(/\r?\n/).filter(l => l.trim())
    const header = csvCells(lines[0]).map(h => h.toLowerCase())
    const col = Object.fromEntries(CSV_COLUMNS.map(c => [c, header.indexOf(c.toLowerCase())]))
    if (col.equip < 0 || col.guid < 0) return { error: 'The CSV needs a header row with at least equip and guid.' }
    for (const [i, line] of lines.slice(1).entries()) {
      const cells = csvCells(line)
      const rec = Object.fromEntries(CSV_COLUMNS.filter(c => col[c] >= 0).map(c => [c, cells[col[c]] ?? '']))
      const link = linkFrom(rec)
      if (typeof link === 'string') return { error: `Not imported: line ${i + 2}: ${link}.` }
      out.push(link)
    }
  }
  return out.length ? { links: out } : { error: 'No links found.' }
}

/** Imported links replace the ones for the same equipment */
export function mergeLinks(current: AssetLink[], incoming: AssetLink[]): { links: AssetLink[]; added: number; replaced: number } {
  const byFold = new Map(current.map(l => [foldName(l.equip), l]))
  let added = 0
  let replaced = 0
  for (const link of incoming) {
    const key = foldName(link.equip)
    if (byFold.has(key)) replaced++
    else added++
    byFold.set(key, link)
  }
  return { links: [...byFold.values()], added, replaced }
}

export function linksToCsv(links: AssetLink[]): string {
  const cell = (v: string | undefined) => (/[",\n]/.test(v ?? '') ? `"${(v ?? '').replace(/"/g, '""')}"` : v ?? '')
  return [CSV_COLUMNS.join(','), ...links.map(l => CSV_COLUMNS.map(c => cell(l[c])).join(','))].join('\n') + '\n'
}
