import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { getRepository } from '@/database/repository'
import { DEMO_SPACE_ID } from '@/demo/seminarHall'
import { installDemo } from './Dashboard'
import { navigate } from '@/hooks/useHashRoute'
import { saveNow, useAutosaveAndSync, useBeforeUnload } from '@/hooks/useSpaceLifecycle'
import { useShortcuts } from '@/hooks/useShortcuts'
import { useSimClock } from '@/hooks/useSimClock'
import { useLayout } from '@/store/layoutStore'
import { ModeRail } from './ModeRail'
import { CameraWorkspace } from '@/components/camera/CameraWorkspace'
import { IoTWorkspace } from '@/components/iot/IoTWorkspace'
import { useEditor } from '@/store/editorStore'
import { toast } from '@/store/uiStore'
import { EditorCanvas } from '@/three/scene/EditorCanvas'
import { LayerChips } from '@/components/editor/LayerChips'
import { LibraryPanel } from '@/components/panels/LibraryPanel'
import { BottomDock } from '@/components/simulation/BottomDock'
import { HoverTooltip } from '@/components/simulation/HoverTooltip'
import { Legend } from '@/components/simulation/Legend'
import { RightPanel } from './RightPanel'
import { TopBar } from './TopBar'

function Editor() {
  useAutosaveAndSync()
  useBeforeUnload()
  useShortcuts()
  useSimClock()
  const tool = useEditor((s) => s.tool)
  const mode = useLayout((s) => s.mode)
  return (
    <div className="flex h-full flex-col bg-slate-100">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <LibraryPanel />
        <ModeRail />
        {mode === 'simulation' && (
          <>
            <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
              <div className="relative min-h-0 flex-1">
                <EditorCanvas />
                <LayerChips />
                <Legend />
                {tool === 'wall' && <div className="pointer-events-none absolute left-1/2 top-14 -translate-x-1/2 rounded-md bg-slate-900/85 px-3 py-1.5 text-[12px] text-white">Wall tool: click to start, click again to finish · Esc to stop</div>}
              </div>
              <BottomDock />
            </main>
            <RightPanel />
          </>
        )}
        {mode === 'camera' && <CameraWorkspace />}
        {mode === 'iot' && <IoTWorkspace />}
      </div>
      <HoverTooltip />
    </div>
  )
}

/** Loads the space named in the URL, shows the editor, and saves on the way out. */
export function EditorPage({ id }: { id: string }) {
  const loaded = useEditor((s) => s.space?.id === id)
  const [missing, setMissing] = useState(false)
  useEffect(() => {
    let alive = true
    setMissing(false)
    getRepository().get(id).then(async (s) => {
      if (!s && id === DEMO_SPACE_ID) s = await installDemo() // deep link to the demo in a fresh browser
      if (!alive) return
      if (!s) {
        setMissing(true)
        toast('That space no longer exists', 'warning')
        navigate({ kind: 'dashboard' })
        return
      }
      useEditor.getState().openSpace(s)
      useLayout.getState().set({ mode: 'simulation' })
    }).catch((e) => {
      console.error(e)
      setMissing(true)
      toast('Could not open the space from the browser database', 'error')
    })
    return () => {
      alive = false
      void saveNow({ thumbnail: true })
      useEditor.getState().closeSpace()
    }
  }, [id])
  if (!loaded) {
    return <div className="grid h-full place-items-center text-slate-500">{missing ? 'Space not found.' : <span className="flex items-center gap-2"><Loader2 className="animate-spin" size={16} />Opening space…</span>}</div>
  }
  return <Editor />
}
