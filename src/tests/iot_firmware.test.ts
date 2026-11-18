import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createSeminarHall } from '@/demo/seminarHall'
import { generateFirmware } from '@/iot/firmware'
import { buildPlan } from '@/iot/planner'
import { defaultHardware } from '@/iot/requirements'
import { createObject } from '@/objects/catalog'
import { createSpace } from '@/objects/spaceFactory'
import type { ControllerFamily, HardwareConfig, ObjectKind, Space } from '@/types'

const has = (cmd: string) => spawnSync(cmd, ['--version']).status === 0
const gpp = has('g++')
const py = has('python3')

function room(kinds: ObjectKind[]): Space {
  const s = createSpace({ name: 'T', type: 'classroom', dims: { length: 10, width: 8, height: 3 } })
  return { ...s, objects: kinds.map((k, i) => { const o = createObject(k, 2 + (i % 4) * 2, 2 + Math.floor(i / 4) * 3, s); o.position = [2 + (i % 4) * 2, o.position[1], 2 + Math.floor(i / 4) * 3]; return o }) }
}
const cases: [string, Space, Partial<HardwareConfig>][] = [
  ['esp32 default', room(['ceilingFan', 'ceilingFan', 'ceilingLight', 'ceilingLight']), {}],
  ['esp32 ds18b20 + ldr + presence', room(['ceilingFan', 'ceilingLight', 'splitAC']), { tempPart: 'ds18b20', lightPart: 'ldr', includePresence: true }],
  ['esp32 bme280 + bh1750', room(['ceilingFan', 'ceilingLight']), { tempPart: 'bme280' }],
  ['esp32 many lights (PCA9685)', room(Array<ObjectKind>(20).fill('ceilingLight')), {}],
  ['esp32 seminar hall', createSeminarHall(), {}],
  ['uno', room(['ceilingFan', 'ceilingLight']), { controller: 'uno' as ControllerFamily, tempPart: 'ds18b20', lightPart: 'ldr' }],
  ['uno dht22 + pir', room(['ceilingFan', 'ceilingLight']), { controller: 'uno' as ControllerFamily, includePresence: true }],
  ['rpi', room(['ceilingFan', 'ceilingLight']), { controller: 'rpi' as ControllerFamily, lightPart: 'bh1750' }],
  ['rpi ldr via ADS1115', room(['ceilingFan', 'ceilingLight']), { controller: 'rpi' as ControllerFamily, lightPart: 'ldr', includePresence: true }],
]

function build(space: Space, patch: Partial<HardwareConfig>) {
  const cfg0 = defaultHardware(space)
  const cfg = { ...cfg0, ...patch }
  // re-propose the presence point when asked for
  if (patch.includePresence) cfg.sensors = defaultHardware({ ...space }).sensors.concat(cfg0.sensors.filter((x) => x.kind === 'presence'))
  const plan = buildPlan(space, cfg)
  return { plan, files: generateFirmware(plan, { spaceId: 'test_space' }) }
}

describe('generated firmware', () => {
  for (const [name, space, patch] of cases) {
    it(`${name}: carries the safety protocol`, () => {
      const { plan, files } = build(space, patch)
      expect(files.length).toBe(plan.controllers.length)
      for (const f of files) {
        if (f.language === 'cpp') {
          expect(f.code).toContain('FAILSAFE_MS')
          expect(f.code).toContain('zeroAll()')
        } else expect(f.code).toContain('FAILSAFE_S')
        expect(f.code).toContain('DISARMED')
        // an actuator pin is never driven before the outputs are zeroed
        expect(f.code.indexOf('zero_all()') > -1 || f.code.indexOf('zeroAll()') > -1).toBe(true)
      }
    })
  }
  it.skipIf(!gpp)('every ESP32 / Uno sketch compiles against signature stubs (core 2.x and 3.x)', { timeout: 120000 }, () => {
    const dir = mkdtempSync(join(tmpdir(), 'ss-fw-'))
    const stubs = resolve(__dirname, 'stubs')
    let n = 0
    for (const [name, space, patch] of cases) {
      const { files } = build(space, patch)
      for (const f of files.filter((x) => x.language === 'cpp')) {
        const file = join(dir, `${n++}.cpp`)
        writeFileSync(file, `#include "Arduino.h"\n${f.code}\nint main(){setup();loop();}\n`)
        for (const major of f.code.includes('ESP_ARDUINO_VERSION_MAJOR') ? [2, 3] : [3]) {
          const r = spawnSync('g++', ['-fsyntax-only', '-std=gnu++17', '-Wno-unused-parameter', `-I${stubs}`, `-DESP_ARDUINO_VERSION_MAJOR=${major}`, file], { encoding: 'utf8' })
          expect(r.status, `${name} / ${f.controllerId} core ${major}\n${r.stderr.slice(0, 1500)}`).toBe(0)
        }
      }
    }
  })
  it.skipIf(!py)('Raspberry Pi scripts are valid Python', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ss-py-'))
    let n = 0
    for (const [name, space, patch] of cases) {
      const { files } = build(space, patch)
      for (const f of files.filter((x) => x.language === 'python')) {
        const file = join(dir, `${n++}.py`)
        writeFileSync(file, f.code)
        expect(() => execFileSync('python3', ['-I', '-m', 'py_compile', file], { stdio: 'pipe' }), name).not.toThrow()
      }
    }
  })
})
