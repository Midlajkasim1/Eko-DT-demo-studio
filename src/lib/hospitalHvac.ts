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
 * The Eko Hospital roof HVAC graphic as FIN serves it, from its path on. Only the server in front of it ever changes (the FIN
 * address changes regularly), so the server is never part of this constant: it is the connected FIN server's origin, read when
 * the graphic is opened (hospitalGraphicUrl). Kept exactly as FIN shows it: path, query and the hash fragment.
 */
export const HOSPITAL_ROOF_GRAPHIC_PATH =
  '/finMobile/ekoHospital#frame?app=graphics&targetRef=@p:ekoHospital:r:3260abd5-07a0a7b6&url=%2Ffin5%2FekoHospital%3FprojectRef%3D%40p%3AekoHospital%3Ar%3A326dc5ee-27ca9b5a%26title%3DshowSettings%23targetRef%3D%40p%3AekoHospital%3Ar%3A3260abd5-07a0a7b6'

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

/** The Hospital roof graphic on the given FIN server, or null when there is no usable server address. */
export function hospitalGraphicUrl(serverUrl: unknown): string | null {
  const origin = finServerOrigin(serverUrl)
  return origin ? origin + HOSPITAL_ROOF_GRAPHIC_PATH : null
}

export interface DashboardGraphic { id: string; title: string; url: string | null }

/**
 * The FIN graphics screens the dashboard lists in its Assets register: only for the Eko Hospital project, none for Marsa or any
 * other. `url` is read when the entry is opened, from `liveServer` (the FIN server this session is connected to right now), so a
 * new FIN address after the next connection is used at once and an old one is never kept. null when not connected.
 */
export function hospitalGraphics(
  meta: { apiSettings?: ProjectApiSettings } | null | undefined,
  liveServer: () => unknown,
): DashboardGraphic[] {
  if (!hospitalHvacEnabled(meta)) return []
  return [{
    id: 'hospital-roof-hvac',
    title: 'Hospital Roof – HVAC Graphics',
    get url() { return hospitalGraphicUrl(liveServer()) },
  }]
}

/** Schematic types whose internals follow live FIN points whatever the project. */
const ALWAYS_LIVE = ['MAHU', 'ECO', 'FCU', 'FAHU']

/** Whether a schematic's labels and live readings run: AHU and VAV only for a project with the Hospital graphics on. */
export function isLiveSchematic(type: string, hospitalHvac: boolean): boolean {
  return ALWAYS_LIVE.includes(type) || (hospitalHvac && (type === 'AHU' || type === 'VAV'))
}
