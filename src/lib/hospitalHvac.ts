import type { ProjectApiSettings } from '@/types'

/** The FIN project Eko Hospital is connected to (apiSettings.finProjectName, as picked in Dashboard Settings > FIN Project). */
export const HOSPITAL_FIN_PROJECT = 'ekohospital'

/**
 * Hospital HVAC graphics belong to the Eko Hospital project and follow its saved FIN connection: nothing to switch on.
 * Read from the project's own apiSettings (project.json), never from a project id or its display name, so Marsa
 * (marsaAlArab), every other project and a project with no FIN project saved are off.
 */
export function hospitalHvacEnabled(meta?: { apiSettings?: ProjectApiSettings } | null): boolean {
  const fin = meta?.apiSettings?.finProjectName
  return typeof fin === 'string' && fin.trim().toLowerCase() === HOSPITAL_FIN_PROJECT
}

/** Schematic types whose internals follow live FIN points whatever the project. */
const ALWAYS_LIVE = ['MAHU', 'ECO', 'FCU', 'FAHU']

/** Whether a schematic's labels and live readings run: AHU only for a project with the Hospital graphics on. */
export function isLiveSchematic(type: string, hospitalHvac: boolean): boolean {
  return ALWAYS_LIVE.includes(type) || (hospitalHvac && type === 'AHU')
}
