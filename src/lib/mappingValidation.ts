import type { MappingField } from '@/lib/finSettings'
import type { JsonObject } from '@/lib/mappingRows'

/** What FIN says about a mapping. not_configured: the open project sets nothing for it. */
export type MappingStatus = 'valid' | 'not_found' | 'cannot_validate' | 'not_configured'

export interface ItemResult {
  status: MappingStatus
  detail?: string
}

export interface BlockResult {
  status: MappingStatus
  detail?: string
  items: Record<string, ItemResult>
  /** not_configured only: the backend serves its own default for this block (never sent to the UI) */
  backend_default?: boolean
}

export interface ValidationResponse {
  project_id: string
  project_name: string
  valid: boolean
  blocks: Partial<Record<MappingField, BlockResult>>
}

export const STATUS_LABEL: Record<MappingStatus, string> = {
  valid: '✓ Valid',
  not_found: '✕ Not Found',
  cannot_validate: '⚠ Cannot Validate',
  not_configured: '— Not Configured',
}

/** Check the mappings as edited against the FIN project the backend is signed in to.
 *  Read-only on the backend: it neither saves anything nor returns config.json values. */
export async function validateMappings(
  projectId: string,
  blocks: Partial<Record<MappingField, JsonObject | undefined>>
): Promise<ValidationResponse> {
  const res = await fetch('/api/fin/validate-mapping', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project_id: projectId, blocks: Object.fromEntries(Object.entries(blocks).map(([k, v]) => [k, v ?? null])) }),
  })
  if (res.status === 401) throw new Error('Connect to FIN first.')
  if (res.status === 409) throw new Error('The backend is still switching to this project. Try again in a moment.')
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `Validation failed (${res.status}).`)
  }
  return res.json()
}
