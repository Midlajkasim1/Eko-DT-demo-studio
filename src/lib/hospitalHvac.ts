import type { ProjectApiSettings } from '@/types'

/**
 * Hospital HVAC graphics are opt-in per project. The flag lives in the project's own apiSettings (project.json), so nothing
 * here guesses a project from its name or id: a project that never set it, Marsa included, is off.
 */
export function hospitalHvacEnabled(meta?: { apiSettings?: ProjectApiSettings } | null): boolean {
  return meta?.apiSettings?.hospitalHvacGraphics === true
}

/** Schematic types whose internals follow live FIN points whatever the project. */
const ALWAYS_LIVE = ['MAHU', 'ECO', 'FCU', 'FAHU']

/** Whether a schematic's labels and live readings run: AHU only for a project with the Hospital graphics on. */
export function isLiveSchematic(type: string, hospitalHvac: boolean): boolean {
  return ALWAYS_LIVE.includes(type) || (hospitalHvac && type === 'AHU')
}
