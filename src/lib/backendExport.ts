/** The backend files a project export copies into backend/, next to main.py. Every local module
 *  main.py imports must be here or the exported backend cannot start (checked by test:logic). */
export const BACKEND_EXPORT_FILES = [
  'main.py',
  'fin_client.py',
  'workorders.py',
  'start_viewer.py',
  'requirements.txt',
  'login.html',
]
