import { afterEach, describe, expect, it } from 'vitest'
import mqtt from 'mqtt'
import { WebSocket } from 'ws'
// @ts-expect-error plain ESM without types
import { startBackend } from '../../server/backend.mjs'
// @ts-expect-error plain ESM without types
import { createSimDevice } from '../../server/sim-device.mjs'

type Backend = { port: number; mqttPort: number; token: string; close: () => Promise<void> }
type Dev = { stop: () => Promise<void>; ready: Promise<void>; state: { armed: boolean; duty: Record<string, number> }; setSensor: (id: string, v: number) => void; publishTelemetryNow: () => void }
const cleanup: (() => Promise<void> | void)[] = []
afterEach(async () => { for (const f of cleanup.splice(0).reverse()) await f() })

const TOKEN = 'test-token-123'
async function boot() {
  const b = (await startBackend({ port: 0, mqttPort: 0, host: '127.0.0.1', token: TOKEN, quiet: true })) as Backend
  cleanup.push(() => b.close())
  return b
}
function browser(b: Backend, token = TOKEN) {
  const ws = new WebSocket(`ws://127.0.0.1:${b.port}/telemetry?token=${token}`)
  cleanup.push(() => ws.terminate())
  const msgs: Record<string, any>[] = []
  ws.on('message', (d) => msgs.push(JSON.parse(d.toString())))
  const until = async (pred: (m: Record<string, any>) => boolean, ms = 4000) => {
    const t0 = Date.now()
    for (;;) {
      const f = msgs.find(pred)
      if (f) return f
      if (Date.now() - t0 > ms) throw new Error('timeout; saw ' + JSON.stringify(msgs.slice(-5)))
      await new Promise((r) => setTimeout(r, 15))
    }
  }
  return { ws, msgs, until, open: new Promise<void>((ok, fail) => { ws.on('open', () => ok()); ws.on('error', fail) }), send: (m: unknown) => ws.send(JSON.stringify(m)) }
}
async function device(b: Backend, extra: Record<string, unknown> = {}) {
  const d = createSimDevice({
    brokerUrl: `mqtt://127.0.0.1:${b.mqttPort}`, token: TOKEN, space: 'sp1', ctrl: 'esp32-a', plan: 'abc123', quiet: true, telemetryMs: 100, failsafeMs: 400,
    actuators: [{ id: 'fan01', kind: 'motor', pin: 25 }, { id: 'led01', kind: 'led', pin: 18 }],
    sensors: [{ id: 'temp01', kind: 'temperature', value: 28.5 }, { id: 'lux01', kind: 'light', value: 420 }],
    ...extra,
  }) as Dev
  cleanup.push(() => d.stop())
  await d.ready
  return d
}
const CMD = 'smartspace/sp1/esp32-a/cmd'

describe('backend: auth', () => {
  it('rejects browsers and MQTT clients that do not hold the token', async () => {
    const b = await boot()
    const bad = new WebSocket(`ws://127.0.0.1:${b.port}/telemetry?token=wrong`)
    cleanup.push(() => bad.terminate())
    const code = await new Promise<string>((r) => { bad.on('unexpected-response', (_q, res) => r(String(res.statusCode))); bad.on('open', () => r('open')); bad.on('error', () => undefined) })
    expect(code).toBe('401')

    const c = mqtt.connect(`mqtt://127.0.0.1:${b.mqttPort}`, { username: 'smartspace', password: 'nope', reconnectPeriod: 0, clientId: 'intruder' })
    cleanup.push(() => { c.end(true) })
    const err = await new Promise<string>((r) => { c.on('error', (e) => r(e.message)); c.on('connect', () => r('connected')) })
    expect(err).not.toBe('connected')
  })

  it('a controller cannot read or write another controller\'s topics', async () => {
    const b = await boot()
    const c = mqtt.connect(`mqtt://127.0.0.1:${b.mqttPort}`, { username: 'smartspace', password: TOKEN, clientId: 'esp32-b', reconnectPeriod: 0 })
    cleanup.push(() => { c.end(true) })
    await new Promise((r) => c.on('connect', r))
    const refused = await new Promise<boolean>((ok) => c.subscribe('smartspace/sp1/esp32-a/cmd', (e, granted) => ok(!!e || (granted as { qos: number }[])?.[0]?.qos === 128)))
    expect(refused).toBe(true)
    // behavioural check: a command for controller A must never reach controller B
    const got: string[] = []
    c.on('message', (t) => got.push(t))
    const br = browser(b); await br.open
    c.publish('smartspace/sp1/esp32-a/telemetry', JSON.stringify({ spoof: true }))
    br.send({ type: 'publish', topic: 'smartspace/sp1/esp32-a/cmd', payload: { type: 'hb' } })
    await new Promise((r) => setTimeout(r, 300))
    expect(br.msgs.some((m) => m.payload?.spoof)).toBe(false) // spoofed telemetry was dropped
    expect(got).toEqual([]) // and B never saw A's command
  })

  it('a browser may only publish command topics', async () => {
    const b = await boot()
    const br = browser(b); await br.open
    br.send({ type: 'publish', topic: 'smartspace/sp1/esp32-a/telemetry', payload: { fake: 1 } })
    expect(await br.until((m) => m.type === 'error')).toMatchObject({ code: 'not-allowed' })
  })
})

describe('end to end: app → broker → controller → ack → app', () => {
  it('delivers sensor telemetry to the browser', async () => {
    const b = await boot()
    await device(b)
    const br = browser(b); await br.open
    const t = await br.until((m) => m.type === 'mqtt' && m.topic === 'smartspace/sp1/esp32-a/telemetry')
    expect(t.payload.sensors.temp01.t).toBe(28.5)
    expect(t.payload.sensors.lux01.lux).toBe(420)
    expect(t.payload.plan).toBe('abc123')
  })

  it('stays disarmed until armed, then applies a fan duty and acknowledges it', async () => {
    const b = await boot()
    const d = await device(b)
    const br = browser(b); await br.open
    await br.until((m) => m.topic?.endsWith('/status') && m.payload.online === true)

    br.send({ type: 'publish', topic: CMD, payload: { v: 1, id: 'c1', type: 'set', actuator: 'fan01', duty: 0.6 } })
    expect(await br.until((m) => m.payload?.id === 'c1')).toMatchObject({ payload: { ok: false, error: 'controller is disarmed' } })
    expect(d.state.duty.fan01).toBe(0)

    br.send({ type: 'publish', topic: CMD, payload: { v: 1, id: 'c2', type: 'arm', on: true } })
    expect(await br.until((m) => m.payload?.id === 'c2')).toMatchObject({ payload: { ok: true, armed: true } })
    br.send({ type: 'publish', topic: CMD, payload: { v: 1, id: 'c3', type: 'set', actuator: 'fan01', duty: 0.6 } })
    expect(await br.until((m) => m.payload?.id === 'c3')).toMatchObject({ payload: { ok: true, applied: 0.6 } })
    expect(d.state.duty.fan01).toBe(0.6)
    // a different level → a different duty (Test 12 / 13 at protocol level)
    br.send({ type: 'publish', topic: CMD, payload: { v: 1, id: 'c4', type: 'set', actuator: 'led01', duty: 0.8 } })
    expect(await br.until((m) => m.payload?.id === 'c4')).toMatchObject({ payload: { ok: true, applied: 0.8 } })
    expect(d.state.duty).toMatchObject({ fan01: 0.6, led01: 0.8 })
  })

  it('rejects out-of-range and unknown-actuator commands', async () => {
    const b = await boot()
    await device(b)
    const br = browser(b); await br.open
    br.send({ type: 'publish', topic: CMD, payload: { id: 'a', type: 'arm', on: true } })
    await br.until((m) => m.payload?.id === 'a')
    br.send({ type: 'publish', topic: CMD, payload: { id: 'x', type: 'set', actuator: 'fan01', duty: 7 } })
    expect(await br.until((m) => m.payload?.id === 'x')).toMatchObject({ payload: { ok: false } })
    br.send({ type: 'publish', topic: CMD, payload: { id: 'y', type: 'set', actuator: 'nope', duty: 0.1 } })
    expect(await br.until((m) => m.payload?.id === 'y')).toMatchObject({ payload: { ok: false, error: 'unknown actuator' } })
  })

  it('emergency stop zeroes every output and disarms', async () => {
    const b = await boot()
    const d = await device(b)
    const br = browser(b); await br.open
    br.send({ type: 'publish', topic: CMD, payload: { id: 'a', type: 'arm', on: true } }); await br.until((m) => m.payload?.id === 'a')
    br.send({ type: 'publish', topic: CMD, payload: { id: 'b', type: 'set', actuator: 'fan01', duty: 1 } }); await br.until((m) => m.payload?.id === 'b')
    br.send({ type: 'publish', topic: CMD, payload: { id: 'e', type: 'estop' } })
    await br.until((m) => m.payload?.id === 'e' && m.payload.ok)
    expect(d.state).toEqual({ armed: false, duty: { fan01: 0, led01: 0 } })
  })

  it('fails safe: no heartbeat → outputs off and disarmed', async () => {
    const b = await boot()
    const d = await device(b)
    const br = browser(b); await br.open
    br.send({ type: 'publish', topic: CMD, payload: { id: 'a', type: 'arm', on: true } }); await br.until((m) => m.payload?.id === 'a')
    br.send({ type: 'publish', topic: CMD, payload: { id: 'b', type: 'set', actuator: 'fan01', duty: 0.7 } }); await br.until((m) => m.payload?.id === 'b')
    expect(d.state.duty.fan01).toBe(0.7)
    await new Promise((r) => setTimeout(r, 900)) // failsafeMs = 400
    expect(d.state).toEqual({ armed: false, duty: { fan01: 0, led01: 0 } })
  })

  it('reports the controller offline when it disconnects (last will)', async () => {
    const b = await boot()
    const d = await device(b)
    const br = browser(b); await br.open
    await br.until((m) => m.topic?.endsWith('/status') && m.payload.online === true)
    d.stop() // clean end does not publish the will, so kill the socket instead
    ;(d as unknown as { client: { stream: { destroy: () => void } } }).client.stream.destroy()
    await br.until((m) => m.topic?.endsWith('/status') && m.payload.online === false, 5000)
  })
})
