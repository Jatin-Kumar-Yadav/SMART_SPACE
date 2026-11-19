import type { HardwareConfig } from '@/types'
import { BOARDS, pinOf } from './boards'
import { PARTS } from './parts'
import type { HardwarePlan, PlanPart } from './types'

const hex = (n: number) => `0x${n.toString(16).toUpperCase()}`

function pinLabel(plan: HardwarePlan, part: PlanPart): string {
  const ch = plan.channels[part.id]
  if (!ch) return ''
  if (ch.kind === 'gpio') {
    const p = pinOf(plan.family, ch.pinId)
    return p ? `${p.label}${plan.family === 'esp32' ? ` (GPIO ${p.num})` : ''}` : ch.pinId
  }
  const e = plan.parts.find((x) => x.id === ch.expanderId)
  return `${e?.label ?? ch.expanderId} ${ch.kind === 'pca9685' ? `CH${ch.channel}` : `A${ch.channel}`}`
}

/** Markdown bill of materials. */
export function bomMarkdown(plan: HardwarePlan): string {
  if (!plan.bom.length) return '_Nothing to buy yet. Generate the hardware setup first._'
  return ['| Qty | Item | Note |', '|---:|---|---|', ...plan.bom.map((b) => `| ${b.qty} | ${b.item} | ${b.note ?? ''} |`)].join('\n')
}

/** Step-by-step connection guide, power first, then signals, with the safety rules spelled out. */
export function connectionGuide(plan: HardwarePlan, cfg: HardwareConfig): string {
  if (!plan.controllers.length) return plan.reasons.join('\n') || 'No hardware plan yet.'
  const board = BOARDS[plan.family]
  const out: string[] = []
  out.push('# Connection guide', '', `Boards: ${plan.controllers.length} × ${board.name}`, '')
  out.push('## Before you start', '')
  out.push('- Wire with **everything unpowered**. Plug USB / the motor supply in last.')
  out.push(`- ${board.name} logic is **${board.logicV} V**${board.fiveVTolerant ? '' : ' and its pins are **not 5 V tolerant**'}.`)
  out.push('- This is a low-voltage prototype. **No mains voltage is ever connected.** AC and fans are represented by LEDs and small DC loads.')
  out.push('- Nothing here has been verified on hardware by SmartSpace 3D. Check every pin against the board you actually own.', '')

  for (const c of plan.controllers) {
    const mine = plan.parts.filter((p) => p.controllerId === c.id)
    out.push(`## ${c.label} (\`${c.id}\`)`, '')
    out.push('### 1. Power and ground', '')
    out.push('| From | To |', '|---|---|')
    for (const net of plan.nets.filter((n) => (n.kind === 'power' || n.kind === 'ground') && n.endpoints.some((e) => e.owner === c.id))) {
      const hub = net.endpoints.find((e) => e.owner === c.id)!
      for (const e of net.endpoints.filter((x) => x !== hub)) out.push(`| ${c.label} ${hub.pin} | ${e.owner.startsWith('psu-') ? 'motor supply GND' : `${e.owner} ${e.pin}`} |`)
    }
    out.push('')
    const motors = mine.filter((p) => p.type === 'dcMotor')
    const sup = plan.supplies.find((s) => s.controllerId === c.id)
    if (motors.length && sup) {
      out.push('### 2. Motor supply (separate from the controller)', '')
      out.push(`- Use a **${sup.volts} V DC supply rated at least ${sup.minAmps.toFixed(1)} A** (${sup.motors} motor${sup.motors > 1 ? 's' : ''}, 25 % margin).`)
      out.push('- Join the supply **GND to the controller GND** (common ground). Do not connect the supply + to the controller.')
      out.push('- Put 100 µF + 100 nF across the supply terminals, close to the MOSFETs.', '')
      out.push('Per motor (`' + motors.map((m) => m.id).join('`, `') + '`):', '')
      out.push('1. MOSFET **source → GND**, **drain → motor −**, motor **+ → supply +**.')
      out.push('2. **1N5819 diode across the motor**: cathode (stripe) to motor +, anode to motor −.')
      out.push('3. **100 Ω** between the controller pin and the MOSFET **gate**; **10 kΩ gate → GND** so the motor stays off while the controller boots.')
      out.push('4. The motor is **never** connected to a controller pin.', '')
    }
    out.push(`### ${motors.length ? '3' : '2'}. Signals`, '')
    out.push('| Part | Role | Connect | Note |', '|---|---|---|---|')
    for (const p of mine) {
      const spec = PARTS[p.type]
      if (spec.category === 'expander') continue
      const role = p.virtual ? `${p.virtual.name} (${p.virtual.kind})` : p.sensorId ? (cfg.sensors.find((s) => s.id === p.sensorId)?.name ?? 'sensor') : ''
      let to = pinLabel(plan, p)
      let note = spec.notes[0] ?? ''
      if (spec.interface === 'i2c') { to = `SDA/SCL, address ${hex(p.i2cAddr ?? 0)}${p.mux ? `, behind multiplexer channel ${p.mux.channel}` : ''}`; note = spec.notes[0] ?? '' }
      if (p.type === 'led') note = `${p.params?.resistorOhm} Ω series resistor, anode to the resistor, cathode to GND`
      if (p.type === 'dcMotor') note = 'pin drives the MOSFET gate (via 100 Ω)'
      out.push(`| ${p.id} · ${spec.label} | ${role} | ${to} | ${note} |`)
    }
    out.push('')
    if (mine.some((p) => p.type === 'ds18b20')) out.push('- **1-Wire**: all DS18B20 probes share one data pin. Add **one 4.7 kΩ resistor** from DATA to 3.3 V.')
    if (mine.some((p) => PARTS[p.type].interface === 'i2c')) out.push('- **I²C**: SDA and SCL are shared by every I²C part on this controller. Most breakouts include pull-ups; do not add more than ~3 sets.')
    if (mine.some((p) => p.type === 'pir')) out.push('- **PIR** needs 5 V (the HC-SR501 will not run from 3.3 V). Give it a minute to settle after power-up. It reports motion, not a seat count.')
    if (mine.some((p) => p.type === 'ldr')) out.push('- **LDR** reads a relative level. Calibrate against a lux meter before trusting it as lux.')
    out.push('')
  }

  const issues = plan.issues.filter((i) => i.severity !== 'info')
  if (issues.length) {
    out.push('## Open issues', '')
    for (const i of issues) out.push(`- **${i.severity.toUpperCase()}** ${i.message}`)
    out.push('')
  }
  out.push('## Bill of materials', '', bomMarkdown(plan), '')
  out.push('## Why this many controllers', '', ...plan.reasons.map((r) => `- ${r}`), '')
  return out.join('\n')
}
