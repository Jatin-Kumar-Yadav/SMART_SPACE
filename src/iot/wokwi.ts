import { BOARDS, pinPreference, pinSupports } from './boards'
import { generateFirmware } from './firmware'
import { PARTS } from './parts'
import type { HardwarePlan, PartType } from './types'

/**
 * Wokwi export. Wokwi simulates only some of our parts (see docs/wokwi-notes.md), so the export is a clearly
 * labelled SIMULATION COPY: unsupported parts are substituted, never silently dropped, and the real-hardware
 * firmware / wiring is generated separately and left unchanged.
 */
export interface Substitution {
  partId: string
  from: PartType
  to: PartType
  reason: string
}

export type WokwiResult =
  | {
      ok: true
      controllerId: string
      board: 'esp32' | 'uno'
      files: { 'diagram.json': string; 'sketch.ino': string; 'libraries.txt': string; 'wokwi.toml': string; 'README.md': string }
      substitutions: Substitution[]
      warnings: string[]
      /** page that opens a blank project of the right board (no import URL is documented by Wokwi) */
      openUrl: string
      openUrlVerified: boolean
    }
  | { ok: false; reason: string }

const SUBSTITUTE: Partial<Record<PartType, { to: PartType; reason: string }>> = {
  bme280: { to: 'dht22', reason: 'Wokwi has no BME280 (only BMP180); a DHT22 stands in for the temperature reading.' },
  bh1750: { to: 'ldr', reason: 'Wokwi has no BH1750; the photoresistor module stands in. It reports a relative level, not lux.' },
  dcMotor: { to: 'led', reason: 'Wokwi has no DC motor; an LED + 220 Ω resistor on the same PWM pin stands in. The MOSFET driver and supply are omitted from the copy.' },
}
const NOT_SUPPORTED: Partial<Record<PartType, string>> = {
  pca9685: 'PCA9685 PWM driver',
  ads1115: 'ADS1115 ADC',
  tca9548a: 'TCA9548A I²C multiplexer',
}

export function wokwiSupport(plan: HardwarePlan, controllerId?: string): { ok: true } | { ok: false; reason: string } {
  if (plan.family === 'rpi') return { ok: false, reason: 'Wokwi supports the Raspberry Pi Pico family, not a full Raspberry Pi 3/4/5, so this controller cannot be exported. Use the Python script on real hardware.' }
  const ctrl = controllerId ?? plan.controllers[0]?.id
  if (!ctrl) return { ok: false, reason: 'There is no controller in the plan yet. Generate the hardware setup first.' }
  const bad = plan.parts.filter((p) => p.controllerId === ctrl && NOT_SUPPORTED[p.type])
  if (bad.length) {
    const names = [...new Set(bad.map((p) => NOT_SUPPORTED[p.type]))].join(', ')
    return { ok: false, reason: `${ctrl} needs ${names}, which Wokwi does not offer. Reduce the room, use a different sensor, or build this controller on real hardware.` }
  }
  return { ok: true }
}

const uniq = <T,>(a: T[]) => [...new Set(a)]

/** Wokwi pin name for one of our pin ids. */
function wPin(family: 'esp32' | 'uno', id: string): string {
  if (id === 'GND') return 'GND.1'
  if (id === '3V3') return '3V3'
  if (id === '5V') return '5V'
  if (family === 'esp32') return id.replace('GPIO', '')
  return id.startsWith('D') ? id.slice(1) : id
}

/** Replace the parts Wokwi does not have, re-allocating pins where the substitute needs a different kind. */
function substitute(plan: HardwarePlan, ctrl: string): { plan: HardwarePlan; subs: Substitution[]; warnings: string[] } {
  const p: HardwarePlan = structuredClone(plan)
  const subs: Substitution[] = []
  const warnings: string[] = []
  const board = BOARDS[p.family]
  const used = new Set(p.pins.filter((u) => u.controllerId === ctrl).map((u) => u.pinId))
  const take = (fn: 'digital-io' | 'adc') => {
    const c = board.pins.filter((x) => !used.has(x.id) && pinSupports(x, fn, board.hasWifi)).sort((a, b) => pinPreference(a, fn) - pinPreference(b, fn))[0]
    if (c) used.add(c.id)
    return c
  }
  for (const part of p.parts.filter((x) => x.controllerId === ctrl)) {
    const sub = SUBSTITUTE[part.type]
    if (!sub) continue
    const from = part.type
    if (from === 'bh1750' || from === 'bme280') {
      // leave the I²C bus
      p.pins = p.pins.filter((u) => !(u.partId === part.id && (u.fn === 'i2c-sda' || u.fn === 'i2c-scl')))
      part.i2cAddr = undefined
      part.mux = undefined
      const pin = take(from === 'bme280' ? 'digital-io' : 'adc')
      if (!pin) { warnings.push(`No free pin for the ${PARTS[sub.to].label} that replaces ${part.id}; ${part.id} was left out of the Wokwi copy.`); p.parts = p.parts.filter((x) => x.id !== part.id); continue }
      p.channels[part.id] = { kind: 'gpio', controllerId: ctrl, pinId: pin.id }
      p.pins.push({ controllerId: ctrl, pinId: pin.id, fn: from === 'bme280' ? 'digital-io' : 'adc-in', partId: part.id, signal: from === 'bme280' ? 'DATA' : 'AO' })
    }
    if (from === 'dcMotor') part.params = { resistorOhm: 220 }
    part.type = sub.to
    part.label = `${PARTS[sub.to].label} (Wokwi stand-in for ${PARTS[from].label})`
    subs.push({ partId: part.id, from, to: sub.to, reason: sub.reason })
  }
  // no I²C part left on this controller → no bus
  const stillI2c = p.parts.some((x) => x.controllerId === ctrl && x.i2cAddr != null)
  if (!stillI2c) p.nets = p.nets.filter((n) => n.id !== `${ctrl}:SDA` && n.id !== `${ctrl}:SCL`)
  return { plan: p, subs, warnings }
}

const COLOURS = { power: 'red', ground: 'black', signal: 'green', data: 'blue' }

export function generateWokwi(plan: HardwarePlan, opts: { spaceId: string; controllerId?: string }): WokwiResult {
  const sup = wokwiSupport(plan, opts.controllerId)
  if (!sup.ok) return sup
  const ctrl = opts.controllerId ?? plan.controllers[0].id
  const family = plan.family as 'esp32' | 'uno'
  const { plan: sp, subs, warnings } = substitute(plan, ctrl)
  const boardId = 'mcu'
  const parts: Record<string, unknown>[] = [{ type: BOARDS[family].wokwiType, id: boardId, top: 0, left: 0, attrs: {} }]
  const wires: [string, string, string, string[]][] = []
  const wire = (a: string, b: string, c: string) => wires.push([a, b, c, []])
  const mine = sp.parts.filter((x) => x.controllerId === ctrl)
  let row = 0
  const slot = () => ({ left: 230 + (row % 2) * 150, top: Math.floor(row++ / 2) * 120 - 60 })
  const gpioPin = (id: string) => {
    const ch = sp.channels[id]
    return ch?.kind === 'gpio' ? wPin(family, ch.pinId) : ''
  }
  const vcc = family === 'esp32' ? '3V3' : '5V'
  let oneWireIdx = 0
  let oneWirePull = false
  for (const part of mine) {
    const pos = slot()
    const pin = gpioPin(part.id)
    switch (part.type) {
      case 'dht22':
        parts.push({ type: 'wokwi-dht22', id: part.id, ...pos, attrs: { temperature: '28', humidity: '50' } })
        wire(`${part.id}:VCC`, `${boardId}:${vcc}`, COLOURS.power); wire(`${part.id}:GND`, `${boardId}:GND.1`, COLOURS.ground); wire(`${part.id}:SDA`, `${boardId}:${pin}`, COLOURS.signal)
        break
      case 'ds18b20':
        // the deviceID must be unique per probe on one bus; the exact format Wokwi accepts was not verified
        parts.push({ type: 'wokwi-ds18b20', id: part.id, ...pos, attrs: { temperature: '28', deviceID: `${(++oneWireIdx).toString(16).padStart(2, '0')}` } })
        wire(`${part.id}:VCC`, `${boardId}:${vcc}`, COLOURS.power); wire(`${part.id}:GND`, `${boardId}:GND.1`, COLOURS.ground); wire(`${part.id}:DQ`, `${boardId}:${pin}`, COLOURS.signal)
        if (!oneWirePull) {
          oneWirePull = true
          parts.push({ type: 'wokwi-resistor', id: 'r_1w', left: pos.left + 70, top: pos.top - 30, attrs: { value: '4700' } })
          wire('r_1w:1', `${boardId}:${vcc}`, COLOURS.power); wire('r_1w:2', `${boardId}:${pin}`, COLOURS.signal)
        }
        break
      case 'ldr':
        parts.push({ type: 'wokwi-photoresistor-sensor', id: part.id, ...pos, attrs: { lux: '300' } })
        wire(`${part.id}:VCC`, `${boardId}:${vcc}`, COLOURS.power); wire(`${part.id}:GND`, `${boardId}:GND.1`, COLOURS.ground); wire(`${part.id}:AO`, `${boardId}:${pin}`, COLOURS.signal)
        break
      case 'pir':
        parts.push({ type: 'wokwi-pir-motion-sensor', id: part.id, ...pos, attrs: {} })
        wire(`${part.id}:VCC`, `${boardId}:5V`, COLOURS.power); wire(`${part.id}:GND`, `${boardId}:GND.1`, COLOURS.ground); wire(`${part.id}:OUT`, `${boardId}:${pin}`, COLOURS.signal)
        break
      case 'led': {
        const isSub = subs.some((s) => s.partId === part.id)
        parts.push({ type: 'wokwi-led', id: part.id, ...pos, attrs: { color: isSub ? 'blue' : 'red', label: part.id } })
        parts.push({ type: 'wokwi-resistor', id: `r_${part.id}`, left: pos.left + 60, top: pos.top + 40, attrs: { value: String(part.params?.resistorOhm ?? 220) } })
        wire(`${boardId}:${pin}`, `r_${part.id}:1`, COLOURS.signal); wire(`r_${part.id}:2`, `${part.id}:A`, COLOURS.signal); wire(`${part.id}:C`, `${boardId}:GND.1`, COLOURS.ground)
        break
      }
      default:
        break
    }
  }
  if (family === 'esp32') warnings.push('Pin names "3V3" and "5V" on board-esp32-devkit-c-v4 are unverified; if Wokwi flags a wire, pick the matching power pin in the editor.')
  warnings.push('This diagram was NOT loaded into Wokwi by SmartSpace 3D (the build environment cannot reach wokwi.com). Open it and fix any wire Wokwi flags.')
  warnings.push('Sensor values in Wokwi are set on each part (click it), not by the SmartSpace Live Data link. The simulator cannot reach a broker on your own computer without the paid Wokwi IoT Gateway.')

  const fw = generateFirmware(sp, { spaceId: opts.spaceId, wifiSsid: 'Wokwi-GUEST', mqttHost: 'broker.example.invalid' }).find((f) => f.controllerId === ctrl)!
  let sketch = fw.code
  if (family === 'esp32') {
    sketch = sketch.replace('WiFi.begin(WIFI_SSID, WIFI_PASS);', 'WiFi.begin(WIFI_SSID, WIFI_PASS, 6); // Wokwi virtual access point is open, channel 6')
    sketch = sketch.replace('const char*    WIFI_PASS   = "YOUR_WIFI_PASSWORD";', 'const char*    WIFI_PASS   = "";   // Wokwi-GUEST has no password')
  }
  const banner = `// ##########################################################################
// WOKWI SIMULATION COPY. Not the real-hardware firmware.
${subs.length ? subs.map((s) => `//  substitution: ${s.partId}: ${PARTS[s.from].label} -> ${PARTS[s.to].label}. ${s.reason}`).join('\n') : '//  (no substitutions were needed)'}
//  MQTT host is a placeholder: edit it, or ignore the network and watch the Serial Monitor.
// ##########################################################################
`
  sketch = banner + sketch

  const libs = uniq([...fw.libraries])
  const toml = family === 'esp32'
    ? `# Used by the Wokwi VS Code / CLI workflow only. The web editor compiles sketch.ino itself.\n# Point 'firmware' / 'elf' at YOUR build output (these paths are placeholders).\n[wokwi]\nversion = 1\nfirmware = '.pio/build/esp32dev/firmware.bin'\nelf = '.pio/build/esp32dev/firmware.elf'\n`
    : `# Used by the Wokwi VS Code / CLI workflow only. The web editor compiles sketch.ino itself.\n# Point 'firmware' / 'elf' at YOUR build output (these paths are placeholders).\n[wokwi]\nversion = 1\nfirmware = 'build/arduino.avr.uno/sketch.ino.hex'\nelf = 'build/arduino.avr.uno/sketch.ino.elf'\n`
  const diagram = { version: 1, author: 'SmartSpace 3D', editor: 'wokwi', parts, connections: wires, dependencies: {} }
  const readme = `# SmartSpace 3D → Wokwi (simulation copy)

Controller: ${ctrl} (${BOARDS[family].name})

## Substitutions (Wokwi lacks these parts)
${subs.length ? subs.map((s) => `- **${s.partId}**: ${PARTS[s.from].label} → ${PARTS[s.to].label}. ${s.reason}`).join('\n') : '- none'}

## How to open
1. Open ${family === 'esp32' ? 'https://wokwi.com/projects/new/esp32' : 'https://wokwi.com/projects/new/arduino-uno (unverified URL; otherwise New project → Arduino Uno)'}
2. Replace the contents of **diagram.json** and **sketch.ino** with these files, and add **libraries.txt** (Library Manager).
3. Press Start. Click a sensor to change its value.

## Warnings
${warnings.map((w) => `- ${w}`).join('\n')}
`
  return {
    ok: true, controllerId: ctrl, board: family,
    files: { 'diagram.json': JSON.stringify(diagram, null, 2), 'sketch.ino': sketch, 'libraries.txt': `# Wokwi Library Manager names\n${libs.join('\n')}\n`, 'wokwi.toml': toml, 'README.md': readme },
    substitutions: subs, warnings,
    openUrl: family === 'esp32' ? 'https://wokwi.com/projects/new/esp32' : 'https://wokwi.com/projects/new/arduino-uno',
    openUrlVerified: family === 'esp32',
  }
}

