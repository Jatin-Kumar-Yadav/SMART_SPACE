import { CATALOG, createObject } from './catalog'
import { placementIssue } from './collision'
import { closestWall, placeOnWall, sideOfWall } from './spaceFactory'
import type { ObjectKind, SceneObject, Space } from '@/types'
import { round } from '@/utils/math'

/**
 * Build the object that would be created if `kind` were dropped at (x, z),
 * together with the reason it cannot go there (if any). Used for the live
 * placement ghost; mirrors the logic of `addObject`.
 */
export function candidateAt(
  space: Space,
  kind: ObjectKind,
  x: number,
  z: number,
  snap: boolean,
  snapSize: number,
): { obj: SceneObject | null; issue: string | null } {
  const entry = CATALOG[kind]
  let obj = createObject(kind, x, z, space)
  if (entry.wallMounted) {
    const w = closestWall(space.walls, x, z, 1.5)
    if (!w) return { obj: { ...obj, position: [x, obj.position[1], z] }, issue: `${entry.label} must be placed on a wall` }
    const side = w.wall.outward ? 1 : sideOfWall(w.wall, x, z)
    obj = placeOnWall(obj, w.wall, snap ? round(w.offset, snapSize) : w.offset, side)
  } else {
    const hx = obj.dims[0] / 2
    const hz = obj.dims[2] / 2
    const sx = snap ? round(x, snapSize) : x
    const sz = snap ? round(z, snapSize) : z
    obj.position = [
      Math.min(space.dims.length - hx, Math.max(hx, sx)),
      obj.position[1],
      Math.min(space.dims.width - hz, Math.max(hz, sz)),
    ]
  }
  return { obj, issue: placementIssue(obj, space) }
}
