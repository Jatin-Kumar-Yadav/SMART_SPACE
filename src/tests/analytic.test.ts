import { describe, expect, it } from 'vitest'
import {
  airMass,
  exponentialTemperature,
  idealCoolingTime,
  integrateSingleZone,
  sensibleEnergy,
  singleZoneExponential,
  timeToReach,
} from '@/simulation/analytic'

describe('energy balance Q = m·Cp·ΔT', () => {
  it('reproduces the 10×8×3 m worked example', () => {
    const m = airMass(10 * 8 * 3, 1.2)
    expect(m).toBeCloseTo(288, 6)
    const q = sensibleEnergy(m, 32 - 24)
    expect(q).toBeCloseTo(2_315_520, 0)
    const t = idealCoolingTime(q, 3500, 1000)
    expect(t.kind).toBe('ok')
    if (t.kind === 'ok') {
      expect(t.seconds).toBeCloseTo(926.2, 1) // ≈ 15.4 min
      expect(t.seconds / 60).toBeCloseTo(15.4, 1)
    }
  })

  it('reports unreachable when gains exceed cooling', () => {
    expect(idealCoolingTime(1e6, 800, 1000).kind).toBe('unreachable')
  })
})

describe('exponential cooling T(t) = Tt + (Ti − Tt)·e^(−kt)', () => {
  it('starts at Tinit and approaches Ttarget', () => {
    expect(exponentialTemperature(0, 32, 22, 0.002)).toBeCloseTo(32)
    expect(exponentialTemperature(1e6, 32, 22, 0.002)).toBeCloseTo(22)
  })

  it('inverse formula returns the time at which the curve hits the desired value', () => {
    const k = 0.0021
    const est = timeToReach(26, 32, 20, k)
    expect(est.kind).toBe('ok')
    if (est.kind === 'ok') expect(exponentialTemperature(est.seconds, 32, 20, k)).toBeCloseTo(26, 6)
  })

  it('validates the inputs', () => {
    expect(timeToReach(20, 32, 20, 0.01).kind).toBe('asymptotic')
    expect(timeToReach(18, 32, 20, 0.01).kind).toBe('unreachable')
    expect(timeToReach(33, 32, 20, 0.01).kind).toBe('already')
    expect(timeToReach(25, 32, 20, -1).kind).toBe('invalid')
    // regression: room warming towards a hotter steady state must not report "already reached"
    expect(timeToReach(25, 32, 35, 0.01).kind).toBe('unreachable')
    expect(timeToReach(32, 32, 35, 0.01).kind).toBe('already')
    expect(timeToReach(25, 32, 20, Number.NaN).kind).toBe('invalid')
  })
})

describe('single-zone reduction', () => {
  const p = { ceff: 288 * 1005 * 6, ua: 150, gac: 152, outsideC: 35, supplyC: 12, gainW: 1000 }

  it('Euler integration of the energy balance follows the exponential solution', () => {
    const { tTarget, k } = singleZoneExponential(p)
    for (const t of [60, 600, 1800, 7200]) {
      const euler = integrateSingleZone(p, 32, t, 0.5)
      const exact = exponentialTemperature(t, 32, tTarget, k)
      expect(Math.abs(euler - exact)).toBeLessThan(0.02)
    }
  })

  it('steady state satisfies the balance', () => {
    const { tTarget } = singleZoneExponential(p)
    const q = p.gainW + p.ua * (p.outsideC - tTarget) - p.gac * (tTarget - p.supplyC)
    expect(q).toBeCloseTo(0, 6)
  })
})
