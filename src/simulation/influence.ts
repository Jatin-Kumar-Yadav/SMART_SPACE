import type { AcDevice, AirLevel, FanDevice, InfluenceShape, ProfilePoint, SceneObject } from '@/types'
import { worldToLocal2 } from '@/utils/math'
import type { SimGrid } from './grid'

/** An occupant/cell counts as "covered" by a device above this normalised influence. */
export const COVERAGE_MIN = 0.05

export type AirDevice = FanDevice | AcDevice

export const isAirDevice = (d: SceneObject['device']): d is AirDevice => !!d && (d.type === 'fan' || d.type === 'ac')

export const currentLevel = (d: AirDevice): AirLevel => d.levels[Math.min(Math.max(d.level, 0), d.levels.length - 1)]
export const maxLevel = (d: AirDevice): AirLevel => d.levels[d.levels.length - 1]

/** Piece-wise linear profile value normalised to 0…1 (by the profile maximum). */
export function profileValue(profile: ProfilePoint[], x: number): number {
  if (profile.length < 2) return 0
  const pts = [...profile].sort((a, b) => a.x - b.x)
  const max = Math.max(...pts.map((p) => p.v))
  if (max <= 0 || x < pts[0].x || x > pts[pts.length - 1].x) return 0
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]
    const b = pts[i + 1]
    if (x >= a.x && x <= b.x) {
      const t = b.x === a.x ? 0 : (x - a.x) / (b.x - a.x)
      return (a.v + (b.v - a.v) * t) / max
    }
  }
  return 0
}

/**
 * Normalised influence (0…1) at a point expressed in the DEVICE's local frame
 * (+z forward, +x lateral).
 */
export function influenceLocal(
  shape: InfluenceShape,
  level: AirLevel,
  profile: ProfilePoint[],
  lx: number,
  lz: number,
): number {
  if (shape === 'circle') {
    if (level.radius <= 0) return 0
    return Math.max(0, 1 - Math.hypot(lx, lz) / level.radius) // E(r) = Emax · max(0, 1 − r/R)
  }
  if (level.length <= 0 || level.width <= 0) return 0
  const lateral = Math.max(0, 1 - Math.abs(lx) / (level.width / 2))
  if (shape === 'rect') {
    return lateral * Math.max(0, 1 - Math.abs(lz) / (level.length / 2))
  }
  const maxX = Math.max(...profile.map((p) => p.x), 0)
  const scale = maxX > 0 ? maxX / level.length : 1
  return lateral * profileValue(profile, lz * scale)
}

const EMPTY_PROFILE: ProfilePoint[] = []
export const shapeOf = (d: AirDevice): InfluenceShape => (d.type === 'fan' ? 'circle' : d.shape)
export const profileOf = (d: AirDevice): ProfilePoint[] => (d.type === 'ac' ? d.profile : EMPTY_PROFILE)

/** Influence of `obj` (a fan or AC) at world position (x, z) for the given level. */
export function influenceAt(obj: SceneObject, level: AirLevel, x: number, z: number): number {
  const d = obj.device
  if (!isAirDevice(d)) return 0
  const [lx, lz] = worldToLocal2(x, z, obj.position[0], obj.position[2], obj.rotationY)
  return influenceLocal(shapeOf(d), level, profileOf(d), lx, lz)
}

/** Influence of the device across the whole simulation grid (cell centres). */
export function influenceField(grid: SimGrid, obj: SceneObject, level: AirLevel): Float32Array {
  const out = new Float32Array(grid.count)
  for (let iz = 0; iz < grid.nz; iz++) {
    for (let ix = 0; ix < grid.nx; ix++) {
      out[iz * grid.nx + ix] = influenceAt(obj, level, (ix + 0.5) * grid.dx, (iz + 0.5) * grid.dz)
    }
  }
  return out
}

/** Local-space bounds of a region, used to size overlays and handles. */
export function regionBounds(d: AirDevice, level: AirLevel) {
  const shape = shapeOf(d)
  if (shape === 'circle') return { minX: -level.radius, maxX: level.radius, minZ: -level.radius, maxZ: level.radius }
  if (shape === 'rect') return { minX: -level.width / 2, maxX: level.width / 2, minZ: -level.length / 2, maxZ: level.length / 2 }
  const prof = profileOf(d)
  const maxX = Math.max(...prof.map((p) => p.x), 0)
  const minX = Math.min(...prof.map((p) => p.x), 0)
  const scale = maxX > 0 ? level.length / maxX : 1
  return { minX: -level.width / 2, maxX: level.width / 2, minZ: minX * scale, maxZ: maxX * scale }
}
