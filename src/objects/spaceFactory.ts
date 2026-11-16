import { CATALOG } from '@/objects/catalog'
import { createScenario } from '@/simulation/scenario'
import {
  SCHEMA_VERSION,
  type Dimensions,
  type FloorMaterial,
  type LengthUnit,
  type SceneObject,
  type Space,
  type SpaceType,
  type Vec2,
  type Wall,
} from '@/types'
import { nearestOnWall, wallLength } from '@/utils/geometry'
import { newId } from '@/utils/math'

export const WALL_THICKNESS = 0.2

export const defaultFloor = (): FloorMaterial => ({
  preset: 'ceramic',
  tileSize: 0.6,
  rotation: 0,
  offset: [0, 0],
  roughness: 0.35,
  tint: '#ffffff',
  stretch: false,
})

/** Four perimeter walls surrounding the interior [0,L]×[0,W]. */
export function perimeterWalls(dims: Dimensions, thickness = WALL_THICKNESS): Wall[] {
  const { length: L, width: W, height: H } = dims
  const t = thickness
  const mk = (id: string, a: Vec2, b: Vec2, outward: Vec2): Wall => ({ id, a, b, thickness: t, height: H, perimeter: true, outward })
  return [
    mk('wall_n', [-t, -t / 2], [L + t, -t / 2], [0, -1]),
    mk('wall_s', [L + t, W + t / 2], [-t, W + t / 2], [0, 1]),
    mk('wall_w', [-t / 2, W], [-t / 2, 0], [-1, 0]),
    mk('wall_e', [L + t / 2, 0], [L + t / 2, W], [1, 0]),
  ]
}

export function createSpace(opts: { name: string; type: SpaceType; dims: Dimensions; unit?: LengthUnit }): Space {
  const now = Date.now()
  const scenario = createScenario('Default scenario')
  return {
    schemaVersion: SCHEMA_VERSION,
    id: newId('space'),
    name: opts.name,
    type: opts.type,
    dims: { ...opts.dims },
    unit: opts.unit ?? 'm',
    floor: defaultFloor(),
    floorRegions: [],
    walls: perimeterWalls(opts.dims),
    objects: [],
    scenarios: [scenario],
    activeScenarioId: scenario.id,
    cameras: [],
    createdAt: now,
    updatedAt: now,
  }
}

/** Inward unit normal of a wall (for interior walls, `side` picks one of the two). */
export function wallNormal(w: Wall, side: 1 | -1 = 1): Vec2 {
  if (w.outward) return [-w.outward[0], -w.outward[1]]
  const dx = w.b[0] - w.a[0]
  const dz = w.b[1] - w.a[1]
  const len = Math.hypot(dx, dz) || 1
  return [(-dz / len) * side, (dx / len) * side]
}

/** Place an object onto a wall at `offset` metres from the wall start. +z of the object faces `normal`. */
export function placeOnWall(obj: SceneObject, wall: Wall, offset: number, side: 1 | -1 = 1): SceneObject {
  const len = wallLength(wall)
  const half = obj.dims[0] / 2
  const off = Math.min(len - half, Math.max(half, offset))
  const dx = (wall.b[0] - wall.a[0]) / len
  const dz = (wall.b[1] - wall.a[1]) / len
  const n = wallNormal(wall, side)
  const dims: [number, number, number] = [obj.dims[0], obj.dims[1], wall.thickness + (CATALOG[obj.kind].opening ? 0 : 0.05)]
  const inset = CATALOG[obj.kind].opening ? 0 : wall.thickness / 2 + dims[2] / 2
  return {
    ...obj,
    dims: CATALOG[obj.kind].opening ? dims : obj.dims,
    position: [wall.a[0] + dx * off + n[0] * inset, obj.position[1], wall.a[1] + dz * off + n[1] * inset],
    rotationY: Math.atan2(n[0], n[1]),
    wall: { wallId: wall.id, offset: off },
  }
}

/** Find the wall closest to (x,z) within `maxDist`. */
export function closestWall(walls: Wall[], x: number, z: number, maxDist = 1.2) {
  let best: { wall: Wall; offset: number; distance: number; point: Vec2 } | null = null
  for (const w of walls) {
    const n = nearestOnWall(w, x, z)
    if (n.distance <= maxDist && (!best || n.distance < best.distance)) best = { wall: w, offset: n.offset, distance: n.distance, point: n.point }
  }
  return best
}

/** Which side of an (interior) wall is (x,z) on? */
export function sideOfWall(w: Wall, x: number, z: number): 1 | -1 {
  const n = wallNormal(w, 1)
  return (x - w.a[0]) * n[0] + (z - w.a[1]) * n[1] >= 0 ? 1 : -1
}

/** Update a space's wall geometry after the room dimensions changed (keeps interior walls). */
export function resizePerimeter(space: Space, dims: Dimensions): Space {
  const interior = space.walls.filter((w) => !w.perimeter)
  return { ...space, dims, walls: [...perimeterWalls(dims), ...interior] }
}
