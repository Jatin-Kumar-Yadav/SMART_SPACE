/**
 * Mobile camera over WebRTC.
 *
 *   desktop (MobileCameraHost)  ──create──▶  signaling  ◀──join──  phone (PhoneCameraSender)
 *                                  offer/answer/ICE relayed         phone: getUserMedia (user taps Start and
 *                                                                          grants permission ON THE PHONE)
 *   video flows phone ⇒ desktop peer-to-peer (DTLS-SRTP). The server only relays small JSON messages.
 *
 * Nothing here can switch a phone camera on remotely: the phone page must be opened by a person,
 * who taps "Start camera" and answers the browser's permission prompt.
 *
 * ICE: on one Wi-Fi network host candidates are enough. Set VITE_ICE_SERVERS (JSON array of RTCIceServer)
 * to add STUN/TURN for other networks.
 */
export const ICE_SERVERS: RTCIceServer[] = (() => {
  try {
    const raw = (import.meta.env?.VITE_ICE_SERVERS as string | undefined) ?? ''
    return raw ? (JSON.parse(raw) as RTCIceServer[]) : []
  } catch {
    return []
  }
})()

export const signalUrl = (loc: Pick<Location, 'protocol' | 'host'> = window.location) => `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}/signal`

export type HostStatus = 'idle' | 'connecting-server' | 'waiting-for-phone' | 'negotiating' | 'streaming' | 'phone-left' | 'stopped' | 'error'
export interface PeerInfo {
  facing?: 'user' | 'environment'
  label?: string
  width?: number
  height?: number
}
export interface HostEvents {
  onStatus?: (s: HostStatus, detail?: string) => void
  onStream?: (s: MediaStream) => void
  onInfo?: (i: PeerInfo) => void
  onSession?: (id: string) => void
}

interface Signal {
  type: string
  [k: string]: unknown
}

class Link {
  private ws: WebSocket | null = null
  private url: string
  private onMsg: (m: Signal) => void
  private onClose: (code: number) => void
  constructor(url: string, onMsg: (m: Signal) => void, onClose: (code: number) => void) {
    this.url = url
    this.onMsg = onMsg
    this.onClose = onClose
  }
  open(): Promise<void> {
    return new Promise((ok, fail) => {
      const ws = new WebSocket(this.url)
      this.ws = ws
      ws.onopen = () => ok()
      ws.onerror = () => fail(new Error('Could not reach the SmartSpace backend. Is `npm run server` running?'))
      ws.onmessage = (e) => {
        try {
          this.onMsg(JSON.parse(String(e.data)) as Signal)
        } catch {
          /* ignore malformed frames */
        }
      }
      ws.onclose = (e) => this.onClose(e.code)
    })
  }
  send(m: Signal) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m))
  }
  close() {
    this.ws?.close()
    this.ws = null
  }
}

/** Desktop side: owns the session and receives the phone's video. */
export class MobileCameraHost {
  status: HostStatus = 'idle'
  session: string | null = null
  private link: Link | null = null
  private pc: RTCPeerConnection | null = null
  private pendingIce: RTCIceCandidateInit[] = []
  private ev: HostEvents
  private url: string
  constructor(ev: HostEvents = {}, url = signalUrl()) {
    this.ev = ev
    this.url = url
  }

  private set(s: HostStatus, detail?: string) {
    this.status = s
    this.ev.onStatus?.(s, detail)
  }

  async start(): Promise<string> {
    this.stop(false)
    this.set('connecting-server')
    return new Promise<string>((ok, fail) => {
      this.link = new Link(
        this.url,
        (m) => {
          if (m.type === 'created') {
            this.session = String(m.session)
            this.ev.onSession?.(this.session)
            this.set('waiting-for-phone')
            ok(this.session)
          } else if (m.type === 'peer-joined') this.set('negotiating', 'Phone connected, waiting for it to start the camera')
          else if (m.type === 'offer') void this.onOffer(m.sdp as RTCSessionDescriptionInit)
          else if (m.type === 'ice') void this.onIce(m.candidate as RTCIceCandidateInit)
          else if (m.type === 'info') this.ev.onInfo?.(m.info as PeerInfo)
          else if (m.type === 'stop') this.resetPeer('stopped on the phone')
          else if (m.type === 'peer-left') {
            this.resetPeer()
            if (m.reason === 'expired') this.set('error', 'The pairing link expired. Create a new one.')
            else this.set('phone-left')
          } else if (m.type === 'error') this.set('error', String(m.code))
        },
        (code) => {
          if (this.status !== 'stopped' && this.status !== 'error') this.set(code === 1000 ? 'stopped' : 'error', 'Lost the connection to the backend')
        },
      )
      this.link.open().then(() => this.link!.send({ type: 'create' })).catch((e: Error) => {
        this.set('error', e.message)
        fail(e)
      })
    })
  }

  private resetPeer(_why?: string) {
    this.pc?.close()
    this.pc = null
    this.pendingIce = []
  }

  private async onOffer(sdp: RTCSessionDescriptionInit) {
    this.resetPeer()
    this.set('negotiating', 'Connecting to the phone camera')
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    this.pc = pc
    pc.onicecandidate = (e) => e.candidate && this.link?.send({ type: 'ice', candidate: e.candidate.toJSON() })
    pc.ontrack = (e) => {
      const stream = e.streams[0] ?? new MediaStream([e.track])
      this.ev.onStream?.(stream)
      this.set('streaming')
    }
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') this.set('error', 'Peer connection failed (different networks? add STUN/TURN via VITE_ICE_SERVERS)')
      else if (pc.connectionState === 'disconnected' && this.status === 'streaming') this.set('phone-left', 'Connection lost')
    }
    await pc.setRemoteDescription(sdp)
    for (const c of this.pendingIce.splice(0)) await pc.addIceCandidate(c).catch(() => undefined)
    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)
    this.link?.send({ type: 'answer', sdp: pc.localDescription!.toJSON() })
  }

  private async onIce(c: RTCIceCandidateInit) {
    if (!this.pc || !this.pc.remoteDescription) this.pendingIce.push(c)
    else await this.pc.addIceCandidate(c).catch(() => undefined)
  }

  /** Stop receiving immediately and tell the phone to stop its camera. */
  stop(announce = true) {
    if (announce) this.link?.send({ type: 'stop' })
    this.resetPeer()
    this.link?.close()
    this.link = null
    this.session = null
    if (announce) this.set('stopped')
  }
}

/** Phone side. Created only after the person taps "Start camera". */
export class PhoneCameraSender {
  private link: Link | null = null
  private pc: RTCPeerConnection | null = null
  private stream: MediaStream | null = null
  private sender: RTCRtpSender | null = null
  hostPresent = false
  private session: string
  private ev: { onStatus?: (s: string) => void; onStopped?: () => void }
  private url: string
  constructor(session: string, ev: { onStatus?: (s: string) => void; onStopped?: () => void } = {}, url = signalUrl()) {
    this.session = session
    this.ev = ev
    this.url = url
  }

  async connect() {
    this.ev.onStatus?.('Connecting…')
    this.link = new Link(
      this.url,
      (m) => {
        if (m.type === 'host-present') {
          this.hostPresent = true
          this.ev.onStatus?.('Connected to the desktop')
        } else if (m.type === 'answer') void this.pc?.setRemoteDescription(m.sdp as RTCSessionDescriptionInit)
        else if (m.type === 'ice') void this.pc?.addIceCandidate(m.candidate as RTCIceCandidateInit).catch(() => undefined)
        else if (m.type === 'stop' || m.type === 'peer-left') {
          this.stopLocal()
          this.ev.onStopped?.()
        } else if (m.type === 'error') this.ev.onStatus?.(m.code === 'unknown-session' ? 'This link is not valid any more. Scan a new QR code.' : `Error: ${String(m.code)}`)
      },
      () => this.ev.onStatus?.('Disconnected'),
    )
    await this.link.open()
    this.link.send({ type: 'join', session: this.session })
  }

  /** Begin sending `stream` (obtained by the page after the user granted permission). */
  async send(stream: MediaStream, info: PeerInfo) {
    this.stream = stream
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    this.pc = pc
    pc.onicecandidate = (e) => e.candidate && this.link?.send({ type: 'ice', candidate: e.candidate.toJSON() })
    pc.onconnectionstatechange = () => this.ev.onStatus?.(pc.connectionState === 'connected' ? 'Streaming to the desktop' : `Connection: ${pc.connectionState}`)
    for (const t of stream.getVideoTracks()) this.sender = pc.addTrack(t, stream)
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    this.link?.send({ type: 'info', info })
    this.link?.send({ type: 'offer', sdp: pc.localDescription!.toJSON() })
  }

  /** Switch front/rear camera without renegotiating. */
  async replaceStream(stream: MediaStream, info: PeerInfo) {
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = stream
    await this.sender?.replaceTrack(stream.getVideoTracks()[0])
    this.link?.send({ type: 'info', info })
  }

  private stopLocal() {
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    this.pc?.close()
    this.pc = null
  }

  /** The person pressed Stop: camera off at once, desktop told. */
  stop() {
    this.link?.send({ type: 'stop' })
    this.stopLocal()
    this.link?.close()
    this.link = null
  }
}

/** Link the phone should open. `host` replaces localhost with the computer's LAN address. */
export function phoneUrl(session: string, origin: string, lanHost?: string): string {
  const u = new URL(origin)
  if (lanHost && (u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]')) u.hostname = lanHost
  return `${u.protocol}//${u.host}/#/phone/${encodeURIComponent(session)}`
}
