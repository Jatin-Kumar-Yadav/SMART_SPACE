/**
 * Minimum-cost assignment (Kuhn–Munkres, O(n²m)). `cost` is n × m with any shape.
 * Returns, for each row, the assigned column or −1. Entries ≥ `forbidden` are never assigned.
 */
export function hungarian(cost: number[][], forbidden = 1e8): number[] {
  const n = cost.length
  const m = n ? cost[0].length : 0
  if (!n || !m) return new Array<number>(n).fill(-1)
  const transpose = n > m
  const N = transpose ? m : n
  const M = transpose ? n : m
  const c = (i: number, j: number) => (transpose ? cost[j][i] : cost[i][j])
  const INF = Infinity
  const u = new Array<number>(N + 1).fill(0)
  const v = new Array<number>(M + 1).fill(0)
  const p = new Array<number>(M + 1).fill(0)
  const way = new Array<number>(M + 1).fill(0)
  for (let i = 1; i <= N; i++) {
    p[0] = i
    let j0 = 0
    const minv = new Array<number>(M + 1).fill(INF)
    const used = new Array<boolean>(M + 1).fill(false)
    do {
      used[j0] = true
      const i0 = p[j0]
      let delta = INF
      let j1 = 0
      for (let j = 1; j <= M; j++) {
        if (used[j]) continue
        const cur = Math.min(c(i0 - 1, j - 1), forbidden) - u[i0] - v[j]
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0 }
        if (minv[j] < delta) { delta = minv[j]; j1 = j }
      }
      for (let j = 0; j <= M; j++) {
        if (used[j]) { u[p[j]] += delta; v[j] -= delta } else minv[j] -= delta
      }
      j0 = j1
    } while (p[j0] !== 0)
    do {
      const j1 = way[j0]
      p[j0] = p[j1]
      j0 = j1
    } while (j0)
  }
  const out = new Array<number>(n).fill(-1)
  for (let j = 1; j <= M; j++) {
    if (!p[j]) continue
    const row = transpose ? j - 1 : p[j] - 1
    const col = transpose ? p[j] - 1 : j - 1
    if (cost[row][col] < forbidden) out[row] = col
  }
  return out
}
