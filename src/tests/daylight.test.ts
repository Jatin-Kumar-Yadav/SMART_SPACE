import { describe, expect, it } from 'vitest'
import { createObject } from '@/objects/catalog'
import { createSpace } from '@/objects/spaceFactory'
import { buildGrid } from '@/simulation/grid'
import { defaultDaylight, daylightOf, daylightWeight } from '@/simulation/daylight'
import { windowUnitField } from '@/simulation/lighting'

function setup() {
  const space = createSpace({ name: 't', type: 'custom', dims: { length: 10, width: 8, height: 3 } })
  const win = createObject('window', 5, 0, space)
  const grid = buildGrid(space, 'standard')
  return { space, win, grid }
}
const total = (a: Float32Array) => a.reduce((s, v) => s + v, 0)

describe('window daylight influence region', () => {
  it('legacy windows (no daylight field) are unchanged by the clamping helper', () => {
    const { win } = setup()
    expect(win.window?.daylight).toBeUndefined()
    expect(daylightOf(win).length).toBeGreaterThan(0)
  })

  it('length, width, spread, intensity and direction change the simulated field', () => {
    const { win, grid } = setup()
    const base = { ...defaultDaylight(win) }
    const field = (patch: object) => {
      win.window!.daylight = { ...base, ...patch }
      return windowUnitField(grid, win)
    }
    const ref = total(field({}))
    expect(ref).toBeGreaterThan(0)
    expect(total(field({ length: 2 }))).toBeLessThan(ref)
    expect(total(field({ intensity: 0.5 }))).toBeLessThan(ref)
    expect(total(field({ width: 0.4, spread: 0 }))).toBeLessThan(ref)
    expect(total(field({ spread: 60 }))).toBeGreaterThan(ref)
    const a = field({ direction: 0 })
    const b = field({ direction: 40 })
    expect(a.some((v, i) => Math.abs(v - b[i]) > 1e-6)).toBe(true)
  })

  it('weight decays with distance and is zero outside the region', () => {
    const { win } = setup()
    const p = { ...defaultDaylight(win), length: 6 }
    expect(daylightWeight(p, 0.5, 0)).toBeGreaterThan(daylightWeight(p, 4, 0))
    expect(daylightWeight(p, 7, 0)).toBe(0)
    expect(daylightWeight(p, 2, 50)).toBeLessThan(1e-6)
  })

  it('survives a JSON round trip (persistence)', () => {
    const { win } = setup()
    win.window!.daylight = { ...defaultDaylight(win), length: 9, direction: -20 }
    const back = JSON.parse(JSON.stringify(win))
    expect(daylightOf(back).length).toBe(9)
    expect(daylightOf(back).direction).toBe(-20)
  })
})
