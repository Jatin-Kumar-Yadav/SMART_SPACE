import { Html, OrbitControls } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { useMemo } from 'react'
import * as THREE from 'three'
import type { HardwarePlan } from '@/iot/types'
import { useEditor } from '@/store/editorStore'
import { useSim } from '@/store/simStore'

interface Hardware3DViewProps {
  plan: HardwarePlan | null
  ctrl: string | null
  wireFilter: 'all' | 'inputs' | 'outputs'
}

function Wire3D({ from, to, color }: { from: [number, number, number]; to: [number, number, number]; color: string }) {
  const lineObj = useMemo(() => {
    const geom = new THREE.BufferGeometry()
    const pts = new Float32Array([...from, ...to])
    geom.setAttribute('position', new THREE.BufferAttribute(pts, 3))
    const mat = new THREE.LineBasicMaterial({ color, linewidth: 2, transparent: true, opacity: 0.85 })
    return new THREE.Line(geom, mat)
  }, [from, to, color])

  return <primitive object={lineObj} />
}

function RoomFloorAndBounds({ L, W, H }: { L: number; W: number; H: number }) {
  const edgesGeom = useMemo(() => {
    const box = new THREE.BoxGeometry(L, H, W)
    return new THREE.EdgesGeometry(box)
  }, [L, W, H])

  return (
    <group>
      {/* Soft architectural floor */}
      <mesh position={[L / 2, 0, W / 2]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[L, W]} />
        <meshStandardMaterial color="#e2e8f0" roughness={0.8} />
      </mesh>

      {/* Wireframe boundary box */}
      <lineSegments position={[L / 2, H / 2, W / 2]} geometry={edgesGeom}>
        <lineBasicMaterial color="#94a3b8" linewidth={1.5} transparent opacity={0.65} />
      </lineSegments>
    </group>
  )
}

function Controller3D({
  position,
  label,
}: {
  position: [number, number, number]
  label: string
}) {
  return (
    <group position={position}>
      {/* Controller board PCB representation */}
      <mesh castShadow>
        <boxGeometry args={[0.1, 0.16, 0.08]} />
        <meshStandardMaterial color="#0f172a" roughness={0.5} metalness={0.6} />
      </mesh>
      {/* Metallic MCU shield */}
      <mesh position={[0, 0.02, 0.045]}>
        <boxGeometry args={[0.07, 0.07, 0.015]} />
        <meshStandardMaterial color="#94a3b8" metalness={0.9} roughness={0.2} />
      </mesh>

      <Html position={[0, 0.18, 0]} center style={{ pointerEvents: 'none' }} zIndexRange={[100, 0]}>
        <div className="rounded border border-slate-700 bg-slate-900/95 px-2 py-0.5 font-mono text-[11px] font-bold text-white shadow-md whitespace-nowrap">
          {label}
        </div>
      </Html>
    </group>
  )
}

function Actuator3D({
  type,
  name,
  position,
}: {
  type: string
  name: string
  position: [number, number, number]
}) {
  return (
    <group position={position}>
      {type === 'light' && (
        <mesh castShadow>
          <sphereGeometry args={[0.14, 16, 16]} />
          <meshStandardMaterial color="#fef08a" emissive="#eab308" emissiveIntensity={0.8} />
        </mesh>
      )}

      {type === 'fan' && (
        <group>
          <mesh castShadow>
            <cylinderGeometry args={[0.18, 0.18, 0.06, 16]} />
            <meshStandardMaterial color="#0284c7" roughness={0.4} />
          </mesh>
          <mesh position={[0, 0, 0]}>
            <boxGeometry args={[0.7, 0.015, 0.1]} />
            <meshStandardMaterial color="#38bdf8" />
          </mesh>
          <mesh position={[0, 0, 0]}>
            <boxGeometry args={[0.1, 0.015, 0.7]} />
            <meshStandardMaterial color="#38bdf8" />
          </mesh>
        </group>
      )}

      {type === 'ac' && (
        <mesh castShadow>
          <boxGeometry args={[0.42, 0.22, 0.22]} />
          <meshStandardMaterial color="#0284c7" roughness={0.5} />
        </mesh>
      )}

      <Html position={[0, -0.25, 0]} center style={{ pointerEvents: 'none' }} zIndexRange={[80, 0]}>
        <div className="rounded border border-slate-300 bg-white/95 px-1.5 py-0.5 text-[10px] font-medium text-slate-800 shadow-sm whitespace-nowrap">
          {name}
        </div>
      </Html>
    </group>
  )
}

function Sensor3D({
  kind,
  name,
  position,
  valDisplay,
}: {
  kind: string
  name: string
  position: [number, number, number]
  valDisplay: string
}) {
  const color = kind === 'temperature' ? '#ef4444' : kind === 'light' ? '#f59e0b' : '#10b981'
  const textColor = kind === 'temperature' ? 'text-red-700 border-red-200' : kind === 'light' ? 'text-amber-800 border-amber-200' : 'text-emerald-700 border-emerald-200'

  return (
    <group position={position}>
      <mesh castShadow>
        <sphereGeometry args={[0.08, 12, 12]} />
        <meshStandardMaterial color={color} roughness={0.3} />
      </mesh>

      <Html position={[0, 0.2, 0]} center style={{ pointerEvents: 'none' }} zIndexRange={[90, 0]}>
        <div className={`rounded border bg-white/95 px-1.5 py-0.5 text-[10px] font-semibold shadow-sm whitespace-nowrap ${textColor}`}>
          {name} · {valDisplay}
        </div>
      </Html>
    </group>
  )
}

export function Hardware3DView({ plan, ctrl, wireFilter }: Hardware3DViewProps) {
  const space = useEditor((s) => s.space)!
  const { length: L, width: W, height: H } = space.dims
  const snap = useSim((s) => s.snapshot)

  // Controller mounting position on the side wall
  const ctrlPos = useMemo<[number, number, number]>(() => {
    return [L - 0.05, Math.min(1.4, H * 0.5), W / 2]
  }, [L, W, H])

  const ctrlLabel = useMemo(() => {
    if (!plan || !ctrl) return 'ESP32 A'
    const c = plan.controllers.find((x) => x.id === ctrl)
    return c?.label ?? 'ESP32 A'
  }, [plan, ctrl])

  // Environmental devices from the space
  const devices = useMemo(() => {
    return space.objects.filter((o) => o.device && !space.hardware?.excludedDeviceIds?.includes(o.id))
  }, [space.objects, space.hardware?.excludedDeviceIds])

  // Sensor placement points from the hardware configuration
  const sensors = useMemo(() => {
    return space.hardware?.sensors ?? []
  }, [space.hardware?.sensors])

  // Live or default readings for sensor labels
  const avgTemp = snap?.stats.avgT ?? space.scenarios[0]?.initialTempC ?? 32
  const avgLux = snap?.stats.avgLux ?? 737

  const showOutputs = wireFilter === 'all' || wireFilter === 'outputs'
  const showInputs = wireFilter === 'all' || wireFilter === 'inputs'

  return (
    <div className="relative h-full w-full bg-slate-50">
      <Canvas
        camera={{
          fov: 42,
          position: [L * 1.6, H * 1.5, W * 1.6],
        }}
        shadows
        gl={{ antialias: true, alpha: true }}
      >
        <ambientLight intensity={0.7} />
        <directionalLight position={[L * 2, H * 3, W * 2]} intensity={1.5} castShadow />

        <OrbitControls
          target={[L / 2, H / 2.5, W / 2]}
          makeDefault
          minDistance={1.5}
          maxDistance={Math.max(L, W, H) * 5}
          maxPolarAngle={Math.PI / 2 + 0.08}
        />

        {/* 3D Room Box and Floor */}
        <RoomFloorAndBounds L={L} W={W} H={H} />

        {/* Controller 3D Node */}
        <Controller3D position={ctrlPos} label={ctrlLabel} />

        {/* 3D Devices (Actuators: Lights, Fans, ACs) */}
        {devices.map((d) => {
          const pos: [number, number, number] = [d.position[0], d.position[1], d.position[2]]
          return (
            <group key={d.id}>
              <Actuator3D type={d.device!.type} name={d.name} position={pos} />
              {showOutputs && (
                <Wire3D from={ctrlPos} to={pos} color="#16a34a" />
              )}
            </group>
          )
        })}

        {/* 3D Sensors (Inputs: DHT22, LDR, PIR) */}
        {sensors.map((s, idx) => {
          const pos: [number, number, number] = [s.position[0], s.position[1], s.position[2]]
          const valDisplay =
            s.kind === 'temperature'
              ? `${(avgTemp + (idx % 2 === 0 ? 0 : 0.4)).toFixed(1)} °C`
              : s.kind === 'light'
              ? `${Math.round(avgLux + (idx * 140) % 300)} lx`
              : 'motion'

          const wireColor = s.kind === 'temperature' ? '#2563eb' : s.kind === 'light' ? '#d97706' : '#9333ea'

          return (
            <group key={s.id}>
              <Sensor3D kind={s.kind} name={s.name} position={pos} valDisplay={valDisplay} />
              {showInputs && (
                <Wire3D from={ctrlPos} to={pos} color={wireColor} />
              )}
            </group>
          )
        })}
      </Canvas>

      {/* Floating Instructions/Legend helper */}
      <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-slate-200 bg-white/90 px-3 py-1.5 text-[11px] text-slate-600 shadow-sm backdrop-blur-sm">
        <span className="font-semibold text-slate-700">Digital Twin Wiring:</span>
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-3.5 rounded-full bg-green-600" />
          <span>Actuator Outputs (AC, Fan, Light)</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-3.5 rounded-full bg-blue-600" />
          <span>Temperature (DHT22)</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-3.5 rounded-full bg-amber-600" />
          <span>Light (LDR)</span>
        </span>
      </div>
    </div>
  )
}
