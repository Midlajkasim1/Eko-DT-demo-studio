const OPEN_ON_MAP_KEY = 'ifcviewer.studioOpenOnMap'

export function getStudioOpenOnMap(): boolean {
  try {
    return localStorage.getItem(OPEN_ON_MAP_KEY) === '1'
  } catch {
    return false
  }
}

export function setStudioOpenOnMap(value: boolean) {
  try {
    localStorage.setItem(OPEN_ON_MAP_KEY, value ? '1' : '0')
  } catch { /* private mode */ }
}
