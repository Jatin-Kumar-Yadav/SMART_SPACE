import type { Vec2, Vec3 } from '@/types'

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const round = (v: number, step: number) => Math.round(v / step) * step
export const roundTo = (v: number, digits = 2) => {
  const f = 10 ** digits
  return Math.round(v * f) / f
}

/** Small deterministic PRNG (mulberry32). Pass a seed for reproducible scenarios. */
export type Rng = () => number
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
export const randomSeed = () => Math.floor(Math.random() * 2 ** 31)

/** Integer in [min, max] inclusive. */
export const randInt = (rng: Rng, min: number, max: number) =>
  min + Math.floor(rng() * (max - min + 1))
export const randRange = (rng: Rng, min: number, max: number) => min + rng() * (max - min)

/** Fisher–Yates shuffle returning a new array. */
export function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const a = items.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

let counter = 0
export const newId = (prefix = 'id') =>
  `${prefix}_${Date.now().toString(36)}${(counter++).toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`

// ── Local ↔ world transforms (yaw follows three.js: +z local maps to (sinθ, cosθ)) ──

export function localToWorld(local: Vec3, origin: Vec3, yaw: number): Vec3 {
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  return [
    origin[0] + local[0] * c + local[2] * s,
    origin[1] + local[1],
    origin[2] - local[0] * s + local[2] * c,
  ]
}

export function worldToLocal(world: Vec3, origin: Vec3, yaw: number): Vec3 {
  const dx = world[0] - origin[0]
  const dz = world[2] - origin[2]
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  return [dx * c - dz * s, world[1] - origin[1], dx * s + dz * c]
}

export function worldToLocal2(x: number, z: number, ox: number, oz: number, yaw: number): Vec2 {
  const dx = x - ox
  const dz = z - oz
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  return [dx * c - dz * s, dx * s + dz * c]
}

export const dist2 = (ax: number, az: number, bx: number, bz: number) => Math.hypot(ax - bx, az - bz)
export const deg = (rad: number) => (rad * 180) / Math.PI
export const rad = (d: number) => (d * Math.PI) / 180
