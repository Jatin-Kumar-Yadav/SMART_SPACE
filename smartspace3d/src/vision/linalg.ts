/** Small dense linear-algebra helpers (no dependencies). Matrices are row-major. */

export type Mat3 = number[] // length 9

export const IDENTITY3: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]

export const mul3 = (a: Mat3, b: Mat3): Mat3 => {
  const o = new Array<number>(9).fill(0)
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) o[r * 3 + c] += a[r * 3 + k] * b[k * 3 + c]
  return o
}

export const transpose3 = (a: Mat3): Mat3 => [a[0], a[3], a[6], a[1], a[4], a[7], a[2], a[5], a[8]]

export const mulVec3 = (a: Mat3, v: readonly number[]): [number, number, number] => [
  a[0] * v[0] + a[1] * v[1] + a[2] * v[2],
  a[3] * v[0] + a[4] * v[1] + a[5] * v[2],
  a[6] * v[0] + a[7] * v[1] + a[8] * v[2],
]

export const det3 = (m: Mat3): number =>
  m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6])

export function inv3(m: Mat3): Mat3 | null {
  const d = det3(m)
  const scale = Math.max(...m.map(Math.abs)) ** 3
  if (!Number.isFinite(d) || Math.abs(d) < 1e-12 * Math.max(scale, 1e-300)) return null
  const c = (r0: number, c0: number, r1: number, c1: number) => m[r0 * 3 + c0] * m[r1 * 3 + c1] - m[r0 * 3 + c1] * m[r1 * 3 + c0]
  return [
    c(1, 1, 2, 2) / d, -c(0, 1, 2, 2) / d, c(0, 1, 1, 2) / d,
    -c(1, 0, 2, 2) / d, c(0, 0, 2, 2) / d, -c(0, 0, 1, 2) / d,
    c(1, 0, 2, 1) / d, -c(0, 0, 2, 1) / d, c(0, 0, 1, 1) / d,
  ]
}

export const cross3 = (a: readonly number[], b: readonly number[]): [number, number, number] => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]

export const norm3 = (a: readonly number[]) => Math.hypot(a[0], a[1], a[2])

/** Solve the square system A x = b by Gaussian elimination with partial pivoting. Returns null if singular. */
export function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = b.length
  const M = A.map((row, i) => [...row, b[i]])
  let maxAbs = 0
  for (const row of A) for (const v of row) maxAbs = Math.max(maxAbs, Math.abs(v))
  const tol = 1e-11 * Math.max(maxAbs, 1e-300)
  for (let col = 0; col < n; col++) {
    let piv = col
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r
    if (Math.abs(M[piv][col]) < tol) return null
    ;[M[col], M[piv]] = [M[piv], M[col]]
    for (let r = col + 1; r < n; r++) {
      const f = M[r][col] / M[col][col]
      if (f === 0) continue
      for (let k = col; k <= n; k++) M[r][k] -= f * M[col][k]
    }
  }
  const x = new Array<number>(n).fill(0)
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n]
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k]
    x[r] = s / M[r][r]
  }
  return x
}

/** Least-squares solution of an over-determined system via the normal equations. */
export function leastSquares(A: number[][], b: number[]): number[] | null {
  const m = A.length
  const n = A[0]?.length ?? 0
  if (m < n) return null
  const AtA = Array.from({ length: n }, () => new Array<number>(n).fill(0))
  const Atb = new Array<number>(n).fill(0)
  for (let i = 0; i < m; i++) {
    for (let r = 0; r < n; r++) {
      Atb[r] += A[i][r] * b[i]
      for (let c = 0; c < n; c++) AtA[r][c] += A[i][r] * A[i][c]
    }
  }
  return solveLinear(AtA, Atb)
}

/** Nearest rotation matrix (polar decomposition by Newton iteration). */
export function orthonormalize(R: Mat3): Mat3 {
  let X = R
  for (let i = 0; i < 20; i++) {
    const inv = inv3(X)
    if (!inv) return R
    const invT = transpose3(inv)
    const next = X.map((v, k) => 0.5 * (v + invT[k]))
    const delta = next.reduce((a, v, k) => a + Math.abs(v - X[k]), 0)
    X = next
    if (delta < 1e-14) break
  }
  return X
}

/** Rodrigues formula: rotation vector → matrix. */
export function expRotation(w: readonly number[]): Mat3 {
  const th = Math.hypot(w[0], w[1], w[2])
  if (th < 1e-12) return [1, 0, 0, 0, 1, 0, 0, 0, 1]
  const x = w[0] / th, y = w[1] / th, z = w[2] / th
  const c = Math.cos(th), s = Math.sin(th), t = 1 - c
  return [
    t * x * x + c, t * x * y - s * z, t * x * z + s * y,
    t * x * y + s * z, t * y * y + c, t * y * z - s * x,
    t * x * z - s * y, t * y * z + s * x, t * z * z + c,
  ]
}
