import { describe, expect, it } from 'vitest'
import { createObject } from '@/objects/catalog'
import {
  allSeatSlots,
  chooseOccupantCount,
  generateOccupants,
  seatCapacityOf,
  seatSlotsOf,
  syncOccupants,
  totalSeatCapacity,
} from '@/simulation/occupancy'
import { localToWorld, mulberry32, worldToLocal } from '@/utils/math'

const room = { dims: { length: 20, width: 15, height: 4 } }

describe('seat slots & capacity', () => {
  it('chairs offer one seat, a dining table none', () => {
    expect(seatCapacityOf(createObject('chair', 1, 1, room))).toBe(1)
    expect(seatCapacityOf(createObject('diningTable', 1, 1, room))).toBe(0)
  })

  it('sofa and bench capacity depends on length and can be overridden', () => {
    const sofa = createObject('sofa', 3, 3, room)
    expect(seatCapacityOf(sofa)).toBe(3) // 2.0 m / 0.65 m
    sofa.dims[0] = 3.3
    expect(seatCapacityOf(sofa)).toBe(5)
    sofa.seatCountOverride = 2
    expect(seatCapacityOf(sofa)).toBe(2)
    expect(seatSlotsOf(sofa)).toHaveLength(2)
  })

  it('beds are not seatable by default and invisible/not-seatable objects offer no seats', () => {
    const bed = createObject('bed', 2, 2, room)
    expect(seatCapacityOf(bed)).toBe(0)
    bed.seatable = true
    expect(seatCapacityOf(bed)).toBe(2)
    const chair = createObject('chair', 1, 1, room)
    chair.seatable = false
    expect(seatCapacityOf(chair)).toBe(0)
  })

  it('every seat slot has a unique key and a world position', () => {
    const sofa = createObject('sofa', 5, 5, room)
    sofa.rotationY = Math.PI / 2
    const slots = seatSlotsOf(sofa)
    expect(new Set(slots.map((s) => s.key)).size).toBe(slots.length)
    // rotated 90°: local +x maps to world −z, so slots spread along z
    expect(Math.abs(slots[0].position[0] - slots[1].position[0])).toBeLessThan(1e-9)
    expect(Math.abs(slots[0].position[2] - slots[1].position[2])).toBeGreaterThan(0.5)
  })
})

describe('coordinate conversion', () => {
  it('local → world → local round-trips', () => {
    const origin: [number, number, number] = [3, 0.2, 7]
    for (const yaw of [0, 0.7, Math.PI / 2, 2.5, -1.2]) {
      const w = localToWorld([0.4, 0.5, -1.1], origin, yaw)
      const l = worldToLocal(w, origin, yaw)
      expect(l[0]).toBeCloseTo(0.4)
      expect(l[1]).toBeCloseTo(0.5)
      expect(l[2]).toBeCloseTo(-1.1)
    }
  })

  it('+z local maps to (sinθ, cosθ) in world space', () => {
    const w = localToWorld([0, 0, 1], [0, 0, 0], Math.PI / 2)
    expect(w[0]).toBeCloseTo(1)
    expect(w[2]).toBeCloseTo(0)
  })
})

describe('random occupancy generation', () => {
  const chairs = Array.from({ length: 10 }, (_, i) => createObject('chair', 1 + i, 2, room))

  it('fixed: exactly 7 unique seats out of 10 chairs', () => {
    const occ = generateOccupants(chairs, { mode: 'fixed', fixed: 7, percentage: 0 }, mulberry32(42))
    expect(occ).toHaveLength(7)
    expect(new Set(occ.map((o) => o.seatKey)).size).toBe(7)
  })

  it('never exceeds capacity', () => {
    const occ = generateOccupants(chairs, { mode: 'fixed', fixed: 99, percentage: 0 }, mulberry32(1))
    expect(occ).toHaveLength(10)
    expect(totalSeatCapacity(chairs)).toBe(10)
  })

  it('percentage mode', () => {
    expect(chooseOccupantCount({ mode: 'percentage', fixed: 0, percentage: 60 }, 120, mulberry32(1))).toBe(72)
  })

  it('random mode picks 1…capacity occupants and different seeds give different layouts', () => {
    for (let s = 1; s < 50; s++) {
      const n = chooseOccupantCount({ mode: 'random', fixed: 0, percentage: 0 }, 120, mulberry32(s))
      expect(n).toBeGreaterThanOrEqual(1)
      expect(n).toBeLessThanOrEqual(120)
    }
    const a = generateOccupants(chairs, { mode: 'fixed', fixed: 5, percentage: 0 }, mulberry32(1)).map((o) => o.seatKey).join()
    const b = generateOccupants(chairs, { mode: 'fixed', fixed: 5, percentage: 0 }, mulberry32(2)).map((o) => o.seatKey).join()
    expect(a).not.toBe(b)
  })

  it('sync drops occupants whose seat disappeared and follows moved furniture', () => {
    const occ = generateOccupants(chairs, { mode: 'fixed', fixed: 10, percentage: 0 }, mulberry32(3))
    const moved = chairs.slice(1).map((c, i) => (i === 0 ? { ...c, position: [9, 0, 9] as [number, number, number] } : c))
    const synced = syncOccupants(moved, occ)
    expect(synced).toHaveLength(9)
    const first = synced.find((o) => o.objectId === moved[0].id)!
    expect(first.position[0]).toBeCloseTo(9)
    expect(allSeatSlots(moved)).toHaveLength(9)
  })
})
