import { useEffect, useState } from 'react'
import { useEditor } from '@/store/editorStore'
import { toast } from '@/store/uiStore'
import type { Vec2 } from '@/types'
import { round } from '@/utils/math'

/** Click-click wall drawing on the floor. Esc cancels, Shift disables axis snapping. */
export function WallTool() {
  const tool = useEditor((s) => s.tool)
  const dims = useEditor((s) => s.space!.dims)
  const snapSize = useEditor((s) => s.snapSize)
  const addWall = useEditor((s) => s.addWall)
  const [a, setA] = useState<Vec2 | null>(null)
  const [cursor, setCursor] = useState<Vec2 | null>(null)

  useEffect(() => {
    if (tool !== 'wall') {
      setA(null)
      setCursor(null)
      return
    }
    toast('Wall tool: click to place the start, click again to finish. Esc to stop.', 'info')
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (a) setA(null)
        else useEditor.getState().setTool('select')
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool])

  if (tool !== 'wall') return null

  const point = (x: number, z: number, shift: boolean): Vec2 => {
    let px = round(Math.min(dims.length, Math.max(0, x)), snapSize)
    let pz = round(Math.min(dims.width, Math.max(0, z)), snapSize)
    if (a && !shift) {
      const dx = Math.abs(px - a[0])
      const dz = Math.abs(pz - a[1])
      if (dz < dx * 0.15) pz = a[1]
      else if (dx < dz * 0.15) px = a[0]
    }
    return [px, pz]
  }
  const len = a && cursor ? Math.hypot(cursor[0] - a[0], cursor[1] - a[1]) : 0
  return (
    <group>
      <mesh
        position={[dims.length / 2, 0.05, dims.width / 2]}
        rotation-x={-Math.PI / 2}
        onPointerMove={(e) => setCursor(point(e.point.x, e.point.z, e.shiftKey))}
        onClick={(e) => {
          if (e.delta > 4) return
          e.stopPropagation()
          const p = point(e.point.x, e.point.z, e.shiftKey)
          if (!a) setA(p)
          else {
            addWall(a, p)
            setA(null)
          }
        }}
      >
        <planeGeometry args={[dims.length, dims.width]} />
        <meshBasicMaterial visible={false} />
      </mesh>
      {cursor && (
        <mesh position={[cursor[0], 0.06, cursor[1]]} rotation-x={-Math.PI / 2}>
          <ringGeometry args={[0.1, 0.16, 24]} />
          <meshBasicMaterial color="#2563eb" />
        </mesh>
      )}
      {a && cursor && len > 0.05 && (
        <group position={[(a[0] + cursor[0]) / 2, 0.9, (a[1] + cursor[1]) / 2]} rotation={[0, -Math.atan2(cursor[1] - a[1], cursor[0] - a[0]), 0]}>
          <mesh>
            <boxGeometry args={[len, 1.8, 0.12]} />
            <meshStandardMaterial color="#60a5fa" transparent opacity={0.55} />
          </mesh>
        </group>
      )}
    </group>
  )
}
