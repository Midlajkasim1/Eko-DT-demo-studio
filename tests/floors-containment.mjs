/* The architectural model stores each element on a storey. Basement isolation
   must follow that link: a Level 00 wall stays off the basement even when its
   geometry hangs below the storey. */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as FRAGS from '@thatopen/fragments'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const frag = path.join(root, 'ellisdon-templates-main/public/models/MAA-KLD-AN09-ZZ-M3-AR-0001.frag')
if (!existsSync(frag)) {
  console.log('floors-containment: skipped, architectural model is not in this checkout')
  process.exit(0)
}

const floorName = (raw) => {
  const s = String(raw || '').toUpperCase()
  if (/BASEMENT|^BF$|^B\d+$/.test(s)) return 'Basement'
  if (/ROOF|^RF$/.test(s)) return 'Roof'
  if (/GROUND|ENTRANCE|LEVEL\s*0+$|^00$|^L0$/.test(s)) return 'Ground floor'
  if (/FIRST|1ST|LEVEL\s*0*1\b|^L1$|^01$/.test(s)) return 'First floor'
  if (/SECOND|LEVEL\s*0*2\b/.test(s)) return 'Second floor'
  return raw
}

const bytes = new Uint8Array(readFileSync(frag))
const model = new FRAGS.SingleThreadedFragmentsModel('ar', bytes, false)
const storeyIds = Object.values(model.getItemsOfCategories([/IFCBUILDINGSTOREY/i])).flat()
const rows = model.getItemsData(storeyIds, { attributes: ['Name'], attributesDefault: false })
const floorOfStorey = new Map()
storeyIds.forEach((id, i) => floorOfStorey.set(id, floorName(rows[i]?.Name?.value)))

const owned = new Map()
const storeyRels = await model.getRelations(storeyIds)
for (const id of storeyIds) {
  const floor = floorOfStorey.get(id)
  for (const n of storeyRels.get(id)?.data?.ContainsElements || []) {
    if (!owned.has(n)) owned.set(n, floor)
  }
}

const geom = model.getItemsWithGeometry()
const loose = geom.filter(id => !owned.has(id))
const partRels = new Map()
for (const [id, rec] of await model.getRelations(loose)) partRels.set(id, rec.data || rec)

const claim = (id) => {
  if (owned.has(id)) return
  const rec = partRels.get(id)
  const storey = rec?.ContainedInStructure?.[0]
  if (storey != null && floorOfStorey.has(storey)) owned.set(id, floorOfStorey.get(storey))
  const parent = rec?.Decomposes?.[0]
  if (!owned.has(id) && parent != null && owned.has(parent)) owned.set(id, owned.get(parent))
}
for (let hop = 0; hop < 3; hop++) {
  const missing = []
  for (const id of loose) {
    if (owned.has(id)) continue
    const parent = partRels.get(id)?.Decomposes?.[0]
    if (parent != null && !owned.has(parent) && !partRels.has(parent)) missing.push(parent)
  }
  if (missing.length) {
    for (const [id, rec] of await model.getRelations(missing)) partRels.set(id, rec.data || rec)
  }
  for (const id of partRels.keys()) claim(id)
}

const fails = []
const wall = 10758652
if (owned.get(wall) !== 'Ground floor') fails.push(`ATK_W2 wall ${wall} is ${owned.get(wall) || 'unowned'}, expected Ground floor`)
const mullion = 8846342
if (owned.get(mullion) !== 'Ground floor') fails.push(`mullion ${mullion} is ${owned.get(mullion) || 'unowned'}, expected Ground floor`)
const basement = geom.filter(id => owned.get(id) === 'Basement').length
const ground = geom.filter(id => owned.get(id) === 'Ground floor').length
if (basement < 100) fails.push(`basement geometry is ${basement}`)
if (ground < basement) fails.push(`ground floor geometry ${ground} is not above the basement`)
const unowned = geom.filter(id => !owned.has(id)).length
if (unowned > 100) fails.push(`${unowned} geometry items have no storey`)

if (fails.length) {
  console.error('floors-containment failed')
  for (const line of fails) console.error('  ' + line)
  process.exit(1)
}
console.log(`floors-containment: basement ${basement}, ground ${ground}, unowned ${unowned}`)
process.exit(0)
