/**
 * Closed-form helpers for the thermal model.
 *
 *  • Energy balance:        Q = m · Cp · ΔT,   m = ρ · V
 *  • Idealised air-only:    t = Q / Pnet,      Pnet = Pcool − Pgain
 *  • Exponential approach:  T(t) = Ttarget + (Tinit − Ttarget) · e^(−k t)
 *  • Inverse:               t = −(1/k) · ln((Tdes − Ttarget)/(Tinit − Ttarget))
 */

export const CP_AIR = 1005 // J/(kg·K)
export const RHO_AIR = 1.2 // kg/m³

export const airMass = (volumeM3: number, density = RHO_AIR) => density * volumeM3

/** Energy (J) that must be removed from `massKg` of air to change its temperature by `deltaT`. */
export const sensibleEnergy = (massKg: number, deltaT: number, cp = CP_AIR) => massKg * cp * deltaT

export type TimeEstimate =
  | { kind: 'ok'; seconds: number }
  | { kind: 'already'; seconds: 0 }
  | { kind: 'asymptotic'; message: string }
  | { kind: 'unreachable'; message: string }
  | { kind: 'invalid'; message: string }

/** t = Q / Pnet. Only meaningful for positive, roughly constant net cooling power. */
export function idealCoolingTime(energyJ: number, coolingW: number, gainW: number): TimeEstimate {
  const net = coolingW - gainW
  if (!Number.isFinite(energyJ) || !Number.isFinite(net)) return { kind: 'invalid', message: 'Inputs must be finite numbers.' }
  if (energyJ <= 0) return { kind: 'already', seconds: 0 }
  if (net <= 0) {
    return { kind: 'unreachable', message: 'Net cooling power is not positive: heat gains exceed cooling capacity.' }
  }
  return { kind: 'ok', seconds: energyJ / net }
}

export const exponentialTemperature = (t: number, tInit: number, tTarget: number, k: number) =>
  tTarget + (tInit - tTarget) * Math.exp(-k * t)

/**
 * Time for the exponential model to reach `tDesired`.
 * For ordinary cooling (tInit > tTarget) tDesired must lie strictly between
 * tTarget and tInit for a finite, positive time.
 */
export function timeToReach(tDesired: number, tInit: number, tTarget: number, k: number): TimeEstimate {
  if (![tDesired, tInit, tTarget, k].every(Number.isFinite)) return { kind: 'invalid', message: 'Inputs must be finite numbers.' }
  if (k <= 0) return { kind: 'invalid', message: 'The rate constant k must be positive.' }
  if (tInit === tTarget) {
    return tDesired === tInit
      ? { kind: 'already', seconds: 0 }
      : { kind: 'unreachable', message: 'The room already sits at its steady-state temperature.' }
  }
  const ratio = (tDesired - tTarget) / (tInit - tTarget)
  if (ratio >= 1) {
    // Desired lies beyond the initial value, on the side away from the steady state.
    // Cooling run (steady state below start): the room is already past the desired value.
    // Warming run (steady state above start): the room is drifting AWAY from it.
    if (ratio === 1 || tTarget < tInit) return { kind: 'already', seconds: 0 }
    return {
      kind: 'unreachable',
      message: `Unreachable: the room is drifting towards ${tTarget.toFixed(1)} °C, away from the desired value.`,
    }
  }
  if (ratio === 0) return { kind: 'asymptotic', message: 'The desired temperature equals the steady-state value; it is approached asymptotically and never reached in finite time.' }
  if (ratio < 0) {
    return {
      kind: 'unreachable',
      message: `Unreachable: the current devices can only bring the room to ${tTarget.toFixed(1)} °C.`,
    }
  }
  return { kind: 'ok', seconds: -Math.log(ratio) / k }
}

export interface SingleZoneParams {
  /** effective thermal capacitance (J/K) */
  ceff: number
  /** envelope conductance (W/K) */
  ua: number
  /** AC conductance towards its supply temperature (W/K): Q_cool = gac·(T − Tsupply) */
  gac: number
  outsideC: number
  supplyC: number
  /** internal gains: occupants + lights + equipment + solar (W) */
  gainW: number
}

/**
 * Reduce the linear balance  Ceff·dT/dt = gain + UA(Tout−T) − Gac(T−Tsup)
 * to the exponential form, giving Ttarget (steady state) and k (1/s).
 */
export function singleZoneExponential(p: SingleZoneParams): { tTarget: number; k: number } {
  const g = p.ua + p.gac
  if (g <= 0 || p.ceff <= 0) return { tTarget: Infinity, k: 0 }
  return {
    tTarget: (p.gainW + p.ua * p.outsideC + p.gac * p.supplyC) / g,
    k: g / p.ceff,
  }
}

/** Forward-Euler integration of the single-zone balance (used to validate the closed form). */
export function integrateSingleZone(p: SingleZoneParams, tInit: number, seconds: number, dt = 1): number {
  let T = tInit
  const steps = Math.round(seconds / dt)
  for (let i = 0; i < steps; i++) {
    const q = p.gainW + p.ua * (p.outsideC - T) - p.gac * (T - p.supplyC)
    T += (dt / p.ceff) * q
  }
  return T
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return '—'
  if (seconds < 90) return `${Math.round(seconds)} s`
  const m = seconds / 60
  if (m < 120) return `${m.toFixed(1)} min`
  return `${(m / 60).toFixed(1)} h`
}
