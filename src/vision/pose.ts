import type { CalibrationLevel, CalibrationPoint, CameraConfig, Vec2, Vec3 } from '@/types'
import { estimateHomography, focalFromHomography } from './homography'
import { cross3, expRotation, inv3, mul3, mulVec3, norm3, orthonormalize, solveLinear, transpose3, type Mat3 } from './linalg'

/**
 * Camera model
 * ------------
 * Room coordinates follow the rest of the app: x east, y up, z south (metres).
 * Pose maths uses the *plane frame* (u, v, w) = (x, z, −y): a right-handed frame whose first two
 * axes span the floor, so a floor point has w = 0 and the plane-induced homography has the
 * classic form H = K [r1 r2 t].
 * The camera uses the OpenCV convention (x right, y down, z forward).
 */

export const toPlane = (p: readonly number[]): Vec3 => [p[0], p[2], -p[1]]
export const fromPlane = (p: readonly number[]): Vec3 => [p[0], -p[2], p[1]]

export const intrinsics = (imageSize: Vec2, hFovDeg: number): Mat3 => {
  const f = imageSize[0] / 2 / Math.tan((hFovDeg * Math.PI) / 360)
  return [f, 0, imageSize[0] / 2, 0, f, imageSize[1] / 2, 0, 0, 1]
}

export const hFovFromFocal = (f: number, imageW: number) => (2 * Math.atan(imageW / 2 / f) * 180) / Math.PI

export interface Pose {
  /** camera centre in room coordinates */
  position: Vec3
  /** row-major rotation: plane frame → camera frame */
  rotation: Mat3
}

/** Project a room point to pixels. Null when it is behind (or almost in the plane of) the camera. */
export function projectPoint(pose: Pose, K: Mat3, p: Vec3): { px: Vec2; depth: number } | null {
  const c = toPlane(pose.position)
  const q = toPlane(p)
  const xc = mulVec3(pose.rotation, [q[0] - c[0], q[1] - c[1], q[2] - c[2]])
  if (xc[2] < 0.05) return null
  return { px: [(K[0] * xc[0]) / xc[2] + K[2], (K[4] * xc[1]) / xc[2] + K[5]], depth: xc[2] }
}

/** Decompose a floor homography into camera pose given known intrinsics. Null when inconsistent. */
export function poseFromHomography(H: Mat3, K: Mat3): Pose | null {
  const Ki = inv3(K)
  if (!Ki) return null
  const M = mul3(Ki, H)
  const m1: Vec3 = [M[0], M[3], M[6]]
  const m2: Vec3 = [M[1], M[4], M[7]]
  const m3: Vec3 = [M[2], M[5], M[8]]
  const n1 = norm3(m1)
  const n2 = norm3(m2)
  if (n1 < 1e-12 || n2 < 1e-12) return null
  let lambda = 2 / (n1 + n2)
  if (lambda * m3[2] < 0) lambda = -lambda // the floor must lie in front of the camera
  const r1 = m1.map((v) => v * lambda) as Vec3
  const r2 = m2.map((v) => v * lambda) as Vec3
  const r3 = cross3(r1, r2)
  const t = m3.map((v) => v * lambda) as Vec3
  const R = orthonormalize([r1[0], r2[0], r3[0], r1[1], r2[1], r3[1], r1[2], r2[2], r3[2]])
  // camera centre in the plane frame: C = −Rᵀ t
  const C = mulVec3(transpose3(R), t).map((v) => -v) as Vec3
  return { position: fromPlane(C), rotation: R }
}

export interface Correspondence {
  image: Vec2
  world: Vec3
}

/** RMS reprojection error in pixels (points that fall behind the camera count as a large error). */
export function reprojectionRms(pose: Pose, K: Mat3, pts: Correspondence[]): number {
  if (!pts.length) return 0
  let s = 0
  for (const p of pts) {
    const pr = projectPoint(pose, K, p.world)
    if (!pr) s += 1e6
    else s += (pr.px[0] - p.image[0]) ** 2 + (pr.px[1] - p.image[1]) ** 2
  }
  return Math.sqrt(s / pts.length)
}

/**
 * PnP refinement (Levenberg–Marquardt on the reprojection error, intrinsics fixed).
 * Works for coplanar and non-coplanar correspondences, so extra points off the floor
 * (wall corners, ceiling corners) tighten the pose.
 */
export function refinePose(init: Pose, K: Mat3, pts: Correspondence[], iterations = 40): Pose {
  if (pts.length < 4) return init
  let R = init.rotation
  let C = toPlane(init.position)
  const resid = (Rm: Mat3, Cm: Vec3): number[] | null => {
    const out: number[] = []
    for (const p of pts) {
      const pr = projectPoint({ position: fromPlane(Cm), rotation: Rm }, K, p.world)
      if (!pr) return null
      out.push(pr.px[0] - p.image[0], pr.px[1] - p.image[1])
    }
    return out
  }
  const apply = (Rm: Mat3, Cm: Vec3, d: number[]): [Mat3, Vec3] => [mul3(expRotation(d.slice(0, 3)), Rm), [Cm[0] + d[3], Cm[1] + d[4], Cm[2] + d[5]]]
  let r = resid(R, C)
  if (!r) return init
  let cost = r.reduce((a, v) => a + v * v, 0)
  let lambda = 1e-3
  for (let it = 0; it < iterations; it++) {
    // numeric Jacobian (central differences)
    const J: number[][] = r.map(() => new Array<number>(6).fill(0))
    let ok = true
    for (let k = 0; k < 6; k++) {
      const h = k < 3 ? 1e-6 : 1e-5
      const dp = new Array<number>(6).fill(0)
      dp[k] = h
      const [Rp, Cp] = apply(R, C, dp)
      dp[k] = -h
      const [Rm, Cm] = apply(R, C, dp)
      const rp = resid(Rp, Cp)
      const rm = resid(Rm, Cm)
      if (!rp || !rm) { ok = false; break }
      for (let i = 0; i < r.length; i++) J[i][k] = (rp[i] - rm[i]) / (2 * h)
    }
    if (!ok) break
    const JtJ = Array.from({ length: 6 }, () => new Array<number>(6).fill(0))
    const Jtr = new Array<number>(6).fill(0)
    for (let i = 0; i < r.length; i++) {
      for (let a = 0; a < 6; a++) {
        Jtr[a] += J[i][a] * r[i]
        for (let b = 0; b < 6; b++) JtJ[a][b] += J[i][a] * J[i][b]
      }
    }
    let improved = false
    for (let tries = 0; tries < 8; tries++) {
      const A = JtJ.map((row, a) => row.map((v, b) => (a === b ? v * (1 + lambda) + 1e-9 : v)))
      const step = solveLinear(A, Jtr.map((v) => -v))
      if (!step) { lambda *= 10; continue }
      const [Rn, Cn] = apply(R, C, step)
      const rn = resid(Rn, Cn)
      const cn = rn ? rn.reduce((a, v) => a + v * v, 0) : Infinity
      if (rn && cn < cost) {
        R = orthonormalize(Rn); C = Cn; r = rn
        const gain = cost - cn
        cost = cn
        lambda = Math.max(lambda / 3, 1e-9)
        improved = true
        if (gain < 1e-10) it = iterations
        break
      }
      lambda *= 5
    }
    if (!improved) break
  }
  return { position: fromPlane(C), rotation: R }
}

export interface CalibrationResult {
  ok: boolean
  error?: string
  homography?: Mat3
  pose?: Pose
  hFovDeg?: number
  /** true when the field of view came from the homography rather than the user */
  fovEstimated?: boolean
  reprojectionErrorPx?: number
  level: CalibrationLevel
  warnings: string[]
}

const FLOOR_EPS = 0.05

/**
 * Focal-length estimation from one plane is notoriously noise sensitive. Re-estimate it under
 * ±1 px jitter of the clicked points (deterministic) and report the relative spread; the
 * estimate is only trusted when it barely moves.
 */
export function focalStability(floorWorld: Vec2[], floorImage: Vec2[], imageSize: Vec2, trials = 40): { relStd: number; valid: number } {
  let seed = 12345
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32) - 0.5
  const fs: number[] = []
  for (let t = 0; t < trials; t++) {
    const jittered = floorImage.map((p) => [p[0] + rand() * 2, p[1] + rand() * 2] as Vec2)
    const H = estimateHomography(floorWorld, jittered)
    const f = H ? focalFromHomography(H, imageSize[0], imageSize[1]) : null
    if (f && Number.isFinite(f)) fs.push(f)
  }
  if (fs.length < trials * 0.75) return { relStd: Infinity, valid: fs.length }
  const mean = fs.reduce((a, v) => a + v, 0) / fs.length
  const sd = Math.sqrt(fs.reduce((a, v) => a + (v - mean) ** 2, 0) / fs.length)
  return { relStd: sd / mean, valid: fs.length }
}

export function levelFor(errPx: number, imageSize: Vec2): CalibrationLevel {
  const rel = errPx / Math.hypot(imageSize[0], imageSize[1])
  return rel < 0.004 ? 'good' : rel < 0.012 ? 'fair' : 'poor'
}

/**
 * Estimate the camera-to-room mapping from user-picked correspondences.
 *  1. Floor points (y≈0) → homography (image ⇄ floor plane).
 *  2. Intrinsics from the given FOV, or estimated from the homography when fov = 'auto'.
 *  3. Pose from the homography, then PnP refinement using every point (incl. off-floor ones).
 * A single image cannot reveal its own pose; this needs ≥ 4 floor points that are not collinear.
 */
export function calibrateCamera(points: CalibrationPoint[], imageSize: Vec2, fov: number | 'auto'): CalibrationResult {
  const warnings: string[] = []
  const floor = points.filter((p) => Math.abs(p.world[1]) < FLOOR_EPS)
  if (floor.length < 4) return { ok: false, error: `Need at least 4 floor points (have ${floor.length}).`, level: 'none', warnings }
  const H = estimateHomography(floor.map((p) => [p.world[0], p.world[2]] as Vec2), floor.map((p) => p.image))
  if (!H) return { ok: false, error: 'The floor points are degenerate (collinear or duplicated). Pick points spread across the room.', level: 'none', warnings }

  let hFov = typeof fov === 'number' ? fov : 70
  let fovEstimated = false
  if (fov === 'auto') {
    const f = focalFromHomography(H, imageSize[0], imageSize[1])
    const est = f ? hFovFromFocal(f, imageSize[0]) : null
    const stab = focalStability(floor.map((p) => [p.world[0], p.world[2]] as Vec2), floor.map((p) => p.image), imageSize)
    if (est && est >= 25 && est <= 130 && stab.relStd < 0.08) {
      hFov = est
      fovEstimated = true
    } else {
      warnings.push(
        est && stab.relStd >= 0.08
          ? 'The field-of-view estimate is unstable for these points (it changes a lot with 1 px of click noise), so it was not used. Using 70°; enter the real value (phone main camera ≈ 65–80°) for a reliable pose.'
          : 'Could not estimate the field of view from these points (view too head-on or too few points). Using 70°; enter the real value for better results.',
      )
    }
  }
  const K = intrinsics(imageSize, hFov)
  const init = poseFromHomography(H, K)
  if (!init) return { ok: false, error: 'Could not derive a camera pose from the homography.', level: 'none', warnings }

  const corr: Correspondence[] = points.map((p) => ({ image: p.image, world: p.world }))
  const hasElevated = points.some((p) => Math.abs(p.world[1]) >= FLOOR_EPS)
  const pose = points.length >= 5 || hasElevated ? refinePose(init, K, corr) : init
  const err = reprojectionRms(pose, K, corr)
  let level = levelFor(err, imageSize)
  if (points.length === 4 && !hasElevated) {
    warnings.push('Exactly 4 points fit perfectly by construction, so the error cannot validate them. Add 2 or more points to check the calibration.')
    if (level === 'good') level = 'fair'
  }
  if (pose.position[1] < 0.3) {
    warnings.push('The estimated camera is at or below floor level. Check that the point order and mirroring match the room, and that the field of view is right.')
    level = 'poor'
  }
  const dims = Math.max(...points.map((p) => Math.hypot(p.world[0], p.world[2])))
  if (Math.hypot(pose.position[0], pose.position[2]) > dims * 6 + 50) {
    warnings.push('The estimated camera is implausibly far from the room. The field of view is probably wrong.')
    level = 'poor'
  }
  return { ok: true, homography: H, pose, hFovDeg: hFov, fovEstimated, reprojectionErrorPx: err, level, warnings }
}

/** Convenience: pose of a stored camera, or null when it has not been calibrated. */
export function cameraPose(cfg: CameraConfig): { pose: Pose; K: Mat3 } | null {
  if (!cfg.pose) return null
  return { pose: { position: cfg.pose.position, rotation: cfg.pose.rotation }, K: intrinsics(cfg.imageSize, cfg.hFovDeg) }
}

/** Image pixel → floor point (x, z). Only valid for things that really touch the floor. */
export function imageToFloor(cfg: CameraConfig, px: Vec2): Vec2 | null {
  if (!cfg.homography) return null
  const inv = inv3(cfg.homography)
  if (!inv) return null
  const [x, y, w] = mulVec3(inv, [px[0], px[1], 1])
  return Math.abs(w) < 1e-12 ? null : [x / w, y / w]
}

/** Floor point → pixel through the stored homography. */
export function floorToImage(cfg: CameraConfig, floor: Vec2): Vec2 | null {
  if (!cfg.homography) return null
  const [x, y, w] = mulVec3(cfg.homography, [floor[0], floor[1], 1])
  return Math.abs(w) < 1e-12 ? null : [x / w, y / w]
}

/** Pose of a camera at `position` looking at `target` with the horizon level (room coordinates). */
export function lookAtPose(position: Vec3, target: Vec3): Pose {
  const f = toPlane([target[0] - position[0], target[1] - position[1], target[2] - position[2]])
  const n = norm3(f) || 1
  const zc: Vec3 = [f[0] / n, f[1] / n, f[2] / n]
  const down: Vec3 = [0, 0, 1] // plane-frame direction of room "down"
  let xc = cross3(down, zc)
  const nx = norm3(xc)
  xc = nx < 1e-9 ? [1, 0, 0] : [xc[0] / nx, xc[1] / nx, xc[2] / nx]
  const yc = cross3(zc, xc)
  return { position, rotation: [xc[0], xc[1], xc[2], yc[0], yc[1], yc[2], zc[0], zc[1], zc[2]] }
}

/** Unit viewing direction of a pose in room coordinates. */
export function viewDirection(pose: Pose): Vec3 {
  const d = mulVec3(transpose3(pose.rotation), [0, 0, 1])
  return fromPlane(d)
}
