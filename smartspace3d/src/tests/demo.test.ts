import { describe, expect, it } from 'vitest'
import { placementIssue } from '@/objects/collision'
import { createSeminarHall } from '@/demo/seminarHall'
import { SimEngine } from '@/simulation/engine'
import { seatCapacityOf, totalSeatCapacity } from '@/simulation/occupancy'
import { activeScenarioOf } from './helpers'

describe('Seminar Hall demo project', () => {
  const space = createSeminarHall()

  it('is a 30×20×4 m hall with 120 seats and 73 seated occupants', () => {
    expect(space.dims).toEqual({ length: 30, width: 20, height: 4 })
    expect(totalSeatCapacity(space.objects)).toBe(120)
    const sc = activeScenarioOf(space)
    expect(sc.occupants.length).toBe(73)
    expect(new Set(sc.occupants.map((o) => o.seatKey)).size).toBe(73) // one person per seat
  })

  it('contains every required element', () => {
    const kinds = new Set(space.objects.map((o) => o.kind))
    for (const k of ['podium', 'desk', 'chair', 'ceilingFan', 'splitAC', 'acVent', 'ceilingLight', 'plant', 'window', 'door'] as const) {
      expect(kinds.has(k), k).toBe(true)
    }
    expect(space.objects.filter((o) => o.kind === 'chair').every((o) => seatCapacityOf(o) === 1)).toBe(true)
  })

  it('has no invalid placements', () => {
    const bad = space.objects.map((o) => [o.name, placementIssue(o, space)] as const).filter(([, i]) => i)
    expect(bad).toEqual([])
  })

  it('cools from 32 °C towards 24 °C and reaches the lighting target using real simulation', () => {
    const sc = activeScenarioOf(space)
    const eng = new SimEngine(space, sc)
    const t0 = eng.snapshot().stats
    expect(t0.avgT).toBeCloseTo(32, 1)
    eng.advance(3 * 3600)
    const s = eng.snapshot().stats
    expect(s.avgT).toBeLessThan(26)
    expect(s.avgLux).toBeGreaterThan(250)
    expect(s.avgLux).toBeLessThan(1500)
    expect(s.coolingW).toBeGreaterThan(0)
    // eslint-disable-next-line no-console
    console.log('demo after 3h:', { avgT: s.avgT.toFixed(2), minT: s.minT.toFixed(2), maxT: s.maxT.toFixed(2), lux: s.avgLux.toFixed(0), coolingW: Math.round(s.coolingW), comfort: s.comfort, warnings: s.warnings })
  })
})
