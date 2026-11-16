import { afterEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { ACK_TIMEOUT_MS, CommandBook, dutyForDevice, FRESH_MS, freshness, LiveLink, parseTopic, readingsFrom, STALE_MS, type WsLike } from '@/iot/live'
// @ts-expect-error plain ESM without types
import { startBackend } from '../../server/backend.mjs'
// @ts-expect-error plain ESM without types
import { createSimDevice } from '../../server/sim-device.mjs'

describe('freshness tags', () => {
  const base = { now: 100_000, connected: true }
  it('simulation mode is always "simulated"', () => expect(freshness({ ...base, mode: 'simulation', seenAt: 99_000 })).toBe('simulated'))
  it('live → stale → unavailable as the reading ages', () => {
    expect(freshness({ ...base, mode: 'monitor', seenAt: base.now - 1000 })).toBe('live')
    expect(freshness({ ...base, mode: 'monitor', seenAt: base.now - FRESH_MS - 1 })).toBe('stale')
    expect(freshness({ ...base, mode: 'monitor', seenAt: base.now - STALE_MS - 1 })).toBe('unavailable')
  })
  it('never seen, a sensor error, an offline controller or a dropped link are not "live"', () => {
    expect(freshness({ ...base, mode: 'control' })).toBe('unavailable')
    expect(freshness({ ...base, mode: 'control', seenAt: base.now, error: true })).toBe('unavailable')
    expect(freshness({ ...base, mode: 'control', seenAt: base.now, controllerOnline: false })).toBe('unavailable')
    expect(freshness({ ...base, mode: 'control', seenAt: base.now - 1000, connected: false })).toBe('stale')
  })
})

describe('telemetry parsing', () => {
  it('reads temperature, lux, relative LDR, motion, and keeps errors as errors', () => {
    const r = readingsFrom({ t1: { t: 27.5, rh: 40 }, l1: { lux: 320 }, l2: { raw: 100, rel: 0.4, calibrated: false }, p1: { motion: true }, x: { error: 'read failed' }, y: { foo: 1 } }, 5)
    const by = Object.fromEntries(r.map((x) => [x.id, x]))
    expect(by.t1).toMatchObject({ value: 27.5, humidity: 40 })
    expect(by.l1).toMatchObject({ value: 320, calibrated: true })
    expect(by.l2).toMatchObject({ relative: 0.4, calibrated: false })
    expect(by.l2.value).toBeUndefined() // never presented as lux
    expect(by.p1.motion).toBe(true)
    expect(by.x.error).toBe('read failed')
    expect(by.y.error).toBeTruthy()
  })
  it('parses topics strictly', () => {
    expect(parseTopic('smartspace/a-b/esp32-a/ack')).toEqual({ space: 'a-b', ctrl: 'esp32-a', kind: 'ack' })
    expect(parseTopic('other/a/b/ack')).toBeNull()
  })
  it('maps virtual device state to duty', () => {
    expect(dutyForDevice({ type: 'fan', level: 2, on: true, dimming: 1 }, 3)).toBeCloseTo(2 / 3)
    expect(dutyForDevice({ type: 'fan', level: 0, on: true, dimming: 1 }, 3)).toBe(0)
    expect(dutyForDevice({ type: 'light', level: 0, on: false, dimming: 0.8 }, 1)).toBe(0)
    expect(dutyForDevice({ type: 'light', level: 0, on: true, dimming: 0.8 }, 1)).toBeCloseTo(0.8)
  })
})

describe('commands are only done after an ack', () => {
  it('confirmed, rejected, timed out, dropped', () => {
    const b = new CommandBook()
    const a = b.create({ type: 'set', ctrl: 'c', actuator: 'fan01', duty: 0.5 }, 0)
    expect(b.confirmed.has('fan01')).toBe(false) // nothing is assumed
    b.ack({ id: a.id, ok: true }, 10)
    expect(b.confirmed.get('fan01')?.duty).toBe(0.5)
    const r = b.create({ type: 'set', ctrl: 'c', actuator: 'fan01', duty: 1 }, 20)
    b.ack({ id: r.id, ok: false, error: 'controller is disarmed' }, 30)
    expect(b.failed.get('fan01')?.reason).toBe('controller is disarmed')
    const t = b.create({ type: 'set', ctrl: 'c', actuator: 'led01', duty: 1 }, 40)
    expect(b.expire(40 + ACK_TIMEOUT_MS - 1)).toHaveLength(0)
    expect(b.expire(40 + ACK_TIMEOUT_MS + 1)[0].id).toBe(t.id)
    expect(b.failed.has('led01')).toBe(true)
    b.create({ type: 'set', ctrl: 'c', actuator: 'fan01', duty: 0.2 }, 50)
    b.dropAll(60, 'connection lost')
    expect(b.confirmed.size).toBe(0) // a dropped link invalidates earlier confirmations
    expect(b.pending.size).toBe(0)
  })
  it('an ack for an unknown id is ignored', () => expect(new CommandBook().ack({ id: 'zzz', ok: true }, 0)).toBeUndefined())
})

// ── against the real backend and the simulated controller ──
type Backend = { port: number; mqttPort: number; token: string; close: () => Promise<void> }
const cleanup: (() => Promise<void> | void)[] = []
afterEach(async () => { for (const f of cleanup.splice(0).reverse()) await f() })
const wait = async (pred: () => boolean, ms = 4000) => { const t0 = Date.now(); while (!pred()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 15)) } }

describe('LiveLink ↔ backend ↔ simulated controller', () => {
  it('connects, receives telemetry, and a set command is confirmed only by the controller ack; failsafe and e-stop work', async () => {
    const b = (await startBackend({ port: 0, mqttPort: 0, host: '127.0.0.1', token: 'tok', quiet: true })) as Backend
    cleanup.push(() => b.close())
    const dev = createSimDevice({ brokerUrl: `mqtt://127.0.0.1:${b.mqttPort}`, token: 'tok', space: 'sp', ctrl: 'esp32-a', quiet: true, telemetryMs: 100, failsafeMs: 500, actuators: [{ id: 'fan01', kind: 'motor' }], sensors: [{ id: 'temp01', kind: 'temperature', value: 29 }] })
    cleanup.push(() => dev.stop())
    await dev.ready
    const seen: { type: string; topic?: string; payload?: any }[] = []
    const states: string[] = []
    const book = new CommandBook()
    const link = new LiveLink((u) => new WebSocket(u) as unknown as WsLike, { onState: (s) => states.push(s), onMessage: (m) => { seen.push(m); if (m.topic?.endsWith('/ack')) book.ack(m.payload as { id?: string; ok?: boolean; error?: string }, Date.now()) } })
    cleanup.push(() => link.close())
    link.connect(`ws://127.0.0.1:${b.port}/telemetry?token=tok`)
    await wait(() => link.state === 'connected')
    await wait(() => seen.some((m) => m.topic?.endsWith('/telemetry')))
    const tel = seen.find((m) => m.topic?.endsWith('/telemetry'))!
    expect(readingsFrom(tel.payload.sensors, 0)[0]).toMatchObject({ id: 'temp01', value: 29 })

    const cmd = 'smartspace/sp/esp32-a/cmd'
    // 1) refused while disarmed → no confirmation
    const c1 = book.create({ type: 'set', ctrl: 'esp32-a', actuator: 'fan01', duty: 0.6 }, Date.now())
    link.publishCmd(cmd, { v: 1, id: c1.id, type: 'set', actuator: 'fan01', duty: 0.6 })
    await wait(() => book.failed.has('fan01'))
    expect(book.failed.get('fan01')?.reason).toMatch(/disarmed/)
    expect(book.confirmed.has('fan01')).toBe(false)
    expect(dev.state.duty.fan01).toBe(0)
    // 2) arm, then set
    const a = book.create({ type: 'arm', ctrl: 'esp32-a', on: true }, Date.now())
    link.publishCmd(cmd, { v: 1, id: a.id, type: 'arm', on: true })
    await wait(() => dev.state.armed)
    const c2 = book.create({ type: 'set', ctrl: 'esp32-a', actuator: 'fan01', duty: 0.6 }, Date.now())
    link.publishCmd(cmd, { v: 1, id: c2.id, type: 'set', actuator: 'fan01', duty: 0.6 })
    await wait(() => book.confirmed.has('fan01'))
    expect(dev.state.duty.fan01).toBeCloseTo(0.6)
    // 3) no heartbeat → the controller fails safe on its own
    await wait(() => !dev.state.armed, 3000)
    expect(dev.state.duty.fan01).toBe(0)
    // 4) e-stop
    const a2 = book.create({ type: 'arm', ctrl: 'esp32-a', on: true }, Date.now())
    link.publishCmd(cmd, { v: 1, id: a2.id, type: 'arm', on: true })
    await wait(() => dev.state.armed)
    link.publishCmd(cmd, { v: 1, id: 'e1', type: 'estop' })
    await wait(() => !dev.state.armed)
    expect(dev.state.duty.fan01).toBe(0)
  })
  it('a wrong token is an error with a clear message, not a silent hang', async () => {
    const b = (await startBackend({ port: 0, mqttPort: 0, host: '127.0.0.1', token: 'tok', quiet: true })) as Backend
    cleanup.push(() => b.close())
    const details: string[] = []
    const link = new LiveLink((u) => new WebSocket(u) as unknown as WsLike, { onState: (s, d) => { if (s === 'error') details.push(d ?? '') }, onMessage: () => undefined })
    cleanup.push(() => link.close())
    link.connect(`ws://127.0.0.1:${b.port}/telemetry?token=wrong`)
    await wait(() => details.length > 0)
    expect(details[0]).toMatch(/Could not connect|token/)
  })
})
