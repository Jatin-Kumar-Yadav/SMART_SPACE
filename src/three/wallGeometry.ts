import type { SceneObject, Wall } from '@/types'
import { wallLength } from '@/utils/geometry'

/** A rectangular piece of wall in the wall's local frame (x along the wall, y up). */
export interface WallPiece {
  /** centre along the wall, metres from point `a` */
  x: number
  y: number
  length: number
  height: number
}

const MIN = 0.01

/**
 * Split a wall into solid pieces around the doors / windows attached to it, so
 * openings are real holes: full-height piers between openings, sill piece below
 * a window and lintel piece above every opening.
 */
export function wallPieces(wall: Wall, objects: SceneObject[]): WallPiece[] {
  const len = wallLength(wall)
  const H = wall.height
  const openings = objects
    .filter((o) => o.wall?.wallId === wall.id && o.visible && (o.kind === 'door' || o.kind === 'window'))
    .map((o) => ({
      s: Math.max(0, o.wall!.offset - o.dims[0] / 2),
      e: Math.min(len, o.wall!.offset + o.dims[0] / 2),
      y0: Math.max(0, o.position[1]),
      y1: Math.min(H, o.position[1] + o.dims[1]),
    }))
    .sort((a, b) => a.s - b.s)

  const pieces: WallPiece[] = []
  let cursor = 0
  const add = (s: number, e: number, y0: number, y1: number) => {
    if (e - s > MIN && y1 - y0 > MIN) pieces.push({ x: (s + e) / 2, y: (y0 + y1) / 2, length: e - s, height: y1 - y0 })
  }
  for (const o of openings) {
    if (o.s > cursor) add(cursor, o.s, 0, H)
    add(o.s, o.e, 0, o.y0) // below the opening (sill)
    add(o.s, o.e, o.y1, H) // above the opening (lintel)
    cursor = Math.max(cursor, o.e)
  }
  if (cursor < len) add(cursor, len, 0, H)
  return pieces
}
