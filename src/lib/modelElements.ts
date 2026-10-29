import type { FragmentsEngine } from '@/lib/fragmentsEngine'
import type { ModelElement } from '@/lib/assetLinks'
import { useModelStore } from '@/store/useModelStore'

/** IFC classes that can be a piece of FIN equipment. Ducts, pipes, fittings, lights and sprinklers are left out. */
const EQUIPMENT_CLASSES = /^IFC(BUILDINGELEMENTPROXY|UNITARYEQUIPMENT|AIRTERMINALBOX|FLOWTERMINAL|ENERGYCONVERSIONDEVICE|FLOWMOVINGDEVICE|FLOWCONTROLLER|FLOWSTORAGEDEVICE|FLOWTREATMENTDEVICE|FLOWMETER|DISTRIBUTIONCONTROLELEMENT|DISTRIBUTIONFLOWELEMENT|DISTRIBUTIONELEMENT|ELECTRICDISTRIBUTIONBOARD|ELECTRICAPPLIANCE|ELECTRICGENERATOR|ELECTRICMOTOR|TRANSFORMER|TRANSPORTELEMENT|FAN|PUMP|COIL|CHILLER|BOILER|COOLINGTOWER|CONDENSER|COMPRESSOR|HEATEXCHANGER|HUMIDIFIER|AIRTOAIRHEATRECOVERY|EVAPORATIVECOOLER|TANK|FILTER|DAMPER|VALVE|SWITCHINGDEVICE|PROTECTIVEDEVICE|CONTROLLER|SENSOR|ACTUATOR|ALARM|UNITARYCONTROLELEMENT|SPACEHEATER|MEDICALDEVICE|COMMUNICATIONSAPPLIANCE|AUDIOVISUALAPPLIANCE)$/i

const SPACE_CLASSES = /^IFCSPACE$/i

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
          out.set(guid, {
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
