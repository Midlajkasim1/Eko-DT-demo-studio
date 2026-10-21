import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

interface ConfirmDialogProps {
  title: string
  message: React.ReactNode
  confirmLabel: string
  busyLabel?: string
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({ title, message, confirmLabel, busyLabel, busy = false, onConfirm, onCancel }: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    cancelRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      if (!busy) onCancel()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [busy, onCancel])

  return createPortal(
    <div className="dashboard-settings-overlay" onClick={() => { if (!busy) onCancel() }}>
      <div
        className="dashboard-settings-modal confirm-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-body"
        onClick={e => e.stopPropagation()}
      >
        <div className="dashboard-settings-header">
          <h2 id="confirm-title">{title}</h2>
        </div>
        <div className="confirm-body" id="confirm-body">{message}</div>
        <div className="dashboard-settings-footer">
          <button ref={cancelRef} className="ds-btn ds-btn-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
          <button className="ds-btn ds-btn-danger" onClick={onConfirm} disabled={busy}>
            {busy && busyLabel ? busyLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
