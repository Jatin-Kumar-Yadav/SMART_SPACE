import { Html, Line, OrbitControls } from '@react-three/drei'
import { Canvas, useFrame } from '@react-three/fiber'
import { memo, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { WIRE_COLOUR, wireClass } from '@/iot/manifest'
import { PARTS } from '@/iot/parts'
import type { HardwarePlan } from '@/iot/types'
import type { IotFilter } from '@/store/iotStore'
import type { Space, Vec3 } from '@/types'
import type { ArtState } from './art'

/** 3D hardware view: controllers, sensors and outputs at the coordinates of the room they belong to. */
interface Node { id: string; type: string; pos: Vec3; io: 'input' | 'output' | 'controller'; ctrl: string; label: string }

function useNodes(plan: HardwarePlan, space: Space) {
  return useMemo(() => {
    const nodes: Node[] = []
    for (const p of plan.parts) {
      const spec = PARTS[p.type]
      if (spec.category === 'expander') continue
      const sp = p.sensorId ? space.hardware?.sensors.find((s) => s.id === p.sensorId) : undefined
      const obj = p.virtual ? space.objects.find((o) => o.id === p.virtual!.objectId) : undefined
      const pos: Vec3 | null = sp ? sp.position : obj ? [obj.position[0], Math.max(0.4, obj.position[1]), obj.position[2]] : null
      if (pos) nodes.push({ id: p.id, type: p.type, pos, io: spec.category === 'actuator' ? 'output' : 'input', ctrl: p.controllerId, label: p.id })
    }
    for (const c of plan.controllers) {
      const mine = nodes.filter((n) => n.ctrl === c.id)
      const cx = mine.reduce((s, n) => s + n.pos[0], 0) / Math.max(1, mine.length)
      const cz = mine.reduce((s, n) => s + n.pos[2], 0) / Math.max(1, mine.length)
      const { length: L, width: W } = space.dims
      // park the controller on the nearest wall at 1.2 m, like a real wall-mounted enclosure
      const d = [cx, L - cx, cz, W - cz]
      const wall = d.indexOf(Math.min(...d))
      const pos: Vec3 = wall === 0 ? [0.15, 1.2, cz] : wall === 1 ? [L - 0.15, 1.2, cz] : wall === 2 ? [cx, 1.2, 0.15] : [cx, 1.2, W - 0.15]
      nodes.push({ id: c.id, type: 'controller', pos, io: 'controller', ctrl: c.id, label: `${c.label}${c.role && c.role !== 'standalone' ? ` (${c.role})` : ''}` })
    }
    return nodes
  }, [plan, space])
}

const LABEL_STYLE = { pointerEvents: 'none' as const }
const LabelTag = memo(function LabelTag({ pos, text, dim }: { pos: Vec3; text: string; dim: boolean }) {
  return (
    <Html position={pos} center distanceFactor={9} style={LABEL_STYLE}>
      <span className="whitespace-nowrap rounded bg-white/90 px-1 text-[9px] font-semibold text-slate-700 shadow" style={{ opacity: dim ? 0.25 : 1 }}>{text}</span>
    </Html>
  )
})

function Motor({ pos, duty, running, dim }: { pos: Vec3; duty: number; running: boolean; dim: boolean }) {
  const rotor = useRef<THREE.Group>(null)
  useFrame((_, dt) => { if (rotor.current && running) rotor.current.rotation.y += dt * duty * 30 })
  return (
    <group position={pos}>
      <mesh><cylinderGeometry args={[0.08, 0.08, 0.16, 16]} /><meshStandardMaterial color="#9ca3af" transparent opacity={dim ? 0.2 : 1} /></mesh>
      <group ref={rotor} position={[0, 0.12, 0]}>
        {[0, 1, 2].map((i) => <mesh key={i} rotation={[0, (i * Math.PI * 2) / 3, 0]} position={[0.12, 0, 0]}><boxGeometry args={[0.24, 0.015, 0.07]} /><meshStandardMaterial color="#60a5fa" transparent opacity={dim ? 0.2 : 1} /></mesh>)}
      </group>
    </group>
  )
}

function Scene({ plan, space, filter, selected, onSelect, art, running }: Props) {
  const nodes = useNodes(plan, space)
  const { length: L, width: W, height: H } = space.dims
  const box = useMemo(() => new THREE.BoxGeometry(L, H, W), [L, H, W])
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const dimOf = (n: Node) => (filter === 'inputs' && n.io === 'output') || (filter === 'outputs' && n.io === 'input')
  return (
    <>
      <ambientLight intensity={0.9} />
      <directionalLight position={[L, H * 3, W]} intensity={0.9} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[L / 2, 0, W / 2]}><planeGeometry args={[L, W]} /><meshBasicMaterial color="#e8edf3" side={THREE.DoubleSide} /></mesh>
      <lineSegments position={[L / 2, H / 2, W / 2]}><edgesGeometry args={[box]} /><lineBasicMaterial color="#94a3b8" /></lineSegments>
      {plan.parts.filter((p) => byId.has(p.id) && byId.has(p.controllerId)).map((p) => {
        const a = byId.get(p.controllerId)!
        const b = byId.get(p.id)!
        const net = plan.nets.find((n) => n.endpoints.some((e) => e.owner === p.id) && n.kind === 'signal') ?? plan.nets.find((n) => n.endpoints.some((e) => e.owner === p.id))
        const cls = net ? wireClass(net, plan.parts) : 'sensor'
        const hot = selected === p.id || selected === p.controllerId
        return <Line key={`w-${p.id}`} points={[a.pos, b.pos]} color={WIRE_COLOUR[cls]} lineWidth={hot ? 3 : 1.2} transparent opacity={dimOf(b) ? 0.12 : selected && !hot ? 0.25 : 0.9} />
      })}
      {nodes.map((n) => {
        const dim = dimOf(n)
        const sel = selected === n.id
        const st = art[n.id]
        const duty = st?.duty ?? 0
        const click = (e: { stopPropagation: () => void }) => { e.stopPropagation(); onSelect(sel ? null : n.id) }
        return (
          <group key={n.id} onClick={click} data-testid={`node-${n.id}`}>
            {n.io === 'controller' && <mesh position={n.pos}><boxGeometry args={[0.3, 0.2, 0.06]} /><meshStandardMaterial color="#1e3a8a" transparent opacity={dim ? 0.2 : 1} /></mesh>}
            {n.io === 'input' && <mesh position={n.pos}><sphereGeometry args={[0.1, 16, 16]} /><meshStandardMaterial color={n.type === 'bh1750' || n.type === 'ldr' ? '#f59e0b' : '#ef4444'} transparent opacity={dim ? 0.2 : 1} /></mesh>}
            {n.io === 'output' && n.type === 'led' && <mesh position={n.pos}><sphereGeometry args={[0.09 + duty * 0.05, 16, 16]} /><meshStandardMaterial color="#fde047" emissive="#fde047" emissiveIntensity={duty * 2} transparent opacity={dim ? 0.2 : 1} /></mesh>}
            {n.io === 'output' && n.type === 'dcMotor' && <Motor pos={n.pos} duty={duty} running={running} dim={dim} />}
            {sel && <mesh position={n.pos}><ringGeometry args={[0.22, 0.26, 24]} /><meshBasicMaterial color="#0f172a" side={THREE.DoubleSide} /></mesh>}
            <LabelTag pos={[n.pos[0], n.pos[1] + 0.25, n.pos[2]]} text={`${n.label}${st?.reading ? ` · ${st.reading}` : ''}`} dim={dim} />
          </group>
        )
      })}
    </>
  )
}

interface Props {
  plan: HardwarePlan
  space: Space
  filter: IotFilter
  selected: string | null
  onSelect: (id: string | null) => void
  art: Record<string, ArtState>
  running: boolean
}

export function Hardware3D(props: Props) {
  const { length: L, width: W, height: H } = props.space.dims
  return (
    <div className="h-full w-full bg-gradient-to-b from-slate-100 to-slate-200" data-testid="hardware-3d">
      <Canvas camera={{ position: [L * 1.1, H * 2.4, W * 1.8], fov: 45, near: 0.1, far: 500 }} onPointerMissed={() => props.onSelect(null)}>
        <OrbitControls target={[L / 2, H * 0.3, W / 2]} makeDefault />
        <Scene {...props} />
      </Canvas>
    </div>
  )
}
