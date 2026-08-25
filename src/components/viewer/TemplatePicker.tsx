import { useState } from 'react'
import { useAppStore } from '@/store/useAppStore'
import { VIEW_TEMPLATES, getViewTemplate, skyCss, type ViewTemplate } from '@/constants/viewTemplates'
import type { TemplateId } from '@/constants/renderSettings'

/**
 * The strip of cards, one per view template. Each card is a tiny picture of what
 * it does — its own sky behind two massing blocks, lit and drawn the way that
 * template draws the model — so the choice is made by eye rather than by name.
 *
 * Built from {@link VIEW_TEMPLATES} rather than written out, so a new template
 * appears here by existing.
 */

interface TemplatePickerProps {
  /** 'panel' is the studio's render panel; 'bar' is the exported viewer's switcher */
  variant?: 'panel' | 'bar'
}

export function TemplatePicker({ variant = 'panel' }: TemplatePickerProps) {
  const templateId = useAppStore(s => s.templateId)
  const setTemplate = useAppStore(s => s.setTemplate)

  return (
    <div className={`tpl-grid tpl-grid--${variant}`} role="group" aria-label="Rendering template">
      {VIEW_TEMPLATES.map(template => (
        <TemplateCard
          key={template.id}
          template={template}
          active={templateId === template.id}
          onPick={setTemplate}
        />
      ))}
    </div>
  )
}

function TemplateCard({
  template, active, onPick,
}: { template: ViewTemplate; active: boolean; onPick: (id: TemplateId) => void }) {
  const { card } = template
  // The card is drawn from the template's own colours, so the two never drift apart
  const style = {
    '--card-sky': skyCss(card.sky),
    '--card-horizon': card.horizon,
    '--card-face': card.face,
    '--card-shade': card.shade,
    '--card-ink': card.ink,
    '--card-glow': String(card.glow),
    '--card-line': card.line ? '1.5px' : '0px',
  } as React.CSSProperties

  return (
    <button
      type="button"
      className="tpl-card"
      style={style}
      aria-pressed={active}
      title={`${template.label} — ${template.note}`}
      onClick={() => onPick(template.id)}
    >
      <span className="tpl-shot" aria-hidden="true">
        <span className="tpl-sun" />
        <span className="tpl-ground" />
        <span className="tpl-mass tpl-mass--tall" />
        <span className="tpl-mass tpl-mass--low" />
      </span>
      <span className="tpl-name">{template.label}</span>
      <span className="tpl-note">{template.note}</span>
    </button>
  )
}

/**
 * The switcher the exported viewer carries: the same cards as a floating strip
 * along the bottom, so a template can be changed without the studio.
 *
 * It folds down to a pill, because a project with a dashboard has its own chrome
 * along the bottom edge. A dashboard that wants it somewhere else can move it
 * without touching this code — `--tpl-bar-bottom` and `--tpl-bar-left` are read
 * off the page, so one CSS rule in the dashboard template is enough.
 */
export function TemplateBar({ defaultOpen = true }: { defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const templateId = useAppStore(s => s.templateId)
  const active = getViewTemplate(templateId)

  return (
    <div className={`tpl-bar${open ? ' open' : ''}`}>
      {open && <TemplatePicker variant="bar" />}
      <button
        type="button"
        className="tpl-bar-toggle"
        aria-expanded={open}
        title={open ? 'Hide templates' : 'Change template'}
        onClick={() => setOpen(v => !v)}
      >
        <span className="tpl-swatch" style={{ background: skyCss(active.card.sky) }} aria-hidden="true" />
        <span className="tpl-bar-label">{active.label}</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="11" height="11" aria-hidden="true">
          <path d={open ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'} />
        </svg>
      </button>
    </div>
  )
}
