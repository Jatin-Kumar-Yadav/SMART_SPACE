import type { Occupant, SceneObject } from '@/types'
import { cellAt, type SimGrid } from './grid'
import { COVERAGE_MIN } from './influence'
import type { OccupantCoverage, ZoneInfo } from './types'

export interface FieldRef {
  id: string
  field: Float32Array
}

/**
 * Environmental zone generation.
 *
 * Every cell is labelled with its *dominant* AC and *dominant* fan (the device
 * with the highest influence above COVERAGE_MIN, if any). Cells that share a
 * label and are connected (not separated by a wall) form one zone. Cells that
 * no device reaches form "uncovered" zones — their physical coverage is NOT
 * artificially enlarged; occupants there are simply flagged as underserved.
 * Tiny fragments are merged into their best-connected neighbour so the map
 * stays readable.
 */
export function buildZones(
  grid: SimGrid,
  acFields: FieldRef[],
  fanFields: FieldRef[],
  lightCover: FieldRef[],
  minCells = 3,
): { zoneIdByCell: Int16Array; zones: ZoneInfo[] } {
  const n = grid.count
  const keyOf = new Array<string>(n)
  for (let i = 0; i < n; i++) {
    const dom = (fields: FieldRef[]) => {
      let best = -1
      let bestV = COVERAGE_MIN
      fields.forEach((f, idx) => {
        if (f.field[i] > bestV) {
          bestV = f.field[i]
          best = idx
        }
      })
      return best >= 0 ? fields[best].id : '-'
    }
    keyOf[i] = `${dom(acFields)}|${dom(fanFields)}`
  }

  const zoneOf = new Int32Array(n).fill(-1)
  const members: number[][] = []
  const neighbours = (i: number): number[] => {
    const ix = i % grid.nx
    const iz = Math.floor(i / grid.nx)
    const out: number[] = []
    if (ix > 0 && grid.linkEast[i - 1] > 0.5) out.push(i - 1)
    if (ix < grid.nx - 1 && grid.linkEast[i] > 0.5) out.push(i + 1)
    if (iz > 0 && grid.linkSouth[i - grid.nx] > 0.5) out.push(i - grid.nx)
    if (iz < grid.nz - 1 && grid.linkSouth[i] > 0.5) out.push(i + grid.nx)
    return out
  }

  for (let s = 0; s < n; s++) {
    if (zoneOf[s] !== -1) continue
    const id = members.length
    const list: number[] = []
    const stack = [s]
    zoneOf[s] = id
    while (stack.length) {
      const c = stack.pop()!
      list.push(c)
      for (const nb of neighbours(c)) {
        if (zoneOf[nb] === -1 && keyOf[nb] === keyOf[s]) {
          zoneOf[nb] = id
          stack.push(nb)
        }
      }
    }
    members.push(list)
  }

  // merge tiny fragments into the neighbouring zone they share most edges with
  let changed = true
  while (changed) {
    changed = false
    for (let z = 0; z < members.length; z++) {
      const list = members[z]
      if (list.length === 0 || list.length >= minCells) continue
      const votes = new Map<number, number>()
      for (const c of list) for (const nb of neighbours(c)) if (zoneOf[nb] !== z) votes.set(zoneOf[nb], (votes.get(zoneOf[nb]) ?? 0) + 1)
      let target = -1
      let best = 0
      votes.forEach((v, k) => {
        if (v > best && members[k].length > 0) {
          best = v
          target = k
        }
      })
      if (target >= 0) {
        for (const c of list) {
          zoneOf[c] = target
          members[target].push(c)
        }
        members[z] = []
        changed = true
      }
    }
  }

  // compact ids (1-based)
  const zoneIdByCell = new Int16Array(n)
  const zones: ZoneInfo[] = []
  members.forEach((list) => {
    if (!list.length) return
    const id = zones.length + 1
    let sx = 0
    let sz = 0
    const acCount = new Map<string, number>()
    const fanCount = new Map<string, number>()
    const lightSet = new Map<string, number>()
    for (const c of list) {
      zoneIdByCell[c] = id
      sx += ((c % grid.nx) + 0.5) * grid.dx
      sz += (Math.floor(c / grid.nx) + 0.5) * grid.dz
      for (const f of acFields) if (f.field[c] > COVERAGE_MIN) acCount.set(f.id, (acCount.get(f.id) ?? 0) + 1)
      for (const f of fanFields) if (f.field[c] > COVERAGE_MIN) fanCount.set(f.id, (fanCount.get(f.id) ?? 0) + 1)
      for (const f of lightCover) if (f.field[c] > 0) lightSet.set(f.id, (lightSet.get(f.id) ?? 0) + 1)
    }
    const acIds = [...acCount.entries()].filter(([, v]) => v >= list.length * 0.25).map(([k]) => k)
    const fanIds = [...fanCount.entries()].filter(([, v]) => v >= list.length * 0.25).map(([k]) => k)
    const lightIds = [...lightSet.entries()].filter(([, v]) => v >= list.length * 0.25).map(([k]) => k)
    zones.push({
      id,
      key: keyOf[list[0]],
      cellCount: list.length,
      area: list.length * grid.cellArea,
      cx: sx / list.length,
      cz: sz / list.length,
      acIds,
      fanIds,
      lightIds,
      coverage: acIds.length ? 'cooled' : fanIds.length ? 'fan-only' : 'uncovered',
    })
  })
  return { zoneIdByCell, zones }
}

/**
 * For each occupant list ALL devices reaching them (overlaps are retained) and
 * classify the coverage. Occupants outside every region stay in the analysis
 * and are flagged as underserved.
 */
export function analyseCoverage(
  grid: SimGrid,
  occupants: Occupant[],
  zoneIdByCell: Int16Array,
  acFields: FieldRef[],
  fanFields: FieldRef[],
  lightCover: FieldRef[],
): OccupantCoverage[] {
  return occupants.map((o) => {
    const cell = cellAt(grid, o.position[0], o.position[2])
    const acIds = acFields.filter((f) => f.field[cell] > COVERAGE_MIN).map((f) => f.id)
    const fanIds = fanFields.filter((f) => f.field[cell] > COVERAGE_MIN).map((f) => f.id)
    const lightIds = lightCover.filter((f) => f.field[cell] > 0).map((f) => f.id)
    const status: OccupantCoverage['status'] =
      acIds.length === 0 && fanIds.length === 0 ? 'uncovered' : acIds.length > 0 && lightIds.length > 0 ? 'covered' : 'partial'
    return { occupantId: o.id, cell, zoneId: zoneIdByCell[cell], acIds, fanIds, lightIds, status }
  })
}

/** Threshold mask: cells a luminaire "reaches" (≥ 25 % of its own peak illuminance). */
export function lightReach(unit: Float32Array): Float32Array {
  let peak = 0
  for (const v of unit) if (v > peak) peak = v
  const out = new Float32Array(unit.length)
  if (peak <= 0) return out
  for (let i = 0; i < unit.length; i++) out[i] = unit[i] >= peak * 0.25 ? 1 : 0
  return out
}

export const occupantCells = (grid: SimGrid, occupants: Occupant[]) =>
  occupants.map((o) => cellAt(grid, o.position[0], o.position[2]))

export type { SceneObject }
