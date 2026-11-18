import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { memo, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useEditor } from '@/store/editorStore'
import { useHover } from '@/store/hoverStore'
import { useSim } from '@/store/simStore'
import type { FloorMaterial, SceneObject, Space, Wall } from '@/types'
import { wallLength, wallYaw } from '@/utils/geometry'
import { FLOOR_PRESETS, floorGeometry } from '../textures'
import { sceneApi } from '../sceneApi'
import { useFloorTexture } from '../useFloorTexture'
import { wallPieces } from '../wallGeometry'

/** Height (m) a wall is cut down to when it faces the camera (dollhouse view). */
export const CUT_HEIGHT = 0.14

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1)

// ───────────────────────── floor ─────────────────────────

function FloorPatch({ x, z, w, d, material, y = 0 }: { x: number; z: number; w: number; d: number; material: FloorMaterial; y?: number }) {
  const tex = useFloorTexture(material)
  const geo = useMemo(() => floorGeometry(w, d, Math.max(0.05, material.tileSize), material.stretch), [w, d, material.tileSize, material.stretch])
  const swatch = FLOOR_PRESETS.find((p) => p.id === material.preset)?.swatch ?? '#dddddd'
  return (
    <mesh geometry={geo} position={[x + w / 2, y, z + d / 2]} receiveShadow>
      <meshStandardMaterial
        map={tex}
        color={tex ? material.tint : swatch}
        roughness={material.roughness}
        metalness={0}
        polygonOffset={y > 0}
        polygonOffsetFactor={-2}
        polygonOffsetUnits={-2}
      />
    </mesh>
  )
}

export function Floor() {
  const dims = useEditor((s) => s.space!.dims)
  const floor = useEditor((s) => s.space!.floor)
  const woodFloor: FloorMaterial = useMemo(
    () => ({
      ...floor,
      preset: 'wood',
      tileSize: 1.0,
      roughness: 0.55,
      textureId: undefined,
      tint: '#ffffff',
    }),
    [floor],
  )
  const select = useEditor((s) => s.select)
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta < 4 && useEditor.getState().tool === 'select') {
      select([])
      useEditor.getState().selectWall(null)
    }
  }
  return (
    <group>
      <group onClick={onClick}>
        <FloorPatch x={0} z={0} w={dims.length} d={dims.width} material={woodFloor} />
      </group>
      <HoverPlane />
    </group>
  )
}

/** Invisible plane just above the floor that feeds the hover tooltip in the simulation layers. */
function HoverPlane() {
  const dims = useEditor((s) => s.space!.dims)
  const layer = useEditor((s) => s.layer)
  const setFloor = useHover((s) => s.setFloor)
  if (layer === 'normal') return null
  const onMove = (e: ThreeEvent<PointerEvent>) => {
    const snap = useSim.getState().snapshot
    if (!snap) return
    const ix = Math.min(snap.nx - 1, Math.max(0, Math.floor((e.point.x / dims.length) * snap.nx)))
    const iz = Math.min(snap.nz - 1, Math.max(0, Math.floor((e.point.z / dims.width) * snap.nz)))
    setFloor({ cell: iz * snap.nx + ix, x: e.point.x, z: e.point.z, sx: e.nativeEvent.clientX, sy: e.nativeEvent.clientY })
  }
  return (
    <mesh position={[dims.length / 2, 0.03, dims.width / 2]} rotation-x={-Math.PI / 2} onPointerMove={onMove} onPointerOut={() => setFloor(null)} visible={false}>
      <planeGeometry args={[dims.length, dims.width]} />
      <meshBasicMaterial />
    </mesh>
  )
}

/** Light-grey ground around the building plus a soft shadow, like an architectural dollhouse model. */
export function Ground() {
  const dims = useEditor((s) => s.space!.dims)
  const size = Math.max(dims.length, dims.width) * 6 + 40
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[dims.length / 2, -0.03, dims.width / 2]}>
        <planeGeometry args={[size, size]} />
        <meshBasicMaterial color="#dcdfe4" />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[dims.length / 2, -0.02, dims.width / 2]} receiveShadow>
        <planeGeometry args={[size, size]} />
        <shadowMaterial opacity={0.16} />
      </mesh>
    </group>
  )
}

// ───────────────────────── grid ─────────────────────────

export function GridLines() {
  const dims = useEditor((s) => s.space!.dims)
  const show = useEditor((s) => s.showGrid)
  const geo = useMemo(() => {
    const { length: L, width: W } = dims
    const steps = [0.5, 1, 2, 5, 10, 20]
    const step = steps.find((s) => L / s <= 80 && W / s <= 80) ?? 20
    const pts: number[] = []
    for (let x = 0; x <= L + 1e-6; x += step) pts.push(x, 0.008, 0, x, 0.008, W)
    for (let z = 0; z <= W + 1e-6; z += step) pts.push(0, 0.008, z, L, 0.008, z)
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    return g
  }, [dims])
  if (!show) return null
  return (
    <lineSegments geometry={geo}>
      <lineBasicMaterial color="#1e293b" transparent opacity={0.1} depthWrite={false} />
    </lineSegments>
  )
}

export function Ceiling() {
  const dims = useEditor((s) => s.space!.dims)
  const show = useEditor((s) => s.showCeiling)
  if (!show) return null
  return (
    <mesh position={[dims.length / 2, dims.height + 0.01, dims.width / 2]} rotation-x={Math.PI / 2}>
      <planeGeometry args={[dims.length, dims.width]} />
      <meshStandardMaterial color="#ffffff" transparent opacity={0.28} side={THREE.DoubleSide} depthWrite={false} />
    </mesh>
  )
}

// ───────────────────────── walls ─────────────────────────

const WallMesh = memo(function WallMesh({ wall, objects, selected }: { wall: Wall; objects: SceneObject[]; selected: boolean }) {
  const group = useRef<THREE.Group>(null)
  const pieces = useMemo(() => wallPieces(wall, objects), [wall, objects])
  const color = wall.color ?? '#f3f1ec'
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color, roughness: 0.85 }), [color])
  const cap = useMemo(() => new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.6 }), [])
  const yaw = wallYaw(wall)
  const cur = useRef(1)

  useFrame((_, dt) => {
    const g = group.current
    if (!g) return
    const cut = sceneApi.wallCut.get(wall.id) ?? false
    const target = cut ? Math.min(1, CUT_HEIGHT / wall.height) : 1
    cur.current += (target - cur.current) * Math.min(1, dt * 12)
    if (Math.abs(cur.current - target) < 0.002) cur.current = target
    g.scale.y = cur.current
  })

  return (
    <group ref={group} position={[wall.a[0], 0, wall.a[1]]} rotation={[0, yaw, 0]}>
      {pieces.map((p, i) => (
        <mesh key={i} geometry={UNIT_BOX} material={selected ? SELECTED_WALL : mat} position={[p.x, p.y, 0]} scale={[p.length, p.height, wall.thickness]} castShadow receiveShadow />
      ))}
      {/* white cap on top of the wall, as on architectural models */}
      {pieces
        .filter((p) => Math.abs(p.y + p.height / 2 - wall.height) < 1e-3)
        .map((p, i) => (
          <mesh key={`c${i}`} geometry={UNIT_BOX} material={cap} position={[p.x, wall.height + 0.012, 0]} scale={[p.length, 0.024, wall.thickness + 0.004]} />
        ))}
    </group>
  )
})

const SELECTED_WALL = new THREE.MeshStandardMaterial({ color: '#bfdbfe', roughness: 0.7 })

export function Walls() {
  const walls = useEditor((s) => s.space!.walls)
  const objects = useEditor((s) => s.space!.objects)
  const selectedWallId = useEditor((s) => s.selectedWallId)
  const tool = useEditor((s) => s.tool)
  const selectWall = useEditor((s) => s.selectWall)
  // only doors / windows change a wall's shape
  const openings = useMemo(() => objects.filter((o) => o.kind === 'door' || o.kind === 'window'), [objects])
  return (
    <group>
      {walls.map((w) => (
        <group
          key={w.id}
          onClick={(e) => {
            if (tool === 'select' && !w.perimeter && e.delta < 4) {
              e.stopPropagation()
              selectWall(w.id)
            }
          }}
        >
          <WallMesh wall={w} objects={openings} selected={selectedWallId === w.id} />
        </group>
      ))}
    </group>
  )
}

/**
 * Decides every frame which walls are cut away: perimeter walls whose outward
 * normal points towards the camera (so the interior stays visible), all walls in
 * the 'low' wall mode and in the top-down 2D view.
 */
export function WallCutter() {
  const center = useRef(new THREE.Vector3())
  useFrame(({ camera }) => {
    const st = useEditor.getState()
    const space = st.space
    if (!space) return
    center.current.set(space.dims.length / 2, 0, space.dims.width / 2)
    const dx = camera.position.x - center.current.x
    const dz = camera.position.z - center.current.z
    const len = Math.hypot(dx, dz)
    const top = st.viewMode === '2d'
    for (const w of space.walls) {
      let cut = false
      if (st.wallMode === 'low' || top) cut = true
      else if (st.wallMode === 'auto' && w.perimeter && w.outward && len > 0.5) cut = (w.outward[0] * dx + w.outward[1] * dz) / len > 0.3
      sceneApi.wallCut.set(w.id, cut)
    }
  })
  return null
}

export { wallLength }
export type { Space }
