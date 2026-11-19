import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildPlan } from '@/iot/planner'
import { defaultHardware } from '@/iot/requirements'
import { generateWokwi, generateWokwiZip, WOKWI_ZIP_ROOT, wokwiSupport } from '@/iot/wokwi'
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
    expect(Object.keys(r.files).sort()).toEqual([
      '.gitignore',
      '.vscode/extensions.json',
      '.vscode/settings.json',
      'README.md',
      'diagram.json',
      'libraries.txt',
      'platformio.ini',
      'sketch.ino',
      'src/main.cpp',
      'wokwi.toml',
    ].sort())
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
    expect(r.files['src/main.cpp']).toBeDefined()
    expect(r.files['src/main.cpp']).toBe(r.files['sketch.ino'])
    expect(r.files['platformio.ini']).toBeDefined()
    expect(r.files['libraries.txt']).toBeDefined()
    expect(r.files['wokwi.toml']).toBeDefined()
    expect(r.files['README.md']).toBeDefined()
    expect(r.files['.gitignore']).toBeDefined()
    expect(r.files['.vscode/extensions.json']).toBeDefined()
    expect(r.files['.vscode/settings.json']).toBeDefined()

    expect(r.files['platformio.ini']).toContain('framework = arduino')
    expect(r.files['platformio.ini']).toContain('monitor_speed = 115200')
    expect(r.files['wokwi.toml']).toContain('.pio/build/')

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
    const servos = diagram.parts.filter((pt: { type: string }) => pt.type === 'wokwi-servo')
    expect(servos.length).toBe(2) // 1 AC servo + 1 Fan servo
    const leds = diagram.parts.filter((pt: { type: string }) => pt.type === 'wokwi-led')
    expect(leds.length).toBe(1) // 1 Light LED
    expect(sketch).toMatch(/Configured AC Outputs:\s*"\);\s*Serial\.println\(1\);/)
    expect(sketch).toMatch(/Configured Fan Outputs:\s*"\);\s*Serial\.println\(1\);/)
    expect(sketch).toMatch(/Configured Light Outputs:\s*"\);\s*Serial\.println\(1\);/)
  })

  it('Test 2: 2 ACs, 4 fans, 4 lights', () => {
    const s = makeClassroom(2, 4, 4)
    const p = buildPlan(s, s.hardware!)
    expect(p.issues.filter((i) => i.severity === 'error')).toHaveLength(0)
    const r = generateWokwi(p, { spaceId: 't2' })
    const { diagram, sketch } = verifyExport(r)
    const servos = diagram.parts.filter((pt: { type: string }) => pt.type === 'wokwi-servo')
    expect(servos.length).toBe(6) // 2 AC servos + 4 Fan servos
    const leds = diagram.parts.filter((pt: { type: string }) => pt.type === 'wokwi-led')
    expect(leds.length).toBe(4) // 4 Light LEDs
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

  it('Test 6b: Multi-zone classroom with 4 light sensors (needs TCA9548A in real plan) exports successfully as ESP32 with LDRs in Wokwi', () => {
    const customSensors: SensorPoint[] = [
      { id: 't1', name: 'Temp Sensor 1', kind: 'temperature', position: [2, 1.2, 2], zone: 'Zone A', fixtureIds: [], auto: false },
      { id: 't2', name: 'Temp Sensor 2', kind: 'temperature', position: [6, 1.2, 2], zone: 'Zone B', fixtureIds: [], auto: false },
      { id: 't3', name: 'Temp Sensor 3', kind: 'temperature', position: [10, 1.2, 2], zone: 'Zone C', fixtureIds: [], auto: false },
      { id: 't4', name: 'Temp Sensor 4', kind: 'temperature', position: [12, 1.2, 2], zone: 'Zone D', fixtureIds: [], auto: false },
      { id: 'l1', name: 'Light Sensor 1', kind: 'light', position: [2, 0.8, 3], zone: 'Zone A', fixtureIds: [], auto: false },
      { id: 'l2', name: 'Light Sensor 2', kind: 'light', position: [6, 0.8, 3], zone: 'Zone B', fixtureIds: [], auto: false },
      { id: 'l3', name: 'Light Sensor 3', kind: 'light', position: [10, 0.8, 3], zone: 'Zone C', fixtureIds: [], auto: false },
      { id: 'l4', name: 'Light Sensor 4', kind: 'light', position: [12, 0.8, 3], zone: 'Zone D', fixtureIds: [], auto: false },
    ]
    const s = makeClassroom(4, 2, 5, customSensors)
    const p = buildPlan(s, s.hardware!)
    expect(p.parts.some((pt) => pt.type === 'tca9548a')).toBe(true)
    const r = generateWokwi(p, { spaceId: 't6b' })
    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error(r.reason)
    expect(r.board).toBe('esp32')
    const { diagram } = verifyExport(r)
    expect(diagram.parts.some((pt: { type: string }) => pt.type === 'board-esp32-devkit-c-v4')).toBe(true)
    expect(diagram.parts.some((pt: { type: string }) => pt.type === 'tca9548a')).toBe(false)
    const ldrs = diagram.parts.filter((pt: { type: string }) => pt.type === 'wokwi-photoresistor-sensor')
    expect(ldrs.length).toBe(4)
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

describe('Complete PlatformIO + Wokwi ZIP Export (Section 8 Verification)', () => {
  function extractStoredZip(zipBuf: Uint8Array): Map<string, Uint8Array> {
    const files = new Map<string, Uint8Array>()
    let offset = 0
    const view = new DataView(zipBuf.buffer, zipBuf.byteOffset, zipBuf.byteLength)
    while (offset + 30 <= zipBuf.length) {
      const sig = view.getUint32(offset, true)
      if (sig !== 0x04034b50) break // local file header signature PK\x03\x04
      const nameLen = view.getUint16(offset + 26, true)
      const extraLen = view.getUint16(offset + 28, true)
      const dataSize = view.getUint32(offset + 22, true)
      const nameBytes = zipBuf.subarray(offset + 30, offset + 30 + nameLen)
      const filename = new TextDecoder().decode(nameBytes)
      const dataStart = offset + 30 + nameLen + extraLen
      const data = zipBuf.subarray(dataStart, dataStart + dataSize)
      files.set(filename, data)
      offset = dataStart + dataSize
    }
    return files
  }

  it('generates a complete, ready-to-build PlatformIO + Wokwi ZIP with exact structure', () => {
    const s = createSpace({ name: 'Classroom 101', type: 'classroom', dims: { length: 12, width: 8, height: 3 } })
    s.objects = [
      createObject('acVent', 3, 2, s),
      createObject('ceilingFan', 6, 2, s),
      createObject('ceilingLight', 3, 5, s),
      createObject('ceilingLight', 6, 5, s),
    ]
    s.hardware = defaultHardware(s)
    const p = buildPlan(s, s.hardware)
    const r = generateWokwi(p, { spaceId: 'c101' })
    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error(r.reason)

    const zipBytes = generateWokwiZip(r)
    expect(zipBytes.length).toBeGreaterThan(100)

    // Extract into a clean temporary directory
    const tempDir = mkdtempSync(join(tmpdir(), 'pio-wokwi-test-'))
    const extracted = extractStoredZip(zipBytes)
    expect(extracted.size).toBeGreaterThanOrEqual(10)

    for (const [relPath, data] of extracted.entries()) {
      const fullPath = join(tempDir, relPath)
      mkdirSync(dirname(fullPath), { recursive: true })
      writeFileSync(fullPath, data)
    }

    const projectRoot = join(tempDir, WOKWI_ZIP_ROOT)
    expect(existsSync(projectRoot)).toBe(true)

    // 1. Verify exact required files and folders exist
    expect(existsSync(join(projectRoot, 'src'))).toBe(true)
    expect(existsSync(join(projectRoot, 'src', 'main.cpp'))).toBe(true)
    expect(existsSync(join(projectRoot, 'diagram.json'))).toBe(true)
    expect(existsSync(join(projectRoot, 'platformio.ini'))).toBe(true)
    expect(existsSync(join(projectRoot, 'wokwi.toml'))).toBe(true)
    expect(existsSync(join(projectRoot, 'sketch.ino'))).toBe(true)
    expect(existsSync(join(projectRoot, 'libraries.txt'))).toBe(true)
    expect(existsSync(join(projectRoot, 'README.md'))).toBe(true)
    expect(existsSync(join(projectRoot, '.gitignore'))).toBe(true)
    expect(existsSync(join(projectRoot, '.vscode', 'extensions.json'))).toBe(true)
    expect(existsSync(join(projectRoot, '.vscode', 'settings.json'))).toBe(true)

    // Ensure .pio build directory is NOT included in export (generated locally by PlatformIO)
    expect(existsSync(join(projectRoot, '.pio'))).toBe(false)

    // 2. Verify firmware synchronization
    const mainCpp = readFileSync(join(projectRoot, 'src', 'main.cpp'), 'utf8')
    const sketchIno = readFileSync(join(projectRoot, 'sketch.ino'), 'utf8')
    expect(mainCpp).toBe(sketchIno)
    expect(mainCpp).toContain('#include <Arduino.h>')
    expect(mainCpp).toContain('void setup()')
    expect(mainCpp).toContain('void loop()')

    // 3. Verify PlatformIO configuration
    const pioIni = readFileSync(join(projectRoot, 'platformio.ini'), 'utf8')
    expect(pioIni).toContain('[env:esp32dev]')
    expect(pioIni).toContain('platform = espressif32')
    expect(pioIni).toContain('board = esp32dev')
    expect(pioIni).toContain('framework = arduino')
    expect(pioIni).toContain('monitor_speed = 115200')
    expect(pioIni).toContain('adafruit/DHT sensor library')
    expect(pioIni).toContain('adafruit/Adafruit Unified Sensor')
    expect(pioIni).toContain('madhephaestus/ESP32Servo')

    // 4. Verify Wokwi configuration paths match PlatformIO environment
    const toml = readFileSync(join(projectRoot, 'wokwi.toml'), 'utf8')
    expect(toml).toContain('firmware = ".pio/build/esp32dev/firmware.bin"')
    expect(toml).toContain('elf = ".pio/build/esp32dev/firmware.elf"')

    // 5. Verify Circuit diagram
    const diagram = JSON.parse(readFileSync(join(projectRoot, 'diagram.json'), 'utf8'))
    expect(diagram.editor).toBe('wokwi')
    expect(diagram.parts.some((pt: { type: string }) => pt.type === 'board-esp32-devkit-c-v4')).toBe(true)

    // 6. Verify README step-by-step instructions
    const readme = readFileSync(join(projectRoot, 'README.md'), 'utf8')
    expect(readme).toContain('SMART_SPACE_Wokwi_Project')
    expect(readme).toContain('PlatformIO: Build')
    expect(readme).toContain('Wokwi: Start Simulator')
    expect(readme).toContain('.pio')
    expect(readme).toContain('115200')

    // 7. Verify .gitignore ignores .pio
    const gitignore = readFileSync(join(projectRoot, '.gitignore'), 'utf8')
    expect(gitignore).toContain('.pio/')

    // 8. Verify .vscode extensions recommend PlatformIO and Wokwi
    const ext = JSON.parse(readFileSync(join(projectRoot, '.vscode', 'extensions.json'), 'utf8'))
    expect(ext.recommendations).toContain('platformio.platformio-ide')
    expect(ext.recommendations).toContain('wokwi.wokwi-vscode')
  })

  it('dynamic export: different classroom configurations produce unique matching firmware and circuits', () => {
    // Config 1: 1 AC, 1 fan
    const s1 = createSpace({ name: 'Small Lab', type: 'classroom', dims: { length: 8, width: 6, height: 3 } })
    s1.objects = [createObject('acVent', 2, 2, s1), createObject('ceilingFan', 4, 2, s1)]
    s1.hardware = defaultHardware(s1)
    const p1 = buildPlan(s1, s1.hardware)
    const r1 = generateWokwi(p1, { spaceId: 'lab1' })
    if (!r1.ok) throw new Error(r1.reason)

    // Config 2: 2 ACs, 3 fans
    const s2 = createSpace({ name: 'Big Lecture', type: 'classroom', dims: { length: 14, width: 10, height: 3 } })
    s2.objects = [
      createObject('acVent', 2, 2, s2),
      createObject('acVent', 8, 2, s2),
      createObject('ceilingFan', 3, 4, s2),
      createObject('ceilingFan', 6, 4, s2),
      createObject('ceilingFan', 9, 4, s2),
    ]
    s2.hardware = defaultHardware(s2)
    const p2 = buildPlan(s2, s2.hardware)
    const r2 = generateWokwi(p2, { spaceId: 'lec2' })
    if (!r2.ok) throw new Error(r2.reason)

    // Ensure dynamic outputs differ
    expect(r1.files['src/main.cpp']).not.toEqual(r2.files['src/main.cpp'])
    expect(r1.files['diagram.json']).not.toEqual(r2.files['diagram.json'])
    expect(r1.files['src/main.cpp']).toMatch(/Configured AC Outputs:\s*"\);\s*Serial\.println\(1\);/)
    expect(r2.files['src/main.cpp']).toMatch(/Configured AC Outputs:\s*"\);\s*Serial\.println\(2\);/)
  })
})
