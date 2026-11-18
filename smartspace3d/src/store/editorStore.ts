import { create } from 'zustand'
import { CATALOG, createObject } from '@/objects/catalog'
import { placementIssue } from '@/objects/collision'
import { closestWall, placeOnWall, resizePerimeter, sideOfWall } from '@/objects/spaceFactory'
import { generateOccupants, syncOccupants } from '@/simulation/occupancy'
import { applyCameraSeats, switchOccupancySource } from '@/simulation/occupancySource'
import { captureStates, createScenario, randomIndoorTemp, randomLighting, withHeat } from '@/simulation/scenario'
import type {
  CameraConfig,
  Dimensions,
  DeviceConfig,
  HardwareConfig,
  OccupancySource,
  FloorMaterial,
  FloorRegion,
  ObjectKind,
  Scenario,
  SceneObject,
  Space,
  Wall,
} from '@/types'
import { mulberry32, newId, randomSeed, round } from '@/utils/math'
import { toast } from './uiStore'
import type { DevicePatch } from '@/simulation/engine'

export type ViewMode = '3d' | '2d'
export type Layer = 'normal' | 'temperature' | 'lighting' | 'airflow' | 'occupancy' | 'coverage' | 'zones'
export type Tool = 'select' | 'wall'
export type WallMode = 'auto' | 'full' | 'low'
export type SaveStatus = 'saved' | 'saving' | 'unsaved'
export type CameraCommand = 'fit' | 'top' | 'iso' | 'reset'

export interface Ghost {
  kind: ObjectKind
  x: number
  z: number
  valid: boolean
  reason?: string
}

const HISTORY_LIMIT = 100

interface EditorState {
  space: Space | null
  saveStatus: SaveStatus
  selection: string[]
  selectedWallId: string | null
  tool: Tool
  viewMode: ViewMode
  layer: Layer
  showGrid: boolean
  snap: boolean
  snapSize: number
  wallMode: WallMode
  showCeiling: boolean
  showDeviceMarkers: boolean
  showOccupants: boolean
  past: Space[]
  future: Space[]
  dragStart: Space | null
  invalidIds: string[]
  ghost: Ghost | null
  cameraCmd: { cmd: CameraCommand; n: number } | null
  /** monotonic counter incremented whenever the persisted layout changes */
  revision: number

  // lifecycle
  openSpace: (s: Space) => void
  closeSpace: () => void
  setSaveStatus: (s: SaveStatus) => void
  // generic mutation
  apply: (fn: (s: Space) => Space, opts?: { transient?: boolean }) => void
  beginTransient: () => void
  endTransient: (commit: boolean) => void
  undo: () => void
  redo: () => void
  // selection / tools
  select: (ids: string[], additive?: boolean) => void
  selectWall: (id: string | null) => void
  setTool: (t: Tool) => void
  set: (patch: Partial<Pick<EditorState, 'viewMode' | 'layer' | 'showGrid' | 'snap' | 'snapSize' | 'wallMode' | 'showCeiling' | 'showDeviceMarkers' | 'showOccupants'>>) => void
  setGhost: (g: Ghost | null) => void
  setInvalid: (ids: string[]) => void
  camera: (cmd: CameraCommand) => void
  // objects
  addObject: (kind: ObjectKind, x?: number, z?: number, opts?: { quiet?: boolean }) => string | null
  updateObject: (id: string, patch: Partial<SceneObject>, transient?: boolean) => void
  updateDevice: (id: string, fn: (d: DeviceConfig) => DeviceConfig, transient?: boolean) => void
  /** change a device's operating state on the layout AND the active scenario in one undo step */
  setDeviceState: (id: string, patch: DevicePatch) => void
  setWindowOpen: (id: string, open: boolean) => void
  removeSelected: () => void
  duplicateSelected: () => void
  rotateSelected: (delta: number) => void
  nudgeSelected: (dx: number, dz: number) => void
  // space
  renameSpace: (name: string) => void
  setDimensions: (d: Dimensions) => void
  setFloor: (patch: Partial<FloorMaterial>) => void
  addRegion: () => void
  updateRegion: (id: string, patch: Omit<Partial<FloorRegion>, 'material'> & { material?: Partial<FloorMaterial> }) => void
  removeRegion: (id: string) => void
  addWall: (a: [number, number], b: [number, number]) => void
  updateWall: (id: string, patch: Partial<Wall>) => void
  removeWall: (id: string) => void
  // scenarios & occupancy
  updateScenario: (id: string, patch: Partial<Scenario>) => void
  addScenario: (name?: string, duplicateFrom?: string) => void
  removeScenario: (id: string) => void
  setActiveScenario: (id: string) => void
  captureScenarioStates: () => void
  generatePeople: () => number
  clearPeople: () => void
  /** choose the single authoritative occupancy source (camera stashes / restores generated occupants) */
  setOccupancySource: (src: OccupancySource) => void
  /** camera pipeline output: the confirmed seat keys. No-op unless the camera is authoritative. Not undoable. */
  setCameraOccupancy: (seatKeys: Iterable<string>) => void
  // cameras (calibration is stored with the project) and IoT hardware configuration
  upsertCamera: (cam: CameraConfig) => void
  removeCamera: (id: string) => void
  setHardware: (fn: (h: HardwareConfig | undefined) => HardwareConfig | undefined) => void
  randomizeConditions: () => void
}

export const activeScenario = (s: Space): Scenario => s.scenarios.find((x) => x.id === s.activeScenarioId) ?? s.scenarios[0]

const touch = (s: Space): Space => ({ ...s, updatedAt: Date.now() })

export const useEditor = create<EditorState>((set, get) => {
  /** run a layout mutation and keep seated occupants glued to their seats */
  const mutate = (fn: (s: Space) => Space, transient = false) => get().apply((s) => {
    const next = fn(s)
    if (next.objects !== s.objects) {
      return {
        ...next,
        scenarios: next.scenarios.map((sc) => {
          const synced = syncOccupants(next.objects, sc.occupants)
          const same = synced.length === sc.occupants.length && synced.every((o, i) => {
            const p = sc.occupants[i]
            return o.position[0] === p.position[0] && o.position[1] === p.position[1] && o.position[2] === p.position[2] && o.facing === p.facing
          })
          return same ? sc : { ...sc, occupants: synced }
        }),
      }
    }
    return next
  }, { transient })

  return {
    space: null,
    saveStatus: 'saved',
    selection: [],
    selectedWallId: null,
    tool: 'select',
    viewMode: '3d',
    layer: 'normal',
    showGrid: true,
    snap: true,
    snapSize: 0.25,
    wallMode: 'auto',
    showCeiling: false,
    showDeviceMarkers: true,
    showOccupants: true,
    past: [],
    future: [],
    dragStart: null,
    invalidIds: [],
    ghost: null,
    cameraCmd: null,
    revision: 0,

    openSpace: (s) =>
      set({ space: s, saveStatus: 'saved', selection: [], selectedWallId: null, past: [], future: [], tool: 'select', layer: 'normal', dragStart: null, ghost: null, revision: 0, cameraCmd: { cmd: 'iso', n: Date.now() } }),
    closeSpace: () => set({ space: null, selection: [], past: [], future: [] }),
    setSaveStatus: (saveStatus) => set({ saveStatus }),

    apply: (fn, opts) => {
      const cur = get().space
      if (!cur) return
      const next = touch(fn(cur))
      if (next === cur) return
      if (opts?.transient) {
        set({ space: next, saveStatus: 'unsaved', revision: get().revision + 1 })
      } else {
        set({ space: next, past: [...get().past, cur].slice(-HISTORY_LIMIT), future: [], saveStatus: 'unsaved', revision: get().revision + 1 })
      }
    },
    beginTransient: () => {
      if (!get().dragStart) set({ dragStart: get().space })
    },
    endTransient: (commit) => {
      const { dragStart, space } = get()
      if (!dragStart) return
      if (commit && space !== dragStart) {
        set({ past: [...get().past, dragStart].slice(-HISTORY_LIMIT), future: [], dragStart: null })
      } else {
        set({ space: commit ? space : dragStart, dragStart: null, saveStatus: commit ? get().saveStatus : 'unsaved', revision: get().revision + 1 })
      }
    },
    undo: () => {
      const { past, space, future } = get()
      if (!past.length || !space) return
      const prev = past[past.length - 1]
      set({ space: prev, past: past.slice(0, -1), future: [space, ...future].slice(0, HISTORY_LIMIT), saveStatus: 'unsaved', revision: get().revision + 1 })
    },
    redo: () => {
      const { past, space, future } = get()
      if (!future.length || !space) return
      set({ space: future[0], past: [...past, space].slice(-HISTORY_LIMIT), future: future.slice(1), saveStatus: 'unsaved', revision: get().revision + 1 })
    },

    select: (ids, additive) =>
      set((st) => ({
        selection: additive ? [...new Set([...st.selection.filter((i) => !ids.includes(i)), ...ids.filter((i) => !st.selection.includes(i))])] : ids,
        selectedWallId: ids.length ? null : st.selectedWallId,
      })),
    selectWall: (id) => set({ selectedWallId: id, selection: id ? [] : get().selection }),
    setTool: (tool) => set({ tool, selection: tool === 'select' ? get().selection : [], selectedWallId: null }),
    set: (patch) => set(patch),
    setGhost: (ghost) => set({ ghost }),
    setInvalid: (invalidIds) => set({ invalidIds }),
    camera: (cmd) => set({ cameraCmd: { cmd, n: Date.now() } }),

    addObject: (kind, x, z, opts) => {
      const space = get().space
      if (!space) return null
      const entry = CATALOG[kind]
      const { snap, snapSize } = get()
      const sx = (v: number) => (snap ? round(v, snapSize) : v)
      const count = space.objects.filter((o) => o.kind === kind).length
      let obj = createObject(kind, x ?? space.dims.length / 2, z ?? space.dims.width / 2, space)
      obj.name = `${entry.label} ${count + 1}`
      if (entry.wallMounted) {
        const px = x ?? space.dims.length / 2
        const pz = z ?? space.dims.width / 2
        const w = closestWall(space.walls, px, pz, x === undefined ? 1e9 : 1.5)
        if (!w) {
          if (!opts?.quiet) toast(`${entry.label} must be placed on a wall`, 'warning')
          return null
        }
        const side = w.wall.outward ? 1 : sideOfWall(w.wall, px, pz)
        obj = placeOnWall(obj, w.wall, w.offset, side)
      } else {
        const hx = obj.dims[0] / 2
        const hz = obj.dims[2] / 2
        const px = Math.min(space.dims.length - hx, Math.max(hx, sx(x ?? space.dims.length / 2)))
        const pz = Math.min(space.dims.width - hz, Math.max(hz, sx(z ?? space.dims.width / 2)))
        obj.position = [px, obj.position[1], pz]
      }
      let issue = placementIssue(obj, space)
      if (issue && x === undefined && !entry.wallMounted) {
        // quick-add from the library: spiral out from the centre to find free floor
        const step = 0.5
        search: for (let r = 0; r < 40; r++) {
          for (let dx = -r; dx <= r; dx++) {
            for (let dz = -r; dz <= r; dz++) {
              if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue
              const cand = { ...obj, position: [obj.position[0] + dx * step, obj.position[1], obj.position[2] + dz * step] as [number, number, number] }
              if (!placementIssue(cand, space)) {
                obj = cand
                issue = null
                break search
              }
            }
          }
        }
      }
      if (issue) {
        if (!opts?.quiet) toast(`Invalid placement: ${issue}`, 'warning')
        return null
      }
      mutate((s) => ({ ...s, objects: [...s.objects, obj] }))
      set({ selection: [obj.id], selectedWallId: null })
      if (!opts?.quiet) toast(`${obj.name} added`, 'success')
      return obj.id
    },

    updateObject: (id, patch, transient) =>
      mutate((s) => ({ ...s, objects: s.objects.map((o) => (o.id === id ? { ...o, ...patch } : o)) }), transient),

    updateDevice: (id, fn, transient) =>
      mutate((s) => ({ ...s, objects: s.objects.map((o) => (o.id === id && o.device ? { ...o, device: fn(o.device) } : o)) }), transient),

    setDeviceState: (id, patch) =>
      get().apply((s) => {
        const o = s.objects.find((x) => x.id === id)
        if (!o?.device) return s
        const d = o.device
        let device: DeviceConfig = d
        if (d.type === 'light') {
          device = { ...d, mode: patch.mode ?? d.mode, on: patch.on ?? d.on, dimming: patch.dimming ?? d.dimming }
        } else {
          const lv = patch.level === undefined ? d.level : Math.max(0, Math.min(d.levels.length - 1, Math.round(patch.level)))
          device = { ...d, mode: patch.mode ?? d.mode, level: lv }
        }
        const objects = s.objects.map((x) => (x.id === id ? { ...x, device } : x))
        const state = device.type === 'light' ? { mode: device.mode, on: device.on, dimming: device.dimming } : { mode: device.mode, level: device.level }
        const scenarios = s.scenarios.map((sc) => (sc.id === s.activeScenarioId ? { ...sc, deviceStates: { ...sc.deviceStates, [id]: state } } : sc))
        return { ...s, objects, scenarios }
      }),

    setWindowOpen: (id, open) =>
      get().apply((s) => ({
        ...s,
        objects: s.objects.map((x) => (x.id === id && x.window ? { ...x, window: { ...x.window, open } } : x)),
        scenarios: s.scenarios.map((sc) => (sc.id === s.activeScenarioId ? { ...sc, windowStates: { ...sc.windowStates, [id]: open } } : sc)),
      })),

    removeSelected: () => {
      const { selection, selectedWallId, space } = get()
      if (!space) return
      if (selectedWallId) {
        get().removeWall(selectedWallId)
        return
      }
      if (!selection.length) return
      const ids = new Set(selection.filter((id) => !space.objects.find((o) => o.id === id)?.locked))
      if (!ids.size) {
        toast('Selected objects are locked', 'warning')
        return
      }
      mutate((s) => ({ ...s, objects: s.objects.filter((o) => !ids.has(o.id)) }))
      set({ selection: [] })
    },

    duplicateSelected: () => {
      const { selection, space } = get()
      if (!space || !selection.length) return
      const clones: SceneObject[] = []
      for (const id of selection) {
        const o = space.objects.find((x) => x.id === id)
        if (!o) continue
        let c: SceneObject = { ...structuredClone(o), id: newId('obj'), name: `${o.name} copy`, locked: false }
        if (o.wall) {
          const wall = space.walls.find((w) => w.id === o.wall!.wallId)
          if (wall) c = placeOnWall(c, wall, o.wall.offset + o.dims[0] + 0.2, wall.outward ? 1 : sideOfWall(wall, o.position[0], o.position[2]))
        } else {
          c.position = [o.position[0] + 0.6, o.position[1], o.position[2] + 0.6]
        }
        clones.push(c)
      }
      mutate((s) => ({ ...s, objects: [...s.objects, ...clones] }))
      set({ selection: clones.map((c) => c.id) })
      toast(`${clones.length} object${clones.length > 1 ? 's' : ''} duplicated`, 'success')
    },

    rotateSelected: (delta) => {
      const { selection } = get()
      mutate((s) => ({
        ...s,
        objects: s.objects.map((o) => (selection.includes(o.id) && !o.locked && !o.wall ? { ...o, rotationY: o.rotationY + delta } : o)),
      }))
    },

    nudgeSelected: (dx, dz) => {
      const { selection } = get()
      mutate((s) => ({
        ...s,
        objects: s.objects.map((o) => {
          if (!selection.includes(o.id) || o.locked || o.wall) return o
          const cand = { ...o, position: [o.position[0] + dx, o.position[1], o.position[2] + dz] as [number, number, number] }
          return placementIssue(cand, s) ? o : cand
        }),
      }))
    },

    renameSpace: (name) => get().apply((s) => ({ ...s, name })),
    setDimensions: (d) =>
      get().apply((s) => {
        const next = resizePerimeter({ ...s, dims: d }, d)
        // keep the ceiling devices glued to the new ceiling & columns full height
        return {
          ...next,
          walls: next.walls.map((w) => (w.perimeter ? w : { ...w, height: Math.min(w.height, d.height) })),
          objects: next.objects.map((o) => {
            const e = CATALOG[o.kind]
            if (e.mount === 'ceiling') return { ...o, position: [o.position[0], d.height - o.dims[1], o.position[2]] as [number, number, number] }
            if (o.kind === 'column') return { ...o, dims: [o.dims[0], d.height, o.dims[2]] as [number, number, number] }
            return o
          }),
        }
      }),
    setFloor: (patch) => get().apply((s) => ({ ...s, floor: { ...s.floor, ...patch } })),
    addRegion: () =>
      get().apply((s) => {
        const r: FloorRegion = {
          id: newId('reg'),
          name: `Region ${s.floorRegions.length + 1}`,
          x: 0,
          z: 0,
          w: Math.min(4, s.dims.length),
          d: Math.min(4, s.dims.width),
          material: { ...s.floor, preset: 'wood', textureId: undefined, tileSize: 0.9 },
        }
        return { ...s, floorRegions: [...s.floorRegions, r] }
      }),
    updateRegion: (id, patch) =>
      get().apply((s) => ({
        ...s,
        floorRegions: s.floorRegions.map((r) => (r.id === id ? { ...r, ...patch, material: { ...r.material, ...(patch.material ?? {}) } } : r)),
      })),
    removeRegion: (id) => get().apply((s) => ({ ...s, floorRegions: s.floorRegions.filter((r) => r.id !== id) })),

    addWall: (a, b) => {
      const s = get().space
      if (!s) return
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.3) return
      const wall: Wall = { id: newId('wall'), a, b, thickness: 0.12, height: s.dims.height }
      get().apply((sp) => ({ ...sp, walls: [...sp.walls, wall] }))
      set({ selectedWallId: wall.id, selection: [] })
    },
    updateWall: (id, patch) => get().apply((s) => ({ ...s, walls: s.walls.map((w) => (w.id === id ? { ...w, ...patch } : w)) })),
    removeWall: (id) => {
      const s = get().space
      const w = s?.walls.find((x) => x.id === id)
      if (!s || !w) return
      if (w.perimeter) {
        toast('Perimeter walls cannot be deleted — resize the room instead', 'warning')
        return
      }
      // doors / windows attached to the wall go with it
      get().apply((sp) => ({ ...sp, walls: sp.walls.filter((x) => x.id !== id), objects: sp.objects.filter((o) => o.wall?.wallId !== id) }))
      set({ selectedWallId: null })
    },

    updateScenario: (id, patch) => get().apply((s) => ({ ...s, scenarios: s.scenarios.map((sc) => (sc.id === id ? { ...sc, ...patch } : sc)) })),
    addScenario: (name, duplicateFrom) =>
      get().apply((s) => {
        const src = s.scenarios.find((x) => x.id === duplicateFrom)
        const sc: Scenario = src
          ? { ...structuredClone(src), id: newId('scn'), name: name ?? `${src.name} copy` }
          : { ...createScenario(name ?? `Scenario ${s.scenarios.length + 1}`), ...captureStates(s.objects) }
        return { ...s, scenarios: [...s.scenarios, sc], activeScenarioId: sc.id }
      }),
    removeScenario: (id) => {
      const s = get().space
      if (!s || s.scenarios.length <= 1) {
        toast('A space needs at least one scenario', 'warning')
        return
      }
      get().apply((sp) => {
        const scenarios = sp.scenarios.filter((x) => x.id !== id)
        return { ...sp, scenarios, activeScenarioId: sp.activeScenarioId === id ? scenarios[0].id : sp.activeScenarioId }
      })
    },
    setActiveScenario: (id) =>
      get().apply((s) => {
        const sc = s.scenarios.find((x) => x.id === id)
        if (!sc) return s
        // switching scenario changes device / window STATES only — never the layout geometry
        return {
          ...s,
          activeScenarioId: id,
          objects: s.objects.map((o) => {
            const st = sc.deviceStates[o.id]
            const win = sc.windowStates[o.id]
            let next = o
            if (st && o.device) {
              next = {
                ...next,
                device: o.device.type === 'light' ? { ...o.device, mode: st.mode, on: st.on ?? o.device.on, dimming: st.dimming ?? o.device.dimming } : { ...o.device, mode: st.mode, level: st.level ?? o.device.level },
              }
            }
            if (win !== undefined && o.window) next = { ...next, window: { ...o.window, open: win } }
            return next
          }),
        }
      }),
    captureScenarioStates: () =>
      get().apply((s) => ({
        ...s,
        scenarios: s.scenarios.map((sc) => (sc.id === s.activeScenarioId ? { ...sc, ...captureStates(s.objects) } : sc)),
      })),

    generatePeople: () => {
      const s = get().space
      if (!s) return 0
      const sc = activeScenario(s)
      if (sc.occupancySource === 'camera') {
        toast('The live camera is the occupancy source. Turn off Live Occupancy Feed to generate people.', 'warning')
        return 0
      }
      const rng = mulberry32(randomSeed())
      const occ = generateOccupants(s.objects, sc.occupancy, rng, sc.sim.occupantHeatW)
      get().updateScenario(sc.id, { occupants: occ })
      if (occ.length) toast(`${occ.length} people generated`, 'success')
      else toast('No seat capacity — add chairs, benches or sofas first', 'warning')
      return occ.length
    },
    clearPeople: () => {
      const s = get().space
      if (!s) return
      if (activeScenario(s).occupancySource === 'camera') {
        toast('The live camera is the occupancy source. Turn off Live Occupancy Feed first.', 'warning')
        return
      }
      get().updateScenario(activeScenario(s).id, { occupants: [] })
    },
    setOccupancySource: (src) =>
      get().apply((s) => ({ ...s, scenarios: s.scenarios.map((sc) => (sc.id === s.activeScenarioId ? switchOccupancySource(sc, src) : sc)) }), { transient: true }),
    setCameraOccupancy: (seatKeys) => {
      const keys = [...seatKeys]
      get().apply((s) => ({ ...s, scenarios: s.scenarios.map((sc) => (sc.id === s.activeScenarioId ? applyCameraSeats(sc, s.objects, keys) : sc)) }), { transient: true })
    },
    upsertCamera: (cam) =>
      get().apply((s) => ({ ...s, cameras: s.cameras.some((c) => c.id === cam.id) ? s.cameras.map((c) => (c.id === cam.id ? cam : c)) : [...s.cameras, cam] }), { transient: true }),
    removeCamera: (id) => get().apply((s) => ({ ...s, cameras: s.cameras.filter((c) => c.id !== id) }), { transient: true }),
    setHardware: (fn) => get().apply((s) => ({ ...s, hardware: fn(s.hardware) }), { transient: true }),
    randomizeConditions: () => {
      const s = get().space
      if (!s) return
      const rng = mulberry32(randomSeed())
      const sc = activeScenario(s)
      get().updateScenario(sc.id, { initialTempC: randomIndoorTemp(rng), lighting: randomLighting(rng), occupants: withHeat(sc.occupants, sc.sim.occupantHeatW) })
      toast('Random ambient temperature and lighting scenario generated', 'success')
    },
  }
})
