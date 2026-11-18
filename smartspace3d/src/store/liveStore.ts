import { create } from 'zustand'
import { ACK_TIMEOUT_MS, CommandBook, dutyForDevice, HEARTBEAT_MS, LiveLink, parseTopic, readingsFrom, type LinkState, type SensorReading, type WsLike } from '@/iot/live'
import type { HardwarePlan } from '@/iot/types'
import type { HardwareRunMode, DeviceConfig } from '@/types'
import { getEngine, useSim } from './simStore'
import { useEditor } from './editorStore'
import { toast } from './uiStore'

export interface ControllerLive {
  online: boolean
  armed: boolean
  fw?: string
  seenAt?: number
  telemetryAt?: number
  seq?: number
  uptime?: number
}
export interface LogLine { ts: number; dir: 'in' | 'out' | 'sys'; text: string }

interface LiveState {
  link: LinkState
  linkDetail: string
  token: string
  plan: HardwarePlan | null
  controllers: Record<string, ControllerLive>
  readings: Record<string, SensorReading>
  reported: Record<string, { duty: number; at: number }>
  confirmed: Record<string, { duty: number; at: number }>
  failed: Record<string, { duty: number; reason: string; at: number }>
  pendingCount: number
  log: LogLine[]
  /** mirror the simulation's device state to the hardware while armed (Hardware Control) */
  mirror: boolean
  /** bumped once per second so freshness badges age without new messages */
  tick: number
  set: (p: Partial<Pick<LiveState, 'token' | 'mirror'>>) => void
}

const TOKEN_KEY = 'smartspace.token'
const readToken = () => { try { return sessionStorage.getItem(TOKEN_KEY) ?? '' } catch { return '' } }

export const useLive = create<LiveState>((set) => ({
  link: 'disconnected',
  linkDetail: '',
  token: readToken(),
  plan: null,
  controllers: {},
  readings: {},
  reported: {},
  confirmed: {},
  failed: {},
  pendingCount: 0,
  log: [],
  mirror: true,
  tick: 0,
  set: (p) => {
    if (p.token !== undefined) { try { sessionStorage.setItem(TOKEN_KEY, p.token) } catch { /* private mode */ } }
    set(p)
  },
}))

const book = new CommandBook()
let link: LiveLink | null = null
let timer: ReturnType<typeof setInterval> | null = null
let drainTimer: ReturnType<typeof setInterval> | null = null
/** latest wanted duty per actuator, sent at a pace the backend accepts (it rate-limits browsers to 30 messages/s) */
const outbox = new Map<string, { ctrl: string; duty: number }>()
let retry: ReturnType<typeof setTimeout> | null = null
let wantOpen = false
const lastHb = new Map<string, number>()
const lastSentDuty = new Map<string, { duty: number; at: number }>()
const lastAssim = new Map<string, number>()
const slug = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, '_')

const spaceSlug = () => slug(useEditor.getState().space?.id ?? 'space')
const topic = (ctrl: string, kind: string) => `smartspace/${spaceSlug()}/${ctrl}/${kind}`
const mode = (): HardwareRunMode => useEditor.getState().space?.hardware?.runMode ?? 'simulation'

function log(dir: LogLine['dir'], text: string) {
  useLive.setState((s) => ({ log: [...s.log.slice(-299), { ts: Date.now(), dir, text }] }))
}
const syncBook = () => useLive.setState({ confirmed: Object.fromEntries(book.confirmed), failed: Object.fromEntries(book.failed), pendingCount: book.pending.size })

export function setLivePlan(plan: HardwarePlan | null) { useLive.setState({ plan }) }

function ensureLink() {
  if (link) return link
  link = new LiveLink(
    (url) => new WebSocket(url) as unknown as WsLike,
    {
      onState: (s, d) => {
        useLive.setState({ link: s, linkDetail: d ?? '' })
        if (s === 'connected') { log('sys', 'Connected to the SmartSpace backend'); wantOpen = true }
        if (s === 'error' || s === 'disconnected') onLinkDown(s, d)
      },
      onMessage,
    },
  )
  return link
}

function onLinkDown(s: LinkState, detail?: string) {
  const dropped = book.dropAll(Date.now(), 'connection lost')
  syncBook()
  const armed = Object.entries(useLive.getState().controllers).filter(([, c]) => c.armed)
  if (armed.length) log('sys', `Connection lost while armed. ${armed.map(([id]) => id).join(', ')} will turn outputs off by themselves after ${HEARTBEAT_MS * 4 / 1000 | 0}+ s without heartbeat. Nothing is re-armed automatically.`)
  else if (dropped.length) log('sys', 'Connection lost; unconfirmed commands were dropped')
  if (s === 'error' && detail) log('sys', detail)
  if (wantOpen && s === 'disconnected') {
    if (retry) clearTimeout(retry)
    retry = setTimeout(() => { if (wantOpen) openLink() }, 3000)
  }
}

function openLink() {
  const { token } = useLive.getState()
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  ensureLink().connect(`${proto}://${window.location.host}/telemetry?token=${encodeURIComponent(token)}`)
}

export function liveConnect() {
  if (!useLive.getState().token) { toast('Paste the backend token first (printed when the backend starts).', 'warning'); return }
  wantOpen = true
  openLink()
  if (!timer) timer = setInterval(loop, 1000)
  if (!drainTimer) drainTimer = setInterval(drain, 70)
}

function drain() {
  const next = outbox.entries().next()
  if (next.done) return
  const [actuator, w] = next.value
  outbox.delete(actuator)
  send(w.ctrl, { type: 'set', actuator, duty: w.duty })
}

export function liveDisconnect() {
  wantOpen = false
  if (retry) { clearTimeout(retry); retry = null }
  // leave outputs safe before dropping the link
  for (const [ctrl, c] of Object.entries(useLive.getState().controllers)) if (c.armed) send(ctrl, { type: 'arm', on: false })
  link?.close()
  if (timer) { clearInterval(timer); timer = null }
  if (drainTimer) { clearInterval(drainTimer); drainTimer = null }
  outbox.clear()
  useLive.setState({ link: 'disconnected', linkDetail: '' })
}

/** A disarmed / stopped controller no longer holds the duties it confirmed earlier. */
function clearConfirmed(ctrl: string) {
  const plan = useLive.getState().plan
  for (const p of plan?.parts ?? []) if (p.controllerId === ctrl) { book.confirmed.delete(p.id); lastSentDuty.delete(p.id) }
  syncBook()
}

function onMessage(m: { type: string; topic?: string; payload?: unknown; ts?: number }) {
  if (m.type === 'error') { log('sys', `Backend refused a message: ${String((m as { code?: string }).code)}`); return }
  if (m.type !== 'mqtt' || !m.topic) return
  const t = parseTopic(m.topic)
  if (!t || t.space !== spaceSlug()) return
  const ts = m.ts ?? Date.now()
  const p = (m.payload ?? {}) as Record<string, unknown>
  if (t.kind === 'status') {
    useLive.setState((s) => ({ controllers: { ...s.controllers, [t.ctrl]: { ...s.controllers[t.ctrl], online: p.online === true, armed: p.online === true && p.armed === true, fw: typeof p.fw === 'string' ? p.fw : s.controllers[t.ctrl]?.fw, seenAt: ts } } }))
    if (p.online !== true || p.armed !== true) clearConfirmed(t.ctrl)
    log('in', `${t.ctrl} status: ${p.online ? 'online' : 'OFFLINE'}${p.online ? `, ${p.armed ? 'ARMED' : 'disarmed'}` : ''}`)
  } else if (t.kind === 'telemetry') {
    const readings = readingsFrom(p.sensors, ts)
    const acts = (p.actuators ?? {}) as Record<string, { duty?: number }>
    useLive.setState((s) => {
      const readingsNext = { ...s.readings }
      for (const r of readings) readingsNext[r.id] = r
      const reported = { ...s.reported }
      for (const [id, a] of Object.entries(acts)) if (typeof a?.duty === 'number') reported[id] = { duty: a.duty, at: ts }
      return {
        readings: readingsNext,
        reported,
        controllers: { ...s.controllers, [t.ctrl]: { ...s.controllers[t.ctrl], online: true, armed: p.armed === true, telemetryAt: ts, seenAt: ts, seq: typeof p.seq === 'number' ? p.seq : undefined, uptime: typeof p.uptime === 'number' ? p.uptime : undefined } },
      }
    })
    log('in', `${t.ctrl} telemetry #${p.seq ?? '?'}: ${readings.map((r) => `${r.id}=${r.error ? 'ERR' : r.value ?? (r.relative != null ? `${r.relative}rel` : r.motion ? 'motion' : 'still')}`).join(' ')}`)
    assimilate(readings)
  } else if (t.kind === 'ack') {
    const c = book.ack(p as { id?: string; ok?: boolean; error?: string }, Date.now())
    syncBook()
    log('in', `${t.ctrl} ack ${p.ok ? 'OK' : 'REFUSED'}${c?.actuator ? ` ${c.actuator}` : ''}${p.error ? `: ${String(p.error)}` : ''}`)
    if (c?.type === 'estop' || (c?.type === 'arm' && !c.on)) clearConfirmed(t.ctrl)
    if (c?.type === 'estop' || c?.type === 'arm') useLive.setState((s) => ({ controllers: { ...s.controllers, [t.ctrl]: { ...s.controllers[t.ctrl], armed: c.type === 'arm' ? !!c.on : false } } }))
  }
}

/** Feed fresh hardware readings into the running simulation (monitor / control modes only). */
function assimilate(readings: SensorReading[]) {
  if (mode() === 'simulation') return
  const plan = useLive.getState().plan
  const cfg = useEditor.getState().space?.hardware
  const eng = getEngine()
  if (!plan || !cfg || !eng) return
  const now = Date.now()
  for (const r of readings) {
    if (r.error) continue
    const part = plan.parts.find((x) => x.id === r.id)
    const sp = part?.sensorId ? cfg.sensors.find((s) => s.id === part.sensorId) : undefined
    if (!part || !sp || now - (lastAssim.get(r.id) ?? 0) < 2000) continue
    if (sp.kind === 'temperature' && r.value != null) { eng.assimilateTemperature(sp.position[0], sp.position[2], r.value); lastAssim.set(r.id, now) }
    // an uncalibrated LDR is a relative level, never injected as lux
    else if (sp.kind === 'light' && r.value != null && r.calibrated) { eng.assimilateLux(sp.position[0], sp.position[2], r.value); lastAssim.set(r.id, now) }
  }
}

function send(ctrl: string, body: { type: 'set' | 'arm' | 'estop' | 'hb'; actuator?: string; duty?: number; on?: boolean }): boolean {
  if (!link || link.state !== 'connected') return false
  if (body.type === 'hb') {
    log('out', `${ctrl} heartbeat`)
    return link.publishCmd(topic(ctrl, 'cmd'), { v: 1, type: 'hb' })
  }
  const cmd = book.create({ type: body.type, ctrl, actuator: body.actuator, duty: body.duty, on: body.on }, Date.now())
  const ok = link.publishCmd(topic(ctrl, 'cmd'), { v: 1, id: cmd.id, ...body })
  if (!ok) { book.pending.delete(cmd.id); return false }
  log('out', `${ctrl} ${body.type}${body.actuator ? ` ${body.actuator}=${body.duty}` : ''}${body.on != null ? ` ${body.on}` : ''}`)
  syncBook()
  return true
}

/** Explicit activation. Only allowed in Hardware Control; the UI asks the person to confirm first. */
export function liveArm(ctrl: string, on: boolean): boolean {
  if (on && mode() !== 'control') { toast('Switch to Hardware Control mode before arming.', 'warning'); return false }
  if (on) { lastHb.set(ctrl, Date.now()); lastSentDuty.clear() }
  return send(ctrl, { type: 'arm', on })
}

/** Emergency stop: every controller, immediately, independent of mode. Outputs go to 0 and the controller disarms. */
export function liveEstop() {
  const plan = useLive.getState().plan
  outbox.clear()
  for (const c of plan?.controllers ?? []) send(c.id, { type: 'estop' })
  useLive.setState({ mirror: false })
  lastSentDuty.clear()
  log('sys', 'EMERGENCY STOP sent to every controller')
}

/** Manual test: one actuator. Only allowed in Hardware Control, while armed, and not while mirroring the simulation. */
export function liveSetDuty(actuator: string, duty: number): boolean {
  const plan = useLive.getState().plan
  const part = plan?.parts.find((p) => p.id === actuator)
  if (!part) return false
  if (mode() !== 'control') { toast('Hardware Control mode is required to move an output.', 'warning'); return false }
  return send(part.controllerId, { type: 'set', actuator, duty })
}

/** Called when the person changes the run mode. Leaving Hardware Control makes the outputs safe first. */
export function onRunModeChanged(next: HardwareRunMode) {
  if (next !== 'control') outbox.clear()
  if (next !== 'control') {
    for (const [ctrl, c] of Object.entries(useLive.getState().controllers)) if (c.armed) send(ctrl, { type: 'arm', on: false })
    lastSentDuty.clear()
  }
}

export function desiredDuty(actuatorId: string): number | null {
  const plan = useLive.getState().plan
  const part = plan?.parts.find((p) => p.id === actuatorId)
  const objId = part?.virtual?.objectId
  if (!objId) return null
  const live = useSim.getState().snapshot?.devices.find((d) => d.id === objId)
  const obj = useEditor.getState().space?.objects.find((o) => o.id === objId)
  if (!live || !obj?.device) return null
  const dev = obj.device as DeviceConfig
  const maxLevel = dev.type === 'light' ? 1 : dev.levels.length - 1
  return dutyForDevice(live, maxLevel)
}

function loop() {
  const now = Date.now()
  for (const c of book.expire(now)) log('sys', `No acknowledgement for ${c.type}${c.actuator ? ` ${c.actuator}` : ''} within ${ACK_TIMEOUT_MS / 1000} s: NOT confirmed`)
  syncBook()
  useLive.setState((s) => ({ tick: s.tick + 1 }))
  const st = useLive.getState()
  if (mode() !== 'control' || st.link !== 'connected' || !st.plan) return
  for (const ctrl of st.plan.controllers) {
    const c = st.controllers[ctrl.id]
    if (!c?.armed) continue
    if (now - (lastHb.get(ctrl.id) ?? 0) >= HEARTBEAT_MS) { lastHb.set(ctrl.id, now); send(ctrl.id, { type: 'hb' }) }
    if (!st.mirror) continue
    for (const p of st.plan.parts.filter((x) => x.controllerId === ctrl.id && x.virtual)) {
      const d = desiredDuty(p.id)
      if (d == null) continue
      const prev = lastSentDuty.get(p.id)
      if (!prev || Math.abs(prev.duty - d) > 0.02 || (now - prev.at > 20000 && !book.confirmed.has(p.id))) {
        lastSentDuty.set(p.id, { duty: d, at: now })
        outbox.set(p.id, { ctrl: ctrl.id, duty: Math.round(d * 1000) / 1000 })
      }
    }
  }
}

/** For tests: forget all link state. */
export function _resetLive() {
  wantOpen = false
  link?.close()
  link = null
  if (timer) clearInterval(timer)
  timer = null
  if (drainTimer) clearInterval(drainTimer)
  drainTimer = null
  outbox.clear()
  book.pending.clear(); book.confirmed.clear(); book.failed.clear()
  lastHb.clear(); lastSentDuty.clear(); lastAssim.clear()
  useLive.setState({ link: 'disconnected', controllers: {}, readings: {}, reported: {}, confirmed: {}, failed: {}, log: [], pendingCount: 0 })
}
