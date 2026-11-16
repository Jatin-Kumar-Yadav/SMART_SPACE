import { describe, expect, it } from 'vitest'
import type { CameraConfig, SeatSlot } from '@/types'
import type { PersonDetector } from '@/vision/detector'
import { calibrateCamera, cameraPose, projectPoint } from '@/vision/pose'
import { CameraRuntime } from '@/vision/runtime'
import { frustumCorners, pixelRay } from '@/vision/frustum'
import { projectSeats } from '@/vision/seatMapping'

// A 10 × 8 m room, camera at the back-left corner looking at the room centre.
const IMG: [number, number] = [1280, 720]
function makeCamera(): CameraConfig {
  const truth = { position: [0.4, 3.2, 0.4] as [number, number, number], target: [5, 0.4, 4] as [number, number, number] }
  const base: CameraConfig = { id: 'cam1', name: 'Cam', imageSize: IMG, hFovDeg: 70, points: [], level: 'none', updatedAt: 0 }
  // build the "true" camera through the library's own look-at + a calibration from projected corners
  const probe: CameraConfig = { ...base, pose: undefined }
  const world: [number, number, number][] = [[0, 0, 0], [10, 0, 0], [10, 0, 8], [0, 0, 8], [5, 0, 4], [0, 2.4, 8]]
  // create a pose that sees the room, via calibration of synthetic clicks
  void probe
  return withTruePose(base, truth, world)
}
import { lookAtPose } from '@/vision/pose'
import { intrinsics } from '@/vision/pose'
function withTruePose(base: CameraConfig, truth: { position: [number, number, number]; target: [number, number, number] }, world: [number, number, number][]): CameraConfig {
  const pose = lookAtPose(truth.position, truth.target)
  const K = intrinsics(base.imageSize, base.hFovDeg)
  const points = world.map((w) => ({ world: w, image: projectPoint(pose, K, w)!.px }))
  const cal = calibrateCamera(points, base.imageSize, 70)
  expect(cal.ok).toBe(true)
  return { ...base, points, homography: cal.homography, pose: { position: cal.pose!.position, rotation: cal.pose!.rotation }, level: cal.level, reprojectionErrorPx: cal.reprojectionErrorPx }
}

function seatsGrid(): SeatSlot[] {
  const out: SeatSlot[] = []
  for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) out.push({ key: `o${r}${c}:0`, objectId: `o${r}${c}`, index: 0, position: [2.5 + c * 1.6, 0.45, 2.5 + r * 1.6], facing: 0 })
  return out
}

describe('calibration geometry helpers', () => {
  it('pixelRay passes through the point it was built from', () => {
    const cam = makeCamera()
    const cp = cameraPose(cam)!
    const world: [number, number, number] = [6, 0.45, 5]
    const px = projectPoint(cp.pose, cp.K, world)!.px
    const ray = pixelRay(cam, px)!
    const t = (world[0] - ray.origin[0]) / ray.dir[0]
    expect(ray.origin[1] + ray.dir[1] * t).toBeCloseTo(world[1], 2)
    expect(ray.origin[2] + ray.dir[2] * t).toBeCloseTo(world[2], 2)
  })
  it('frustum footprint lands inside / around the room', () => {
    const f = frustumCorners(makeCamera())!
    expect(f).toHaveLength(4)
    expect(f.some((c) => c.onFloor)).toBe(true)
  })
})

describe('CameraRuntime with an injected detector', () => {
  const seats = seatsGrid()
  const cam = makeCamera()
  const proj = projectSeats(cam, seats)
  const boxFor = (key: string) => proj.find((p) => p.key === key)!.box
  const frame = { frame: {} as never, size: IMG, timeMs: 0 }
  const detectorOf = (keys: string[]): PersonDetector => ({ name: 'fake', detect: async () => keys.map((k) => ({ bbox: boxFor(k), score: 0.9 })), dispose() {} })

  it('maps detected people to distinct seats and reports them as committed', async () => {
    const wanted = ['o00:0', 'o01:0', 'o12:0']
    const rt = new CameraRuntime('cam1', async () => detectorOf(wanted))
    rt.configure(cam, seats)
    rt.setFrameProvider(() => frame)
    const r = (await rt.analyzeOnce())!
    expect(r.stats.detections).toBe(3)
    expect([...r.committed].sort()).toEqual([...wanted].sort())
    expect(new Set(r.committed).size).toBe(r.committed.length) // one person per seat
  })

  it('without a calibrated camera nothing is mapped and the user is told why', async () => {
    const rt = new CameraRuntime('cam1', async () => detectorOf(['o00:0']))
    rt.configure(null, seats)
    rt.setFrameProvider(() => frame)
    const r = (await rt.analyzeOnce())!
    expect(r.committed).toEqual([])
    expect(r.warnings.join(' ')).toMatch(/calibrate/i)
  })

  it('works with hand-drawn boxes when the model is unavailable, and says so', async () => {
    const rt = new CameraRuntime('cam1', async () => null)
    rt.configure(cam, seats)
    rt.setFrameProvider(() => frame)
    await rt.addManualBox(boxFor('o10:0'))
    expect(rt.state.result!.committed).toEqual(['o10:0'])
    expect(rt.state.error).toMatch(/not loaded/i)
    expect(rt.state.manualBoxes).toBe(1)
  })

  it('a manual correction can reassign, mark uncertain and ignore', async () => {
    const rt = new CameraRuntime('cam1', async () => detectorOf(['o00:0', 'o01:0']))
    rt.configure(cam, seats)
    rt.setFrameProvider(() => frame)
    const r0 = (await rt.analyzeOnce())!
    const t = r0.tracks.find((x) => x.seatKey === 'o00:0')!
    rt.pipeline.assignManually(t.id, 'o22:0')
    expect(rt.reevaluate()!.committed.sort()).toEqual(['o01:0', 'o22:0'])
    rt.pipeline.markUncertain(t.id)
    const r1 = rt.reevaluate()!
    expect(r1.committed).toEqual(['o01:0'])
    expect(r1.tracks.find((x) => x.id === t.id)!.status).toBe('uncertain')
    rt.pipeline.ignoreTrack(t.id)
    const r2 = rt.reevaluate()!
    expect(r2.tracks.find((x) => x.id === t.id)!.status).toBe('ignored')
    expect(r2.committed).toEqual(['o01:0'])
  })
})
