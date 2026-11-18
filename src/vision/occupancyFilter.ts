/**
 * Temporal confirmation for seat occupancy.
 * A seat turns occupied only after it has been observed continuously for `confirmMs`, and turns
 * vacant only after it has gone unobserved for `clearMs`. Short gaps (≤ `gapMs`) in a detection
 * streak do not restart the confirmation. This is what prevents the 3D room from flickering when
 * the detector briefly loses someone.
 */
export interface FilterOptions {
  confirmMs: number
  clearMs: number
  gapMs: number
}

export const DEFAULT_FILTER: FilterOptions = { confirmMs: 1500, clearMs: 5000, gapMs: 1200 }

interface SeatState {
  occupied: boolean
  candidateSince: number | null
  lastSeen: number
}

export class SeatOccupancyFilter {
  private seats = new Map<string, SeatState>()
  private readonly opt: FilterOptions
  constructor(opt: FilterOptions = DEFAULT_FILTER) {
    this.opt = opt
  }

  reset() {
    this.seats.clear()
  }

  /** The committed occupied seats right now (does not advance time). */
  current(): Set<string> {
    return new Set([...this.seats].filter(([, s]) => s.occupied).map(([k]) => k))
  }

  /** Forget a seat immediately (a human corrected it). */
  release(key: string) {
    this.seats.delete(key)
  }

  /** Feed the seats observed occupied in this cycle; returns the committed occupied seat keys. */
  update(observed: ReadonlySet<string>, tMs: number): Set<string> {
    const o = this.opt
    for (const key of observed) {
      const s = this.seats.get(key) ?? { occupied: false, candidateSince: null, lastSeen: -Infinity }
      if (!s.occupied) {
        if (s.candidateSince === null || tMs - s.lastSeen > o.gapMs) s.candidateSince = tMs
        if (tMs - s.candidateSince >= o.confirmMs) {
          s.occupied = true
          s.candidateSince = null
        }
      }
      s.lastSeen = tMs
      this.seats.set(key, s)
    }
    for (const [key, s] of this.seats) {
      if (observed.has(key)) continue
      if (s.occupied && tMs - s.lastSeen >= o.clearMs) s.occupied = false
      if (!s.occupied && s.candidateSince !== null && tMs - s.lastSeen > o.gapMs) s.candidateSince = null
      if (!s.occupied && s.candidateSince === null && tMs - s.lastSeen > o.clearMs * 2) this.seats.delete(key)
    }
    return this.current()
  }
}
