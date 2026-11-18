import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { daylightOf, daylightWeight, farHalfWidth, MAX_DIRECTION_DEG } from '@/simulation/daylight'
import { useEditor } from '@/store/editorStore'
import type { DaylightInfluence, SceneObject } from '@/types'
import { clamp, worldToLocal2 } from '@/utils/math'
import { floorPointFromClient, trackPointer } from '../sceneApi'

const N = 160
const GOLD = '#f5b301'
type Handle = 'far' | 'width' | 'spread'
const r1 = (v: number) => Math.round(v * 10) / 10

function useDaylightTexture(p: DaylightInfluence, minX: number, maxX: number) {
  const tex = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = N
    const ctx = canvas.getContext('2d')!
    const img = ctx.createImageData(N, N)
    const c = new THREE.Color(GOLD)
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const across = minX + ((i + 0.5) / N) * (maxX - minX)
        const along = ((j + 0.5) / N) * p.length
        const v = Math.min(1, daylightWeight(p, along, across))
        const k = (j * N + i) * 4
        img.data[k] = c.r * 255
        img.data[k + 1] = c.g * 255
        img.data[k + 2] = c.b * 255
        img.data[k + 3] = v > 0.004 ? Math.min(255, 48 + Math.pow(v, 0.8) * 190) : 0
      }
    }
    ctx.putImageData(img, 0, 0)
    const t = new THREE.CanvasTexture(canvas)
    t.colorSpace = THREE.SRGBColorSpace
    return t
  }, [p, minX, maxX])
  useEffect(() => () => tex.dispose(), [tex])
  return tex
}

/** Drag a handle of a window's daylight region. Writes into the window config, so the lighting simulation follows live. */
function beginDaylightDrag(id: string, handle: Handle, e: { button: number; stopPropagation: () => void }) {
  if (e.button !== 0) return
  e.stopPropagation()
  let began = false
  trackPointer(
    (ev) => {
      const st = useEditor.getState()
      const o = st.space?.objects.find((x) => x.id === id)
      const pt = floorPointFromClient(ev.clientX, ev.clientY)
      if (!o?.window || !pt) return
      const cur = daylightOf(o)
      // coordinates in the window's own frame (+z = inward normal)
      const [wx, wz] = worldToLocal2(pt.x, pt.z, o.position[0], o.position[2], o.rotationY)
      let next: DaylightInfluence = cur
      if (handle === 'far') {
        if (wz < 0.3) return // interior-facing side only
        const dir = clamp((Math.atan2(wx, wz) * 180) / Math.PI, -MAX_DIRECTION_DEG, MAX_DIRECTION_DEG)
        next = { ...cur, length: r1(clamp(Math.hypot(wx, wz), 0.5, 30)), direction: Math.round(dir) }
      } else {
        const [lx, lz] = worldToLocal2(pt.x, pt.z, o.position[0], o.position[2], o.rotationY + (cur.direction * Math.PI) / 180)
        if (handle === 'width') next = { ...cur, width: r1(clamp(Math.abs(lx) * 2, 0.3, 20)) }
        else if (lz > 0.5) next = { ...cur, spread: Math.round(clamp((2 * Math.atan(Math.max(0, Math.abs(lx) - cur.width / 2) / Math.min(lz, cur.length)) * 180) / Math.PI, 0, 90)) }
      }
      if (!began) {
        st.beginTransient()
        began = true
      }
      st.updateObject(id, { window: { ...o.window, daylight: next } }, true)
    },
    () => {
      if (began) useEditor.getState().endTransient(true)
    },
  )
}

function Region({ obj, editable }: { obj: SceneObject; editable: boolean }) {
  const p = daylightOf(obj)
  const half = farHalfWidth(p) + 0.8
  const tex = useDaylightTexture(p, -half, half)
  const handle = (pos: [number, number, number], h: Handle, cursor: string, size = 0.17) => (
    <mesh position={pos} renderOrder={30} onPointerDown={(e) => beginDaylightDrag(obj.id, h, e)} onPointerOver={() => (document.body.style.cursor = cursor)} onPointerOut={() => (document.body.style.cursor = '')}>
      <sphereGeometry args={[size, 16, 12]} />
      <meshBasicMaterial color={h === 'far' ? '#d97706' : GOLD} depthTest={false} />
    </mesh>
  )
  const fh = p.width / 2 + p.length * Math.tan((p.spread * Math.PI) / 360)
  return (
    <group position={[obj.position[0], 0.025, obj.position[2]]} rotation={[0, obj.rotationY + (p.direction * Math.PI) / 180, 0]}>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0, p.length / 2]} renderOrder={20}>
        <planeGeometry args={[half * 2, p.length]} />
        <meshBasicMaterial map={tex} transparent depthWrite={false} depthTest={false} toneMapped={false} />
      </mesh>
      {/* region outline */}
      <line>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[new Float32Array([-p.width / 2, 0.01, 0, -fh, 0.01, p.length, fh, 0.01, p.length, p.width / 2, 0.01, 0, -p.width / 2, 0.01, 0]), 3]} />
        </bufferGeometry>
        <lineBasicMaterial color="#d97706" transparent opacity={0.9} depthTest={false} />
      </line>
      {editable && (
        <>
          {handle([0, 0.06, p.length], 'far', 'move')}
          {handle([p.width / 2, 0.06, 0], 'width', 'ew-resize', 0.14)}
          {handle([fh, 0.06, p.length], 'spread', 'ew-resize', 0.14)}
        </>
      )}
    </group>
  )
}

/** Golden daylight region of the selected window. Hidden with the window's "show region" switch. */
export function DaylightLayer() {
  const objects = useEditor((s) => s.space!.objects)
  const selection = useEditor((s) => s.selection)
  return (
    <group>
      {objects.map((o) => {
        if (!o.window || !o.visible || !selection.includes(o.id)) return null
        if (o.window.daylight?.show === false) return null
        return <Region key={o.id} obj={o} editable={selection.length === 1 && !o.locked} />
      })}
    </group>
  )
}
