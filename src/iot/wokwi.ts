import { BOARDS, pinOf, pinPreference, pinSupports } from './boards'
import { PARTS } from './parts'
import type { HardwarePlan, PartType, PlanPart } from './types'

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
      files: {
        'diagram.json': string
        'sketch.ino': string
        'libraries.txt': string
        'wokwi.toml': string
        'README.md': string
      }
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
  if (plan.family === 'rpi') {
    return { ok: false, reason: 'Wokwi supports the Raspberry Pi Pico family, not a full Raspberry Pi 3/4/5, so this controller cannot be exported. Use the Python script on real hardware.' }
  }
  const ctrl = controllerId ?? plan.controllers[0]?.id
  if (!ctrl) {
    return { ok: false, reason: 'There is no controller in the plan yet. Generate the hardware setup first.' }
  }
  const bad = plan.parts.filter((p) => p.controllerId === ctrl && NOT_SUPPORTED[p.type])
  if (bad.length) {
    const names = [...new Set(bad.map((p) => NOT_SUPPORTED[p.type]))].join(', ')
    return { ok: false, reason: `${ctrl} needs ${names}, which Wokwi does not offer. Reduce the room, use a different sensor, or build this controller on real hardware.` }
  }
  return { ok: true }
}

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
    let c = board.pins.filter((x) => !used.has(x.id) && pinSupports(x, fn, board.hasWifi)).sort((a, b) => pinPreference(a, fn) - pinPreference(b, fn))[0]
    if (!c && fn === 'adc') {
      c = board.pins.filter((x) => !used.has(x.id) && pinSupports(x, fn, false)).sort((a, b) => pinPreference(a, fn) - pinPreference(b, fn))[0]
    }
    if (c) used.add(c.id)
    return c
  }

  for (const part of p.parts.filter((x) => x.controllerId === ctrl)) {
    const sub = SUBSTITUTE[part.type]
    if (!sub) continue
    const from = part.type
    if (from === 'bh1750' || from === 'bme280') {
      p.pins = p.pins.filter((u) => !(u.partId === part.id && (u.fn === 'i2c-sda' || u.fn === 'i2c-scl')))
      part.i2cAddr = undefined
      part.mux = undefined
      const pin = take(from === 'bme280' ? 'digital-io' : 'adc')
      if (!pin) {
        warnings.push(`No free pin for the ${PARTS[sub.to].label} that replaces ${part.id}; ${part.id} was left out of the Wokwi copy.`)
        p.parts = p.parts.filter((x) => x.id !== part.id)
        continue
      }
      p.channels[part.id] = { kind: 'gpio', controllerId: ctrl, pinId: pin.id }
      p.pins.push({ controllerId: ctrl, pinId: pin.id, fn: from === 'bme280' ? 'digital-io' : 'adc-in', partId: part.id, signal: from === 'bme280' ? 'DATA' : 'AO' })
    }
    if (from === 'dcMotor') part.params = { resistorOhm: 220 }
    part.type = sub.to
    part.label = `${PARTS[sub.to].label} (Wokwi stand-in for ${PARTS[from].label})`
    subs.push({ partId: part.id, from, to: sub.to, reason: sub.reason })
  }

  const stillI2c = p.parts.some((x) => x.controllerId === ctrl && x.i2cAddr != null)
  if (!stillI2c) p.nets = p.nets.filter((n) => n.id !== `${ctrl}:SDA` && n.id !== `${ctrl}:SCL`)
  return { plan: p, subs, warnings }
}

const WIRE_COLORS = {
  power3v3: '#dc2626', // red
  power5v: '#ea580c',  // orange/red
  ground: '#0f172a',    // black
  dht: '#2563eb',       // blue
  ldr: '#d97706',       // amber
  pir: '#9333ea',       // purple
  ac: '#0284c7',        // sky blue
  fan: '#16a34a',       // green
  light: '#ca8a04',     // yellow
  defaultSignal: '#059669',
}

interface WokwiOptions {
  spaceId: string
  controllerId?: string
  tempThreshold?: number
  lightThreshold?: number
}

export function generateWokwi(plan: HardwarePlan, opts: WokwiOptions): WokwiResult {
  const sup = wokwiSupport(plan, opts.controllerId)
  if (!sup.ok) return sup

  const ctrl = opts.controllerId ?? plan.controllers[0].id
  const family = plan.family as 'esp32' | 'uno'
  const { plan: sp, subs, warnings } = substitute(plan, ctrl)
  const boardId = 'mcu'

  // Center the ESP32 DevKit in the diagram layout
  const boardLeft = 320
  const boardTop = 160
  const parts: Record<string, unknown>[] = [
    { type: BOARDS[family].wokwiType, id: boardId, top: boardTop, left: boardLeft, attrs: {} }
  ]
  const wires: [string, string, string, string[]][] = []
  const wire = (a: string, b: string, c: string) => wires.push([a, b, c, []])

  const mine = sp.parts.filter((x) => x.controllerId === ctrl)
  const gpioPin = (id: string) => {
    const ch = sp.channels[id]
    return ch?.kind === 'gpio' ? wPin(family, ch.pinId) : ''
  }
  const vcc = family === 'esp32' ? '3V3' : '5V'

  // Partition components into logical groups for a clean, readable layout
  const sensors = mine.filter((p) => PARTS[p.type].category === 'sensor' || p.type === 'dht22' || p.type === 'ldr' || p.type === 'pir' || p.type === 'ds18b20')
  const acOutputs = mine.filter((p) => p.virtual?.kind === 'ac' || p.id.startsWith('ac'))
  const fanOutputs = mine.filter((p) => p.virtual?.kind === 'fan' || p.id.startsWith('fan'))
  const lightOutputs = mine.filter((p) => p.virtual?.kind === 'light' || p.id.startsWith('light'))
  const otherOutputs = mine.filter((p) => !sensors.includes(p) && !acOutputs.includes(p) && !fanOutputs.includes(p) && !lightOutputs.includes(p))

  // 1. Position Sensors in a clean column on the LEFT
  let sensorTop = 40
  const sensorLeft = 40
  let oneWireIdx = 0
  let oneWirePull = false

  for (const part of sensors) {
    const pin = gpioPin(part.id)
    if (!pin) continue

    if (part.type === 'dht22') {
      parts.push({
        type: 'wokwi-dht22',
        id: part.id,
        left: sensorLeft,
        top: sensorTop,
        attrs: { temperature: '26.5', humidity: '55' }
      })
      wire(`${part.id}:VCC`, `${boardId}:${vcc}`, WIRE_COLORS.power3v3)
      wire(`${part.id}:GND`, `${boardId}:GND.1`, WIRE_COLORS.ground)
      wire(`${part.id}:SDA`, `${boardId}:${pin}`, WIRE_COLORS.dht)
      sensorTop += 115
    } else if (part.type === 'ldr') {
      parts.push({
        type: 'wokwi-photoresistor-sensor',
        id: part.id,
        left: sensorLeft,
        top: sensorTop,
        attrs: { lux: '350' }
      })
      wire(`${part.id}:VCC`, `${boardId}:${vcc}`, WIRE_COLORS.power3v3)
      wire(`${part.id}:GND`, `${boardId}:GND.1`, WIRE_COLORS.ground)
      wire(`${part.id}:AO`, `${boardId}:${pin}`, WIRE_COLORS.ldr)
      sensorTop += 115
    } else if (part.type === 'pir') {
      parts.push({
        type: 'wokwi-pir-motion-sensor',
        id: part.id,
        left: sensorLeft,
        top: sensorTop,
        attrs: {}
      })
      wire(`${part.id}:VCC`, `${boardId}:5V`, WIRE_COLORS.power5v)
      wire(`${part.id}:GND`, `${boardId}:GND.1`, WIRE_COLORS.ground)
      wire(`${part.id}:OUT`, `${boardId}:${pin}`, WIRE_COLORS.pir)
      sensorTop += 115
    } else if (part.type === 'ds18b20') {
      parts.push({
        type: 'wokwi-ds18b20',
        id: part.id,
        left: sensorLeft,
        top: sensorTop,
        attrs: { temperature: '26.0', deviceID: `${(++oneWireIdx).toString(16).padStart(2, '0')}` }
      })
      wire(`${part.id}:VCC`, `${boardId}:${vcc}`, WIRE_COLORS.power3v3)
      wire(`${part.id}:GND`, `${boardId}:GND.1`, WIRE_COLORS.ground)
      wire(`${part.id}:DQ`, `${boardId}:${pin}`, WIRE_COLORS.dht)
      if (!oneWirePull) {
        oneWirePull = true
        parts.push({ type: 'wokwi-resistor', id: 'r_1w', left: sensorLeft + 70, top: sensorTop - 25, attrs: { value: '4700' } })
        wire('r_1w:1', `${boardId}:${vcc}`, WIRE_COLORS.power3v3)
        wire('r_1w:2', `${boardId}:${pin}`, WIRE_COLORS.dht)
      }
      sensorTop += 115
    }
  }

  // Helper to place an LED output column with accompanying 220-ohm resistors
  const placeLedColumn = (groupParts: PlanPart[], colLeft: number, color: string, wireColor: string, prefix: string) => {
    let top = 40
    groupParts.forEach((part, idx) => {
      const pin = gpioPin(part.id)
      if (!pin) return

      const ledId = part.id
      const resId = `r_${part.id}`
      const num = idx + 1

      parts.push({
        type: 'wokwi-led',
        id: ledId,
        left: colLeft + 70,
        top,
        attrs: { color, label: `${prefix} ${num} (${part.id})` }
      })
      parts.push({
        type: 'wokwi-resistor',
        id: resId,
        left: colLeft,
        top: top + 15,
        attrs: { value: '220' }
      })

      // Wire: MCU GPIO -> Resistor pin 1 -> Resistor pin 2 -> LED Anode -> LED Cathode -> MCU GND
      wire(`${boardId}:${pin}`, `${resId}:1`, wireColor)
      wire(`${resId}:2`, `${ledId}:A`, wireColor)
      wire(`${ledId}:C`, `${boardId}:GND.1`, WIRE_COLORS.ground)

      top += 95
    })
  }

  // 2. Position Actuators in separate organized columns on the RIGHT
  let currentRightCol = boardLeft + 320
  if (acOutputs.length > 0) {
    placeLedColumn(acOutputs, currentRightCol, 'blue', WIRE_COLORS.ac, 'AC')
    currentRightCol += 160
  }
  if (fanOutputs.length > 0) {
    placeLedColumn(fanOutputs, currentRightCol, 'green', WIRE_COLORS.fan, 'Fan')
    currentRightCol += 160
  }
  if (lightOutputs.length > 0) {
    placeLedColumn(lightOutputs, currentRightCol, 'yellow', WIRE_COLORS.light, 'Light')
    currentRightCol += 160
  }
  if (otherOutputs.length > 0) {
    placeLedColumn(otherOutputs, currentRightCol, 'red', WIRE_COLORS.defaultSignal, 'Output')
  }

  // Informative simulation warnings
  warnings.push('Wokwi simulation: Physical ACs and fans are represented by independent labeled indicator LEDs and current-limiting resistors.')
  warnings.push('Run simulation directly in VS Code using the Wokwi for VS Code extension (F1 -> Wokwi: Start Simulator).')

  // Generate runnable Arduino C++ simulation firmware
  const sketch = generateSimulationSketch(sp, ctrl, opts)
  const libs = ['DHT sensor library', 'Adafruit Unified Sensor']
  const toml = `# Wokwi for VS Code Configuration
[wokwi]
version = 1
firmware = 'sketch.ino'
elf = ''
`
  const diagram = {
    version: 1,
    author: 'SMART_SPACE Classroom Digital Twin',
    editor: 'wokwi',
    parts,
    connections: wires,
    dependencies: {}
  }

  const readme = generateReadme(ctrl, family, sp, subs, warnings)

  return {
    ok: true,
    controllerId: ctrl,
    board: family,
    files: {
      'diagram.json': JSON.stringify(diagram, null, 2),
      'sketch.ino': sketch,
      'libraries.txt': libs.join('\n') + '\n',
      'wokwi.toml': toml,
      'README.md': readme,
    },
    substitutions: subs,
    warnings,
    openUrl: family === 'esp32' ? 'https://wokwi.com/projects/new/esp32' : 'https://wokwi.com/projects/new/arduino-uno',
    openUrlVerified: family === 'esp32',
  }
}

/** Generates a self-contained, runnable Arduino C++ simulation sketch for Wokwi */
function generateSimulationSketch(plan: HardwarePlan, ctrl: string, opts: WokwiOptions): string {
  const parts = plan.parts.filter((p) => p.controllerId === ctrl)
  const tempThresh = opts.tempThreshold ?? 24.0
  const lightThresh = opts.lightThreshold ?? 400

  const acs = parts.filter((p) => p.virtual?.kind === 'ac' || p.id.startsWith('ac'))
  const fans = parts.filter((p) => p.virtual?.kind === 'fan' || p.id.startsWith('fan'))
  const lights = parts.filter((p) => p.virtual?.kind === 'light' || p.id.startsWith('light'))
  const dhts = parts.filter((p) => p.type === 'dht22')
  const ldrs = parts.filter((p) => p.type === 'ldr')
  const pirs = parts.filter((p) => p.type === 'pir')

  const getPinNum = (partId: string): number => {
    const ch = plan.channels[partId]
    if (ch?.kind === 'gpio') {
      const p = pinOf(plan.family, ch.pinId)
      return p ? p.num : -1
    }
    return -1
  }

  const code: string[] = []

  // Header & Comments
  code.push(`// ============================================================================`)
  code.push(`// SMART_SPACE — Wokwi Simulation Firmware (Runnable Arduino C++)`)
  code.push(`// Controller: ${ctrl} (${BOARDS[plan.family].name})`)
  code.push(`// WOKWI SIMULATION COPY — Automatically generated from classroom configuration`)
  code.push(`// Wokwi-GUEST virtual access point compatible`)
  code.push(`// ============================================================================`)
  code.push(``)
  code.push(`#include <Arduino.h>`)
  code.push(`#include <DHT.h>`)
  code.push(``)

  // Configurable thresholds
  code.push(`// ----------------------------------------------------------------------------`)
  code.push(`// CONFIGURABLE SIMULATION THRESHOLDS`)
  code.push(`// You can also adjust these dynamically in the Serial Monitor!`)
  code.push(`// ----------------------------------------------------------------------------`)
  code.push(`float TEMP_THRESHOLD_C = ${tempThresh.toFixed(1)}f; // AC turns ON if zone occupied & temp > threshold`)
  code.push(`int   LIGHT_THRESHOLD  = ${lightThresh};    // Lights turn ON if zone occupied & light < threshold`)
  code.push(`bool  ALWAYS_COOL      = false;    // Override: set true to run AC even if zone is unoccupied`)
  code.push(``)

  // Pin Definitions
  code.push(`// ----------------------------------------------------------------------------`)
  code.push(`// EXACT GPIO PIN ASSIGNMENTS (Synchronized with diagram.json)`)
  code.push(`// ----------------------------------------------------------------------------`)

  if (dhts.length > 0) {
    code.push(`// Temperature Sensors (DHT22)`)
    dhts.forEach((d) => {
      code.push(`const int PIN_${d.id.toUpperCase()} = ${getPinNum(d.id)};`)
    })
  }

  if (ldrs.length > 0) {
    code.push(`// Light Sensors (Photoresistor / LDR)`)
    ldrs.forEach((l) => {
      code.push(`const int PIN_${l.id.toUpperCase()} = ${getPinNum(l.id)};`)
    })
  }

  if (pirs.length > 0) {
    code.push(`// Occupancy Sensors (PIR Motion)`)
    pirs.forEach((p) => {
      code.push(`const int PIN_${p.id.toUpperCase()} = ${getPinNum(p.id)};`)
    })
  }

  if (acs.length > 0) {
    code.push(`// AC Outputs (Independent Control)`)
    acs.forEach((a) => {
      code.push(`const int PIN_${a.id.toUpperCase()} = ${getPinNum(a.id)};`)
    })
  }

  if (fans.length > 0) {
    code.push(`// Fan Outputs (Independent Control)`)
    fans.forEach((f) => {
      code.push(`const int PIN_${f.id.toUpperCase()} = ${getPinNum(f.id)};`)
    })
  }

  if (lights.length > 0) {
    code.push(`// Light Outputs (Independent Control)`)
    lights.forEach((l) => {
      code.push(`const int PIN_${l.id.toUpperCase()} = ${getPinNum(l.id)};`)
    })
  }

  code.push(``)

  // Sensor Object Declarations
  dhts.forEach((d) => {
    code.push(`DHT dht_${d.id}(PIN_${d.id.toUpperCase()}, DHT22);`)
  })

  code.push(``)

  // Data Structures
  code.push(`struct OutputDevice {`)
  code.push(`  const char* id;`)
  code.push(`  const char* type;`)
  code.push(`  int pin;`)
  code.push(`  int zoneIndex;`)
  code.push(`  bool state;`)
  code.push(`};`)
  code.push(``)

  code.push(`OutputDevice devices[] = {`)
  acs.forEach((a, i) => {
    code.push(`  {"${a.id}", "AC", PIN_${a.id.toUpperCase()}, ${i % Math.max(1, dhts.length)}, false},`)
  })
  fans.forEach((f, i) => {
    code.push(`  {"${f.id}", "Fan", PIN_${f.id.toUpperCase()}, ${i % Math.max(1, pirs.length || 1)}, false},`)
  })
  lights.forEach((l, i) => {
    code.push(`  {"${l.id}", "Light", PIN_${l.id.toUpperCase()}, ${i % Math.max(1, ldrs.length || 1)}, false},`)
  })
  code.push(`};`)
  code.push(`const int NUM_DEVICES = sizeof(devices) / sizeof(devices[0]);`)
  code.push(``)

  // Setup Function
  code.push(`void setup() {`)
  code.push(`  Serial.begin(115200);`)
  code.push(`  delay(500);`)
  code.push(`  Serial.println("\\n========================================================");`)
  code.push(`  Serial.println(" SMART_SPACE — Wokwi IoT Hardware Simulation Running");`)
  code.push(`  Serial.println("========================================================");`)
  code.push(`  Serial.print("Configured AC Outputs:    "); Serial.println(${acs.length});`)
  code.push(`  Serial.print("Configured Fan Outputs:   "); Serial.println(${fans.length});`)
  code.push(`  Serial.print("Configured Light Outputs: "); Serial.println(${lights.length});`)
  code.push(`  Serial.print("Temperature Sensors:     "); Serial.println(${dhts.length});`)
  code.push(`  Serial.print("Light Sensors:           "); Serial.println(${ldrs.length});`)
  code.push(`  Serial.print("Occupancy (PIR) Sensors: "); Serial.println(${pirs.length});`)
  code.push(`  Serial.println("--------------------------------------------------------");`)
  code.push(`  Serial.println("Commands available in Serial Monitor:");`)
  code.push(`  Serial.println("  TEMP <val>   - Set AC temperature threshold (e.g. TEMP 25.0)");`)
  code.push(`  Serial.println("  LIGHT <val>  - Set Light threshold (e.g. LIGHT 350)");`)
  code.push(`  Serial.println("  COOL ON|OFF  - Toggle override to cool even when unoccupied");`)
  code.push(`  Serial.println("  STATUS       - Print full system telemetry immediately");`)
  code.push(`  Serial.println("========================================================\\n");`)

  // Initialize sensors
  dhts.forEach((d) => {
    code.push(`  dht_${d.id}.begin();`)
  })
  pirs.forEach((p) => {
    code.push(`  pinMode(PIN_${p.id.toUpperCase()}, INPUT);`)
  })
  ldrs.forEach((l) => {
    if (plan.family === 'esp32') {
      code.push(`  analogSetPinAttenuation(PIN_${l.id.toUpperCase()}, ADC_11db);`)
    }
  })

  // Initialize all outputs to safe OFF state
  code.push(``)
  code.push(`  // Initialize all actuator outputs in safe OFF state`)
  code.push(`  for (int i = 0; i < NUM_DEVICES; i++) {`)
  code.push(`    if (devices[i].pin >= 0) {`)
  code.push(`      pinMode(devices[i].pin, OUTPUT);`)
  code.push(`      digitalWrite(devices[i].pin, LOW);`)
  code.push(`      devices[i].state = false;`)
  code.push(`    }`)
  code.push(`  }`)
  code.push(`  Serial.println("[BOOT] All outputs initialized in safe OFF state.\\n");`)
  code.push(`}`)
  code.push(``)

  // Loop Function
  code.push(`unsigned long lastCheck = 0;`)
  code.push(`const unsigned long CHECK_INTERVAL_MS = 2000;`)
  code.push(``)
  code.push(`void handleSerialCommand();`)
  code.push(`void evaluateAndLogTelemetry();`)
  code.push(``)
  code.push(`void loop() {`)
  code.push(`  handleSerialCommand();`)
  code.push(``)
  code.push(`  unsigned long now = millis();`)
  code.push(`  if (now - lastCheck >= CHECK_INTERVAL_MS) {`)
  code.push(`    lastCheck = now;`)
  code.push(`    evaluateAndLogTelemetry();`)
  code.push(`  }`)
  code.push(`}`)
  code.push(``)

  // Simulation Rule Evaluation & Telemetry
  code.push(`void evaluateAndLogTelemetry() {`)
  code.push(`  Serial.println("--------------------------------------------------------");`)
  code.push(`  Serial.print("[TELEMETRY] Uptime: "); Serial.print(millis() / 1000); Serial.println("s");`)

  // 1. Read temperature sensors
  if (dhts.length > 0) {
    code.push(`  float temps[${dhts.length}];`)
    dhts.forEach((d, idx) => {
      code.push(`  temps[${idx}] = dht_${d.id}.readTemperature();`)
      code.push(`  if (isnan(temps[${idx}])) temps[${idx}] = 25.0f; // fallback if Wokwi DHT uninitialized`)
      code.push(`  Serial.print("  Temp Sensor [${d.id}]: "); Serial.print(temps[${idx}]); Serial.println(" °C");`)
    })
  } else {
    code.push(`  float temps[1] = { 25.0f };`)
  }

  // 2. Read light sensors
  if (ldrs.length > 0) {
    code.push(`  int lightsVal[${ldrs.length}];`)
    ldrs.forEach((l, idx) => {
      code.push(`  lightsVal[${idx}] = analogRead(PIN_${l.id.toUpperCase()});`)
      code.push(`  Serial.print("  Light Sensor [${l.id}]: "); Serial.println(lightsVal[${idx}]);`)
    })
  } else {
    code.push(`  int lightsVal[1] = { 500 };`)
  }

  // 3. Read PIR sensors
  if (pirs.length > 0) {
    code.push(`  bool occupied[${pirs.length}];`)
    pirs.forEach((p, idx) => {
      code.push(`  occupied[${idx}] = digitalRead(PIN_${p.id.toUpperCase()}) == HIGH;`)
      code.push(`  Serial.print("  Occupancy (PIR) [${p.id}]: "); Serial.println(occupied[${idx}] ? "MOTION DETECTED" : "EMPTY");`)
    })
  } else {
    code.push(`  bool occupied[1] = { true }; // Default to occupied if no PIR configured in room`)
  }

  // 4. Evaluate Simulation Rules for Each Independent Device
  code.push(``)
  code.push(`  Serial.println("  Device Status & Rule Evaluation:");`)
  code.push(`  for (int i = 0; i < NUM_DEVICES; i++) {`)
  code.push(`    if (devices[i].pin < 0) continue;`)
  code.push(`    bool newState = false;`)
  code.push(`    int z = devices[i].zoneIndex;`)
  code.push(``)
  code.push(`    if (strcmp(devices[i].type, "AC") == 0) {`)
  code.push(`      float currentTemp = temps[z % ${Math.max(1, dhts.length)}];`)
  code.push(`      bool isOcc = occupied[z % ${Math.max(1, pirs.length || 1)}];`)
  code.push(`      // Rule: AC turns ON if zone is occupied (or ALWAYS_COOL) and temp exceeds threshold`)
  code.push(`      if ((isOcc || ALWAYS_COOL) && currentTemp > TEMP_THRESHOLD_C) {`)
  code.push(`        newState = true;`)
  code.push(`      }`)
  code.push(`      Serial.print("    -> "); Serial.print(devices[i].id); Serial.print(" (AC): ");`)
  code.push(`      Serial.print(newState ? "[ ON ] " : "[ OFF ] ");`)
  code.push(`      if (newState) Serial.print("(Zone Hot & Occupied: ");`)
  code.push(`      else Serial.print("(Temp below target or unoccupied: ");`)
  code.push(`      Serial.print(currentTemp); Serial.print("°C vs Target "); Serial.print(TEMP_THRESHOLD_C); Serial.println("°C)");`)
  code.push(`    }`)
  code.push(`    else if (strcmp(devices[i].type, "Fan") == 0) {`)
  code.push(`      bool isOcc = occupied[z % ${Math.max(1, pirs.length || 1)}];`)
  code.push(`      // Rule: Fan turns ON if zone is occupied`)
  code.push(`      if (isOcc) newState = true;`)
  code.push(`      Serial.print("    -> "); Serial.print(devices[i].id); Serial.print(" (Fan): ");`)
  code.push(`      Serial.print(newState ? "[ ON ] " : "[ OFF ] ");`)
  code.push(`      Serial.println(isOcc ? "(Zone Occupied)" : "(Zone Unoccupied)");`)
  code.push(`    }`)
  code.push(`    else if (strcmp(devices[i].type, "Light") == 0) {`)
  code.push(`      int currentLight = lightsVal[z % ${Math.max(1, ldrs.length || 1)}];`)
  code.push(`      bool isOcc = occupied[z % ${Math.max(1, pirs.length || 1)}];`)
  code.push(`      // Rule: Lights turn ON if zone is occupied and ambient light is below threshold`)
  code.push(`      if (isOcc && currentLight < LIGHT_THRESHOLD) newState = true;`)
  code.push(`      Serial.print("    -> "); Serial.print(devices[i].id); Serial.print(" (Light): ");`)
  code.push(`      Serial.print(newState ? "[ ON ] " : "[ OFF ] ");`)
  code.push(`      if (newState) Serial.print("(Dark & Occupied: ");`)
  code.push(`      else Serial.print("(Daylight sufficient or unoccupied: ");`)
  code.push(`      Serial.print(currentLight); Serial.print(" vs Target "); Serial.print(LIGHT_THRESHOLD); Serial.println(")");`)
  code.push(`    }`)
  code.push(``)
  code.push(`    // Apply output state to GPIO pin`)
  code.push(`    devices[i].state = newState;`)
  code.push(`    digitalWrite(devices[i].pin, newState ? HIGH : LOW);`)
  code.push(`  }`)
  code.push(`  Serial.println("--------------------------------------------------------\\n");`)
  code.push(`}`)
  code.push(``)

  // Serial Interactive Command Parser
  code.push(`void handleSerialCommand() {`)
  code.push(`  if (!Serial.available()) return;`)
  code.push(`  String cmd = Serial.readStringUntil('\\n');`)
  code.push(`  cmd.trim();`)
  code.push(`  if (cmd.length() == 0) return;`)
  code.push(`  Serial.print("[CMD] Received: "); Serial.println(cmd);`)
  code.push(``)
  code.push(`  if (cmd.startsWith("TEMP ")) {`)
  code.push(`    float val = cmd.substring(5).toFloat();`)
  code.push(`    if (val > 10.0f && val < 45.0f) {`)
  code.push(`      TEMP_THRESHOLD_C = val;`)
  code.push(`      Serial.print("[OK] AC Temperature Threshold updated to: "); Serial.print(TEMP_THRESHOLD_C); Serial.println(" °C");`)
  code.push(`    } else {`)
  code.push(`      Serial.println("[ERR] Invalid temp value. Range: 10 - 45 °C");`)
  code.push(`    }`)
  code.push(`  } else if (cmd.startsWith("LIGHT ")) {`)
  code.push(`    int val = cmd.substring(6).toInt();`)
  code.push(`    if (val >= 0 && val <= 4095) {`)
  code.push(`      LIGHT_THRESHOLD = val;`)
  code.push(`      Serial.print("[OK] Light Threshold updated to: "); Serial.println(LIGHT_THRESHOLD);`)
  code.push(`    } else {`)
  code.push(`      Serial.println("[ERR] Invalid light threshold. Range: 0 - 4095");`)
  code.push(`    }`)
  code.push(`  } else if (cmd.equalsIgnoreCase("COOL ON")) {`)
  code.push(`    ALWAYS_COOL = true;`)
  code.push(`    Serial.println("[OK] Always-Cool override: ON (AC will run when hot regardless of PIR occupancy)");`)
  code.push(`  } else if (cmd.equalsIgnoreCase("COOL OFF")) {`)
  code.push(`    ALWAYS_COOL = false;`)
  code.push(`    Serial.println("[OK] Always-Cool override: OFF (AC requires PIR occupancy to run)");`)
  code.push(`  } else if (cmd.equalsIgnoreCase("STATUS")) {`)
  code.push(`    evaluateAndLogTelemetry();`)
  code.push(`  } else {`)
  code.push(`    Serial.println("Available Commands:");`)
  code.push(`    Serial.println("  TEMP <val>  - Set AC threshold (e.g. TEMP 25.0)");`)
  code.push(`    Serial.println("  LIGHT <val> - Set Light threshold (e.g. LIGHT 350)");`)
  code.push(`    Serial.println("  COOL ON     - Force AC when hot regardless of occupancy");`)
  code.push(`    Serial.println("  COOL OFF    - AC requires occupancy");`)
  code.push(`    Serial.println("  STATUS      - Immediate telemetry printout");`)
  code.push(`  }`)
  code.push(`}`)
  code.push(``)

  return code.join('\n')
}

/** Generates clear, step-by-step instructions for running in Wokwi for VS Code */
function generateReadme(ctrl: string, family: string, plan: HardwarePlan, subs: Substitution[], warnings: string[]): string {
  const parts = plan.parts.filter((p) => p.controllerId === ctrl)
  const acs = parts.filter((p) => p.virtual?.kind === 'ac' || p.id.startsWith('ac'))
  const fans = parts.filter((p) => p.virtual?.kind === 'fan' || p.id.startsWith('fan'))
  const lights = parts.filter((p) => p.virtual?.kind === 'light' || p.id.startsWith('light'))
  const dhts = parts.filter((p) => p.type === 'dht22')
  const ldrs = parts.filter((p) => p.type === 'ldr')
  const pirs = parts.filter((p) => p.type === 'pir')

  return `# SMART_SPACE — Wokwi for VS Code Simulation Project

This project simulates the IoT hardware and smart control system for your classroom using **Wokwi for VS Code**.

**Target Controller:** ${ctrl} (${BOARDS[family as 'esp32' | 'uno'].name})

---

## Hardware Configuration Summary

| Category | Component / Indicator | Quantity |
| :--- | :--- | :--- |
| **Controller** | ${BOARDS[family as 'esp32' | 'uno'].name} | 1 |
| **AC Control Outputs** | Blue Indicator LEDs (220 Ω resistors) | ${acs.length} |
| **Fan Control Outputs** | Green Indicator LEDs (220 Ω resistors) | ${fans.length} |
| **Light Control Outputs** | Yellow Indicator LEDs (220 Ω resistors) | ${lights.length} |
| **Temperature Sensors** | DHT22 Humidity & Temp Sensors | ${dhts.length} |
| **Light Sensors** | Photoresistor (LDR) Sensors | ${ldrs.length} |
| **Occupancy Sensors** | PIR Motion Sensors | ${pirs.length} |

> **Note on Substitutions:**
${subs.length > 0 ? subs.map((s) => `- **${s.partId}**: ${PARTS[s.from].label} is represented in Wokwi by ${PARTS[s.to].label}. (${s.reason})`).join('\n') : '- No substitutions needed; all components are natively simulated.'}

---

## How to Run in VS Code

### Step 1: Install Wokwi for VS Code Extension
1. Open Visual Studio Code.
2. Open the Extensions sidebar (\`Ctrl+Shift+X\` or \`Cmd+Shift+X\`).
3. Search for **Wokwi for VS Code** (ID: \`wokwi.wokwi-vscode\`) and click **Install**.

### Step 2: Open the Project Folder
1. Extract the downloaded ZIP archive into a dedicated directory on your computer.
2. In VS Code, select **File > Open Folder...** and choose the extracted project folder.
3. Verify the files are present:
   - \`diagram.json\` (circuit schematic)
   - \`sketch.ino\` (Arduino C++ simulation code)
   - \`libraries.txt\` (required libraries)
   - \`wokwi.toml\` (Wokwi extension config)

### Step 3: Start the Simulation
1. Open \`diagram.json\` in the editor.
2. Press \`F1\` (or \`Ctrl+Shift+P\` / \`Cmd+Shift+P\`) and type:
   \`Wokwi: Start Simulator\`
   *(Or click the green play button in the top right corner of the diagram view).*
3. The interactive simulation circuit diagram will render, and the Serial Monitor will open automatically at **115200 baud**.

---

## Interacting with the Simulation

- **Adjust Temperature:** Click on any **DHT22** sensor in the diagram. Drag the temperature slider above **24.0 °C** to see the assigned zone's AC LED light up!
- **Adjust Ambient Light:** Click on any **Photoresistor (LDR)** sensor. Adjust the lux slider below **400** to see zone lights turn ON.
- **Trigger Motion:** Click on any **PIR sensor** to simulate student movement. Notice how fans and ACs respond to occupancy.
- **Serial Commands:** Open the Serial Monitor input bar and type:
  - \`TEMP 26.0\` — Update AC temperature threshold to 26.0 °C.
  - \`LIGHT 350\` — Update lighting threshold to 350.
  - \`COOL ON\` — Run AC when hot regardless of PIR occupancy.
  - \`STATUS\` — Output an immediate telemetry report.

---

## Troubleshooting
${warnings.length > 0 ? `\n### Simulation Warnings\n${warnings.map((w) => `- ${w}`).join('\n')}\n` : ''}
- **Missing Libraries:** If prompted by the compiler, ensure \`DHT sensor library\` and \`Adafruit Unified Sensor\` are present in \`libraries.txt\`.
- **Serial Output:** Ensure Serial Monitor baud rate is set to **115200**.
`
}
