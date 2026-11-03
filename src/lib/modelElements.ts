import * as THREE from 'three'
import type { FragmentsEngine } from '@/lib/fragmentsEngine'
import type { ModelElement } from '@/lib/assetLinks'
import { useModelStore } from '@/store/useModelStore'

/** IFC classes that can be a piece of FIN equipment. Ducts, pipes, fittings, lights and sprinklers are left out. */
const EQUIPMENT_CLASSES = /^IFC(BUILDINGELEMENTPROXY|UNITARYEQUIPMENT|AIRTERMINALBOX|FLOWTERMINAL|ENERGYCONVERSIONDEVICE|FLOWMOVINGDEVICE|FLOWCONTROLLER|FLOWSTORAGEDEVICE|FLOWTREATMENTDEVICE|FLOWMETER|DISTRIBUTIONCONTROLELEMENT|DISTRIBUTIONFLOWELEMENT|DISTRIBUTIONELEMENT|ELECTRICDISTRIBUTIONBOARD|ELECTRICAPPLIANCE|ELECTRICGENERATOR|ELECTRICMOTOR|TRANSFORMER|TRANSPORTELEMENT|FAN|PUMP|COIL|CHILLER|BOILER|COOLINGTOWER|CONDENSER|COMPRESSOR|HEATEXCHANGER|HUMIDIFIER|AIRTOAIRHEATRECOVERY|EVAPORATIVECOOLER|TANK|FILTER|DAMPER|VALVE|SWITCHINGDEVICE|PROTECTIVEDEVICE|CONTROLLER|SENSOR|ACTUATOR|ALARM|UNITARYCONTROLELEMENT|SPACEHEATER|MEDICALDEVICE|COMMUNICATIONSAPPLIANCE|AUDIOVISUALAPPLIANCE)$/i

const SPACE_CLASSES = /^IFCSPACE$/i
const STOREY = /^IFCBUILDINGSTOREY$/i

interface SpatialNode { category: string | null; localId: number | null; children?: SpatialNode[] }
interface Storey { name: string; elevation?: number }

/** The storey of every item of one model, from its spatial structure */
async function storeysOf(model: {
  getSpatialStructure(): Promise<SpatialNode>
  getItemsData(ids: number[], config?: unknown): Promise<unknown[]>
}): Promise<Map<number, Storey>> {
  const storeyOf = new Map<number, number>()
  const walk = (node: SpatialNode, parentCategory: string | null, storey: number | null) => {
    let here = storey
    if (node.localId != null) {
      if (parentCategory && STOREY.test(parentCategory)) here = node.localId
      else if (here != null) storeyOf.set(node.localId, here)
    }
    for (const child of node.children ?? []) walk(child, node.category, here)
  }
  walk(await model.getSpatialStructure(), null, null)
  const ids = [...new Set(storeyOf.values())]
  const rows = ids.length
    ? await model.getItemsData(ids, { attributesDefault: false, attributes: ['Name', 'LongName', 'Elevation'], relationsDefault: { attributes: false, relations: false } })
    : []
  const storeys = new Map<number, Storey>()
  ids.forEach((id, i) => {
    const elevation = parseFloat(attr(rows[i], 'Elevation'))
    storeys.set(id, { name: attr(rows[i], 'Name') || attr(rows[i], 'LongName'), ...(Number.isFinite(elevation) ? { elevation } : {}) })
  })
  const out = new Map<number, Storey>()
  for (const [item, storey] of storeyOf) {
    const s = storeys.get(storey)
    if (s?.name) out.set(item, s)
  }
  return out
}

export type ElementScan = 'equip' | 'space'

const CHUNK = 1000

const attr = (row: unknown, key: string): string => {
  const v = (row as Record<string, unknown> | undefined)?.[key]
  const raw = v && typeof v === 'object' && 'value' in v ? (v as { value: unknown }).value : v
  return raw == null ? '' : String(raw)
}

function modelRecord(key: string, userDataId: unknown) {
  return useModelStore.getState().models.find(m => m.modelId === key || m.modelId === userDataId)
}

export interface ScannedModel {
  /** Store id when the file is known, otherwise the fragments key */
  key: string
  name: string
}

/** Loaded IFC models the linker can scrape. One row per file. */
export function listScannedModels(engine: FragmentsEngine): ScannedModel[] {
  const out: ScannedModel[] = []
  const seen = new Set<string>()
  for (const [key, model] of engine.fragments.models.list) {
    const rec = modelRecord(key, model.object.userData?.modelId)
    const stable = rec?.modelId ?? key
    if (seen.has(stable)) continue
    seen.add(stable)
    out.push({ key: stable, name: rec?.originalFileName ?? key })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
}

/** Files whose name contains "space" start ticked. With none of those, every loaded file starts ticked. */
export function defaultSpaceModelKeys(models: { key: string; name: string }[]): string[] {
  const named = models.filter(m => /space/i.test(m.name))
  return (named.length ? named : models).map(m => m.key)
}

/** Equipment-like elements, or IfcSpace rooms, of the loaded IFC models. One per GlobalId.
 *  `onlyKeys` limits the scrape. Omit it to read every model. An empty list reads none. */
export async function listModelElements(
  engine: FragmentsEngine,
  scan: ElementScan = 'equip',
  onlyKeys?: readonly string[],
): Promise<ModelElement[]> {
  const out = new Map<string, ModelElement>()
  const limit = onlyKeys ? new Set(onlyKeys) : null
  const classes = scan === 'space' ? SPACE_CLASSES : EQUIPMENT_CLASSES
  const attributes = scan === 'space' ? ['Name', 'LongName', 'ObjectType', 'Tag'] : ['Name', 'ObjectType', 'Tag']
  for (const [key, model] of engine.fragments.models.list) {
    const rec = modelRecord(key, model.object.userData?.modelId)
    const stable = rec?.modelId ?? key
    if (limit && !limit.has(stable) && !limit.has(key)) continue
    const name = rec?.originalFileName ?? key
    const byClass = await model.getItemsOfCategories([classes])
    const storeys = await storeysOf(model).catch(() => new Map<number, Storey>())
    for (const [category, ids] of Object.entries(byClass)) {
      for (let i = 0; i < ids.length; i += CHUNK) {
        const chunk = ids.slice(i, i + CHUNK)
        const [guids, rows] = await Promise.all([
          model.getGuidsByLocalIds(chunk),
          model.getItemsData(chunk, {
            attributesDefault: false,
            attributes,
            relationsDefault: { attributes: false, relations: false },
          }),
        ])
        chunk.forEach((_, j) => {
          const guid = guids[j]
          if (!guid || out.has(guid)) return
          const storey = storeys.get(chunk[j])
          out.set(guid, {
            ...(storey ? { level: storey.name, ...(storey.elevation !== undefined ? { elevation: storey.elevation } : {}) } : {}),
            guid,
            name: attr(rows[j], 'Name'),
            longName: attr(rows[j], 'LongName'),
            objectType: attr(rows[j], 'ObjectType'),
            tag: attr(rows[j], 'Tag'),
            category,
            modelName: name,
          })
        })
      }
    }
  }
  return [...out.values()]
}

/** Which of these GlobalIds this one loaded file has. */
export async function guidsInModel(engine: FragmentsEngine, modelKey: string, guids: string[]): Promise<string[]> {
  if (!guids.length) return []
  for (const [key, model] of engine.fragments.models.list) {
    const rec = modelRecord(key, model.object.userData?.modelId)
    const stable = rec?.modelId ?? key
    if (stable !== modelKey && key !== modelKey) continue
    const ids = await model.getLocalIdsByGuids(guids)
    return guids.filter((_, i) => ids[i] != null)
  }
  return []
}

/** Which of these GlobalIds some loaded model has; null when no model is loaded to ask */
export async function guidsInModels(engine: FragmentsEngine, guids: string[]): Promise<Set<string> | null> {
  const models = [...engine.fragments.models.list.values()]
  if (!models.length) return null
  const found = new Set<string>()
  for (const model of models) {
    const ask = guids.filter(g => !found.has(g))
    if (!ask.length) break
    const ids = await model.getLocalIdsByGuids(ask)
    ids.forEach((id, i) => { if (id != null) found.add(ask[i]) })
  }
  return found
}

/** World boxes of these GlobalIds, from whichever loaded model has each one */
async function boxesByGuid(engine: FragmentsEngine, guids: string[]): Promise<Map<string, THREE.Box3>> {
  const out = new Map<string, THREE.Box3>()
  let left = [...new Set(guids)]
  for (const model of engine.fragments.models.list.values()) {
    if (!left.length) break
    const ids = await model.getLocalIdsByGuids(left)
    const found = left.flatMap((guid, i) => (ids[i] != null ? [{ guid, localId: ids[i] as number }] : []))
    if (!found.length) continue
    model.object.updateMatrixWorld(true)
    const boxes = await model.getBoxes(found.map(f => f.localId))
    found.forEach((f, i) => { if (boxes[i] && !boxes[i].isEmpty()) out.set(f.guid, boxes[i]) })
    const done = new Set(found.map(f => f.guid))
    left = left.filter(g => !done.has(g))
  }
  return out
}

/** The room each camera is in: the smallest room box around the camera's centre.
 *  A camera on the ceiling may sit just above its room's box, so the top is raised by CEILING_GAP. */
export async function roomsContaining(engine: FragmentsEngine, cameraGuids: string[], roomGuids: string[]): Promise<Map<string, string>> {
  const CEILING_GAP = 1
  const out = new Map<string, string>()
  if (!cameraGuids.length || !roomGuids.length) return out
  const boxes = await boxesByGuid(engine, [...cameraGuids, ...roomGuids])
  const rooms = roomGuids.flatMap(guid => {
    const box = boxes.get(guid)
    if (!box) return []
    const reach = box.clone()
    reach.max.y += CEILING_GAP
    const size = box.getSize(new THREE.Vector3())
    return [{ guid, box, reach, area: size.x * size.z }]
  })
  for (const cam of cameraGuids) {
    const at = boxes.get(cam)?.getCenter(new THREE.Vector3())
    if (!at) continue
    const hits = rooms.filter(r => r.reach.containsPoint(at))
    hits.sort((a, b) => Number(b.box.containsPoint(at)) - Number(a.box.containsPoint(at)) || a.area - b.area)
    if (hits.length) out.set(cam, hits[0].guid)
  }
  return out
}
