/**
 * The dashboard's Layers tool: which models belong to which discipline, and what a layer choice
 * shows. The registry (useModelStore) is the project's model list; nothing here keeps a list of
 * its own, so a project switch or a late-loading model only means calling these again.
 *
 * Discipline comes from the file name, because the registry holds no discipline field. When the name
 * says nothing, what the model contains can: a model that is nearly all beams and columns is structural
 * whatever it is called. That second source only ever fills a gap; a name that classifies always wins.
 * The Tree Viewer groups its models with the same functions, so the two always agree.
 */
import { TOKEN } from './modelDiscipline.ts'

export type LayerGroupId = 'arch' | 'elec' | 'int' | 'mech' | 'str' | 'equip' | 'site' | 'land' | 'other' | 'spaces'

/** Menu order. Other comes last and only exists when a model's name matched nothing. */
/** Spaces is last and is not a menu entry: it is the heat map's own model, shown only while the heat map runs. */
export const GROUP_ORDER: LayerGroupId[] = ['arch', 'elec', 'int', 'mech', 'str', 'equip', 'site', 'land', 'other', 'spaces']

/* Whole tokens only. The short forms are the ones the Tree Viewer already understands
   (modelDiscipline.TOKEN); the long forms are what discipline files are usually called. */
const WORDS: Record<string, LayerGroupId> = {
  ...TOKEN,
  ELECTRICAL: 'elec', ELECTRIC: 'elec', ELECT: 'elec', ELE: 'elec',
  MECHANICAL: 'mech', MECH: 'mech',
  ARCHITECTURE: 'arch', ARCHITECTURAL: 'arch', ARCHI: 'arch',
  STRUCTURE: 'str', STRUCTURES: 'str', STRUC: 'str',
  CON: 'str', // "Eng-CON": the construction set. Its content is beams, columns and footings.
  INTERIOR: 'int', INTERIORS: 'int',
  LANDSCAPE: 'land', LANDSCAPES: 'land', LANDSCAPING: 'land',
  SITE: 'site', SITEWORK: 'site', SITEWORKS: 'site',
}

/**
 * Job-number names, as in "1913-blc-pal-equipment_r21": job number, two project codes, then the discipline,
 * then an optional revision. Equipment is only read from that discipline position. The word on its own
 * ("Mechanical Equipment", "Fire equipment") is not a rule: it is not a discipline in any other convention
 * here, and a model that says Mechanical or Electrical in its name must stay Mechanical or Electrical.
 */
const JOB_EQUIPMENT = /^\d{3,5}-[A-Z0-9]+-[A-Z0-9]+-EQUIPMENT(?:[_-]R\d+)?$/

/** The room-volume model: "3D - SPACES", or just "Spaces". The word inside a longer name is not a rule. */
const SPACES_NAME = /^(?:3D[ _-]*)?SPACES$/

/**
 * ISO 19650 style names: Project-Originator-Volume-Level-Type-Role-Number, as in
 * "MAA-KLD-AN09-ZZ-M3-AR-0001". The role is a field of its own, so it is read from there and nowhere
 * else in the name: an originator that happens to be "ST" does not make a model structural.
 */
const ISO_NAME = /^[A-Z0-9]+-[A-Z0-9]+-[A-Z0-9]+-[A-Z0-9]+-[A-Z][A-Z0-9]-([A-Z]{1,2})-\d{3,6}(?:-|$)/
const ISO_ROLES: Record<string, LayerGroupId> = {
  A: 'arch', AR: 'arch',
  S: 'str', ST: 'str',
  E: 'elec', EL: 'elec',
  M: 'mech', ME: 'mech', H: 'mech',
  I: 'int', ID: 'int',
  L: 'land', LA: 'land',
}

/** "ID" and "IN" are ordinary words and identifiers; they only count when they stand alone ("ID2024" is not Interior) */
const NOT_WITH_DIGITS = new Set(['ID', 'IN'])

const stripExtension = (fileName: string): string => String(fileName || '').replace(/\.(ifc|frag|glb|gltf)$/i, '')

/** The words of a file name, upper-cased: split on anything that is not a letter or digit, and between camelCase words */
export const modelTokens = (fileName: string): string[] =>
  stripExtension(fileName).replace(/([a-z])([A-Z])/g, '$1 $2').toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean)

export interface Classification {
  group: LayerGroupId
  /** False when nothing could place the model: it sits in Other and wants a look */
  known: boolean
  /** What placed it, when it was not the name */
  basis?: string
}

/* ------------------------------ what a model contains ------------------------------ */

/** Elements with geometry, by IFC class. Read once from the loaded model, only for models whose name classifies nothing. */
export interface ContentProfile {
  total: number
  classes: Record<string, number>
}

/**
 * Classes that say what a model is. Deliberately narrow: walls, slabs, doors and the generic flow classes
 * appear in every discipline's models, and pipes and valves belong to plumbing and fire protection as much
 * as to mechanical, so none of those place a model.
 */
const SIGNATURES: Array<{ group: LayerGroupId; classes: RegExp }> = [
  { group: 'str', classes: /^IFC(?:BEAM|COLUMN|FOOTING|PILE|MEMBER|REINFORCINGBAR|REINFORCINGMESH|TENDON)$/ },
  { group: 'mech', classes: /^IFC(?:DUCT(?:SEGMENT|FITTING|SILENCER)|AIRTERMINAL(?:BOX)?|AIRTOAIRHEATRECOVERY|FAN|DAMPER|COIL|BOILER|CHILLER|COOLINGTOWER|HEATEXCHANGER|HUMIDIFIER|UNITARYEQUIPMENT)$/ },
  { group: 'elec', classes: /^IFC(?:CABLE(?:CARRIER)?(?:SEGMENT|FITTING)|LIGHTFIXTURE|LAMP|ELECTRICAPPLIANCE|ELECTRICDISTRIBUTIONBOARD|ELECTRICGENERATOR|ELECTRICMOTOR|ELECTRICFLOWSTORAGEDEVICE|TRANSFORMER|JUNCTIONBOX|OUTLET|PROTECTIVEDEVICE|SWITCHINGDEVICE)$/ },
  { group: 'int', classes: /^IFC(?:FURNISHINGELEMENT|FURNITURE|SYSTEMFURNITUREELEMENT)$/ },
]

/** A model needs this many elements, and this share of them in one discipline's classes, before content decides */
export const MIN_ELEMENTS = 20
export const DOMINANCE = 0.8

/** The discipline a model's content shows, or null when it shows none clearly enough */
export function disciplineFromContent(profile: ContentProfile): { group: LayerGroupId; basis: string } | null {
  if (profile.total < MIN_ELEMENTS) return null
  for (const { group, classes } of SIGNATURES) {
    const hits = Object.entries(profile.classes).filter(([c]) => classes.test(c)).sort((a, b) => b[1] - a[1])
    const n = hits.reduce((sum, [, count]) => sum + count, 0)
    if (n / profile.total >= DOMINANCE) {
      return { group, basis: `${Math.round((100 * n) / profile.total)}% of ${profile.total} elements are ${hits.slice(0, 3).map(([c, k]) => `${c} ${k}`).join(', ')}` }
    }
  }
  return null
}

const profiles = new Map<string, ContentProfile>()
const profileListeners = new Set<() => void>()

export function setContentProfile(modelId: string, profile: ContentProfile): void {
  profiles.set(modelId, profile)
  profileListeners.forEach(cb => cb())
}
export const hasContentProfile = (modelId: string): boolean => profiles.has(modelId)
export const contentProfileOf = (modelId: string): ContentProfile | undefined => profiles.get(modelId)
/** Calls back when a model's content has been read. Returns the way to stop. */
export function onContentProfiles(cb: () => void): () => void {
  profileListeners.add(cb)
  return () => { profileListeners.delete(cb) }
}
/** Forgets the profiles of models that are no longer registered */
export function pruneContentProfiles(keep: ReadonlySet<string>): void {
  for (const id of [...profiles.keys()]) if (!keep.has(id)) profiles.delete(id)
}

/**
 * Case-insensitive, token-based: "Electrical Large.frag", "NBU_ME_01", "ElectricalSmall" and "ELEC2"
 * are Electrical, Mechanical, Electrical, Electrical. "Website" is not Site. The first matching token wins.
 */
export function classifyModel(fileName: string): Classification {
  const base = stripExtension(fileName)
  const iso = ISO_NAME.exec(base.toUpperCase())
  if (iso) {
    const group = ISO_ROLES[iso[1]]
    return group ? { group, known: true } : { group: 'other', known: false }
  }
  if (JOB_EQUIPMENT.test(base.toUpperCase())) return { group: 'equip', known: true }
  if (SPACES_NAME.test(base.trim().toUpperCase())) return { group: 'spaces', known: true }
  for (const token of modelTokens(fileName)) {
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

/** A registered model's discipline: its name first, and only when the name says nothing, what it contains */
export function classifyLoaded(model: LayerModel): Classification {
  const byName = classifyModel(model.originalFileName)
  if (byName.known) return byName
  const profile = profiles.get(model.modelId)
  const byContent = profile ? disciplineFromContent(profile) : null
  return byContent ? { group: byContent.group, known: true, basis: byContent.basis } : byName
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
    const { group } = classifyLoaded(m)
    byId.set(group, [...(byId.get(group) ?? []), m.modelId])
  }
  return GROUP_ORDER.filter(id => byId.has(id)).map(id => ({ id, modelIds: byId.get(id)! }))
}

/** Models whose names matched nothing, for the report and the console */
export const unclassifiedModels = (models: LayerModel[]): LayerModel[] =>
  unique(models).filter(m => !classifyLoaded(m).known)

/** One line per model that needs a classification rule, saying which name and which words were tried */
export const describeUnclassified = (models: LayerModel[]): string[] =>
  unclassifiedModels(models).map(m => {
    const iso = ISO_NAME.exec(stripExtension(m.originalFileName).toUpperCase())
    const why = iso ? `ISO 19650 role code "${iso[1]}" is not in ISO_ROLES` : `no discipline word in [${modelTokens(m.originalFileName).join(', ') || 'empty name'}]`
    const profile = profiles.get(m.modelId)
    const seen = profile
      ? `; content of ${profile.total} elements: ${Object.entries(profile.classes).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([c, k]) => `${c} ${k}`).join(', ') || 'none with geometry'}`
      : '; content not read yet'
    return `"${m.originalFileName}" (model ${m.modelId}): ${why}${seen}`
  })

/** Every registered model with what placed it, for anyone checking why a model sits where it does */
export const describeModels = (models: LayerModel[]): Array<{ modelId: string; fileName: string; group: LayerGroupId; known: boolean; basis: string }> =>
  unique(models).map(m => {
    const c = classifyLoaded(m)
    return { modelId: m.modelId, fileName: m.originalFileName, group: c.group, known: c.known, basis: c.basis ?? (c.known ? 'file name' : 'nothing') }
  })

/** The menu: All layers, then each discipline the project actually has a model for */
export function layerIds(models: LayerModel[]): string[] {
  return ['all', ...groupModels(models).map(g => g.id).filter(id => id !== 'spaces')]
}

/** Not building disciplines: the equipment, the ground, the planting, and whatever no name rule recognised */
const CONTEXT: ReadonlySet<LayerGroupId> = new Set<LayerGroupId>(['equip', 'site', 'land', 'other'])

export interface VisibilityOptions {
  /**
   * The choice is a view the dashboard sets up (the heat map, a Systems page, Reset on either), not a pick
   * from the menu: Site, Landscape and Other models stay in view around the chosen disciplines, as unrecognised
   * models always have there.
   */
  keepContext?: boolean
  /** The heat map is running, so the Spaces model is shown. Otherwise it is hidden, whatever the choice. */
  spacesVisible?: boolean
}

/**
 * What a layer choice shows, per model.
 *  - No filter ('all', nothing, or ids that are not layers at all): every model shows.
 *  - Otherwise exactly the models of the chosen disciplines show. Choosing a discipline the project has no
 *    model for shows nothing; it never shows some other discipline instead.
 */
export function layerVisibility(models: LayerModel[], layer: string | string[], options: VisibilityOptions = {}): Map<string, boolean> {
  const valid = new Set<string>(GROUP_ORDER.filter(id => id !== 'spaces'))
  const raw = Array.isArray(layer) ? layer : [layer]
  const selected = new Set(raw.filter(id => valid.has(id)))
  const out = new Map<string, boolean>()
  for (const g of groupModels(models)) {
    const shown = g.id === 'spaces'
      ? !!options.spacesVisible
      : selected.size === 0 || selected.has(g.id) || (!!options.keepContext && CONTEXT.has(g.id))
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
