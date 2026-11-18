import type { CameraConfig, SeatSlot, Vec2 } from '@/types'
import type { BBox } from './geometry'
import { DEFAULT_FILTER, SeatOccupancyFilter, type FilterOptions } from './occupancyFilter'
import { assignSeats, classifyPosture, DEFAULT_MAPPING, projectSeats, type Assignment, type MappingOptions, type Posture, type SeatProjection } from './seatMapping'
import { DEFAULT_TRACKER, IouTracker, type Detection, type Track, type TrackerOptions } from './tracker'

export type TrackStatus =
  | 'confirmed' // sitting in an assigned seat with enough confidence → counts as occupancy
  | 'uncertain' // plausible seat, but low confidence / ambiguous → NOT counted, needs a human look
  | 'unassigned' // sitting-like or unknown person with no plausible visible seat
  | 'standing'
  | 'walking'
  | 'ignored' // user marked it a false detection

export interface TrackView {
  id: number
  /** box in the calibration frame's pixel space */
  bbox: BBox
  score: number
  posture: Posture
  seatKey: string | null
  confidence: number
  status: TrackStatus
  /** the user set or confirmed this assignment by hand */
  manual: boolean
  /** the box itself was drawn by the user, not produced by the model */
  drawn: boolean
  runnerUp?: { seatKey: string; cost: number }
}

export interface FrameResult {
  timeMs: number
  mode: 'snapshot' | 'stream'
  tracks: TrackView[]
  /** seats observed occupied in this cycle (before temporal confirmation) */
  observed: string[]
  /** seats that are occupied after temporal confirmation and manual corrections */
  committed: string[]
  seatProjections: SeatProjection[]
  stats: {
    detections: number
    people: number
    sitting: number
    standing: number
    walking: number
    uncertain: number
    unassigned: number
    ignored: number
    visibleSeats: number
    /** seats this camera cannot see: their occupancy is unknown and is counted as empty */
    unobservedSeats: number
    /** mean confidence of confirmed matches, or null when there are none */
    meanConfidence: number | null
  }
  warnings: string[]
}

export interface PipelineOptions {
  tracker: TrackerOptions
  mapping: MappingOptions
  filter: FilterOptions
}

export const DEFAULT_PIPELINE: PipelineOptions = { tracker: DEFAULT_TRACKER, mapping: DEFAULT_MAPPING, filter: DEFAULT_FILTER }

/**
 * Detections → tracking → seat mapping → temporal confirmation → committed occupancy.
 * One instance per camera. Pure data in / data out: no DOM, no models, fully testable.
 */
export class CameraOccupancyPipeline {
  private tracker: IouTracker
  private filter: SeatOccupancyFilter
  private cam: CameraConfig | null = null
  private seats: SeatSlot[] = []
  private readonly opt: PipelineOptions
  private manualSeat = new Map<number, string>()
  private ignored = new Set<number>()
  private forcedUncertain = new Set<number>()
  private seatForce = new Map<string, 'occupied' | 'vacant'>()
  private last: { tracks: Track[]; frameSize: Vec2; timeMs: number; mode: 'snapshot' | 'stream'; nDet: number } | null = null

  constructor(opt: PipelineOptions = DEFAULT_PIPELINE) {
    this.opt = opt
    this.tracker = new IouTracker(opt.tracker)
    this.filter = new SeatOccupancyFilter(opt.filter)
  }

  configure(cam: CameraConfig | null, seats: SeatSlot[]) {
    this.cam = cam
    this.seats = seats
  }

  /** Forget tracks, temporal state and manual corrections (new image, new stream, new calibration). */
  reset() {
    this.tracker.reset()
    this.filter.reset()
    this.manualSeat.clear()
    this.ignored.clear()
    this.forcedUncertain.clear()
    this.seatForce.clear()
    this.lastSeatByTrack.clear()
    this.last = null
  }

  // ── manual corrections ───────────────────────────────────────────────
  /** A corrected track must drop whatever seat the automatic mapping had given it, at once. */
  private releaseAutoSeat(trackId: number) {
    const old = this.lastSeatByTrack.get(trackId)
    if (old) this.filter.release(old)
  }

  assignManually(trackId: number, seatKey: string | null) {
    this.releaseAutoSeat(trackId)
    this.ignored.delete(trackId)
    this.forcedUncertain.delete(trackId)
    if (seatKey) {
      for (const [t, s] of this.manualSeat) if (s === seatKey && t !== trackId) this.manualSeat.delete(t)
      this.manualSeat.set(trackId, seatKey)
    } else this.manualSeat.delete(trackId)
  }
  ignoreTrack(trackId: number, ignore = true) {
    if (ignore) {
      this.releaseAutoSeat(trackId)
      this.ignored.add(trackId)
      this.forcedUncertain.delete(trackId)
      this.manualSeat.delete(trackId)
    } else this.ignored.delete(trackId)
  }
  /** The person is real but nothing about the seat is trustworthy: keep them out of the occupancy count. */
  markUncertain(trackId: number, on = true) {
    if (on) {
      this.releaseAutoSeat(trackId)
      this.forcedUncertain.add(trackId)
      this.manualSeat.delete(trackId)
      this.ignored.delete(trackId)
    } else this.forcedUncertain.delete(trackId)
  }
  forceSeat(seatKey: string, state: 'occupied' | 'vacant' | null) {
    if (state) this.seatForce.set(seatKey, state)
    else this.seatForce.delete(seatKey)
  }

  /** Re-evaluate the last frame, e.g. right after a manual correction. */
  reevaluate(): FrameResult | null {
    if (!this.last) return null
    return this.evaluate(this.last.tracks, this.last.frameSize, this.last.timeMs, this.last.mode, this.last.nDet, true)
  }

  process(dets: Detection[], frameSize: Vec2, timeMs: number, mode: 'snapshot' | 'stream'): FrameResult {
    let tracks: Track[]
    if (mode === 'stream') tracks = this.tracker.update(dets, timeMs)
    else {
      // a single image has no history: every detection is its own (confirmed) track, numbered left→right
      tracks = [...dets]
        .sort((a, b) => a.bbox[0] - b.bbox[0])
        .map((d, i) => ({ id: i + 1, bbox: d.bbox, raw: d.bbox, manual: d.manual, score: d.score, hits: 1, misses: 0, firstSeenMs: timeMs, lastSeenMs: timeMs, velocity: [0, 0] as [number, number], speedRel: 0, confirmed: true }))
    }
    return this.evaluate(tracks, frameSize, timeMs, mode, dets.length, false)
  }

  private evaluate(tracks: Track[], frameSize: Vec2, timeMs: number, mode: 'snapshot' | 'stream', nDet: number, manualOnly: boolean): FrameResult {
    this.last = { tracks, frameSize, timeMs, mode, nDet }
    const warnings: string[] = []
    const cam = this.cam
    const o = this.opt.mapping
    const calibrated = !!cam?.pose
    if (!calibrated) warnings.push('No calibrated camera: detections cannot be mapped to seats. Calibrate first.')
    // detections arrive in the live frame's pixels; the calibration lives in its own frame
    const sx = cam && frameSize[0] > 0 ? cam.imageSize[0] / frameSize[0] : 1
    const sy = cam && frameSize[1] > 0 ? cam.imageSize[1] / frameSize[1] : 1
    if (cam && Math.abs(sx / sy - 1) > 0.03) warnings.push('The live frame has a different aspect ratio than the calibration frame (cropped or stretched). Re-calibrate on this camera view.')
    const scaled = tracks.map((t) => ({ t, box: [t.bbox[0] * sx, t.bbox[1] * sy, t.bbox[2] * sx, t.bbox[3] * sy] as BBox }))

    const projections = cam && calibrated ? projectSeats(cam, this.seats, o) : []
    const seatKeys = new Set(this.seats.map((s) => s.key))
    const manualClaims = new Set([...this.manualSeat.values()].filter((k) => seatKeys.has(k)))
    const auto = scaled.filter(({ t }) => !this.ignored.has(t.id) && !this.manualSeat.has(t.id) && !this.forcedUncertain.has(t.id))
    const assignments = new Map<number, Assignment>()
    if (calibrated) for (const a of assignSeats(projections, auto.map(({ t, box }) => ({ id: t.id, bbox: box, score: t.score })), o, manualClaims)) assignments.set(a.trackId, a)

    const views: TrackView[] = scaled.map(({ t, box }) => {
      if (this.ignored.has(t.id)) return { id: t.id, bbox: box, score: t.score, posture: 'uncertain' as Posture, seatKey: null, confidence: 0, status: 'ignored' as TrackStatus, manual: true, drawn: !!t.manual }
      if (this.forcedUncertain.has(t.id)) return { id: t.id, bbox: box, score: t.score, posture: 'uncertain' as Posture, seatKey: null, confidence: 0, status: 'uncertain' as TrackStatus, manual: true, drawn: !!t.manual }
      const m = this.manualSeat.get(t.id)
      if (m && seatKeys.has(m)) return { id: t.id, bbox: box, score: t.score, posture: 'sitting' as Posture, seatKey: m, confidence: 1, status: 'confirmed' as TrackStatus, manual: true, drawn: !!t.manual }
      const a = assignments.get(t.id)
      const posture = classifyPosture({ bbox: box, speedRel: t.speedRel }, a, o)
      let status: TrackStatus
      if (posture === 'walking') status = 'walking'
      else if (posture === 'standing') status = 'standing'
      else if (a?.seatKey && posture === 'sitting') status = a.ambiguous || a.confidence < o.minConfidence ? 'uncertain' : 'confirmed'
      else if (a?.seatKey) status = 'uncertain' // seat found but the evidence is below the confidence bar
      else status = 'unassigned'
      return { id: t.id, bbox: box, score: t.score, posture, seatKey: a?.seatKey ?? null, confidence: a?.confidence ?? 0, status, manual: false, drawn: !!t.manual, runnerUp: a?.runnerUp }
    })

    // observed = confirmed, one-to-one (a seat can appear only once)
    const observed = new Set<string>()
    for (const v of views) if (v.status === 'confirmed' && v.seatKey) observed.add(v.seatKey)
    let committed: Set<string>
    if (mode === 'snapshot') committed = new Set(observed)
    else if (manualOnly) committed = this.filter.current() // a human edit must not advance the clock
    else committed = this.filter.update(observed, timeMs)
    for (const v of views) if (v.manual && v.status === 'confirmed' && v.seatKey) committed.add(v.seatKey)
    for (const [k, st] of this.seatForce) {
      if (!seatKeys.has(k)) continue
      if (st === 'occupied') committed.add(k)
      else committed.delete(k)
    }
    for (const k of [...committed]) if (!seatKeys.has(k)) committed.delete(k)
    this.lastSeatByTrack = new Map(views.filter((v) => v.seatKey).map((v) => [v.id, v.seatKey!]))

    const sitting = views.filter((v) => v.posture === 'sitting' && v.status !== 'ignored').length
    const conf = views.filter((v) => v.status === 'confirmed' && !v.manual).map((v) => v.confidence)
    const visible = projections.filter((p) => p.visible).length
    return {
      timeMs,
      mode,
      tracks: views,
      observed: [...observed],
      committed: [...committed],
      seatProjections: projections,
      stats: {
        detections: nDet,
        people: views.filter((v) => v.status !== 'ignored').length,
        sitting,
        standing: views.filter((v) => v.status === 'standing').length,
        walking: views.filter((v) => v.status === 'walking').length,
        uncertain: views.filter((v) => v.status === 'uncertain').length,
        unassigned: views.filter((v) => v.status === 'unassigned').length,
        ignored: views.filter((v) => v.status === 'ignored').length,
        visibleSeats: visible,
        unobservedSeats: calibrated ? this.seats.length - visible : this.seats.length,
        meanConfidence: conf.length ? conf.reduce((a, b) => a + b, 0) / conf.length : null,
      },
      warnings,
    }
  }

  private lastSeatByTrack = new Map<number, string>()
}
