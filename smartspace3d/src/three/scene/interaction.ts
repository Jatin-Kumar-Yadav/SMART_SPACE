import type { ThreeEvent } from '@react-three/fiber'
import { CATALOG } from '@/objects/catalog'
import { placementIssue } from '@/objects/collision'
import { closestWall, placeOnWall, sideOfWall } from '@/objects/spaceFactory'
import { useEditor } from '@/store/editorStore'
import type { SceneObject } from '@/types'
import { rad, round, worldToLocal2 } from '@/utils/math'
import { floorPointFromClient, trackPointer } from '../sceneApi'

/** Pointer-down on any scene object: select it and start a (collision-checked) drag. */
export function onObjectPointerDown(id: string, e: ThreeEvent<PointerEvent>) {
  if (e.button !== 0) return
  const ed = useEditor.getState()
  if (ed.tool !== 'select' || !ed.space) return
  e.stopPropagation()
  if (e.shiftKey || e.ctrlKey || e.metaKey) {
    ed.select([id], true)
    return
  }
  if (!ed.selection.includes(id)) ed.select([id])
  startMove(e.nativeEvent)
}

function startMove(ev: PointerEvent) {
  const ed = useEditor.getState()
  const space = ed.space
  if (!space) return
  const movable = ed.selection.map((i) => space.objects.find((o) => o.id === i)).filter((o): o is SceneObject => !!o && !o.locked)
  if (!movable.length) return
  const start = floorPointFromClient(ev.clientX, ev.clientY)
  if (!start) return
  let began = false
  document.body.style.cursor = 'grabbing'
  trackPointer(
    (e) => {
      const p = floorPointFromClient(e.clientX, e.clientY)
      const st = useEditor.getState()
      const cur = st.space
      if (!p || !cur) return
      const sn = (v: number) => (st.snap && !e.altKey ? round(v, st.snapSize) : v)
      const cands = new Map<string, SceneObject>()
      for (const o of movable) {
        let cand = o
        if (CATALOG[o.kind].wallMounted) {
          const w = closestWall(cur.walls, p.x, p.z, 2.5)
          if (w) cand = placeOnWall(o, w.wall, st.snap ? round(w.offset, st.snapSize) : w.offset, w.wall.outward ? 1 : sideOfWall(w.wall, p.x, p.z))
        } else {
          cand = { ...o, position: [sn(o.position[0] + (p.x - start.x)), o.position[1], sn(o.position[2] + (p.z - start.z))] }
        }
        cands.set(o.id, cand)
      }
      const test = { ...cur, objects: cur.objects.map((o) => cands.get(o.id) ?? o) }
      const bad = [...cands.values()].filter((c) => placementIssue(c, test))
      st.setInvalid(bad.map((b) => b.id))
      if (bad.length) return
      if (!began) {
        st.beginTransient()
        began = true
      }
      for (const c of cands.values()) st.updateObject(c.id, { position: c.position, rotationY: c.rotationY, dims: c.dims, wall: c.wall }, true)
    },
    () => {
      const st = useEditor.getState()
      if (began) st.endTransient(true)
      st.setInvalid([])
    },
  )
}

/** Rotation handle: the knob sits at the object's front; dragging turns it about the vertical axis. */
export function beginRotate(id: string, e: ThreeEvent<PointerEvent>) {
  if (e.button !== 0) return
  e.stopPropagation()
  let began = false
  trackPointer(
    (ev) => {
      const st = useEditor.getState()
      const space = st.space
      const o = space?.objects.find((x) => x.id === id)
      const p = floorPointFromClient(ev.clientX, ev.clientY)
      if (!space || !o || !p) return
      let a = Math.atan2(p.x - o.position[0], p.z - o.position[2])
      if (!ev.altKey) a = round(a, rad(15))
      const cand = { ...o, rotationY: a }
      if (placementIssue(cand, space)) {
        st.setInvalid([id])
        return
      }
      st.setInvalid([])
      if (!began) {
        st.beginTransient()
        began = true
      }
      st.updateObject(id, { rotationY: a }, true)
    },
    () => {
      const st = useEditor.getState()
      if (began) st.endTransient(true)
      st.setInvalid([])
    },
  )
}

export type InfluenceHandle = 'radius' | 'length' | 'width'

/** Index of the level whose region is shown / edited (current level, or the strongest when OFF). */
export const previewLevelIndex = (d: { level: number; levels: unknown[] }) => (d.level > 0 ? d.level : d.levels.length - 1)

/** Drag a handle of a device's influence region; edits the previewed level live. */
export function beginInfluenceDrag(id: string, handle: InfluenceHandle, e: ThreeEvent<PointerEvent>) {
  if (e.button !== 0) return
  e.stopPropagation()
  let began = false
  trackPointer(
    (ev) => {
      const st = useEditor.getState()
      const o = st.space?.objects.find((x) => x.id === id)
      const p = floorPointFromClient(ev.clientX, ev.clientY)
      if (!o || !p || !o.device || o.device.type === 'light') return
      const [lx, lz] = worldToLocal2(p.x, p.z, o.position[0], o.position[2], o.rotationY)
      const shape = o.device.type === 'fan' ? 'circle' : o.device.shape
      const clamp = (v: number, lo: number, hi: number) => Math.round(Math.min(hi, Math.max(lo, v)) * 10) / 10
      if (!began) {
        st.beginTransient()
        began = true
      }
      const idx = previewLevelIndex(o.device)
      st.updateDevice(
        id,
        (d) => {
          if (d.type === 'light') return d
          const levels = d.levels.map((l, i) => {
            if (i !== idx) return l
            if (handle === 'radius') return { ...l, radius: clamp(Math.hypot(lx, lz), 0.5, 30) }
            if (handle === 'length') return { ...l, length: clamp(shape === 'rect' ? Math.abs(lz) * 2 : lz, 1, 40) }
            return { ...l, width: clamp(Math.abs(lx) * 2, 0.5, 30) }
          })
          return { ...d, levels }
        },
        true,
      )
    },
    () => {
      if (began) useEditor.getState().endTransient(true)
    },
  )
}
