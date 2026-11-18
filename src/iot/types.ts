import type { ControllerFamily, Vec3 } from '@/types'

export type Severity = 'error' | 'warning' | 'info'
export interface Issue {
  /** stable key so the UI can list / dedupe */
  code: string
  severity: Severity
  message: string
  /** ids of the controllers / parts the issue is about */
  refs: string[]
}

export type PinFunction = 'pwm-out' | 'digital-out' | 'digital-in' | 'digital-io' | 'adc-in' | 'i2c-sda' | 'i2c-scl' | 'onewire'

/** Capabilities and electrical limits of one controller pin. */
export interface PinSpec {
  /** unique on the board, e.g. "GPIO25", "D3", "A0" */
  id: string
  /** number used by the Arduino / gpiozero API (GPIO number, D-number, or 14+n for A0…A5) */
  num: number
  /** silkscreen / header label */
  label: string
  out: boolean
  in: boolean
  pwm: boolean
  adc: boolean
  /** ESP32 only: ADC2 cannot be used while Wi-Fi is on */
  adc2?: boolean
  sda?: boolean
  scl?: boolean
  /** the pin is physically unusable (flash, serial/USB, …) and why */
  reserved?: string
  /** usable, but with a boot-time side effect; allocated last and flagged */
  caution?: string
  /** recommended maximum source/sink current in mA */
  maxMa: number
}

export interface BoardSpec {
  family: ControllerFamily
  name: string
  /** supply voltage of the GPIO logic */
  logicV: 3.3 | 5
  pins: PinSpec[]
  hasWifi: boolean
  /** can the GPIO pins tolerate 5 V? (never true for ESP32 / Raspberry Pi) */
  fiveVTolerant: boolean
  /** mA that the 3.3 V pin can supply to external parts */
  max3v3Ma: number
  /** mA that the 5 V pin can supply (USB-powered) */
  max5vMa: number
  /** ADC resolution, 0 when the board has no ADC */
  adcBits: number
  /** I²C buses */
  i2cDefault?: { sda: string; scl: string }
  /** default 1-Wire / data pin suggestion */
  onewirePin?: string
  /** relative RAM size note used for the "small memory" warning (bytes) */
  ramBytes: number
  /** Wokwi part type (see docs/wokwi-notes.md) or null when Wokwi has no such board */
  wokwiType: string | null
  notes: string[]
}

export type PartType =
  | 'dht22'
  | 'ds18b20'
  | 'bme280'
  | 'bh1750'
  | 'ldr'
  | 'pir'
  | 'led'
  | 'dcMotor'
  | 'pca9685'
  | 'tca9548a'
  | 'ads1115'

export type TerminalKind = 'power' | 'ground' | 'signal' | 'sda' | 'scl' | 'ext-power'

export interface Terminal {
  name: string
  kind: TerminalKind
}

export interface PartSpec {
  type: PartType
  label: string
  model: string
  category: 'sensor' | 'actuator' | 'expander'
  /** accepted supply range (V) of the module as normally sold */
  supplyV: [number, number]
  /** logic level of its signal / bus pins */
  logicV: 3.3 | 5 | 'vcc'
  interface: 'onewire' | 'digital-in' | 'analog' | 'i2c' | 'pwm-load'
  /** possible I²C addresses (first is the default) */
  i2c?: number[]
  /** supply current drawn from the logic rail (mA) */
  currentMa: number
  terminals: Terminal[]
  /** parts that must be wired in addition (resistors, MOSFET, diode …) */
  helpers: string[]
  libraries: { arduino: string[]; python: string[] }
  notes: string[]
}

export interface Controller {
  id: string
  family: ControllerFamily
  label: string
}

export type VirtualKind = 'fan' | 'ac' | 'light'

export interface PlanPart {
  /** unique hardware id, also used in the firmware and MQTT messages (fan01, led03, temp01 …) */
  id: string
  type: PartType
  label: string
  controllerId: string
  /** the virtual device this part represents (actuators) */
  virtual?: { objectId: string; kind: VirtualKind; name: string; variant?: 'motor' | 'led' }
  /** the room measurement point this part reports for (sensors) */
  sensorId?: string
  /** I²C address when the part sits on a bus */
  i2cAddr?: number
  /** mux channel when behind a TCA9548A */
  mux?: { partId: string; channel: number }
  /** actuator parameters */
  params?: { resistorOhm?: number; motorStallMa?: number; motorV?: number }
}

/** One electrical endpoint: a controller pin, or a terminal of a part. */
export interface Endpoint {
  owner: string
  pin: string
}

export type NetKind = 'power' | 'ground' | 'signal' | 'i2c' | 'ext-power'
export interface Net {
  id: string
  kind: NetKind
  label: string
  endpoints: Endpoint[]
}

export interface PinUse {
  controllerId: string
  pinId: string
  fn: PinFunction
  partId: string
  signal: string
}

/** Output / input channel of a part: a controller pin or a channel on an expander. */
export type Channel = { kind: 'gpio'; controllerId: string; pinId: string } | { kind: 'pca9685'; expanderId: string; channel: number } | { kind: 'ads1115'; expanderId: string; channel: number }

export interface MapRow {
  virtualDevice: string
  hardwareDevice: string
  controller: string
  pin: string
  note?: string
}

export interface BomLine {
  item: string
  qty: number
  note?: string
}

export interface ExternalSupply {
  /** which controller's group of motors it serves */
  controllerId: string
  volts: number
  /** minimum current rating (A) including margin */
  minAmps: number
  motors: number
}

export interface HardwarePlan {
  family: ControllerFamily
  controllers: Controller[]
  parts: PlanPart[]
  pins: PinUse[]
  channels: Record<string, Channel>
  nets: Net[]
  map: MapRow[]
  bom: BomLine[]
  supplies: ExternalSupply[]
  issues: Issue[]
  /** why this many controllers (plain language) */
  reasons: string[]
  /** hardware id by virtual object id */
  hwIdByObject: Record<string, string>
}

export interface Requirement {
  part: PlanPart
  need: 'pwm' | 'adc' | 'digital-in' | 'digital-io' | 'onewire' | 'i2c'
  /** locality group (zone index) so neighbours share a controller when possible */
  group: number
}

export type { Vec3 }
