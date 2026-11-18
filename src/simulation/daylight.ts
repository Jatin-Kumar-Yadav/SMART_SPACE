import type { DaylightInfluence, SceneObject } from '@/types'
import { clamp } from '@/utils/math'

export const MAX_DIRECTION_DEG = 60
export const DAYLIGHT_LIMITS = { length: [0.5, 30], width: [0.3, 20], spread: [0, 90], intensity: [0, 2] } as const
const EDGE_SOFTNESS = 0.5

export const defaultDaylight = (win: Pick<SceneObject, 'dims'>): DaylightInfluence => ({
  show: true,
  length: 6,
  width: Math.max(0.5, win.dims[0]),
  spread: 25,
  direction: 0,
  intensity: 1,
  falloff: 'exp',
})

/** Always-valid parameters (clamped), whether or not the window has stored settings. */
export function daylightOf(win: SceneObject): DaylightInfluence {
  const d = { ...defaultDaylight(win), ...(win.window?.daylight ?? {}) }
  return {
    ...d,
    length: clamp(d.length, ...DAYLIGHT_LIMITS.length),
    width: clamp(d.width, ...DAYLIGHT_LIMITS.width),
    spread: clamp(d.spread, ...DAYLIGHT_LIMITS.spread),
    direction: clamp(d.direction, -MAX_DIRECTION_DEG, MAX_DIRECTION_DEG),
    intensity: clamp(d.intensity, ...DAYLIGHT_LIMITS.intensity),
  }
}

const END = Math.exp(-2.7)
function shape(f: DaylightInfluence['falloff'], t: number): number {
  switch (f) {
    case 'linear': return 1 - t
    case 'smooth': { const k = t * t * (3 - 2 * t); return 1 - k }
    default: return (Math.exp(-2.7 * t) - END) / (1 - END)
  }
}

/** Relative strength (0…1 before intensity) at `along` metres into the room and `across` metres off the region's axis. */
export function daylightWeight(p: DaylightInfluence, along: number, across: number): number {
  if (along < 0 || along > p.length) return 0
  const t = along / p.length
  let v = shape(p.falloff, t)
  if (p.profile && p.profile.length >= 2) {
    const x = t * (p.profile.length - 1)
    const i = Math.min(p.profile.length - 2, Math.floor(x))
    v *= p.profile[i] + (p.profile[i + 1] - p.profile[i]) * (x - i)
  }
  const half = p.width / 2 + along * Math.tan((p.spread * Math.PI) / 360)
  const excess = Math.max(0, Math.abs(across) - half)
  return v * Math.exp(-(excess * excess) / (2 * EDGE_SOFTNESS * EDGE_SOFTNESS)) * p.intensity
}

/** Half-extent across the axis at the far end (for drawing). */
export const farHalfWidth = (p: DaylightInfluence) => p.width / 2 + p.length * Math.tan((p.spread * Math.PI) / 360)
