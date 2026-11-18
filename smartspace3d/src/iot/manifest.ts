import type { HardwareConfig, Space } from '@/types'
import { pinOf } from './boards'
import { PARTS } from './parts'
import type { Controller, ControllerRole, HardwarePlan, Net, PartType, PlanPart } from './types'

/**
 * The hardware manifest: ONE description of what is built, derived from the validated plan.
 * The circuit drawing, the firmware tables, the Wokwi export, path highlighting and the sensor
 * simulation all read this (or the plan it is derived from), so a GPIO can never differ between the
 * diagram and the code.
 */
export interface ManifestDevice {
  id: string
  type: PartType
  kind: 'input' | 'output'
  label: string
  /** the signal pin on the controller ("GPIO25"), an expander channel ("pca01:CH3"), or the bus ("SDA GPIO21 / SCL GPIO22 @0x23") */
  pin: string
  /** numeric GPIO for direct pins, otherwise null */
  gpio: number | null
  zoneId: string
  /** outputs only: the pin that drives the load (gate / LED), same as `pin` */
  controlPin?: string
  /** a motor needs a MOSFET driver, flyback diode and its own supply; it is never wired to a GPIO */
  driverRequired: boolean
  /** the room object this output represents (fan / AC / light) */
  virtualDeviceId?: string
  /** the room measurement point this sensor reports for */
  sensorId?: string
}

export interface ManifestController {
  id: string
  role: ControllerRole
  family: Controller['family']
  label: string
  devices: ManifestDevice[]
  /** how this controller talks to the rest of the system */
  link: 'wifi-mqtt' | 'usb-serial-gateway' | 'wifi-mqtt-python'
}

export interface HardwareManifest {
  version: 1
  roomId: string
  controllers: ManifestController[]
  comms: { transport: 'MQTT over Wi-Fi'; topicRoot: string; note: string }
}

const COMMS_NOTE =
  'Every controller connects to the same MQTT broker and publishes telemetry / accepts commands under its own topic (protocol v1). The master is the controller that the live link and the room timeline treat as the gateway; nodes do not talk to each other. ESP-NOW, UART and I²C inter-controller links are not generated.'

export function zoneOfOutput(space: Space, cfg: HardwareConfig, objectId: string | undefined): string {
  const o = objectId ? space.objects.find((x) => x.id === objectId) : undefined
  const zones = new Map<string, [number, number]>()
  for (const s of cfg.sensors) {
    const z = s.zone ?? s.name
    if (!zones.has(z) || s.kind === 'light') zones.set(z, [s.position[0], s.position[2]])
  }
  if (!o || zones.size === 0) return [...zones.keys()][0] ?? 'A'
  let best = ''
  let bd = Infinity
  for (const [z, c] of zones) {
    const d = Math.hypot(c[0] - o.position[0], c[1] - o.position[2])
    if (d < bd) { bd = d; best = z }
  }
  return best
}

export function buildManifest(plan: HardwarePlan, space: Space, cfg: HardwareConfig): HardwareManifest {
  const controllers: ManifestController[] = plan.controllers.map((c) => {
    const devices: ManifestDevice[] = []
    for (const p of plan.parts.filter((x) => x.controllerId === c.id)) {
      const spec = PARTS[p.type]
      if (spec.category === 'expander') continue
      const ch = plan.channels[p.id]
      const sp = p.sensorId ? cfg.sensors.find((s) => s.id === p.sensorId) : undefined
      let pin = '—'
      let gpio: number | null = null
      if (ch?.kind === 'gpio') {
        pin = ch.pinId
        gpio = pinOf(plan.family, ch.pinId)?.num ?? null
      } else if (ch) {
        pin = `${ch.expanderId}:${ch.kind === 'pca9685' ? 'CH' : 'A'}${ch.channel}`
      } else {
        const sda = plan.pins.find((u) => u.partId === p.id && u.fn === 'i2c-sda')?.pinId
        const scl = plan.pins.find((u) => u.partId === p.id && u.fn === 'i2c-scl')?.pinId
        pin = sda ? `SDA ${sda} / SCL ${scl} @0x${(p.i2cAddr ?? 0).toString(16)}` : '—'
      }
      const output = spec.category === 'actuator'
      devices.push({
        id: p.id, type: p.type, kind: output ? 'output' : 'input', label: p.label, pin, gpio,
        zoneId: sp ? (sp.zone ?? sp.name) : zoneOfOutput(space, cfg, p.virtual?.objectId),
        controlPin: output ? pin : undefined,
        driverRequired: p.type === 'dcMotor',
        virtualDeviceId: p.virtual?.objectId,
        sensorId: p.sensorId,
      })
    }
    return { id: c.id, role: c.role ?? 'standalone', family: c.family, label: c.label, devices, link: c.family === 'uno' ? 'usb-serial-gateway' : c.family === 'rpi' ? 'wifi-mqtt-python' : 'wifi-mqtt' }
  })
  return { version: 1, roomId: space.id, controllers, comms: { transport: 'MQTT over Wi-Fi', topicRoot: cfg.mqttTopicRoot, note: COMMS_NOTE } }
}

/** Rules the manifest itself must satisfy, independent of the plan validator. Empty list = consistent. */
export function checkManifest(m: HardwareManifest): string[] {
  const out: string[] = []
  const masters = m.controllers.filter((c) => c.role === 'master').length
  if (m.controllers.length > 1 && masters !== 1) out.push(`expected exactly one master, found ${masters}`)
  if (m.controllers.length === 1 && m.controllers[0].role !== 'standalone') out.push('a single controller must be standalone')
  const seenVirtual = new Set<string>()
  for (const c of m.controllers) {
    const gpios = new Map<number, string>()
    for (const d of c.devices) {
      if (d.type === 'dcMotor' && !d.driverRequired) out.push(`${d.id}: a motor must use a driver`)
      if (d.kind === 'output') {
        if (d.virtualDeviceId) {
          const key = `${d.virtualDeviceId}:${d.type}`
          if (seenVirtual.has(key)) out.push(`${d.id}: virtual device ${d.virtualDeviceId} is driven by two ${d.type} outputs`)
          seenVirtual.add(key)
        }
        if (d.gpio != null && gpios.has(d.gpio)) out.push(`${d.id}: GPIO${d.gpio} is also used by ${gpios.get(d.gpio)}`)
        if (d.gpio != null) gpios.set(d.gpio, d.id)
      }
    }
  }
  return out
}

/** Wire colour classes shown in the circuit: red +, black GND, yellow digital, blue sensor data, green PWM, purple comms. */
export type WireClass = 'power' | 'ground' | 'digital' | 'sensor' | 'pwm' | 'comms' | 'motor-power'
export const WIRE_COLOUR: Record<WireClass, string> = {
  power: '#dc2626', ground: '#111827', digital: '#eab308', sensor: '#2563eb', pwm: '#16a34a', comms: '#9333ea', 'motor-power': '#ea580c',
}
export const WIRE_LABEL: Record<WireClass, string> = {
  power: '3.3 V / 5 V', ground: 'GND', digital: 'Digital', sensor: 'Sensor data', pwm: 'PWM output', comms: 'I²C', 'motor-power': 'Motor supply',
}

export function wireClass(net: Net, parts: PlanPart[]): WireClass {
  if (net.kind === 'power') return 'power'
  if (net.kind === 'ground') return 'ground'
  if (net.kind === 'ext-power') return 'motor-power'
  if (net.kind === 'i2c') return 'comms'
  for (const e of net.endpoints) {
    const p = parts.find((x) => x.id === e.owner)
    if (!p) continue
    if (p.type === 'led' || p.type === 'dcMotor') return 'pwm'
    if (p.type === 'pir') return 'digital'
    return 'sensor'
  }
  return 'sensor'
}
