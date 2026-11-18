import type { SceneObject, Space } from '@/types'
import { footprint, quadInsideRect, quadsOverlap, wallQuad } from '@/utils/geometry'
import { CATALOG, type CollisionClass } from './catalog'

/** Can two collision classes share floor space? */
function compatible(a: CollisionClass, b: CollisionClass): boolean {
  if (a === 'flat' || b === 'flat') return true
  if (a === 'wall' || b === 'wall') return true
  if (a === 'overhead' || b === 'overhead') return true
  // chairs may tuck in at tables (controlled exception); everything else is solid
  if ((a === 'seat' && b === 'table') || (a === 'table' && b === 'seat')) return true
  return false
}

/**
 * Returns a human readable reason when `obj` cannot be where it is, or null if the
 * placement is valid. Tests the rotated footprint against the room, the walls and other objects.
 */
export function placementIssue(obj: SceneObject, space: Pick<Space, 'dims' | 'walls' | 'objects'>): string | null {
  const entry = CATALOG[obj.kind]
  const others = space.objects.filter((o) => o.id !== obj.id && o.visible)

  // wall mounted objects: stay attached, and don't overlap each other on the wall
  if (entry.wallMounted) {
    if (!obj.wall) return 'Must be attached to a wall'
    const wall = space.walls.find((w) => w.id === obj.wall!.wallId)
    if (!wall) return 'Wall no longer exists'
    for (const o of others) {
      if (!o.wall || o.wall.wallId !== obj.wall.wallId) continue
      const sameLevelOverlap =
        o.position[1] < obj.position[1] + obj.dims[1] && obj.position[1] < o.position[1] + o.dims[1]
      const alongOverlap = Math.abs(o.wall.offset - obj.wall.offset) < (o.dims[0] + obj.dims[0]) / 2 - 1e-3
      if (sameLevelOverlap && alongOverlap) return `Overlaps ${o.name} on the wall`
    }
    return null
  }

  if (entry.collision === 'flat') {
    const q = footprint(obj)
    return quadInsideRect(q, 0, 0, space.dims.length, space.dims.width, 0.02) ? null : 'Outside the room'
  }

  const q = footprint(obj)
  if (!quadInsideRect(q, 0, 0, space.dims.length, space.dims.width)) return 'Outside the room'

  if (entry.mount === 'floor' && entry.collision !== 'overhead') {
    for (const w of space.walls) {
      if (quadsOverlap(q, wallQuad(w))) return 'Intersects a wall'
    }
  }

  for (const o of others) {
    const oe = CATALOG[o.kind]
    if (oe.wallMounted) continue
    if (entry.collision === 'overhead' && oe.collision === 'overhead') {
      if (entry.mount === 'ceiling' && oe.mount === 'ceiling' && quadsOverlap(q, footprint(o))) return `Overlaps ${o.name}`
      continue
    }
    if (compatible(entry.collision, oe.collision)) continue
    // objects at different heights (e.g. ceiling items) never collide with floor items
    if (entry.mount !== oe.mount) continue
    if (quadsOverlap(q, footprint(o))) return `Overlaps ${o.name}`
  }
  return null
}

export const isValidPlacement = (obj: SceneObject, space: Pick<Space, 'dims' | 'walls' | 'objects'>) => placementIssue(obj, space) === null
