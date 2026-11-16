import { OrbitControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useEditor } from '@/store/editorStore'
import { sceneApi } from '../sceneApi'

/** Default dollhouse view: from the south-east, elevated ~50°. */
const ISO_AZIMUTH = (28 * Math.PI) / 180
const ISO_ELEVATION = (50 * Math.PI) / 180
const isoDir = () => new THREE.Vector3(Math.sin(ISO_AZIMUTH) * Math.cos(ISO_ELEVATION), Math.sin(ISO_ELEVATION), Math.cos(ISO_AZIMUTH) * Math.cos(ISO_ELEVATION))

export function CameraRig() {
  const camera = useThree((s) => s.camera) as THREE.OrthographicCamera
  const size = useThree((s) => s.size)
  const controls = useRef<React.ComponentRef<typeof OrbitControls>>(null)
  const cmd = useEditor((s) => s.cameraCmd)
  const viewMode = useEditor((s) => s.viewMode)
  const dims = useEditor((s) => s.space!.dims)
  const autoFit = useRef(true)
  const lastCmd = useRef<string>('')
  const lastDir = useRef<THREE.Vector3>(isoDir())

  const frame = (dir: THREE.Vector3) => {
    const { length: L, width: W, height: H } = dims
    const c = new THREE.Vector3(L / 2, H * 0.2, W / 2)
    const dist = Math.max(60, Math.hypot(L, W, H) * 2.2)
    camera.position.copy(c).addScaledVector(dir, dist)
    camera.near = 0.1
    camera.far = dist * 4
    camera.lookAt(c)
    camera.updateMatrixWorld()
    // fit the room's bounding box (in camera space) into the viewport
    const inv = camera.matrixWorldInverse
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    const v = new THREE.Vector3()
    for (const x of [0, L]) for (const y of [0, H]) for (const z of [0, W]) {
      v.set(x, y, z).applyMatrix4(inv)
      minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x)
      minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y)
    }
    const ex = Math.max(1, maxX - minX)
    const ey = Math.max(1, maxY - minY)
    camera.zoom = Math.max(0.5, Math.min(size.width / (ex * 1.18), size.height / (ey * 1.2)))
    camera.updateProjectionMatrix()
    const ctl = controls.current as unknown as { target: THREE.Vector3; update: () => void } | null
    if (ctl) {
      ctl.target.copy(c)
      ctl.update()
    }
  }

  // camera commands from the toolbar / keyboard
  useEffect(() => {
    if (!cmd) return
    const id = `${cmd.cmd}:${cmd.n}`
    if (id === lastCmd.current) return
    lastCmd.current = id
    autoFit.current = true
    if (cmd.cmd === 'top') lastDir.current = new THREE.Vector3(0, 1, 0.0001).normalize()
    else if (cmd.cmd === 'iso' || cmd.cmd === 'reset') lastDir.current = isoDir()
    else if (cmd.cmd === 'fit' && viewMode === '3d') {
      const d = camera.position.clone().sub((controls.current as unknown as { target: THREE.Vector3 })?.target ?? new THREE.Vector3()).normalize()
      if (Number.isFinite(d.x)) lastDir.current = d
    }
    frame(lastDir.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cmd])

  // keep the room fitted while the viewport is resized and the user has not moved the camera
  useEffect(() => {
    if (autoFit.current && size.width > 10) frame(lastDir.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.width, size.height, dims.length, dims.width, dims.height])

  useEffect(() => {
    sceneApi.controls = (controls.current as unknown as typeof sceneApi.controls) ?? null
    return () => {
      sceneApi.controls = null
    }
  }, [])

  useFrame(() => {
    // dollhouse cut-away needs the controls to stay in sync with the camera
    if (controls.current && sceneApi.controls !== (controls.current as unknown)) sceneApi.controls = controls.current as unknown as typeof sceneApi.controls
  })

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.14}
      enableRotate={viewMode === '3d'}
      maxPolarAngle={Math.PI / 2.02}
      minZoom={1}
      maxZoom={500}
      zoomSpeed={0.9}
      mouseButtons={{ LEFT: viewMode === '3d' ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }}
      onStart={() => {
        autoFit.current = false
      }}
    />
  )
}
