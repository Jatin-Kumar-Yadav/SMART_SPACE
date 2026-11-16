/**
 * SmartSpace 3D backend (local development / prototype).
 *
 *   Microcontrollers ⇄ MQTT broker (aedes, TCP) ⇄ bridge ⇄ WebSocket /telemetry ⇄ browser
 *   Phone camera     ⇄ WebSocket /signal (WebRTC signaling only; video never touches this server)
 *
 * Security model (prototype grade, read before exposing beyond your LAN)
 *  - One shared secret token (SMARTSPACE_TOKEN or a random one saved to server/.token, mode 0600).
 *  - MQTT clients must send username "smartspace" and the token as the password.
 *  - An MQTT client may only publish   smartspace/<space>/<its client id>/{telemetry,ack,status}
 *    and only subscribe to             smartspace/<space>/<its client id>/cmd.
 *    So one compromised board cannot read other boards' traffic or spoof their data.
 *  - Browsers must present the token on the /telemetry WebSocket and may only publish `…/cmd` topics.
 *  - The MQTT port is plain TCP: use it on a trusted LAN or put TLS in front of it.
 *  - Nothing here is a substitute for certified safety interlocks (see the README).
 */
import { createServer } from 'node:http'
import net from 'node:net'
import os from 'node:os'
import { timingSafeEqual, randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { Aedes } from 'aedes'
import { WebSocketServer } from 'ws'
import { attachSignaling } from './signaling.mjs'

export const MQTT_USER = 'smartspace'
const ID = '[A-Za-z0-9_-]{1,40}'
/** device → broker topics, and the only topic a browser may publish to */
const DEVICE_PUB = new RegExp(`^smartspace/(${ID})/(${ID})/(telemetry|ack|status)$`)
const DEVICE_SUB = new RegExp(`^smartspace/(${ID})/(${ID})/cmd$`)
export const CMD_TOPIC = DEVICE_SUB

const here = dirname(fileURLToPath(import.meta.url))

export function loadOrCreateToken(file = join(here, '.token')) {
  if (process.env.SMARTSPACE_TOKEN) return process.env.SMARTSPACE_TOKEN
  if (existsSync(file)) return readFileSync(file, 'utf8').trim()
  const t = randomBytes(18).toString('base64url')
  writeFileSync(file, t + '\n', { mode: 0o600 })
  try {
    chmodSync(file, 0o600)
  } catch {
    /* windows */
  }
  return t
}

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a))
  const y = Buffer.from(String(b))
  return x.length === y.length && timingSafeEqual(x, y)
}

export function lanAddresses() {
  const out = []
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const i of list ?? []) if (i.family === 'IPv4' && !i.internal) out.push({ name, address: i.address })
  }
  return out
}

/**
 * @param {{ port?: number, mqttPort?: number, host?: string, token?: string, quiet?: boolean }} opts
 */
export async function startBackend(opts = {}) {
  const token = opts.token ?? loadOrCreateToken()
  const host = opts.host ?? '0.0.0.0'
  const log = opts.quiet ? () => {} : (...a) => console.log('[backend]', ...a)

  // ── MQTT broker ───────────────────────────────────────────────
  const aedes = await Aedes.createBroker({
    authenticate(client, username, password, cb) {
      const ok = username === MQTT_USER && password && safeEqual(password.toString(), token)
      if (!ok) {
        const e = new Error('bad credentials')
        e.returnCode = 4
        return cb(e, false)
      }
      cb(null, true)
    },
    authorizePublish(client, packet, cb) {
      const m = DEVICE_PUB.exec(packet.topic)
      if (!m || m[2] !== client.id) return cb(new Error('topic not allowed for this client'))
      if (packet.payload.length > 4096) return cb(new Error('payload too large'))
      cb(null)
    },
    authorizeSubscribe(client, sub, cb) {
      const m = DEVICE_SUB.exec(sub.topic)
      // a null subscription is answered with SUBACK 0x80 (refused) and the client stays connected
      if (!m || m[2] !== client.id) return cb(null, null)
      cb(null, sub)
    },
  })
  const mqttServer = net.createServer(aedes.handle)
  await new Promise((ok, fail) => {
    mqttServer.once('error', fail)
    mqttServer.listen(opts.mqttPort ?? 1883, host, ok)
  })
  const mqttPort = mqttServer.address().port

  // ── HTTP + WebSockets ─────────────────────────────────────────
  const http = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    if (url.pathname === '/api/info') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      return res.end(JSON.stringify({ app: 'smartspace3d-backend', lan: lanAddresses(), mqttPort, tokenRequired: true, topicRoot: 'smartspace' }))
    }
    if (url.pathname === '/api/health') {
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end('{"ok":true}')
    }
    res.writeHead(404).end()
  })
  const signaling = attachSignaling(http, { path: '/signal' })

  /** latest message per topic, replayed to a browser that connects later */
  const last = new Map()
  const clients = new Set()
  const wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 })
  const send = (ws, m) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(m))

  aedes.subscribe(
    'smartspace/#',
    (packet, cb) => {
      // commands go app → device only; browsers have no use for echoes of them
      if (packet.topic.endsWith('/cmd')) return cb()
      let payload
      const text = packet.payload.toString('utf8')
      try {
        payload = JSON.parse(text)
      } catch {
        payload = text
      }
      const msg = { type: 'mqtt', topic: packet.topic, payload, ts: Date.now() }
      last.set(packet.topic, msg)
      for (const c of clients) send(c, msg)
      cb()
    },
    () => {},
  )

  wss.on('connection', (ws) => {
    clients.add(ws)
    send(ws, { type: 'hello', topicRoot: 'smartspace', mqttPort, controllersOnline: Object.keys(aedes.clients) })
    for (const m of last.values()) send(ws, m)
    let sent = []
    ws.on('message', (raw) => {
      const now = Date.now()
      sent = sent.filter((t) => now - t < 1000)
      if (sent.length >= 30) return send(ws, { type: 'error', code: 'rate-limited' })
      sent.push(now)
      let m
      try {
        m = JSON.parse(raw.toString())
      } catch {
        return send(ws, { type: 'error', code: 'bad-json' })
      }
      if (m?.type !== 'publish' || typeof m.topic !== 'string' || !CMD_TOPIC.test(m.topic) || typeof m.payload !== 'object' || m.payload === null) {
        return send(ws, { type: 'error', code: 'not-allowed' })
      }
      const body = Buffer.from(JSON.stringify(m.payload))
      if (body.length > 2048) return send(ws, { type: 'error', code: 'too-large' })
      aedes.publish({ cmd: 'publish', qos: 0, dup: false, retain: false, topic: m.topic, payload: body }, (err) => {
        if (err) send(ws, { type: 'error', code: 'publish-failed' })
      })
    })
    ws.on('close', () => clients.delete(ws))
    ws.on('error', () => ws.terminate())
  })

  http.on('upgrade', (req, socket, head) => {
    let url
    try {
      url = new URL(req.url ?? '', 'http://x')
    } catch {
      return socket.destroy()
    }
    if (url.pathname !== '/telemetry') return // /signal is handled by the signaling module
    const given = url.searchParams.get('token') ?? ''
    if (!safeEqual(given, token)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
      return socket.destroy()
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req))
  })

  await new Promise((ok, fail) => {
    http.once('error', fail)
    http.listen(opts.port ?? 8787, host, ok)
  })
  const port = http.address().port
  log(`http/ws on :${port}  mqtt on :${mqttPort}`)

  return {
    port,
    mqttPort,
    token,
    aedes,
    async close() {
      signaling.close()
      for (const c of clients) c.terminate()
      wss.close()
      await new Promise((r) => http.close(() => r()))
      await new Promise((r) => mqttServer.close(() => r()))
      await new Promise((r) => aedes.close(() => r()))
    },
  }
}
