/**
 * WebRTC signaling for the "Mobile Live Camera" source.
 *
 *   attachSignaling(httpServer, { path: '/signal' })
 *
 * The desktop app (host) creates a session and shows its link as a QR code. The phone (peer) joins
 * with that link, the user grants camera permission ON THE PHONE, and the phone sends an SDP offer.
 * This module only relays small JSON messages between those two sockets; it never sees video
 * (media flows peer-to-peer over WebRTC, which is encrypted with DTLS-SRTP).
 *
 * Security properties
 *  - session ids are 128-bit random (crypto.randomBytes), so they cannot be guessed;
 *  - sessions expire (default 30 min) and are deleted when the host leaves;
 *  - one host + one phone per session; unknown / expired ids are rejected;
 *  - messages are size-limited and only a fixed set of types is relayed;
 *  - serve this over HTTPS/WSS (browsers require it for phone camera access outside localhost).
 *
 * Wire protocol (JSON text frames)
 *   host  → {type:'create'}                       ← {type:'created', session, expiresAt}
 *   phone → {type:'join', session}                ← {type:'joined', expiresAt} | {type:'error', code}
 *   host  ← {type:'peer-joined'}   phone ← {type:'host-present'}
 *   either → {type:'offer'|'answer'|'ice'|'stop', ...payload}  relayed verbatim to the other side
 *   either ← {type:'peer-left'}
 */
import { randomBytes } from 'node:crypto'
import { WebSocketServer } from 'ws'

const RELAYED = new Set(['offer', 'answer', 'ice', 'stop', 'info'])

export function attachSignaling(httpServer, opts = {}) {
  const path = opts.path ?? '/signal'
  const ttlMs = opts.ttlMs ?? 30 * 60 * 1000
  const maxSessions = opts.maxSessions ?? 25
  /** @type {Map<string, {host: import('ws').WebSocket, phone: import('ws').WebSocket|null, expiresAt: number}>} */
  const sessions = new Map()
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 })

  const send = (ws, msg) => {
    if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg))
  }
  const drop = (id, reason) => {
    const s = sessions.get(id)
    if (!s) return
    sessions.delete(id)
    send(s.host, { type: 'peer-left', reason })
    send(s.phone, { type: 'peer-left', reason })
    if (reason === 'expired') {
      s.host.close(4001, 'expired')
      s.phone?.close(4001, 'expired')
    }
  }
  const sweep = setInterval(() => {
    const now = Date.now()
    for (const [id, s] of sessions) if (s.expiresAt <= now) drop(id, 'expired')
  }, Math.min(30_000, Math.max(50, ttlMs / 4)))
  sweep.unref?.()

  wss.on('connection', (ws) => {
    /** @type {{role: 'host'|'phone', id: string} | null} */
    let me = null
    // an unauthenticated socket may not linger
    const hello = setTimeout(() => !me && ws.close(4000, 'no hello'), 10_000)
    hello.unref?.()

    ws.on('message', (raw) => {
      let msg
      try {
        msg = JSON.parse(raw.toString())
      } catch {
        return send(ws, { type: 'error', code: 'bad-json' })
      }
      if (!msg || typeof msg.type !== 'string') return send(ws, { type: 'error', code: 'bad-message' })

      if (!me) {
        if (msg.type === 'create') {
          if (sessions.size >= maxSessions) {
            send(ws, { type: 'error', code: 'too-many-sessions' })
            return ws.close(4003, 'busy')
          }
          const id = randomBytes(16).toString('base64url')
          const expiresAt = Date.now() + ttlMs
          sessions.set(id, { host: ws, phone: null, expiresAt })
          me = { role: 'host', id }
          return send(ws, { type: 'created', session: id, expiresAt })
        }
        if (msg.type === 'join') {
          const s = typeof msg.session === 'string' ? sessions.get(msg.session) : undefined
          if (!s || s.expiresAt <= Date.now()) {
            send(ws, { type: 'error', code: 'unknown-session' })
            return ws.close(4004, 'unknown session')
          }
          if (s.phone && s.phone.readyState === s.phone.OPEN) {
            send(ws, { type: 'error', code: 'session-full' })
            return ws.close(4005, 'full')
          }
          s.phone = ws
          me = { role: 'phone', id: msg.session }
          send(ws, { type: 'joined', expiresAt: s.expiresAt })
          send(ws, { type: 'host-present' })
          return send(s.host, { type: 'peer-joined' })
        }
        return send(ws, { type: 'error', code: 'hello-first' })
      }

      const s = sessions.get(me.id)
      if (!s) return
      if (!RELAYED.has(msg.type)) return send(ws, { type: 'error', code: 'type-not-allowed' })
      send(me.role === 'host' ? s.phone : s.host, msg)
    })

    ws.on('close', () => {
      clearTimeout(hello)
      if (!me) return
      const s = sessions.get(me.id)
      if (!s) return
      if (me.role === 'host') drop(me.id, 'host-left')
      else if (s.phone === ws) {
        s.phone = null
        send(s.host, { type: 'peer-left', reason: 'phone-left' })
      }
    })
    ws.on('error', () => ws.terminate())
  })

  httpServer.on('upgrade', (req, socket, head) => {
    let pathname = ''
    try {
      pathname = new URL(req.url ?? '', 'http://x').pathname
    } catch {
      return
    }
    if (pathname !== path) return // not ours: leave it for other upgrade handlers
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req))
  })

  return {
    path,
    sessions,
    close() {
      clearInterval(sweep)
      for (const c of wss.clients) c.terminate()
      wss.close()
    },
  }
}
