import { isDeviceKind } from '@/objects/catalog'
import type {
  DeviceState,
  LightingPreset,
  LightingScenario,
  Occupant,
  Scenario,
  SceneObject,
  SimSettings,
  Space,
} from '@/types'
import { clamp, newId, randInt, randRange, type Rng } from '@/utils/math'

export const DEFAULT_SIM: SimSettings = {
  resolution: 'standard',
  thermalMassMultiplier: 6,
  envelopeU: 0.8,
  equipmentW: 0,
  occupantHeatW: 75,
  airDensity: 1.2,
  toleranceC: 1,
  educationalAcOffset: false,
}

export const LIGHTING_PRESETS: Record<Exclude<LightingPreset, 'custom'>, { label: string; time: [number, number]; cloud: [number, number] }> = {
  'sunny-morning': { label: 'Sunny Morning', time: [8, 10.5], cloud: [0, 0.2] },
  'cloudy-afternoon': { label: 'Cloudy Afternoon', time: [13, 16], cloud: [0.45, 0.85] },
  evening: { label: 'Evening', time: [17.5, 19], cloud: [0.1, 0.6] },
  night: { label: 'Night', time: [20.5, 23.5], cloud: [0, 0.5] },
}

export function createScenario(name = 'Default scenario'): Scenario {
  return {
    id: newId('scn'),
    name,
    initialTempC: 32,
    outsideTempC: 35,
    targetTempC: 24,
    targetLux: 500,
    occupancy: { mode: 'random', fixed: 10, percentage: 60 },
    occupancySource: 'random',
    occupants: [],
    lighting: { preset: 'cloudy-afternoon', timeOfDay: 14, cloudCover: 0.4 },
    autoLighting: true,
    deviceStates: {},
    windowStates: {},
    sim: { ...DEFAULT_SIM },
  }
}

/** Random ambient indoor temperature in 27–40 °C (air temperature, not body temperature). */
export const randomIndoorTemp = (rng: Rng) => Math.round(randRange(rng, 27, 40) * 10) / 10

export function randomLighting(rng: Rng, preset?: Exclude<LightingPreset, 'custom'>): LightingScenario {
  const keys = Object.keys(LIGHTING_PRESETS) as Exclude<LightingPreset, 'custom'>[]
  const key = preset ?? keys[randInt(rng, 0, keys.length - 1)]
  const p = LIGHTING_PRESETS[key]
  return {
    preset: key,
    timeOfDay: Math.round(randRange(rng, p.time[0], p.time[1]) * 4) / 4,
    cloudCover: Math.round(randRange(rng, p.cloud[0], p.cloud[1]) * 100) / 100,
  }
}

/** Snapshot of the device operating states and window states currently set on the layout. */
export function captureStates(objects: SceneObject[]): Pick<Scenario, 'deviceStates' | 'windowStates'> {
  const deviceStates: Record<string, DeviceState> = {}
  const windowStates: Record<string, boolean> = {}
  for (const o of objects) {
    const d = o.device
    if (d?.type === 'fan' || d?.type === 'ac') deviceStates[o.id] = { mode: d.mode, level: d.level }
    else if (d?.type === 'light') deviceStates[o.id] = { mode: d.mode, on: d.on, dimming: d.dimming }
    if (o.kind === 'window' && o.window) windowStates[o.id] = o.window.open
  }
  return { deviceStates, windowStates }
}

/**
 * Apply a scenario's device & window states to the objects. Positions and
 * every other physical property of the layout are left untouched.
 */
export function applyScenarioStates(objects: SceneObject[], scenario: Pick<Scenario, 'deviceStates' | 'windowStates'>): SceneObject[] {
  return objects.map((o) => {
    const st = scenario.deviceStates[o.id]
    const win = scenario.windowStates[o.id]
    if (!st && win === undefined) return o
    const next: SceneObject = { ...o }
    if (st && o.device) {
      if (o.device.type === 'light') {
        next.device = { ...o.device, mode: st.mode, on: st.on ?? o.device.on, dimming: st.dimming ?? o.device.dimming }
      } else {
        next.device = { ...o.device, mode: st.mode, level: clamp(st.level ?? o.device.level, 0, o.device.levels.length - 1) }
      }
    }
    if (win !== undefined && o.window) next.window = { ...o.window, open: win }
    return next
  })
}

export const spaceWithScenario = (space: Space, scenario: Scenario): Space => ({
  ...space,
  objects: applyScenarioStates(space.objects, scenario),
})

/** Keep occupants valid for the scenario heat setting. */
export const withHeat = (occ: Occupant[], heatW: number) => occ.map((o) => ({ ...o, heatW }))

export const deviceObjects = (objects: SceneObject[]) => objects.filter((o) => isDeviceKind(o.kind))
