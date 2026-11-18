/**
 * Live hardware link (browser side). Pure protocol logic plus a small WebSocket client; the Zustand store
 * and the UI sit on top. Protocol v1 is documented in server/sim-device.mjs.
 */
import type { HardwareRunMode } from '@/types'

export const FRESH_MS = 8000
export const STALE_MS = 30000
export const ACK_TIMEOUT_MS = 3000
export const HEARTBEAT_MS = 4000

/** simulated: not coming from hardware; live: reported recently; stale: reported a while ago; unavailable: never / errored / controller offline */
export type Freshness = 'simulated' | 'live' | 'stale' | 'unavailable'

export function freshness(a: { mode: HardwareRunMode; seenAt?: number; now: number; error?: boolean; controllerOnline?: boolean; connected: boolean }): Freshness {
  if (a.mode === 'simulation') return 'simulated'
  if (a.error || a.seenAt == null || a.controllerOnline === false) return 'unavailable'
  const age = a.now - a.seenAt
  if (age <= FRESH_MS && a.connected) return 'live'
  if (age <= STALE_MS) return 'stale'
  return 'unavailable'
}

export interface TopicInfo { space: string; ctrl: string; kind: 'telemetry' | 'status' | 'ack' | 'cmd' }
export function parseTopic(topic: string): TopicInfo | null {
  const m = /^smartspace\/([\w-]+)\/([\w-]+)\/(telemetry|status|ack|cmd)$/.exec(topic)
  return m ? { space: m[1], ctrl: m[2], kind: m[3] as TopicInfo['kind'] } : null
}

export interface SensorReading {
  id: string
  value?: number
  /** light sensors without calibration only report a relative level */
  relative?: number
  calibrated?: boolean
  motion?: boolean
  humidity?: number
  error?: string
  ts: number
}

/** Turn the `sensors` object of a telemetry message into readings. Unknown shapes are reported as errors, never guessed. */
export function readingsFrom(sensors: unknown, ts: number): SensorReading[] {
  if (!sensors || typeof sensors !== 'object') return []
  const out: SensorReading[] = []
  for (const [id, raw] of Object.entries(sensors as Record<string, unknown>)) {
    const o = (raw ?? {}) as Record<string, unknown>
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
    if (typeof o.error === 'string') { out.push({ id, error: o.error, ts }); continue }
    const r: SensorReading = { id, ts }
    if (num(o.t) != null) r.value = num(o.t)
    else if (num(o.lux) != null) { r.value = num(o.lux); r.calibrated = true }
    else if (num(o.rel) != null) { r.relative = num(o.rel); r.calibrated = o.calibrated === true }
    if (typeof o.motion === 'boolean') r.motion = o.motion
    if (num(o.rh) != null) r.humidity = num(o.rh)
    if (r.value == null && r.relative == null && r.motion == null) r.error = 'unrecognised reading'
    out.push(r)
  }
  return out
}

/** Duty (0…1) a hardware actuator should show for a virtual device state. */
export function dutyForDevice(d: { type: 'fan' | 'ac' | 'light'; level: number; on: boolean; dimming: number }, maxLevel: number): number {
  if (d.type === 'light') return d.on ? Math.max(0, Math.min(1, d.dimming)) : 0
  if (maxLevel <= 0) return 0
  return Math.max(0, Math.min(1, d.level / maxLevel))
}

// ───────────────────────── commands that are only "done" once the device says so ─────────────────────────

export type CommandState = 'pending' | 'confirmed' | 'rejected' | 'timeout'
export interface Command { id: string; type: 'set' | 'arm' | 'estop'; ctrl: string; actuator?: string; duty?: number; on?: boolean; sentAt: number; state: CommandState; error?: string }

export class CommandBook {
  private seq = 0
  readonly pending = new Map<string, Command>()
  /** last confirmed duty per actuator (set only by an ack with ok:true) */
  readonly confirmed = new Map<string, { duty: number; at: number }>()
  /** last rejection / timeout per actuator, cleared by the next confirmed set */
  readonly failed = new Map<string, { duty: number; reason: string; at: number }>()
  private prefix: string
  constructor(prefix = 'c') { this.prefix = prefix }

  create(c: Omit<Command, 'id' | 'sentAt' | 'state'>, now: number): Command {
    const cmd: Command = { ...c, id: `${this.prefix}${++this.seq}`, sentAt: now, state: 'pending' }
    this.pending.set(cmd.id, cmd)
    return cmd
  }

  /** feed an ack message body; returns the command it resolved */
  ack(m: { id?: string | null; ok?: boolean; error?: string }, now: number): Command | undefined {
    const c = m.id ? this.pending.get(m.id) : undefined
    if (!c) return undefined
    this.pending.delete(c.id)
    if (m.ok) {
      c.state = 'confirmed'
      if (c.type === 'set' && c.actuator != null) { this.confirmed.set(c.actuator, { duty: c.duty ?? 0, at: now }); this.failed.delete(c.actuator) }
    } else {
      c.state = 'rejected'
      c.error = m.error ?? 'rejected'
      if (c.type === 'set' && c.actuator != null) this.failed.set(c.actuator, { duty: c.duty ?? 0, reason: c.error, at: now })
    }
    return c
  }

  /** commands that never got an ack */
  expire(now: number): Command[] {
    const out: Command[] = []
    for (const c of this.pending.values()) {
      if (now - c.sentAt > ACK_TIMEOUT_MS) {
        this.pending.delete(c.id)
        c.state = 'timeout'
        c.error = 'no acknowledgement from the controller'
        if (c.type === 'set' && c.actuator != null) this.failed.set(c.actuator, { duty: c.duty ?? 0, reason: c.error, at: now })
        out.push(c)
      }
    }
    return out
  }

  /** the connection dropped: nothing in flight can be assumed to have arrived */
  dropAll(now: number, reason: string): Command[] {
    const out = [...this.pending.values()]
    this.pending.clear()
    for (const c of out) { c.state = 'timeout'; c.error = reason; if (c.type === 'set' && c.actuator != null) this.failed.set(c.actuator, { duty: c.duty ?? 0, reason, at: now }) }
    // what was confirmed before the drop may no longer be true
    this.confirmed.clear()
    return out
  }
}

// ───────────────────────── WebSocket client ─────────────────────────

export type LinkState = 'disconnected' | 'connecting' | 'connected' | 'error'
export interface LinkHandlers {
  onState: (s: LinkState, detail?: string) => void
  onMessage: (m: { type: string; topic?: string; payload?: unknown; ts?: number; [k: string]: unknown }) => void
}

/** Minimal subset of the WebSocket API we use (so tests can pass `ws`). */
export interface WsLike {
  readyState: number
  send(data: string): void
  close(): void
  onopen: ((e: unknown) => void) | null
  onclose: ((e: { code?: number }) => void) | null
  onerror: ((e: unknown) => void) | null
  onmessage: ((e: { data: unknown }) => void) | null
}
export type WsFactory = (url: string) => WsLike

export class LiveLink {
  private ws: WsLike | null = null
  state: LinkState = 'disconnected'
  private make: WsFactory
  private h: LinkHandlers
  constructor(make: WsFactory, h: LinkHandlers) { this.make = make; this.h = h }

  connect(url: string) {
    this.close()
    this.set('connecting')
    let ws: WsLike
    try { ws = this.make(url) } catch (e) { this.set('error', (e as Error).message); return }
    this.ws = ws
    ws.onopen = () => this.set('connected')
    ws.onclose = (e) => {
      if (this.ws !== ws) return
      this.ws = null
      this.set(this.state === 'connecting' ? 'error' : 'disconnected', this.state === 'connecting' ? (e.code === 1006 || e.code == null ? 'Could not connect. Is the backend running, and is the token right?' : `closed (${e.code})`) : 'connection closed')
    }
    ws.onerror = () => { /* the close event that follows carries the outcome */ }
    ws.onmessage = (e) => {
      try { this.h.onMessage(JSON.parse(String(e.data))) } catch { /* ignore malformed frames */ }
    }
  }

  publishCmd(topic: string, payload: Record<string, unknown>): boolean {
    if (!this.ws || this.ws.readyState !== 1) return false
    this.ws.send(JSON.stringify({ type: 'publish', topic, payload }))
    return true
  }

  close() {
    const w = this.ws
    this.ws = null
    if (w) { w.onclose = null; w.close() }
    if (this.state !== 'disconnected') this.set('disconnected')
  }

  private set(s: LinkState, d?: string) { this.state = s; this.h.onState(s, d) }
}
