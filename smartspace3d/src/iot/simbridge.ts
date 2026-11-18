import type { SimSnapshot } from '@/simulation/types'
import type { DeviceConfig, SensorPoint, Space } from '@/types'
import { dutyForDevice } from './live'
import type { PlanPart } from './types'

export interface SensorSample { value: number; unit: '°C' | 'lx' }

/** What a sensor placed at its room coordinates measures in the shared simulation right now. */
export function sampleSensor(snap: SimSnapshot, space: Pick<Space, 'dims'>, sp: SensorPoint): SensorSample | null {
  if (sp.kind === 'presence') return null
  const ix = Math.min(snap.nx - 1, Math.max(0, Math.floor((sp.position[0] / space.dims.length) * snap.nx)))
  const iz = Math.min(snap.nz - 1, Math.max(0, Math.floor((sp.position[2] / space.dims.width) * snap.nz)))
  const i = iz * snap.nx + ix
  return sp.kind === 'temperature' ? { value: snap.temp[i], unit: '°C' } : { value: snap.lux[i], unit: 'lx' }
}

/** Duty (0…1) the shared simulation currently commands for the hardware output of this part (null when it represents no room device). */
export function commandedDuty(snap: SimSnapshot | null, space: Pick<Space, 'objects'>, part: PlanPart): number | null {
  const objId = part.virtual?.objectId
  if (!snap || !objId) return null
  const live = snap.devices.find((d) => d.id === objId)
  const obj = space.objects.find((o) => o.id === objId)
  if (!live || !obj?.device) return null
  const dev = obj.device as DeviceConfig
  return dutyForDevice(live, dev.type === 'light' ? 1 : dev.levels.length - 1)
}

export const TEMP_RANGE = [15, 45] as const
export const LUX_RANGE = [0, 2000] as const
