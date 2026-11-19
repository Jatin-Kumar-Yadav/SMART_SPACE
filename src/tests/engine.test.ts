import { describe, expect, it } from 'vitest'
import { createObject } from '@/objects/catalog'
import { createSpace } from '@/objects/spaceFactory'
import { exponentialTemperature, singleZoneExponential } from '@/simulation/analytic'
import { SimEngine } from '@/simulation/engine'
import { buildGrid } from '@/simulation/grid'
import { cellAt } from '@/simulation/grid'
import { influenceAt, influenceLocal, profileValue } from '@/simulation/influence'
import { generateOccupants } from '@/simulation/occupancy'
import type { AcDevice, Occupant, Scenario, SceneObject, Space } from '@/types'
import { mulberry32 } from '@/utils/math'

function roomWith(objs: SceneObject[], dims = { length: 10, width: 8, height: 3 }): { space: Space; scenario: Scenario } {
  const space = createSpace({ name: 't', type: 'custom', dims })
  space.objects = objs
  const scenario = space.scenarios[0]
  return { space, scenario }
}

const occ = (o: SceneObject, i = 0): Occupant => ({
  id: `occ${o.id}${i}`,
  seatKey: `${o.id}:${i}`,
  objectId: o.id,
  slotIndex: i,
  position: [o.position[0], 0.45, o.position[2]],
  facing: 0,
  activity: 'seated',
  heatW: 75,
})

describe('device influence', () => {
  it('fan falls off linearly E(r) = max(0, 1 − r/R)', () => {
    const fan = createObject('ceilingFan', 5, 4, { dims: { length: 10, width: 8, height: 3 } })
    const lvl = (fan.device as { levels: { radius: number }[] }).levels[2] as never
    const r = (lvl as { radius: number }).radius
    expect(influenceAt(fan, lvl, 5, 4)).toBeCloseTo(1)
    expect(influenceAt(fan, lvl, 5 + r / 2, 4)).toBeCloseTo(0.5)
    expect(influenceAt(fan, lvl, 5 + r, 4)).toBeCloseTo(0)
    expect(influenceAt(fan, lvl, 5 + r + 1, 4)).toBe(0)
  })

  it('profile interpolation follows the example [0,1.5,3,2.5,2,1,0]', () => {
    const p = [-2, -1, 0, 1, 2, 3, 4].map((x, i) => ({ x, v: [0, 1.5, 3, 2.5, 2, 1, 0][i] }))
    expect(profileValue(p, 0)).toBeCloseTo(1)
    expect(profileValue(p, -1)).toBeCloseTo(0.5)
    expect(profileValue(p, 0.5)).toBeCloseTo(2.75 / 3)
    expect(profileValue(p, 5)).toBe(0)
  })

  it('directional region rotates with the device', () => {
    const ac = createObject('acVent', 5, 4, { dims: { length: 10, width: 8, height: 3 } })
    const d = ac.device as AcDevice
    d.shape = 'directional'
    const lvl = d.levels[2]
    const ahead = influenceAt({ ...ac, rotationY: 0 }, lvl, 5, 6) // +z forward
    const sideways = influenceAt({ ...ac, rotationY: 0 }, lvl, 7, 4)
    expect(ahead).toBeGreaterThan(0.3)
    expect(sideways).toBe(0)
    // rotate 90° — now +x is forward
    const rot = { ...ac, rotationY: Math.PI / 2 }
    expect(influenceAt(rot, lvl, 7, 4)).toBeGreaterThan(0.3)
    expect(influenceAt(rot, lvl, 5, 6)).toBe(0)
    expect(influenceLocal('circle', lvl, [], 0, 0)).toBeCloseTo(1)
  })
})

describe('thermal engine', () => {
  it('uniform single-zone case follows the exponential solution', () => {
    const ac = createObject('acVent', 5, 4, { dims: { length: 10, width: 8, height: 3 } })
    const d = ac.device as AcDevice
    d.mode = 'manual'
    d.level = 3
    d.shape = 'circle'
    d.levels[3].radius = 100 // covers the whole room => uniform cooling distribution
    const { space, scenario } = roomWith([ac])
    scenario.initialTempC = 32
    scenario.outsideTempC = 35
    scenario.sim.resolution = 'coarse'
    scenario.sim.equipmentW = 1000
    scenario.autoLighting = false
    const eng = new SimEngine(space, scenario)
    const snap0 = eng.snapshot()
    expect(snap0.stats.avgT).toBeCloseTo(32, 6)

    const ceff = 288 * 1005 * 6
    const ua = 0.8 * (2 * (10 + 8) * 3 + 80)
    const gac = 5000 / (35 - 12)
    const { tTarget, k } = singleZoneExponential({ ceff, ua, gac, outsideC: 35, supplyC: 12, gainW: 1000 })
    for (const t of [120, 600, 1800]) {
      while (eng.time < t) eng.advance(Math.min(60, t - eng.time))
      const sim = eng.snapshot().stats.avgT
      const exact = exponentialTemperature(t, 32, tTarget, k)
      expect(Math.abs(sim - exact)).toBeLessThan(0.06)
      expect(eng.snapshot().stats.maxT - eng.snapshot().stats.minT).toBeLessThan(0.05)
    }
  })

  it('AC cooling lowers the temperature and uses energy; no AC does not cool', () => {
    const ac = createObject('acVent', 5, 4, { dims: { length: 10, width: 8, height: 3 } })
    ;(ac.device as AcDevice).mode = 'manual'
    const a = roomWith([ac])
    a.scenario.autoLighting = false
    const eng = new SimEngine(a.space, a.scenario)
    eng.advance(900)
    const s = eng.snapshot().stats
    expect(s.avgT).toBeLessThan(32)
    expect(s.energyKWh).toBeGreaterThan(0)

    const b = roomWith([])
    b.scenario.outsideTempC = 32
    const eng2 = new SimEngine(b.space, b.scenario)
    eng2.advance(900)
    expect(Math.abs(eng2.snapshot().stats.avgT - 32)).toBeLessThan(0.01)
  })

  it('local cooling creates spatial differences and mixing smooths them', () => {
    const ac = createObject('acVent', 1.5, 1.5, { dims: { length: 10, width: 8, height: 3 } })
    const d = ac.device as AcDevice
    d.mode = 'manual'
    d.level = 3
    d.shape = 'circle'
    d.levels[3].radius = 2.5
    const { space, scenario } = roomWith([ac])
    scenario.autoLighting = false
    scenario.sim.resolution = 'standard'
    const eng = new SimEngine(space, scenario)
    eng.advance(900)
    const snap = eng.snapshot()
    const near = snap.temp[cellAt(eng.grid, 1.5, 1.5)]
    const far = snap.temp[cellAt(eng.grid, 9, 7)]
    expect(near).toBeLessThan(far)
  })

  it('automatic control raises AC level when hot and respects manual mode', () => {
    const auto = createObject('acVent', 2.5, 2, { dims: { length: 10, width: 8, height: 3 } })
    ;(auto.device as AcDevice).level = 0
    const manualFan = createObject('ceilingFan', 7.5, 6, { dims: { length: 10, width: 8, height: 3 } })
    manualFan.device!.mode = 'manual'
    ;(manualFan.device as { level: number }).level = 1
    const chair1 = createObject('chair', 2.5, 3, { dims: { length: 10, width: 8, height: 3 } })
    const chair2 = createObject('chair', 7.5, 5, { dims: { length: 10, width: 8, height: 3 } })
    const { space, scenario } = roomWith([auto, manualFan, chair1, chair2])
    scenario.occupants = [occ(chair1), occ(chair2)]
    scenario.autoLighting = false
    const eng = new SimEngine(space, scenario)
    eng.advance(400)
    expect(eng.liveLevel(auto.id)).toBeGreaterThan(0)
    expect(eng.liveLevel(manualFan.id)).toBe(1) // untouched
  })
})

describe('coverage & zones', () => {
  it('flags an occupant outside every device region but keeps them in the analysis', () => {
    const ac = createObject('acVent', 2, 2, { dims: { length: 10, width: 8, height: 3 } })
    const d = ac.device as AcDevice
    d.shape = 'circle'
    d.levels[2].radius = 2
    d.level = 2
    const near = createObject('chair', 2, 2.5, { dims: { length: 10, width: 8, height: 3 } })
    const far = createObject('chair', 9, 7, { dims: { length: 10, width: 8, height: 3 } })
    const { space, scenario } = roomWith([ac, near, far])
    scenario.occupants = [occ(near), occ(far)]
    const eng = new SimEngine(space, scenario)
    const snap = eng.snapshot()
    const byId = new Map(snap.coverage.map((c) => [c.occupantId, c]))
    expect(byId.get(occ(near).id)!.acIds).toContain(ac.id)
    expect(byId.get(occ(far).id)!.status).toBe('uncovered')
    expect(snap.coverage).toHaveLength(2)
    expect(snap.stats.warnings.some((w) => w.includes('underserved'))).toBe(true)
    expect(snap.coverage.some((c) => c.status === 'uncovered')).toBe(true)
    expect(snap.zones.some((z) => z.coverage === 'cooled')).toBe(true)
  })

  it('retains all overlapping devices for an occupant', () => {
    const a1 = createObject('acVent', 4, 4, { dims: { length: 10, width: 8, height: 3 } })
    const a2 = createObject('acVent', 6, 4, { dims: { length: 10, width: 8, height: 3 } })
    for (const a of [a1, a2]) {
      const d = a.device as AcDevice
      d.shape = 'circle'
      d.level = 2
      d.levels[2].radius = 3
    }
    const chair = createObject('chair', 5, 4, { dims: { length: 10, width: 8, height: 3 } })
    const { space, scenario } = roomWith([a1, a2, chair])
    scenario.occupants = [occ(chair)]
    const snap = new SimEngine(space, scenario).snapshot()
    expect(snap.coverage[0].acIds.sort()).toEqual([a1.id, a2.id].sort())
  })

  it('interior walls separate cells unless a door opens the link', () => {
    const { space } = roomWith([])
    space.walls.push({ id: 'w1', a: [5, 0], b: [5, 8], thickness: 0.15, height: 3 })
    const closed = buildGrid(space, 'standard')
    expect(closed.linkEast[4]).toBeLessThan(0.1)
    const door = createObject('door', 5, 4, space)
    door.wall = { wallId: 'w1', offset: 3.5 }
    space.objects.push(door)
    const open = buildGrid(space, 'standard')
    expect(open.linkEast[3 * open.nx + 4]).toBe(1)
    expect(open.linkEast[0 * open.nx + 4]).toBeLessThan(0.1)
  })
})

describe('lighting', () => {
  it('adds illuminance under a light and dims it when daylight is sufficient', () => {
    const light = createObject('ceilingLight', 5, 4, { dims: { length: 10, width: 8, height: 3 } })
    const chair = createObject('chair', 5, 4, { dims: { length: 10, width: 8, height: 3 } })
    const { space, scenario } = roomWith([light, chair])
    scenario.occupants = [occ(chair)]
    scenario.lighting = { preset: 'custom', timeOfDay: 22, cloudCover: 0 }
    scenario.targetLux = 300
    scenario.autoLighting = true
    const night = new SimEngine(space, scenario)
    night.advance(600)
    const s1 = night.snapshot()
    const under = s1.lux[cellAt(night.grid, 5, 4)]
    expect(under).toBeGreaterThan(50)
    expect(s1.natural[cellAt(night.grid, 5, 4)]).toBe(0)

    // with a big window in strong daylight the light output falls
    const win = createObject('window', 5, 0, { dims: { length: 10, width: 8, height: 3 } })
    win.dims = [8, 2, 0.2]
    win.position = [5, 0.9, 0]
    win.rotationY = 0 // +z faces into the room
    win.wall = { wallId: 'wall_n', offset: 5 }
    const day = roomWith([light, chair, win])
    day.scenario.occupants = [occ(chair)]
    day.scenario.lighting = { preset: 'custom', timeOfDay: 12, cloudCover: 0 }
    day.scenario.targetLux = 300
    const eng = new SimEngine(day.space, day.scenario)
    eng.advance(600)
    const s2 = eng.snapshot()
    expect(s2.natural[cellAt(eng.grid, 5, 1.5)]).toBeGreaterThan(300)
    const dimming = s2.devices.find((d) => d.id === light.id)!.dimming
    expect(dimming).toBeLessThan(0.5)
  })
})

describe('seat allocation inside the engine', () => {
  it('unique seats only', () => {
    const chairs = Array.from({ length: 10 }, (_, i) => createObject('chair', 1 + i * 0.8, 2, { dims: { length: 10, width: 8, height: 3 } }))
    const occs = generateOccupants(chairs, { mode: 'fixed', fixed: 7, percentage: 0 }, mulberry32(1))
    expect(new Set(occs.map((o) => o.seatKey)).size).toBe(7)
  })
})

describe('idle daylight', () => {
  it('reports daylight from windows before the first simulation step', async () => {
    const { createSeminarHall } = await import('@/demo/seminarHall')
    const { SimEngine } = await import('@/simulation/engine')
    const space = createSeminarHall()
    const day = space.scenarios[0]
    const eng = new SimEngine(space, day)
    const s = eng.snapshot()
    expect(s.stats.outdoorLux).toBeGreaterThan(1000)
    expect(Array.from(s.natural).some((v) => v > 1)).toBe(true)
    const night = new SimEngine(space, { ...day, lighting: { preset: 'night', timeOfDay: 22, cloudCover: 0 } })
    expect(night.snapshot().stats.outdoorLux).toBeLessThan(1)
  })
})
