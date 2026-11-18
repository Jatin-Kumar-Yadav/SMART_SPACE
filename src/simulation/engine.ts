import type { AcDevice, DeviceMode, FanDevice, LightDevice, Occupant, Scenario, SceneObject, Space } from '@/types'
import { clamp } from '@/utils/math'
import { airMass, CP_AIR, singleZoneExponential, timeToReach } from './analytic'
import { buildGrid, cellAt, type SimGrid } from './grid'
import { COVERAGE_MIN, currentLevel, influenceField, isAirDevice, maxLevel, type AirDevice } from './influence'
import { emitterPosition, isLight, lightUnitField, outdoorLux, solarFlux, windowHeatWeights, windowUnitField } from './lighting'
import { spaceWithScenario } from './scenario'
import type { ComfortStatus, DeviceLive, HistoryPoint, OccupantCoverage, SimSnapshot, SimStats, ZoneInfo, ZoneStats } from './types'
import { analyseCoverage, buildZones, lightReach, type FieldRef } from './zones'

/** Rated return-air temperature at which nominal AC capacity is quoted. */
export const AC_RATED_RETURN_C = 35
const NATURAL_MIX_VELOCITY = 0.05 // m/s of background air mixing
const SUBSTEP_SAFETY = 0.4
const CHUNK = 5 // simulated seconds per integration chunk
const FAN_INTERVAL = 30
const AC_INTERVAL = 90
const LIGHT_INTERVAL = 20
const HISTORY_INTERVAL = 30
const MAX_HISTORY = 1200

interface DevState {
  id: string
  obj: SceneObject
  type: 'fan' | 'ac' | 'light'
  mode: DeviceMode
  level: number
  on: boolean
  dimming: number
  lastChange: number
}

export interface DevicePatch {
  mode?: DeviceMode
  level?: number
  on?: boolean
  dimming?: number
}

/**
 * Environmental simulation: a lumped multi-cell energy balance
 *
 *   C_i · dT_i/dt = Q_gain,i + G_env,i (T_out − T_i) − g_ac,i (T_i − T_sup)
 *                   + Σ_j G_ij (T_j − T_i)
 *
 * With uniform temperatures this reduces exactly to the single-zone exponential
 * T(t) = T_target + (T_init − T_target)·e^(−k t), k = (UA + G_ac)/C_eff.
 */
export class SimEngine {
  grid!: SimGrid
  space!: Space
  scenario!: Scenario
  time = 0
  T!: Float64Array
  history: HistoryPoint[] = []
  energyJ = 0

  private objs: SceneObject[] = []
  private states = new Map<string, DevState>()
  private lights: (SceneObject & { device: LightDevice })[] = []
  private fans: SceneObject[] = []
  private acs: SceneObject[] = []
  private windows: SceneObject[] = []
  private occupants: Occupant[] = []
  private occCell: number[] = []
  private occCount!: Uint8Array

  private fieldCache = new Map<string, Float32Array>()
  private lightUnit = new Map<string, Float32Array>()
  private lightCover: FieldRef[] = []
  private windowUnit = new Map<string, Float32Array>()
  private windowHeat = new Map<string, Float32Array>()

  // per-cell dynamic data
  private cap!: Float64Array
  private genv!: Float64Array
  private gvent!: Float64Array
  private gacSum!: Float64Array
  private gacSup!: Float64Array
  private gainStatic!: Float64Array
  private gainDevice!: Float64Array
  private solarW!: Float64Array
  private velEast!: Float32Array
  private velSouth!: Float32Array
  private offsetFan!: Float32Array
  private offsetAc!: Float32Array
  private artificial!: Float32Array
  private natural!: Float32Array
  /** live-sensor correction of the daylight estimate (lux per cell); zero unless a light sensor reported */
  private luxBias!: Float32Array
  private zoneIdByCell!: Int16Array
  private zones: ZoneInfo[] = []
  private coverage: OccupantCoverage[] = []
  private dtMax = 1
  private ua = 0
  private ceff = 1
  private dirty = true
  private lastLevelsKey = ''
  private lastHistory = -Infinity
  private lastLightCtl = -Infinity
  private lastSolar = -Infinity
  private outLux = 0
  private warnings: string[] = []
  private potential = new Map<string, { cells: number[]; weights: number[] }>()
  private deviceLive: DeviceLive[] = []
  private coolingW = 0

  constructor(space: Space, scenario: Scenario) {
    this.build(space, scenario)
    this.reset()
  }

  // ───────────────────────── construction ─────────────────────────

  /** (Re)build every static structure from the layout. */
  private build(space: Space, scenario: Scenario) {
    this.space = space
    this.scenario = scenario
    const eff = spaceWithScenario(space, scenario)
    this.objs = eff.objects
    this.grid = buildGrid(space, scenario.sim.resolution)
    const g = this.grid
    this.warnings = [...g.warnings]
    this.fieldCache.clear()
    this.lightUnit.clear()
    this.windowUnit.clear()
    this.windowHeat.clear()
    this.potential.clear()

    this.fans = this.objs.filter((o) => o.device?.type === 'fan' && o.visible)
    this.acs = this.objs.filter((o) => o.device?.type === 'ac' && o.visible)
    this.lights = this.objs.filter((o): o is SceneObject & { device: LightDevice } => isLight(o) && o.visible)
    this.windows = this.objs.filter((o) => o.kind === 'window' && !!o.window && o.visible)

    const prev = this.states
    this.states = new Map()
    for (const o of [...this.fans, ...this.acs, ...this.lights]) {
      const d = o.device!
      const old = prev.get(o.id)
      this.states.set(o.id, {
        id: o.id,
        obj: o,
        type: d.type,
        mode: old?.mode ?? d.mode,
        level: d.type === 'light' ? 0 : old?.level ?? d.level,
        on: d.type === 'light' ? old?.on ?? d.on : true,
        dimming: d.type === 'light' ? old?.dimming ?? d.dimming : 1,
        lastChange: old?.lastChange ?? -Infinity,
      })
      if (old) {
        // keep the live (controller-driven) state of devices that already existed
      } else if (d.type === 'light') {
        const s = this.states.get(o.id)!
        s.on = d.on
        s.dimming = d.dimming
      }
    }

    this.occupants = scenario.occupants.filter((o) => this.objs.some((x) => x.id === o.objectId))
    this.occCell = this.occupants.map((o) => cellAt(g, o.position[0], o.position[2]))
    this.occCount = new Uint8Array(g.count)
    for (const c of this.occCell) this.occCount[c] = Math.min(255, this.occCount[c] + 1)

    for (const l of this.lights) {
      const unit = lightUnitField(g, l)
      this.lightUnit.set(l.id, unit)
    }
    this.lightCover = this.lights.map((l) => ({ id: l.id, field: lightReach(this.lightUnit.get(l.id)!) }))
    for (const w of this.windows) {
      this.windowUnit.set(w.id, windowUnitField(g, w))
      this.windowHeat.set(w.id, windowHeatWeights(g, w))
    }

    // thermal constants
    const { length, width, height } = space.dims
    const volume = length * width * height
    const s = scenario.sim
    this.ceff = s.ceffOverride && s.ceffOverride > 0 ? s.ceffOverride : airMass(volume, s.airDensity) * CP_AIR * s.thermalMassMultiplier
    this.ua = s.envelopeU * (2 * (length + width) * height + length * width)
    this.cap = new Float64Array(g.count).fill((this.ceff * g.cellArea) / (length * width))
    this.genv = new Float64Array(g.count).fill(this.ua / g.count)
    this.gvent = new Float64Array(g.count)
    this.gacSum = new Float64Array(g.count)
    this.gacSup = new Float64Array(g.count)
    this.gainStatic = new Float64Array(g.count)
    this.gainDevice = new Float64Array(g.count)
    this.solarW = new Float64Array(g.count)
    this.velEast = new Float32Array(g.count)
    this.velSouth = new Float32Array(g.count)
    this.offsetFan = new Float32Array(g.count)
    this.offsetAc = new Float32Array(g.count)
    this.artificial = new Float32Array(g.count)
    this.natural = new Float32Array(g.count)
    this.luxBias = new Float32Array(g.count)
    this.zoneIdByCell = new Int16Array(g.count)

    for (let i = 0; i < this.occupants.length; i++) this.gainStatic[this.occCell[i]] += this.occupants[i].heatW
    const eq = s.equipmentW / g.count
    for (let i = 0; i < g.count; i++) this.gainStatic[i] += eq

    this.dirty = true
    this.lastLevelsKey = ''
    this.lastLightCtl = -Infinity
    this.lastSolar = -Infinity
    // daylight is a function of the scenario clock only, so it is valid before the first step
    this.updateDaylight()
  }

  /** Reset temperatures, time and history to the scenario's initial conditions. */
  reset() {
    this.time = 0
    this.energyJ = 0
    this.history = []
    this.lastHistory = -Infinity
    this.T = new Float64Array(this.grid.count).fill(this.scenario.initialTempC)
    for (const st of this.states.values()) {
      const d = st.obj.device!
      st.mode = d.mode
      st.lastChange = -Infinity
      if (d.type === 'light') {
        st.on = d.on
        st.dimming = d.dimming
      } else {
        st.level = d.level
      }
    }
    this.dirty = true
    this.lastLevelsKey = ''
    this.lastLightCtl = -Infinity
    this.lastSolar = -Infinity
    this.luxBias.fill(0)
    this.updateDaylight()
    this.refreshDynamics()
    this.recordHistory(true)
  }

  /** Apply a changed layout / scenario while keeping temperatures when the grid is unchanged. */
  rebuild(space: Space, scenario: Scenario) {
    const old = this.grid
    const oldT = this.T
    const initialChanged = scenario.initialTempC !== this.scenario.initialTempC
    this.build(space, scenario)
    if (old.nx === this.grid.nx && old.nz === this.grid.nz && !initialChanged) {
      this.T = oldT
      this.refreshDynamics()
    } else {
      this.reset()
    }
  }

  setDevice(id: string, patch: DevicePatch) {
    const st = this.states.get(id)
    if (!st) return
    if (patch.mode !== undefined) st.mode = patch.mode
    if (patch.level !== undefined) st.level = clamp(Math.round(patch.level), 0, (st.obj.device as AirDevice).levels.length - 1)
    if (patch.on !== undefined) st.on = patch.on
    if (patch.dimming !== undefined) st.dimming = clamp(patch.dimming, 0, 1)
    st.lastChange = this.time
    this.dirty = true
  }

  // ───────────────────────── field caches ─────────────────────────

  private field(obj: SceneObject, level: number): Float32Array {
    const key = `${obj.id}:${level}`
    let f = this.fieldCache.get(key)
    if (!f) {
      const d = obj.device as AirDevice
      f = influenceField(this.grid, obj, d.levels[clamp(level, 0, d.levels.length - 1)])
      this.fieldCache.set(key, f)
    }
    return f
  }

  /** Cells (and weights) a device could influence at its strongest setting, for controller decisions. */
  private potentialOf(obj: SceneObject) {
    let p = this.potential.get(obj.id)
    if (!p) {
      const d = obj.device as AirDevice
      const f = this.field(obj, d.levels.length - 1)
      const cells: number[] = []
      const weights: number[] = []
      const anyOcc = this.occupants.length > 0
      for (let i = 0; i < f.length; i++) {
        if (f[i] <= COVERAGE_MIN) continue
        if (anyOcc && this.occCount[i] === 0) continue
        cells.push(i)
        weights.push(f[i] * (anyOcc ? this.occCount[i] : 1))
      }
      p = { cells, weights }
      this.potential.set(obj.id, p)
    }
    return p
  }

  // ───────────────────────── dynamics refresh ─────────────────────────

  private levelsKey() {
    return [...this.states.values()].map((s) => `${s.id}:${s.level}:${s.on ? 1 : 0}:${s.dimming.toFixed(2)}`).join('|') +
      this.windows.map((w) => (w.window!.open ? 1 : 0)).join('')
  }

  /** Recompute everything that depends on device levels (influence, conductances, zones). */
  private refreshDynamics() {
    const g = this.grid
    const s = this.scenario.sim
    this.lastLevelsKey = this.levelsKey()
    this.dirty = false
    this.gacSum.fill(0)
    this.gacSup.fill(0)
    this.velEast.fill(NATURAL_MIX_VELOCITY)
    this.velSouth.fill(NATURAL_MIX_VELOCITY)
    this.offsetFan.fill(0)
    this.offsetAc.fill(0)
    this.gainDevice.fill(0)
    this.gvent.fill(0)
    const rhoCp = s.airDensity * CP_AIR

    const acRefs: FieldRef[] = []
    const fanRefs: FieldRef[] = []
    const live: DeviceLive[] = []

    const addVel = (f: Float32Array, v: number) => {
      for (let iz = 0; iz < g.nz; iz++) {
        for (let ix = 0; ix < g.nx; ix++) {
          const i = iz * g.nx + ix
          if (ix + 1 < g.nx) this.velEast[i] += 0.5 * (f[i] + f[i + 1]) * v
          if (iz + 1 < g.nz) this.velSouth[i] += 0.5 * (f[i] + f[i + g.nx]) * v
        }
      }
    }

    for (const o of this.fans) {
      const st = this.states.get(o.id)!
      const d = o.device as FanDevice
      const lvl = d.levels[st.level] ?? d.levels[0]
      const f = this.field(o, st.level)
      fanRefs.push({ id: o.id, field: st.level > 0 ? f : new Float32Array(g.count) })
      if (st.level > 0) {
        addVel(f, lvl.airflow)
        for (let i = 0; i < g.count; i++) this.offsetFan[i] = Math.max(this.offsetFan[i], f[i] * lvl.effectC)
        this.gainDevice[cellAt(g, o.position[0], o.position[2])] += lvl.powerW * 0.9 // motor heat
      }
      live.push({ id: o.id, type: 'fan', mode: st.mode, level: st.level, on: st.level > 0, dimming: 1, powerW: lvl.powerW, coolingW: 0 })
    }

    for (const o of this.acs) {
      const st = this.states.get(o.id)!
      const d = o.device as AcDevice
      const lvl = d.levels[st.level] ?? d.levels[0]
      const f = this.field(o, st.level)
      acRefs.push({ id: o.id, field: st.level > 0 ? f : new Float32Array(g.count) })
      if (st.level > 0) {
        addVel(f, lvl.airflow)
        if (s.educationalAcOffset) for (let i = 0; i < g.count; i++) this.offsetAc[i] = Math.max(this.offsetAc[i], f[i] * lvl.effectC)
        // conductance towards the supply temperature: Q = G·(T − Tsup), G = frac·Pnom/(Trated − Tsup)
        const gTotal = (d.capacityW * lvl.coolingFrac) / Math.max(1, AC_RATED_RETURN_C - d.supplyTempC)
        let sum = 0
        for (let i = 0; i < g.count; i++) sum += f[i]
        for (let i = 0; i < g.count; i++) {
          const w = sum > 0 ? f[i] / sum : 1 / g.count
          const gi = gTotal * w
          this.gacSum[i] += gi
          this.gacSup[i] += gi * d.supplyTempC
        }
      }
      live.push({ id: o.id, type: 'ac', mode: st.mode, level: st.level, on: st.level > 0, dimming: 1, powerW: lvl.powerW, coolingW: 0 })
    }

    for (const o of this.lights) {
      const st = this.states.get(o.id)!
      const d = o.device
      const p = st.on ? d.powerW * st.dimming : 0
      if (p > 0) {
        const em = emitterPosition(o)
        this.gainDevice[cellAt(g, em[0], em[2])] += p * 0.95
      }
      live.push({ id: o.id, type: 'light', mode: st.mode, level: 0, on: st.on && st.dimming > 0, dimming: st.dimming, powerW: p, coolingW: 0 })
    }

    for (const w of this.windows) {
      if (!w.window!.open) continue
      const gw = rhoCp * 0.05 * w.dims[0] * w.dims[1]
      const wt = this.windowHeat.get(w.id)!
      for (let i = 0; i < g.count; i++) this.gvent[i] += gw * wt[i]
    }

    // artificial light
    this.artificial.fill(0)
    for (const l of this.lights) {
      const st = this.states.get(l.id)!
      if (!st.on || st.dimming <= 0) continue
      const u = this.lightUnit.get(l.id)!
      for (let i = 0; i < g.count; i++) this.artificial[i] += u[i] * st.dimming
    }

    // stability limit for the explicit integrator
    let worst = 0
    for (let iz = 0; iz < g.nz; iz++) {
      for (let ix = 0; ix < g.nx; ix++) {
        const i = iz * g.nx + ix
        let gsum = this.genv[i] + this.gvent[i] + this.gacSum[i]
        const faceX = g.dz * g.height
        const faceZ = g.dx * g.height
        if (ix + 1 < g.nx) gsum += rhoCp * faceX * this.velEast[i] * g.linkEast[i]
        if (ix > 0) gsum += rhoCp * faceX * this.velEast[i - 1] * g.linkEast[i - 1]
        if (iz + 1 < g.nz) gsum += rhoCp * faceZ * this.velSouth[i] * g.linkSouth[i]
        if (iz > 0) gsum += rhoCp * faceZ * this.velSouth[i - g.nx] * g.linkSouth[i - g.nx]
        worst = Math.max(worst, gsum / this.cap[i])
      }
    }
    this.dtMax = worst > 0 ? Math.max(0.05, SUBSTEP_SAFETY / worst) : 10

    // zones from the CURRENT reach of the devices
    const z = buildZones(g, acRefs, fanRefs, this.lightCover)
    this.zones = z.zones
    this.zoneIdByCell = z.zoneIdByCell
    this.coverage = analyseCoverage(g, this.occupants, z.zoneIdByCell, acRefs, fanRefs, this.lightCover)
    this.deviceLive = live
  }

  private updateDaylight() {
    const g = this.grid
    const l = { ...this.scenario.lighting, timeOfDay: (this.scenario.lighting.timeOfDay + this.time / 3600) % 24 }
    this.outLux = outdoorLux(l)
    this.natural.fill(0)
    for (const w of this.windows) {
      const u = this.windowUnit.get(w.id)!
      for (let i = 0; i < g.count; i++) this.natural[i] += u[i] * this.outLux
    }
    for (let i = 0; i < g.count; i++) if (this.luxBias[i] !== 0) this.natural[i] = Math.max(0, this.natural[i] + this.luxBias[i])
    // solar gain
    this.solarW.fill(0)
    const flux = solarFlux(l)
    if (flux > 0) {
      for (const w of this.windows) {
        const win = w.window!
        const q = w.dims[0] * w.dims[1] * win.shgc * (1 - clamp(win.shading, 0, 1)) * flux * 0.6
        const wt = this.windowHeat.get(w.id)!
        for (let i = 0; i < g.count; i++) this.solarW[i] += q * wt[i]
      }
    }
    this.lastSolar = this.time
  }

  // ───────────────────────── live sensor assimilation ─────────────────────────

  /** Cells of the zone that contains the world point (x, z), or [] when no zone is known there. */
  private zoneCells(x: number, z: number): number[] {
    const g = this.grid
    const c = cellAt(g, x, z)
    const id = this.zoneIdByCell[c]
    const out: number[] = []
    for (let i = 0; i < g.count; i++) if (this.zoneIdByCell[i] === id) out.push(i)
    return out.length ? out : [c]
  }

  /**
   * A physical temperature sensor reported `tempC` at (x, z): set the air temperature of the whole
   * zone that contains the sensor to the measurement. The model keeps evolving from that value.
   * Returns the number of cells that were updated.
   */
  assimilateTemperature(x: number, z: number, tempC: number): number {
    if (!Number.isFinite(tempC)) return 0
    const cells = this.zoneCells(x, z)
    for (const i of cells) this.T[i] = tempC
    return cells.length
  }

  /**
   * A physical light sensor reported `lux` at (x, z): shift the daylight estimate of that zone by
   * the difference, so natural + artificial matches the measurement. Artificial light is still
   * computed from the lamps' own dimming, so the lighting controller reacts to what was measured.
   */
  assimilateLux(x: number, z: number, lux: number): number {
    if (!Number.isFinite(lux) || lux < 0) return 0
    const cells = this.zoneCells(x, z)
    let mean = 0
    for (const i of cells) mean += this.natural[i] + this.artificial[i]
    mean /= cells.length
    const delta = lux - mean
    for (const i of cells) {
      this.luxBias[i] += delta
      this.natural[i] = Math.max(0, this.natural[i] + delta)
    }
    return cells.length
  }

  // ───────────────────────── stepping ─────────────────────────

  /** Advance the simulation by `seconds` of simulated time. */
  advance(seconds: number) {
    let remaining = seconds
    while (remaining > 1e-9) {
      const dt = Math.min(CHUNK, remaining)
      this.stepChunk(dt)
      remaining -= dt
    }
  }

  private stepChunk(dt: number) {
    if (this.time - this.lastSolar >= 60) this.updateDaylight()
    if (this.levelsKey() !== this.lastLevelsKey || this.dirty) this.refreshDynamics()
    this.controlLights()
    this.controlAir()
    if (this.levelsKey() !== this.lastLevelsKey || this.dirty) this.refreshDynamics()
    this.integrate(dt)
    this.accumulateEnergy(dt)
    this.time += dt
    if (this.time - this.lastHistory >= HISTORY_INTERVAL) this.recordHistory()
  }

  private integrate(dt: number) {
    const g = this.grid
    const rhoCp = this.scenario.sim.airDensity * CP_AIR
    const tOut = this.scenario.outsideTempC
    const sub = Math.max(1, Math.ceil(dt / this.dtMax))
    const h = dt / sub
    const faceX = g.dz * g.height
    const faceZ = g.dx * g.height
    const T = this.T
    const next = new Float64Array(g.count)
    let cooling = 0
    for (let s = 0; s < sub; s++) {
      cooling = 0
      for (let iz = 0; iz < g.nz; iz++) {
        for (let ix = 0; ix < g.nx; ix++) {
          const i = iz * g.nx + ix
          const Ti = T[i]
          let q = this.gainStatic[i] + this.gainDevice[i] + this.solarW[i]
          q += (this.genv[i] + this.gvent[i]) * (tOut - Ti)
          const qc = this.gacSum[i] * Ti - this.gacSup[i]
          q -= qc
          cooling += qc
          if (ix + 1 < g.nx) q += rhoCp * faceX * this.velEast[i] * g.linkEast[i] * (T[i + 1] - Ti)
          if (ix > 0) q += rhoCp * faceX * this.velEast[i - 1] * g.linkEast[i - 1] * (T[i - 1] - Ti)
          if (iz + 1 < g.nz) q += rhoCp * faceZ * this.velSouth[i] * g.linkSouth[i] * (T[i + g.nx] - Ti)
          if (iz > 0) q += rhoCp * faceZ * this.velSouth[i - g.nx] * g.linkSouth[i - g.nx] * (T[i - g.nx] - Ti)
          next[i] = Ti + (h / this.cap[i]) * q
        }
      }
      T.set(next)
    }
    this.coolingW = cooling
  }

  private accumulateEnergy(dt: number) {
    let p = 0
    for (const d of this.deviceLive) p += d.powerW
    this.energyJ += p * dt
  }

  // ───────────────────────── controllers ─────────────────────────

  private perceived(i: number): number {
    return this.T[i] - this.offsetFan[i] - this.offsetAc[i]
  }

  /**
   * Rule-based fan / AC controller with a dead-band and minimum switching intervals.
   * A shared device looks at ALL occupied cells it can reach before moving: it only
   * rises when nobody is cold and it only falls when nobody is hot, and it
   * always falls if any occupant is badly over-cooled.
   */
  private controlAir() {
    const tol = this.scenario.sim.toleranceC
    const target = this.scenario.targetTempC
    for (const o of [...this.fans, ...this.acs]) {
      const st = this.states.get(o.id)!
      if (st.mode !== 'auto') continue
      const d = o.device as AirDevice
      const interval = d.type === 'fan' ? FAN_INTERVAL : AC_INTERVAL
      if (this.time - st.lastChange < interval) continue
      const { cells, weights } = this.potentialOf(o)
      let want = st.level
      if (cells.length === 0) {
        want = 0 // nobody it could serve
      } else {
        let wsum = 0
        let acc = 0
        let hot = -Infinity
        let cold = Infinity
        for (let k = 0; k < cells.length; k++) {
          const i = cells[k]
          const used = d.type === 'fan' ? this.perceived(i) : this.T[i] - this.offsetAc[i]
          const err = used - target
          acc += err * weights[k]
          wsum += weights[k]
          if (err > hot) hot = err
          if (err < cold) cold = err
        }
        const mean = wsum > 0 ? acc / wsum : 0
        if (cold < -2 * tol) want = st.level - 1
        else if (mean > tol || hot > 2 * tol) want = st.level + 1
        else if (mean < -tol) want = st.level - 1
      }
      want = clamp(want, 0, d.levels.length - 1)
      if (want !== st.level) {
        st.level = want
        st.lastChange = this.time
        this.dirty = true
      }
    }
  }

  /**
   * Daylight harvesting: a Gauss–Seidel least-squares step per luminaire driving the
   * illuminance of the occupied cells it reaches towards the target (with dimming).
   */
  private controlLights() {
    if (!this.scenario.autoLighting || this.time - this.lastLightCtl < LIGHT_INTERVAL) return
    this.lastLightCtl = this.time
    const target = this.scenario.targetLux
    const g = this.grid
    const anyOcc = this.occupants.length > 0
    const total = new Float32Array(g.count)
    for (let i = 0; i < g.count; i++) total[i] = this.natural[i] + this.artificial[i]
    let changed = false
    for (const l of this.lights) {
      const st = this.states.get(l.id)!
      if (st.mode !== 'auto') continue
      const u = this.lightUnit.get(l.id)!
      let peak = 0
      for (const v of u) if (v > peak) peak = v
      let num = 0
      let den = 0
      for (let i = 0; i < g.count; i++) {
        if (u[i] < peak * 0.1) continue
        if (anyOcc && this.occCount[i] === 0) continue
        num += u[i] * (target - total[i])
        den += u[i] * u[i]
      }
      if (den <= 0) {
        if (st.on || st.dimming !== 0) {
          for (let i = 0; i < g.count; i++) total[i] -= u[i] * (st.on ? st.dimming : 0)
          st.on = false
          changed = true
        }
        continue
      }
      const cur = st.on ? st.dimming : 0
      let dim = clamp(cur + 0.7 * (num / den), 0, 1)
      if (dim < 0.03) dim = 0
      if (Math.abs(dim - cur) < 0.005) continue
      for (let i = 0; i < g.count; i++) total[i] += u[i] * (dim - cur)
      st.on = dim > 0
      st.dimming = dim
      changed = true
    }
    if (changed) this.dirty = true
  }

  // ───────────────────────── outputs ─────────────────────────

  private recordHistory(initial = false) {
    const s = this.computeStats()
    const fanLevels = this.deviceLive.filter((d) => d.type === 'fan')
    const pt: HistoryPoint = {
      t: this.time,
      avgT: s.avgT,
      minT: s.minT,
      maxT: s.maxT,
      targetT: this.scenario.targetTempC,
      avgLux: s.avgLux,
      occLux: s.occLux,
      acPowerW: s.acElectricW,
      coolingW: s.coolingW,
      fanLevel: fanLevels.length ? fanLevels.reduce((a, d) => a + d.level, 0) / fanLevels.length : 0,
      lightPowerW: s.lightW,
      energyKWh: s.energyKWh,
      outdoorLux: s.outdoorLux,
    }
    if (initial) this.history = []
    this.history.push(pt)
    if (this.history.length > MAX_HISTORY) this.history.splice(1, this.history.length - MAX_HISTORY)
    this.lastHistory = this.time
  }

  private zoneStats(): ZoneStats[] {
    const tol = this.scenario.sim.toleranceC
    const target = this.scenario.targetTempC
    const acc = new Map<number, { n: number; sT: number; sP: number; mn: number; mx: number; lux: number; occ: number; ok: boolean }>()
    for (const z of this.zones) acc.set(z.id, { n: 0, sT: 0, sP: 0, mn: Infinity, mx: -Infinity, lux: 0, occ: 0, ok: true })
    for (let i = 0; i < this.grid.count; i++) {
      const a = acc.get(this.zoneIdByCell[i])
      if (!a) continue
      const t = this.T[i]
      a.n++
      a.sT += t
      a.sP += this.perceived(i)
      a.mn = Math.min(a.mn, t)
      a.mx = Math.max(a.mx, t)
      a.lux += this.natural[i] + this.artificial[i]
    }
    this.occCell.forEach((c) => {
      const a = acc.get(this.zoneIdByCell[c])
      if (!a) return
      a.occ++
      if (Math.abs(this.perceived(c) - target) > tol) a.ok = false
    })
    return [...acc.entries()].map(([id, a]) => ({
      id,
      occupants: a.occ,
      avgT: a.n ? a.sT / a.n : 0,
      avgPerceivedT: a.n ? a.sP / a.n : 0,
      minT: a.mn,
      maxT: a.mx,
      avgLux: a.n ? a.lux / a.n : 0,
      comfortable: a.occ > 0 ? a.ok : true,
    }))
  }

  private computeStats(): SimStats {
    const g = this.grid
    const tol = this.scenario.sim.toleranceC
    const target = this.scenario.targetTempC
    let sT = 0
    let sP = 0
    let mn = Infinity
    let mx = -Infinity
    let sL = 0
    for (let i = 0; i < g.count; i++) {
      const t = this.T[i]
      sT += t
      sP += this.perceived(i)
      mn = Math.min(mn, t)
      mx = Math.max(mx, t)
      sL += this.natural[i] + this.artificial[i]
    }
    const avgT = sT / g.count
    let occLuxSum = 0
    this.occCell.forEach((c) => { occLuxSum += this.natural[c] + this.artificial[c] })
    const occLux = this.occCell.length ? occLuxSum / this.occCell.length : sL / g.count
    const zs = this.zoneStats()
    const occupied = zs.filter((z) => z.occupants > 0)
    const spread = occupied.length > 1 ? Math.max(...occupied.map((z) => z.avgPerceivedT)) - Math.min(...occupied.map((z) => z.avgPerceivedT)) : 0
    const occComfort = this.occupants.length
      ? this.occCell.every((c) => Math.abs(this.perceived(c) - target) <= tol)
      : Math.abs(sP / g.count - target) <= tol
    const comfort: ComfortStatus = {
      averageTargetReached: Math.abs(avgT - target) <= tol,
      occupiedComfort: occComfort,
      uniform: spread <= 2 * tol,
      spread,
    }
    const dl = this.deviceLive
    const acElectricW = dl.filter((d) => d.type === 'ac').reduce((a, d) => a + d.powerW, 0)
    const fanW = dl.filter((d) => d.type === 'fan').reduce((a, d) => a + d.powerW, 0)
    const lightW = dl.filter((d) => d.type === 'light').reduce((a, d) => a + d.powerW, 0)
    const occupantHeatW = this.occupants.reduce((a, o) => a + o.heatW, 0)
    let gain = 0
    for (let i = 0; i < g.count; i++) gain += this.gainStatic[i] + this.gainDevice[i] + this.solarW[i]

    // single-zone estimate at current levels
    let gac = 0
    let gsupW = 0
    for (let i = 0; i < g.count; i++) {
      gac += this.gacSum[i]
      gsupW += this.gacSup[i]
    }
    const supply = gac > 0 ? gsupW / gac : 12
    let gv = 0
    for (let i = 0; i < g.count; i++) gv += this.gvent[i]
    const sz = singleZoneExponential({ ceff: this.ceff, ua: this.ua + gv, gac, outsideC: this.scenario.outsideTempC, supplyC: supply, gainW: gain })
    let toComfort: number | null = null
    let note = ''
    let toEq: number | null = null
    if (sz.k > 0) {
      const desired = target + tol
      const est = timeToReach(desired, avgT, sz.tTarget, sz.k)
      if (est.kind === 'ok') toComfort = est.seconds
      else if (est.kind === 'already') {
        toComfort = 0
        note = 'Average temperature already inside the comfort band.'
      } else {
        const acIdle = dl.some((d) => d.type === 'ac' && d.mode === 'auto' && d.level === 0)
        // At t=0 the controller has not yet switched any AC on, so the "current levels"
        // steady state is just the hot outdoor-driven value. Say so instead of "unreachable".
        note = acIdle && this.coolingW < 1 ? 'AC units are idle: the estimate appears once the auto controller switches them on.' : est.message
      }
      toEq = 4 / sz.k
    } else note = 'No cooling or heat loss path: no steady state.'

    return {
      time: this.time,
      timeOfDay: (this.scenario.lighting.timeOfDay + this.time / 3600) % 24,
      avgT,
      minT: mn,
      maxT: mx,
      avgPerceivedT: sP / g.count,
      avgLux: sL / g.count,
      occLux,
      outdoorLux: this.outLux,
      occupants: this.occupants.length,
      occupantHeatW,
      coolingW: this.coolingW,
      acElectricW,
      fanW,
      lightW,
      gainW: gain,
      energyKWh: this.energyJ / 3.6e6,
      comfort,
      estimate: { tTarget: sz.tTarget, k: sz.k, toComfortSeconds: toComfort, toComfortNote: note, toEquilibriumSeconds: toEq },
      warnings: this.currentWarnings(),
    }
  }

  private currentWarnings(): string[] {
    const w = [...this.warnings]
    const under = this.coverage.filter((c) => c.status === 'uncovered').length
    if (under > 0) w.push(`${under} occupant${under > 1 ? 's are' : ' is'} outside every fan / AC influence region (underserved).`)
    const partial = this.coverage.filter((c) => c.status === 'partial').length
    if (partial > 0) w.push(`${partial} occupant${partial > 1 ? 's have' : ' has'} partial coverage (missing AC or lighting).`)
    if (this.acs.length === 0) w.push('No AC unit in this space: the room cannot be actively cooled.')
    return w
  }

  /** Full state for the UI. Typed arrays are copied so the engine can keep running. */
  snapshot(): SimSnapshot {
    const g = this.grid
    const temp = new Float32Array(g.count)
    const perceived = new Float32Array(g.count)
    const lux = new Float32Array(g.count)
    for (let i = 0; i < g.count; i++) {
      temp[i] = this.T[i]
      perceived[i] = this.perceived(i)
      lux[i] = this.natural[i] + this.artificial[i]
    }
    return {
      nx: g.nx,
      nz: g.nz,
      temp,
      perceived,
      lux,
      natural: this.natural.slice(),
      artificial: this.artificial.slice(),
      zoneIdByCell: this.zoneIdByCell.slice(),
      occupantsByCell: this.occCount.slice(),
      zones: this.zones,
      zoneStats: this.zoneStats(),
      coverage: this.coverage,
      devices: this.deviceLive.map((d) => ({ ...d })),
      stats: this.computeStats(),
      history: this.history.slice(),
    }
  }

  /** Total number of operating-level changes possible, mainly useful for tests. */
  liveLevel(id: string) {
    return this.states.get(id)?.level ?? 0
  }

  deviceCurrent(id: string) {
    const st = this.states.get(id)
    if (!st) return undefined
    const d = st.obj.device
    if (d && isAirDevice(d)) return { level: st.level, reach: currentLevel(d), max: maxLevel(d) }
    return undefined
  }
}
