import { allSeatSlots } from '@/simulation/occupancy'
import type { HardwareConfig, SceneObject, SensorPoint, Space, Vec3 } from '@/types'
import { newId } from '@/utils/math'

export interface RoomDevice {
  obj: SceneObject
  kind: 'fan' | 'ac' | 'light'
  /** stable hardware id: fan01, ac02, light07 … (numbered in layout order) */
  hwId: string
}

/** Fans, AC units and lights of the room, minus those excluded from the prototype. */
export function roomDevices(space: Space, cfg?: Pick<HardwareConfig, 'excludedDeviceIds'>): RoomDevice[] {
  const ex = new Set(cfg?.excludedDeviceIds ?? [])
  const n = { fan: 0, ac: 0, light: 0 }
  const out: RoomDevice[] = []
  for (const o of space.objects) {
    const t = o.device?.type
    if (!t || ex.has(o.id)) continue
    n[t]++
    out.push({ obj: o, kind: t, hwId: `${t}${String(n[t]).padStart(2, '0')}` })
  }
  return out
}

export const allRoomDevices = (space: Space) => roomDevices(space)

const dist2 = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1])
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/** Deterministic k-means (farthest-point seeding) over floor points. */
export function cluster(points: [number, number][], k: number): [number, number][] {
  if (points.length === 0) return []
  k = Math.min(k, points.length)
  const centres: [number, number][] = [points[0]]
  while (centres.length < k) {
    let best = points[0]
    let bd = -1
    for (const p of points) {
      const d = Math.min(...centres.map((c) => dist2(c, p)))
      if (d > bd) { bd = d; best = p }
    }
    centres.push(best)
  }
  for (let it = 0; it < 12; it++) {
    const sums = centres.map(() => ({ x: 0, z: 0, n: 0 }))
    for (const p of points) {
      let bi = 0
      let bd = Infinity
      centres.forEach((c, i) => { const d = dist2(c, p); if (d < bd) { bd = d; bi = i } })
      sums[bi].x += p[0]; sums[bi].z += p[1]; sums[bi].n++
    }
    sums.forEach((s, i) => { if (s.n) centres[i] = [s.x / s.n, s.z / s.n] })
  }
  return centres.sort((a, b) => a[0] - b[0] || a[1] - b[1])
}

export const ZONE_LABELS = 'ABCDEFGH'

/** Height of a temperature sensor: seated breathing zone. */
export const TEMP_HEIGHT = 1.2
/** Height of a light sensor: desk / working plane. */
export const LUX_HEIGHT = 0.8
/** A temperature sensor must stay this far (m) from AC units so it measures the room, not the supply air. */
export const AC_CLEARANCE = 2.0

/** Push (x, z) away from every AC unit until it is `AC_CLEARANCE` metres from each (best effort, inside the room). */
function awayFromAc(x: number, z: number, acs: [number, number][], L: number, W: number): [number, number] {
  let p: [number, number] = [x, z]
  for (let iter = 0; iter < 8; iter++) {
    let moved = false
    for (const a of acs) {
      const d = dist2(p, a)
      if (d < AC_CLEARANCE) {
        const dir: [number, number] = d < 1e-6 ? [0, 1] : [(p[0] - a[0]) / d, (p[1] - a[1]) / d]
        p = [clamp(a[0] + dir[0] * AC_CLEARANCE, 0.4, L - 0.4), clamp(a[1] + dir[1] * AC_CLEARANCE, 0.4, W - 0.4)]
        moved = true
      }
    }
    if (!moved) break
  }
  return p
}

/**
 * Propose measurement points: one zone per cluster of seats. Temperature at breathing height, away
 * from AC outlets; light at the working plane, linked to (but not co-located with) nearby fixtures.
 */
export function proposeSensors(space: Space, cfg: Pick<HardwareConfig, 'excludedDeviceIds' | 'includePresence'> & { zoneCount?: number }): SensorPoint[] {
  const { length: L, width: W, height: H } = space.dims
  const devs = roomDevices(space, cfg)
  const acs = devs.filter((d) => d.kind === 'ac').map((d) => [d.obj.position[0], d.obj.position[2]] as [number, number])
  const fans = devs.filter((d) => d.kind === 'fan')
  const lights = devs.filter((d) => d.kind === 'light')
  let pts = allSeatSlots(space.objects).map((s) => [s.position[0], s.position[2]] as [number, number])
  if (pts.length === 0) pts = [[L * 0.25, W * 0.25], [L * 0.75, W * 0.25], [L * 0.25, W * 0.75], [L * 0.75, W * 0.75]]
  const wanted = cfg.zoneCount ?? Math.max(acs.length, Math.ceil(fans.length / 3), 1)
  const k = clamp(wanted, 1, Math.min(ZONE_LABELS.length, pts.length))
  const centres = cluster(pts, k)
  const out: SensorPoint[] = []
  centres.forEach((c, i) => {
    const label = ZONE_LABELS[i]
    const [tx, tz] = awayFromAc(c[0], c[1], acs, L, W)
    out.push({ id: newId('sp'), name: `Temperature ${label}`, kind: 'temperature', position: [round(tx), TEMP_HEIGHT, round(tz)], fixtureIds: [], auto: true, zone: label })
    const near = lights
      .map((d) => ({ id: d.obj.id, d: dist2([d.obj.position[0], d.obj.position[2]], c) }))
      .filter((x) => x.d <= 8)
      .sort((a, b) => a.d - b.d)
      .slice(0, 4)
      .map((x) => x.id)
    out.push({ id: newId('sp'), name: `Light ${label}`, kind: 'light', position: [round(c[0]), LUX_HEIGHT, round(c[1])], fixtureIds: near, auto: true, zone: label })
    if (cfg.includePresence) out.push({ id: newId('sp'), name: `Presence ${label}`, kind: 'presence', position: [round(c[0]), Math.max(1.8, H - 0.5), round(c[1])], fixtureIds: [], auto: true, zone: label })
  })
  return out
}

const round = (v: number) => Math.round(v * 100) / 100

export function defaultHardware(space: Space): HardwareConfig {
  const base = { includePresence: false, excludedDeviceIds: [] as string[] }
  return {
    controller: 'esp32',
    tempPart: 'dht22',
    lightPart: 'bh1750',
    includePresence: false,
    acOutput: 'led',
    sensors: proposeSensors(space, base),
    runMode: 'simulation',
    mqttTopicRoot: 'smartspace',
    excludedDeviceIds: [],
    pinOverrides: {},
    motorSupplyV: 5,
    scaling: 'nodes',
  }
}

export interface ZoneLink {
  zone: string
  temperature?: SensorPoint
  light?: SensorPoint
  presence?: SensorPoint
  fans: RoomDevice[]
  acs: RoomDevice[]
  lights: RoomDevice[]
}

/** Zone → sensors → devices table ("Zone A → Temperature A → Light A → Fan A → AC A"). */
export function zoneLinks(space: Space, cfg: HardwareConfig): ZoneLink[] {
  const devs = roomDevices(space, cfg)
  const zones = [...new Set(cfg.sensors.map((s) => s.zone ?? s.name))]
  const centre = (z: string): [number, number] => {
    const s = cfg.sensors.find((x) => (x.zone ?? x.name) === z && x.kind === 'light') ?? cfg.sensors.find((x) => (x.zone ?? x.name) === z)!
    return [s.position[0], s.position[2]]
  }
  const nearest = (kind: RoomDevice['kind'], n: number, z: string) =>
    devs.filter((d) => d.kind === kind).map((d) => ({ d, dist: dist2([d.obj.position[0], d.obj.position[2]], centre(z)) })).sort((a, b) => a.dist - b.dist).slice(0, n).map((x) => x.d)
  return zones.map((z) => ({
    zone: z,
    temperature: cfg.sensors.find((s) => (s.zone ?? s.name) === z && s.kind === 'temperature'),
    light: cfg.sensors.find((s) => (s.zone ?? s.name) === z && s.kind === 'light'),
    presence: cfg.sensors.find((s) => (s.zone ?? s.name) === z && s.kind === 'presence'),
    fans: nearest('fan', 2, z),
    acs: nearest('ac', 1, z),
    lights: devs.filter((d) => d.kind === 'light' && (cfg.sensors.find((s) => (s.zone ?? s.name) === z && s.kind === 'light')?.fixtureIds ?? []).includes(d.obj.id)),
  }))
}

export type { Vec3 }
