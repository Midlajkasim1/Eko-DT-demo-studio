/** FIN project discovery for Dashboard Settings. The backend does the talking to FIN (through the
 *  signed-in session), so nothing here holds credentials, cookies or headers. */

/** A project on the FIN server. `id` is what FIN uses in /api/{id}/...; `name` is only for display. */
export interface FinProject {
  id: string
  name: string
}

/** One point of a FIN project. `ref` is its ID with the project written as {project}. */
export interface FinResource {
  id: string
  ref: string
  name: string
  navName: string | null
  equip: string | null
  unit: string | null
  his: boolean
}

export type FinApiErrorKind = 'not_connected' | 'not_allowed' | 'not_found' | 'not_configured' | 'unavailable'

export class FinApiError extends Error {
  kind: FinApiErrorKind
  constructor(kind: FinApiErrorKind, message: string) {
    super(message)
    this.kind = kind
  }
}

async function getJson<T>(url: string, what: string): Promise<T> {
  let res: Response
  try {
    res = await fetch(url)
  } catch {
    throw new FinApiError('unavailable', `Could not reach the Eko-DT backend to load ${what}.`)
  }
  if (res.ok) return res.json() as Promise<T>
  const detail = (await res.json().catch(() => ({})))?.detail
  const text = typeof detail === 'string' && detail ? detail : `Loading ${what} failed (${res.status}).`
  if (res.status === 401) throw new FinApiError('not_connected', 'Connect to FIN first.')
  if (res.status === 403) throw new FinApiError('not_allowed', text)
  if (res.status === 404) throw new FinApiError('not_found', text)
  if (res.status === 503) throw new FinApiError('not_configured', text)
  throw new FinApiError('unavailable', text)
}

/** The projects FIN reports, as the backend parsed them. */
export async function fetchFinProjects(): Promise<FinProject[]> {
  const body = await getJson<{ projects: FinProject[] }>('/api/fin/projects', 'FIN projects')
  return Array.isArray(body.projects) ? body.projects : []
}

/** The points of ONE FIN project, whichever project the session currently serves. */
export async function fetchFinResources(projectId: string): Promise<{ resources: FinResource[]; truncated: boolean }> {
  const body = await getJson<{ resources: FinResource[]; truncated?: boolean }>(
    `/api/fin/resources?project=${encodeURIComponent(projectId)}`, `the points of ${projectId}`)
  return { resources: Array.isArray(body.resources) ? body.resources : [], truncated: !!body.truncated }
}

export type SavedProjectState = 'none' | 'available' | 'missing'

/** What the dropdown shows for the project this Eko-DT project saved. A saved id the server no
 *  longer lists is 'missing': it stays selected and is reported, never swapped for another project. */
export function savedProjectState(projects: FinProject[], saved: string | undefined): SavedProjectState {
  if (!saved) return 'none'
  return projects.some(p => p.id === saved) ? 'available' : 'missing'
}

/** "MARSA AL ARAB (marsaAlArab)" when the two differ, the id alone when they do not. */
export function projectLabel(p: FinProject): string {
  return p.name && p.name !== p.id ? `${p.name} (${p.id})` : p.id
}

/** The value to store when the user picks an option: the identifier, never the display name. */
export function projectIdFromSelection(projects: FinProject[], selected: string): string {
  return projects.find(p => p.id === selected)?.id ?? ''
}
