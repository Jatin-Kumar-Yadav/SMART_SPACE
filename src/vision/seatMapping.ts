import type { CameraConfig, SeatSlot, Vec3 } from '@/types'
import { cameraPose, projectPoint } from './pose'
import { area, intersection, type BBox } from './geometry'
import { hungarian } from './hungarian'
import type { Track } from './tracker'

/**
 * Seat ⇄ detection association.
 *
 * Every seat has a world position, so it can be projected into the camera image. For a seated
 * adult we project a person-sized volume above the seat and compare it with each detected
 * bounding box on the three quantities a detector measures reliably: horizontal centre, head
 * (top edge) and width. (The bottom edge is ignored – desks hide the legs.)
 * Assignment is one-to-one (Hungarian), gated, and each match carries a confidence that drops when
 * the runner-up seat is almost as plausible (neighbouring seats in a row).
 */

export interface MappingOptions {
  /** half-width of the person volume (m) */
  halfWidth: number
  /** head height above the seat surface (m) */
  headAboveSeat: number
  /** reject matches costlier than this (in body widths) */
  gate: number
  /** confidence needed to treat a match as confirmed */
  minConfidence: number
  /** runner-up closer than this (cost units) marks a match ambiguous */
  ambiguityMargin: number
}

export const DEFAULT_MAPPING: MappingOptions = { halfWidth: 0.3, headAboveSeat: 0.9, gate: 1.15, minConfidence: 0.45, ambiguityMargin: 0.22 }

export interface SeatProjection {
  key: string
  box: BBox
  depth: number
  /** inside the frame and in front of the camera */
  visible: boolean
  /** share of this seat's box hidden behind boxes of nearer seats (0..1) – a hint, not a verdict */
  occludedFrac: number
}

const corners = (seat: SeatSlot, o: MappingOptions): Vec3[] => {
  const [x, y, z] = seat.position
  const y0 = Math.max(0, y - 0.45)
  const y1 = y + o.headAboveSeat
  const out: Vec3[] = []
  for (const dx of [-o.halfWidth, o.halfWidth]) for (const dz of [-o.halfWidth, o.halfWidth]) for (const yy of [y0, y1]) out.push([x + dx, yy, z + dz])
  return out
}

export function projectSeats(cam: CameraConfig, seats: SeatSlot[], o: MappingOptions = DEFAULT_MAPPING): SeatProjection[] {
  const cp = cameraPose(cam)
  if (!cp) return []
  const [W, H] = cam.imageSize
  const out: SeatProjection[] = []
  for (const s of seats) {
    const pts = corners(s, o).map((c) => projectPoint(cp.pose, cp.K, c))
    if (pts.some((p) => !p)) {
      out.push({ key: s.key, box: [0, 0, 0, 0], depth: Infinity, visible: false, occludedFrac: 0 })
      continue
    }
    const xs = pts.map((p) => p!.px[0])
    const ys = pts.map((p) => p!.px[1])
    const box: BBox = [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)]
    const centre = projectPoint(cp.pose, cp.K, [s.position[0], s.position[1] + 0.4, s.position[2]])!
    const inFrame = intersection(box, [0, 0, W, H]) / Math.max(1, area(box))
    out.push({ key: s.key, box, depth: centre.depth, visible: inFrame >= 0.5 && centre.px[0] >= 0 && centre.px[0] <= W && centre.px[1] >= 0 && centre.px[1] <= H, occludedFrac: 0 })
  }
  // occlusion hint: nearer seats whose boxes cover this one
  const vis = out.filter((p) => p.visible)
  for (const p of vis) {
    let worst = 0
    for (const q of vis) {
      if (q === p || q.depth >= p.depth - 0.15) continue
      worst = Math.max(worst, intersection(p.box, q.box) / Math.max(1, area(p.box)))
    }
    p.occludedFrac = worst
  }
  return out
}

export interface Assignment {
  trackId: number
  seatKey: string | null
  /** normalised mismatch (0 = perfect) */
  cost: number
  /** 0..1 – detector score × geometric agreement × ambiguity penalty */
  confidence: number
  /** the second-best plausible seat, when it was nearly as good */
  runnerUp?: { seatKey: string; cost: number }
  ambiguous: boolean
}

function matchCost(box: BBox, seat: BBox): number {
  const wE = Math.max(1, seat[2])
  const cx = box[0] + box[2] / 2
  const cxE = seat[0] + seat[2] / 2
  const dx = Math.abs(cx - cxE) / wE
  const dTop = Math.abs(box[1] - seat[1]) / wE
  const dScale = Math.abs(Math.log(Math.max(1, box[2]) / wE))
  return Math.hypot(dx, 0.8 * dTop) + 0.25 * dScale
}

/**
 * One-to-one assignment of tracked people to visible seats. `tracks` must be in the calibration
 * frame's pixel space. `blockedSeats` (already claimed by a manual correction) are excluded.
 */
export function assignSeats(
  proj: SeatProjection[],
  tracks: Pick<Track, 'id' | 'bbox' | 'score'>[],
  o: MappingOptions = DEFAULT_MAPPING,
  blockedSeats: ReadonlySet<string> = new Set(),
): Assignment[] {
  const seats = proj.filter((p) => p.visible && !blockedSeats.has(p.key))
  if (!tracks.length) return []
  const cost = tracks.map((t) => seats.map((s) => matchCost(t.bbox, s.box)))
  const gated = cost.map((row) => row.map((c) => (c <= o.gate ? c : 1e9)))
  const match = hungarian(gated, 1e8)
  return tracks.map((t, i) => {
    const j = match[i]
    if (j < 0) return { trackId: t.id, seatKey: null, cost: Infinity, confidence: 0, ambiguous: false }
    const c = cost[i][j]
    // runner-up among the other seats that also pass the gate
    let ru: { seatKey: string; cost: number } | undefined
    cost[i].forEach((v, k) => {
      if (k !== j && v <= o.gate && (!ru || v < ru.cost)) ru = { seatKey: seats[k].key, cost: v }
    })
    const ambiguous = !!ru && ru.cost - c < o.ambiguityMargin
    const geometric = Math.exp(-(c * c) / (2 * 0.5 * 0.5))
    const confidence = Math.max(0, Math.min(1, t.score * geometric * (ambiguous ? 0.6 : 1)))
    return { trackId: t.id, seatKey: seats[j].key, cost: c, confidence, runnerUp: ambiguous ? ru : undefined, ambiguous }
  })
}

export type Posture = 'sitting' | 'standing' | 'walking' | 'uncertain'

/**
 * Sitting / standing / walking from motion, seat association and shape.
 * Seat association is the primary evidence for "sitting" (a generic pose classifier would call
 * a person who is merely leaning on a desk "sitting"); shape and motion only separate the rest.
 * Anything not clearly one of them stays 'uncertain' instead of being forced into a class.
 */
export function classifyPosture(track: Pick<Track, 'bbox' | 'speedRel'>, a: Assignment | undefined, o: MappingOptions = DEFAULT_MAPPING): Posture {
  if (track.speedRel > 0.35) return 'walking'
  if (a?.seatKey && a.confidence >= o.minConfidence) return 'sitting'
  const aspect = track.bbox[3] / Math.max(1, track.bbox[2])
  if (aspect >= 2.4) return 'standing'
  return 'uncertain'
}
