import { describe, expect, it } from 'vitest'
import type { CameraConfig, SeatSlot, Vec3 } from '@/types'
import { hungarian } from '@/vision/hungarian'
import { SeatOccupancyFilter } from '@/vision/occupancyFilter'
import { CameraOccupancyPipeline } from '@/vision/pipeline'
import { calibrateCamera, intrinsics, lookAtPose, projectPoint } from '@/vision/pose'
import { projectSeats } from '@/vision/seatMapping'
import type { Detection } from '@/vision/tracker'

const W = 1280
const H = 720
const FOV = 80
const K = intrinsics([W, H], FOV)
const truePose = lookAtPose([6, 3.6, -3.4], [6, 0.3, 5.2])

const rngFactory = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32)

function makeCamera(): CameraConfig {
  // floor points the user would click: all inside the camera frame
  const picks: Vec3[] = [[1, 0, 1.5], [11, 0, 1.5], [11, 0, 9], [1, 0, 9], [6, 0, 5], [3, 0, 7], [9, 0, 3]]
  const pts = picks.map((w) => ({ world: w, image: projectPoint(truePose, K, w)!.px }))
  const res = calibrateCamera(pts, [W, H], FOV)
  expect(res.ok).toBe(true)
  return {
    id: 'cam1', name: 'Front camera', imageSize: [W, H], hFovDeg: res.hFovDeg!, points: pts,
    homography: res.homography, pose: { position: res.pose!.position, rotation: res.pose!.rotation },
    reprojectionErrorPx: res.reprojectionErrorPx, level: res.level, updatedAt: 0,
  }
}

// 4 rows × 6 columns of chairs; row spacing 1.5 m, column spacing 1.6 m
function makeSeats(): SeatSlot[] {
  const seats: SeatSlot[] = []
  for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++) {
    seats.push({ key: `chair_${r}_${c}:0`, objectId: `chair_${r}_${c}`, index: 0, position: [2 + c * 1.6, 0.45, 2.5 + r * 1.5] as Vec3, facing: 0 })
  }
  return seats
}

const cam = makeCamera()
const seats = makeSeats()
const keyOf = (r: number, c: number) => `chair_${r}_${c}:0`
const proj = Object.fromEntries(projectSeats(cam, seats).map((p) => [p.key, p]))

/** What a real detector would roughly report for a seated person (legs hidden behind the desk). */
function personAt(key: string, rnd: () => number, score = 0.85): Detection {
  const b = proj[key].box
  const w = b[2] * (0.9 + rnd() * 0.25)
  const h = b[3] * (0.7 + rnd() * 0.1)
  return { bbox: [b[0] + (b[2] - w) / 2 + (rnd() - 0.5) * 0.12 * b[2], b[1] + (rnd() - 0.5) * 0.08 * b[2], w, h], score }
}

describe('hungarian', () => {
  it('finds the minimum-cost one-to-one assignment', () => {
    const c = [[4, 1, 3], [2, 0, 5], [3, 2, 2]]
    const a = hungarian(c)
    expect(a.reduce((s, j, i) => s + c[i][j], 0)).toBe(5)
    expect(new Set(a).size).toBe(3)
  })
  it('handles more rows than columns and forbidden pairs', () => {
    const a = hungarian([[1, 1e9], [1e9, 1e9], [1, 2]])
    expect(a.filter((x) => x >= 0).length).toBe(2)
    expect(a[1]).toBe(-1)
  })
})

describe('seat projection', () => {
  it('sees every seat of the classroom, nearer rows lower in the image', () => {
    expect(Object.values(proj).every((p) => p.visible)).toBe(true)
    expect(proj[keyOf(0, 2)].box[1]).toBeGreaterThan(proj[keyOf(3, 2)].box[1])
  })
})

describe('single image → occupancy', () => {
  const truth = [keyOf(0, 1), keyOf(0, 4), keyOf(1, 0), keyOf(1, 1), keyOf(1, 2), keyOf(2, 3), keyOf(2, 5), keyOf(3, 0), keyOf(3, 2), keyOf(3, 3), keyOf(3, 4), keyOf(0, 5), keyOf(2, 1), keyOf(1, 5)]

  it('recovers exactly which seats are taken (14 of 24), one person per seat', () => {
    const rnd = rngFactory(7)
    const pipe = new CameraOccupancyPipeline()
    pipe.configure(cam, seats)
    const res = pipe.process(truth.map((k) => personAt(k, rnd)), [W, H], 0, 'snapshot')
    expect([...res.committed].sort()).toEqual([...truth].sort())
    expect(new Set(res.tracks.map((t) => t.seatKey).filter(Boolean)).size).toBe(truth.length)
    expect(res.stats.meanConfidence).toBeGreaterThan(0.5)
  })

  it('does not count a standing person in the aisle, and flags it', () => {
    const rnd = rngFactory(9)
    const pipe = new CameraOccupancyPipeline()
    pipe.configure(cam, seats)
    // a tall narrow box between the first two rows
    const c = projectPoint(truePose, K, [6.8, 0, 3.2])!.px
    const standing: Detection = { bbox: [c[0] - 45, c[1] - 260, 90, 260], score: 0.9 }
    const res = pipe.process([...truth.slice(0, 5).map((k) => personAt(k, rnd)), standing], [W, H], 0, 'snapshot')
    expect(res.committed.length).toBe(5)
    expect(res.stats.standing + res.stats.unassigned + res.stats.uncertain).toBe(1)
  })

  it('leaves low-confidence detections as uncertain instead of forcing a seat', () => {
    const rnd = rngFactory(11)
    const pipe = new CameraOccupancyPipeline()
    pipe.configure(cam, seats)
    const dets = [personAt(keyOf(1, 2), rnd, 0.9), personAt(keyOf(2, 2), rnd, 0.22)]
    const res = pipe.process(dets, [W, H], 0, 'snapshot')
    expect(res.committed).toEqual([keyOf(1, 2)])
    expect(res.stats.uncertain).toBe(1)
  })

  it('scales detections from a different live resolution', () => {
    const rnd = rngFactory(5)
    const pipe = new CameraOccupancyPipeline()
    pipe.configure(cam, seats)
    const half = truth.slice(0, 6).map((k) => {
      const d = personAt(k, rnd)
      return { ...d, bbox: d.bbox.map((v) => v / 2) as Detection['bbox'] }
    })
    const res = pipe.process(half, [W / 2, H / 2], 0, 'snapshot')
    expect([...res.committed].sort()).toEqual(truth.slice(0, 6).sort())
  })

  it('refuses to map without a calibrated camera', () => {
    const pipe = new CameraOccupancyPipeline()
    pipe.configure({ ...cam, pose: undefined, homography: undefined }, seats)
    const res = pipe.process([personAt(keyOf(0, 0), rngFactory(1))], [W, H], 0, 'snapshot')
    expect(res.committed).toEqual([])
    expect(res.warnings.join(' ')).toMatch(/calibrat/i)
  })

  it('reports seats outside the camera view as unobserved (their state is unknown)', () => {
    const far: SeatSlot = { key: 'behind:0', objectId: 'behind', index: 0, position: [6, 0.45, -4] as Vec3, facing: 0 }
    const pipe = new CameraOccupancyPipeline()
    pipe.configure(cam, [...seats, far])
    const res = pipe.process([], [W, H], 0, 'snapshot')
    expect(res.stats.unobservedSeats).toBe(1)
  })
})

describe('video → temporally confirmed occupancy', () => {
  const dt = 200 // 5 fps
  const run = (frames: (i: number) => Detection[], n: number, pipe = new CameraOccupancyPipeline()) => {
    pipe.configure(cam, seats)
    const out = []
    for (let i = 0; i < n; i++) out.push(pipe.process(frames(i), [W, H], i * dt, 'stream'))
    return { pipe, out }
  }

  it('keeps one id per person across frames', () => {
    const rnd = rngFactory(3)
    const base = [keyOf(1, 1), keyOf(2, 4)].map((k) => personAt(k, rnd))
    const { out } = run(() => base.map((d) => ({ ...d, bbox: d.bbox.map((v) => v + (rnd() - 0.5) * 2) as Detection['bbox'] })), 12)
    const ids = new Set(out.flatMap((r) => r.tracks.map((t) => t.id)))
    expect(ids.size).toBe(2)
  })

  it('confirms a seat only after sustained detection and ignores a one-frame ghost', () => {
    const rnd = rngFactory(4)
    const real = personAt(keyOf(1, 1), rnd)
    const ghost = personAt(keyOf(3, 3), rnd)
    const { out } = run((i) => (i === 3 ? [real, ghost] : [real]), 14)
    expect(out[2].committed).toEqual([]) // not yet confirmed (< 1.5 s)
    expect(out[13].committed).toEqual([keyOf(1, 1)])
    expect(out.some((r) => r.committed.includes(keyOf(3, 3)))).toBe(false)
  })

  it('does not flicker when the detector briefly loses a person', () => {
    const rnd = rngFactory(6)
    const p = personAt(keyOf(2, 2), rnd)
    const { out } = run((i) => (i === 14 || i === 15 ? [] : [p]), 24)
    const confirmedAt = out.findIndex((r) => r.committed.includes(keyOf(2, 2)))
    expect(confirmedAt).toBeGreaterThan(0)
    for (let i = confirmedAt; i < out.length; i++) expect(out[i].committed).toContain(keyOf(2, 2))
  })

  it('frees the seat once the person has really left', () => {
    const rnd = rngFactory(8)
    const p = personAt(keyOf(0, 3), rnd)
    const { out } = run((i) => (i < 12 ? [p] : []), 50)
    expect(out[11].committed).toContain(keyOf(0, 3))
    expect(out[49].committed).not.toContain(keyOf(0, 3))
  })

  it('classifies a person who is moving as walking and does not seat them', () => {
    const { out } = run((i) => [{ bbox: [300 + i * 70, 260, 100, 300], score: 0.9 }], 12)
    const last = out[11].tracks[0]
    expect(last.posture).toBe('walking')
    expect(out[11].committed).toEqual([])
  })
})

describe('manual correction', () => {
  it('lets the user reassign, ignore and force seats', () => {
    const rnd = rngFactory(13)
    const pipe = new CameraOccupancyPipeline()
    pipe.configure(cam, seats)
    const dets = [keyOf(0, 0), keyOf(1, 1), keyOf(2, 2)].map((k) => personAt(k, rnd))
    let res = pipe.process(dets, [W, H], 0, 'snapshot')
    expect(res.committed.length).toBe(3)
    const t = res.tracks.find((x) => x.seatKey === keyOf(1, 1))!
    pipe.assignManually(t.id, keyOf(3, 5))
    res = pipe.reevaluate()!
    expect(res.committed).toContain(keyOf(3, 5))
    expect(res.committed).not.toContain(keyOf(1, 1))
    pipe.ignoreTrack(res.tracks.find((x) => x.seatKey === keyOf(0, 0))!.id)
    res = pipe.reevaluate()!
    expect(res.committed).not.toContain(keyOf(0, 0))
    pipe.forceSeat(keyOf(2, 4), 'occupied')
    res = pipe.reevaluate()!
    expect(res.committed).toContain(keyOf(2, 4))
    pipe.forceSeat(keyOf(2, 4), 'vacant')
    expect(pipe.reevaluate()!.committed).not.toContain(keyOf(2, 4))
  })
})

describe('seat occupancy filter', () => {
  it('confirms after the dwell time, clears after the clear time', () => {
    const f = new SeatOccupancyFilter({ confirmMs: 1000, clearMs: 3000, gapMs: 600 })
    expect(f.update(new Set(['a']), 0).has('a')).toBe(false)
    expect(f.update(new Set(['a']), 600).has('a')).toBe(false)
    expect(f.update(new Set(['a']), 1200).has('a')).toBe(true)
    expect(f.update(new Set(), 2500).has('a')).toBe(true)
    expect(f.update(new Set(), 4300).has('a')).toBe(false)
  })
})
