import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { currentLevel, influenceLocal, isAirDevice, profileOf, regionBounds, shapeOf } from '@/simulation/influence'
import { useEditor } from '@/store/editorStore'
import { useSim } from '@/store/simStore'
import type { AirLevel, SceneObject } from '@/types'
import { beginInfluenceDrag, previewLevelIndex } from '../scene/interaction'

const N = 160

/** Paint the influence field of a device into a canvas texture (alpha ∝ influence). */
function useInfluenceTexture(obj: SceneObject, level: AirLevel, color: string) {
  const d = obj.device
  const air = isAirDevice(d) ? d : null
  const shape = air ? shapeOf(air) : 'circle'
  const prof = air ? profileOf(air) : []
  const bounds = useMemo(() => (air ? regionBounds(air, level) : { minX: -1, maxX: 1, minZ: -1, maxZ: 1 }), [air, level]) // eslint-disable-line react-hooks/exhaustive-deps
  const tex = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = N
    const ctx = canvas.getContext('2d')!
    const img = ctx.createImageData(N, N)
    const c = new THREE.Color(color)
    const w = bounds.maxX - bounds.minX
    const h = bounds.maxZ - bounds.minZ
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const lx = bounds.minX + ((i + 0.5) / N) * w
        const lz = bounds.minZ + ((j + 0.5) / N) * h
        const v = influenceLocal(shape, level, prof, lx, lz)
        const k = (j * N + i) * 4
        img.data[k] = c.r * 255
        img.data[k + 1] = c.g * 255
        img.data[k + 2] = c.b * 255
        img.data[k + 3] = v > 0.001 ? Math.min(255, 30 + Math.pow(v, 0.8) * 150) : 0
      }
    }
    ctx.putImageData(img, 0, 0)
    const t = new THREE.CanvasTexture(canvas)
    t.colorSpace = THREE.SRGBColorSpace
    return t
  }, [shape, level, prof, bounds, color])
  useEffect(() => () => tex.dispose(), [tex])
  return { tex, bounds }
}

/** Translucent floor region showing where a fan / AC acts (not physical geometry). */
export function InfluenceOverlay({ obj, level, editable }: { obj: SceneObject; level: AirLevel; editable: boolean }) {
  const d = obj.device
  const color = d?.type === 'fan' ? '#14b8a6' : '#3b82f6'
  const { tex, bounds } = useInfluenceTexture(obj, level, color)
  if (!isAirDevice(d)) return null
  const shape = shapeOf(d)
  const w = Math.max(0.01, bounds.maxX - bounds.minX)
  const h = Math.max(0.01, bounds.maxZ - bounds.minZ)
  const cx = (bounds.minX + bounds.maxX) / 2
  const cz = (bounds.minZ + bounds.maxZ) / 2
  const handle = (pos: [number, number, number], kind: 'radius' | 'length' | 'width') => (
    <mesh
      position={pos}
      onPointerDown={(e) => beginInfluenceDrag(obj.id, kind, e)}
      onPointerOver={() => (document.body.style.cursor = 'ew-resize')}
      onPointerOut={() => (document.body.style.cursor = '')}
    >
      <sphereGeometry args={[0.16, 16, 12]} />
      <meshBasicMaterial color={color} />
    </mesh>
  )
  return (
    <group position={[obj.position[0], 0.02, obj.position[2]]} rotation={[0, obj.rotationY, 0]}>
      <mesh rotation-x={-Math.PI / 2} position={[cx, 0, cz]} renderOrder={2}>
        <planeGeometry args={[w, h]} />
        <meshBasicMaterial map={tex} transparent depthWrite={false} toneMapped={false} />
      </mesh>
      {editable && (
        <>
          {shape === 'circle' && handle([level.radius, 0.05, 0], 'radius')}
          {shape !== 'circle' && handle([0, 0.05, bounds.maxZ], 'length')}
          {shape !== 'circle' && handle([bounds.maxX, 0.05, 0], 'width')}
          {shape === 'directional' && (
            <mesh position={[0, 0.03, bounds.maxZ / 2]} rotation-x={-Math.PI / 2}>
              <ringGeometry args={[0.04, 0.07, 3]} />
              <meshBasicMaterial color={color} />
            </mesh>
          )}
        </>
      )}
    </group>
  )
}

/** Overlays for the selected fan/AC (editable) and, in the airflow / coverage layers, for every active one. */
export function InfluenceLayer() {
  const objects = useEditor((s) => s.space!.objects)
  const selection = useEditor((s) => s.selection)
  const layer = useEditor((s) => s.layer)
  const live = useSim((s) => s.snapshot?.devices)
  const showAll = layer === 'airflow' || layer === 'coverage'
  return (
    <group>
      {objects.map((o) => {
        const d = o.device
        if (!isAirDevice(d) || !o.visible) return null
        const selected = selection.includes(o.id)
        if (!selected && !showAll) return null
        if (selected) return <InfluenceOverlay key={o.id} obj={o} level={d.levels[previewLevelIndex(d)]} editable={selection.length === 1} />
        const lv = live?.find((x) => x.id === o.id)?.level ?? d.level
        const lvl = currentLevel({ ...d, level: lv })
        return lvl.radius > 0 || lvl.length > 0 ? <InfluenceOverlay key={o.id} obj={o} level={lvl} editable={false} /> : null
      })}
    </group>
  )
}
