import { PARTS } from './parts'
import type { HardwarePlan, Net } from './types'

/** Geometry of the schematic-style circuit view for one controller. Pure data: React draws it. */
export interface CPin { name: string; x: number; y: number; side: 'l' | 'r' }
export type CTone = 'board' | 'sensor' | 'actuator' | 'expander' | 'supply'
export interface CBox { id: string; title: string; subtitle?: string; x: number; y: number; w: number; h: number; tone: CTone; pins: CPin[] }
export interface CWire { id: string; netId: string; kind: Net['kind']; label: string; points: [number, number][] }
export interface CircuitLayout { boxes: CBox[]; wires: CWire[]; width: number; height: number }

const ROW = 18
const HEAD = 34
const COL_X = [20, 330, 640]
/** parts wrap into extra columns once a column is this tall */
const MAX_COL_H = 620
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
  const colX = (c: number) => (c < COL_X.length ? COL_X[c] : COL_X[2] + (c - 2) * (BOX_W + 60))
  const add = (id: string, title: string, subtitle: string | undefined, tone: CTone, pinNames: string[], col: number, pinSide: (n: string) => 'l' | 'r') => {
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
    boxes.push({ id, title, subtitle, x, y, w: BOX_W, h, tone, pins })
  }

  add(controllerId, ctrl.label, 'ESP32 DevKit', 'board', [...(used.get(controllerId) ?? [])], 0, () => 'r')
  for (const p of mine) {
    const spec = PARTS[p.type]
    const outs = spec.category === 'expander' ? (n: string) => (/^(CH|A\d|SD|SC)/.test(n) && n !== 'SCL' ? 'r' : 'l') : () => 'l' as const
    const sub = p.virtual ? p.virtual.name : p.sensorId ? 'sensor' : undefined
    add(p.id, p.id, `${spec.label}${p.i2cAddr != null ? ` @0x${p.i2cAddr.toString(16)}` : ''}${sub ? ` · ${sub}` : ''}`, spec.category === 'expander' ? 'expander' : spec.category === 'actuator' ? 'actuator' : 'sensor', [...(used.get(p.id) ?? [])], colOf(p.id), outs)
  }
  const psu = plan.supplies.find((s) => s.controllerId === controllerId)
  if (psu) add(`psu-${controllerId}`, 'Motor supply', `${psu.volts} V DC ≥ ${psu.minAmps.toFixed(1)} A`, 'supply', [...(used.get(`psu-${controllerId}`) ?? ['V+', 'GND'])], 1, () => 'l')

  const pinAt = (owner: string, name: string) => boxes.find((b) => b.id === owner)?.pins.find((p) => p.name === name)
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
      wires.push({ id: `${n.id}#${ei}`, netId: n.id, kind: n.kind, label: n.label, points: pts })
    })
  })
  const width = colX(colY.length - 1) + BOX_W + 30
  const height = Math.max(...colY.filter((v) => v != null)) + 10
  return { boxes, wires, width, height }
}

export const NET_COLOUR: Record<Net['kind'], string> = {
  power: '#dc2626',
  ground: '#374151',
  signal: '#16a34a',
  i2c: '#2563eb',
  'ext-power': '#ea580c',
}

/** Normalized part dimensions for diagram rendering */
export function getPartDims(type: string): { w: number; h: number } {
  switch (type) {
    case 'board-esp32-devkit-c-v4':
    case 'wokwi-esp32-devkit-v1':
      return { w: 108, h: 236 }
    case 'wokwi-dht22':
      return { w: 44, h: 62 }
    case 'wokwi-photoresistor-sensor':
      return { w: 52, h: 70 }
    case 'wokwi-pir-motion-sensor':
      return { w: 50, h: 54 }
    case 'wokwi-ds18b20':
      return { w: 28, h: 40 }
    case 'wokwi-resistor':
      return { w: 50, h: 16 }
    case 'wokwi-led':
      return { w: 22, h: 34 }
    case 'wokwi-servo':
      return { w: 90, h: 56 }
    default:
      return { w: 60, h: 40 }
  }
}

/** Normalized relative pin offsets (x, y) within a component */
export function getPinOffset(type: string, pin: string): { x: number; y: number; side?: 'l' | 'r' | 't' | 'b' } {
  const norm = pin.replace(/^GPIO/i, '').replace(/[.:].*$/, '') // e.g. "GND.1" -> "GND", "GPIO14" -> "14"

  if (type === 'board-esp32-devkit-c-v4' || type === 'wokwi-esp32-devkit-v1') {
    const leftPins: Record<string, number> = {
      '3V3': 24, '3v3': 24, 'EN': 34, 'en': 34, '36': 44, 'VP': 44, '39': 54, 'VN': 54,
      '34': 64, '35': 74, '32': 84, '33': 94, '25': 104, '26': 114, '27': 124, '14': 134,
      '12': 144, 'GND': 154, 'GND.1': 154, 'gnd': 154, '13': 164, '9': 174, '10': 184,
      '11': 194, '5V': 204, '5v': 204, 'VIN': 204,
    }
    const rightPins: Record<string, number> = {
      'GND.2': 24, '23': 34, '22': 44, '1': 54, 'TX': 54, '3': 64, 'RX': 64, '21': 74,
      'GND.3': 84, '19': 94, '18': 104, '5': 114, '17': 124, '16': 134, '4': 144, '0': 154,
      '2': 164, '15': 174, '8': 184, '7': 194, '6': 204,
    }

    if (pin in leftPins || norm in leftPins) return { x: 4, y: leftPins[pin] ?? leftPins[norm], side: 'l' }
    if (pin in rightPins || norm in rightPins) return { x: 104, y: rightPins[pin] ?? rightPins[norm], side: 'r' }
    if (norm === 'GND' || pin.startsWith('GND')) return { x: 4, y: 154, side: 'l' }
    return { x: 104, y: 144, side: 'r' }
  }

  if (type === 'wokwi-dht22') {
    switch (pin) {
      case 'VCC': case 'vcc': case '1': return { x: 8, y: 60, side: 'b' }
      case 'SDA': case 'sda': case 'DATA': case 'data': case '2': return { x: 18, y: 60, side: 'b' }
      case 'NC': case 'nc': case '3': return { x: 28, y: 60, side: 'b' }
      case 'GND': case 'gnd': case '4': return { x: 38, y: 60, side: 'b' }
      default: return { x: 18, y: 60, side: 'b' }
    }
  }

  if (type === 'wokwi-photoresistor-sensor') {
    switch (pin) {
      case 'VCC': case 'vcc': return { x: 52, y: 16, side: 'r' }
      case 'GND': case 'gnd': return { x: 52, y: 28, side: 'r' }
      case 'DO': case 'do': return { x: 52, y: 40, side: 'r' }
      case 'AO': case 'ao': case 'SIG': case 'sig': return { x: 52, y: 52, side: 'r' }
      default: return { x: 52, y: 52, side: 'r' }
    }
  }

  if (type === 'wokwi-pir-motion-sensor') {
    switch (pin) {
      case 'VCC': case 'vcc': return { x: 12, y: 52, side: 'b' }
      case 'OUT': case 'out': case 'SIG': case 'sig': return { x: 25, y: 52, side: 'b' }
      case 'GND': case 'gnd': return { x: 38, y: 52, side: 'b' }
      default: return { x: 25, y: 52, side: 'b' }
    }
  }

  if (type === 'wokwi-ds18b20') {
    switch (pin) {
      case 'VCC': case 'vcc': return { x: 6, y: 38, side: 'b' }
      case 'DQ': case 'dq': case 'DATA': return { x: 15, y: 38, side: 'b' }
      case 'GND': case 'gnd': return { x: 24, y: 38, side: 'b' }
      default: return { x: 15, y: 38, side: 'b' }
    }
  }

  if (type === 'wokwi-resistor') {
    if (pin === '1') return { x: 0, y: 8, side: 'l' }
    if (pin === '2') return { x: 50, y: 8, side: 'r' }
    return { x: 0, y: 8, side: 'l' }
  }

  if (type === 'wokwi-led') {
    if (pin === 'A' || pin === 'a' || pin === 'ANODE') return { x: 7, y: 32, side: 'b' }
    if (pin === 'C' || pin === 'c' || pin === 'CATHODE') return { x: 15, y: 32, side: 'b' }
    return { x: 7, y: 32, side: 'b' }
  }

  if (type === 'wokwi-servo') {
    switch (pin) {
      case 'PWM': case 'pwm': case 'SIG': case 'sig': case '1': return { x: 0, y: 16, side: 'l' }
      case 'V+': case 'v+': case 'VCC': case 'vcc': case '5V': case '5v': case '2': return { x: 0, y: 28, side: 'l' }
      case 'GND': case 'gnd': case '3': return { x: 0, y: 40, side: 'l' }
      default: return { x: 0, y: 16, side: 'l' }
    }
  }

  return { x: 30, y: 20 }
}

