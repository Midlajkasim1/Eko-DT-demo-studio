import { useState } from 'react'
import { useAppStore } from '@/store/useAppStore'
import { VIEW_TEMPLATES, getViewTemplate, skyCss, type ViewTemplate } from '@/constants/viewTemplates'
import type { TemplateId } from '@/constants/renderSettings'


interface TemplatePickerProps {
 
  variant?: 'panel' | 'bar'
}
import { useProjectStore } from '@/store/useProjectStore'

export function TemplatePicker({ variant = 'panel' }: TemplatePickerProps) {
  const templateId = useAppStore(s => s.templateId)
  const setTemplate = useAppStore(s => s.setTemplate)
  const setLightingParams = useAppStore(s => s.setLightingParams)
  const currentProject = useProjectStore(s => s.currentProject)
  const xrayColor = useAppStore(s => s.xrayColor || 'blue')

  const handlePick = (id: TemplateId) => {
    if (id === 'default' && currentProject?.renderSettings) {
      setLightingParams({
        templateId: 'default',
        realisticMode: currentProject.renderSettings.realisticMode ?? false,
        renderLite: currentProject.renderSettings.renderLite ?? false
      })
    } else {
      setTemplate(id)
    }
  }

  return (
    <div className={`tpl-picker-container`}>
      <div className={`tpl-grid tpl-grid--${variant}`} role="group" aria-label="Rendering template">
        {VIEW_TEMPLATES.map(template => (
          <TemplateCard
            key={template.id}
            template={template}
            active={templateId === template.id}
            onPick={handlePick}
          />
        ))}
      </div>
      {templateId === 'xray' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', width: '100%', marginTop: '10px' }}>
          <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.6)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>X-ray Color</span>
          <div style={{ display: 'flex', gap: '6px' }}>
            {(['blue', 'white'] as const).map(c => {
              const isActive = xrayColor === c
              return (
                <button
                  key={c}
                  onClick={() => setLightingParams({ xrayColor: c })}
                  style={{
                    flex: 1, padding: '5px 8px', borderRadius: '6px',
                    border: `1px solid ${isActive ? '#29a8df' : 'rgba(255,255,255,0.18)'}`,
                    background: isActive ? '#29a8df' : 'rgba(255,255,255,0.07)',
                    color: '#ffffff',
                    fontSize: '11px', fontWeight: isActive ? 600 : 400,
                    cursor: 'pointer', transition: 'all 0.15s'
                  }}
                >
                  {c.charAt(0).toUpperCase() + c.slice(1)}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function TemplateCard({
  template, active, onPick,
}: { template: ViewTemplate; active: boolean; onPick: (id: TemplateId) => void }) {
  const { card } = template

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


// Exported Templatebar on viewer
// export function TemplateBar({ defaultOpen = true }: { defaultOpen?: boolean }) {
//   const [open, setOpen] = useState(defaultOpen)
//   const templateId = useAppStore(s => s.templateId)
//   const active = getViewTemplate(templateId)

//   return (
//     <div className={`tpl-bar${open ? ' open' : ''}`}>
//       {open && <TemplatePicker variant="bar" />}
//       <button
//         type="button"
//         className="tpl-bar-toggle"
//         aria-expanded={open}
//         title={open ? 'Hide templates' : 'Change template'}
//         onClick={() => setOpen(v => !v)}
//       >
//         <span className="tpl-swatch" style={{ background: skyCss(active.card.sky) }} aria-hidden="true" />
//         <span className="tpl-bar-label">{active.label}</span>
//         <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="11" height="11" aria-hidden="true">
//           <path d={open ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'} />
//         </svg>
//       </button>
//     </div>
//   )
// }
