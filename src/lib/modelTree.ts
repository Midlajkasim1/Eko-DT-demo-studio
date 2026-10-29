/**
 * The dashboard's model tree: discipline > storey > IFC category > element. Each model
 * is built on its own from what a loaded fragments model already answers (`getSpatialStructure`,
 * `getItemsIdsWithGeometry`, `getItemsData`), then filed under its discipline. Nothing here
 * is persisted or scraped a second time, and no discipline, storey or category is assumed.
 */

/** The slice of a fragments model this file reads */
export interface TreeSourceModel {
  getSpatialStructure(): Promise<SpatialNode>
  getItemsIdsWithGeometry(): Promise<number[]>
  getItemsData(localIds: number[], config?: unknown): Promise<unknown[]>
}

/**
 * Fragments' spatial structure alternates two kinds of node. A GROUP has a
 * category and no id; its children are the items of that class. An ITEM has an
 * id and no category (its class is its group's); its children are the groups
 * of whatever it contains: IFCPROJECT > item > IFCSITE > item > ... >
 * IFCBUILDINGSTOREY > item > IFCWALL > wall, wall, ...
 */
export interface SpatialNode {
  category: string | null
  localId: number | null
  children?: SpatialNode[]
}

/** The elements of one IFC category on one storey */
export interface CategoryGroup {
  key: string
  category: string | null
  /** Element ids. A part that only exists inside another element is not listed; it hides with its parent. */
  ids: number[]
  /**
   * What hiding an element hides, for the elements where that is not just their own id:
   * ones with parts that have geometry of their own, or none of their own.
   */
  hideIds: Map<number, number[]>
  /** Elements the user has hidden in the tree */
  hidden: Set<number>
}

export interface StoreyGroup {
  key: string
  /** True for elements no storey contains */
  unassigned: boolean
  /** The storey's own name; empty when the model gives it none */
  name: string
  elevation: number | null
  categories: CategoryGroup[]
}

export interface ModelTreeData {
  modelKey: string
  storeys: StoreyGroup[]
}

export type CheckState = 'checked' | 'unchecked' | 'mixed'

/** Hide state of any node that holds categories */
export interface CategoryHolder {
  categories?: CategoryGroup[]
}

const SPATIAL_CONTAINER = /^IFC(PROJECT|SITE|BUILDING|FACILITY|FACILITYPART|BRIDGE|ROAD|RAILWAY|MARINEFACILITY)$/i
const STOREY = /^IFCBUILDINGSTOREY$/i
/** Spaces are elements in their own right but also hold the things placed in them */
const SPACE_LIKE = /^IFC(SPACE|SPATIALZONE|EXTERNALSPATIALELEMENT)$/i

const text = (row: unknown, key: string): string => {
  const v = (row as Record<string, unknown> | undefined)?.[key]
  const raw = v && typeof v === 'object' && 'value' in v ? (v as { value: unknown }).value : v
  return raw == null || raw === '' ? '' : String(raw)
}

export const elementName = (row: unknown): string => text(row, 'Name') || text(row, 'Tag')

/** "IFCWALLSTANDARDCASE" / "IfcWallStandardCase" -> "Wall Standard Case" / "Wallstandardcase" */
export function categoryLabel(category: string | null): string {
  if (!category) return ''
  const bare = category.replace(/^ifc/i, '')
  if (!bare) return category
  const hasLower = /[a-z]/.test(bare)
  const hasUpper = /[A-Z]/.test(bare)
  const spaced = hasLower && hasUpper ? bare.replace(/([a-z0-9])([A-Z])/g, '$1 $2') : bare.toLowerCase()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/** Every item below this one that has geometry. Marked seen so nothing is listed twice. */
const partsOf = (item: SpatialNode, geometry: Set<number>, seen: Set<number>): number[] => {
  const out: number[] = []
  const stack = [...(item.children ?? [])]
  while (stack.length) {
    const next = stack.pop()!
    if (next.localId != null && !seen.has(next.localId)) {
      seen.add(next.localId)
      if (geometry.has(next.localId)) out.push(next.localId)
    }
    if (next.children) stack.push(...next.children)
  }
  return out
}

/** Pure part of the build: the structure and the geometry ids in, groups out */
export function groupStructure(
  modelKey: string,
  structure: SpatialNode,
  geometry: Set<number>,
  storeyInfo: Map<number, { name: string; elevation: number | null }>,
): StoreyGroup[] {
  const seen = new Set<number>()
  const storeys = new Map<number | null, StoreyGroup>()

  const storeyFor = (storeyId: number | null): StoreyGroup => {
    let storey = storeys.get(storeyId)
    if (!storey) {
      const info = storeyId == null ? null : storeyInfo.get(storeyId)
      storey = {
        key: `${modelKey}:s:${storeyId ?? 'none'}`,
        unassigned: storeyId == null,
        name: info?.name ?? '',
        elevation: info?.elevation ?? null,
        categories: [],
      }
      storeys.set(storeyId, storey)
    }
    return storey
  }

  const groupFor = (storeyId: number | null, category: string | null): CategoryGroup => {
    const storey = storeyFor(storeyId)
    const key = `${storey.key}:c:${category || 'none'}`
    let group = storey.categories.find(c => c.key === key)
    if (!group) {
      group = { key, category, ids: [], hideIds: new Map(), hidden: new Set() }
      storey.categories.push(group)
    }
    return group
  }

  const add = (storeyId: number | null, id: number, category: string | null, item: SpatialNode, withParts: boolean) => {
    if (seen.has(id)) return
    seen.add(id)
    const parts = withParts ? partsOf(item, geometry, seen) : []
    const own = geometry.has(id)
    if (!own && !parts.length) return
    const group = groupFor(storeyId, category)
    group.ids.push(id)
    if (parts.length || !own) group.hideIds.set(id, own ? [id, ...parts] : parts)
  }

  /** `groupCategory` is the class of the group this node sits in, when it sits in one */
  const walk = (node: SpatialNode, groupCategory: string | null, storeyId: number | null) => {
    if (node.localId == null) {
      // A group: its children are items of this class
      node.children?.forEach(child => walk(child, node.category, storeyId))
      return
    }
    const id = node.localId
    const category = node.category ?? groupCategory
    const into = (nextStorey: number | null) => node.children?.forEach(child => walk(child, null, nextStorey))
    if (STOREY.test(category ?? '')) {
      seen.add(id)
      storeyFor(id)
      into(id)
    } else if (SPATIAL_CONTAINER.test(category ?? '')) {
      seen.add(id)
      into(storeyId)
    } else if (SPACE_LIKE.test(category ?? '')) {
      // The space is an element; what it contains belongs to the same storey
      add(storeyId, id, category, node, false)
      into(storeyId)
    } else {
      add(storeyId, id, category, node, true)
    }
  }
  walk(structure, null, null)

  // Geometry the structure never reached
  for (const id of geometry) {
    if (!seen.has(id)) groupFor(null, null).ids.push(id)
  }

  // An empty storey is real, but a row with nothing to toggle is noise
  const kept = [...storeys.values()].filter(s => s.categories.length)
  kept.sort((a, b) => {
    if (a.unassigned !== b.unassigned) return a.unassigned ? 1 : -1
    if (a.elevation != null && b.elevation != null && a.elevation !== b.elevation) return b.elevation - a.elevation
    return 0
  })
  kept.forEach(s => s.categories.sort((a, b) => categoryLabel(a.category).localeCompare(categoryLabel(b.category))))
  return kept
}

/** One worker round trip for the structure, one for the geometry ids, one for the storeys' own rows */
export async function buildModelTree(model: TreeSourceModel, modelKey: string): Promise<ModelTreeData> {
  const [structure, geometryIds] = await Promise.all([model.getSpatialStructure(), model.getItemsIdsWithGeometry()])
  const storeyIds: number[] = []
  const collect = (node: SpatialNode, groupCategory: string | null) => {
    if (node.localId != null && STOREY.test(node.category ?? groupCategory ?? '')) storeyIds.push(node.localId)
    node.children?.forEach(child => collect(child, node.localId == null ? node.category : null))
  }
  collect(structure, null)

  const info = new Map<number, { name: string; elevation: number | null }>()
  if (storeyIds.length) {
    const rows = await model.getItemsData(storeyIds, {
      attributesDefault: false,
      attributes: ['Name', 'LongName', 'Elevation'],
      relationsDefault: { attributes: false, relations: false },
    })
    storeyIds.forEach((id, i) => {
      const elevation = parseFloat(text(rows[i], 'Elevation'))
      info.set(id, { name: text(rows[i], 'Name') || text(rows[i], 'LongName'), elevation: Number.isFinite(elevation) ? elevation : null })
    })
  }
  return { modelKey, storeys: groupStructure(modelKey, structure, new Set(geometryIds), info) }
}

/** Names for a page of elements, one worker call */
export async function loadElementNames(model: TreeSourceModel, ids: number[]): Promise<Map<number, string>> {
  const rows = await model.getItemsData(ids, {
    attributesDefault: false,
    attributes: ['Name', 'Tag'],
    relationsDefault: { attributes: false, relations: false },
  })
  const out = new Map<number, string>()
  ids.forEach((id, i) => {
    const name = elementName(rows[i])
    if (name) out.set(id, name)
  })
  return out
}

/* ---------------------------- visibility state ---------------------------- */

export interface Tally { total: number; hidden: number }

export const tallyCategories = (categories: CategoryGroup[]): Tally => {
  let total = 0
  let hidden = 0
  for (const c of categories) {
    total += c.ids.length
    hidden += c.hidden.size
  }
  return { total, hidden }
}

export const checkStateOf = ({ total, hidden }: Tally): CheckState =>
  hidden === 0 ? 'checked' : hidden >= total ? 'unchecked' : 'mixed'

/** Hide or show every element in these categories */
export function setCategoriesVisible(categories: CategoryGroup[], visible: boolean): void {
  for (const c of categories) {
    if (visible) c.hidden.clear()
    else c.hidden = new Set(c.ids)
  }
}

export function setElementVisible(group: CategoryGroup, id: number, visible: boolean): void {
  if (visible) group.hidden.delete(id)
  else group.hidden.add(id)
}

/** Every geometry item the tree hides on one model: each hidden element and its parts */
export function hiddenItems(data: ModelTreeData): number[] {
  const out: number[] = []
  for (const storey of data.storeys) {
    for (const cat of storey.categories) {
      for (const id of cat.hidden) {
        const list = cat.hideIds.get(id)
        if (list) out.push(...list)
        else out.push(id)
      }
    }
  }
  return out
}

/* ------------------------------ by discipline ------------------------------ */

/** One model's category group, with the model it belongs to; ids are only unique within their model */
export interface Part {
  modelId: string
  group: CategoryGroup
}

/** A category on a storey, across every model of the discipline that has it */
export interface MergedCategory {
  key: string
  category: string | null
  parts: Part[]
  count: number
}

/** A storey of a discipline. Models of the discipline that agree on its name and elevation share it. */
export interface MergedStorey {
  key: string
  unassigned: boolean
  name: string
  elevation: number | null
  categories: MergedCategory[]
}

export interface DisciplineGroup {
  key: string
  discipline: string | null
  storeys: MergedStorey[]
}

/** A built model and the discipline its file belongs to */
export interface DisciplineSource {
  modelId: string
  discipline: string | null
  data: ModelTreeData
}

export const disciplineKey = (discipline: string | null): string => `disc:${discipline ?? 'none'}`

/** Storeys of different models are one storey when they have the same name and elevation */
const storeyIdentity = (modelId: string, s: StoreyGroup): string => {
  if (s.unassigned) return 'none'
  const name = s.name.trim().toLowerCase()
  if (!name && s.elevation == null) return `${modelId}:${s.key}`
  return `${name}|${s.elevation ?? ''}`
}

/**
 * Files the built models under their disciplines. The groups keep pointing at their own model's
 * hidden sets, so a checkbox over several models changes each model's own state.
 */
export function mergeByDiscipline(sources: DisciplineSource[]): DisciplineGroup[] {
  const disciplines = new Map<string, DisciplineGroup>()
  for (const { modelId, discipline, data } of sources) {
    const key = disciplineKey(discipline)
    let d = disciplines.get(key)
    if (!d) {
      d = { key, discipline, storeys: [] }
      disciplines.set(key, d)
    }
    for (const s of data.storeys) {
      const storeyKey = `${key}:s:${storeyIdentity(modelId, s)}`
      let storey = d.storeys.find(x => x.key === storeyKey)
      if (!storey) {
        storey = { key: storeyKey, unassigned: s.unassigned, name: s.name, elevation: s.elevation, categories: [] }
        d.storeys.push(storey)
      } else if (!storey.name) {
        storey.name = s.name
      }
      for (const c of s.categories) {
        const catKey = `${storeyKey}:c:${c.category || 'none'}`
        let cat = storey.categories.find(x => x.key === catKey)
        if (!cat) {
          cat = { key: catKey, category: c.category, parts: [], count: 0 }
          storey.categories.push(cat)
        }
        cat.parts.push({ modelId, group: c })
        cat.count += c.ids.length
      }
    }
  }
  const out = [...disciplines.values()]
  for (const d of out) {
    d.storeys.sort((a, b) => {
      if (a.unassigned !== b.unassigned) return a.unassigned ? 1 : -1
      if (a.elevation != null && b.elevation != null && a.elevation !== b.elevation) return b.elevation - a.elevation
      return 0
    })
    d.storeys.forEach(s => s.categories.sort((a, b) => categoryLabel(a.category).localeCompare(categoryLabel(b.category))))
  }
  return out
}

/** Every model group below these categories */
export const partsOfCategories = (categories: MergedCategory[]): Part[] => categories.flatMap(c => c.parts)

export const tallyParts = (parts: Part[]): Tally => tallyCategories(parts.map(p => p.group))

/** Hide or show every element in these parts, each in its own model */
export const setPartsVisible = (parts: Part[], visible: boolean): void => setCategoriesVisible(parts.map(p => p.group), visible)
