import { create } from 'zustand'
import { generateFirmware, type FirmwareFile } from '@/iot/firmware'
import { buildPlan } from '@/iot/planner'
import { defaultHardware, proposeSensors } from '@/iot/requirements'
import type { HardwarePlan } from '@/iot/types'
import { connectionGuide } from '@/iot/wiring'
import { generateWokwi, type WokwiResult } from '@/iot/wokwi'
import type { HardwareConfig, Space } from '@/types'
import { useEditor } from './editorStore'
import { onRunModeChanged, setLivePlan } from './liveStore'

export type IotTab = 'code' | 'pins' | 'components' | 'validation' | 'live'

interface IotUi {
  tab: IotTab
  ctrl: string | null
  plan: HardwarePlan | null
  firmware: FirmwareFile[]
  wokwi: Record<string, WokwiResult>
  guide: string
  /** signature of the room + settings the plan was built from */
  builtFrom: string
  tempThreshold: number
  lightThreshold: number
  set: (p: Partial<Omit<IotUi, 'set'>>) => void
}

export const useIot = create<IotUi>((set) => ({
  tab: 'code',
  ctrl: null,
  plan: null,
  firmware: [],
  wokwi: {},
  guide: '',
  builtFrom: '',
  tempThreshold: 24.0,
  lightThreshold: 400,
  set: (p) => set(p),
}))

/** What the generated hardware depends on. When this changes the plan is out of date. */
export function signatureOf(space: Space): string {
  const h = space.hardware
  return JSON.stringify([
    h && { c: h.controller, t: h.tempPart, l: h.lightPart, p: h.includePresence, a: h.acOutput, s: h.sensors.map((x) => [x.id, x.kind, x.position, x.zone]), x: h.excludedDeviceIds, o: h.pinOverrides, v: h.motorSupplyV },
    space.objects.filter((o) => o.device).map((o) => [o.id, o.kind, o.position, o.device!.type]),
  ])
}

export function ensureHardware(): HardwareConfig | undefined {
  const sp = useEditor.getState().space
  if (!sp) return undefined
  if (!sp.hardware) {
    useEditor.getState().setHardware(() => defaultHardware(sp))
  } else if (sp.hardware.controller === 'rpi') {
    useEditor.getState().setHardware((h) => ({ ...h!, controller: 'esp32', pinOverrides: {} }))
  }
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
  const { tempThreshold, lightThreshold } = useIot.getState()
  for (const c of plan.controllers) {
    wokwi[c.id] = generateWokwi(plan, {
      spaceId: sp.id,
      controllerId: c.id,
      tempThreshold,
      lightThreshold,
    })
  }
  useIot.setState({ plan, firmware, wokwi, guide: connectionGuide(plan, cfg), builtFrom: signatureOf(sp), ctrl: useIot.getState().ctrl && plan.controllers.some((c) => c.id === useIot.getState().ctrl) ? useIot.getState().ctrl : (plan.controllers[0]?.id ?? null) })
  setLivePlan(plan)
}
