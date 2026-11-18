import { Line } from '@react-three/drei'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { memo, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { CATALOG } from '@/objects/catalog'
import { candidateAt } from '@/objects/placement'
import { useEditor } from '@/store/editorStore'
import { useHover } from '@/store/hoverStore'
import { useSim } from '@/store/simStore'
import type { SceneObject } from '@/types'
import { bakeModel, bucketMaterial } from '../bake'
import { ObjectModel } from '../models'
import { sceneApi } from '../sceneApi'
import { beginRotate, onObjectPointerDown } from './interaction'

const DEVICE_COLOR = { fan: '#0ea5b7', ac: '#3b82f6', light: '#f59e0b' } as const
const isInstanced = (o: SceneObject) => {
  const e = CATALOG[o.kind]
  return e.category === 'furniture' || o.kind === 'column'
}

// ───────────────────────── instanced furniture ─────────────────────────

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _p = new THREE.Vector3()
const _s = new THREE.Vector3(1, 1, 1)
const _e = new THREE.Euler()

function useHoverHandlers(id: (e: ThreeEvent<PointerEvent>) => string | undefined) {
  const setObject = useHover((s) => s.setObject)
  return {
    onPointerOver: (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation()
      setObject(id(e) ?? null)
      if (!document.body.style.cursor) document.body.style.cursor = 'pointer'
    },
    onPointerOut: () => {
      setObject(null)
      if (document.body.style.cursor === 'pointer') document.body.style.cursor = ''
    },
  }
}

/** All objects that share a model (kind + size + colour) are drawn by one InstancedMesh per material bucket. */
const InstancedGroup = memo(function InstancedGroup({ items }: { items: SceneObject[] }) {
  const first = items[0]
  const buckets = useMemo(() => bakeModel(first.kind, first.dims, first.color ?? CATALOG[first.kind].color ?? '#999999'), [first.kind, first.dims, first.color])
  const hover = useHoverHandlers((e) => (e.instanceId !== undefined ? items[e.instanceId]?.id : undefined))
  return (
    <>
      {buckets.map((b) => (
        <InstancedBucket key={`${b.key}-${items.length}`} bucket={b} items={items} hover={hover} />
      ))}
    </>
  )
})

function InstancedBucket({ bucket, items, hover }: { bucket: ReturnType<typeof bakeModel>[number]; items: SceneObject[]; hover: ReturnType<typeof useHoverHandlers> }) {
  const ref = useRef<THREE.InstancedMesh>(null)
  const material = useMemo(() => bucketMaterial(bucket), [bucket])
  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    items.forEach((o, i) => {
      _p.set(o.position[0], o.position[1], o.position[2])
      _q.setFromEuler(_e.set(0, o.rotationY, 0))
      _m.compose(_p, _q, o.visible ? _s : ZERO)
      mesh.setMatrixAt(i, _m)
    })
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [items])
  return (
    <instancedMesh
      ref={ref}
      args={[bucket.geometry, material, items.length]}
      castShadow={bucket.cast && bucket.opacity >= 1}
      receiveShadow
      frustumCulled={false}
      onPointerDown={(e) => {
        const o = e.instanceId !== undefined ? items[e.instanceId] : undefined
        if (o) onObjectPointerDown(o.id, e)
      }}
      {...hover}
    />
  )
}
const ZERO = new THREE.Vector3(0, 0, 0)

// ───────────────────────── devices, doors, windows ─────────────────────────

function useLiveDevice(id: string) {
  return useSim((s) => s.snapshot?.devices.find((d) => d.id === id))
}

const DeviceMarker = memo(function DeviceMarker({ obj }: { obj: SceneObject }) {
  const type = obj.device!.type
  const color = DEVICE_COLOR[type]
  const top = obj.position[1] + (CATALOG[obj.kind].mount === 'ceiling' ? obj.dims[1] : obj.dims[1] / 2)
  const pts = useMemo(() => [new THREE.Vector3(0, 0.03, 0), new THREE.Vector3(0, Math.max(0.2, top), 0)], [top])
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.03, 0]}>
        <ringGeometry args={[0.26, 0.33, 40]} />
        <meshBasicMaterial color={color} transparent opacity={0.95} depthWrite={false} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.028, 0]}>
        <circleGeometry args={[0.26, 40]} />
        <meshBasicMaterial color={color} transparent opacity={0.2} depthWrite={false} />
      </mesh>
      <Line points={pts} color={color} lineWidth={1.2} dashed dashSize={0.12} gapSize={0.1} transparent opacity={0.8} />
      <mesh position={[0, Math.max(0.2, top), 0]} rotation-x={Math.PI}>
        <coneGeometry args={[0.07, 0.16, 4]} />
        <meshBasicMaterial color={color} />
      </mesh>
    </group>
  )
})

const DeviceNode = memo(function DeviceNode({ obj }: { obj: SceneObject }) {
  const outer = useRef<THREE.Group>(null)
  const spin = useRef<THREE.Group>(null)
  const live = useLiveDevice(obj.id)
  const showMarkers = useEditor((s) => s.showDeviceMarkers)
  const hover = useHoverHandlers(() => obj.id)
  const dev = obj.device
  const level = live?.level ?? (dev && dev.type !== 'light' ? dev.level : 0)
  const on = dev?.type === 'light' ? (live ? live.on : dev.on) : true
  const dimming = dev?.type === 'light' ? (live ? live.dimming : dev.dimming) : 1
  const glow = dev?.type === 'light' ? (on ? Math.max(0.05, dimming) : 0) : level > 0 ? 1 : 0
  const speed = dev?.type === 'fan' ? level * 3.2 : 0
  const open = obj.window?.open ?? false
  const wallId = obj.wall?.wallId

  useFrame((_, dt) => {
    if (spin.current && speed > 0 && obj.kind === 'ceilingFan') spin.current.rotation.y += dt * speed
    if (outer.current && wallId) outer.current.visible = !(sceneApi.wallCut.get(wallId) ?? false)
  })

  return (
    <>
      <group
        ref={outer}
        position={obj.position}
        rotation={[0, obj.rotationY, 0]}
        onPointerDown={(e) => onObjectPointerDown(obj.id, e)}
        {...hover}
      >
        <group ref={spin}>
          <ObjectModel kind={obj.kind} dims={obj.dims} color={obj.color ?? CATALOG[obj.kind].color ?? '#cccccc'} glow={dev?.type === 'light' ? glow : 0} open={open} />
        </group>
        {/* invisible hit-box so thin models (tube light, wall fan) are easy to pick */}
        <mesh position={[0, obj.dims[1] / 2, 0]} visible={false}>
          <boxGeometry args={[Math.max(0.4, obj.dims[0]), Math.max(0.3, obj.dims[1]), Math.max(0.3, obj.dims[2])]} />
          <meshBasicMaterial />
        </mesh>
      </group>
      {dev && showMarkers && (
        <group position={[obj.position[0], 0, obj.position[2]]}>
          <DeviceMarker obj={obj} />
        </group>
      )}
    </>
  )
})

// ───────────────────────── layer ─────────────────────────

export function ObjectsLayer() {
  const objects = useEditor((s) => s.space!.objects)
  const { groups, singles } = useMemo(() => {
    const map = new Map<string, SceneObject[]>()
    const singles: SceneObject[] = []
    for (const o of objects) {
      if (isInstanced(o)) {
        const k = `${o.kind}|${o.dims.join(',')}|${o.color}`
        const a = map.get(k)
        if (a) a.push(o)
        else map.set(k, [o])
      } else if (o.visible) singles.push(o)
    }
    return { groups: [...map.entries()], singles }
  }, [objects])
  return (
    <group>
      {groups.map(([k, items]) => (
        <InstancedGroup key={k} items={items} />
      ))}
      {singles.map((o) => (
        <DeviceNode key={o.id} obj={o} />
      ))}
    </group>
  )
}

// ───────────────────────── selection ─────────────────────────

const footprintGeo = new THREE.PlaneGeometry(1, 1)

function Outline({ obj, color, fill = 0.22 }: { obj: SceneObject; color: string; fill?: number }) {
  const [w, h, d] = obj.dims
  const edges = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d)), [w, h, d])
  return (
    <group position={[obj.position[0], obj.position[1], obj.position[2]]} rotation={[0, obj.rotationY, 0]}>
      <mesh geometry={footprintGeo} rotation-x={-Math.PI / 2} position={[0, 0.015 - obj.position[1], 0]} scale={[w + 0.08, d + 0.08, 1]}>
        <meshBasicMaterial color={color} transparent opacity={fill} depthWrite={false} />
      </mesh>
      <lineSegments geometry={edges} position={[0, h / 2, 0]}>
        <lineBasicMaterial color={color} transparent opacity={0.95} depthTest={false} />
      </lineSegments>
    </group>
  )
}

function RotateHandle({ obj }: { obj: SceneObject }) {
  const r = Math.max(obj.dims[0], obj.dims[2]) / 2 + 0.35
  return (
    <group position={[obj.position[0], 0.03, obj.position[2]]} rotation={[0, obj.rotationY, 0]}>
      <mesh rotation-x={-Math.PI / 2}>
        <ringGeometry args={[r - 0.012, r + 0.012, 64]} />
        <meshBasicMaterial color="#2563eb" transparent opacity={0.45} depthWrite={false} />
      </mesh>
      <mesh
        position={[0, 0.02, r]}
        onPointerDown={(e) => beginRotate(obj.id, e)}
        onPointerOver={() => (document.body.style.cursor = 'grab')}
        onPointerOut={() => (document.body.style.cursor = '')}
      >
        <sphereGeometry args={[0.13, 16, 12]} />
        <meshBasicMaterial color="#2563eb" />
      </mesh>
      <mesh position={[0, 0.02, r]} rotation-x={Math.PI / 2}>
        <ringGeometry args={[0.17, 0.2, 24]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>
    </group>
  )
}

export function SelectionLayer() {
  const objects = useEditor((s) => s.space!.objects)
  const selection = useEditor((s) => s.selection)
  const invalid = useEditor((s) => s.invalidIds)
  const tool = useEditor((s) => s.tool)
  const hoverId = useHover((s) => s.objectId)
  const sel = objects.filter((o) => selection.includes(o.id))
  const hov = hoverId && !selection.includes(hoverId) ? objects.find((o) => o.id === hoverId) : undefined
  return (
    <group>
      {sel.map((o) => (
        <Outline key={o.id} obj={o} color={invalid.includes(o.id) ? '#ef4444' : '#2563eb'} fill={invalid.includes(o.id) ? 0.35 : 0.22} />
      ))}
      {hov && tool === 'select' && <Outline obj={hov} color="#60a5fa" fill={0.12} />}
      {sel.length === 1 && !sel[0].wall && !sel[0].locked && tool === 'select' && <RotateHandle obj={sel[0]} />}
    </group>
  )
}

// ───────────────────────── placement ghost ─────────────────────────

export function GhostLayer() {
  const ghost = useEditor((s) => s.ghost)
  const space = useEditor((s) => s.space)
  const snap = useEditor((s) => s.snap)
  const snapSize = useEditor((s) => s.snapSize)
  const cand = useMemo(() => (ghost && space ? candidateAt(space, ghost.kind, ghost.x, ghost.z, snap, snapSize) : null), [ghost, space, snap, snapSize])
  if (!cand?.obj) return null
  const o = cand.obj
  const color = cand.issue ? '#ef4444' : '#22c55e'
  return (
    <group>
      <group position={o.position} rotation={[0, o.rotationY, 0]}>
        <ObjectModel kind={o.kind} dims={o.dims} color={o.color ?? '#cccccc'} glow={0.6} />
      </group>
      <Outline obj={o} color={color} fill={0.4} />
    </group>
  )
}
