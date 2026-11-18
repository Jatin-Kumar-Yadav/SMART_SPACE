import { useMemo } from 'react'
import * as THREE from 'three'
import { allSeatSlots } from '@/simulation/occupancy'
import { useCameraUi } from '@/store/cameraStore'
import { useEditor } from '@/store/editorStore'
import { useLayout } from '@/store/layoutStore'
import type { CameraConfig } from '@/types'
import { frustumCorners } from '@/vision/frustum'
import { viewDirection } from '@/vision/pose'

const TONE: Record<CameraConfig['level'], string> = { none: '#94a3b8', poor: '#dc2626', fair: '#d97706', good: '#16a34a' }

function CameraGlyph({ cam, active }: { cam: CameraConfig; active: boolean }) {
  const geo = useMemo(() => {
    if (!cam.pose) return null
    const corners = frustumCorners(cam)
    if (!corners) return null
    const o = cam.pose.position
    const pts = corners.map((c) => new THREE.Vector3(...c.point))
    const lines: number[] = []
    for (const p of pts) lines.push(o[0], o[1], o[2], p.x, p.y, p.z)
    for (let i = 0; i < 4; i++) {
      const a = pts[i], b = pts[(i + 1) % 4]
      lines.push(a.x, a.y + 0.02, a.z, b.x, b.y + 0.02, b.z)
    }
    const line = new THREE.BufferGeometry()
    line.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3))
    const fill = new THREE.BufferGeometry().setFromPoints([pts[0], pts[1], pts[2], pts[0], pts[2], pts[3]].map((p) => p.clone().setY(Math.max(p.y, 0) + 0.03)))
    fill.computeVertexNormals()
    const d = viewDirection(cam.pose)
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), new THREE.Vector3(...d))
    return { line, fill, q, o }
  }, [cam])
  if (!geo) return null
  const color = TONE[cam.level]
  return (
    <group>
      <lineSegments geometry={geo.line} raycast={() => null}>
        <lineBasicMaterial color={color} transparent opacity={active ? 0.9 : 0.5} />
      </lineSegments>
      <mesh geometry={geo.fill} raycast={() => null}>
        <meshBasicMaterial color={color} transparent opacity={active ? 0.18 : 0.08} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <group position={geo.o} quaternion={geo.q}>
        <mesh raycast={() => null} castShadow><boxGeometry args={[0.34, 0.24, 0.22]} /><meshStandardMaterial color="#1e293b" /></mesh>
        <mesh position={[0, 0, -0.18]} rotation={[Math.PI / 2, 0, 0]} raycast={() => null}><cylinderGeometry args={[0.09, 0.11, 0.16, 20]} /><meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.5} /></mesh>
      </group>
    </group>
  )
}

/** Calibrated cameras and their field of view, plus a ring on the seat of the selected detection. */
export function CameraLayer() {
  const mode = useLayout((s) => s.mode)
  const cams = useEditor((s) => s.space?.cameras)
  const objects = useEditor((s) => s.space?.objects)
  const showFrustum = useCameraUi((s) => s.showFrustum)
  const activeId = useCameraUi((s) => s.activeId)
  const seatKey = useCameraUi((s) => {
    const r = s.activeId ? s.states[s.activeId]?.result : null
    return r && s.selectedTrack != null ? r.tracks.find((t) => t.id === s.selectedTrack)?.seatKey ?? null : null
  })
  const seat = useMemo(() => (seatKey && objects ? allSeatSlots(objects).find((s) => s.key === seatKey) : undefined), [seatKey, objects])
  if (mode !== 'camera') return null
  return (
    <>
      {showFrustum && cams?.map((c) => <CameraGlyph key={c.id} cam={c} active={c.id === activeId} />)}
      {seat && (
        <mesh position={[seat.position[0], 0.06, seat.position[2]]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
          <ringGeometry args={[0.45, 0.6, 40]} />
          <meshBasicMaterial color="#2563eb" transparent opacity={0.95} depthTest={false} />
        </mesh>
      )}
    </>
  )
}
