import type { PartSpec, PartType, Terminal } from './types'

const t = (name: string, kind: Terminal['kind']): Terminal => ({ name, kind })

/**
 * Hardware component library. Electrical values come from the usual manufacturer datasheets for the
 * common breakout modules; the assumption for each module is written in `notes` so it can be checked
 * against the exact board the user buys.
 */
export const PARTS: Record<PartType, PartSpec> = {
  dht22: {
    type: 'dht22', label: 'DHT22 temperature / humidity', model: 'DHT22 (AM2302) 3-pin module', category: 'sensor',
    supplyV: [3.3, 5.5], logicV: 'vcc', interface: 'digital-in', currentMa: 2,
    terminals: [t('VCC', 'power'), t('DATA', 'signal'), t('GND', 'ground')],
    helpers: ['10 kΩ pull-up from DATA to VCC (already on the 3-pin module)'],
    libraries: { arduino: ['DHT sensor library', 'Adafruit Unified Sensor'], python: ['adafruit-circuitpython-dht'] },
    notes: ['Reads at most once every 2 s.', '±0.5 °C typical; powered from the controller logic rail so DATA stays at the controller logic level.'],
  },
  ds18b20: {
    type: 'ds18b20', label: 'DS18B20 temperature probe', model: 'DS18B20 waterproof or TO-92', category: 'sensor',
    supplyV: [3.0, 5.5], logicV: 'vcc', interface: 'onewire', currentMa: 1,
    terminals: [t('VCC', 'power'), t('DQ', 'signal'), t('GND', 'ground')],
    helpers: ['4.7 kΩ pull-up from DQ to VCC (one per bus, shared by all probes on the bus)'],
    libraries: { arduino: ['OneWire', 'DallasTemperature'], python: ['w1thermsensor'] },
    notes: ['Many probes share one data pin; every probe has a unique 64-bit address.', '±0.5 °C.'],
  },
  bme280: {
    type: 'bme280', label: 'BME280 temperature / humidity / pressure', model: 'BME280 breakout (3.3 V, I²C)', category: 'sensor',
    supplyV: [3.3, 3.3], logicV: 3.3, interface: 'i2c', i2c: [0x76, 0x77], currentMa: 1,
    terminals: [t('VCC', 'power'), t('SDA', 'sda'), t('SCL', 'scl'), t('GND', 'ground')],
    helpers: ['I²C pull-ups (usually on the breakout)'],
    libraries: { arduino: ['Adafruit BME280 Library', 'Adafruit Unified Sensor'], python: ['adafruit-circuitpython-bme280'] },
    notes: ['The bare chip is 3.3 V only. Only breakouts with a regulator AND level shifting tolerate 5 V buses.', 'Address 0x76 (SDO low) or 0x77 (SDO high): two per bus.'],
  },
  bh1750: {
    type: 'bh1750', label: 'BH1750 light sensor', model: 'GY-302 BH1750 breakout (I²C)', category: 'sensor',
    supplyV: [3.0, 5.0], logicV: 3.3, interface: 'i2c', i2c: [0x23, 0x5c], currentMa: 1,
    terminals: [t('VCC', 'power'), t('SDA', 'sda'), t('SCL', 'scl'), t('GND', 'ground')],
    helpers: ['I²C pull-ups (on the breakout; they are tied to VCC)'],
    libraries: { arduino: ['BH1750'], python: ['smbus2'] },
    notes: ['The chip itself is a 3.3 V device; the GY-302 board adds a regulator but pulls the I²C lines up to VCC.', 'Address 0x23 (ADDR low) or 0x5C (ADDR high): two per bus.', 'Reports lux directly (1–65535 lx).'],
  },
  ldr: {
    type: 'ldr', label: 'LDR light sensor (photoresistor)', model: 'LDR + 10 kΩ divider module (analog out)', category: 'sensor',
    supplyV: [3.3, 5.0], logicV: 'vcc', interface: 'analog', currentMa: 1,
    terminals: [t('VCC', 'power'), t('AO', 'signal'), t('GND', 'ground')],
    helpers: ['10 kΩ fixed resistor forming a divider with the LDR (on the module)'],
    libraries: { arduino: [], python: ['adafruit-circuitpython-ads1x15'] },
    notes: ['Output swings 0…VCC, so power it from the controller logic rail to stay inside the ADC range.', 'Resistance-to-lux is NOT linear or calibrated: readings are relative unless you calibrate against a lux meter.'],
  },
  pir: {
    type: 'pir', label: 'PIR motion sensor', model: 'HC-SR501', category: 'sensor',
    supplyV: [4.5, 20], logicV: 3.3, interface: 'digital-in', currentMa: 65,
    terminals: [t('VCC', 'power'), t('OUT', 'signal'), t('GND', 'ground')],
    helpers: [],
    libraries: { arduino: [], python: ['gpiozero'] },
    notes: ['Needs the 5 V supply, but its OUT pin is 3.3 V, so it is safe for ESP32 / Raspberry Pi inputs.', 'Detects MOTION, not how many people are sitting: it cannot give a seat count.'],
  },
  led: {
    type: 'led', label: 'LED + series resistor', model: '5 mm LED with resistor', category: 'actuator',
    supplyV: [0, 0], logicV: 'vcc', interface: 'pwm-load', currentMa: 5,
    terminals: [t('SIG', 'signal'), t('GND', 'ground')],
    helpers: ['Series resistor sized for the controller logic voltage'],
    libraries: { arduino: [], python: ['gpiozero'] },
    notes: ['Brightness follows PWM duty, but perceived brightness is not linear (a gamma curve would be needed for exact steps).'],
  },
  dcMotor: {
    type: 'dcMotor', label: 'DC motor (fan / blower demo)', model: 'small 5 V DC motor or 5 V fan, via N-MOSFET driver', category: 'actuator',
    supplyV: [3, 6], logicV: 'vcc', interface: 'pwm-load', currentMa: 0,
    terminals: [t('GATE', 'signal'), t('VEXT', 'ext-power'), t('GND', 'ground')],
    helpers: [
      'logic-level N-MOSFET (Vgs(th) < 2 V, e.g. IRLZ44N or AO3400A)',
      '100 Ω gate resistor',
      '10 kΩ gate pull-down to GND (keeps the motor off while the controller boots)',
      '1N5819 flyback (freewheel) diode across the motor',
      '100 µF + 100 nF decoupling across the motor supply',
      'separate motor supply with a COMMON GROUND to the controller',
    ],
    libraries: { arduino: [], python: ['gpiozero'] },
    notes: ['A motor must NEVER be connected directly to a GPIO pin.', 'This is a low-voltage demonstration load, not a mains fan.'],
  },
  pca9685: {
    type: 'pca9685', label: 'PCA9685 16-channel PWM driver', model: 'PCA9685 breakout (I²C)', category: 'expander',
    supplyV: [3.0, 5.5], logicV: 'vcc', interface: 'i2c', i2c: [0x40, 0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47], currentMa: 10,
    terminals: [t('VCC', 'power'), t('SDA', 'sda'), t('SCL', 'scl'), t('GND', 'ground')],
    helpers: ['address solder jumpers A0–A5 for more than one board'],
    libraries: { arduino: ['Adafruit PWM Servo Driver Library'], python: ['adafruit-circuitpython-pca9685'] },
    notes: ['Adds 16 PWM channels per board over two I²C wires; outputs drive MOSFET gates or LEDs through resistors.', 'Each output sources/sinks about 25 mA.'],
  },
  tca9548a: {
    type: 'tca9548a', label: 'TCA9548A I²C multiplexer', model: 'TCA9548A breakout', category: 'expander',
    supplyV: [1.65, 5.5], logicV: 'vcc', interface: 'i2c', i2c: [0x70, 0x71, 0x72, 0x73], currentMa: 1,
    terminals: [t('VCC', 'power'), t('SDA', 'sda'), t('SCL', 'scl'), t('GND', 'ground')],
    helpers: ['RESET pin pulled up'],
    libraries: { arduino: [], python: [] },
    notes: ['Gives 8 separate I²C buses so identical sensors can share one controller.'],
  },
  ads1115: {
    type: 'ads1115', label: 'ADS1115 16-bit ADC', model: 'ADS1115 breakout (I²C)', category: 'expander',
    supplyV: [2.0, 5.5], logicV: 'vcc', interface: 'i2c', i2c: [0x48, 0x49, 0x4a, 0x4b], currentMa: 1,
    terminals: [t('VDD', 'power'), t('SDA', 'sda'), t('SCL', 'scl'), t('GND', 'ground')],
    helpers: ['ADDR pin wired to GND / VDD / SDA / SCL selects 0x48–0x4B'],
    libraries: { arduino: ['Adafruit ADS1X15'], python: ['adafruit-circuitpython-ads1x15'] },
    notes: ['4 single-ended inputs; the only way for a Raspberry Pi to read an analog LDR.', 'Inputs must stay below VDD.'],
  },
}

export const partSpec = (t: PartType) => PARTS[t]

/** Standard E12 resistor values (Ω) used for the LED series resistor. */
const E12 = [10, 12, 15, 18, 22, 27, 33, 39, 47, 56, 68, 82]
export function nearestE12AtLeast(ohms: number): number {
  const decade = Math.pow(10, Math.floor(Math.log10(ohms)) - 1)
  for (const m of [...E12, 100]) if (m * decade >= ohms - 1e-9) return Math.round(m * decade)
  return Math.round(ohms)
}

/** Series resistor for a red/yellow LED (Vf ≈ 2.0 V) at about `mA` from a `vLogic` pin. */
export function ledResistor(vLogic: number, mA = 5, vf = 2.0): number {
  return nearestE12AtLeast(((vLogic - vf) / mA) * 1000)
}

/** Duty (0…1) of an actuator for a virtual level / dimming. */
export const dutyForLevel = (level: number, maxLevel: number) => (maxLevel <= 0 ? 0 : Math.max(0, Math.min(1, level / maxLevel)))
