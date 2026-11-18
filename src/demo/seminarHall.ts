import { acLevels, createObject } from '@/objects/catalog'
import { closestWall, createSpace, defaultFloor, placeOnWall } from '@/objects/spaceFactory'
import { generateOccupants } from '@/simulation/occupancy'
import { captureStates, createScenario, DEFAULT_SIM } from '@/simulation/scenario'
import type { FloorRegion, ObjectKind, Occupant, Scenario, SceneObject, Space } from '@/types'
import { mulberry32, newId } from '@/utils/math'

/**
 * Seminar Hall demo — 30 m × 20 m × 4 m, 120 seats (8 rows × 5 desks × 3 chairs).
 * Stage with podium at the north wall, entrance on the east wall, windows on
 * three sides, ceiling fans, split ACs (directional) + ceiling vents (circular),
 * ceiling light panels and plants. 73 of the 120 seats are occupied.
 */
export function createSeminarHall(): Space {
  const space = createSpace({ name: 'Seminar Hall Demo', type: 'seminar-hall', dims: { length: 30, width: 20, height: 4 } })
  const objs: SceneObject[] = []
  const at = (kind: ObjectKind, x: number, z: number, patch: Partial<SceneObject> = {}) => {
    const o = { ...createObject(kind, x, z, space), ...patch }
    if (!patch.position) o.position = [x, o.position[1], z]
    if (patch.name === undefined) o.name = `${o.name} ${objs.filter((q) => q.kind === kind).length + 1}`
    objs.push(o)
    return o
  }
  const onWall = (kind: ObjectKind, x: number, z: number) => {
    const o = createObject(kind, x, z, space)
    const hit = closestWall(space.walls, x, z, 2)
    if (!hit) throw new Error(`no wall near ${x},${z}`)
    const placed = placeOnWall(o, hit.wall, hit.offset, 1)
    placed.name = `${o.name} ${objs.filter((q) => q.kind === kind).length + 1}`
    objs.push(placed)
    return placed
  }

  // ── audience: 8 rows × 5 groups × (desk + 3 chairs) ──
  const groupX = [5.4, 10.2, 15, 19.8, 24.6]
  for (let r = 0; r < 8; r++) {
    const z = 6.5 + r * 1.65
    for (const gx of groupX) {
      at('desk', gx, z, { dims: [1.9, 0.75, 0.7], name: 'Desk' })
      for (const dx of [-0.62, 0, 0.62]) at('chair', gx + dx, z + 0.58, { rotationY: Math.PI, name: 'Chair' })
    }
  }

  // ── stage ──
  at('podium', 15, 2.1, { name: 'Podium' })
  at('carpet', 15, 2.7, { dims: [5, 0.02, 2.6], color: '#7c3f3f', name: 'Stage carpet' })
  at('plant', 7.5, 1.3, { name: 'Plant' })
  at('plant', 22.5, 1.3, { name: 'Plant' })
  at('plant', 1.2, 19, { name: 'Plant' })
  at('plant', 28.8, 13.6, { name: 'Plant' })
  at('plant', 28.8, 19.2, { name: 'Plant' })
  at('cabinet', 1.0, 10, { rotationY: Math.PI / 2, name: 'Cabinet' })
  at('bookshelf', 1.0, 12, { rotationY: Math.PI / 2, name: 'Bookshelf' })

  // ── architecture ──
  onWall('door', 30, 16.2)
  onWall('door', 30, 17.6)
  onWall('door', 3, 20)
  for (const z of [4, 8.5, 13, 17.5]) onWall('window', 0, z)
  for (const z of [4, 8.5, 12.2]) onWall('window', 30, z)
  for (const x of [6, 15, 24]) onWall('window', x, 20)

  // ── environmental devices ──
  for (const x of [6, 12, 18, 24]) for (const z of [5.5, 10.5, 15.5]) at('ceilingFan', x, z, { name: 'Ceiling Fan' })
  const splits = [onWall('splitAC', 9, 0), onWall('splitAC', 21, 0), onWall('splitAC', 9, 20), onWall('splitAC', 21, 20)]
  const v1 = at('acVent', 15, 10.5, { name: 'AC Vent' })
  const v2 = at('acVent', 15, 16, { name: 'AC Vent' })
  // size the plant for a 600 m² hall: 4 × 7 kW wall units + 2 × 10 kW ceiling cassettes (nominal)
  const size = (o: SceneObject, capacityW: number) => {
    if (o.device?.type === 'ac') o.device = { ...o.device, capacityW, levels: acLevels(capacityW, o.device.cop) }
  }
  splits.forEach((s, i) => {
    s.name = `Split AC ${i + 1}`
    size(s, 7000)
  })
  size(v1, 10000)
  size(v2, 10000)
  for (let i = 0; i < 5; i++) {
    for (let j = 0; j < 4; j++) {
      const l = at('ceilingLight', 3 + i * 6, 3 + j * 5, { name: 'LED Panel' })
      if (l.device?.type === 'light') l.device = { ...l.device, lumens: 20000, powerW: 175, beamAngle: 130 }
    }
  }

  space.objects = objs
  const regions: FloorRegion[] = [
    { id: newId('reg'), name: 'Stage (wood)', x: 4, z: 0, w: 22, d: 4.2, material: { ...defaultFloor(), preset: 'wood', tileSize: 1.0, roughness: 0.5 } },
    { id: newId('reg'), name: 'Entrance (marble)', x: 26.8, z: 14, w: 3.2, d: 6, material: { ...defaultFloor(), preset: 'marble', tileSize: 1.2, roughness: 0.2 } },
  ]
  space.floorRegions = regions
  space.floor = { ...defaultFloor(), preset: 'ceramic', tileSize: 0.6 }

  // ── scenarios ──
  const states = captureStates(objs)
  const mk = (name: string, patch: Partial<Scenario>, count: number | 'all', seed: number): Scenario => {
    const sc: Scenario = { ...createScenario(name), ...states, sim: { ...DEFAULT_SIM }, ...patch }
    const occ: Occupant[] = generateOccupants(objs, { mode: 'fixed', fixed: count === 'all' ? 9999 : count, percentage: 100 }, mulberry32(seed), sc.sim.occupantHeatW)
    return { ...sc, occupants: occ, occupancy: { mode: 'fixed', fixed: occ.length, percentage: 60 } }
  }
  const main = mk('Afternoon Lecture (73 / 120)', { initialTempC: 32, outsideTempC: 36, targetTempC: 24, targetLux: 500, lighting: { preset: 'cloudy-afternoon', timeOfDay: 14, cloudCover: 0.4 } }, 73, 11)
  space.scenarios = [
    main,
    mk('Morning Lecture', { initialTempC: 29, outsideTempC: 31, targetTempC: 24, targetLux: 500, lighting: { preset: 'sunny-morning', timeOfDay: 9, cloudCover: 0.1 } }, 48, 21),
    mk('Full Occupancy', { initialTempC: 34, outsideTempC: 38, targetTempC: 24, targetLux: 500, lighting: { preset: 'cloudy-afternoon', timeOfDay: 15, cloudCover: 0.5 } }, 'all', 31),
    mk('Low Occupancy', { initialTempC: 31, outsideTempC: 35, targetTempC: 25, targetLux: 400, lighting: { preset: 'cloudy-afternoon', timeOfDay: 13, cloudCover: 0.3 } }, 18, 41),
    mk('Power Saving', { initialTempC: 33, outsideTempC: 36, targetTempC: 26, targetLux: 300, lighting: { preset: 'cloudy-afternoon', timeOfDay: 14, cloudCover: 0.4 } }, 60, 51),
    mk('Night Event', { initialTempC: 30, outsideTempC: 28, targetTempC: 24, targetLux: 400, lighting: { preset: 'night', timeOfDay: 21, cloudCover: 0.2 } }, 90, 61),
  ]
  space.activeScenarioId = main.id
  return space
}

export const DEMO_SPACE_ID = 'space_demo_seminar'
