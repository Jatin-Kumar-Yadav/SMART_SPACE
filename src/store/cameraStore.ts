import { create } from 'zustand'
import { allSeatSlots } from '@/simulation/occupancy'
import { createOnnxPersonDetector, createOnnxPersonDetectorFromBytes, ModelMissingError, type PersonDetector } from '@/vision/detector'
import { CameraRuntime, type RuntimeState } from '@/vision/runtime'
import type { CameraConfig, OccupancySource } from '@/types'
import { newId } from '@/utils/math'
import { activeScenario, useEditor } from './editorStore'
import { toast } from './uiStore'

export type DetectorState = 'idle' | 'loading' | 'ready' | 'missing' | 'error'
export type CameraTab = 'detect' | 'calibrate' | 'mapping' | 'cameras'
export type StageTool = 'view' | 'calibrate' | 'draw'
export type CameraLayout = 'feed' | 'split'

interface CameraUi {
  activeId: string | null
  layout: CameraLayout
  tab: CameraTab
  tool: StageTool
  selectedTrack: number | null
  /** calibration point currently receiving a click / world pick */
  selectedPoint: number | null
  showSeats: boolean
  /** draw each calibrated camera and its field of view inside the 3D room */
  showFrustum: boolean
  detector: { state: DetectorState; message: string; name?: string }
  states: Record<string, RuntimeState>
  /** the user switched the Live Occupancy Feed on */
  liveFeed: boolean
  /** the source that was active before the camera took over (restored when it is switched off) */
  previousSource: Exclude<OccupancySource, 'camera'>
  set: (p: Partial<Omit<CameraUi, 'set'>>) => void
}

export const useCameraUi = create<CameraUi>((set) => ({
  activeId: null,
  layout: 'split',
  tab: 'detect',
  tool: 'view',
  selectedTrack: null,
  selectedPoint: null,
  showSeats: true,
  showFrustum: true,
  detector: { state: 'idle', message: '' },
  states: {},
  liveFeed: false,
  previousSource: 'random',
  set: (p) => set(p),
}))

// ── runtimes & detector (module level: they must outlive the Camera screen) ───────────────
const runtimes = new Map<string, CameraRuntime>()
const unsub = new Map<string, () => void>()
let detector: PersonDetector | null = null
let detectorLoading: Promise<PersonDetector | null> | null = null

const setDetector = (d: CameraUi['detector']) => useCameraUi.setState({ detector: d })

/** Load the person model (once). Never throws: a missing model is a state the UI explains. */
export function ensureDetector(): Promise<PersonDetector | null> {
  if (detector) return Promise.resolve(detector)
  if (detectorLoading) return detectorLoading
  setDetector({ state: 'loading', message: 'Loading the person-detection model…' })
  detectorLoading = createOnnxPersonDetector(undefined, (m) => setDetector({ state: 'loading', message: m }))
    .then((d) => {
      detector = d
      setDetector({ state: 'ready', message: 'Model ready', name: d.name })
      return d
    })
    .catch((e: unknown) => {
      if (e instanceof ModelMissingError) setDetector({ state: 'missing', message: e.message })
      else setDetector({ state: 'error', message: e instanceof Error ? e.message : String(e) })
      return null
    })
    .finally(() => {
      detectorLoading = null
    })
  return detectorLoading
}

/** Use a model file the person picked (alternative to `npm run fetch-model`). */
export async function loadModelFromFile(file: File): Promise<boolean> {
  setDetector({ state: 'loading', message: `Loading ${file.name}…` })
  try {
    detector?.dispose()
    detector = await createOnnxPersonDetectorFromBytes(await file.arrayBuffer(), (m) => setDetector({ state: 'loading', message: m }))
    setDetector({ state: 'ready', message: 'Model ready', name: detector.name })
    return true
  } catch (e) {
    detector = null
    setDetector({ state: 'error', message: e instanceof Error ? e.message : String(e) })
    return false
  }
}

export const getRuntime = (id: string) => runtimes.get(id)
export const activeRuntime = () => {
  const id = useCameraUi.getState().activeId
  return id ? runtimes.get(id) : undefined
}

function ensureRuntime(id: string): CameraRuntime {
  let rt = runtimes.get(id)
  if (!rt) {
    rt = new CameraRuntime(id, ensureDetector)
    runtimes.set(id, rt)
    unsub.set(id, rt.subscribe((s) => {
      useCameraUi.setState((u) => ({ states: { ...u.states, [id]: s } }))
      publishOccupancy()
    }))
    useCameraUi.setState((u) => ({ states: { ...u.states, [id]: rt!.state } }))
  }
  return rt
}

/** Keep one runtime per project camera and give each the current seats and calibration. */
export function syncCameras() {
  const space = useEditor.getState().space
  const cams = space?.cameras ?? []
  const seats = space ? allSeatSlots(space.objects) : []
  for (const c of cams) ensureRuntime(c.id).configure(c, seats)
  for (const id of [...runtimes.keys()]) {
    if (!cams.some((c) => c.id === id)) {
      unsub.get(id)?.()
      unsub.delete(id)
      runtimes.get(id)?.dispose()
      runtimes.delete(id)
      useCameraUi.setState((u) => {
        const states = { ...u.states }
        delete states[id]
        return { states, activeId: u.activeId === id ? (cams[0]?.id ?? null) : u.activeId }
      })
    }
  }
  const ui = useCameraUi.getState()
  if (!ui.activeId || !cams.some((c) => c.id === ui.activeId)) useCameraUi.setState({ activeId: cams[0]?.id ?? null })
}

/** Stop everything (project closed): streams off, loops stopped. */
export function disposeCameras() {
  for (const [id, rt] of runtimes) {
    unsub.get(id)?.()
    rt.dispose()
  }
  runtimes.clear()
  unsub.clear()
  useCameraUi.setState({ states: {}, activeId: null, liveFeed: false, selectedTrack: null, selectedPoint: null, tool: 'view' })
}

// ── cameras in the project ───────────────────────────────────
export function addCamera(name?: string): string {
  const space = useEditor.getState().space
  const n = (space?.cameras.length ?? 0) + 1
  const cam: CameraConfig = { id: newId('cam'), name: name ?? `Camera ${n}`, imageSize: [1280, 720], hFovDeg: 70, points: [], level: 'none', updatedAt: Date.now() }
  useEditor.getState().upsertCamera(cam)
  syncCameras()
  useCameraUi.setState({ activeId: cam.id })
  return cam.id
}

/** The active camera, creating "Camera 1" on first use. */
export function ensureActiveCamera(): string {
  const ui = useCameraUi.getState()
  const space = useEditor.getState().space
  if (ui.activeId && space?.cameras.some((c) => c.id === ui.activeId)) return ui.activeId
  if (space?.cameras.length) {
    useCameraUi.setState({ activeId: space.cameras[0].id })
    return space.cameras[0].id
  }
  return addCamera()
}

// ── Live Occupancy Feed ──────────────────────────────────────
/** Seats confirmed by every camera, merged by seat key: a person seen by two cameras is one seat. */
export function unionCommitted(now = Date.now(), staleMs = 10_000): string[] {
  const seats = new Set<string>()
  for (const rt of runtimes.values()) {
    const s = rt.state
    if (!s.result) continue
    // a live stream that stopped delivering must not keep seats occupied forever
    if (s.kind === 'mobile' && now - s.resultAt > staleMs) continue
    for (const k of s.result.committed) seats.add(k)
  }
  return [...seats]
}

export function publishOccupancy() {
  if (!useCameraUi.getState().liveFeed) return
  useEditor.getState().setCameraOccupancy(unionCommitted())
}

export function setLiveFeed(on: boolean) {
  const ed = useEditor.getState()
  const space = ed.space
  if (!space) return
  const cur = activeScenario(space).occupancySource
  if (on) {
    if (cur !== 'camera') useCameraUi.setState({ previousSource: cur === 'iot' ? 'random' : cur })
    ed.setOccupancySource('camera')
    useCameraUi.setState({ liveFeed: true })
    publishOccupancy()
    toast('Live Occupancy Feed on: the camera now decides who is seated.', 'info')
  } else {
    useCameraUi.setState({ liveFeed: false })
    ed.setOccupancySource(useCameraUi.getState().previousSource)
    toast('Live Occupancy Feed off: the previous occupancy was restored.', 'info')
  }
}

/** Source picker shared by the People panel and the Camera screen. */
export function chooseOccupancySource(src: OccupancySource) {
  const ed = useEditor.getState()
  const space = ed.space
  if (!space) return
  if (src === 'camera') return setLiveFeed(true)
  if (activeScenario(space).occupancySource === 'camera') {
    useCameraUi.setState({ liveFeed: false })
  }
  ed.setOccupancySource(src)
  if (src === 'random' || src === 'manual') {
    const sc = activeScenario(useEditor.getState().space!)
    ed.updateScenario(sc.id, { occupancy: { ...sc.occupancy, mode: src === 'random' ? 'random' : sc.occupancy.mode === 'random' ? 'fixed' : sc.occupancy.mode } })
  }
}

/** Human-friendly seat name, e.g. "Chair 3" or "Sofa · seat 2". */
export function seatLabel(key: string): string {
  const space = useEditor.getState().space
  const [objectId, idx] = key.split(':')
  const o = space?.objects.find((x) => x.id === objectId)
  if (!o) return key
  const multi = allSeatSlots(space!.objects).filter((s) => s.objectId === objectId).length > 1
  return multi ? `${o.name} · seat ${Number(idx) + 1}` : o.name
}
