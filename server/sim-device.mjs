/**
 * A SIMULATED microcontroller. It speaks the same MQTT protocol as the generated firmware, so the
 * app's Live Data path can be exercised without hardware. It is NOT real hardware: a green result
 * here proves the protocol and the app logic, not that a physical circuit works.
 *
 * Protocol v1 (JSON; topic root = smartspace/<space>/<controller>)
 *   <root>/telemetry  device → app   {v,ctrl,seq,uptime,plan,armed,sensors:{id:{...}},actuators:{id:{duty,pin}}}
 *   <root>/status     device → app   {v,online,armed,plan,fw}  (retained; last-will publishes online:false)
 *   <root>/cmd        app → device   {v,id,type:'set',actuator,duty 0..1} | {type:'arm',on} | {type:'estop'} | {type:'hb'}
 *   <root>/ack        device → app   {v,id,ok,type,actuator?,applied?,error?}
 * Safety behaviour (mirrored in the firmware): boots DISARMED with every output at 0; refuses duty>0
 * while disarmed; heartbeats are required while armed; no heartbeat for failsafeMs → outputs to 0 and disarm.
 */
import mqtt from 'mqtt'

/**
 * @param {{
 *  brokerUrl: string, token: string, space: string, ctrl: string, plan?: string,
 *  actuators: { id: string, kind: 'motor'|'led', pin?: number }[],
 *  sensors: { id: string, kind: 'temperature'|'light'|'presence', value?: number }[],
 *  telemetryMs?: number, failsafeMs?: number, quiet?: boolean
 * }} o
 */
export function createSimDevice(o) {
  const root = `smartspace/${o.space}/${o.ctrl}`
  const telemetryMs = o.telemetryMs ?? 2000
  const failsafeMs = o.failsafeMs ?? 15000
  const log = o.quiet ? () => {} : (...a) => console.log(`[sim ${o.ctrl}]`, ...a)
  const duty = Object.fromEntries(o.actuators.map((a) => [a.id, 0]))
  const sensor = Object.fromEntries(o.sensors.map((s) => [s.id, { kind: s.kind, value: s.value ?? (s.kind === 'temperature' ? 30 : s.kind === 'light' ? 300 : 0) }]))
  let armed = false
  let lastHb = 0
  let seq = 0
  const t0 = Date.now()

  const client = mqtt.connect(o.brokerUrl, {
    clientId: o.ctrl,
    username: 'smartspace',
    password: o.token,
    reconnectPeriod: 1000,
    will: { topic: `${root}/status`, payload: JSON.stringify({ v: 1, online: false }), retain: true, qos: 0 },
  })
  const pub = (sub, body, retain = false) => client.publish(`${root}/${sub}`, JSON.stringify(body), { retain })
  const status = () => pub('status', { v: 1, online: true, armed, plan: o.plan ?? '', fw: 'sim-1.0' }, true)
  const zeroAll = () => { for (const k of Object.keys(duty)) duty[k] = 0 }
  const telemetry = () => {
    const sensors = {}
    for (const [id, s] of Object.entries(sensor)) sensors[id] = s.kind === 'temperature' ? { t: +s.value.toFixed(2) } : s.kind === 'light' ? { lux: Math.round(s.value) } : { motion: !!s.value }
    const actuators = {}
    for (const a of o.actuators) actuators[a.id] = { duty: +duty[a.id].toFixed(3), pin: a.pin ?? null }
    pub('telemetry', { v: 1, ctrl: o.ctrl, seq: seq++, uptime: Math.round((Date.now() - t0) / 1000), plan: o.plan ?? '', armed, sensors, actuators })
  }

  client.on('connect', () => {
    client.subscribe(`${root}/cmd`, { qos: 0 })
    status()
    telemetry()
    log('connected')
  })
  client.on('message', (_topic, buf) => {
    let m
    try {
      m = JSON.parse(buf.toString())
    } catch {
      return
    }
    const ack = (ok, extra = {}) => pub('ack', { v: 1, id: m.id ?? null, ok, type: m.type, ...extra })
    if (m.type === 'hb') { lastHb = Date.now(); return }
    if (m.type === 'arm') {
      armed = !!m.on
      lastHb = Date.now()
      if (!armed) zeroAll()
      status()
      return ack(true, { armed })
    }
    if (m.type === 'estop') {
      armed = false
      zeroAll()
      status()
      telemetry()
      return ack(true, { armed: false })
    }
    if (m.type === 'set') {
      if (!(m.actuator in duty)) return ack(false, { actuator: m.actuator, error: 'unknown actuator' })
      const d = Number(m.duty)
      if (!Number.isFinite(d) || d < 0 || d > 1) return ack(false, { actuator: m.actuator, error: 'duty must be 0..1' })
      if (d > 0 && !armed) return ack(false, { actuator: m.actuator, error: 'controller is disarmed' })
      duty[m.actuator] = d
      lastHb = Date.now()
      return ack(true, { actuator: m.actuator, applied: d })
    }
    ack(false, { error: 'unknown command' })
  })

  const tel = setInterval(telemetry, telemetryMs)
  const dog = setInterval(() => {
    if (armed && Date.now() - lastHb > failsafeMs) {
      log('failsafe: no heartbeat, outputs off')
      armed = false
      zeroAll()
      status()
      telemetry()
    }
  }, Math.max(50, Math.min(1000, failsafeMs / 4)))

  return {
    client,
    /** change what a simulated sensor reads */
    setSensor(id, value) { if (sensor[id]) sensor[id].value = value },
    get state() { return { armed, duty: { ...duty } } },
    publishTelemetryNow: telemetry,
    ready: new Promise((ok) => client.once('connect', () => ok())),
    async stop() {
      clearInterval(tel)
      clearInterval(dog)
      await client.endAsync()
    },
  }
}
