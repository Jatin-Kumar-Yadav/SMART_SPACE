import { Canvas, useThree } from '@react-three/fiber'
import { useEffect, useRef, type DragEvent } from 'react'
import * as THREE from 'three'
import { candidateAt } from '@/objects/placement'
import { useEditor } from '@/store/editorStore'
import { useLayout } from '@/store/layoutStore'
import type { ObjectKind } from '@/types'
import { floorPointFromClient, sceneApi } from '../sceneApi'
import { CameraLayer } from '../overlays/CameraLayer'
import { CoverageLayer, FieldOverlay, ZoneLayer } from '../overlays/Fields'
import { DaylightLayer } from '../overlays/Daylight'
import { InfluenceLayer } from '../overlays/Influence'
import { CameraRig } from './CameraRig'
import { GhostLayer, ObjectsLayer, SelectionLayer } from './Objects'
import { PeopleLayer } from './People'
import { Ceiling, Floor, Ground, GridLines, WallCutter, Walls } from './Room'
import { WallTool } from './WallTool'

function Bridge() {
  const get = useThree((s) => s.get)
  useEffect(() => {
    sceneApi.get = get
    return () => {
      sceneApi.get = null
    }
  }, [get])
  return null
}

function Lights() {
  const dims = useEditor((s) => s.space!.dims)
  const light = useRef<THREE.DirectionalLight>(null)
  const { scene } = useThree()
  const r = Math.hypot(dims.length, dims.width) / 2 + 4
  useEffect(() => {
    const l = light.current
    if (!l) return
    l.target.position.set(dims.length / 2, 0, dims.width / 2)
    scene.add(l.target)
    l.target.updateMatrixWorld()
    return () => {
      scene.remove(l.target)
    }
  }, [dims.length, dims.width, scene])
  return (
    <>
      <hemisphereLight args={['#ffffff', '#cfd2d8', 1.05]} />
      <ambientLight intensity={0.25} />
      <directionalLight
        ref={light}
        position={[dims.length / 2 - r * 0.7, r * 1.35, dims.width / 2 + r * 0.9]}
        intensity={2.4}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-r}
        shadow-camera-right={r}
        shadow-camera-top={r}
        shadow-camera-bottom={-r}
        shadow-camera-near={1}
        shadow-camera-far={r * 5}
        shadow-bias={-0.0004}
        shadow-normalBias={0.04}
      />
    </>
  )
}

export function EditorCanvas() {
  const host = useRef<HTMLDivElement>(null)
  const setGhost = useEditor((s) => s.setGhost)

  const onDragOver = (e: DragEvent) => {
    const kind = useLayout.getState().dragKind
    if (!kind) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    const p = floorPointFromClient(e.clientX, e.clientY)
    const space = useEditor.getState().space
    if (!p || !space) return
    const st = useEditor.getState()
    const { issue } = candidateAt(space, kind, p.x, p.z, st.snap, st.snapSize)
    setGhost({ kind, x: p.x, z: p.z, valid: !issue, reason: issue ?? undefined })
  }
  const onDrop = (e: DragEvent) => {
    const kind = (useLayout.getState().dragKind ?? e.dataTransfer.getData('text/x-ss-kind')) as ObjectKind | ''
    useLayout.getState().set({ dragKind: null })
    setGhost(null)
    if (!kind) return
    e.preventDefault()
    const p = floorPointFromClient(e.clientX, e.clientY)
    if (p) useEditor.getState().addObject(kind, p.x, p.z)
  }

  return (
    <div ref={host} className="relative h-full w-full" onDragOver={onDragOver} onDrop={onDrop} onDragLeave={() => setGhost(null)}>
      <Canvas
        orthographic
        shadows
        dpr={[1, 1.75]}
        camera={{ position: [30, 40, 40], zoom: 20, near: 0.1, far: 500 }}
        gl={{ antialias: true, preserveDrawingBuffer: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05 }}
        onPointerMissed={() => undefined}
      >
        <color attach="background" args={['#dcdfe4']} />
        <Bridge />
        <CameraRig />
        <Lights />
        <Ground />
        <Floor />
        <GridLines />
        <Walls />
        <WallCutter />
        <Ceiling />
        <ObjectsLayer />
        <PeopleLayer />
        <FieldOverlay />
        <InfluenceLayer />
        <DaylightLayer />
        <ZoneLayer />
        <CoverageLayer />
        <CameraLayer />
        <SelectionLayer />
        <GhostLayer />
        <WallTool />
      </Canvas>
    </div>
  )
}
