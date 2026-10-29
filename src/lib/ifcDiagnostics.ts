/**
 * TEMPORARY, read-only: what a loaded model actually contains, for writing accurate discipline rules.
 * Reached from the browser console as EKO_IFC_DIAGNOSTICS(). Delete this file and its three lines in
 * DashboardOverlay.tsx when the classification work is done.
 *
 * An IFC file is converted to a fragments model when it is loaded (lib/ifcConverter.ts), so the model the
 * application holds answers in IFC terms: class names (IFCSPACE, IFCFURNISHINGELEMENT, ...) and attributes
 * (Name, Description, ObjectType, PredefinedType, ...). Only the query methods the application already uses
 * are called here: getCategories, getItemsOfCategories, getItemsIdsWithGeometry, getItemsData.
 * Nothing is written: no visibility, selection, model data or settings.
 */
import type { Classification, LayerModel } from './layerGroups.ts'

export interface DiagSources {
  models: Array<LayerModel & { type?: string }>
  /** engine.fragments.models.list: modelId -> fragments model */
  fragments: { get(id: string): unknown } | undefined
  loadedInEngine: Record<string, boolean>
  classify: (m: LayerModel) => Classification
}

export interface ClassCount {
  class: string
  all: number
  withGeometry: number
}

export interface SampleRow {
  id: number
  Name?: string
  Description?: string
  ObjectType?: string
  PredefinedType?: string
  Tag?: string
  LongName?: string
}

export interface ModelDiagnostic {
  modelId: string
  fileName: string
  registryType: string
  loadedInEngine: boolean
  engineModelFound: boolean
  classification: { group: string; known: boolean; basis: string }
  totals: { itemsWithGeometry: number | null; classesPresent: number | null; instancesInAllClasses: number | null }
  classes: ClassCount[]
  classesNotListed: number
  spatial: { storeys: Array<{ name?: string; longName?: string; elevation?: string }> }
  /** The most common values, and a few whole rows, for the classes that say what the model is */
  samples: Record<string, { commonNames: Array<[string, number]>; commonObjectTypes: Array<[string, number]>; predefinedTypes: Array<[string, number]>; rows: SampleRow[] }>
  source: string
  errors: string[]
}

const SOURCE = 'fragments model API (getCategories, getItemsOfCategories, getItemsIdsWithGeometry, getItemsData), read-only'
const MAX_CLASSES = 60
const SAMPLED_BY_SIZE = 8
const SAMPLED_BY_KIND = /SPACE|FURNISH|FURNITURE|EQUIPMENT|PROXY|DISTRIBUTION|GEOGRAPHIC|SITE|TRANSPORT|SANITARY|ELECTRIC|LIGHT|FIRE|APPLIANCE|SENSOR|ACTUATOR|CONTROLLER/
const MAX_SAMPLED = 14
const NAMES_READ = 300
const ROWS = 3

const clip = (v: unknown): string | undefined => {
  const raw = v && typeof v === 'object' && 'value' in v ? (v as { value: unknown }).value : v
  if (raw == null || raw === '') return undefined
  const s = String(raw)
  return s.length > 90 ? s.slice(0, 90) + '…' : s
}

const top = (values: Array<string | undefined>, n = 8): Array<[string, number]> => {
  const count = new Map<string, number>()
  for (const v of values) if (v) count.set(v, (count.get(v) ?? 0) + 1)
  return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)
}

const idsOf = (found: unknown): number[] => (Object.values((found as Record<string, number[]>) || {}).flat() as number[])
const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

async function inspect(model: any, entry: ModelDiagnostic): Promise<void> {
  const errors = entry.errors
  let geometry = new Set<number>()
  try {
    const ids: number[] = await model.getItemsIdsWithGeometry()
    geometry = new Set(ids)
    entry.totals.itemsWithGeometry = ids.length
  } catch (err) { errors.push(`getItemsIdsWithGeometry: ${message(err)}`) }

  const idsByClass = new Map<string, number[]>()
  try {
    const categories: string[] = await model.getCategories()
    entry.totals.classesPresent = categories.length
    let instances = 0
    for (const category of categories) {
      try {
        const ids = idsOf(await model.getItemsOfCategories([new RegExp(`^${category.replace(/[^A-Za-z0-9_]/g, '')}$`, 'i')]))
        if (!ids.length) continue
        idsByClass.set(category, ids)
        instances += ids.length
      } catch (err) { errors.push(`getItemsOfCategories ${category}: ${message(err)}`) }
    }
    entry.totals.instancesInAllClasses = instances
  } catch (err) { errors.push(`getCategories: ${message(err)}`) }

  const counts: ClassCount[] = [...idsByClass].map(([cls, ids]) => ({
    class: cls, all: ids.length, withGeometry: ids.filter(id => geometry.has(id)).length,
  })).sort((a, b) => b.withGeometry - a.withGeometry || b.all - a.all)
  const listed = counts.slice(0, MAX_CLASSES)
  for (const c of counts.slice(MAX_CLASSES)) if (SAMPLED_BY_KIND.test(c.class)) listed.push(c)
  entry.classes = listed
  entry.classesNotListed = counts.length - listed.length

  const read = async (ids: number[], attributes: string[]): Promise<any[]> => {
    try {
      return await model.getItemsData(ids, { attributesDefault: false, attributes, relationsDefault: { attributes: false, relations: false } })
    } catch (err) { errors.push(`getItemsData: ${message(err)}`); return [] }
  }

  const storeyIds = idsByClass.get('IFCBUILDINGSTOREY') ?? []
  if (storeyIds.length) {
    const rows = await read(storeyIds, ['Name', 'LongName', 'Elevation'])
    entry.spatial.storeys = rows.map(r => ({ name: clip(r?.Name), longName: clip(r?.LongName), elevation: clip(r?.Elevation) }))
  }

  const wanted = counts.filter(c => c.withGeometry > 0 && c.class !== 'IFCBUILDINGSTOREY')
  const sampled = [...wanted.slice(0, SAMPLED_BY_SIZE), ...wanted.slice(SAMPLED_BY_SIZE).filter(c => SAMPLED_BY_KIND.test(c.class))].slice(0, MAX_SAMPLED)
  for (const c of sampled) {
    const all = idsByClass.get(c.class) ?? []
    const ids = all.filter(id => geometry.has(id)).slice(0, NAMES_READ)
    const rows = await read(ids, ['Name', 'Description', 'ObjectType', 'PredefinedType', 'Tag', 'LongName'])
    entry.samples[c.class] = {
      commonNames: top(rows.map(r => clip(r?.Name))),
      commonObjectTypes: top(rows.map(r => clip(r?.ObjectType))),
      predefinedTypes: top(rows.map(r => clip(r?.PredefinedType))),
      rows: rows.slice(0, ROWS).map((r, i) => ({
        id: ids[i], Name: clip(r?.Name), Description: clip(r?.Description), ObjectType: clip(r?.ObjectType),
        PredefinedType: clip(r?.PredefinedType), Tag: clip(r?.Tag), LongName: clip(r?.LongName),
      })),
    }
  }
}

/**
 * Which models: none given means the ones no rule could place; 'all' means every registered model;
 * a string or list of strings picks models whose file name contains it (any case) or whose id equals it.
 */
export async function runIfcDiagnostics(src: DiagSources, which?: string | string[]): Promise<ModelDiagnostic[]> {
  const picks = which === undefined ? null : (Array.isArray(which) ? which : [which]).map(w => w.toLowerCase())
  const chosen = src.models.filter(m => {
    if (picks === null) return !src.classify(m).known
    if (picks.includes('all')) return true
    return picks.some(w => m.originalFileName.toLowerCase().includes(w) || m.modelId.toLowerCase() === w)
  })
  const out: ModelDiagnostic[] = []
  for (const m of chosen) {
    const c = src.classify(m)
    const model = src.fragments?.get(m.modelId)
    const entry: ModelDiagnostic = {
      modelId: m.modelId, fileName: m.originalFileName, registryType: m.type ?? 'frag',
      loadedInEngine: !!src.loadedInEngine[m.modelId], engineModelFound: !!model,
      classification: { group: c.group, known: c.known, basis: c.basis ?? (c.known ? 'file name' : 'nothing') },
      totals: { itemsWithGeometry: null, classesPresent: null, instancesInAllClasses: null },
      classes: [], classesNotListed: 0, spatial: { storeys: [] }, samples: {}, source: SOURCE, errors: [],
    }
    if (!model) entry.errors.push(m.type === 'glb' ? 'glb model: no IFC classes to read' : 'model is not in the engine yet (still loading?)')
    else await inspect(model, entry).catch(err => entry.errors.push(`inspect: ${message(err)}`))
    out.push(entry)
  }
  if (!out.length) console.warn('[EKO_IFC_DIAGNOSTICS] no model matched. Pass a file-name fragment, a model id, or "all".')
  return out
}
