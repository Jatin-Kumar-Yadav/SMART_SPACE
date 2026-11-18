import { createScenario, DEFAULT_SIM } from '@/simulation/scenario'
import { defaultFloor, perimeterWalls } from '@/objects/spaceFactory'
import { SCHEMA_VERSION, type Scenario, type Space } from '@/types'

function restoreCameraOwnership(sc: Partial<Scenario>, fallback: Scenario['occupancySource']): Pick<Scenario, 'occupancySource' | 'occupants' | 'stashedOccupants'> {
  const source = sc.occupancySource ?? fallback
  if (source === 'camera' && sc.stashedOccupants) {
    return { occupancySource: 'random', occupants: sc.stashedOccupants, stashedOccupants: undefined }
  }
  return { occupancySource: source === 'camera' ? 'random' : source, occupants: sc.occupants ?? [], stashedOccupants: sc.stashedOccupants }
}

/**
 * Bring any stored / imported space up to the current schema.
 * Missing fields are filled with safe defaults so older projects keep opening.
 */
export function migrateSpace(raw: unknown): Space {
  if (!raw || typeof raw !== 'object') throw new Error('Not a SmartSpace project')
  const s = raw as Partial<Space> & Record<string, unknown>
  if (!s.id || !s.name || !s.dims) throw new Error('Project is missing id, name or dimensions')
  const version = typeof s.schemaVersion === 'number' ? s.schemaVersion : 1
  if (version > SCHEMA_VERSION) throw new Error(`Project was saved by a newer version (schema ${version}).`)

  const scenarios: Scenario[] = (s.scenarios?.length ? s.scenarios : [createScenario('Default scenario')]).map((sc) => {
    const base = createScenario(sc.name)
    return {
      ...base,
      ...sc,
      occupancy: { ...base.occupancy, ...(sc.occupancy ?? {}) },
      lighting: { ...base.lighting, ...(sc.lighting ?? {}) },
      sim: { ...DEFAULT_SIM, ...(sc.sim ?? {}) },
      deviceStates: sc.deviceStates ?? {},
      windowStates: sc.windowStates ?? {},
      // schema 3: a camera-owned occupant list cannot survive a reload (the stream is gone),
      // so restore the stashed random / manual occupants instead of keeping stale camera data
      ...restoreCameraOwnership(sc, base.occupancySource),
    }
  })

  return {
    ...(s as Space),
    schemaVersion: SCHEMA_VERSION,
    unit: s.unit ?? 'm',
    floor: { ...defaultFloor(), ...(s.floor ?? {}) },
    floorRegions: s.floorRegions ?? [],
    walls: s.walls?.length ? s.walls : perimeterWalls(s.dims),
    objects: s.objects ?? [],
    scenarios,
    cameras: s.cameras ?? [],
    hardware: s.hardware,
    activeScenarioId: scenarios.some((x) => x.id === s.activeScenarioId) ? (s.activeScenarioId as string) : scenarios[0].id,
    createdAt: s.createdAt ?? Date.now(),
    updatedAt: s.updatedAt ?? Date.now(),
  }
}
