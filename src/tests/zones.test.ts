import { describe, expect, it } from 'vitest'
import { createObject } from '@/objects/catalog'
import { createSpace } from '@/objects/spaceFactory'
import { SimEngine } from '@/simulation/engine'
import type { SceneObject, Space } from '@/types'

function makeTestRoom(objects: SceneObject[]): { space: Space } {
  const space = createSpace({ name: 'Test Hall', type: 'classroom', dims: { length: 14, width: 10, height: 3 } })
  space.objects = objects
  return { space }
}

describe('Classroom Zone Generation: ACs and Fans Only (7 Verification Cases)', () => {
  // Setup helper: 2 ACs, 4 Fans, 6 Lights
  function createStandardSetup() {
    const dims = { length: 14, width: 10, height: 3 }
    // AC 1 on left half (x = 3.5), AC 2 on right half (x = 10.5)
    const ac1 = createObject('acVent', 3.5, 5, { dims })
    ac1.id = 'ac1'
    ac1.name = 'AC Vent 1'

    const ac2 = createObject('acVent', 10.5, 5, { dims })
    ac2.id = 'ac2'
    ac2.name = 'AC Vent 2'

    // Fans 1 & 2 in left half (belonging to AC 1)
    const fan1 = createObject('ceilingFan', 3.5, 2.5, { dims })
    fan1.id = 'fan1'
    fan1.name = 'Ceiling Fan 1'

    const fan2 = createObject('ceilingFan', 3.5, 7.5, { dims })
    fan2.id = 'fan2'
    fan2.name = 'Ceiling Fan 2'

    // Fans 3 & 4 in right half (belonging to AC 2)
    const fan3 = createObject('ceilingFan', 10.5, 2.5, { dims })
    fan3.id = 'fan3'
    fan3.name = 'Ceiling Fan 3'

    const fan4 = createObject('ceilingFan', 10.5, 7.5, { dims })
    fan4.id = 'fan4'
    fan4.name = 'Ceiling Fan 4'

    // 6 lights distributed across the space
    const light1 = createObject('ceilingLight', 2, 2, { dims })
    light1.id = 'light1'
    const light2 = createObject('ceilingLight', 5, 2, { dims })
    light2.id = 'light2'
    const light3 = createObject('ceilingLight', 2, 8, { dims })
    light3.id = 'light3'
    const light4 = createObject('ceilingLight', 5, 8, { dims })
    light4.id = 'light4'
    const light5 = createObject('ceilingLight', 9, 2, { dims })
    light5.id = 'light5'
    const light6 = createObject('ceilingLight', 12, 8, { dims })
    light6.id = 'light6'

    return {
      acs: [ac1, ac2],
      fans: [fan1, fan2, fan3, fan4],
      lights: [light1, light2, light3, light4, light5, light6],
    }
  }

  it('Case 1: 2 ACs, 4 fans, 6 lights → zones determined by 2 ACs and 4 fans only', () => {
    const { acs, fans, lights } = createStandardSetup()
    const { space } = makeTestRoom([...acs, ...fans, ...lights])
    const eng = new SimEngine(space, space.scenarios[0])
    const snap = eng.snapshot()

    // 2 AC primary zones, each divided into 2 fan subzones = exactly 4 zones
    expect(snap.zones).toHaveLength(4)

    // Verify parent AC zone and fan subzone assignments
    const ac1Zones = snap.zones.filter((z) => z.acId === 'ac1')
    const ac2Zones = snap.zones.filter((z) => z.acId === 'ac2')
    expect(ac1Zones).toHaveLength(2)
    expect(ac2Zones).toHaveLength(2)

    // Verify AC Zone IDs
    expect(ac1Zones.every((z) => z.acZoneId === 1)).toBe(true)
    expect(ac2Zones.every((z) => z.acZoneId === 2)).toBe(true)

    // Fans 1 & 2 are in AC 1; Fans 3 & 4 are in AC 2
    const fanIdsInAc1 = ac1Zones.map((z) => z.fanId)
    const fanIdsInAc2 = ac2Zones.map((z) => z.fanId)
    expect(fanIdsInAc1.sort()).toEqual(['fan1', 'fan2'].sort())
    expect(fanIdsInAc2.sort()).toEqual(['fan3', 'fan4'].sort())

    // Verify all 6 lights are assigned to existing zones without creating new zones
    const totalAssignedLights = snap.zones.reduce((sum, z) => sum + z.lightIds.length, 0)
    expect(totalAssignedLights).toBe(6)
  })

  it('Case 2: Add 5 more lights → zone boundaries and zone count remain unchanged', () => {
    const { acs, fans, lights } = createStandardSetup()
    const dims = { length: 14, width: 10, height: 3 }

    // Baseline with 6 lights
    const { space: s1 } = makeTestRoom([...acs, ...fans, ...lights])
    const snap1 = new SimEngine(s1, s1.scenarios[0]).snapshot()

    // Add 5 more lights
    const extraLights = Array.from({ length: 5 }, (_, i) => {
      const l = createObject('ceilingLight', 2 + i * 2, 5, { dims })
      l.id = `extra_light_${i + 1}`
      return l
    })
    const { space: s2 } = makeTestRoom([...acs, ...fans, ...lights, ...extraLights])
    const snap2 = new SimEngine(s2, s2.scenarios[0]).snapshot()

    // Zone count is STILL exactly 4
    expect(snap2.zones).toHaveLength(4)
    expect(snap2.zones).toHaveLength(snap1.zones.length)

    // Zone boundaries (zoneIdByCell) are identical
    expect(snap2.zoneIdByCell).toEqual(snap1.zoneIdByCell)

    // All 11 lights are accounted for in device assignments
    const totalAssignedLights = snap2.zones.reduce((sum, z) => sum + z.lightIds.length, 0)
    expect(totalAssignedLights).toBe(11)
  })

  it('Case 3: Remove all lights → zones remain unchanged', () => {
    const { acs, fans, lights } = createStandardSetup()

    // Baseline with 6 lights
    const { space: s1 } = makeTestRoom([...acs, ...fans, ...lights])
    const snap1 = new SimEngine(s1, s1.scenarios[0]).snapshot()

    // Setup with 0 lights
    const { space: s2 } = makeTestRoom([...acs, ...fans])
    const snap2 = new SimEngine(s2, s2.scenarios[0]).snapshot()

    // Zone count and cell boundaries remain identical
    expect(snap2.zones).toHaveLength(4)
    expect(snap2.zones).toHaveLength(snap1.zones.length)
    expect(snap2.zoneIdByCell).toEqual(snap1.zoneIdByCell)

    // Each zone simply has empty lightIds
    expect(snap2.zones.every((z) => z.lightIds.length === 0)).toBe(true)
  })

  it('Case 4: Move a light to another zone → only its device assignment changes', () => {
    const { acs, fans, lights } = createStandardSetup()
    const dims = { length: 14, width: 10, height: 3 }

    // light1 is initially at (2, 2) in AC Zone 1 / Fan Subzone 1
    const { space: s1 } = makeTestRoom([...acs, ...fans, ...lights])
    const snap1 = new SimEngine(s1, s1.scenarios[0]).snapshot()
    const initialZoneOfLight1 = snap1.zones.find((z) => z.lightIds.includes('light1'))!
    expect(initialZoneOfLight1.acZoneId).toBe(1)

    // Move light1 to (12, 8) in AC Zone 2 / Fan Subzone 2
    const movedLight1 = createObject('ceilingLight', 12, 8, { dims })
    movedLight1.id = 'light1'
    const otherLights = lights.filter((l) => l.id !== 'light1')

    const { space: s2 } = makeTestRoom([...acs, ...fans, movedLight1, ...otherLights])
    const snap2 = new SimEngine(s2, s2.scenarios[0]).snapshot()

    // Zone boundaries and count remain identical
    expect(snap2.zones).toHaveLength(snap1.zones.length)
    expect(snap2.zoneIdByCell).toEqual(snap1.zoneIdByCell)

    // Check updated device assignment
    const newZoneOfLight1 = snap2.zones.find((z) => z.lightIds.includes('light1'))!
    expect(newZoneOfLight1.id).not.toBe(initialZoneOfLight1.id)
    expect(newZoneOfLight1.acZoneId).toBe(2)
  })

  it('Case 5: Remove all fans → AC zones remain', () => {
    const { acs, lights } = createStandardSetup()

    // Room with 2 ACs, 0 fans, 6 lights
    const { space } = makeTestRoom([...acs, ...lights])
    const snap = new SimEngine(space, space.scenarios[0]).snapshot()

    // Exactly 2 AC primary zones remain
    expect(snap.zones).toHaveLength(2)
    expect(snap.zones[0].acId).toBe('ac1')
    expect(snap.zones[0].acZoneId).toBe(1)
    expect(snap.zones[0].fanId).toBeNull()

    expect(snap.zones[1].acId).toBe('ac2')
    expect(snap.zones[1].acZoneId).toBe(2)
    expect(snap.zones[1].fanId).toBeNull()

    // All lights are assigned across the 2 primary AC zones
    const totalAssignedLights = snap.zones.reduce((sum, z) => sum + z.lightIds.length, 0)
    expect(totalAssignedLights).toBe(6)
  })

  it('Case 6: Remove all ACs → no AC-based primary zones are generated', () => {
    const { fans, lights } = createStandardSetup()

    // Room with 0 ACs, 4 fans, 6 lights
    const { space } = makeTestRoom([...fans, ...lights])
    const snap = new SimEngine(space, space.scenarios[0]).snapshot()

    // No AC-based primary zones are generated
    expect(snap.zones.every((z) => z.acId === null)).toBe(true)
    expect(snap.zones.every((z) => z.acZoneId === null)).toBe(true)

    // Zones are determined by the 4 fans (4 fan zones)
    expect(snap.zones).toHaveLength(4)
    expect(snap.zones.every((z) => z.fanId !== null)).toBe(true)
    expect(snap.zones.every((z) => z.coverage === 'fan-only')).toBe(true)
  })

  it('Case 7: Add a fan → fan subzone is generated within its appropriate parent AC zone', () => {
    const { acs, lights } = createStandardSetup()
    const dims = { length: 14, width: 10, height: 3 }

    // Start with 2 ACs and 0 fans (2 primary AC zones)
    const { space: s1 } = makeTestRoom([...acs, ...lights])
    const snap1 = new SimEngine(s1, s1.scenarios[0]).snapshot()
    expect(snap1.zones).toHaveLength(2)

    // Add Fan 1 at (3.5, 5), which is in AC Zone 1
    const fan1 = createObject('ceilingFan', 3.5, 5, { dims })
    fan1.id = 'fan1'
    fan1.name = 'Ceiling Fan 1'

    const { space: s2 } = makeTestRoom([...acs, fan1, ...lights])
    const snap2 = new SimEngine(s2, s2.scenarios[0]).snapshot()

    // Result has 2 zones:
    // Zone 1: AC Zone 1 · Fan Subzone 1 (associated with ac1 and fan1)
    // Zone 2: AC Zone 2 (associated with ac2, no fan subzone invented!)
    expect(snap2.zones).toHaveLength(2)
    const ac1Zone = snap2.zones.find((z) => z.acId === 'ac1')!
    const ac2Zone = snap2.zones.find((z) => z.acId === 'ac2')!

    expect(ac1Zone.fanId).toBe('fan1')
    expect(ac1Zone.fanSubzoneId).toBe(1)
    expect(ac1Zone.label).toContain('Fan Subzone 1')

    expect(ac2Zone.fanId).toBeNull()
    expect(ac2Zone.fanSubzoneId).toBeNull()
    expect(ac2Zone.label).toBe('AC Zone 2')

    // Now add Fan 2 at (3.5, 8), also in AC Zone 1
    const fan2 = createObject('ceilingFan', 3.5, 8, { dims })
    fan2.id = 'fan2'
    fan2.name = 'Ceiling Fan 2'

    const { space: s3 } = makeTestRoom([...acs, fan1, fan2, ...lights])
    const snap3 = new SimEngine(s3, s3.scenarios[0]).snapshot()

    // AC Zone 1 is now split into 2 fan subzones; AC Zone 2 remains undivided = 3 zones total!
    expect(snap3.zones).toHaveLength(3)
    const ac1Subzones = snap3.zones.filter((z) => z.acId === 'ac1')
    const ac2Subzones = snap3.zones.filter((z) => z.acId === 'ac2')

    expect(ac1Subzones).toHaveLength(2)
    expect(ac2Subzones).toHaveLength(1)
    expect(ac2Subzones[0].fanId).toBeNull()
  })
})
