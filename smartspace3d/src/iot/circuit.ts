import { ART_H, type ArtKind } from '@/components/iot/art'
import { wireClass, type WireClass } from './manifest'
import { PARTS } from './parts'
import type { HardwarePlan, Net } from './types'

/** Geometry of the schematic-style circuit view for one controller. Pure data: React draws it. */
export interface CPin { name: string; x: number; y: number; side: 'l' | 'r' }
export type CTone = 'board' | 'sensor' | 'actuator' | 'expander' | 'supply'
export interface CBox { id: string; title: string; subtitle?: string; x: number; y: number; w: number; h: number; tone: CTone; pins: CPin[]; art: ArtKind; artY: number; /** input = sensor, output = actuator */ io: 'input' | 'output' | 'neutral'; partId?: string }
export interface CWire { id: string; netId: string; kind: Net['kind']; cls: WireClass; label: string; /** owners (controller / part ids) on this net */ owners: string[]; hub: string; target: string; points: [number, number][] }
export interface CircuitLayout { boxes: CBox[]; wires: CWire[]; width: number; height: number; breadboard?: { x: number; y: number; w: number; h: number } }

const ROW = 18
const HEAD_BAR = 20
const COL_X = [20, 300, 570]
/** parts wrap into extra columns once a column is this tall */
const MAX_COL_H = 820
const BOX_W = 210

const RAIL_ORDER = ['3V3', '5V', 'GND']
const pinSort = (a: string, b: string) => {
  const ra = RAIL_ORDER.indexOf(a)
  const rb = RAIL_ORDER.indexOf(b)
  if (ra >= 0 || rb >= 0) return (ra < 0 ? 99 : ra) - (rb < 0 ? 99 : rb)
  return a.localeCompare(b, undefined, { numeric: true })
}

export function layoutCircuit(plan: HardwarePlan, controllerId: string): CircuitLayout {
  const ctrl = plan.controllers.find((c) => c.id === controllerId)
  if (!ctrl) return { boxes: [], wires: [], width: 400, height: 120 }
  const mine = plan.parts.filter((p) => p.controllerId === controllerId)
  const mineIds = new Set([controllerId, ...mine.map((p) => p.id), `psu-${controllerId}`])
  const nets = plan.nets.filter((n) => n.endpoints.some((e) => mineIds.has(e.owner)))

  // pins actually used per owner
  const used = new Map<string, Set<string>>()
  for (const n of nets) for (const e of n.endpoints) if (mineIds.has(e.owner)) (used.get(e.owner) ?? used.set(e.owner, new Set()).get(e.owner)!).add(e.pin)

  // column of each part: expanders in col 1, things driven by an expander in col 2, everything else col 1
  const viaExpander = new Set<string>()
  for (const p of mine) {
    const ch = plan.channels[p.id]
    if ((ch && ch.kind !== 'gpio') || p.mux) viaExpander.add(p.id)
  }
  const colOf = (id: string) => (id === controllerId ? 0 : viaExpander.has(id) ? 2 : 1)

  const boxes: CBox[] = []
  const colY = [20, 20, 20]
  /** extra columns (index ≥ 3) that tall rooms spill into */
  const colX = (c: number) => (c < COL_X.length ? COL_X[c] : COL_X[2] + (c - 2) * (BOX_W + 50))
  const add = (id: string, title: string, subtitle: string | undefined, tone: CTone, pinNames: string[], col: number, pinSide: (n: string) => 'l' | 'r', art: ArtKind, io: CBox['io'] = 'neutral') => {
    const HEAD = HEAD_BAR + ART_H[art] + 6
    const names = [...pinNames].sort(pinSort)
    const left = names.filter((n) => pinSide(n) === 'l')
    const right = names.filter((n) => pinSide(n) === 'r')
    const rows = Math.max(left.length, right.length, 1)
    const h = HEAD + rows * ROW + 8
    // wrap: a full column pushes the box into the next one
    while (col > 0 && (colY[col] ?? 20) > 20 && (colY[col] ?? 20) + h > MAX_COL_H) col++
    if (colY[col] == null) colY[col] = 20
    const x = colX(col)
    const y = colY[col]
    colY[col] += h + 22
    const pins: CPin[] = [
      ...left.map((n, i) => ({ name: n, x, y: y + HEAD + i * ROW + ROW / 2, side: 'l' as const })),
      ...right.map((n, i) => ({ name: n, x: x + BOX_W, y: y + HEAD + i * ROW + ROW / 2, side: 'r' as const })),
    ]
    boxes.push({ id, title, subtitle, x, y, w: BOX_W, h, tone, pins, art, artY: y + HEAD_BAR, io, partId: id })
  }

  add(controllerId, ctrl.label, plan.family === 'esp32' ? 'ESP32 DevKit' : plan.family === 'uno' ? 'Arduino Uno R3' : 'Raspberry Pi', 'board', [...(used.get(controllerId) ?? [])], 0, () => 'r', plan.family)
  for (const p of mine) {
    const spec = PARTS[p.type]
    if (p.type === 'dcMotor') {
      // the load and its MOSFET driver are two real components: GPIO → gate, supply + → motor, motor − → drain, source → GND
      const col = colOf(p.id)
      const base = `${p.virtual ? p.virtual.name : 'motor'}`
      add(`drv-${p.id}`, `${p.id} driver`, 'N-MOSFET + gate resistors + flyback diode', 'actuator', ['GATE', 'DRAIN', 'GND'], col, (n) => (n === 'GATE' ? 'l' : 'r'), 'mosfet', 'output')
      boxes[boxes.length - 1].partId = p.id
      add(p.id, p.id, `${spec.label} · ${base}`, 'actuator', ['+', '−'], col, () => 'l', 'dcMotor', 'output')
      continue
    }
    const outs = spec.category === 'expander' ? (n: string) => (/^(CH|A\d|SD|SC)/.test(n) && n !== 'SCL' ? 'r' : 'l') : () => 'l' as const
    const sub = p.virtual ? p.virtual.name : p.sensorId ? 'sensor' : undefined
    add(p.id, p.id, `${spec.label}${p.i2cAddr != null ? ` @0x${p.i2cAddr.toString(16)}` : ''}${sub ? ` · ${sub}` : ''}`, spec.category === 'expander' ? 'expander' : spec.category === 'actuator' ? 'actuator' : 'sensor', [...(used.get(p.id) ?? [])], colOf(p.id), outs, p.type, spec.category === 'actuator' ? 'output' : spec.category === 'sensor' ? 'input' : 'neutral')
  }
  const psu = plan.supplies.find((s) => s.controllerId === controllerId)
  if (psu) add(`psu-${controllerId}`, 'Motor supply', `${psu.volts} V DC ≥ ${psu.minAmps.toFixed(1)} A`, 'supply', [...(used.get(`psu-${controllerId}`) ?? ['V+', 'GND'])], 1, () => 'l', 'psu')

  const motorIds = new Set(mine.filter((p) => p.type === 'dcMotor').map((p) => p.id))
  /** which drawn box / pin a netlist endpoint lands on (a motor part is drawn as driver + motor) */
  const resolve = (owner: string, pin: string): [string, string] => {
    if (!motorIds.has(owner)) return [owner, pin]
    return pin === 'GATE' ? [`drv-${owner}`, 'GATE'] : pin === 'GND' ? [`drv-${owner}`, 'GND'] : [owner, '+']
  }
  const pinAt = (owner: string, name: string) => { const [b, pn] = resolve(owner, name); return boxes.find((x) => x.id === b)?.pins.find((q) => q.name === pn) }
  const wires: CWire[] = []
  nets.forEach((n, ni) => {
    const eps = n.endpoints.filter((e) => mineIds.has(e.owner) && pinAt(e.owner, e.pin))
    if (eps.length < 2) return
    const hub = eps.find((e) => e.owner === controllerId) ?? eps[0]
    const hp = pinAt(hub.owner, hub.pin)!
    eps.filter((e) => e !== hub).forEach((e, ei) => {
      const tp = pinAt(e.owner, e.pin)!
      const lane = (a: CPin, b: CPin) => {
        // vertical runs live in the gap right of the hub (or left of the target) with one lane per net
        const gapX = (hp.side === 'r' ? hp.x : hp.x) + (hp.side === 'r' ? 18 : -18) + (ni % 12) * 6 * (hp.side === 'r' ? 1 : -1)
        return [a, b, gapX] as const
      }
      const [a, b, gx] = lane(hp, tp)
      const pts: [number, number][] = [[a.x, a.y], [gx, a.y], [gx, b.y]]
      const tx = b.side === 'l' ? b.x - 10 : b.x + 10
      if (Math.abs(gx - tx) > 1) pts.push([tx, b.y])
      pts.push([b.x, b.y])
      wires.push({ id: `${n.id}#${ei}`, netId: n.id, kind: n.kind, cls: wireClass(n, plan.parts), label: n.label, owners: [...new Set(n.endpoints.map((x) => x.owner))], hub: hub.owner, target: e.owner, points: pts })
    })
  })
  for (const id of motorIds) {
    const a = boxes.find((b) => b.id === `drv-${id}`)?.pins.find((q) => q.name === 'DRAIN')
    const m = boxes.find((b) => b.id === id)?.pins.find((q) => q.name === '−')
    if (!a || !m) continue
    const gx = a.x + 14
    wires.push({ id: `load:${id}`, netId: `load:${id}`, kind: 'ext-power', cls: 'motor-power', label: `${id} motor − to driver drain`, owners: [id], hub: `drv-${id}`, target: id, points: [[a.x, a.y], [gx, a.y], [gx, m.y], [m.x - 10, m.y], [m.x, m.y]] })
  }
  const width = colX(colY.length - 1) + BOX_W + 30
  const height = Math.max(...colY.filter((v) => v != null)) + 10
  const side = boxes.filter((b) => b.id !== controllerId)
  const breadboard = side.length ? { x: Math.min(...side.map((b) => b.x)) - 14, y: 6, w: Math.max(...side.map((b) => b.x + b.w)) - Math.min(...side.map((b) => b.x)) + 28, h: height - 6 } : undefined
  return { boxes, wires, width, height, breadboard }
}

export const NET_COLOUR: Record<Net['kind'], string> = {
  power: '#dc2626',
  ground: '#374151',
  signal: '#16a34a',
  i2c: '#2563eb',
  'ext-power': '#ea580c',
}
