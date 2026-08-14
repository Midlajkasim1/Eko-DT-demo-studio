import { useRef, useCallback } from 'react'
import { Header } from '@/components/layout/Header'
import { Sidebar } from '@/components/layout/Sidebar'
import { ViewerCanvas } from '@/components/viewer/ViewerCanvas'
import { ProjectListPage } from '@/components/project/ProjectListPage'
import { MapLayer } from '@/components/map/MapLayer'
import { useIfcConverter } from '@/hooks/useIfcConverter'
import { useAppStore } from '@/store/useAppStore'
import { useModelStore } from '@/store/useModelStore'
import { useProjectStore } from '@/store/useProjectStore'
import { captureCanvasThumbnail } from '@/lib/thumbnailCapture'
import type { FragmentsEngine } from '@/lib/fragmentsEngine'
import type { LoadedModel } from '@/types'

export default function App() {
  const engineRef = useRef<FragmentsEngine | null>(null)
  const setStep = useAppStore(s => s.setStep)
  const step = useAppStore(s => s.step)
  const addModel = useModelStore(s => s.addModel)
  const isFullscreen = useAppStore(s => s.isFullscreen)

  const currentProject = useProjectStore(s => s.currentProject)
  const addModelEntry = useProjectStore(s => s.addModelEntry)
  const updateThumbnail = useProjectStore(s => s.updateThumbnail)

  // Called immediately after a model is converted — saves to project folder
  const handleModelConverted = useCallback(async (model: LoadedModel) => {
    // Read project state directly from store to avoid stale closure
    const project = useProjectStore.getState().currentProject
    if (project) {
      await addModelEntry(model)
      // Capture thumbnail after scene has rendered the new model
      setTimeout(async () => {
        const thumb = captureCanvasThumbnail(engineRef.current)
        if (thumb) await updateThumbnail(thumb)
      }, 3000)
    }
  }, [addModelEntry, updateThumbnail])

  const { convert } = useIfcConverter({ onConverted: handleModelConverted })

  // Handle files dropped/selected from upload zone
  const handleFiles = useCallback(async (files: File[]) => {
    setStep('uploading')

    for (const file of files) {
      const isFragFile = file.name.toLowerCase().endsWith('.frag')
      const isGlbFile = file.name.toLowerCase().endsWith('.glb') || file.name.toLowerCase().endsWith('.gltf')

      if (isFragFile || isGlbFile) {
        const buffer = await file.arrayBuffer()
        const model: LoadedModel = {
          modelId: `model-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 9)}`,
          originalFileName: file.name,
          originalFileSizeBytes: file.size,
          convertedFileSizeBytes: buffer.byteLength,
          conversionTimeMs: 0,
          fragBytes: buffer,
          type: isGlbFile ? 'glb' : 'frag',
        }
        addModel(model)
        const project = useProjectStore.getState().currentProject
        if (project) {
          await addModelEntry(model)
          // Capture thumbnail after a render delay
          setTimeout(async () => {
            const thumb = captureCanvasThumbnail(engineRef.current)
            if (thumb) await updateThumbnail(thumb)
          }, 3000)
        }
        setStep('viewing')
      } else {
        // IFC → convert → onConverted callback fires → saves to project
        const buffer = await file.arrayBuffer()
        await convert(new Uint8Array(buffer), file.name, file.size)
      }
    }
  }, [convert, addModel, addModelEntry, setStep, updateThumbnail])

  const handleEngineReady = useCallback(
    (ref: React.MutableRefObject<FragmentsEngine | null>) => {
      engineRef.current = ref.current
    },
    []
  )

  return (
    <div className="app-layout">
      {!isFullscreen && step !== 'map' && <Header />}
      <div className="app-body">
        {!isFullscreen && step !== 'projects' && step !== 'map' && <Sidebar onFiles={handleFiles} engineRef={engineRef} />}
        <main className="app-main">
          {step === 'projects' && (
            <div className="projects-page">
              <ProjectListPage engineRef={engineRef} />
            </div>
          )}
          <ViewerCanvas onEngineReady={handleEngineReady} adminMode={true} />
          <MapLayer adminMode={true} engineRef={engineRef} />
        </main>
      </div>
    </div>
  )
}
