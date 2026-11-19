import type { SimSnapshot } from '@/simulation/types'

export type RGB = [number, number, number]

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
function ramp(stops: [number, RGB][], t: number): RGB {
  const x = Math.min(1, Math.max(0, t))
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, c0] = stops[i]
    const [t1, c1] = stops[i + 1]
    if (x <= t1) {
      const u = t1 === t0 ? 0 : (x - t0) / (t1 - t0)
      return [lerp(c0[0], c1[0], u), lerp(c0[1], c1[1], u), lerp(c0[2], c1[2], u)]
    }
  }
  return stops[stops.length - 1][1]
}

/** blue → cyan → green → yellow → red */
const TEMP_STOPS: [number, RGB][] = [
  [0, [37, 99, 235]],
  [0.25, [14, 165, 233]],
  [0.5, [34, 197, 94]],
  [0.75, [250, 204, 21]],
  [1, [239, 68, 68]],
]
export const tempColor = (t01: number) => ramp(TEMP_STOPS, t01)

/** dark → blue → teal → warm yellow → white */
const LUX_STOPS: [number, RGB][] = [
  [0, [30, 41, 59]],
  [0.1, [49, 46, 129]],
  [0.25, [14, 116, 144]],
  [0.5, [34, 197, 94]],
  [0.75, [250, 204, 21]],
  [1, [255, 251, 235]],
]
export const luxColor = (t01: number) => ramp(LUX_STOPS, t01)
export const LUX_MAX = 1000
export const LUX_LEGEND = [0, 100, 250, 500, 750, 1000]

export const cssRgb = (c: RGB) => `rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})`

/** Temperature legend range: stable, rounded to 2 °C so the colours do not flicker. */
export function tempRange(snap: SimSnapshot | null, target: number): [number, number] {
  const lo = Math.min(target - 3, snap?.stats.minT ?? target - 3)
  const hi = Math.max(target + 4, snap?.stats.maxT ?? target + 4)
  return [Math.floor(lo / 2) * 2, Math.ceil(hi / 2) * 2]
}

export const ZONE_PALETTE: RGB[] = [
  [59, 130, 246],
  [16, 185, 129],
  [245, 158, 11],
  [236, 72, 153],
  [139, 92, 246],
  [20, 184, 166],
  [239, 68, 68],
  [132, 204, 22],
  [14, 165, 233],
  [217, 70, 239],
  [249, 115, 22],
  [100, 116, 139],
]

/** Categorical slots from the validated reference palette (fixed order, never cycled). */
export const CHART_SERIES = { blue: '#2a78d6', orange: '#eb6834', aqua: '#1baf7a', violet: '#6250d6', yellow: '#c98500' } as const
export const SERIES = CHART_SERIES

