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
import type { ControllerFamily, HardwareConfig, ObjectKind, Space } from '@/types'

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
    const many = plan(Array<ObjectKind>(20).fill('ceilingLight'), { scaling: 'expanders' })
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
