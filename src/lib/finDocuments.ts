import { parseCsv } from './finMappingCatalog.ts'
import type { FinDocumentFamily, FinManual } from '../types/index.ts'

/** One equipment group as typed. `id` is kept when the group was already saved. */
export interface DocumentDraft {
  id: string
  name: string
  tags: string
  codes: string
  types: string
  names: string
  omName: string
  omNameAr: string
  omRef: string
  wName: string
  wNameAr: string
  wRef: string
}

const REF = /^@p:[A-Za-z0-9_]+:r:[0-9a-fA-F-]+$/

const CSV_HEAD = [
  'id', 'group', 'tags', 'codes', 'types', 'names',
  'om_name', 'om_name_ar', 'om_ref',
  'warranty_name', 'warranty_name_ar', 'warranty_ref',
] as const

export function splitList(text: string): string[] {
  const out: string[] = []
  for (const part of text.split(/[,;\n]+/)) {
    const item = part.trim()
    if (item && !out.includes(item)) out.push(item)
  }
  return out
}

export function joinList(items: string[] | undefined): string {
  return (items ?? []).join(', ')
}

function refProject(ref: string): string | null {
  const match = /^@p:([^:]+):r:/.exec(ref.trim())
  return match ? match[1] : null
}

function slug(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'group'
}

function uniqueId(preferred: string, fallback: string, used: Set<string>): string {
  const base = preferred.trim() || fallback
  if (!used.has(base)) {
    used.add(base)
    return base
  }
  let n = 2
  while (used.has(`${base}-${n}`)) n += 1
  const next = `${base}-${n}`
  used.add(next)
  return next
}

function sideStarted(name: string, nameAr: string, ref: string): boolean {
  return !!(name.trim() || nameAr.trim() || ref.trim())
}

function blankDraft(): DocumentDraft {
  return {
    id: '', name: '', tags: '', codes: '', types: '', names: '',
    omName: '', omNameAr: '', omRef: '', wName: '', wNameAr: '', wRef: '',
  }
}

function rowStarted(row: DocumentDraft): boolean {
  return !!(
    row.name.trim() || row.tags.trim() || row.codes.trim() || row.types.trim() || row.names.trim()
    || sideStarted(row.omName, row.omNameAr, row.omRef)
    || sideStarted(row.wName, row.wNameAr, row.wRef)
  )
}

/** The first problem in the groups being typed, or null when they can be saved. A blank row is ignored. */
export function draftProblem(rows: DocumentDraft[], finProject: string): string | null {
  const names = new Set<string>()
  for (const [i, row] of rows.entries()) {
    if (!rowStarted(row)) continue
    const at = `Equipment group ${i + 1}${row.name.trim() ? ` (${row.name.trim()})` : ''}`
    if (!row.name.trim()) return `${at}: a name is required.`
    const folded = row.name.trim().toLowerCase()
    if (names.has(folded)) return `${at}: another group already has this name.`
    names.add(folded)
    if (!splitList([row.tags, row.codes, row.types, row.names].join(',')).length) {
      return `${at}: say how to match it — a tag, a code in the asset id, or a word in the type or name.`
    }
    const om = sideStarted(row.omName, row.omNameAr, row.omRef)
    const warranty = sideStarted(row.wName, row.wNameAr, row.wRef)
    if (!om && !warranty) return `${at}: add an O&M manual or a warranty, with its name and FIN record.`
    for (const [label, on, name, ref] of [
      ['O&M manual', om, row.omName, row.omRef],
      ['Warranty', warranty, row.wName, row.wRef],
    ] as const) {
      if (!on) continue
      if (!name.trim()) return `${at}: the ${label} needs the name shown in the drawer.`
      if (!ref.trim()) return `${at}: the ${label} needs its FIN record.`
      if (!REF.test(ref.trim())) return `${at}: the ${label} record must look like @p:project:r:id.`
      const owner = refProject(ref)
      if (finProject && owner !== finProject) {
        return `${at}: the ${label} record belongs to FIN project ${owner}, not ${finProject}.`
      }
    }
  }
  return null
}

function manual(name: string, nameAr: string, ref: string): FinManual | undefined {
  const cleaned = ref.trim()
  if (!name.trim() || !REF.test(cleaned)) return undefined
  const doc: FinManual = { name: name.trim(), ref: cleaned }
  if (nameAr.trim()) doc.nameAr = nameAr.trim()
  return doc
}

/** Groups complete enough to save. Undefined when none are, so the site file stays in use. */
export function familiesFromDrafts(rows: DocumentDraft[]): FinDocumentFamily[] | undefined {
  const used = new Set<string>()
  const out: FinDocumentFamily[] = []
  for (const row of rows) {
    if (!row.name.trim()) continue
    const om = manual(row.omName, row.omNameAr, row.omRef)
    const warranty = manual(row.wName, row.wNameAr, row.wRef)
    if (!om && !warranty) continue
    const fam: FinDocumentFamily = {
      id: uniqueId(row.id, slug(row.name), used),
      label: row.name.trim(),
      tags: splitList(row.tags),
      codes: splitList(row.codes),
      types: splitList(row.types),
      names: splitList(row.names),
    }
    if (om) fam.om = om
    if (warranty) fam.warranty = warranty
    out.push(fam)
  }
  return out.length ? out : undefined
}

const KIND_WORDS: Record<string, string[]> = {
  ahu: ['ahu', 'air handling'],
  fahu: ['fahu', 'fresh air'],
  fcu: ['fcu', 'fan coil'],
  vav: ['vav'],
  fan: ['fan'],
  chiller: ['chiller'],
  boosterpump: ['booster', 'booster pump'],
}

/** Groups suggested from FIN file names such as "O&M Manual-AHU" and "Warranty-AHU". */
export function suggestDocuments(files: { ref: string; name: string }[]): DocumentDraft[] {
  const groups = new Map<string, { label: string; om?: { ref: string; name: string }; w?: { ref: string; name: string } }>()
  for (const file of files) {
    const match = /^(O\s*&\s*M(?:\s+Manual)?|Warranty)\s*[-–—]\s*(.+)$/i.exec(file.name.trim())
    if (!match || !file.ref) continue
    const label = match[2].trim()
    const key = label.toLowerCase().replace(/[^a-z0-9]+/g, '')
    if (!key) continue
    const row = groups.get(key) || { label }
    if (/warranty/i.test(match[1])) row.w = file
    else row.om = file
    groups.set(key, row)
  }
  return [...groups.values()].map(group => {
    const code = group.label.toUpperCase().replace(/[^A-Z0-9]+/g, '')
    const key = code.toLowerCase()
    const words = KIND_WORDS[key] || [group.label.toLowerCase()]
    return {
      id: '',
      name: group.label,
      tags: words[0] || '',
      codes: code,
      types: words.join(', '),
      names: code,
      omName: group.om?.name || '',
      omNameAr: '',
      omRef: group.om?.ref || '',
      wName: group.w?.name || '',
      wNameAr: '',
      wRef: group.w?.ref || '',
    }
  })
}

export function draftsFromFamilies(families: FinDocumentFamily[] | undefined): DocumentDraft[] {
  return (families ?? []).map(fam => ({
    id: fam.id || '',
    name: fam.label || fam.id || '',
    tags: joinList(fam.tags),
    codes: joinList(fam.codes),
    types: joinList(fam.types),
    names: joinList(fam.names),
    omName: fam.om?.name ?? '',
    omNameAr: fam.om?.nameAr ?? '',
    omRef: fam.om?.ref ?? '',
    wName: fam.warranty?.name ?? '',
    wNameAr: fam.warranty?.nameAr ?? '',
    wRef: fam.warranty?.ref ?? '',
  }))
}

function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

export function documentsCsv(families: FinDocumentFamily[] | undefined): string {
  const lines = [CSV_HEAD.join(',')]
  for (const fam of families ?? []) {
    const row = [
      fam.id, fam.label || fam.id, joinList(fam.tags), joinList(fam.codes), joinList(fam.types), joinList(fam.names),
      fam.om?.name ?? '', fam.om?.nameAr ?? '', fam.om?.ref ?? '',
      fam.warranty?.name ?? '', fam.warranty?.nameAr ?? '', fam.warranty?.ref ?? '',
    ]
    lines.push(row.map(csvCell).join(','))
  }
  return lines.join('\n') + '\n'
}

/** The site catalog as written into an export. Null when this project has not saved one. */
export function documentCatalogText(families: FinDocumentFamily[] | undefined): string | null {
  if (!Array.isArray(families)) return null
  return JSON.stringify({ families }, null, 2) + '\n'
}

export function importDocumentsCsv(text: string, finProject: string): { drafts: DocumentDraft[]; error: string | null } {
  const table = parseCsv(text)
  if (!table.length) return { drafts: [], error: 'The CSV is empty.' }
  const head = table[0].map(cell => cell.trim().toLowerCase())
  if (!head.includes('group')) return { drafts: [], error: 'The CSV needs a group column.' }
  const at = (row: string[], name: string) => {
    const index = head.indexOf(name)
    return index >= 0 && index < row.length ? row[index].trim() : ''
  }
  const drafts: DocumentDraft[] = []
  for (const row of table.slice(1)) {
    if (row.every(cell => !cell.trim())) continue
    drafts.push({
      ...blankDraft(),
      id: at(row, 'id'),
      name: at(row, 'group'),
      tags: at(row, 'tags'),
      codes: at(row, 'codes'),
      types: at(row, 'types'),
      names: at(row, 'names'),
      omName: at(row, 'om_name'),
      omNameAr: at(row, 'om_name_ar'),
      omRef: at(row, 'om_ref'),
      wName: at(row, 'warranty_name'),
      wNameAr: at(row, 'warranty_name_ar'),
      wRef: at(row, 'warranty_ref'),
    })
  }
  if (!drafts.length) return { drafts: [], error: 'The CSV has no equipment groups.' }
  const problem = draftProblem(drafts, finProject)
  if (problem) return { drafts: [], error: problem }
  return { drafts, error: null }
}
