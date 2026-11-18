import { center, iou, type BBox } from './geometry'
import { hungarian } from './hungarian'

export interface Detection {
  bbox: BBox
  score: number
  /** drawn / edited by the user rather than produced by the model */
  manual?: boolean
}

export interface Track {
  /** temporary identity – meaningless outside this session, never a real-world identity */
  id: number
  bbox: BBox
  /** last raw (unsmoothed) detection box – motion is measured and predicted from this, never from the smoothed box */
  raw: BBox
  score: number
  hits: number
  misses: number
  firstSeenMs: number
  lastSeenMs: number
  /** centre velocity, px/s */
  velocity: [number, number]
  /** speed relative to the person's own height (1/s) – scale independent */
  speedRel: number
  manual?: boolean
  /** true after `minHits` consecutive-ish detections */
  confirmed: boolean
}

export interface TrackerOptions {
  /** minimum IoU between a track and a detection to be matched */
  iouGate: number
  minHits: number
  /** a track is dropped after this long without a detection */
  maxAgeMs: number
  /** weight of the new measurement when smoothing (0..1) */
  alpha: number
}

export const DEFAULT_TRACKER: TrackerOptions = { iouGate: 0.15, minHits: 2, maxAgeMs: 2500, alpha: 0.55 }

/**
 * Lightweight multi-object tracker (SORT-style): constant-velocity prediction, IoU affinity,
 * Hungarian matching, exponential smoothing. It keeps one temporary id per person across
 * frames so a video does not create a new occupant for every frame.
 */
export class IouTracker {
  private tracks: Track[] = []
  private nextId = 1
  private readonly opt: TrackerOptions
  constructor(opt: TrackerOptions = DEFAULT_TRACKER) {
    this.opt = opt
  }

  reset() {
    this.tracks = []
    this.nextId = 1
  }

  get all(): readonly Track[] {
    return this.tracks
  }

  update(dets: Detection[], tMs: number): Track[] {
    const o = this.opt
    const predicted = this.tracks.map((t) => {
      const dt = Math.max(0, (tMs - t.lastSeenMs) / 1000)
      return [t.raw[0] + t.velocity[0] * dt, t.raw[1] + t.velocity[1] * dt, t.raw[2], t.raw[3]] as BBox
    })
    const cost = predicted.map((pb) => dets.map((d) => {
      const v = iou(pb, d.bbox)
      return v >= o.iouGate ? 1 - v : 1e9
    }))
    const match = hungarian(cost, 1e8)
    const matchedDet = new Set<number>()
    this.tracks.forEach((t, i) => {
      const j = match[i]
      if (j >= 0) {
        matchedDet.add(j)
        const d = dets[j]
        const dt = Math.max(1e-3, (tMs - t.lastSeenMs) / 1000)
        const a = o.alpha
        const nb: BBox = [
          t.bbox[0] + a * (d.bbox[0] - t.bbox[0]),
          t.bbox[1] + a * (d.bbox[1] - t.bbox[1]),
          t.bbox[2] + a * (d.bbox[2] - t.bbox[2]),
          t.bbox[3] + a * (d.bbox[3] - t.bbox[3]),
        ]
        // velocity from the RAW boxes: the smoothed box lags a moving person and would under-estimate speed
        const [cx0, cy0] = center(t.raw)
        const [cx1, cy1] = center(d.bbox)
        const vx = (cx1 - cx0) / dt
        const vy = (cy1 - cy0) / dt
        t.velocity = t.hits < 2 ? [vx, vy] : [t.velocity[0] * 0.4 + vx * 0.6, t.velocity[1] * 0.4 + vy * 0.6]
        t.speedRel = Math.hypot(t.velocity[0], t.velocity[1]) / Math.max(1, nb[3])
        t.raw = [...d.bbox] as BBox
        t.bbox = nb
        t.score = t.score + a * (d.score - t.score)
        t.hits++
        t.manual = d.manual
        t.misses = 0
        t.lastSeenMs = tMs
        if (t.hits >= o.minHits) t.confirmed = true
      } else {
        t.misses++
      }
    })
    dets.forEach((d, j) => {
      if (matchedDet.has(j)) return
      this.tracks.push({
        id: this.nextId++,
        bbox: [...d.bbox] as BBox,
        raw: [...d.bbox] as BBox,
        manual: d.manual,
        score: d.score,
        hits: 1,
        misses: 0,
        firstSeenMs: tMs,
        lastSeenMs: tMs,
        velocity: [0, 0],
        speedRel: 0,
        confirmed: o.minHits <= 1,
      })
    })
    this.tracks = this.tracks.filter((t) => tMs - t.lastSeenMs <= o.maxAgeMs)
    return this.tracks.filter((t) => t.confirmed)
  }
}
