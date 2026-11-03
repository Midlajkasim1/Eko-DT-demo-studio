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

/**
 * The Eko Hospital roof graphic's FIN route, exactly as the client gave it: path, query and hash. Only the server in front of it changes
 * (the FIN address changes regularly), so the server is never part of this constant: it is the origin of the FIN server this session is
 * connected to, read when the graphic is opened (hospitalRoofUrl).
 */
export const HOSPITAL_ROOF_FIN_ROUTE =
  '/fin5/ekoHospital?projectRef=@p:ekoHospital:r:326dc5ee-27ca9b5a#targetRef=@p:ekoHospital:r:3260abd5-07a0a7b6'

/** The FIN server a URL points at: protocol, host and port as configured, nothing else (no path, credentials, query or hash).
 *  null for anything that is not an http(s) address; nothing is guessed or defaulted. */
export function finServerOrigin(serverUrl: unknown): string | null {
  if (typeof serverUrl !== 'string' || !serverUrl.trim()) return null
  try {
    const u = new URL(serverUrl.trim())
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin : null
  } catch {
    return null
  }
}

/** The roof graphic on the given FIN server, or null when there is no usable server address. */
export function hospitalRoofUrl(serverUrl: unknown): string | null {
  const origin = finServerOrigin(serverUrl)
  return origin ? origin + HOSPITAL_ROOF_FIN_ROUTE : null
}

export interface HospitalRoofGraphic { title: string; url: string | null }

/**
 * The roof graphic the dashboard opens from its Assets register: only for the Eko Hospital project, null for Marsa and every other.
 * `url` is read when the graphic is opened, from `liveServer` (the FIN server this session is connected to right now), so a new FIN
 * address after the next connection is used at once and an old one is never kept. null when not connected.
 */
export function hospitalRoofGraphic(
  meta: { apiSettings?: ProjectApiSettings } | null | undefined,
  liveServer: () => unknown,
): HospitalRoofGraphic | null {
  if (!hospitalHvacEnabled(meta)) return null
  return {
    title: 'Hospital Roof Graphic',
    get url() { return hospitalRoofUrl(liveServer()) },
  }
}

/** Schematic types whose internals follow live FIN points whatever the project. */
const ALWAYS_LIVE = ['MAHU', 'ECO', 'FCU', 'FAHU']

/** Whether a schematic's labels and live readings run: AHU and VAV only for a project with the Hospital graphics on. */
export function isLiveSchematic(type: string, hospitalHvac: boolean): boolean {
  return ALWAYS_LIVE.includes(type) || (hospitalHvac && (type === 'AHU' || type === 'VAV'))
}
