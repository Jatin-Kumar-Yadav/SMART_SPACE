import type { HardwareConfig } from '@/types'
import { BOARDS, pinOf } from './boards'
import { PARTS } from './parts'
import type { HardwarePlan, Issue, PinFunction } from './types'

const hex = (n: number) => `0x${n.toString(16).toUpperCase().padStart(2, '0')}`

/**
 * Independent electrical / pin check of a plan. It reads only the finished plan (parts, pins, nets), never the
 * planner's internal state, so a hand-edited pin override is judged exactly like an automatic one.
 */
export function validatePlan(plan: HardwarePlan, cfg: HardwareConfig): Issue[] {
  const out: Issue[] = []
  const push = (code: string, severity: Issue['severity'], message: string, refs: string[] = []) => out.push({ code, severity, message, refs })
  const board = BOARDS[plan.family]
  const partById = new Map(plan.parts.map((p) => [p.id, p]))

  // ── manual overrides that name a pin which does not exist ──
  for (const [k, v] of Object.entries(cfg.pinOverrides ?? {})) {
    if (!pinOf(plan.family, v)) push('override-unknown', 'warning', `Pin override ${k} → ${v} was ignored: ${board.name} has no pin ${v}.`, [k.split(':')[0]])
  }

  // ── 1. each pin: exists, usable, capable, not shared ──
  const byPin = new Map<string, typeof plan.pins>()
  for (const u of plan.pins) byPin.set(`${u.controllerId}/${u.pinId}`, [...(byPin.get(`${u.controllerId}/${u.pinId}`) ?? []), u])

  const ok = (u: (typeof plan.pins)[number], fn: PinFunction) => {
    const p = pinOf(plan.family, u.pinId)
    if (!p) return `${u.pinId} does not exist on ${board.name}`
    if (p.reserved && fn !== 'i2c-sda' && fn !== 'i2c-scl') return `${u.pinId} is ${p.reserved}`
    switch (fn) {
      case 'pwm-out': return p.out && p.pwm ? null : `${u.pinId} cannot output PWM`
      case 'digital-out': return p.out ? null : `${u.pinId} is input-only`
      case 'digital-in': return p.in ? null : `${u.pinId} cannot be read`
      case 'digital-io':
      case 'onewire': return p.in && p.out ? null : `${u.pinId} is input-only, but this data line must be driven by the controller as well as read`
      case 'adc-in':
        if (plan.family === 'rpi') return 'a Raspberry Pi has no analog input'
        if (!p.adc) return `${u.pinId} has no ADC`
        if (board.hasWifi && p.adc2) return `${u.pinId} is on ADC2, which stops working while Wi-Fi is on`
        return null
      case 'i2c-sda': return p.sda ? null : `${u.pinId} is not an I²C SDA pin`
      case 'i2c-scl': return p.scl ? null : `${u.pinId} is not an I²C SCL pin`
    }
  }
  for (const [key, uses] of byPin) {
    const [ctrl, pinId] = key.split('/')
    const fns = new Set(uses.map((u) => u.fn))
    const refs = [ctrl, ...uses.map((u) => u.partId)]
    const shared = uses.length > 1
    // the 1-Wire bus and the I²C pair are legitimately shared
    const sharedOk = fns.size === 1 && (fns.has('onewire') || fns.has('i2c-sda') || fns.has('i2c-scl'))
    if (shared && !sharedOk) push('pin-duplicate', 'error', `${pinId} on ${ctrl} is used by ${uses.map((u) => `${u.partId} (${u.signal})`).join(' and ')}. A pin can drive only one signal.`, refs)
    const u = uses[0]
    const why = ok(u, u.fn)
    if (why) push('pin-capability', 'error', `${u.partId} ${u.signal}: ${why}.`, [ctrl, u.partId])
    const p = pinOf(plan.family, pinId)
    if (p?.caution && !p.reserved) push('pin-caution', 'warning', `${pinId} (${u.partId}): ${p.caution}.`, [ctrl, u.partId])
    if (p?.reserved && (u.fn === 'i2c-sda' || u.fn === 'i2c-scl') && !p.sda && !p.scl) push('pin-reserved', 'error', `${pinId} is ${p.reserved}.`, [ctrl])
  }

  // ── 2. I²C addresses ──
  for (const c of plan.controllers) {
    const onCtrl = plan.parts.filter((p) => p.controllerId === c.id && p.i2cAddr != null)
    const buses = new Map<string, typeof onCtrl>()
    for (const p of onCtrl) {
      const bus = p.mux ? `${p.mux.partId}/ch${p.mux.channel}` : 'main'
      buses.set(bus, [...(buses.get(bus) ?? []), p])
    }
    for (const [bus, ps] of buses) {
      const seen = new Map<number, string>()
      for (const p of ps) {
        const prev = seen.get(p.i2cAddr!)
        if (prev) push('i2c-conflict', 'error', `${prev} and ${p.id} both answer at I²C address ${hex(p.i2cAddr!)} on the ${bus === 'main' ? `${c.label} bus` : `multiplexer ${bus}`}. Change one address pin or put them behind a TCA9548A.`, [c.id, prev, p.id])
        else seen.set(p.i2cAddr!, p.id)
      }
    }
  }

  // ── 3. voltage / logic level ──
  const logicV = board.logicV
  for (const p of plan.parts) {
    const spec = PARTS[p.type]
    const net = plan.nets.find((n) => n.kind === 'power' && n.endpoints.some((e) => e.owner === p.id))
    const rail = net?.endpoints.find((e) => e.owner === plan.controllers.find((c) => c.id === p.controllerId)?.id)?.pin
    const v = rail === '5V' ? 5 : rail === '3V3' ? 3.3 : undefined
    if (v != null && spec.category !== 'actuator') {
      if (v < spec.supplyV[0] - 1e-6 || v > spec.supplyV[1] + 1e-6) push('supply-range', 'error', `${p.id} (${spec.label}) accepts ${spec.supplyV[0]}–${spec.supplyV[1]} V but sits on the ${v} V rail.`, [p.id])
      if (!board.fiveVTolerant && v === 5 && spec.logicV === 'vcc' && spec.category === 'sensor') push('logic-level', 'error', `${p.id} would drive a 5 V signal into a ${board.name} pin that is not 5 V tolerant.`, [p.id])
    }
    if (spec.interface === 'i2c' && spec.logicV === 3.3 && logicV === 5) {
      if (p.type === 'bme280') push('logic-level', 'error', `BME280 ${p.id} is a 3.3 V device on a 5 V I²C bus (${board.name}). Add a bidirectional level shifter or choose an ESP32 / Raspberry Pi.`, [p.id])
      else push('logic-level', 'warning', `${p.id} (${spec.label}) is a 3.3 V chip on a 5 V bus. Many GY-302 boards tolerate it, but check the board you buy or add a level shifter.`, [p.id])
    }
    if (p.type === 'pir' && !board.fiveVTolerant) push('pir-level', 'info', `${p.id}: the HC-SR501 needs 5 V supply; its OUT pin is 3.3 V, so it is safe for ${board.name}.`, [p.id])
  }

  // ── 4. motors need a driver, an external supply and a common ground ──
  for (const m of plan.parts.filter((p) => p.type === 'dcMotor')) {
    const ch = plan.channels[m.id]
    if (!ch) push('motor-channel', 'error', `${m.id} has no PWM channel.`, [m.id])
    const sup = plan.supplies.find((s) => s.controllerId === m.controllerId)
    const vext = plan.nets.find((n) => n.kind === 'ext-power' && n.endpoints.some((e) => e.owner === m.id))
    if (!sup || !vext?.endpoints.some((e) => e.owner.startsWith('psu-'))) push('motor-supply', 'error', 'Motor requires a driver and external power supply.', [m.id])
    else {
      const [lo, hi] = PARTS.dcMotor.supplyV
      if (sup.volts < lo || sup.volts > hi) push('motor-voltage', 'error', `The ${sup.volts} V motor supply is outside the ${lo}–${hi} V range of the demonstration motor.`, [m.id])
    }
    const gnd = plan.nets.find((n) => n.kind === 'ground' && n.endpoints.some((e) => e.owner === m.id))
    if (!gnd?.endpoints.some((e) => e.owner.startsWith('psu-'))) push('motor-ground', 'error', `${m.id}: the motor supply ground must be joined to the controller ground.`, [m.id])
    if (ch?.kind === 'gpio') push('motor-driver', 'info', `${m.id}: GPIO ${ch.pinId} drives only the MOSFET gate. The motor never connects to the pin.`, [m.id])
  }

  // ── 5. current budgets ──
  for (const c of plan.controllers) {
    let ma3 = 0
    let ma5 = 0
    for (const p of plan.parts.filter((x) => x.controllerId === c.id)) {
      const spec = PARTS[p.type]
      const net = plan.nets.find((n) => n.kind === 'power' && n.endpoints.some((e) => e.owner === p.id) && n.endpoints.some((e) => e.owner === c.id))
      const rail = net?.endpoints.find((e) => e.owner === c.id)?.pin
      if (rail === '3V3') ma3 += spec.currentMa
      else if (rail === '5V') ma5 += spec.currentMa
    }
    if (ma3 > board.max3v3Ma) push('rail-3v3', 'error', `${c.label}: 3.3 V rail carries ~${ma3} mA (limit ${board.max3v3Ma} mA).`, [c.id])
    if (ma5 > board.max5vMa) push('rail-5v', 'error', `${c.label}: 5 V rail carries ~${ma5} mA (limit ${board.max5vMa} mA).`, [c.id])
  }
  for (const p of plan.parts.filter((x) => x.type === 'led')) {
    const r = p.params?.resistorOhm
    const ch = plan.channels[p.id]
    if (!r) continue
    const mA = ((logicV - 2.0) / r) * 1000
    const limit = ch?.kind === 'gpio' ? (pinOf(plan.family, ch.pinId)?.maxMa ?? 10) : 25
    if (mA > limit) push('led-current', 'error', `${p.id}: ${mA.toFixed(1)} mA exceeds the ${limit} mA pin limit. Use a larger resistor.`, [p.id])
  }

  // ── 6. platform notes ──
  if (plan.family === 'uno' && plan.controllers.length) push('uno-no-wifi', 'info', 'The Arduino Uno has no Wi-Fi. It talks to the backend through a USB-serial gateway; it cannot reach the MQTT broker on its own.', plan.controllers.map((c) => c.id))
  if (plan.family === 'uno' && plan.parts.length > 12) push('uno-ram', 'warning', 'More than 12 parts on an Uno with 2 KB of RAM. Expect little headroom; consider an ESP32.', [])
  if (plan.family === 'rpi' && plan.parts.some((p) => p.type === 'ldr') && !plan.parts.some((p) => p.type === 'ads1115')) push('rpi-no-adc', 'error', 'An LDR needs an ADC and a Raspberry Pi has none.', [])
  if (plan.parts.some((p) => p.type === 'ldr')) push('ldr-relative', 'info', 'LDR readings are relative. Calibrate against a lux meter before treating them as lux.', plan.parts.filter((p) => p.type === 'ldr').map((p) => p.id))
  if (plan.parts.some((p) => p.type === 'pir')) push('pir-not-count', 'info', 'PIR reports motion only. It cannot tell how many people are seated, so it never drives the seat count.', plan.parts.filter((p) => p.type === 'pir').map((p) => p.id))
  void partById
  return out
}
