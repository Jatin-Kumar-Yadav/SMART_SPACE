import { describe, expect, it } from 'vitest'
import { createSeminarHall } from '@/demo/seminarHall'
import { BOARDS } from '@/iot/boards'
import { buildPlan } from '@/iot/planner'
import { defaultHardware } from '@/iot/requirements'
import { ledResistor } from '@/iot/parts'
import { validatePlan } from '@/iot/validate'
import { createObject } from '@/objects/catalog'
import { createSpace } from '@/objects/spaceFactory'
import type { ControllerFamily, ObjectKind, Space } from '@/types'

function room(kinds: ObjectKind[]): Space {
  const s = createSpace({ name: 'T', type: 'classroom', dims: { length: 10, width: 8, height: 3 } })
  const objs = kinds.map((k, i) => {
    const o = createObject(k, 2 + (i % 4) * 2, 2 + Math.floor(i / 4) * 3, s)
    o.position = [2 + (i % 4) * 2, o.position[1], 2 + Math.floor(i / 4) * 3]
    return o
  })
  return { ...s, objects: objs }
}
const plan = (s: Space, patch: Partial<ReturnType<typeof defaultHardware>> = {}) => {
  const cfg = { ...defaultHardware(s), ...patch }
  return { cfg, plan: buildPlan(s, cfg) }
}
const errors = (p: ReturnType<typeof buildPlan>) => p.issues.filter((i) => i.severity === 'error')

describe('IoT planner — two fans + two lights (acceptance 10)', () => {
  const s = room(['ceilingFan', 'ceilingFan', 'ceilingLight', 'ceilingLight'])
  it('maps every virtual device to one hardware part with its own pin and no pin errors', () => {
    const { plan: p } = plan(s)
    expect(p.parts.filter((x) => x.type === 'dcMotor')).toHaveLength(2)
    expect(p.parts.filter((x) => x.type === 'led')).toHaveLength(2)
    expect(errors(p)).toEqual([])
    const outPins = p.pins.filter((u) => u.fn === 'pwm-out').map((u) => `${u.controllerId}/${u.pinId}`)
    expect(new Set(outPins).size).toBe(outPins.length)
    expect(p.map.filter((m) => /^(fan|light)\d+ /.test(m.hardwareDevice)).length).toBe(4)
    expect(p.controllers).toHaveLength(1)
  })
  it('never connects a motor directly: driver + external supply + common ground', () => {
    const { plan: p } = plan(s)
    expect(p.supplies).toHaveLength(1)
    expect(p.bom.some((b) => /MOSFET/.test(b.item))).toBe(true)
    expect(p.bom.some((b) => /flyback/.test(b.item))).toBe(true)
    for (const m of p.parts.filter((x) => x.type === 'dcMotor')) {
      const g = p.nets.find((n) => n.kind === 'ground' && n.endpoints.some((e) => e.owner === m.id))
      expect(g?.endpoints.some((e) => e.owner.startsWith('psu-'))).toBe(true)
    }
  })
  it('uses no reserved, flash or input-only pin for an output on an ESP32', () => {
    const { plan: p } = plan(s)
    for (const u of p.pins) {
      const pin = BOARDS.esp32.pins.find((x) => x.id === u.pinId)!
      expect(pin.reserved, u.pinId).toBeUndefined()
      if (u.fn === 'pwm-out' || u.fn === 'digital-io' || u.fn === 'onewire') expect(pin.out, u.pinId).toBe(true)
    }
  })
})

describe('IoT planner — scaling beyond pin count', () => {
  it('the seminar hall fits an ESP32 fleet with real reasons, and validates clean', () => {
    const { plan: p } = plan(createSeminarHall())
    expect(p.controllers.length).toBeGreaterThanOrEqual(1)
    expect(errors(p)).toEqual([])
    expect(p.reasons.length).toBeGreaterThan(0)
    // every part has exactly one owner and every controller is used
    for (const c of p.controllers) expect(p.parts.some((x) => x.controllerId === c.id)).toBe(true)
  })
  it('adds a PCA9685 only when PWM pins run out', () => {
    const many = room(Array<ObjectKind>(10).fill('ceilingLight'))
    const { plan: p } = plan(many, { sensors: [] })
    const pwm = p.parts.filter((x) => x.type === 'led').length
    expect(pwm).toBe(10)
    expect(errors(p)).toEqual([])
  })
  it('an Uno never gets expanders and reports it has no Wi-Fi', () => {
    const { plan: p } = plan(room(['ceilingFan', 'ceilingLight']), { controller: 'uno' as ControllerFamily })
    expect(p.parts.some((x) => x.type === 'pca9685' || x.type === 'tca9548a')).toBe(false)
    expect(p.issues.some((i) => i.code === 'uno-no-wifi')).toBe(true)
  })
  it('a Raspberry Pi with an LDR gets an ADS1115 instead of an invalid analog pin', () => {
    const { plan: p } = plan(room(['ceilingLight']), { controller: 'rpi' as ControllerFamily, lightPart: 'ldr' })
    expect(p.parts.some((x) => x.type === 'ads1115')).toBe(true)
    expect(p.issues.some((i) => i.code === 'rpi-no-adc')).toBe(false)
  })
  it('identical I²C sensors beyond two addresses add a TCA9548A', () => {
    const s = room(['ceilingLight'])
    const cfg0 = defaultHardware(s)
    const base = cfg0.sensors.find((x) => x.kind === 'light')!
    const sensors = [1, 2, 3].map((i) => ({ ...base, id: `x${i}`, name: `L${i}`, zone: 'A' }))
    const { plan: p } = plan(s, { sensors, scaling: 'expanders' })
    expect(p.parts.some((x) => x.type === 'tca9548a')).toBe(true)
    expect(errors(p)).toEqual([])
  })
})

describe('IoT validator', () => {
  const s = room(['ceilingFan', 'ceilingLight'])
  it('flags a manual override onto a flash pin, an input-only pin and a duplicate', () => {
    const base = plan(s)
    const motor = base.plan.parts.find((x) => x.type === 'dcMotor')!
    const key = `${motor.id}:GATE`
    for (const [pin, code] of [['GPIO6', 'pin-capability'], ['GPIO34', 'pin-capability']] as const) {
      const { plan: p } = plan(s, { pinOverrides: { [key]: pin } })
      expect(p.issues.some((i) => i.code === code && i.severity === 'error'), pin).toBe(true)
    }
    const led = base.plan.parts.find((x) => x.type === 'led')!
    const ledPin = base.plan.pins.find((u) => u.partId === led.id)!.pinId
    const { plan: dup } = plan(s, { pinOverrides: { [key]: ledPin } })
    expect(dup.issues.some((i) => i.code === 'pin-duplicate')).toBe(true)
  })
  it('warns on strapping pins', () => {
    const base = plan(s)
    const motor = base.plan.parts.find((x) => x.type === 'dcMotor')!
    const { plan: p } = plan(s, { pinOverrides: { [`${motor.id}:GATE`]: 'GPIO12' } })
    expect(p.issues.some((i) => i.code === 'pin-caution')).toBe(true)
  })
  it('BME280 on an Uno is an error (3.3 V part on a 5 V bus)', () => {
    const { plan: p } = plan(room(['ceilingLight']), { controller: 'uno' as ControllerFamily, tempPart: 'bme280' })
    expect(p.issues.some((i) => i.code === 'logic-level' && i.severity === 'error')).toBe(true)
  })
  it('a motor without a supply is rejected', () => {
    const { plan: p, cfg } = plan(s)
    const broken = { ...p, supplies: [] }
    expect(validatePlan(broken, cfg).some((i) => /driver and external power supply/.test(i.message))).toBe(true)
  })
  it('ADC2 pins are rejected while Wi-Fi is on', () => {
    const { plan: p, cfg } = plan(room(['ceilingLight']), { lightPart: 'ldr' })
    const u = p.pins.find((x) => x.fn === 'adc-in')!
    u.pinId = 'GPIO25'
    expect(validatePlan(p, cfg).some((i) => /ADC2/.test(i.message))).toBe(true)
  })
  it('LED resistor keeps pin current under the limit', () => {
    expect(ledResistor(3.3, 5)).toBeGreaterThanOrEqual(260)
    expect(ledResistor(5, 5)).toBeGreaterThanOrEqual(600)
  })
  it('PIR is reported as motion-only', () => {
    const s2 = room(['ceilingLight'])
    const cfg = { ...defaultHardware(s2), includePresence: true }
    cfg.sensors = [...cfg.sensors, { ...cfg.sensors[0], id: 'pp', name: 'Presence A', kind: 'presence' as const }]
    const p = buildPlan(s2, cfg)
    expect(p.issues.some((i) => i.code === 'pir-not-count')).toBe(true)
  })
})
