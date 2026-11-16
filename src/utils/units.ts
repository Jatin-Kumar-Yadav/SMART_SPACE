import type { LengthUnit } from '@/types'

const TO_M: Record<LengthUnit, number> = { m: 1, cm: 0.01, ft: 0.3048 }

/** Convert a user-entered value into metres (the internal unit). */
export const toMeters = (value: number, unit: LengthUnit) => value * TO_M[unit]
export const fromMeters = (meters: number, unit: LengthUnit) => meters / TO_M[unit]

export function formatLength(meters: number, unit: LengthUnit, digits = 2) {
  const v = fromMeters(meters, unit)
  return `${Number(v.toFixed(digits))} ${unit}`
}
