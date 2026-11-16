import { create } from 'zustand'
import { SimEngine, type DevicePatch } from '@/simulation/engine'
import type { SimSnapshot } from '@/simulation/types'
import { formatDuration } from '@/simulation/analytic'
import { activeScenario, useEditor } from './editorStore'
import { toast } from './uiStore'

/** Simulated seconds that pass per real second at 1× speed (1× = 1 simulated minute per second). */
export const SIM_RATE = 60
export const SPEEDS = [1, 2, 5, 10] as const
/** Hard stop so a run can never go on forever (simulated seconds). */
const MAX_SIM_SECONDS = 6 * 3600
const FRAME_BUDGET_MS = 10
const SNAPSHOT_INTERVAL_MS = 180

export type SimStatus = 'stopped' | 'running' | 'paused'

interface SimState {
  status: SimStatus
  speed: number
  snapshot: SimSnapshot | null
  /** true once the comfort criterion has been reached during the current run */
  comfortReached: boolean
  setSpeed: (n: number) => void
}

export const useSim = create<SimState>((set) => ({
  status: 'stopped',
  speed: 5,
  snapshot: null,
  comfortReached: false,
  setSpeed: (speed) => set({ speed }),
}))

let engine: SimEngine | null = null
let engineSpaceId: string | null = null
let syncTimer: ReturnType<typeof setTimeout> | null = null
let lastPublish = 0
let comfortToastShown = false

export const getEngine = () => engine

function publish(force = false) {
  if (!engine) return
  const now = performance.now()
  if (!force && now - lastPublish < SNAPSHOT_INTERVAL_MS) return
  lastPublish = now
  const snapshot = engine.snapshot()
  useSim.setState({ snapshot })
}

/** (Re)create the engine for the open space. Called when a space is opened. */
export function simInit() {
  const space = useEditor.getState().space
  if (!space) {
    engine = null
    engineSpaceId = null
    useSim.setState({ snapshot: null, status: 'stopped' })
    return
  }
  engine = new SimEngine(space, activeScenario(space))
  engineSpaceId = space.id
  comfortToastShown = false
  useSim.setState({ status: 'stopped', comfortReached: false })
  publish(true)
}

/** Push layout / scenario edits into the engine (debounced, keeps the current temperatures). */
export function simSync() {
  if (syncTimer) clearTimeout(syncTimer)
  syncTimer = setTimeout(() => {
    syncTimer = null
    const space = useEditor.getState().space
    if (!space) return
    if (!engine || engineSpaceId !== space.id) return simInit()
    try {
      engine.rebuild(space, activeScenario(space))
    } catch (e) {
      console.error('simulation rebuild failed', e)
      toast('Simulation could not be rebuilt after the last change', 'error')
    }
    publish(true)
  }, 160)
}

/** Apply a live device change (mode / level / on / dimming) to the running engine. */
export function simSetDevice(id: string, patch: DevicePatch) {
  engine?.setDevice(id, patch)
  publish(true)
}

export function simStart() {
  if (!engine) simInit()
  const { status } = useSim.getState()
  if (status === 'stopped') {
    const space = useEditor.getState().space
    if (space) engine!.rebuild(space, activeScenario(space))
    engine!.reset()
    comfortToastShown = false
    useSim.setState({ comfortReached: false })
  }
  useSim.setState({ status: 'running' })
  publish(true)
}

export const simPause = () => useSim.setState({ status: 'paused' })
export const simResume = () => useSim.setState({ status: 'running' })

export function simStop() {
  engine?.reset()
  comfortToastShown = false
  useSim.setState({ status: 'stopped', comfortReached: false })
  publish(true)
}

export function simReset() {
  engine?.reset()
  comfortToastShown = false
  useSim.setState({ comfortReached: false })
  publish(true)
}

/** Fast-forward by `seconds` of simulated time without animating. */
export function simSkip(seconds: number) {
  if (!engine) return
  if (useSim.getState().status === 'stopped') useSim.setState({ status: 'paused' })
  engine.advance(seconds)
  checkComfort()
  publish(true)
}

function checkComfort() {
  if (!engine || comfortToastShown) return
  const st = engine.snapshot().stats
  if (st.comfort.occupiedComfort && st.comfort.averageTargetReached && st.occupants > 0) {
    comfortToastShown = true
    useSim.setState({ comfortReached: true })
    toast(`Simulation completed: comfort reached after ${formatDuration(st.time)}`, 'success')
  }
}

/** Drive the engine from the animation loop. `dt` is real seconds since the previous frame. */
export function simTick(dt: number) {
  if (!engine) return
  const { status, speed } = useSim.getState()
  if (status !== 'running') return
  let remaining = Math.min(dt, 0.1) * SIM_RATE * speed
  const t0 = performance.now()
  while (remaining > 1e-6 && performance.now() - t0 < FRAME_BUDGET_MS) {
    const slice = Math.min(remaining, 30)
    engine.advance(slice)
    remaining -= slice
  }
  if (engine.time >= MAX_SIM_SECONDS) {
    useSim.setState({ status: 'paused' })
    toast('Simulation paused at the 6-hour limit', 'info')
  }
  checkComfort()
  publish()
}
