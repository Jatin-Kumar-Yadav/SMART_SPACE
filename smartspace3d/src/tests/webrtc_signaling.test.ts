import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
// @ts-expect-error plain ESM module without types
import { attachSignaling } from '../../server/signaling.mjs'

type Handle = { sessions: Map<string, unknown>; close: () => void }
const open: { srv: Server; h: Handle }[] = []
const sockets: WebSocket[] = []
afterEach(() => {
  sockets.splice(0).forEach((s) => s.terminate())
  open.splice(0).forEach(({ srv, h }) => { h.close(); srv.close() })
})

async function start(opts?: { ttlMs?: number }) {
  const srv = createServer()
  const h = attachSignaling(srv, opts) as Handle
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r))
  open.push({ srv, h })
  return { url: `ws://127.0.0.1:${(srv.address() as AddressInfo).port}/signal`, h, srv }
}
function client(url: string) {
  const ws = new WebSocket(url)
  sockets.push(ws)
  const inbox: Record<string, unknown>[] = []
  const waiters: ((m: Record<string, unknown>) => void)[] = []
  ws.on('message', (d) => {
    const m = JSON.parse(d.toString())
    const w = waiters.shift()
    if (w) w(m)
    else inbox.push(m)
  })
  return {
    ws,
    ready: new Promise<void>((r, j) => { ws.on('open', () => r()); ws.on('error', j) }),
    send: (m: unknown) => ws.send(JSON.stringify(m)),
    next: () => new Promise<Record<string, unknown>>((r) => { const m = inbox.shift(); m ? r(m) : waiters.push(r) }),
    closed: new Promise<number>((r) => ws.on('close', (c) => r(c))),
  }
}

describe('signaling', () => {
  it('relays offer / answer / ICE between host and phone through an unguessable session', async () => {
    const { url } = await start()
    const host = client(url); await host.ready
    host.send({ type: 'create' })
    const created = await host.next()
    expect(created.type).toBe('created')
    const id = created.session as string
    expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/) // 128-bit base64url

    const phone = client(url); await phone.ready
    phone.send({ type: 'join', session: id })
    expect((await phone.next()).type).toBe('joined')
    expect((await phone.next()).type).toBe('host-present')
    expect((await host.next()).type).toBe('peer-joined')

    phone.send({ type: 'offer', sdp: { type: 'offer', sdp: 'v=0 …' } })
    expect(await host.next()).toMatchObject({ type: 'offer', sdp: { sdp: 'v=0 …' } })
    host.send({ type: 'answer', sdp: { type: 'answer', sdp: 'v=0 answer' } })
    expect(await phone.next()).toMatchObject({ type: 'answer' })
    phone.send({ type: 'ice', candidate: { candidate: 'candidate:1 1 udp 1 10.0.0.2 5000 typ host' } })
    expect(await host.next()).toMatchObject({ type: 'ice' })
    host.send({ type: 'stop' })
    expect(await phone.next()).toMatchObject({ type: 'stop' })
  })

  it('rejects unknown sessions, a second phone, and message types that are not signaling', async () => {
    const { url } = await start()
    const stranger = client(url); await stranger.ready
    stranger.send({ type: 'join', session: 'AAAAAAAAAAAAAAAAAAAAAA' })
    expect(await stranger.next()).toMatchObject({ type: 'error', code: 'unknown-session' })
    expect(await stranger.closed).toBe(4004)

    const host = client(url); await host.ready
    host.send({ type: 'create' })
    const id = (await host.next()).session as string
    const p1 = client(url); await p1.ready
    p1.send({ type: 'join', session: id }); await p1.next(); await p1.next() // joined + host-present
    const p2 = client(url); await p2.ready
    p2.send({ type: 'join', session: id })
    expect(await p2.next()).toMatchObject({ code: 'session-full' })
    p1.send({ type: 'eval', code: 'process.exit()' })
    expect(await p1.next()).toMatchObject({ type: 'error', code: 'type-not-allowed' })
  })

  it('expires sessions and tells both sides; closing the host ends the session', async () => {
    const { url, h } = await start({ ttlMs: 150 })
    const host = client(url); await host.ready
    host.send({ type: 'create' })
    const id = (await host.next()).session as string
    expect(await host.next()).toMatchObject({ type: 'peer-left', reason: 'expired' })
    expect(h.sessions.has(id)).toBe(false)
    const late = client(url); await late.ready
    late.send({ type: 'join', session: id })
    expect(await late.next()).toMatchObject({ code: 'unknown-session' })

    const s2 = await start()
    const h2 = client(s2.url); await h2.ready
    h2.send({ type: 'create' })
    const id2 = (await h2.next()).session as string
    const ph = client(s2.url); await ph.ready
    ph.send({ type: 'join', session: id2 }); await ph.next(); await ph.next()
    h2.ws.close()
    expect(await ph.next()).toMatchObject({ type: 'peer-left', reason: 'host-left' })
    expect(s2.h.sessions.size).toBe(0)
  })

  it('does not touch upgrades for other paths', async () => {
    const { srv } = await start()
    const port = (srv.address() as AddressInfo).port
    const other = new WebSocket(`ws://127.0.0.1:${port}/elsewhere`)
    sockets.push(other)
    const outcome = await new Promise<string>((r) => { other.on('error', () => r('error')); other.on('open', () => r('open')); setTimeout(() => r('hung'), 800) })
    expect(outcome).not.toBe('open')
  })
})
