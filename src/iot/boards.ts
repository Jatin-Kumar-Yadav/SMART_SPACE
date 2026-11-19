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

export const BOARDS: Record<ControllerFamily, BoardSpec> = { esp32: ESP32 }
export const boardOf = (_f?: ControllerFamily) => ESP32
export const pinOf = (_f: ControllerFamily, id: string) => ESP32.pins.find((p) => p.id === id)

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
  if (fn === 'pwm') {
    if (p.adc && !p.adc2) score += 20
  }
  else if (inputOnly) score -= 10 // spend input-only pins on inputs
  else score += 5 // keep output-capable pins for outputs
  return score + p.num / 1000
}
