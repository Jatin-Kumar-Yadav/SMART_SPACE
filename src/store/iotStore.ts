import { create } from 'zustand'
import { generateFirmware, type FirmwareFile } from '@/iot/firmware'
import { buildPlan } from '@/iot/planner'
import { defaultHardware, proposeSensors } from '@/iot/requirements'
import type { HardwarePlan } from '@/iot/types'
import { connectionGuide } from '@/iot/wiring'
import { buildManifest, type HardwareManifest } from '@/iot/manifest'
import { generateWokwi, type WokwiResult } from '@/iot/wokwi'
import type { HardwareConfig, SensorPoint, Space } from '@/types'
import { useEditor } from './editorStore'
import { onRunModeChanged, setLivePlan } from './liveStore'
import { getEngine, simInit, simPublish } from './simStore'

export type IotTab = 'code' | 'libraries' | 'pins' | 'validation' | 'live'
export type IotFilter = 'all' | 'inputs' | 'outputs'
export type IotView = '2d' | '3d'
export type SensorSource = 'simulated' | 'live'

interface IotUi {
  tab: IotTab
  ctrl: string | null
  plan: HardwarePlan | null
  firmware: FirmwareFile[]
  wokwi: Record<string, WokwiResult>
  guide: string
  manifest: HardwareManifest | null
  filter: IotFilter
  view: IotView
  /** selected component id (part, controller) or net id: its whole electrical path is highlighted */
  selected: string | null
  sensorSource: Record<string, SensorSource>
  /** last value injected into the simulation per sensor point (one-shot, labelled in the UI) */
  injected: Record<string, { value: number; at: number }>
  /** signature of the room + settings the plan was built from */
  builtFrom: string
  set: (p: Partial<Omit<IotUi, 'set'>>) => void
}

export const useIot = create<IotUi>((set) => ({ tab: 'code', ctrl: null, plan: null, firmware: [], wokwi: {}, guide: '', manifest: null, filter: 'all', view: '2d', selected: null, sensorSource: {}, injected: {}, builtFrom: '', set: (p) => set(p) }))

/** What the generated hardware depends on. When this changes the plan is out of date. */
export function signatureOf(space: Space): string {
  const h = space.hardware
  return JSON.stringify([
    h && { c: h.controller, t: h.tempPart, l: h.lightPart, p: h.includePresence, a: h.acOutput, s: h.sensors.map((x) => [x.id, x.kind, x.position, x.zone]), z: h.zoneCount, x: h.excludedDeviceIds, o: h.pinOverrides, v: h.motorSupplyV },
    space.objects.filter((o) => o.device).map((o) => [o.id, o.kind, o.position, o.device!.type]),
  ])
}

export function ensureHardware(): HardwareConfig | undefined {
  const sp = useEditor.getState().space
  if (!sp) return undefined
  if (!sp.hardware) useEditor.getState().setHardware(() => defaultHardware(sp))
  return useEditor.getState().space!.hardware
}

/** Edit the hardware settings. Settings that change which sensors exist re-propose the auto-placed ones. */
export function updateHardware(patch: Partial<HardwareConfig>, opts: { reposition?: boolean } = {}) {
  const sp = useEditor.getState().space
  if (!sp) return
  const modeChanged = patch.runMode !== undefined && patch.runMode !== sp.hardware?.runMode
  useEditor.getState().setHardware((h) => {
    const base = h ?? defaultHardware(sp)
    const next = { ...base, ...patch }
    if (opts.reposition) {
      const kept = next.sensors.filter((s) => !s.auto)
      next.sensors = [...proposeSensors(sp, next), ...kept]
    }
    return next
  })
  if (modeChanged) onRunModeChanged(patch.runMode!)
}

/** Build the plan and every generated file. This is what the "Generate Hardware Setup" button runs. */
export function generateHardwareSetup() {
  const sp = useEditor.getState().space
  if (!sp) return
  const cfg = ensureHardware()!
  const plan = buildPlan(sp, cfg)
  const firmware = plan.issues.some((i) => i.severity === 'error' && i.code === 'no-fit') ? [] : generateFirmware(plan, { spaceId: sp.id, topicRoot: cfg.mqttTopicRoot })
  const wokwi: Record<string, WokwiResult> = {}
  for (const c of plan.controllers) wokwi[c.id] = generateWokwi(plan, { spaceId: sp.id, controllerId: c.id })
  useIot.setState({ plan, firmware, wokwi, guide: connectionGuide(plan, cfg), manifest: buildManifest(plan, sp, cfg), selected: null, builtFrom: signatureOf(sp), ctrl: useIot.getState().ctrl && plan.controllers.some((c) => c.id === useIot.getState().ctrl) ? useIot.getState().ctrl : (plan.controllers[0]?.id ?? null) })
  setLivePlan(plan)
}

/**
 * Set what a sensor measures. The value goes into the SAME simulation engine the rest of the app uses
 * (one-shot: no feedback loop), so the fans, AC and lights react through the normal controller logic.
 */
export function injectSensor(sp: SensorPoint, value: number) {
  if (!getEngine()) simInit()
  const eng = getEngine()
  if (!eng) return
  if (sp.kind === 'temperature') eng.assimilateTemperature(sp.position[0], sp.position[2], value)
  else if (sp.kind === 'light') eng.assimilateLux(sp.position[0], sp.position[2], value)
  else return
  simPublish()
  useIot.setState((s) => ({ injected: { ...s.injected, [sp.id]: { value, at: Date.now() } } }))
}
