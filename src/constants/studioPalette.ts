import * as THREE from 'three'

/**
 * Starting colours from the Studio look runbook.
 * Table A is the building. Table B is MEP. Pipes are split by the element
 * name when it carries a system code (CHWT, sanitary, fire); otherwise they
 * stay a quiet grey-blue so an unnamed service does not pretend to be one.
 */
export const STUDIO_COLORS = {
  wall: '#F2F3F5',
  slab: '#E4E7EB',
  furniture: '#D9DCE0',
  glass: '#BFD3E6',
  site: '#D5D9DE',
  hvac: '#8FB3D9',
  chilled: '#6F9BD1',
  electrical: '#D9B65C',
  plumbing: '#7FBF9E',
  fire: '#D98A8A',
  service: '#8EAEB8',
} as const

export interface StudioLock {
  color: string
  opacity?: number
}

interface StudioRule {
  category: RegExp
  color: string
  opacity?: number
  /** Read Name and ObjectType and pick a Table B colour. */
  byName?: boolean
}

const GLASS_OPACITY = 0.2

const RULES: StudioRule[] = [
  { category: /^IFC(WALL|WALLSTANDARDCASE|COLUMN|COLUMNSTANDARDCASE|RAILING)$/i, color: STUDIO_COLORS.wall },
  { category: /^IFC(SLAB|ROOF|COVERING|FOOTING|BEAM|STAIR|STAIRFLIGHT|RAMP|RAMPFLIGHT)$/i, color: STUDIO_COLORS.slab },
  { category: /^IFC(FURNITURE|FURNISHINGELEMENT|SYSTEMFURNITUREELEMENT|DOOR)$/i, color: STUDIO_COLORS.furniture },
  { category: /^IFC(WINDOW|PLATE|CURTAINWALL)$/i, color: STUDIO_COLORS.glass, opacity: GLASS_OPACITY },
  { category: /^IFC(MEMBER|SITE|GEOGRAPHICELEMENT)$/i, color: STUDIO_COLORS.site },
  { category: /^IFC(DUCTSEGMENT|DUCTFITTING|AIRTERMINAL|AIRTERMINALBOX|DAMPER|FAN|COIL|AIRTOAIRHEATRECOVERY|UNITARYEQUIPMENT|ENERGYCONVERSIONDEVICE)$/i, color: STUDIO_COLORS.hvac },
  { category: /^IFC(CABLESEGMENT|CABLECARRIERSEGMENT|CABLEFITTING|CABLECARRIERFITTING|ELECTRICDISTRIBUTIONBOARD|LIGHTFIXTURE|OUTLET|SWITCHINGDEVICE|JUNCTIONBOX|ELECTRICAPPLIANCE)$/i, color: STUDIO_COLORS.electrical },
  { category: /^IFC(FIRESUPPRESSIONTERMINAL|SPRINKLER)$/i, color: STUDIO_COLORS.fire },
  { category: /^IFC(PIPESEGMENT|PIPEFITTING|FLOWSEGMENT|FLOWFITTING|VALVE|FLOWCONTROLLER|FLOWMETER|PUMP)$/i, color: STUDIO_COLORS.service, byName: true },
  { category: /^IFCFLOWTERMINAL$/i, color: STUDIO_COLORS.hvac, byName: true },
]

/** Every colour Studio paints, so the template wash leaves those materials alone. */
export function studioLocks(): StudioLock[] {
  const locks = new Map<string, number | undefined>()
  for (const rule of RULES) locks.set(rule.color, rule.opacity)
  locks.set(STUDIO_COLORS.chilled, undefined)
  locks.set(STUDIO_COLORS.plumbing, undefined)
  locks.set(STUDIO_COLORS.hvac, undefined)
  locks.set(STUDIO_COLORS.electrical, undefined)
  locks.set(STUDIO_COLORS.fire, undefined)
  return [...locks.entries()].map(([color, opacity]) => (
    opacity == null ? { color } : { color, opacity }
  ))
}

/** Table B from a Revit name. Unrecognised names keep `fallback`. */
export function systemColor(text: string, fallback: string): string {
  const s = text.toUpperCase()
  if (/FIRE|SPRINK|FSPR|HYDRANT|WETRISER|\bFP[\s_-]/.test(s)) return STUDIO_COLORS.fire
  if (/CHW|CHWT|LTHW|HHW|GLYCOL/.test(s)) return STUDIO_COLORS.chilled
  if (/PLUMB|SANIT|WASTE|\bSOIL\b|\bSVP\b|\bDCW\b|\bDHW|\bHWS\b|STORM|SEWER|DRAIN|GREASE/.test(s)) return STUDIO_COLORS.plumbing
  if (/DUCT|HVAC|DIFFUSER|GRILLE|\bAHU\b|\bFAHU\b|\bFCU\b|EXHAUST/.test(s)) return STUDIO_COLORS.hvac
  if (/ELEC|CABLE|CONTAIN|LIGHTING|\bDB[\s_-]/.test(s)) return STUDIO_COLORS.electrical
  return fallback
}

interface PaintableModel {
  getItemsOfCategories: (categories: RegExp[]) => Promise<Record<string, number[]>>
  getItemsData: (ids: number[], config: object) => Promise<unknown[]>
  setColor: (ids: number[], color: THREE.Color) => Promise<void>
  setOpacity: (ids: number[], opacity: number) => Promise<void>
  resetColor: (ids: number[]) => Promise<void>
  resetOpacity: (ids: number[]) => Promise<void>
}

const NAME_CHUNK = 800

function readAttr(row: unknown, key: string): string {
  const value = (row as Record<string, unknown> | undefined)?.[key]
  const raw = value && typeof value === 'object' && 'value' in value
    ? (value as { value: unknown }).value
    : value
  return raw == null ? '' : String(raw)
}

interface Bucket {
  color: string
  opacity?: number
  ids: number[]
}

function addIds(buckets: Map<string, Bucket>, color: string, opacity: number | undefined, ids: number[]) {
  const key = opacity == null ? color : `${color}@${opacity}`
  const bucket = buckets.get(key)
  if (bucket) bucket.ids.push(...ids)
  else buckets.set(key, { color, opacity, ids: [...ids] })
}

/**
 * Paints one loaded model with the Studio palette.
 * Returns the local ids it coloured, so they can be put back later.
 * If `cancelled` flips, anything already painted on this call is cleared.
 */
async function loadCategories(model: PaintableModel, cancelled: () => boolean) {
  const categories = RULES.map(rule => rule.category)
  let last: unknown
  for (let attempt = 0; attempt < 6; attempt++) {
    if (cancelled()) return null
    try {
      return await model.getItemsOfCategories(categories)
    } catch (err) {
      last = err
      await new Promise(resolve => setTimeout(resolve, 200 * (attempt + 1)))
    }
  }
  throw last
}

export async function paintStudioModel(
  model: PaintableModel,
  cancelled: () => boolean,
): Promise<number[]> {
  const found = await loadCategories(model, cancelled)
  if (cancelled() || !found) return []

  const buckets = new Map<string, Bucket>()
  const named: { ids: number[]; fallback: string }[] = []

  for (const [category, ids] of Object.entries(found)) {
    if (!ids?.length) continue
    const rule = RULES.find(item => item.category.test(category))
    if (!rule) continue
    if (rule.byName) named.push({ ids, fallback: rule.color })
    else addIds(buckets, rule.color, rule.opacity, ids)
  }

  for (const group of named) {
    for (let index = 0; index < group.ids.length; index += NAME_CHUNK) {
      if (cancelled()) return []
      const chunk = group.ids.slice(index, index + NAME_CHUNK)
      const rows = await model.getItemsData(chunk, {
        attributesDefault: false,
        attributes: ['Name', 'ObjectType'],
        relationsDefault: { attributes: false, relations: false },
      })
      chunk.forEach((id, row) => {
        const text = `${readAttr(rows[row], 'Name')} ${readAttr(rows[row], 'ObjectType')}`
        addIds(buckets, systemColor(text, group.fallback), undefined, [id])
      })
    }
  }

  const painted: number[] = []
  for (const bucket of buckets.values()) {
    if (cancelled()) break
    await model.setColor(bucket.ids, new THREE.Color(bucket.color))
    if (bucket.opacity != null) await model.setOpacity(bucket.ids, bucket.opacity)
    painted.push(...bucket.ids)
  }

  if (cancelled() && painted.length) {
    await model.resetColor(painted).catch(() => {})
    await model.resetOpacity(painted).catch(() => {})
    return []
  }
  return painted
}
