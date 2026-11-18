import type { Occupant, OccupancySource, SceneObject, Scenario } from '@/types'
import { allSeatSlots } from './occupancy'
import { newId } from '@/utils/math'

/**
 * Exactly one source is authoritative for `Scenario.occupants` at a time.
 *
 *   random / manual → camera : the generated occupants are STASHED (not destroyed) and the
 *                              scenario starts empty until the camera confirms seats.
 *   camera → random / manual : the stash is restored as-is (not regenerated).
 *
 * Pure functions: no React, no store.
 */
export function switchOccupancySource(sc: Scenario, next: OccupancySource): Scenario {
  const cur = sc.occupancySource
  if (cur === next) return sc
  if (next === 'camera') {
    return { ...sc, occupancySource: 'camera', stashedOccupants: sc.occupants, occupants: [] }
  }
  if (cur === 'camera') {
    return { ...sc, occupancySource: next, occupants: sc.stashedOccupants ?? [], stashedOccupants: undefined }
  }
  // random ↔ manual ↔ iot: same occupant list shape, only the label changes
  return { ...sc, occupancySource: next }
}

/**
 * Build occupants for a set of camera-confirmed seat keys. Seats that were already occupied keep
 * their occupant id so the 3D figure does not flicker or re-spawn. Unknown keys are ignored and
 * every seat is used at most once.
 */
export function occupantsFromSeats(objects: SceneObject[], seatKeys: Iterable<string>, heatW: number, previous: Occupant[]): Occupant[] {
  const wanted = new Set(seatKeys)
  const prev = new Map(previous.map((o) => [o.seatKey, o]))
  const out: Occupant[] = []
  for (const slot of allSeatSlots(objects)) {
    if (!wanted.has(slot.key)) continue
    const old = prev.get(slot.key)
    out.push({
      id: old?.id ?? newId('occ'),
      seatKey: slot.key,
      objectId: slot.objectId,
      slotIndex: slot.index,
      position: slot.position,
      facing: slot.facing,
      activity: 'seated',
      heatW,
    })
  }
  return out
}

/** Apply camera-confirmed seats. A no-op unless the camera is the authoritative source. */
export function applyCameraSeats(sc: Scenario, objects: SceneObject[], seatKeys: Iterable<string>): Scenario {
  if (sc.occupancySource !== 'camera') return sc
  const next = occupantsFromSeats(objects, seatKeys, sc.sim.occupantHeatW, sc.occupants)
  const same = next.length === sc.occupants.length && next.every((o, i) => o.seatKey === sc.occupants[i].seatKey)
  return same ? sc : { ...sc, occupants: next }
}
