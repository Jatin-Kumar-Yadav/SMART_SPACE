import { describe, expect, it } from 'vitest'
import { applyCameraSeats, switchOccupancySource } from '@/simulation/occupancySource'
import { allSeatSlots } from '@/simulation/occupancy'
import { createObject } from '@/objects/catalog'
import { createScenario } from '@/simulation/scenario'
import type { Occupant, SceneObject } from '@/types'

const chairs = (): SceneObject[] => [0, 1, 2, 3].map((i) => ({ ...createObject('chair', i * 1.2, 1, { dims: { length: 10, width: 10, height: 3 } }), id: `c${i}`, seatable: true }))
const occ = (seatKey: string): Occupant => ({ id: 'o_' + seatKey, seatKey, objectId: seatKey.split(':')[0], slotIndex: 0, position: [0, 0, 0], facing: 0, activity: 'seated', heatW: 75 })

describe('occupancy source switching', () => {
  it('stashes generated occupants when the camera takes over and restores them (not regenerates) afterwards', () => {
    const sc = { ...createScenario('t'), occupants: [occ('c0:0'), occ('c2:0')] }
    const cam = switchOccupancySource(sc, 'camera')
    expect(cam.occupancySource).toBe('camera')
    expect(cam.occupants).toEqual([])
    expect(cam.stashedOccupants?.map((o) => o.id)).toEqual(['o_c0:0', 'o_c2:0'])
    const back = switchOccupancySource(cam, 'manual')
    expect(back.occupancySource).toBe('manual')
    expect(back.occupants.map((o) => o.id)).toEqual(['o_c0:0', 'o_c2:0'])
    expect(back.stashedOccupants).toBeUndefined()
  })

  it('camera seats only apply while the camera is authoritative, one occupant per seat, ids stable', () => {
    const objs = chairs()
    const sc = createScenario('t')
    expect(applyCameraSeats(sc, objs, ['c0:0'])).toBe(sc)
    const cam = switchOccupancySource(sc, 'camera')
    const a = applyCameraSeats(cam, objs, ['c1:0', 'c1:0', 'nope:0', 'c3:0'])
    expect(a.occupants.map((o) => o.seatKey)).toEqual(['c1:0', 'c3:0'])
    const b = applyCameraSeats(a, objs, ['c1:0', 'c2:0'])
    expect(b.occupants.find((o) => o.seatKey === 'c1:0')!.id).toBe(a.occupants.find((o) => o.seatKey === 'c1:0')!.id)
    expect(allSeatSlots(objs).length).toBe(4)
    // identical seat set → same object (no needless re-render / re-simulation)
    expect(applyCameraSeats(b, objs, ['c1:0', 'c2:0'])).toBe(b)
  })
})
