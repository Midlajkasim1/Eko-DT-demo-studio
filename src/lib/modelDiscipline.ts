/* Discipline token in a model file name, matching the Layers menu.
   MAA-KLD-AN09-ZZ-M3-AR-0001 → arch, …-ST-… → str, …-ME-… → mech.
   A combined ME model stands in for Electrical until a separate EL file is loaded. */

export type LayerId = 'all' | 'arch' | 'elec' | 'int' | 'mech' | 'str'

const TOKEN: Record<string, Exclude<LayerId, 'all'>> = {
  AR: 'arch', ARCH: 'arch', ARC: 'arch',
  ST: 'str', STR: 'str',
  EL: 'elec', EE: 'elec', ELEC: 'elec',
  IN: 'int', INT: 'int', ID: 'int',
  ME: 'mech', MEP: 'mech', HVAC: 'mech', HV: 'mech',
}

const MENU: Exclude<LayerId, 'all'>[] = ['arch', 'elec', 'int', 'mech', 'str']

export function disciplineOf(fileName: string): Exclude<LayerId, 'all'> | null {
  const tokens = String(fileName || '').toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean)
  for (const token of tokens) {
    const hit = TOKEN[token]
    if (hit) return hit
  }
  return null
}

export function layersFor(disciplines: Array<string | null>): LayerId[] {
  const present = new Set(disciplines.filter((d): d is string => !!d))
  const ids: LayerId[] = ['all']
  for (const id of MENU) {
    if (present.has(id)) ids.push(id)
    else if (id === 'elec' && present.has('mech')) ids.push('elec')
  }
  return ids
}

export function layerShows(discipline: string | null, layer: string, present: Set<string>): boolean {
  if (!layer || layer === 'all') return true
  if (discipline === layer) return true
  if (layer === 'elec' && discipline === 'mech' && !present.has('elec')) return true
  return false
}
