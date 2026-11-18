import type { CameraConfig, Vec2, Vec3 } from '@/types'
import { mulVec3, transpose3 } from './linalg'
import { cameraPose, fromPlane } from './pose'

/** World-space ray (room coordinates) through an image pixel of a calibrated camera. */
export function pixelRay(cam: CameraConfig, px: Vec2): { origin: Vec3; dir: Vec3 } | null {
  const cp = cameraPose(cam)
  if (!cp) return null
  const { K, pose } = cp
  const d = [(px[0] - K[2]) / K[0], (px[1] - K[5]) / K[4], 1]
  const dir = fromPlane(mulVec3(transpose3(pose.rotation), d))
  const n = Math.hypot(dir[0], dir[1], dir[2]) || 1
  return { origin: pose.position, dir: [dir[0] / n, dir[1] / n, dir[2] / n] }
}

/**
 * Where the four image corners land: on the floor when the ray points downwards, otherwise at
 * `maxRange` metres along the ray (e.g. a corner above the horizon). `onFloor` tells which.
 */
export function frustumCorners(cam: CameraConfig, maxRange = 14): { point: Vec3; onFloor: boolean }[] | null {
  const [W, H] = cam.imageSize
  const px: Vec2[] = [[0, 0], [W, 0], [W, H], [0, H]]
  const out: { point: Vec3; onFloor: boolean }[] = []
  for (const p of px) {
    const r = pixelRay(cam, p)
    if (!r) return null
    let t = maxRange
    let onFloor = false
    if (r.dir[1] < -1e-4) {
      const tf = -r.origin[1] / r.dir[1]
      if (tf > 0 && tf <= maxRange) {
        t = tf
        onFloor = true
      }
    }
    out.push({ point: [r.origin[0] + r.dir[0] * t, r.origin[1] + r.dir[1] * t, r.origin[2] + r.dir[2] * t], onFloor })
  }
  return out
}
