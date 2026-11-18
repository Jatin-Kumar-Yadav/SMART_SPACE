import type { LightDevice, LightingScenario, SceneObject } from '@/types'
import { clamp } from '@/utils/math'
import { cellAt, segmentBlocked, type SimGrid } from './grid'

/** Height of the horizontal work plane at which illuminance is evaluated. */
export const WORK_PLANE = 0.75
/** Crude inter-reflection gain for a typical light-coloured interior. */
const REFLECTANCE_GAIN = 1.2

export const isLight = (o: SceneObject): o is SceneObject & { device: LightDevice } => o.device?.type === 'light'

/** Position of the optical centre of a luminaire. */
export function emitterPosition(o: SceneObject): [number, number, number] {
  const y = o.kind === 'lamp' ? o.position[1] + o.dims[1] * 0.85 : o.position[1]
  return [o.position[0], y, o.position[2]]
}

/**
 * Illuminance (lux) on the work plane for every cell when the light runs at
 * 100 %. Point-source model, E = I·cosθ / d²  with a near-field safeguard.
 * Interior walls block the light; doors let it through.
 */
export function lightUnitField(grid: SimGrid, obj: SceneObject & { device: LightDevice }): Float32Array {
  const out = new Float32Array(grid.count)
  const [fx, fy, fz] = emitterPosition(obj)
  const dev = obj.device
  const h = Math.max(0.15, fy - WORK_PLANE)
  const beam = clamp(dev.beamAngle, 10, 360)
  const omni = beam >= 350
  const half = (beam * Math.PI) / 360
  const peakCd = omni ? dev.lumens / (4 * Math.PI) : dev.lumens / (2 * Math.PI * (1 - Math.cos(half)))
  for (let iz = 0; iz < grid.nz; iz++) {
    for (let ix = 0; ix < grid.nx; ix++) {
      const cx = (ix + 0.5) * grid.dx
      const cz = (iz + 0.5) * grid.dz
      const r2 = (cx - fx) ** 2 + (cz - fz) ** 2
      const d2 = Math.max(0.09, r2 + h * h)
      const d = Math.sqrt(d2)
      const cos = h / d
      let intensity = peakCd
      if (!omni) {
        const theta = Math.acos(clamp(cos, -1, 1))
        // smooth roll-off over the outer 25 % of the cone
        const edge = half * 0.75
        intensity = theta <= edge ? peakCd : theta >= half ? 0 : peakCd * (1 - (theta - edge) / (half - edge))
      } else if (obj.kind !== 'lamp') {
        intensity *= 0.9 // a ceiling pendant loses some light upwards
      }
      let e = (intensity * cos) / d2
      if (e > 0 && grid.barriers.length && segmentBlocked(grid.barriers, fx, fz, cx, cz)) e = 0
      out[iz * grid.nx + ix] = e * REFLECTANCE_GAIN
    }
  }
  return out
}

// ───────────────────────── daylight ─────────────────────────

/** sin of the solar elevation for a simple 06:00–18:00 day. */
export const sunSin = (hour: number) => (hour <= 6 || hour >= 18 ? 0 : Math.sin((Math.PI * (hour - 6)) / 12))

/** Outdoor horizontal illuminance (lux) from time of day and cloud cover. */
export function outdoorLux(l: LightingScenario): number {
  const s = sunSin(l.timeOfDay)
  const twilight = l.timeOfDay > 5.25 && l.timeOfDay < 18.75 && s === 0 ? 400 : 0
  const clear = 100000 * Math.pow(s, 1.15)
  return clear * (1 - 0.8 * clamp(l.cloudCover, 0, 1)) + twilight
}

/** Peak solar heat flux on glazing (W/m²). */
export function solarFlux(l: LightingScenario): number {
  return 650 * sunSin(l.timeOfDay) * (1 - 0.7 * clamp(l.cloudCover, 0, 1))
}

/**
 * Natural illuminance contributed by one window per lux of outdoor light.
 * Decreases with distance from the glass and with lateral offset; zero behind
 * the window plane and for cells separated by an interior wall.
 */
export function windowUnitField(grid: SimGrid, win: SceneObject): Float32Array {
  const out = new Float32Array(grid.count)
  const w = win.window
  if (!w) return out
  const area = win.dims[0] * win.dims[1]
  const K = 0.12 * clamp(area / 3, 0.35, 1.8)
  const tau = w.transmittance * (1 - clamp(w.shading, 0, 1))
  const nx = Math.sin(win.rotationY)
  const nz = Math.cos(win.rotationY)
  const ax = Math.cos(win.rotationY)
  const az = -Math.sin(win.rotationY)
  for (let iz = 0; iz < grid.nz; iz++) {
    for (let ix = 0; ix < grid.nx; ix++) {
      const cx = (ix + 0.5) * grid.dx
      const cz = (iz + 0.5) * grid.dz
      const dx = cx - win.position[0]
      const dz = cz - win.position[2]
      const depth = dx * nx + dz * nz
      if (depth <= 0.05) continue
      const lateral = Math.max(0, Math.abs(dx * ax + dz * az) - win.dims[0] / 2)
      if (grid.barriers.length && segmentBlocked(grid.barriers, win.position[0] + nx * 0.2, win.position[2] + nz * 0.2, cx, cz)) continue
      out[iz * grid.nx + ix] = K * tau * Math.exp(-depth / 2.2) * Math.exp(-lateral / 3)
    }
  }
  return out
}

/** Weights (sum to 1) describing where a window's heat (solar / ventilation) lands in the room. */
export function windowHeatWeights(grid: SimGrid, win: SceneObject): Float32Array {
  const out = new Float32Array(grid.count)
  const nx = Math.sin(win.rotationY)
  const nz = Math.cos(win.rotationY)
  let sum = 0
  for (let iz = 0; iz < grid.nz; iz++) {
    for (let ix = 0; ix < grid.nx; ix++) {
      const dx = (ix + 0.5) * grid.dx - win.position[0]
      const dz = (iz + 0.5) * grid.dz - win.position[2]
      const depth = dx * nx + dz * nz
      if (depth <= 0) continue
      const w = Math.exp(-depth / 3)
      out[iz * grid.nx + ix] = w
      sum += w
    }
  }
  if (sum > 0) for (let i = 0; i < out.length; i++) out[i] /= sum
  else out.fill(1 / grid.count)
  return out
}

export const cellOfObject = (grid: SimGrid, o: { position: [number, number, number] }) => cellAt(grid, o.position[0], o.position[2])
