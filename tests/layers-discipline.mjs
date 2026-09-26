import { disciplineOf, layersFor, layerShows } from '../src/lib/modelDiscipline.ts'

const fails = []
const check = (label, got, want) => { if (got !== want) fails.push(`${label}: ${got} !== ${want}`) }

check('arch', disciplineOf('MAA-KLD-AN09-ZZ-M3-AR-0001.ifc'), 'arch')
check('str', disciplineOf('MAA-KLD-AN09-ZZ-M3-ST-0001.ifc'), 'str')
check('mech', disciplineOf('MAA-RAM-AN09-ZZ-ME-M3-0001.ifc'), 'mech')
check('elec file', disciplineOf('MAA-ZZ-EL-0001.ifc'), 'elec')

const loaded = ['arch', 'str', 'mech']
const menu = layersFor(loaded).join(',')
check('menu', menu, 'all,arch,elec,mech,str')

const present = new Set(loaded)
check('arch shows arch', layerShows('arch', 'arch', present), true)
check('arch hidden for str', layerShows('arch', 'str', present), false)
check('mech shows for mech', layerShows('mech', 'mech', present), true)
check('mech stands in for elec', layerShows('mech', 'elec', present), true)
check('all shows arch', layerShows('arch', 'all', present), true)

const split = new Set(['arch', 'mech', 'elec'])
check('separate elec hides mech', layerShows('mech', 'elec', split), false)
check('separate elec shows elec', layerShows('elec', 'elec', split), true)

if (fails.length) {
  console.error('layers-discipline failed')
  for (const line of fails) console.error('  ' + line)
  process.exit(1)
}
console.log('layers-discipline: arch, structure and the ME model map to the menu')
