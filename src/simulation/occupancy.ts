import { CATALOG } from '@/objects/catalog'
import type { Occupant, OccupancyConfig, SceneObject, SeatSlot, Vec3 } from '@/types'
import { localToWorld, newId, randInt, shuffle, type Rng } from '@/utils/math'

/** Number of seat slots an object offers (0 when it is not seatable). */
export function seatCapacityOf(obj: SceneObject): number {
  const entry = CATALOG[obj.kind]
  if (!entry.seat) return 0
  if (!obj.seatable || !obj.visible) return 0
  if (obj.seatCountOverride !== undefined) return Math.max(0, Math.floor(obj.seatCountOverride))
  if (entry.seat.fixed !== undefined) return entry.seat.fixed
  if (entry.seat.perMeter) return Math.max(1, Math.floor(obj.dims[0] * entry.seat.perMeter + 1e-6))
  return 1
}

/** Height of the seat surface above the object's base. */
function seatHeight(obj: SceneObject): number {
  switch (obj.kind) {
    case 'chair':
    case 'officeChair':
      return obj.dims[1] * 0.5
    case 'sofa':
      return obj.dims[1] * 0.5
    default:
      return obj.dims[1]
  }
}

/** Local positions (object space) of every seat slot. */
export function localSeatPositions(obj: SceneObject): Vec3[] {
  const n = seatCapacityOf(obj)
  if (n === 0) return []
  const y = seatHeight(obj)
  const zOff = obj.kind === 'sofa' ? -obj.dims[2] * 0.08 : 0
  if (n === 1) return [[0, y, zOff]]
  const w = obj.dims[0]
  return Array.from({ length: n }, (_, i) => [(i + 0.5) * (w / n) - w / 2, y, zOff] as Vec3)
}

/** World-space seat slots of one object. Each slot has a unique, stable key. */
export function seatSlotsOf(obj: SceneObject): SeatSlot[] {
  return localSeatPositions(obj).map((local, index) => ({
    key: `${obj.id}:${index}`,
    objectId: obj.id,
    index,
    position: localToWorld(local, obj.position, obj.rotationY),
    facing: obj.rotationY,
  }))
}

export const allSeatSlots = (objects: SceneObject[]): SeatSlot[] => objects.flatMap(seatSlotsOf)

export const totalSeatCapacity = (objects: SceneObject[]): number =>
  objects.reduce((sum, o) => sum + seatCapacityOf(o), 0)

/**
 * Stage 1 of the two-stage random generation: choose HOW MANY occupants.
 * Never exceeds the capacity.
 */
export function chooseOccupantCount(config: OccupancyConfig, capacity: number, rng: Rng): number {
  if (capacity <= 0) return 0
  switch (config.mode) {
    case 'fixed':
      return Math.min(capacity, Math.max(0, Math.floor(config.fixed)))
    case 'percentage':
      return Math.min(capacity, Math.max(0, Math.round((config.percentage / 100) * capacity)))
    default:
      return randInt(rng, 1, capacity)
  }
}

/**
 * Stage 2: choose WHICH seat slots are taken. Each slot is used at most once.
 */
export function generateOccupants(
  objects: SceneObject[],
  config: OccupancyConfig,
  rng: Rng,
  heatW = 75,
): Occupant[] {
  const slots = allSeatSlots(objects)
  const count = chooseOccupantCount(config, slots.length, rng)
  return shuffle(rng, slots)
    .slice(0, count)
    .map((slot) => ({
      id: newId('occ'),
      seatKey: slot.key,
      objectId: slot.objectId,
      slotIndex: slot.index,
      position: slot.position,
      facing: slot.facing,
      activity: 'seated' as const,
      heatW,
    }))
}

/**
 * Re-attach occupants to the current seat positions (after objects were moved)
 * and drop occupants whose seat no longer exists.
 */
export function syncOccupants(objects: SceneObject[], occupants: Occupant[]): Occupant[] {
  const byKey = new Map(allSeatSlots(objects).map((s) => [s.key, s]))
  const out: Occupant[] = []
  for (const o of occupants) {
    const slot = byKey.get(o.seatKey)
    if (!slot) continue
    out.push({ ...o, position: slot.position, facing: slot.facing })
  }
  return out
}
