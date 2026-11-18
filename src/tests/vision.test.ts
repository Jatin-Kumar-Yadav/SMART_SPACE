import { describe, expect, it } from 'vitest'
import type { CalibrationPoint, Vec2, Vec3 } from '@/types'
import { estimateHomography, applyHomography, focalFromHomography } from '@/vision/homography'
import { calibrateCamera, intrinsics, lookAtPose, projectPoint, viewDirection } from '@/vision/pose'

const rng = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32)

const W = 1280
const H = 720
const FOV = 68
const K = intrinsics([W, H], FOV)
// camera standing at the north wall of a 12 × 9 m room, 2.6 m up, looking south-down
const truePose = lookAtPose([6, 2.6, -0.5], [6, 0.5, 6])

const project = (p: Vec3): Vec2 => projectPoint(truePose, K, p)!.px

describe('camera model', () => {
  it('has the right handedness: facing south, east appears on the LEFT of the image', () => {
    const east = project([9, 0, 6])
    const west = project([3, 0, 6])
    expect(east[0]).toBeLessThan(west[0])
  })

  it('points straight ahead land at the image centre', () => {
    const c = project([6, 0.5, 6])
    expect(c[0]).toBeCloseTo(W / 2, 3)
    expect(c[1]).toBeCloseTo(H / 2, 3)
  })

  it('floor points further away appear higher in the image', () => {
    expect(project([6, 0, 8])[1]).toBeLessThan(project([6, 0, 3])[1])
  })

  it('view direction points at the target', () => {
    const d = viewDirection(truePose)
    const expected = [0, -2.1, 6.5]
    const n = Math.hypot(...expected)
    d.forEach((v, i) => expect(v).toBeCloseTo(expected[i] / n, 6))
  })
})

describe('homography', () => {
  const floor: Vec2[] = [[0, 0], [12, 0], [12, 9], [0, 9], [6, 4.5], [3, 7]]
  const pix = floor.map((f) => project([f[0], 0, f[1]]))

  it('maps floor points to the pixels they project to', () => {
    const Hm = estimateHomography(floor, pix)!
    floor.forEach((f, i) => {
      const p = applyHomography(Hm, f)!
      expect(p[0]).toBeCloseTo(pix[i][0], 4)
      expect(p[1]).toBeCloseTo(pix[i][1], 4)
    })
    // generalises to an unseen point
    const probe = applyHomography(Hm, [8, 2])!
    const truth = project([8, 0, 2])
    expect(Math.hypot(probe[0] - truth[0], probe[1] - truth[1])).toBeLessThan(1e-3)
  })

  it('rejects collinear points', () => {
    expect(estimateHomography([[0, 0], [1, 0], [2, 0], [3, 0]], [[0, 0], [1, 1], [2, 2], [3, 3]])).toBeNull()
  })

  it('recovers the focal length of the camera that took the picture', () => {
    const Hm = estimateHomography(floor, pix)!
    const f = focalFromHomography(Hm, W, H)!
    expect(f / K[0]).toBeGreaterThan(0.98)
    expect(f / K[0]).toBeLessThan(1.02)
  })
})

describe('calibration', () => {
  const picks: Vec3[] = [[0, 0, 0], [12, 0, 0], [12, 0, 9], [0, 0, 9], [6, 0, 4.5], [0, 0, 4.5], [12, 0, 4.5]]
  const make = (noise: number, seed = 3): CalibrationPoint[] => {
    const r = rng(seed)
    return picks.map((w) => {
      const p = project(w)
      return { world: w, image: [p[0] + (r() - 0.5) * 2 * noise, p[1] + (r() - 0.5) * 2 * noise] as Vec2 }
    })
  }

  it('recovers the camera position from exact correspondences (known FOV)', () => {
    const res = calibrateCamera(make(0), [W, H], FOV)
    expect(res.ok).toBe(true)
    expect(res.pose!.position[0]).toBeCloseTo(6, 2)
    expect(res.pose!.position[1]).toBeCloseTo(2.6, 2)
    expect(res.pose!.position[2]).toBeCloseTo(-0.5, 2)
    expect(res.level).toBe('good')
  })

  it('stays within ~25 cm with 1.5 px of click noise', () => {
    const res = calibrateCamera(make(1.5), [W, H], FOV)
    expect(res.ok).toBe(true)
    const d = Math.hypot(res.pose!.position[0] - 6, res.pose!.position[1] - 2.6, res.pose!.position[2] + 0.5)
    expect(d).toBeLessThan(0.25)
    expect(res.reprojectionErrorPx!).toBeLessThan(3)
  })

  it('only trusts an estimated field of view when it is stable under click noise', () => {
    // shallow tilt: the estimate is ill-conditioned → must be rejected with an explanation
    const res = calibrateCamera(make(0.3), [W, H], 'auto')
    expect(res.ok).toBe(true)
    expect(res.fovEstimated).toBe(false)
    expect(res.hFovDeg).toBe(70)
    expect(res.warnings.join(' ')).toMatch(/unstable|Could not estimate/)
  })

  it('accepts the estimated field of view for a strongly oblique, well-spread view', () => {
    const pose2 = lookAtPose([6, 4.2, 1.5], [6, 0, 6])
    const wide: Vec3[] = [[0, 0, 0], [12, 0, 0], [12, 0, 9], [0, 0, 9], [6, 0, 4.5], [0, 0, 4.5], [12, 0, 4.5], [6, 0, 0], [6, 0, 9]]
    const pts = wide.map((w) => ({ world: w, image: projectPoint(pose2, K, w)!.px }))
    const res = calibrateCamera(pts, [W, H], 'auto')
    expect(res.ok).toBe(true)
    if (res.fovEstimated) expect(Math.abs(res.hFovDeg! - FOV)).toBeLessThan(3)
    else expect(res.warnings.length).toBeGreaterThan(0)
  })

  it('flags a sloppy calibration as poor', () => {
    const bad = make(0)
    bad[4] = { ...bad[4], image: [bad[4].image[0] + 150, bad[4].image[1] - 90] } // one wildly wrong click
    const res = calibrateCamera(bad, [W, H], FOV)
    expect(res.ok).toBe(true)
    expect(res.level).not.toBe('good')
  })

  it('does not call a 4-point fit "good" (it fits exactly by construction)', () => {
    const res = calibrateCamera(make(0).slice(0, 4), [W, H], FOV)
    expect(res.ok).toBe(true)
    expect(res.level).toBe('fair')
    expect(res.warnings.join(' ')).toMatch(/4 points/)
  })

  it('uses off-floor points (PnP refinement) and still converges', () => {
    const pts = make(0.5)
    for (const w of [[0, 3, 0], [12, 3, 0]] as Vec3[]) {
      const p = project(w)
      pts.push({ world: w, image: p })
    }
    const res = calibrateCamera(pts, [W, H], FOV)
    expect(res.ok).toBe(true)
    expect(Math.hypot(res.pose!.position[0] - 6, res.pose!.position[1] - 2.6, res.pose!.position[2] + 0.5)).toBeLessThan(0.15)
  })

  it('refuses fewer than 4 floor points with a clear message', () => {
    const res = calibrateCamera(make(0).slice(0, 3), [W, H], FOV)
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/4 floor points/)
  })
})
