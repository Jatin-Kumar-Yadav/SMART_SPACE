import type {
  AcDevice,
  AirLevel,
  DeviceConfig,
  FanDevice,
  LightDevice,
  MountType,
  ObjectCategory,
  ObjectKind,
  SceneObject,
  Space,
  Vec3,
} from '@/types'
import { newId } from '@/utils/math'

export type CollisionClass = 'solid' | 'seat' | 'table' | 'flat' | 'wall' | 'overhead'

export interface CatalogEntry {
  kind: ObjectKind
  label: string
  category: ObjectCategory
  mount: MountType
  /** default [w, h, d] in metres */
  dims: Vec3
  /** default base elevation for wall mounted items (sill / mounting height) */
  elevation?: number
  collision: CollisionClass
  color?: string
  /** default seat metrics */
  seat?: { perMeter?: number; fixed?: number; default?: boolean }
  /** tag used for search */
  tags: string[]
  /** does this attach to a wall (door / window / split AC / wall fan)? */
  wallMounted?: boolean
  /** does it cut an opening in the wall? */
  opening?: boolean
}

export const CATALOG: Record<ObjectKind, CatalogEntry> = {
  chair: { kind: 'chair', label: 'Chair', category: 'furniture', mount: 'floor', dims: [0.46, 0.9, 0.48], collision: 'seat', color: '#8a5a3b', seat: { fixed: 1, default: true }, tags: ['seat', 'dining'] },
  officeChair: { kind: 'officeChair', label: 'Office Chair', category: 'furniture', mount: 'floor', dims: [0.6, 1.05, 0.6], collision: 'seat', color: '#2f3640', seat: { fixed: 1, default: true }, tags: ['seat', 'work'] },
  bench: { kind: 'bench', label: 'Classroom Bench', category: 'furniture', mount: 'floor', dims: [1.8, 0.46, 0.42], collision: 'solid', color: '#a9744f', seat: { perMeter: 1 / 0.55, default: true }, tags: ['seat', 'class'] },
  desk: { kind: 'desk', label: 'Desk', category: 'furniture', mount: 'floor', dims: [1.4, 0.75, 0.7], collision: 'table', color: '#b88a5a', tags: ['table', 'work'] },
  diningTable: { kind: 'diningTable', label: 'Dining Table', category: 'furniture', mount: 'floor', dims: [1.8, 0.76, 0.95], collision: 'table', color: '#5a2d1f', tags: ['table', 'dining'] },
  coffeeTable: { kind: 'coffeeTable', label: 'Coffee Table', category: 'furniture', mount: 'floor', dims: [1.0, 0.42, 0.6], collision: 'table', color: '#f1f1f1', tags: ['table', 'lounge'] },
  sofa: { kind: 'sofa', label: 'Sofa', category: 'furniture', mount: 'floor', dims: [2.0, 0.85, 0.9], collision: 'solid', color: '#5b5f66', seat: { perMeter: 1 / 0.65, default: true }, tags: ['seat', 'lounge'] },
  bed: { kind: 'bed', label: 'Bed', category: 'furniture', mount: 'floor', dims: [1.6, 0.65, 2.05], collision: 'solid', color: '#5b8fb9', seat: { fixed: 2, default: false }, tags: ['sleep', 'bedroom'] },
  cabinet: { kind: 'cabinet', label: 'Cabinet', category: 'furniture', mount: 'floor', dims: [1.0, 0.9, 0.45], collision: 'solid', color: '#7a4a2e', tags: ['storage'] },
  wardrobe: { kind: 'wardrobe', label: 'Wardrobe', category: 'furniture', mount: 'floor', dims: [1.3, 2.1, 0.6], collision: 'solid', color: '#8a5230', tags: ['storage', 'bedroom'] },
  bookshelf: { kind: 'bookshelf', label: 'Bookshelf', category: 'furniture', mount: 'floor', dims: [0.9, 1.85, 0.32], collision: 'solid', color: '#6d3f26', tags: ['storage', 'books'] },
  podium: { kind: 'podium', label: 'Podium', category: 'furniture', mount: 'floor', dims: [0.65, 1.1, 0.5], collision: 'solid', color: '#4a3426', tags: ['stage', 'speaker'] },
  plant: { kind: 'plant', label: 'Plant', category: 'furniture', mount: 'floor', dims: [0.55, 1.2, 0.55], collision: 'solid', color: '#2f7d3a', tags: ['decor', 'green'] },
  carpet: { kind: 'carpet', label: 'Carpet', category: 'furniture', mount: 'floor', dims: [2.4, 0.02, 1.7], collision: 'flat', color: '#6b7a99', tags: ['rug', 'decor'] },

  door: { kind: 'door', label: 'Door', category: 'architecture', mount: 'wall', dims: [0.95, 2.1, 0.2], elevation: 0, collision: 'wall', color: '#7a4a2e', wallMounted: true, opening: true, tags: ['entrance'] },
  window: { kind: 'window', label: 'Window', category: 'architecture', mount: 'wall', dims: [1.6, 1.3, 0.2], elevation: 0.9, collision: 'wall', color: '#9fd3ff', wallMounted: true, opening: true, tags: ['glass', 'daylight'] },
  column: { kind: 'column', label: 'Column', category: 'architecture', mount: 'floor', dims: [0.4, 3.0, 0.4], collision: 'solid', color: '#e9e6df', tags: ['pillar'] },

  ceilingFan: { kind: 'ceilingFan', label: 'Ceiling Fan', category: 'device', mount: 'ceiling', dims: [1.2, 0.4, 1.2], collision: 'overhead', color: '#e8e8e8', tags: ['fan', 'cooling'] },
  wallFan: { kind: 'wallFan', label: 'Wall Fan', category: 'device', mount: 'wall', dims: [0.5, 0.55, 0.3], elevation: 2.0, collision: 'overhead', color: '#dcdcdc', wallMounted: true, tags: ['fan', 'cooling'] },
  splitAC: { kind: 'splitAC', label: 'Split AC', category: 'device', mount: 'wall', dims: [0.95, 0.3, 0.22], elevation: 2.25, collision: 'overhead', color: '#f4f6f8', wallMounted: true, tags: ['ac', 'cooling'] },
  acVent: { kind: 'acVent', label: 'AC Vent', category: 'device', mount: 'ceiling', dims: [0.6, 0.12, 0.6], collision: 'overhead', color: '#f4f6f8', tags: ['ac', 'diffuser'] },
  ceilingLight: { kind: 'ceilingLight', label: 'Ceiling Light', category: 'device', mount: 'ceiling', dims: [0.55, 0.09, 0.55], collision: 'overhead', color: '#fff8e1', tags: ['light', 'panel'] },
  bulb: { kind: 'bulb', label: 'Bulb', category: 'device', mount: 'ceiling', dims: [0.14, 0.35, 0.14], collision: 'overhead', color: '#ffe9a8', tags: ['light', 'pendant'] },
  tubeLight: { kind: 'tubeLight', label: 'Tube Light', category: 'device', mount: 'ceiling', dims: [1.2, 0.07, 0.12], collision: 'overhead', color: '#ffffff', tags: ['light', 'tube'] },
  lamp: { kind: 'lamp', label: 'Floor Lamp', category: 'device', mount: 'floor', dims: [0.36, 1.55, 0.36], collision: 'solid', color: '#f3e3b0', tags: ['light', 'lamp'] },
}

export const CATALOG_LIST = Object.values(CATALOG)

export const isDeviceKind = (k: ObjectKind) => CATALOG[k].category === 'device'

// ───────────────────────── device defaults ─────────────────────────

const fanLevels = (scale = 1): AirLevel[] => [
  { label: 'OFF', radius: 0, length: 0, width: 0, effectC: 0, coolingFrac: 0, airflow: 0, powerW: 0 },
  { label: 'Level 1', radius: 2.5 * scale, length: 0, width: 0, effectC: 2, coolingFrac: 0, airflow: 0.25, powerW: 25 },
  { label: 'Level 2', radius: 4 * scale, length: 0, width: 0, effectC: 4, coolingFrac: 0, airflow: 0.5, powerW: 45 },
  { label: 'Level 3', radius: 5 * scale, length: 0, width: 0, effectC: 6, coolingFrac: 0, airflow: 0.8, powerW: 75 },
]

export const defaultFan = (kind: 'ceilingFan' | 'wallFan'): FanDevice => ({
  type: 'fan',
  mode: 'auto',
  level: 1,
  levels: fanLevels(kind === 'wallFan' ? 0.7 : 1),
})

/** Cooling is delivered as a fraction of nominal capacity per level. */
export const acLevels = (capacityW: number, cop: number): AirLevel[] => {
  const mk = (label: string, frac: number, radius: number, length: number, width: number, effectC: number, airflow: number): AirLevel => ({
    label,
    radius,
    length,
    width,
    effectC,
    coolingFrac: frac,
    airflow,
    powerW: Math.round((capacityW * frac) / cop),
  })
  return [
    { label: 'OFF', radius: 0, length: 0, width: 0, effectC: 0, coolingFrac: 0, airflow: 0, powerW: 0 },
    mk('Level 1', 0.35, 3, 4, 2.4, 1.5, 0.15),
    mk('Level 2', 0.65, 4, 6, 3.2, 3, 0.25),
    mk('Level 3', 1.0, 5, 8, 4, 4.5, 0.35),
  ]
}

/** The profile from the product brief: positions −2…4 with strengths 0…3…0. */
export const DEFAULT_AC_PROFILE = [
  { x: -2, v: 0 },
  { x: -1, v: 1.5 },
  { x: 0, v: 3 },
  { x: 1, v: 2.5 },
  { x: 2, v: 2 },
  { x: 3, v: 1 },
  { x: 4, v: 0 },
]

export const defaultAc = (kind: 'splitAC' | 'acVent'): AcDevice => {
  const capacityW = kind === 'splitAC' ? 3500 : 5000
  const cop = 3.2
  return {
    type: 'ac',
    mode: 'auto',
    level: 2,
    levels: acLevels(capacityW, cop),
    shape: kind === 'splitAC' ? 'directional' : 'circle',
    profile: DEFAULT_AC_PROFILE.map((p) => ({ ...p })),
    capacityW,
    supplyTempC: 12,
    cop,
  }
}

export const defaultLight = (kind: 'ceilingLight' | 'bulb' | 'tubeLight' | 'lamp'): LightDevice => {
  switch (kind) {
    case 'bulb':
      return { type: 'light', mode: 'auto', on: true, dimming: 1, lumens: 900, powerW: 10, beamAngle: 360 }
    case 'tubeLight':
      return { type: 'light', mode: 'auto', on: true, dimming: 1, lumens: 3200, powerW: 36, beamAngle: 140 }
    case 'lamp':
      return { type: 'light', mode: 'manual', on: false, dimming: 1, lumens: 600, powerW: 8, beamAngle: 200 }
    default:
      return { type: 'light', mode: 'auto', on: true, dimming: 1, lumens: 2400, powerW: 24, beamAngle: 120 }
  }
}

export function defaultDevice(kind: ObjectKind): DeviceConfig | undefined {
  switch (kind) {
    case 'ceilingFan':
    case 'wallFan':
      return defaultFan(kind)
    case 'splitAC':
    case 'acVent':
      return defaultAc(kind)
    case 'ceilingLight':
    case 'bulb':
    case 'tubeLight':
    case 'lamp':
      return defaultLight(kind)
    default:
      return undefined
  }
}

// ───────────────────────── factory ─────────────────────────

/** Create a new scene object of `kind` at (x, z); ceiling items snap to the ceiling. */
export function createObject(kind: ObjectKind, x: number, z: number, space: Pick<Space, 'dims'>): SceneObject {
  const entry = CATALOG[kind]
  const dims: Vec3 = [...entry.dims]
  if (kind === 'column') dims[1] = space.dims.height
  let y = entry.elevation ?? 0
  if (entry.mount === 'ceiling') y = space.dims.height - dims[1]
  const obj: SceneObject = {
    id: newId('obj'),
    kind,
    name: entry.label,
    position: [x, y, z],
    rotationY: 0,
    dims,
    color: entry.color,
    locked: false,
    visible: true,
  }
  if (entry.seat) obj.seatable = entry.seat.default ?? true
  if (kind === 'window') obj.window = { open: false, transmittance: 0.7, shading: 0, shgc: 0.55 }
  const device = defaultDevice(kind)
  if (device) obj.device = device
  return obj
}
