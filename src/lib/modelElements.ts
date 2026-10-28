import type { FragmentsEngine } from '@/lib/fragmentsEngine'
import type { ModelElement } from '@/lib/assetLinks'
import { useModelStore } from '@/store/useModelStore'

/** IFC classes that can be a piece of FIN equipment. Ducts, pipes, fittings, lights and sprinklers are left out. */
const EQUIPMENT_CLASSES = /^IFC(BUILDINGELEMENTPROXY|UNITARYEQUIPMENT|AIRTERMINALBOX|FLOWTERMINAL|ENERGYCONVERSIONDEVICE|FLOWMOVINGDEVICE|FLOWCONTROLLER|FLOWSTORAGEDEVICE|FLOWTREATMENTDEVICE|FLOWMETER|DISTRIBUTIONCONTROLELEMENT|DISTRIBUTIONFLOWELEMENT|DISTRIBUTIONELEMENT|ELECTRICDISTRIBUTIONBOARD|ELECTRICAPPLIANCE|ELECTRICGENERATOR|ELECTRICMOTOR|TRANSFORMER|TRANSPORTELEMENT|FAN|PUMP|COIL|CHILLER|BOILER|COOLINGTOWER|CONDENSER|COMPRESSOR|HEATEXCHANGER|HUMIDIFIER|AIRTOAIRHEATRECOVERY|EVAPORATIVECOOLER|TANK|FILTER|DAMPER|VALVE|SWITCHINGDEVICE|PROTECTIVEDEVICE|CONTROLLER|SENSOR|ACTUATOR|ALARM|UNITARYCONTROLELEMENT|SPACEHEATER|MEDICALDEVICE|COMMUNICATIONSAPPLIANCE|AUDIOVISUALAPPLIANCE)$/i

const CHUNK = 1000

const attr = (row: unknown, key: string): string => {
  const v = (row as Record<string, unknown> | undefined)?.[key]
  const raw = v && typeof v === 'object' && 'value' in v ? (v as { value: unknown }).value : v
  return raw == null ? '' : String(raw)
}

function modelName(key: string, userDataId: unknown): string {
  const rec = useModelStore.getState().models.find(m => m.modelId === key || m.modelId === userDataId)
  return rec?.originalFileName ?? key
}

/** The equipment-like elements of every loaded IFC model, one per GlobalId */
export async function listModelElements(engine: FragmentsEngine): Promise<ModelElement[]> {
  const out = new Map<string, ModelElement>()
  for (const [key, model] of engine.fragments.models.list) {
    const name = modelName(key, model.object.userData?.modelId)
    const byClass = await model.getItemsOfCategories([EQUIPMENT_CLASSES])
    for (const [category, ids] of Object.entries(byClass)) {
      for (let i = 0; i < ids.length; i += CHUNK) {
        const chunk = ids.slice(i, i + CHUNK)
        const [guids, rows] = await Promise.all([
          model.getGuidsByLocalIds(chunk),
          model.getItemsData(chunk, {
            attributesDefault: false,
            attributes: ['Name', 'ObjectType', 'Tag'],
            relationsDefault: { attributes: false, relations: false },
          }),
        ])
        chunk.forEach((_, j) => {
          const guid = guids[j]
          if (!guid || out.has(guid)) return
          out.set(guid, {
            guid,
            name: attr(rows[j], 'Name'),
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
