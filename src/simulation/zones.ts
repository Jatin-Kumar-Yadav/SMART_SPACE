import type { Occupant, SceneObject, SensorPoint } from '@/types'
import { cellAt, type SimGrid } from './grid'
import { COVERAGE_MIN } from './influence'
import type { OccupantCoverage, ZoneInfo } from './types'

export interface FieldRef {
  id: string
  field: Float32Array
}

export interface DeviceCoord {
  id: string
  name: string
  x: number
  z: number
}

function extractDeviceCoords(
  items: Array<SceneObject | FieldRef | { id: string; name?: string; position?: [number, number, number] }>,
  grid: SimGrid,
): DeviceCoord[] {
  const out: DeviceCoord[] = []
  for (const item of items) {
    if (!item) continue
    if ('position' in item && Array.isArray(item.position)) {
      out.push({
        id: item.id,
        name: (item as SceneObject).name ?? item.id,
        x: item.position[0],
        z: item.position[2],
      })
    } else if ('field' in item && item.field) {
      let best = 0
      let bestV = -Infinity
      for (let i = 0; i < item.field.length; i++) {
        if (item.field[i] > bestV) {
          bestV = item.field[i]
          best = i
        }
      }
      const ix = best % grid.nx
      const iz = Math.floor(best / grid.nx)
      out.push({
        id: item.id,
        name: item.id,
        x: (ix + 0.5) * grid.dx,
        z: (iz + 0.5) * grid.dz,
      })
    }
  }
  return out
}

/**
 * Environmental zone generation exclusively using Air Conditioners (ACs) and Ceiling Fans.
 *
 * Rules:
 * 1. Primary AC zones:
 *    - Positions of all ACs divide the classroom area according to the nearest AC.
 *    - If no ACs, no AC-based zones are generated.
 * 2. Fan subzones:
 *    - Each fan is assigned to its parent AC zone based on position.
 *    - The parent AC zone is divided according to the nearest fan within that zone.
 *    - Fans do not create new primary AC zones.
 *    - If an AC zone has no fan, it remains an undivided AC zone.
 *    - If no fans, retain the primary AC zones.
 *    - If no ACs but fans exist, fans generate fan zones.
 * 3. Lights and other devices:
 *    - Lights and sensors NEVER create, split, or influence zones.
 *    - Lights and other devices are assigned to zones solely by their physical coordinates.
 */
export function buildZones(
  grid: SimGrid,
  acsOrFields: Array<SceneObject | FieldRef> = [],
  fansOrFields: Array<SceneObject | FieldRef> = [],
  lightsOrCover?: Array<SceneObject | FieldRef>,
  allObjects: SceneObject[] = [],
  sensors: SensorPoint[] = [],
  _acFields: FieldRef[] = [],
  _fanFields: FieldRef[] = [],
  minCells = 3,
): { zoneIdByCell: Int16Array; zones: ZoneInfo[] } {
  const n = grid.count
  const acList = extractDeviceCoords(acsOrFields, grid)
  const fanList = extractDeviceCoords(fansOrFields, grid)
  const lightList = extractDeviceCoords(lightsOrCover ?? [], grid)

  // Map fans to their parent AC zone based on nearest AC position
  const fansByAc = new Map<string, DeviceCoord[]>()
  if (acList.length > 0) {
    for (const fan of fanList) {
      let nearestAc = acList[0]
      let minD = Infinity
      for (const ac of acList) {
        const d = Math.hypot(fan.x - ac.x, fan.z - ac.z)
        if (d < minD) {
          minD = d
          nearestAc = ac
        }
      }
      const list = fansByAc.get(nearestAc.id) ?? []
      list.push(fan)
      fansByAc.set(nearestAc.id, list)
    }
  }

  // Determine cell zoning key exclusively from AC and fan locations
  const keyOf = new Array<string>(n)
  for (let i = 0; i < n; i++) {
    const ix = i % grid.nx
    const iz = Math.floor(i / grid.nx)
    const cx = (ix + 0.5) * grid.dx
    const cz = (iz + 0.5) * grid.dz

    if (acList.length > 0) {
      // 1. Primary AC zone: find nearest AC
      let nearestAc = acList[0]
      let minAcD = Infinity
      for (const ac of acList) {
        const d = Math.hypot(cx - ac.x, cz - ac.z)
        if (d < minAcD) {
          minAcD = d
          nearestAc = ac
        }
      }

      // 2. Fan subzone: divide within this AC zone only
      const fansInAc = fansByAc.get(nearestAc.id) ?? []
      if (fansInAc.length > 0) {
        let nearestFan = fansInAc[0]
        let minFanD = Infinity
        for (const fan of fansInAc) {
          const d = Math.hypot(cx - fan.x, cz - fan.z)
          if (d < minFanD) {
            minFanD = d
            nearestFan = fan
          }
        }
        keyOf[i] = `${nearestAc.id}|${nearestFan.id}`
      } else {
        keyOf[i] = `${nearestAc.id}|-`
      }
    } else if (fanList.length > 0) {
      // No ACs: fan zones
      let nearestFan = fanList[0]
      let minFanD = Infinity
      for (const fan of fanList) {
        const d = Math.hypot(cx - fan.x, cz - fan.z)
        if (d < minFanD) {
          minFanD = d
          nearestFan = fan
        }
      }
      keyOf[i] = `-|${nearestFan.id}`
    } else {
      // No ACs and no fans
      keyOf[i] = '-|-'
    }
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

  // Merge tiny fragments into the neighbouring zone they share most edges with
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

  // Sort zones deterministically: by parent AC zone order, then by fan subzone order
  const activeMembers = members.filter((m) => m.length > 0)
  activeMembers.sort((a, b) => {
    const keyA = keyOf[a[0]].split('|')
    const keyB = keyOf[b[0]].split('|')
    const acIdxA = acList.findIndex((ac) => ac.id === keyA[0])
    const acIdxB = acList.findIndex((ac) => ac.id === keyB[0])
    if (acIdxA !== acIdxB) return (acIdxA === -1 ? 999 : acIdxA) - (acIdxB === -1 ? 999 : acIdxB)
    const fanIdxA = fanList.findIndex((f) => f.id === keyA[1])
    const fanIdxB = fanList.findIndex((f) => f.id === keyB[1])
    return (fanIdxA === -1 ? 999 : fanIdxA) - (fanIdxB === -1 ? 999 : fanIdxB)
  })

  const zoneIdByCell = new Int16Array(n)
  const zones: ZoneInfo[] = []
  const acSubzoneCounter = new Map<string, number>()

  activeMembers.forEach((list, idx) => {
    const id = idx + 1
    let sx = 0
    let sz = 0
    for (const c of list) {
      zoneIdByCell[c] = id
      sx += ((c % grid.nx) + 0.5) * grid.dx
      sz += (Math.floor(c / grid.nx) + 0.5) * grid.dz
    }

    const [acIdStr, fanIdStr] = keyOf[list[0]].split('|')
    const acObj = acList.find((a) => a.id === acIdStr)
    const fanObj = fanList.find((f) => f.id === fanIdStr)

    const acZoneId = acObj ? acList.indexOf(acObj) + 1 : null
    let fanSubzoneId: number | null = null
    if (fanObj) {
      if (acObj) {
        const nextSub = (acSubzoneCounter.get(acObj.id) ?? 0) + 1
        acSubzoneCounter.set(acObj.id, nextSub)
        fanSubzoneId = nextSub
      } else {
        fanSubzoneId = fanList.indexOf(fanObj) + 1
      }
    }

    let label = `Zone ${id}`
    if (acZoneId != null && fanSubzoneId != null) {
      label = `AC Zone ${acZoneId} · Fan Subzone ${fanSubzoneId}`
    } else if (acZoneId != null) {
      label = `AC Zone ${acZoneId}`
    } else if (fanSubzoneId != null) {
      label = `Fan Zone ${fanSubzoneId}`
    }

    const coverage: ZoneInfo['coverage'] = acObj ? 'cooled' : fanObj ? 'fan-only' : 'uncovered'

    zones.push({
      id,
      key: keyOf[list[0]],
      cellCount: list.length,
      area: list.length * grid.cellArea,
      cx: sx / list.length,
      cz: sz / list.length,
      acIds: acObj ? [acObj.id] : [],
      fanIds: fanObj ? [fanObj.id] : [],
      lightIds: [],
      sensorIds: [],
      deviceIds: [
        ...(acObj ? [acObj.id] : []),
        ...(fanObj ? [fanObj.id] : []),
      ],
      coverage,
      acZoneId,
      acId: acObj ? acObj.id : null,
      acName: acObj ? acObj.name : null,
      fanId: fanObj ? fanObj.id : null,
      fanName: fanObj ? fanObj.name : null,
      fanSubzoneId,
      label,
    })
  })

  // 1. Assign lights to existing zones based strictly on physical coordinates
  for (const light of lightList) {
    const c = cellAt(grid, light.x, light.z)
    const zid = zoneIdByCell[c]
    const z = zones.find((x) => x.id === zid)
    if (z) {
      if (!z.lightIds.includes(light.id)) z.lightIds.push(light.id)
      if (!z.deviceIds!.includes(light.id)) z.deviceIds!.push(light.id)
    }
  }

  // 2. Assign sensors to existing zones based strictly on physical coordinates
  for (const s of sensors) {
    const c = cellAt(grid, s.position[0], s.position[2])
    const zid = zoneIdByCell[c]
    const z = zones.find((x) => x.id === zid)
    if (z) {
      if (!z.sensorIds!.includes(s.id)) z.sensorIds!.push(s.id)
      if (!z.deviceIds!.includes(s.id)) z.deviceIds!.push(s.id)
    }
  }

  // 3. Assign other objects to existing zones based strictly on physical coordinates
  for (const obj of allObjects) {
    if (
      acList.some((a) => a.id === obj.id) ||
      fanList.some((f) => f.id === obj.id) ||
      lightList.some((l) => l.id === obj.id)
    ) {
      continue
    }
    const c = cellAt(grid, obj.position[0], obj.position[2])
    const zid = zoneIdByCell[c]
    const z = zones.find((x) => x.id === zid)
    if (z && !z.deviceIds!.includes(obj.id)) {
      z.deviceIds!.push(obj.id)
    }
  }

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
