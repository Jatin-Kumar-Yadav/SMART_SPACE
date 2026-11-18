import type { ControllerFamily } from '@/types'
import type { BoardSpec, PinSpec } from './types'

const pin = (id: string, num: number, o: Partial<PinSpec> = {}): PinSpec => ({ id, num, label: id, out: true, in: true, pwm: true, adc: false, maxMa: 12, ...o })

// ── ESP32 DevKit (ESP32-WROOM-32, 30/38-pin) ────────────────────────────────
// Sources: Espressif ESP32 datasheet / pin tables. GPIO6–11 are wired to the SPI flash; GPIO34–39 are
// input-only; GPIO0/2/5/12/15 are strapping pins; ADC2 is unavailable while Wi-Fi is active.
const ESP_ADC1 = new Set([32, 33, 34, 35, 36, 39])
const ESP_ADC2 = new Set([0, 2, 4, 12, 13, 14, 15, 25, 26, 27])
const ESP_INPUT_ONLY = new Set([34, 35, 36, 39])
const ESP_STRAP: Record<number, string> = {
  0: 'strapping pin: must be HIGH at boot (held LOW enters the bootloader)',
  2: 'strapping pin: must be LOW/floating at boot (also drives the on-board LED)',
  5: 'strapping pin: emits a PWM signal for a moment at boot',
  12: 'strapping pin (MTDI): a HIGH level at boot selects 1.8 V flash and the board will not start',
  15: 'strapping pin: logs boot messages / emits a signal at boot',
}
const espPins: PinSpec[] = [0, 1, 2, 3, 4, 5, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33, 34, 35, 36, 39].map((n) => {
  const inOnly = ESP_INPUT_ONLY.has(n)
  return pin(`GPIO${n}`, n, {
    label: `GPIO${n}`,
    out: !inOnly,
    pwm: !inOnly,
    adc: ESP_ADC1.has(n) || ESP_ADC2.has(n),
    adc2: ESP_ADC2.has(n),
    sda: n === 21,
    scl: n === 22,
    reserved: n === 1 ? 'TX0: USB serial / flashing' : n === 3 ? 'RX0: USB serial / flashing' : undefined,
    caution: ESP_STRAP[n],
  })
})
for (const n of [6, 7, 8, 9, 10, 11]) espPins.push(pin(`GPIO${n}`, n, { out: false, in: false, pwm: false, reserved: 'connected to the on-board SPI flash' }))

export const ESP32: BoardSpec = {
  family: 'esp32',
  name: 'ESP32 DevKit (ESP32-WROOM-32)',
  logicV: 3.3,
  pins: espPins,
  hasWifi: true,
  fiveVTolerant: false,
  max3v3Ma: 400, // on-board regulator, leaving thermal headroom
  max5vMa: 400, // USB supply shared with the board itself
  adcBits: 12,
  i2cDefault: { sda: 'GPIO21', scl: 'GPIO22' },
  onewirePin: 'GPIO4',
  ramBytes: 320 * 1024,
  wokwiType: 'board-esp32-devkit-c-v4',
  notes: [
    'GPIO pins are 3.3 V only and are NOT 5 V tolerant.',
    'GPIO34/35/36/39 are input-only and have no pull-ups.',
    'ADC2 pins (0, 2, 4, 12–15, 25–27) cannot be read while Wi-Fi is on, so analog sensors use ADC1 (32–39).',
    'WROVER modules use GPIO16/17 for PSRAM; keep them free if your board is a WROVER.',
  ],
}

// ── Arduino Uno (ATmega328P) ────────────────────────────────────────────────
const unoPins: PinSpec[] = []
const UNO_PWM = new Set([3, 5, 6, 9, 10, 11])
for (let n = 0; n <= 13; n++) {
  unoPins.push(pin(`D${n}`, n, {
    label: `D${n}`,
    pwm: UNO_PWM.has(n),
    maxMa: 20,
    reserved: n === 0 ? 'RX: USB serial' : n === 1 ? 'TX: USB serial' : undefined,
    caution: n === 13 ? 'shared with the on-board LED' : undefined,
  }))
}
for (let a = 0; a <= 5; a++) {
  unoPins.push(pin(`A${a}`, 14 + a, { label: `A${a}`, pwm: false, adc: true, maxMa: 20, sda: a === 4, scl: a === 5 }))
}
export const UNO: BoardSpec = {
  family: 'uno',
  name: 'Arduino Uno R3',
  logicV: 5,
  pins: unoPins,
  hasWifi: false,
  fiveVTolerant: true,
  max3v3Ma: 50,
  max5vMa: 400,
  adcBits: 10,
  i2cDefault: { sda: 'A4', scl: 'A5' },
  onewirePin: 'D2',
  ramBytes: 2048,
  wokwiType: 'wokwi-arduino-uno',
  notes: [
    'GPIO logic is 5 V: 3.3 V-only modules (BME280 breakouts without level shifting) need a level shifter.',
    'Only D3, D5, D6, D9, D10, D11 provide PWM.',
    'The standard Uno has no Wi-Fi: it cannot reach the MQTT broker by itself (a gateway such as an ESP32 or Raspberry Pi is needed).',
    '2 KB of RAM limits how many sensors and channels one sketch can handle.',
  ],
}

// ── Raspberry Pi 3/4/5 40-pin header (BCM numbering) ────────────────────────
const piPins: PinSpec[] = []
for (let n = 2; n <= 27; n++) {
  piPins.push(pin(`GPIO${n}`, n, {
    label: `GPIO${n}`,
    pwm: true, // gpiozero software PWM works on any pin; hardware PWM on 12, 13, 18, 19
    maxMa: 8,
    sda: n === 2,
    scl: n === 3,
    reserved: n === 14 ? 'UART TX (console)' : n === 15 ? 'UART RX (console)' : undefined,
    caution: n === 2 || n === 3 ? 'I²C bus with fixed 1.8 kΩ pull-ups: use only for I²C' : undefined,
  }))
}
export const RPI: BoardSpec = {
  family: 'rpi',
  name: 'Raspberry Pi 4 / 5 (40-pin header)',
  logicV: 3.3,
  pins: piPins,
  hasWifi: true,
  fiveVTolerant: false,
  max3v3Ma: 50,
  max5vMa: 1000,
  adcBits: 0,
  i2cDefault: { sda: 'GPIO2', scl: 'GPIO3' },
  onewirePin: 'GPIO4',
  ramBytes: 1024 * 1024 * 1024,
  wokwiType: null,
  notes: [
    'GPIO pins are 3.3 V only and are NOT 5 V tolerant: never connect a 5 V signal directly.',
    'The Raspberry Pi has no analog inputs: an LDR needs an external ADC (ADS1115).',
    'PWM on most pins is software PWM (jitter); hardware PWM is available on GPIO12/13/18/19.',
    'The 3.3 V pin supplies only about 50 mA in total.',
  ],
}

export const BOARDS: Record<ControllerFamily, BoardSpec> = { esp32: ESP32, uno: UNO, rpi: RPI }
export const boardOf = (f: ControllerFamily) => BOARDS[f]
export const pinOf = (f: ControllerFamily, id: string) => BOARDS[f].pins.find((p) => p.id === id)

/** A pin an allocator may hand out for `fn` (ignores caution; the planner prefers pins without it). */
export function pinSupports(p: PinSpec, fn: 'pwm' | 'digital-out' | 'digital-in' | 'digital-io' | 'adc' | 'onewire', wifiOn: boolean): boolean {
  if (p.reserved) return false
  if (p.sda || p.scl) return false // keep the I²C pair for the bus
  switch (fn) {
    case 'pwm': return p.out && p.pwm
    case 'digital-out': return p.out
    case 'digital-in': return p.in
    // DHT22 and 1-Wire data lines are bidirectional: the library drives the pin, so it must be able to output
    case 'digital-io':
    case 'onewire': return p.in && p.out
    case 'adc': return p.adc && !(wifiOn && p.adc2)
  }
}

/** Sort key for allocation: pins without side effects first, input-only pins kept for inputs. */
export function pinPreference(p: PinSpec, fn: 'pwm' | 'digital-in' | 'digital-io' | 'adc' | 'onewire'): number {
  let score = p.caution ? 100 : 0
  const inputOnly = !p.out
  if (fn === 'pwm') score += 0
  else if (inputOnly) score -= 10 // spend input-only pins on inputs
  else score += 5 // keep output-capable pins for outputs
  return score + p.num / 1000
}
