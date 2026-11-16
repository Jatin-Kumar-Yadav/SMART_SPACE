import { Columns2, Radio, Square, Video } from 'lucide-react'
import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Toggle } from '@/components/ui/controls'
import { Tip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { getRuntime, setLiveFeed, syncCameras, unionCommitted, useCameraUi } from '@/store/cameraStore'
import { useEditor } from '@/store/editorStore'
import { EditorCanvas } from '@/three/scene/EditorCanvas'
import { CameraPanel } from './CameraPanel'
import { FeedStage } from './FeedStage'

/** True while any camera input is on (phone link, playing video, analysis loop). */
function useCameraActive() {
  return useCameraUi((s) => Object.values(s.states).some((r) => r.live || r.analyzing || ['connecting-server', 'waiting-for-phone', 'negotiating', 'streaming'].includes(r.mobile.status)))
}

function stopAllCameraInput() {
  for (const id of Object.keys(useCameraUi.getState().states)) {
    const rt = getRuntime(id)
    if (!rt) continue
    rt.stopLoop()
    if (rt.state.kind === 'mobile') {
      rt.stopMobile()
      rt.reset()
    } else rt.video?.pause()
  }
}

export function CameraWorkspace() {
  const live = useCameraUi((s) => s.liveFeed)
  const layout = useCameraUi((s) => s.layout)
  const ui = useCameraUi((s) => s.set)
  const active = useCameraActive()
  const calibrated = useEditor((s) => s.space!.cameras.some((c) => c.level !== 'none'))
  const seated = useCameraUi((s) => (s.liveFeed ? unionCommitted().length : 0))

  useEffect(() => {
    syncCameras()
  }, [])

  return (
    <>
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden" aria-label="Live camera workspace">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-slate-200 bg-white px-3 py-2">
          <div className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-800"><Video size={15} className="text-blue-600" />Live Camera Digital Twin</div>

          <div className={cn('flex items-center gap-2 rounded-lg border px-2.5 py-1', live ? 'border-green-300 bg-green-50' : 'border-slate-200 bg-slate-50')}>
            <Toggle checked={live} onChange={(v) => setLiveFeed(v)} label="Live Occupancy Feed" />
            <span className={cn('rounded px-1.5 py-0.5 text-[10.5px] font-bold tracking-wide', live ? 'bg-green-600 text-white' : 'bg-slate-300 text-slate-700')}>{live ? 'ON' : 'OFF'}</span>
          </div>
          {live && <span className="text-[12px] text-slate-600">Camera drives occupancy: <b>{seated}</b> seat{seated === 1 ? '' : 's'} seated.{!calibrated && <span className="ml-1 text-amber-700">Calibrate a camera so detections can be mapped to seats.</span>}</span>}

          <div className="ml-auto flex items-center gap-2">
            {active ? (
              <span className="flex items-center gap-1.5 rounded-full bg-red-50 px-2.5 py-1 text-[11.5px] font-semibold text-red-700" role="status"><Radio size={13} className="animate-pulse" />Camera input active</span>
            ) : (
              <span className="text-[11.5px] text-slate-400">Camera idle</span>
            )}
            <Button size="sm" variant="danger" disabled={!active} onClick={stopAllCameraInput}><Square size={12} />Stop camera input</Button>
            <div className="flex rounded-lg border border-slate-200 p-0.5" role="group" aria-label="Layout">
              {(['feed', 'split'] as const).map((l) => (
                <Tip key={l} label={l === 'feed' ? 'Camera feed only' : 'Camera feed | 3D room'}>
                  <button onClick={() => ui({ layout: l })} aria-pressed={layout === l} className={cn('flex h-7 items-center gap-1 rounded-md px-2 text-[12px] font-medium', layout === l ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100')}>
                    {l === 'split' && <Columns2 size={13} />}{l === 'feed' ? 'Feed' : 'Feed | 3D'}
                  </button>
                </Tip>
              ))}
            </div>
          </div>
        </div>
        <div className="flex min-h-0 flex-1">
          <FeedStage />
          {layout === 'split' && (
            <div className="relative min-w-0 flex-1 border-l border-slate-200" aria-label="3D room">
              <EditorCanvas />
              <div className="pointer-events-none absolute left-2 top-2 rounded-md bg-slate-900/70 px-2 py-1 text-[11px] text-white">3D room · seated people reflect the camera when the feed is ON</div>
            </div>
          )}
        </div>
      </main>
      <CameraPanel />
    </>
  )
}
