import type { HardwareConfig, Space } from '@/types'
import { BOARDS, pinOf, pinPreference, pinSupports } from './boards'
import { ledResistor, PARTS } from './parts'
import { proposeSensors, roomDevices, type RoomDevice } from './requirements'
import type { BomLine, Channel, Controller, ExternalSupply, HardwarePlan, Issue, MapRow, Net, PartType, PinFunction, PinUse, PlanPart, Requirement } from './types'
import { validatePlan } from './validate'

const MAX_CONTROLLERS = 8
const FAMILY_NAME = { esp32: 'ESP32', uno: 'Arduino Uno', rpi: 'Raspberry Pi' } as const
const LABEL = (n: number) => String.fromCharCode(97 + n) // a, b, c …

/** Which controller rail powers a part's VCC. */
export function railFor(type: PartType, logicV: 3.3 | 5): '3V3' | '5V' {
  if (type === 'pir') return '5V'
  if (type === 'bme280') return '3V3'
  return logicV === 3.3 ? '3V3' : '5V'
}

// ───────────────────────── 1. virtual room → parts and requirements ─────────────────────────

interface Draft {
  parts: PlanPart[]
  reqs: Requirement[]
  hwIdByObject: Record<string, string>
  devices: RoomDevice[]
}

const needOf = (t: PartType): Requirement['need'] =>
  t === 'dht22' ? 'digital-io' : t === 'pir' ? 'digital-in' : t === 'ds18b20' ? 'onewire' : t === 'ldr' ? 'adc' : t === 'bh1750' || t === 'bme280' ? 'i2c' : 'pwm'

export function draftParts(space: Space, cfg: HardwareConfig): Draft {
  const devices = roomDevices(space, cfg)
  const sensors = cfg.sensors
  const zones = [...new Set(sensors.map((s) => s.zone ?? s.name))]
  const zoneCentre = zones.map((z) => {
    const s = sensors.find((x) => (x.zone ?? x.name) === z && x.kind === 'light') ?? sensors.find((x) => (x.zone ?? x.name) === z)!
    return [s.position[0], s.position[2]] as [number, number]
  })
  const groupOf = (x: number, z: number) => {
    let bi = 0
    let bd = Infinity
    zoneCentre.forEach((c, i) => { const d = Math.hypot(c[0] - x, c[1] - z); if (d < bd) { bd = d; bi = i } })
    return zoneCentre.length ? bi : 0
  }
  const parts: PlanPart[] = []
  const reqs: Requirement[] = []
  const hwIdByObject: Record<string, string> = {}
  const add = (part: PlanPart, group: number) => {
    parts.push(part)
    reqs.push({ part, need: needOf(part.type), group })
  }
  const motorV = cfg.motorSupplyV ?? 5
  for (const d of devices) {
    const g = groupOf(d.obj.position[0], d.obj.position[2])
    hwIdByObject[d.obj.id] = d.hwId
    const base = { objectId: d.obj.id, kind: d.kind, name: d.obj.name }
    if (d.kind === 'fan') add({ id: d.hwId, type: 'dcMotor', label: `Demo motor for ${d.obj.name}`, controllerId: '', virtual: { ...base, variant: 'motor' }, params: { motorStallMa: 600, motorV } }, g)
    else if (d.kind === 'light') add({ id: d.hwId, type: 'led', label: `LED for ${d.obj.name}`, controllerId: '', virtual: { ...base, variant: 'led' } }, g)
    else {
      const out = cfg.acOutput ?? 'led'
      if (out === 'led' || out === 'both') add({ id: out === 'both' ? `${d.hwId}-led` : d.hwId, type: 'led', label: `Status LED for ${d.obj.name}`, controllerId: '', virtual: { ...base, variant: 'led' } }, g)
      if (out === 'blower' || out === 'both') add({ id: out === 'both' ? `${d.hwId}-blower` : d.hwId, type: 'dcMotor', label: `Demo blower for ${d.obj.name}`, controllerId: '', virtual: { ...base, variant: 'motor' }, params: { motorStallMa: 600, motorV } }, g)
    }
  }
  const counter = { temperature: 0, light: 0, presence: 0 }
  for (const sp of sensors) {
    const n = String(++counter[sp.kind]).padStart(2, '0')
    const type: PartType = sp.kind === 'temperature' ? cfg.tempPart : sp.kind === 'light' ? cfg.lightPart : 'pir'
    const id = `${sp.kind === 'temperature' ? 'temp' : sp.kind === 'light' ? 'lux' : 'pir'}${n}`
    const g = Math.max(0, zones.indexOf(sp.zone ?? sp.name))
    add({ id, type, label: `${PARTS[type].label} · ${sp.name}`, controllerId: '', sensorId: sp.id }, g)
  }
  return { parts, reqs, hwIdByObject, devices }
}

// ───────────────────────── 2. fitting requirements onto one controller ─────────────────────────

interface Slot {
  req: Requirement
  fn: PinFunction
  /** direct controller pin, or an expander channel */
  pinId?: string
  expander?: { kind: 'pca9685' | 'ads1115'; index: number; channel: number }
}
interface PlaceOk {
  ok: true
  slots: Slot[]
  expanders: { type: 'pca9685' | 'ads1115' | 'tca9548a'; addr: number }[]
  sdaPin?: string
  sclPin?: string
  onewirePin?: string
  /** sensors placed behind the mux: part id → channel */
  mux: Record<string, number>
  /** I²C address per sensor part id */
  addr: Record<string, number>
  usage: { pwmGpio: number; pwmExpander: number; adc: number; adcExpander: number; digital: number; i2c: number }
}
type Placement = PlaceOk | { ok: false; reason: string }

const I2C_ADDR: Partial<Record<PartType, number[]>> = { bh1750: [0x23, 0x5c], bme280: [0x76, 0x77] }

/** Fit `reqs` on one controller, adding expanders only when they are technically needed. */
export function place(family: Controller['family'], reqs: Requirement[]): Placement {
  const board = BOARDS[family]
  const wifiOn = board.hasWifi
  const slots: Slot[] = []
  const expanders: PlaceOk['expanders'] = []
  const mux: Record<string, number> = {}
  const addr: Record<string, number> = {}
  const by = (n: Requirement['need']) => reqs.filter((r) => r.need === n)
  const i2cSensors = by('i2c')
  const adcReqs = by('adc')
  const pwmReqs = by('pwm')

  if (family === 'uno' && reqs.length > 14) return { ok: false, reason: `an Arduino Uno has only 2 KB of RAM and cannot manage ${reqs.length} channels` }

  const i2cFixed = i2cSensors.length > 0
  const i2cPins = board.i2cDefault!
  const used = new Set<string>()
  const eligible = (p: (typeof board.pins)[number], fn: Parameters<typeof pinSupports>[1]) => {
    if (used.has(p.id)) return false
    // Uno: A4/A5 are ordinary pins unless the I²C bus is needed
    const q = family === 'uno' && !i2cFixed ? { ...p, sda: false, scl: false } : p
    return pinSupports(q, fn, wifiOn)
  }
  const pick = (fn: 'pwm' | 'adc' | 'digital-in' | 'digital-io' | 'onewire', prefer?: string) => {
    const list = board.pins.filter((p) => eligible(p, fn)).sort((a, b) => (a.id === prefer ? -1 : b.id === prefer ? 1 : pinPreference(a, fn === 'digital-io' || fn === 'onewire' ? 'digital-io' : fn) - pinPreference(b, fn === 'digital-io' || fn === 'onewire' ? 'digital-io' : fn)))
    return list[0]
  }

  // ── analog (scarcest first) ──
  let adcExp = 0
  let adcOverflow = 0
  for (const r of adcReqs) {
    const p = pick('adc')
    if (p) { used.add(p.id); slots.push({ req: r, fn: 'adc-in', pinId: p.id }) } else adcOverflow++
  }
  // ── digital inputs / bidirectional ──
  for (const r of by('digital-in')) {
    const p = pick('digital-in')
    if (!p) return { ok: false, reason: 'ran out of digital input pins' }
    used.add(p.id); slots.push({ req: r, fn: 'digital-in', pinId: p.id })
  }
  for (const r of by('digital-io')) {
    const p = pick('digital-io')
    if (!p) return { ok: false, reason: 'ran out of bidirectional pins for DHT22 data lines' }
    used.add(p.id); slots.push({ req: r, fn: 'digital-io', pinId: p.id })
  }
  // ── 1-Wire: every DS18B20 shares one pin ──
  let onewirePin: string | undefined
  const ow = by('onewire')
  if (ow.length) {
    const p = pick('onewire', board.onewirePin)
    if (!p) return { ok: false, reason: 'no pin left for the 1-Wire bus' }
    used.add(p.id); onewirePin = p.id
    for (const r of ow) slots.push({ req: r, fn: 'onewire', pinId: p.id })
  }
  // ── PWM ──
  let pwmGpio = 0
  const pwmOverflow: Requirement[] = []
  for (const r of pwmReqs) {
    // the ESP32 LEDC peripheral has 16 channels, however many pins could carry PWM
    const p = family === 'esp32' && pwmGpio >= 16 ? undefined : pick('pwm')
    if (p) { used.add(p.id); slots.push({ req: r, fn: 'pwm-out', pinId: p.id }); pwmGpio++ } else pwmOverflow.push(r)
  }

  // ── expanders ──
  const canExpand = family !== 'uno'
  if ((pwmOverflow.length || adcOverflow) && !canExpand) {
    return { ok: false, reason: pwmOverflow.length ? `out of PWM pins (an Uno has 6) and it cannot take expanders` : 'out of analog inputs on an Uno' }
  }
  let pcaCount = 0
  if (pwmOverflow.length) {
    pcaCount = Math.ceil(pwmOverflow.length / 16)
    if (pcaCount > 8) return { ok: false, reason: `needs ${pcaCount} PCA9685 boards but an I²C bus offers only 8 addresses` }
    pwmOverflow.forEach((r, i) => slots.push({ req: r, fn: 'pwm-out', expander: { kind: 'pca9685', index: Math.floor(i / 16), channel: i % 16 } }))
    for (let i = 0; i < pcaCount; i++) expanders.push({ type: 'pca9685', addr: PARTS.pca9685.i2c![i] })
  }
  if (adcOverflow) {
    adcExp = Math.ceil(adcOverflow / 4)
    if (adcExp > 4) return { ok: false, reason: `needs ${adcExp} ADS1115 boards but only 4 addresses exist` }
    const overflowReqs = adcReqs.filter((r) => !slots.some((s) => s.req === r))
    overflowReqs.forEach((r, i) => slots.push({ req: r, fn: 'adc-in', expander: { kind: 'ads1115', index: Math.floor(i / 4), channel: i % 4 } }))
    for (let i = 0; i < adcExp; i++) expanders.push({ type: 'ads1115', addr: PARTS.ads1115.i2c![i] })
  }

  // ── I²C sensors: unique addresses, or one TCA9548A when the addresses run out ──
  const counts = new Map<PartType, Requirement[]>()
  for (const r of i2cSensors) counts.set(r.part.type, [...(counts.get(r.part.type) ?? []), r])
  const conflict = [...counts.entries()].some(([t, rs]) => rs.length > I2C_ADDR[t]!.length)
  if (i2cSensors.length) {
    if (!conflict) {
      for (const [t, rs] of counts) rs.forEach((r, i) => { addr[r.part.id] = I2C_ADDR[t]![i] })
    } else {
      if (!canExpand) return { ok: false, reason: 'two identical I²C sensors share an address and an Uno setup here does not use a multiplexer' }
      if (i2cSensors.length > 8) return { ok: false, reason: `${i2cSensors.length} I²C sensors do not fit behind one TCA9548A (8 channels)` }
      expanders.push({ type: 'tca9548a', addr: PARTS.tca9548a.i2c![0] })
      i2cSensors.forEach((r, i) => { mux[r.part.id] = i; addr[r.part.id] = I2C_ADDR[r.part.type]![0] })
    }
    for (const r of i2cSensors) slots.push({ req: r, fn: 'i2c-sda' })
  }

  // ── rail current budgets ──
  let ma3 = 0
  let ma5 = 0
  const add = (t: PartType) => { if (railFor(t, board.logicV) === '3V3') ma3 += PARTS[t].currentMa; else ma5 += PARTS[t].currentMa }
  for (const r of reqs) if (r.need !== 'pwm') add(r.part.type)
  for (const e of expanders) add(e.type)
  if (ma3 > board.max3v3Ma) return { ok: false, reason: `the 3.3 V rail would carry ${ma3} mA (limit ${board.max3v3Ma} mA)` }
  if (ma5 > board.max5vMa) return { ok: false, reason: `the 5 V rail would carry ${ma5} mA (limit ${board.max5vMa} mA)` }

  const needBus = i2cSensors.length > 0 || expanders.length > 0
  return {
    ok: true, slots, expanders, mux, addr, onewirePin,
    sdaPin: needBus ? i2cPins.sda : undefined,
    sclPin: needBus ? i2cPins.scl : undefined,
    usage: { pwmGpio, pwmExpander: pwmOverflow.length, adc: adcReqs.length - adcOverflow, adcExpander: adcOverflow, digital: by('digital-in').length + by('digital-io').length + (ow.length ? 1 : 0), i2c: i2cSensors.length },
  }
}

// ───────────────────────── 3. distribute over N controllers ─────────────────────────

function distribute(family: Controller['family'], reqs: Requirement[], n: number): { ok: true; groups: Requirement[][] } | { ok: false; reason: string } {
  const bins: Requirement[][] = Array.from({ length: n }, () => [])
  const byGroup = new Map<number, Requirement[]>()
  for (const r of reqs) byGroup.set(r.group, [...(byGroup.get(r.group) ?? []), r])
  const groups = [...byGroup.values()].sort((a, b) => b.length - a.length)
  let lastReason = ''
  const fitInto = (items: Requirement[]) => {
    for (const b of bins) {
      const t = place(family, [...b, ...items])
      if (t.ok) { b.push(...items); return true }
      lastReason = t.reason
    }
    return false
  }
  for (const g of groups) {
    if (fitInto(g)) continue
    // a zone that does not fit on one controller is split device by device
    for (const r of g) if (!fitInto([r])) return { ok: false, reason: lastReason }
  }
  return { ok: true, groups: bins }
}

// ───────────────────────── 4. whole plan ─────────────────────────

export function buildPlan(space: Space, cfg: HardwareConfig): HardwarePlan {
  const draft = draftParts(space, cfg)
  const family = cfg.controller
  const board = BOARDS[family]
  const issues: Issue[] = []
  const reasons: string[] = []

  if (draft.reqs.length === 0) {
    return { family, controllers: [], parts: [], pins: [], channels: {}, nets: [], map: [], bom: [], supplies: [], hwIdByObject: draft.hwIdByObject, reasons: ['The room has no fans, AC units, lights or sensors to build a prototype from.'], issues: [{ code: 'empty', severity: 'info', message: 'Add fans, AC units or lights to the room first.', refs: [] }] }
  }

  let chosen: Requirement[][] | null = null
  let whyNot = ''
  for (let n = 1; n <= MAX_CONTROLLERS; n++) {
    const d = distribute(family, draft.reqs, n)
    if (d.ok) {
      chosen = d.groups.filter((g) => g.length)
      if (n > 1) reasons.push(`One ${FAMILY_NAME[family]} is not enough: ${whyNot}.`)
      break
    }
    whyNot = d.reason
  }
  if (!chosen) {
    issues.push({ code: 'no-fit', severity: 'error', message: `Even ${MAX_CONTROLLERS} ${FAMILY_NAME[family]} boards cannot host this room: ${whyNot}.`, refs: [] })
    return { family, controllers: [], parts: draft.parts, pins: [], channels: {}, nets: [], map: [], bom: [], supplies: [], hwIdByObject: draft.hwIdByObject, reasons, issues }
  }

  const controllers: Controller[] = chosen.map((_, i) => ({ id: `${family}-${LABEL(i)}`, family, label: `${FAMILY_NAME[family]} ${LABEL(i).toUpperCase()}` }))
  const parts: PlanPart[] = []
  const pins: PinUse[] = []
  const channels: Record<string, Channel> = {}
  const nets: Net[] = []
  const supplies: ExternalSupply[] = []
  const counters = { pca9685: 0, ads1115: 0, tca9548a: 0 }
  const netMap = new Map<string, Net>()
  const net = (id: string, kind: Net['kind'], label: string) => {
    let n = netMap.get(id)
    if (!n) { n = { id, kind, label, endpoints: [] }; netMap.set(id, n); nets.push(n) }
    return n
  }
  const connect = (n: Net, owner: string, pin: string) => { if (!n.endpoints.some((e) => e.owner === owner && e.pin === pin)) n.endpoints.push({ owner, pin }) }
  const overrides = cfg.pinOverrides ?? {}
  const logicV = board.logicV

  chosen.forEach((reqs, ci) => {
    const ctrl = controllers[ci]
    const pl = place(family, reqs)
    if (!pl.ok) return // cannot happen: distribute() just verified it
    const gnd = net(`${ctrl.id}:GND`, 'ground', `${ctrl.label} GND`)
    connect(gnd, ctrl.id, 'GND')
    const rail = (r: '3V3' | '5V') => { const n = net(`${ctrl.id}:${r}`, 'power', `${ctrl.label} ${r === '3V3' ? '3.3 V' : '5 V'}`); connect(n, ctrl.id, r); return n }

    // expander parts of this controller
    const exp = pl.expanders.map((e) => {
      counters[e.type]++
      const id = `${e.type === 'pca9685' ? 'pca' : e.type === 'ads1115' ? 'ads' : 'tca'}${String(counters[e.type]).padStart(2, '0')}`
      const part: PlanPart = { id, type: e.type, label: `${PARTS[e.type].label} #${counters[e.type]}`, controllerId: ctrl.id, i2cAddr: e.addr }
      parts.push(part)
      return part
    })
    const expOf = (kind: 'pca9685' | 'ads1115', index: number) => exp.filter((p) => p.type === kind)[index]
    const tca = exp.find((p) => p.type === 'tca9548a')

    // bus nets
    const sda = net(`${ctrl.id}:SDA`, 'i2c', `${ctrl.label} SDA`)
    const scl = net(`${ctrl.id}:SCL`, 'i2c', `${ctrl.label} SCL`)
    if (pl.sdaPin) { connect(sda, ctrl.id, pl.sdaPin); connect(scl, ctrl.id, pl.sclPin!) }

    // power / ground / bus of the expanders
    for (const e of exp) {
      const spec = PARTS[e.type]
      connect(rail(railFor(e.type, logicV)), e.id, spec.terminals.find((t) => t.kind === 'power')!.name)
      connect(gnd, e.id, 'GND')
      connect(sda, e.id, 'SDA')
      connect(scl, e.id, 'SCL')
    }

    let motors = 0
    let motorMa = 0
    for (const r of reqs) {
      const part: PlanPart = { ...r.part, controllerId: ctrl.id, params: r.part.params ? { ...r.part.params } : undefined }
      parts.push(part)
      const spec = PARTS[part.type]
      const slot = pl.slots.find((s) => s.req === r)!
      const sig = spec.terminals.find((t) => t.kind === 'signal')
      const ovKey = sig ? `${part.id}:${sig.name}` : ''

      // ground
      const gt = spec.terminals.find((t) => t.kind === 'ground')
      if (gt) connect(gnd, part.id, gt.name)
      // supply
      const pt = spec.terminals.find((t) => t.kind === 'power')
      if (pt) connect(rail(railFor(part.type, logicV)), part.id, pt.name)

      if (part.type === 'led') part.params = { resistorOhm: ledResistor(logicV, 5) }
      if (part.type === 'dcMotor') {
        motors++
        motorMa += part.params?.motorStallMa ?? 600
        connect(net(`${ctrl.id}:VEXT`, 'ext-power', `${ctrl.label} motor supply +`), part.id, 'VEXT')
        connect(gnd, `psu-${ctrl.id}`, 'GND') // common ground with the motor supply
      }

      // signal → pin / expander channel
      if (slot.fn === 'i2c-sda') {
        part.i2cAddr = pl.addr[part.id]
        const mch = pl.mux[part.id]
        if (mch != null && tca) {
          part.mux = { partId: tca.id, channel: mch }
          connect(net(`${tca.id}:SD${mch}`, 'i2c', `${tca.id} channel ${mch} SDA`), tca.id, `SD${mch}`)
          connect(net(`${tca.id}:SC${mch}`, 'i2c', `${tca.id} channel ${mch} SCL`), tca.id, `SC${mch}`)
          connect(netMap.get(`${tca.id}:SD${mch}`)!, part.id, 'SDA')
          connect(netMap.get(`${tca.id}:SC${mch}`)!, part.id, 'SCL')
        } else {
          connect(sda, part.id, 'SDA')
          connect(scl, part.id, 'SCL')
        }
        if (pl.sdaPin) {
          pins.push({ controllerId: ctrl.id, pinId: pl.sdaPin, fn: 'i2c-sda', partId: part.id, signal: 'SDA' })
          pins.push({ controllerId: ctrl.id, pinId: pl.sclPin!, fn: 'i2c-scl', partId: part.id, signal: 'SCL' })
        }
        continue
      }
      if (!sig) continue
      if (slot.expander) {
        const e = expOf(slot.expander.kind, slot.expander.index)
        const pinName = slot.expander.kind === 'pca9685' ? `CH${slot.expander.channel}` : `A${slot.expander.channel}`
        channels[part.id] = { kind: slot.expander.kind, expanderId: e.id, channel: slot.expander.channel }
        const n = net(`sig:${part.id}`, 'signal', `${part.id} ${sig.name}`)
        connect(n, e.id, pinName)
        connect(n, part.id, sig.name)
        continue
      }
      let pinId = slot.pinId!
      if (overrides[ovKey] && pinOf(family, overrides[ovKey])) pinId = overrides[ovKey]
      channels[part.id] = { kind: 'gpio', controllerId: ctrl.id, pinId }
      pins.push({ controllerId: ctrl.id, pinId, fn: slot.fn, partId: part.id, signal: sig.name })
      const n = net(slot.fn === 'onewire' ? `${ctrl.id}:1W` : `sig:${part.id}`, 'signal', slot.fn === 'onewire' ? `${ctrl.label} 1-Wire bus` : `${part.id} ${sig.name}`)
      connect(n, ctrl.id, pinId)
      connect(n, part.id, sig.name)
    }
    if (motors) {
      const v = cfg.motorSupplyV ?? 5
      supplies.push({ controllerId: ctrl.id, volts: v, minAmps: Math.ceil((motorMa * 1.25) / 100) / 10, motors })
      const vext = netMap.get(`${ctrl.id}:VEXT`)!
      connect(vext, `psu-${ctrl.id}`, 'V+')
    }
    // drop empty rails / buses
    for (const id of [`${ctrl.id}:3V3`, `${ctrl.id}:5V`, `${ctrl.id}:SDA`, `${ctrl.id}:SCL`]) {
      const n = netMap.get(id)
      if (n && n.endpoints.length < 2) { netMap.delete(id); nets.splice(nets.indexOf(n), 1) }
    }
  })

  // 1-Wire: DS18B20 pull-up note and reasons
  if (chosen.length === 1) reasons.push(`One ${FAMILY_NAME[family]} covers all ${draft.reqs.length} channels.`)
  const expanderTotals = { pca9685: counters.pca9685, ads1115: counters.ads1115, tca9548a: counters.tca9548a }
  if (expanderTotals.pca9685) reasons.push(`${expanderTotals.pca9685} PCA9685 board(s) add PWM channels over I²C once the controller's own PWM pins are used.`)
  if (expanderTotals.ads1115) reasons.push(`${expanderTotals.ads1115} ADS1115 board(s) add analog inputs (${family === 'rpi' ? 'a Raspberry Pi has none' : 'the controller ran out of ADC pins'}).`)
  if (expanderTotals.tca9548a) reasons.push('A TCA9548A multiplexer lets several identical I²C sensors share one bus although their addresses would clash.')
  if (family === 'uno') reasons.push('The Uno has no Wi-Fi: it reports over USB serial and needs a gateway (ESP32 / Raspberry Pi / PC) to reach the MQTT broker.')

  // mapping table
  const nameOf = (id: string) => draft.devices.find((d) => d.obj.id === id)?.obj.name ?? id
  const map: MapRow[] = []
  for (const p of parts) {
    if (!(p.type in PARTS) || PARTS[p.type].category === 'expander') continue
    const ch = channels[p.id]
    const pu = pins.find((x) => x.partId === p.id && x.fn !== 'i2c-scl')
    const pinText = ch?.kind === 'pca9685' ? `${parts.find((x) => x.id === ch.expanderId)?.label} · CH${ch.channel}` : ch?.kind === 'ads1115' ? `${parts.find((x) => x.id === ch.expanderId)?.label} · A${ch.channel}` : pu ? (pu.fn === 'i2c-sda' ? `I²C ${pu.pinId} / ${pins.find((x) => x.partId === p.id && x.fn === 'i2c-scl')?.pinId} @0x${(p.i2cAddr ?? 0).toString(16)}${p.mux ? ` (mux ch ${p.mux.channel})` : ''}` : pu.pinId) : p.i2cAddr ? `I²C @0x${p.i2cAddr.toString(16)}${p.mux ? ` (mux ch ${p.mux.channel})` : ''}` : '—'
    const sp = p.sensorId ? cfg.sensors.find((s) => s.id === p.sensorId) : undefined
    map.push({
      virtualDevice: p.virtual ? `${p.virtual.name}${p.virtual.variant === 'led' && p.virtual.kind === 'ac' ? ' (status)' : ''}` : sp ? `${sp.name} @ (${sp.position.map((v) => v.toFixed(1)).join(', ')})` : p.id,
      hardwareDevice: `${p.id} · ${PARTS[p.type].label}`,
      controller: controllers.find((c) => c.id === p.controllerId)?.label ?? p.controllerId,
      pin: pinText,
      note: p.type === 'dcMotor' ? 'via MOSFET driver' : p.type === 'led' ? `${p.params?.resistorOhm} Ω series resistor` : undefined,
    })
  }
  void nameOf

  const bom = buildBom(controllers, parts, supplies, expanderTotals)
  const plan: HardwarePlan = { family, controllers, parts, pins, channels, nets, map, bom, supplies, issues: [], reasons, hwIdByObject: draft.hwIdByObject }
  plan.issues = [...issues, ...validatePlan(plan, cfg)]
  return plan
}

function buildBom(controllers: Controller[], parts: PlanPart[], supplies: ExternalSupply[], exp: Record<string, number>): BomLine[] {
  const bom: BomLine[] = []
  const count = (t: PartType) => parts.filter((p) => p.type === t).length
  if (controllers.length) bom.push({ item: BOARDS[controllers[0].family].name, qty: controllers.length })
  for (const t of ['dht22', 'ds18b20', 'bme280', 'bh1750', 'ldr', 'pir'] as PartType[]) if (count(t)) bom.push({ item: PARTS[t].model, qty: count(t) })
  const leds = parts.filter((p) => p.type === 'led')
  const byR = new Map<number, number>()
  for (const l of leds) byR.set(l.params?.resistorOhm ?? 330, (byR.get(l.params?.resistorOhm ?? 330) ?? 0) + 1)
  if (leds.length) bom.push({ item: '5 mm LED', qty: leds.length })
  for (const [r, n] of byR) bom.push({ item: `${r} Ω resistor (LED series)`, qty: n })
  const motors = count('dcMotor')
  if (motors) {
    bom.push({ item: 'Small 5 V DC motor / fan (demonstration load)', qty: motors })
    bom.push({ item: 'Logic-level N-MOSFET (IRLZ44N or AO3400A)', qty: motors })
    bom.push({ item: '1N5819 flyback diode', qty: motors })
    bom.push({ item: '100 Ω resistor (MOSFET gate)', qty: motors })
    bom.push({ item: '10 kΩ resistor (gate pull-down)', qty: motors })
    for (const s of supplies) bom.push({ item: `${s.volts} V DC supply ≥ ${s.minAmps.toFixed(1)} A with 100 µF + 100 nF decoupling (for ${s.controllerId})`, qty: 1, note: 'common ground with the controller' })
  }
  if (count('ds18b20')) bom.push({ item: '4.7 kΩ resistor (1-Wire pull-up)', qty: 1 })
  if (count('dht22')) bom.push({ item: '10 kΩ resistor (only if the DHT22 is a bare 4-pin part)', qty: count('dht22'), note: 'built in on 3-pin modules' })
  if (exp.pca9685) bom.push({ item: PARTS.pca9685.model, qty: exp.pca9685 })
  if (exp.ads1115) bom.push({ item: PARTS.ads1115.model, qty: exp.ads1115 })
  if (exp.tca9548a) bom.push({ item: PARTS.tca9548a.model, qty: exp.tca9548a })
  bom.push({ item: 'Breadboards / perfboard and jumper wires', qty: 1 })
  return bom
}

export { proposeSensors }
