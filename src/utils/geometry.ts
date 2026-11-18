import type { SceneObject, Vec2, Wall } from '@/types'

export type Quad = [Vec2, Vec2, Vec2, Vec2]

/** Four corners (x,z) of an object's rotated footprint. */
export function footprint(obj: Pick<SceneObject, 'position' | 'dims' | 'rotationY'>, inflate = 0): Quad {
  const hw = obj.dims[0] / 2 + inflate
  const hd = obj.dims[2] / 2 + inflate
  const c = Math.cos(obj.rotationY)
  const s = Math.sin(obj.rotationY)
  const corner = (lx: number, lz: number): Vec2 => [
    obj.position[0] + lx * c + lz * s,
    obj.position[2] - lx * s + lz * c,
  ]
  return [corner(-hw, -hd), corner(hw, -hd), corner(hw, hd), corner(-hw, hd)]
}

/** Rectangle of a wall (centre line a→b with thickness) as a quad. */
export function wallQuad(w: Wall, inflate = 0): Quad {
  const dx = w.b[0] - w.a[0]
  const dz = w.b[1] - w.a[1]
  const len = Math.hypot(dx, dz) || 1
  const nx = (-dz / len) * (w.thickness / 2 + inflate)
  const nz = (dx / len) * (w.thickness / 2 + inflate)
  const ex = (dx / len) * inflate
  const ez = (dz / len) * inflate
  return [
    [w.a[0] - ex + nx, w.a[1] - ez + nz],
    [w.b[0] + ex + nx, w.b[1] + ez + nz],
    [w.b[0] + ex - nx, w.b[1] + ez - nz],
    [w.a[0] - ex - nx, w.a[1] - ez - nz],
  ]
}

function project(q: Quad, ax: Vec2): [number, number] {
  let min = Infinity
  let max = -Infinity
  for (const p of q) {
    const d = p[0] * ax[0] + p[1] * ax[1]
    if (d < min) min = d
    if (d > max) max = d
  }
  return [min, max]
}

/** Separating-axis test between two convex quads. Touching edges do not count as overlap. */
export function quadsOverlap(a: Quad, b: Quad, eps = 1e-4): boolean {
  for (const q of [a, b]) {
    for (let i = 0; i < 4; i++) {
      const p1 = q[i]
      const p2 = q[(i + 1) % 4]
      const ax: Vec2 = [-(p2[1] - p1[1]), p2[0] - p1[0]]
      const [aMin, aMax] = project(a, ax)
      const [bMin, bMax] = project(b, ax)
      if (aMax <= bMin + eps || bMax <= aMin + eps) return false
    }
  }
  return true
}

export const quadInsideRect = (q: Quad, x0: number, z0: number, x1: number, z1: number, eps = 1e-3) =>
  q.every((p) => p[0] >= x0 - eps && p[0] <= x1 + eps && p[1] >= z0 - eps && p[1] <= z1 + eps)

/** Intersection of segments p→q and r→s; returns the parameter t along p→q, or null. */
export function segmentIntersection(p: Vec2, q: Vec2, r: Vec2, s: Vec2): number | null {
  const d1x = q[0] - p[0]
  const d1z = q[1] - p[1]
  const d2x = s[0] - r[0]
  const d2z = s[1] - r[1]
  const den = d1x * d2z - d1z * d2x
  if (Math.abs(den) < 1e-12) return null
  const t = ((r[0] - p[0]) * d2z - (r[1] - p[1]) * d2x) / den
  const u = ((r[0] - p[0]) * d1z - (r[1] - p[1]) * d1x) / den
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null
}

/** Nearest point on wall centre line to (x,z): returns offset along wall and distance. */
export function nearestOnWall(w: Wall, x: number, z: number) {
  const dx = w.b[0] - w.a[0]
  const dz = w.b[1] - w.a[1]
  const len = Math.hypot(dx, dz) || 1e-9
  const t = ((x - w.a[0]) * dx + (z - w.a[1]) * dz) / (len * len)
  const off = Math.min(len, Math.max(0, t * len))
  const px = w.a[0] + (dx / len) * off
  const pz = w.a[1] + (dz / len) * off
  return { offset: off, distance: Math.hypot(x - px, z - pz), point: [px, pz] as Vec2, length: len }
}

export const wallLength = (w: Wall) => Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1])
/** Yaw (three.js convention) such that local +x runs along the wall a→b. */
export const wallYaw = (w: Wall) => -Math.atan2(w.b[1] - w.a[1], w.b[0] - w.a[0])
