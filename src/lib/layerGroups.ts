/**
 * The dashboard's Layers tool: which models belong to which discipline, and what a layer choice
 * shows. The registry (useModelStore) is the project's model list; nothing here keeps a list of
 * its own, so a project switch or a late-loading model only means calling these again.
 *
 * Discipline comes from the file name. The registry holds no discipline field, so there is no
 * better source to prefer.
 */
import { TOKEN } from './modelDiscipline.ts'

export type LayerGroupId = 'arch' | 'elec' | 'int' | 'mech' | 'str' | 'site' | 'land' | 'other'

/** Menu order. Other comes last and only exists when a model's name matched nothing. */
export const GROUP_ORDER: LayerGroupId[] = ['arch', 'elec', 'int', 'mech', 'str', 'site', 'land', 'other']

/* Whole tokens only. The short forms are the ones the Tree Viewer already understands
   (modelDiscipline.TOKEN); the long forms are what discipline files are usually called. */
const WORDS: Record<string, LayerGroupId> = {
  ...TOKEN,
  ELECTRICAL: 'elec', ELECTRIC: 'elec',
  MECHANICAL: 'mech', MECH: 'mech',
  ARCHITECTURE: 'arch', ARCHITECTURAL: 'arch',
  STRUCTURE: 'str', STRUCTURES: 'str',
  INTERIOR: 'int', INTERIORS: 'int',
  LANDSCAPE: 'land', LANDSCAPING: 'land',
  SITE: 'site',
}

/** "ID" and "IN" are ordinary words and identifiers; they only count when they stand alone ("ID2024" is not Interior) */
const NOT_WITH_DIGITS = new Set(['ID', 'IN'])

export interface Classification {
  group: LayerGroupId
  /** False when no part of the name matched: the model sits in Other and wants a look */
  known: boolean
}

/**
 * Case-insensitive, token-based: "Electrical Large.frag", "NBU_ME_01", "ElectricalSmall" and "ELEC2"
 * are Electrical, Mechanical, Electrical, Electrical. "Website" is not Site. The first matching token wins.
 */
export function classifyModel(fileName: string): Classification {
  const base = String(fileName || '').replace(/\.(ifc|frag|glb|gltf)$/i, '')
  const tokens = base.replace(/([a-z])([A-Z])/g, '$1 $2').toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean)
  for (const token of tokens) {
    const bare = token.replace(/\d+$/, '')
    const hit = WORDS[token] ?? (bare && bare !== token && !NOT_WITH_DIGITS.has(bare) ? WORDS[bare] : undefined)
    if (hit) return { group: hit, known: true }
  }
  return { group: 'other', known: false }
}

export interface LayerModel {
  modelId: string
  originalFileName: string
}

export interface LayerGroup {
  id: LayerGroupId
  modelIds: string[]
}

/** A model registered twice is one model: the first registration stands */
function unique<T extends LayerModel>(models: T[]): T[] {
  const seen = new Set<string>()
  return models.filter(m => (seen.has(m.modelId) ? false : (seen.add(m.modelId), true)))
}

/** Models gathered by discipline, in menu order. Each model is in exactly one group. */
export function groupModels(models: LayerModel[]): LayerGroup[] {
  const byId = new Map<LayerGroupId, string[]>()
  for (const m of unique(models)) {
    const { group } = classifyModel(m.originalFileName)
    byId.set(group, [...(byId.get(group) ?? []), m.modelId])
  }
  return GROUP_ORDER.filter(id => byId.has(id)).map(id => ({ id, modelIds: byId.get(id)! }))
}

/** Models whose names matched nothing, for the report and the console */
export const unclassifiedModels = (models: LayerModel[]): LayerModel[] =>
  unique(models).filter(m => !classifyModel(m.originalFileName).known)

/** The menu: All layers, then each discipline the project actually has a model for */
export function layerIds(models: LayerModel[]): string[] {
  return ['all', ...groupModels(models).map(g => g.id)]
}

/** Not building disciplines: the ground, the planting, and whatever no name rule recognised */
const CONTEXT: ReadonlySet<LayerGroupId> = new Set<LayerGroupId>(['site', 'land', 'other'])

export interface VisibilityOptions {
  /**
   * The choice is a view the dashboard sets up (the heat map, a Systems page, Reset on either), not a pick
   * from the menu: Site, Landscape and Other models stay in view around the chosen disciplines, as unrecognised
   * models always have there.
   */
  keepContext?: boolean
}

/**
 * What a layer choice shows, per model.
 *  - No filter ('all', nothing, or ids that are not layers at all): every model shows.
 *  - Otherwise exactly the models of the chosen disciplines show. Choosing a discipline the project has no
 *    model for shows nothing; it never shows some other discipline instead.
 */
export function layerVisibility(models: LayerModel[], layer: string | string[], options: VisibilityOptions = {}): Map<string, boolean> {
  const valid = new Set<string>(GROUP_ORDER)
  const raw = Array.isArray(layer) ? layer : [layer]
  const selected = new Set(raw.filter(id => valid.has(id)))
  const out = new Map<string, boolean>()
  for (const g of groupModels(models)) {
    const shown = selected.size === 0 || selected.has(g.id) || (!!options.keepContext && CONTEXT.has(g.id))
    for (const id of g.modelIds) out.set(id, shown)
  }
  return out
}

/** The registry went from one project's models to another's (or to none): nothing in common any more */
export function isProjectSwitch(before: ReadonlySet<string>, after: ReadonlySet<string>): boolean {
  if (before.size === 0) return false
  if (after.size === 0) return true
  for (const id of after) if (before.has(id)) return false
  return true
}
