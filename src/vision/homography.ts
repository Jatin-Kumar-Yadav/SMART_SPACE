import type { Vec2 } from '@/types'
import { inv3, leastSquares, mul3, mulVec3, type Mat3 } from './linalg'

/** Hartley normalisation: centroid → origin, mean distance → √2. Keeps the DLT well conditioned. */
function normalisation(pts: Vec2[]): Mat3 {
  const n = pts.length
  const cx = pts.reduce((a, p) => a + p[0], 0) / n
  const cy = pts.reduce((a, p) => a + p[1], 0) / n
  const mean = pts.reduce((a, p) => a + Math.hypot(p[0] - cx, p[1] - cy), 0) / n
  const s = mean > 1e-12 ? Math.SQRT2 / mean : 1
  return [s, 0, -s * cx, 0, s, -s * cy, 0, 0, 1]
}

export const applyHomography = (H: Mat3, p: Vec2): Vec2 | null => {
  const [x, y, w] = mulVec3(H, [p[0], p[1], 1])
  if (Math.abs(w) < 1e-12) return null
  return [x / w, y / w]
}

/**
 * Direct Linear Transform with ≥ 4 point pairs: `src` (plane coordinates) → `dst` (pixels).
 * Returns null when the points are degenerate (e.g. collinear).
 */
export function estimateHomography(src: Vec2[], dst: Vec2[]): Mat3 | null {
  if (src.length < 4 || src.length !== dst.length) return null
  const Ts = normalisation(src)
  const Td = normalisation(dst)
  const s = src.map((p) => applyHomography(Ts, p)!)
  const d = dst.map((p) => applyHomography(Td, p)!)
  const A: number[][] = []
  const b: number[] = []
  for (let i = 0; i < s.length; i++) {
    const [x, y] = s[i]
    const [u, v] = d[i]
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u)
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v)
  }
  const h = leastSquares(A, b)
  if (!h) return null
  const Hn: Mat3 = [...h, 1]
  const TdInv = inv3(Td)
  if (!TdInv) return null
  const H = mul3(mul3(TdInv, Hn), Ts)
  const k = H[8]
  return Math.abs(k) > 1e-12 ? H.map((v) => v / k) : H
}

/**
 * Focal length (px) implied by a plane homography when the principal point sits at the image
 * centre and pixels are square. Uses r1·r2 = 0 and |r1| = |r2|. Null when the view is too
 * fronto-parallel for the constraint to be informative.
 */
export function focalFromHomography(H: Mat3, imageW: number, imageH: number): number | null {
  const cx = imageW / 2
  const cy = imageH / 2
  // shift the principal point to the origin
  const T: Mat3 = [1, 0, -cx, 0, 1, -cy, 0, 0, 1]
  const G = mul3(T, H)
  const [h11, h12, , h21, h22, , h31, h32] = G
  const candidates: number[] = []
  if (Math.abs(h31 * h32) > 1e-12) candidates.push(-(h11 * h12 + h21 * h22) / (h31 * h32))
  if (Math.abs(h31 * h31 - h32 * h32) > 1e-12) candidates.push((h12 * h12 + h22 * h22 - h11 * h11 - h21 * h21) / (h31 * h31 - h32 * h32))
  const f2 = candidates.filter((v) => Number.isFinite(v) && v > 0)
  if (!f2.length) return null
  // prefer the better-conditioned estimate (larger denominator magnitude is listed first when informative)
  return Math.sqrt(f2[0])
}
