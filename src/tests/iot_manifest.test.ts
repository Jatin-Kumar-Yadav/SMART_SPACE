import { describe, expect, it } from 'vitest'
import { createSeminarHall } from '@/demo/seminarHall'
import { generateFirmware } from '@/iot/firmware'
import { highlight } from '@/iot/highlight'
import { buildManifest, checkManifest, wireClass } from '@/iot/manifest'
import { buildPlan } from '@/iot/planner'
import { buildProject } from '@/iot/project'
import { defaultHardware, proposeSensors } from '@/iot/requirements'
import { sampleSensor } from '@/iot/simbridge'
import { layoutCircuit } from '@/iot/circuit'
import { generateWokwi } from '@/iot/wokwi'
import { SimEngine } from '@/simulation/engine'
import type { HardwareConfig, Space } from '@/types'

function build(patch: Partial<HardwareConfig> = {}, sp?: Space) {
  const space = sp ?? createSeminarHall()
  const cfg = { ...defaultHardware(space), ...patch }
  space.hardware = cfg
  const plan = buildPlan(space, cfg)
  const fw = generateFirmware(plan, { spaceId: space.id })
  return { space, cfg, plan, fw, manifest: buildManifest(plan, space, cfg) }
}

describe('hardware manifest', () => {
  const b = build()
  it('is internally consistent and has one entry per non-expander part', () => {
    expect(checkManifest(b.manifest)).toEqual([])
    const n = b.manifest.controllers.reduce((s, c) => s + c.devices.length, 0)
    expect(n).toBe(b.plan.parts.filter((p) => !['pca9685', 'tca9548a', 'ads1115'].includes(p.type)).length)
  })
  it('controller roles: standalone for one, one master + nodes for many', () => {
    const many = b.manifest.controllers
    if (many.length === 1) expect(many[0].role).toBe('standalone')
    else { expect(many.filter((c) => c.role === 'master')).toHaveLength(1); expect(many.filter((c) => c.role === 'node').length).toBe(many.length - 1) }
  })
  it('every output GPIO in the manifest is the same number the firmware table and the netlist use', () => {
    for (const c of b.manifest.controllers) {
      const code = b.fw.find((f) => f.controllerId === c.id)!.code
      for (const d of c.devices.filter((x) => x.kind === 'output' && x.gpio != null)) {
        expect(code, `${d.id} in firmware`).toContain(`{"${d.id}", ${d.gpio},`)
        const net = b.plan.nets.find((n) => n.id === `sig:${d.id}`)!
        expect(net.endpoints.some((e) => e.owner === c.id && e.pin === d.pin)).toBe(true)
      }
    }
  })
  it('motors always need a driver and are never on a controller pin without one', () => {
    const motors = b.manifest.controllers.flatMap((c) => c.devices).filter((d) => d.type === 'dcMotor')
    expect(motors.length).toBeGreaterThan(0)
    expect(motors.every((m) => m.driverRequired)).toBe(true)
  })
  it('is deterministic', () => {
    const a = JSON.stringify(build({}, createSeminarHall()).manifest.controllers.map((c) => c.devices.map((d) => [d.id, d.pin])))
    const c = JSON.stringify(build({}, createSeminarHall()).manifest.controllers.map((c2) => c2.devices.map((d) => [d.id, d.pin])))
    expect(a).toBe(c)
  })
})

describe('sensor density', () => {
  it('zoneCount controls the number of temperature sensors (one per zone)', () => {
    const s = createSeminarHall()
    const base = { excludedDeviceIds: [], includePresence: false }
    const two = proposeSensors(s, { ...base, zoneCount: 2 }).filter((x) => x.kind === 'temperature')
    const five = proposeSensors(s, { ...base, zoneCount: 5 }).filter((x) => x.kind === 'temperature')
    expect(two).toHaveLength(2)
    expect(five).toHaveLength(5)
    expect(new Set(five.map((x) => x.zone)).size).toBe(5)
  })
})

describe('circuit layout + wire colours', () => {
  const b = build()
  it('colours follow the electrical function', () => {
    const cls = new Set(layoutCircuit(b.plan, b.plan.controllers[0].id).wires.map((w) => w.cls))
    expect(cls.has('power')).toBe(true)
    expect(cls.has('ground')).toBe(true)
    expect(cls.has('pwm')).toBe(true)
    expect(cls.has('sensor') || cls.has('comms')).toBe(true)
    const motorNet = b.plan.nets.find((n) => n.id.startsWith('sig:fan'))!
    expect(wireClass(motorNet, b.plan.parts)).toBe('pwm')
  })
  it('every wire connects pins that exist on drawn components', () => {
    for (const c of b.plan.controllers) {
      const l = layoutCircuit(b.plan, c.id)
      expect(l.wires.length).toBeGreaterThan(0)
      for (const w of l.wires) { expect(l.boxes.some((x) => x.id === w.hub)).toBe(true); expect(l.boxes.some((x) => x.id === w.target)).toBe(true) }
    }
  })
  it('inputs and outputs are tagged for the filter', () => {
    const l = layoutCircuit(b.plan, b.plan.controllers[0].id)
    expect(l.boxes.some((x) => x.io === 'input')).toBe(true)
    expect(l.boxes.some((x) => x.io === 'output')).toBe(true)
  })
})

describe('project export', () => {
  it('contains manifest, per-controller wokwi files and real firmware', () => {
    const b = build()
    const wokwi = Object.fromEntries(b.plan.controllers.map((c) => [c.id, generateWokwi(b.plan, { spaceId: b.space.id, controllerId: c.id })]))
    const files = buildProject(b.plan, b.manifest, b.fw, wokwi, 'guide').map((f) => f.name)
    expect(files).toContain('manifest.json')
    for (const c of b.plan.controllers) {
      expect(files).toContain(`hardware/${c.id}/sketch.ino`)
      expect(files).toContain(`hardware/${c.id}/diagram.json`)
      expect(files).toContain(`hardware/${c.id}/libraries.txt`)
      expect(files).toContain(`hardware/${c.id}/wokwi.toml`)
      expect(files.some((f) => f.startsWith(`hardware/${c.id}/firmware/`))).toBe(true)
    }
  })
})

describe('sensor injection reaches the shared simulation', () => {
  it('setting a temperature sensor changes what the engine reports and drives the cooling devices', () => {
    const b = build()
    const sc = b.space.scenarios.find((x) => x.id === b.space.activeScenarioId) ?? b.space.scenarios[0]
    const eng = new SimEngine(b.space, sc)
    const sp = b.cfg.sensors.find((s) => s.kind === 'temperature')!
    const before = sampleSensor(eng.snapshot(), b.space, sp)!.value
    eng.assimilateTemperature(sp.position[0], sp.position[2], 38)
    const after = sampleSensor(eng.snapshot(), b.space, sp)!.value
    expect(after).toBeGreaterThan(before + 3)
    expect(Math.round(after)).toBe(38)
  })
})

describe('code highlighter', () => {
  it('tags keywords, strings, comments and numbers', () => {
    const l = highlight('int x = 5; // note\nconst char* s = "hi";', 'cpp')
    expect(l).toHaveLength(2)
    expect(l[0].some((t) => t.t === 'type' && t.s === 'int')).toBe(true)
    expect(l[0].some((t) => t.t === 'num')).toBe(true)
    expect(l[0].some((t) => t.t === 'com')).toBe(true)
    expect(l[1].some((t) => t.t === 'str')).toBe(true)
    expect(l.flat().map((t) => t.s).join('')).toBe('int x = 5; // note' + 'const char* s = "hi";')
  })
})

describe('master / node scaling (default)', () => {
  it('a large room is split over several controllers with no expanders, one master, and every node exports to Wokwi', () => {
    const b = build()
    expect(b.plan.controllers.length).toBeGreaterThan(1)
    expect(b.plan.parts.some((p) => ['pca9685', 'tca9548a', 'ads1115'].includes(p.type))).toBe(false)
    expect(b.manifest.controllers.filter((c) => c.role === 'master')).toHaveLength(1)
    for (const c of b.plan.controllers) expect(generateWokwi(b.plan, { spaceId: b.space.id, controllerId: c.id }).ok).toBe(true)
    expect(b.plan.issues.filter((i) => i.severity === 'error')).toEqual([])
  })
  it('one temperature + one light sensor per zone and one output per room device (no merging)', () => {
    const b = build()
    const zones = new Set(b.cfg.sensors.map((s) => s.zone))
    expect(b.cfg.sensors.filter((s) => s.kind === 'temperature')).toHaveLength(zones.size)
    expect(b.cfg.sensors.filter((s) => s.kind === 'light')).toHaveLength(zones.size)
    const devs = b.space.objects.filter((o) => o.device)
    const outputs = b.manifest.controllers.flatMap((c) => c.devices).filter((d) => d.kind === 'output')
    expect(outputs.length).toBeGreaterThanOrEqual(devs.length)
    for (const o of devs) expect(outputs.some((d) => d.virtualDeviceId === o.id)).toBe(true)
  })
})

describe('motor and its driver are separate drawn components', () => {
  it('gate ← controller, supply + → motor, motor − → drain, source → GND; nothing wires a motor straight to a GPIO', () => {
    const b = build()
    for (const c of b.plan.controllers) {
      const l = layoutCircuit(b.plan, c.id)
      for (const m of b.plan.parts.filter((p) => p.controllerId === c.id && p.type === 'dcMotor')) {
        const drv = l.boxes.find((x) => x.id === `drv-${m.id}`)!
        const mot = l.boxes.find((x) => x.id === m.id)!
        expect(drv.pins.map((p) => p.name).sort()).toEqual(['DRAIN', 'GATE', 'GND'])
        expect(mot.pins.map((p) => p.name).sort()).toEqual(['+', '−'])
        const mine = l.wires.filter((w) => w.target === m.id)
        expect(mine.some((w) => w.hub === c.id && w.cls === 'pwm')).toBe(true) // controller → gate
        expect(mine.some((w) => w.cls === 'motor-power')).toBe(true)
        expect(l.wires.some((w) => w.id === `load:${m.id}`)).toBe(true)
        // the controller's wire lands on the driver, never on the motor box
        const gate = l.wires.find((w) => w.target === m.id && w.hub === c.id && w.cls === 'pwm')!
        const end = gate.points[gate.points.length - 1]
        expect(drv.pins.some((p) => p.x === end[0] && p.y === end[1])).toBe(true)
      }
    }
  })
})
