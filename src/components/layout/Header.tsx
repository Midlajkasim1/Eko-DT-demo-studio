import { useProjectStore } from '@/store/useProjectStore'
import { useAppStore } from '@/store/useAppStore'
import { useModelStore } from '@/store/useModelStore'
import { useMapStore } from '@/store/useMapStore'
import { hasMap } from '@/lib/mapConfig'

export function Header() {
  const currentProject = useProjectStore(s => s.currentProject)
  const isDirty = useProjectStore(s => s.isDirty)
  const closeProject = useProjectStore(s => s.closeProject)
  const saveProject = useProjectStore(s => s.saveProject)
  const setStep = useAppStore(s => s.setStep)
  const step = useAppStore(s => s.step)
  const clearModels = useModelStore(s => s.clearModels)

  const handleBack = () => {
    useAppStore.getState().setMaterialPickerActive(false)
    useAppStore.getState().setSelectedMaterialElement(null)
    useAppStore.getState().setIsFullscreen(false)
    useAppStore.getState().setIsToolbarVisible(true)

    // With a map open the previous screen is the map, not the project list
    const returnToMap = (window as never as { __returnToMap?: () => void }).__returnToMap
    if (step === 'viewing' && hasMap(currentProject) && returnToMap) {
      returnToMap()
      return
    }

    clearModels()
    useModelStore.getState().setActiveModelId(null)
    useMapStore.getState().reset()
    closeProject()
    setStep('projects')
  }

  const handleSave = async () => {
    await saveProject()
  }

  return (
    <header className="header">
      <div className="header-brand">
        {currentProject ? (
          <button className="header-back-btn" onClick={handleBack} title="Back to projects">
            <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
              <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd"/>
            </svg>
          </button>
        ) : (
          <svg className="header-logo" viewBox="0 0 32 32" fill="none">
            <rect x="4" y="16" width="10" height="12" fill="#186d4e" opacity="0.9"/>
            <rect x="16" y="10" width="10" height="18" fill="#186d4e" opacity="0.6"/>
            <rect x="10" y="6" width="6" height="10" fill="#186d4e" opacity="0.4"/>
            <polygon points="4,16 9,8 14,16" fill="#0e4937" opacity="0.8"/>
          </svg>
        )}
        <div>
          {currentProject ? (
            <>
              <h1 className="header-title">
                {currentProject.name}
                {isDirty && <span className="header-unsaved-dot" title="Unsaved changes" />}
              </h1>
              <p className="header-subtitle">Project</p>
            </>
          ) : (
            <>
              <h1 className="header-title">IFC Fragments Viewer</h1>
              <p className="header-subtitle">Convert · View · Download</p>
            </>
          )}
        </div>
      </div>
      <div className="header-actions">
        {currentProject && (
          <button
            className={`header-save-btn ${isDirty ? 'unsaved' : ''}`}
            onClick={handleSave}
            title={isDirty ? 'Save project' : 'Project saved'}
          >
            <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14">
              <path d="M5 3a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2V7.414a2 2 0 00-.586-1.414l-2.414-2.414A2 2 0 0012.586 3H5zm1 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 4a1 1 0 100 2h6a1 1 0 100-2H7z"/>
            </svg>
            {isDirty ? 'Save' : 'Saved'}
          </button>
        )}
      </div>
    </header>
  )
}
