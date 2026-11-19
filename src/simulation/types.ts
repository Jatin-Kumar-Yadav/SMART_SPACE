import type { DeviceMode } from '@/types'

export interface ZoneInfo {
  id: number
  key: string
  cellCount: number
  area: number
  cx: number
  cz: number
  acIds: string[]
  fanIds: string[]
  lightIds: string[]
  sensorIds?: string[]
  deviceIds?: string[]
  /** thermal coverage of the zone as designed */
  coverage: 'cooled' | 'fan-only' | 'uncovered'
  /** 1-based index of the parent AC zone, or null if no ACs */
  acZoneId?: number | null
  /** assigned parent AC object ID, if any */
  acId?: string | null
  /** assigned parent AC name, if any */
  acName?: string | null
  /** assigned Fan object ID, if any */
  fanId?: string | null
  /** assigned Fan name, if any */
  fanName?: string | null
  /** 1-based subzone index within the parent AC zone, or null if no fan */
  fanSubzoneId?: number | null
  /** formatted relationship label, e.g. "AC 1 · Fan 1" or "AC Zone 1" */
  label?: string
}

export interface OccupantCoverage {
  occupantId: string
  cell: number
  zoneId: number
  acIds: string[]
  fanIds: string[]
  lightIds: string[]
  status: 'covered' | 'partial' | 'uncovered'
}

export interface ZoneStats {
  id: number
  occupants: number
  avgT: number
  avgPerceivedT: number
  minT: number
  maxT: number
  avgLux: number
  /** all occupants of the zone within tolerance of the target */
  comfortable: boolean
}

export interface DeviceLive {
  id: string
  type: 'fan' | 'ac' | 'light'
  mode: DeviceMode
  level: number
  on: boolean
  dimming: number
  powerW: number
  coolingW: number
}

export interface HistoryPoint {
  /** simulated seconds since start */
  t: number
  avgT: number
  minT: number
  maxT: number
  targetT: number
  avgLux: number
  /** mean illuminance over occupied cells (the quantity the lighting controller regulates) */
  occLux: number
  acPowerW: number
  coolingW: number
  fanLevel: number
  lightPowerW: number
  energyKWh: number
  outdoorLux: number
}

export interface ComfortStatus {
  averageTargetReached: boolean
  occupiedComfort: boolean
  uniform: boolean
  /** max − min perceived temperature across occupied zones (°C) */
  spread: number
}

export interface SimStats {
  time: number
  timeOfDay: number
  avgT: number
  minT: number
  maxT: number
  avgPerceivedT: number
  avgLux: number
  /** mean illuminance over occupied cells (equals avgLux when nobody is seated) */
  occLux: number
  outdoorLux: number
  occupants: number
  occupantHeatW: number
  coolingW: number
  acElectricW: number
  fanW: number
  lightW: number
  gainW: number
  energyKWh: number
  comfort: ComfortStatus
  /** single-zone estimates at the CURRENT device levels */
  estimate: {
    tTarget: number
    k: number
    toComfortSeconds: number | null
    toComfortNote: string
    toEquilibriumSeconds: number | null
  }
  warnings: string[]
}

export interface SimSnapshot {
  nx: number
  nz: number
  /** air temperature per cell */
  temp: Float32Array
  /** perceived (feels-like) temperature per cell */
  perceived: Float32Array
  /** total illuminance per cell, lux */
  lux: Float32Array
  natural: Float32Array
  artificial: Float32Array
  zoneIdByCell: Int16Array
  occupantsByCell: Uint8Array
  zones: ZoneInfo[]
  zoneStats: ZoneStats[]
  coverage: OccupantCoverage[]
  devices: DeviceLive[]
  stats: SimStats
  history: HistoryPoint[]
}
