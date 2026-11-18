import type { Resolution, SceneObject, Space, Vec2, Wall } from '@/types'
import { segmentIntersection } from '@/utils/geometry'

export const MAX_CELLS = 12000
const RES_SIZE: Record<Resolution, number> = { coarse: 2, standard: 1, fine: 0.5 }

export interface WallBarrier {
  wall: Wall
  /** door openings as [startOffset, endOffset] along the wall */
  openings: Vec2[]
}

/**
 * Rectangular simulation grid, independent of what is rendered.
 * Cells are indexed `iz * nx + ix`. Neighbour links are cut by interior walls
 * (except where a door provides an opening).
 */
export interface SimGrid {
  nx: number
  nz: number
  dx: number
  dz: number
  count: number
  cellArea: number
  length: number
  width: number
  height: number
  /** conductance multiplier for the edge towards +x / +z neighbour (1 = open, ~0 = wall) */
  linkEast: Float32Array
  linkSouth: Float32Array
  barriers: WallBarrier[]
  warnings: string[]
}

export const WALL_LEAK = 0.02

export const cellIndex = (g: SimGrid, ix: number, iz: number) => iz * g.nx + ix
export const cellCenterX = (g: SimGrid, ix: number) => (ix + 0.5) * g.dx
export const cellCenterZ = (g: SimGrid, iz: number) => (iz + 0.5) * g.dz

export function cellAt(g: SimGrid, x: number, z: number): number {
  const ix = Math.min(g.nx - 1, Math.max(0, Math.floor(x / g.dx)))
  const iz = Math.min(g.nz - 1, Math.max(0, Math.floor(z / g.dz)))
  return iz * g.nx + ix
}

export function interiorBarriers(walls: Wall[], objects: SceneObject[]): WallBarrier[] {
  return walls
    .filter((w) => !w.perimeter)
    .map((wall) => ({
      wall,
      openings: objects
        .filter((o) => o.kind === 'door' && o.wall?.wallId === wall.id)
        .map((d) => [d.wall!.offset - d.dims[0] / 2, d.wall!.offset + d.dims[0] / 2] as Vec2),
    }))
}

/** Is the straight line between two points cut by an interior wall (not through a door)? */
export function segmentBlocked(barriers: WallBarrier[], ax: number, az: number, bx: number, bz: number): boolean {
  for (const b of barriers) {
    const t = segmentIntersection([ax, az], [bx, bz], b.wall.a, b.wall.b)
    if (t === null) continue
    const px = ax + (bx - ax) * t - b.wall.a[0]
    const pz = az + (bz - az) * t - b.wall.a[1]
    const along = Math.hypot(px, pz)
    if (b.openings.some(([s, e]) => along >= s && along <= e)) continue
    return true
  }
  return false
}

export function buildGrid(space: Pick<Space, 'dims' | 'walls' | 'objects'>, resolution: Resolution): SimGrid {
  const { length, width, height } = space.dims
  const warnings: string[] = []
  let cell = Math.min(RES_SIZE[resolution], Math.max(0.25, Math.min(length, width) / 6))
  while (Math.ceil(length / cell) * Math.ceil(width / cell) > MAX_CELLS) cell *= 1.25
  if (cell > RES_SIZE[resolution] * 1.01) {
    warnings.push(
      `Space is large: simulation cells were coarsened to ${cell.toFixed(2)} m to stay under ${MAX_CELLS} cells.`,
    )
  }
  const nx = Math.max(1, Math.ceil(length / cell - 1e-9))
  const nz = Math.max(1, Math.ceil(width / cell - 1e-9))
  const dx = length / nx
  const dz = width / nz
  const barriers = interiorBarriers(space.walls, space.objects)
  const linkEast = new Float32Array(nx * nz).fill(1)
  const linkSouth = new Float32Array(nx * nz).fill(1)
  if (barriers.length) {
    for (let iz = 0; iz < nz; iz++) {
      for (let ix = 0; ix < nx; ix++) {
        const i = iz * nx + ix
        const cx = (ix + 0.5) * dx
        const cz = (iz + 0.5) * dz
        if (ix + 1 < nx && segmentBlocked(barriers, cx, cz, cx + dx, cz)) linkEast[i] = WALL_LEAK
        if (iz + 1 < nz && segmentBlocked(barriers, cx, cz, cx, cz + dz)) linkSouth[i] = WALL_LEAK
      }
    }
  }
  return { nx, nz, dx, dz, count: nx * nz, cellArea: dx * dz, length, width, height, linkEast, linkSouth, barriers, warnings }
}
