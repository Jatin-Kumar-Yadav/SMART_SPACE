import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildPlan } from '@/iot/planner'
import { defaultHardware } from '@/iot/requirements'
import { generateWokwi, wokwiSupport } from '@/iot/wokwi'
import { createObject } from '@/objects/catalog'
import { createSpace } from '@/objects/spaceFactory'
import type { ControllerFamily, HardwareConfig, ObjectKind, SensorPoint, Space } from '@/types'

function room(kinds: ObjectKind[]): Space {
  const s = createSpace({ name: 'T', type: 'classroom', dims: { length: 10, width: 8, height: 3 } })
  return { ...s, objects: kinds.map((k, i) => { const o = createObject(k, 2 + (i % 4) * 2, 2 + Math.floor(i / 4) * 3, s); o.position = [2 + (i % 4) * 2, o.position[1], 2 + Math.floor(i / 4) * 3]; return o }) }
}
const plan = (kinds: ObjectKind[], patch: Partial<HardwareConfig> = {}) => { const s = room(kinds); return buildPlan(s, { ...defaultHardware(s), ...patch }) }

describe('Wokwi export', () => {
  it('exports diagram, sketch, libraries and toml, with BME280 / BH1750 / motor substituted and labelled', () => {
    const p = plan(['ceilingFan', 'ceilingLight'], { tempPart: 'bme280' })
    const r = generateWokwi(p, { spaceId: 'demo' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(Object.keys(r.files).sort()).toEqual(['README.md', 'diagram.json', 'libraries.txt', 'sketch.ino', 'wokwi.toml'])
    expect(r.substitutions.map((s) => `${s.from}->${s.to}`).sort()).toEqual(['bh1750->ldr', 'bme280->dht22', 'dcMotor->led'])
    expect(r.files['sketch.ino']).toContain('WOKWI SIMULATION COPY')
    expect(r.files['sketch.ino']).toContain('Wokwi-GUEST')
    const d = JSON.parse(r.files['diagram.json'])
    expect(d.editor).toBe('wokwi')
    const types = d.parts.map((x: { type: string }) => x.type)
    expect(types).toContain('board-esp32-devkit-c-v4')
    expect(types.some((t: string) => /bme280|bh1750|motor/i.test(t))).toBe(false)
  })
  it('every connection refers to a part that exists, and no signal pin is wired twice', () => {
    const p = plan(['ceilingFan', 'ceilingFan', 'ceilingLight'], { tempPart: 'ds18b20', lightPart: 'ldr' })
    const r = generateWokwi(p, { spaceId: 'demo' })
    if (!r.ok) throw new Error(r.reason)
    const d = JSON.parse(r.files['diagram.json'])
    const ids = new Set(d.parts.map((x: { id: string }) => x.id))
    const mcuPins = new Map<string, number>()
    for (const [a, b] of d.connections as string[][]) {
      for (const e of [a, b]) {
        expect(ids.has(e.split(':')[0]), e).toBe(true)
        if (e.startsWith('mcu:') && !/GND|3V3|5V/.test(e)) mcuPins.set(e, (mcuPins.get(e) ?? 0) + 1)
      }
    }
    // the shared 1-Wire pin is wired by each probe and the pull-up; every other pin once
    for (const [pin, n] of mcuPins) if (!/:4$/.test(pin)) expect(n, pin).toBe(1)
  })
  it('the substituted ESP32 sketch compiles against stubs', () => {
    if (spawnSync('g++', ['--version']).status !== 0) return
    const p = plan(['ceilingFan', 'ceilingLight'], { tempPart: 'bme280' })
    const r = generateWokwi(p, { spaceId: 'demo' })
    if (!r.ok) throw new Error(r.reason)
    const dir = mkdtempSync(join(tmpdir(), 'ss-wk-'))
    const f = join(dir, 's.cpp')
    writeFileSync(f, `#include "Arduino.h"\n${r.files['sketch.ino']}\nint main(){setup();loop();}\n`)
    const c = spawnSync('g++', ['-fsyntax-only', '-std=gnu++17', `-I${resolve(__dirname, 'stubs')}`, f], { encoding: 'utf8' })
    expect(c.status, c.stderr.slice(0, 1500)).toBe(0)
  })
  it('refuses Raspberry Pi and plans that need PCA9685 / ADS1115 / TCA9548A, with a reason', () => {
    const rpi = plan(['ceilingFan', 'ceilingLight'], { controller: 'rpi' as ControllerFamily })
    expect(wokwiSupport(rpi)).toMatchObject({ ok: false })
    const r = generateWokwi(rpi, { spaceId: 'x' })
    expect(r.ok).toBe(false)
    const many = plan(Array<ObjectKind>(20).fill('ceilingLight'))
    const w = generateWokwi(many, { spaceId: 'x' })
    expect(many.parts.some((x) => x.type === 'pca9685')).toBe(true)
    expect(w.ok).toBe(false)
    if (!w.ok) expect(w.reason).toMatch(/PCA9685/)
  })
  it('supports an Arduino Uno export', () => {
    const r = generateWokwi(plan(['ceilingFan', 'ceilingLight'], { controller: 'uno' as ControllerFamily }), { spaceId: 'x' })
    expect(r.ok).toBe(true)
    if (r.ok) { expect(r.board).toBe('uno'); expect(r.openUrlVerified).toBe(false) }
  })
})

describe('Wokwi 7 Configuration Verification (Section 8)', () => {
  function makeClassroom(acs: number, fans: number, lights: number, customSensors?: SensorPoint[]): Space {
    const s = createSpace({ name: 'TestRoom', type: 'classroom', dims: { length: 14, width: 10, height: 3 } })
    const objects = [
      ...Array.from({ length: acs }, (_, i) => {
        const o = createObject('acVent', 3 + (i % 3) * 3, 2 + Math.floor(i / 3) * 3, s)
        o.id = `ac_${i + 1}`
        return o
      }),
      ...Array.from({ length: fans }, (_, i) => {
        const o = createObject('ceilingFan', 2 + (i % 3) * 3, 4 + Math.floor(i / 3) * 2, s)
        o.id = `fan_${i + 1}`
        return o
      }),
      ...Array.from({ length: lights }, (_, i) => {
        const o = createObject('ceilingLight', 2.5 + (i % 3) * 3, 1.5 + Math.floor(i / 3) * 2, s)
        o.id = `light_${i + 1}`
        return o
      }),
    ]
    s.objects = objects
    const hw = defaultHardware(s)
    if (customSensors) {
      hw.sensors = customSensors
    }
    s.hardware = hw
    return s
  }

  function verifyExport(r: ReturnType<typeof generateWokwi>) {
    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error(r.reason)
    expect(r.files['diagram.json']).toBeDefined()
    expect(r.files['sketch.ino']).toBeDefined()
    expect(r.files['libraries.txt']).toBeDefined()
    expect(r.files['wokwi.toml']).toBeDefined()
    expect(r.files['README.md']).toBeDefined()

    const d = JSON.parse(r.files['diagram.json'])
    expect(d.editor).toBe('wokwi')
    expect(Array.isArray(d.parts)).toBe(true)
    expect(Array.isArray(d.connections)).toBe(true)

    const partIds = new Set(d.parts.map((p: { id: string }) => p.id))
    const mcuPinUsage = new Map<string, number>()
    for (const [p1, p2] of d.connections) {
      expect(partIds.has(p1.split(':')[0])).toBe(true)
      expect(partIds.has(p2.split(':')[0])).toBe(true)
      for (const ep of [p1, p2]) {
        if (ep.startsWith('mcu:') && !/GND|3V3|5V/.test(ep)) {
          mcuPinUsage.set(ep, (mcuPinUsage.get(ep) ?? 0) + 1)
        }
      }
    }
    // Except for I2C (GPIO21/GPIO22) and 1-Wire (GPIO4), no pin should have duplicate connections
    for (const [pin, count] of mcuPinUsage.entries()) {
      if (!/mcu:(21|22|4)$/.test(pin)) {
        expect(count, `Pin ${pin} connected multiple times`).toBe(1)
      }
    }
    return { diagram: d, sketch: r.files['sketch.ino'] }
  }

  it('Test 1: 1 AC, 1 fan, 1 light', () => {
    const s = makeClassroom(1, 1, 1)
    const p = buildPlan(s, s.hardware!)
    expect(p.issues.filter((i) => i.severity === 'error')).toHaveLength(0)
    const r = generateWokwi(p, { spaceId: 't1' })
    const { diagram, sketch } = verifyExport(r)
    const leds = diagram.parts.filter((pt: { type: string }) => pt.type === 'wokwi-led')
    expect(leds.length).toBeGreaterThanOrEqual(3)
    expect(sketch).toMatch(/Configured AC Outputs:\s*"\);\s*Serial\.println\(1\);/)
    expect(sketch).toMatch(/Configured Fan Outputs:\s*"\);\s*Serial\.println\(1\);/)
    expect(sketch).toMatch(/Configured Light Outputs:\s*"\);\s*Serial\.println\(1\);/)
  })

  it('Test 2: 2 ACs, 4 fans, 4 lights', () => {
    const s = makeClassroom(2, 4, 4)
    const p = buildPlan(s, s.hardware!)
    expect(p.issues.filter((i) => i.severity === 'error')).toHaveLength(0)
    const r = generateWokwi(p, { spaceId: 't2' })
    const { sketch } = verifyExport(r)
    expect(sketch).toMatch(/Configured AC Outputs:\s*"\);\s*Serial\.println\(2\);/)
    expect(sketch).toMatch(/Configured Fan Outputs:\s*"\);\s*Serial\.println\(4\);/)
    expect(sketch).toMatch(/Configured Light Outputs:\s*"\);\s*Serial\.println\(4\);/)
  })

  it('Test 3: 3 ACs, 4 fans, 4 lights, 3 temp sensors, 2 light sensors, 3 PIR sensors', () => {
    const customSensors: SensorPoint[] = [
      { id: 't1', name: 'Temp Sensor 1', kind: 'temperature', position: [2, 1.2, 2], zone: 'Zone A', fixtureIds: [], auto: false },
      { id: 't2', name: 'Temp Sensor 2', kind: 'temperature', position: [6, 1.2, 2], zone: 'Zone B', fixtureIds: [], auto: false },
      { id: 't3', name: 'Temp Sensor 3', kind: 'temperature', position: [10, 1.2, 2], zone: 'Zone C', fixtureIds: [], auto: false },
      { id: 'l1', name: 'Light Sensor 1', kind: 'light', position: [3, 0.8, 3], zone: 'Zone A', fixtureIds: [], auto: false },
      { id: 'l2', name: 'Light Sensor 2', kind: 'light', position: [8, 0.8, 3], zone: 'Zone B', fixtureIds: [], auto: false },
      { id: 'p1', name: 'PIR Sensor 1', kind: 'presence', position: [2, 2.5, 2], zone: 'Zone A', fixtureIds: [], auto: false },
      { id: 'p2', name: 'PIR Sensor 2', kind: 'presence', position: [6, 2.5, 2], zone: 'Zone B', fixtureIds: [], auto: false },
      { id: 'p3', name: 'PIR Sensor 3', kind: 'presence', position: [10, 2.5, 2], zone: 'Zone C', fixtureIds: [], auto: false },
    ]
    const s = makeClassroom(3, 4, 4, customSensors)
    const p = buildPlan(s, s.hardware!)
    expect(p.issues.filter((i) => i.severity === 'error')).toHaveLength(0)
    const r = generateWokwi(p, { spaceId: 't3' })
    const { sketch } = verifyExport(r)
    expect(sketch).toMatch(/Configured AC Outputs:\s*"\);\s*Serial\.println\(3\);/)
    expect(sketch).toMatch(/Configured Fan Outputs:\s*"\);\s*Serial\.println\(4\);/)
    expect(sketch).toMatch(/Configured Light Outputs:\s*"\);\s*Serial\.println\(4\);/)
    expect(sketch).toMatch(/Temperature Sensors:\s*"\);\s*Serial\.println\(3\);/)
    expect(sketch).toMatch(/Light Sensors:\s*"\);\s*Serial\.println\(2\);/)
    expect(sketch).toMatch(/Occupancy \(PIR\) Sensors:\s*"\);\s*Serial\.println\(3\);/)
  })

  it('Test 4: 1 AC, 6 fans, 2 lights', () => {
    const s = makeClassroom(1, 6, 2)
    const p = buildPlan(s, s.hardware!)
    expect(p.issues.filter((i) => i.severity === 'error')).toHaveLength(0)
    const r = generateWokwi(p, { spaceId: 't4' })
    const { sketch } = verifyExport(r)
    expect(sketch).toMatch(/Configured AC Outputs:\s*"\);\s*Serial\.println\(1\);/)
    expect(sketch).toMatch(/Configured Fan Outputs:\s*"\);\s*Serial\.println\(6\);/)
    expect(sketch).toMatch(/Configured Light Outputs:\s*"\);\s*Serial\.println\(2\);/)
  })

  it('Test 5: 0 ACs (2 fans, 2 lights)', () => {
    const s = makeClassroom(0, 2, 2)
    const p = buildPlan(s, s.hardware!)
    expect(p.issues.filter((i) => i.severity === 'error')).toHaveLength(0)
    const r = generateWokwi(p, { spaceId: 't5' })
    const { sketch } = verifyExport(r)
    expect(sketch).toMatch(/Configured AC Outputs:\s*"\);\s*Serial\.println\(0\);/)
    expect(sketch).toMatch(/Configured Fan Outputs:\s*"\);\s*Serial\.println\(2\);/)
    expect(sketch).toMatch(/Configured Light Outputs:\s*"\);\s*Serial\.println\(2\);/)
  })

  it('Test 6: 0 fans (2 ACs, 2 lights)', () => {
    const s = makeClassroom(2, 0, 2)
    const p = buildPlan(s, s.hardware!)
    expect(p.issues.filter((i) => i.severity === 'error')).toHaveLength(0)
    const r = generateWokwi(p, { spaceId: 't6' })
    const { sketch } = verifyExport(r)
    expect(sketch).toMatch(/Configured AC Outputs:\s*"\);\s*Serial\.println\(2\);/)
    expect(sketch).toMatch(/Configured Fan Outputs:\s*"\);\s*Serial\.println\(0\);/)
    expect(sketch).toMatch(/Configured Light Outputs:\s*"\);\s*Serial\.println\(2\);/)
  })

  it('Test 7: Large configuration that exhausts GPIOs handles gracefully without crashing or invalid assignments', () => {
    const s = makeClassroom(5, 10, 25)
    const p = buildPlan(s, s.hardware!)
    expect(p.parts.some((pt) => pt.type === 'pca9685') || p.controllers.length > 1 || p.issues.some((i) => i.severity === 'error')).toBe(true)
    const r = generateWokwi(p, { spaceId: 't7' })
    if (r.ok) {
      const d = JSON.parse(r.files['diagram.json'])
      expect(d.editor).toBe('wokwi')
    } else {
      expect(typeof r.reason).toBe('string')
      expect(r.reason.length).toBeGreaterThan(0)
    }
  })
})
