import type { CameraConfig, SeatSlot, Vec2 } from '@/types'
import type { BBox } from './geometry'
import type { FrameSource, PersonDetector } from './detector'
import { CameraOccupancyPipeline, type FrameResult } from './pipeline'
import type { Detection } from './tracker'
import { MobileCameraHost, type HostStatus, type PeerInfo } from './webrtc'

export type SourceKind = 'none' | 'image' | 'video' | 'mobile'

export interface MobileState {
  status: HostStatus
  detail?: string
  session: string | null
  info: PeerInfo | null
}

export interface RuntimeState {
  cameraId: string
  kind: SourceKind
  label: string
  frameSize: Vec2 | null
  /** a person-detection / tracking loop is running on this source */
  analyzing: boolean
  /** a live source (phone / playing video) is producing frames */
  live: boolean
  result: FrameResult | null
  /** wall-clock ms of the last result, for staleness checks */
  resultAt: number
  error: string | null
  /** number of hand-drawn boxes */
  manualBoxes: number
  inferenceMs: number | null
  mobile: MobileState
}

/** What the runtime reads a frame from. */
export interface FrameRead {
  frame: FrameSource
  size: Vec2
  timeMs: number
}

export type DetectorGetter = () => Promise<PersonDetector | null>

const IDLE_MOBILE: MobileState = { status: 'idle', session: null, info: null }

/**
 * One per camera. Owns the media source and the occupancy pipeline for that camera. The pipeline
 * itself is pure; this class only moves frames into it and results out of it. Raw frames are never
 * stored or uploaded: an uploaded file lives in memory (object URL / bitmap) until replaced.
 */
export class CameraRuntime {
  readonly id: string
  readonly pipeline = new CameraOccupancyPipeline()
  state: RuntimeState
  /** persistent element for video files and phone streams (created lazily; absent in tests) */
  video: HTMLVideoElement | null = null
  /** the decoded still image, when the source is an image */
  bitmap: ImageBitmap | null = null

  private listeners = new Set<(s: RuntimeState) => void>()
  private getDetector: DetectorGetter
  private manual: Detection[] = []
  private provider: (() => FrameRead | null) | null = null
  private objectUrl: string | null = null
  private stream: MediaStream | null = null
  private host: MobileCameraHost | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private busy = false
  private looping = false
  private intervalMs: number
  private lastStreamTime = -Infinity

  constructor(id: string, getDetector: DetectorGetter, opts: { intervalMs?: number } = {}) {
    this.id = id
    this.getDetector = getDetector
    this.intervalMs = opts.intervalMs ?? 250
    this.state = { cameraId: id, kind: 'none', label: '', frameSize: null, analyzing: false, live: false, result: null, resultAt: 0, error: null, manualBoxes: 0, inferenceMs: null, mobile: IDLE_MOBILE }
  }

  // ── plumbing ─────────────────────────────────────────────
  subscribe(fn: (s: RuntimeState) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  private patch(p: Partial<RuntimeState>) {
    this.state = { ...this.state, ...p }
    for (const l of this.listeners) l(this.state)
  }
  private ensureVideo(): HTMLVideoElement {
    if (!this.video) {
      const v = document.createElement('video')
      v.muted = true
      v.playsInline = true
      v.loop = false
      v.preload = 'auto'
      v.onloadedmetadata = () => this.patch({ frameSize: [v.videoWidth, v.videoHeight] })
      v.onplay = () => this.patch({ live: true })
      v.onpause = () => this.patch({ live: false })
      v.onended = () => {
        this.patch({ live: false })
        if (this.state.kind === 'video' && this.looping) {
          // the whole clip has been processed: take the committed state and stop
          void this.analyzeOnce().finally(() => this.stopLoop())
        }
      }
      this.video = v
    }
    return this.video
  }

  configure(cam: CameraConfig | null, seats: SeatSlot[]) {
    this.pipeline.configure(cam, seats)
    if (this.state.frameSize || this.state.result) void this.reevaluate()
  }

  /** Re-run mapping on the last tracks (after calibration changed or a manual correction). */
  reevaluate() {
    const r = this.pipeline.reevaluate()
    if (r) this.setResult(r)
    return r
  }

  // ── sources ──────────────────────────────────────────────
  private clearSource() {
    this.stopLoop()
    this.host?.stop()
    this.host = null
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    if (this.video) {
      this.video.pause()
      this.video.srcObject = null
      this.video.removeAttribute('src')
      this.video.load()
    }
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl)
    this.objectUrl = null
    this.bitmap?.close()
    this.bitmap = null
    this.provider = null
    this.manual = []
    this.lastStreamTime = -Infinity
    this.pipeline.reset()
  }

  async loadImage(file: Blob, label: string) {
    this.clearSource()
    try {
      const bmp = await createImageBitmap(file)
      this.bitmap = bmp
      this.provider = () => ({ frame: bmp, size: [bmp.width, bmp.height], timeMs: 0 })
      this.patch({ kind: 'image', label, frameSize: [bmp.width, bmp.height], result: null, resultAt: 0, error: null, manualBoxes: 0, live: false, analyzing: false, mobile: IDLE_MOBILE })
    } catch {
      this.patch({ error: 'That image could not be decoded. Use JPG, PNG or WEBP.', kind: 'none', label: '', frameSize: null })
    }
  }

  async loadVideo(file: Blob, label: string) {
    this.clearSource()
    const v = this.ensureVideo()
    this.objectUrl = URL.createObjectURL(file)
    this.provider = () => (v.videoWidth ? { frame: v, size: [v.videoWidth, v.videoHeight], timeMs: v.currentTime * 1000 } : null)
    this.patch({ kind: 'video', label, frameSize: null, result: null, resultAt: 0, error: null, manualBoxes: 0, live: false, analyzing: false, mobile: IDLE_MOBILE })
    v.src = this.objectUrl
    try {
      await new Promise<void>((ok, fail) => {
        v.onloadeddata = () => ok()
        v.onerror = () => fail(new Error('decode'))
      })
      this.patch({ frameSize: [v.videoWidth, v.videoHeight] })
    } catch {
      this.patch({ error: 'This browser cannot play that video (MOV/HEVC is often unsupported). Convert it to MP4 (H.264) or WEBM.' })
    }
  }

  /** Receive video from a paired phone. Nothing is requested until the phone user grants permission. */
  async startMobile(): Promise<string> {
    this.clearSource()
    const v = this.ensureVideo()
    this.patch({ kind: 'mobile', label: 'Phone camera', frameSize: null, result: null, resultAt: 0, error: null, manualBoxes: 0, live: false, analyzing: false, mobile: { status: 'connecting-server', session: null, info: null } })
    this.provider = () => (v.videoWidth ? { frame: v, size: [v.videoWidth, v.videoHeight], timeMs: performance.now() } : null)
    const host = new MobileCameraHost({
      onStatus: (status, detail) => this.patch({ mobile: { ...this.state.mobile, status, detail } }),
      onSession: (session) => this.patch({ mobile: { ...this.state.mobile, session } }),
      onInfo: (info) => this.patch({ mobile: { ...this.state.mobile, info } }),
      onStream: (s) => {
        this.stream = s
        v.srcObject = s
        void v.play().catch(() => undefined)
        v.onresize = () => this.patch({ frameSize: [v.videoWidth, v.videoHeight] })
        v.onloadedmetadata = () => this.patch({ frameSize: [v.videoWidth, v.videoHeight] })
        this.patch({ live: true })
        this.startLoop()
      },
    })
    this.host = host
    try {
      return await host.start()
    } catch (e) {
      this.patch({ error: e instanceof Error ? e.message : String(e) })
      throw e
    }
  }

  /** Stop the phone link, the stream and the analysis loop immediately. */
  stopMobile() {
    this.host?.stop()
    this.host = null
    this.stopLoop()
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    if (this.video) this.video.srcObject = null
    this.patch({ live: false, mobile: { ...this.state.mobile, status: 'stopped', session: null } })
  }

  reset() {
    this.clearSource()
    this.patch({ kind: 'none', label: '', frameSize: null, result: null, resultAt: 0, error: null, manualBoxes: 0, live: false, analyzing: false, inferenceMs: null, mobile: IDLE_MOBILE })
  }

  /** test hook / custom sources */
  setFrameProvider(fn: (() => FrameRead | null) | null, kind: SourceKind = 'image', label = 'test source') {
    this.provider = fn
    const fr = fn?.()
    this.patch({ kind, label, frameSize: fr?.size ?? null, result: null, resultAt: 0, error: null })
  }

  // ── manual boxes ─────────────────────────────────────────
  addManualBox(bbox: BBox) {
    this.manual = [...this.manual, { bbox, score: 1, manual: true }]
    this.patch({ manualBoxes: this.manual.length })
    return this.analyzeOnce()
  }
  clearManualBoxes() {
    this.manual = []
    this.patch({ manualBoxes: 0 })
    return this.analyzeOnce()
  }

  // ── analysis ─────────────────────────────────────────────
  private setResult(r: FrameResult) {
    this.patch({ result: r, resultAt: Date.now(), error: null })
  }

  /** One detection → tracking → seat-mapping pass over the current frame. */
  async analyzeOnce(): Promise<FrameResult | null> {
    const fr = this.provider?.()
    if (!fr) {
      this.patch({ error: this.state.kind === 'none' ? 'Load an image, a video or connect a phone first.' : 'No video frame yet.' })
      return null
    }
    let dets: Detection[] = []
    let ms: number | null = null
    let detectorNote: string | null = null
    try {
      const det = await this.getDetector()
      if (det) {
        const t0 = performance.now()
        dets = await det.detect(fr.frame)
        ms = performance.now() - t0
      } else detectorNote = 'The person-detection model is not loaded: only hand-drawn boxes are used.'
    } catch (e) {
      detectorNote = e instanceof Error ? e.message : String(e)
    }
    const streaming = this.looping && this.state.kind !== 'image'
    // a seek backwards or a loop restarts the temporal state
    if (streaming && fr.timeMs < this.lastStreamTime - 300) this.pipeline.reset()
    if (streaming) this.lastStreamTime = fr.timeMs
    const result = this.pipeline.process([...dets, ...this.manual], fr.size, fr.timeMs, streaming ? 'stream' : 'snapshot')
    this.patch({ result, resultAt: Date.now(), error: detectorNote, inferenceMs: ms, frameSize: fr.size })
    return result
  }

  /** Continuous analysis (phone stream, or "Analyze video" while the clip plays). */
  startLoop() {
    if (this.looping) return
    this.looping = true
    this.patch({ analyzing: true })
    const step = async () => {
      if (!this.looping) return
      const v = this.video
      const idle = this.state.kind !== 'image' && v && (v.paused || v.ended) && this.state.kind === 'video'
      if (!this.busy && !idle) {
        this.busy = true
        try {
          await this.analyzeOnce()
        } catch (e) {
          this.patch({ error: e instanceof Error ? e.message : String(e) })
        }
        this.busy = false
      }
      if (this.looping) this.timer = setTimeout(step, this.intervalMs)
    }
    void step()
  }
  stopLoop() {
    this.looping = false
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (this.state.analyzing) this.patch({ analyzing: false })
  }

  /** Play the uploaded clip from the start and analyse every frame we can keep up with. */
  async analyzeVideo() {
    const v = this.video
    if (this.state.kind !== 'video' || !v) return
    this.pipeline.reset()
    this.manual = []
    this.patch({ manualBoxes: 0 })
    this.lastStreamTime = -Infinity
    v.currentTime = 0
    this.startLoop()
    await v.play().catch(() => undefined)
  }

  dispose() {
    this.clearSource()
    this.listeners.clear()
    this.video = null
  }
}
