import * as THREE from 'three'
import type { RootState } from '@react-three/fiber'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'

/**
 * Bridge between React-DOM code (drag & drop from the library, toolbar) and the
 * R3F scene. The Canvas registers its state getter here.
 */
export const sceneApi: {
  get: (() => RootState) | null
  controls: OrbitControlsImpl | null
  /** wall id → currently cut away (dollhouse cut-away of walls facing the camera) */
  wallCut: Map<string, boolean>
} = { get: null, controls: null, wallCut: new Map() }

const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
const ray = new THREE.Raycaster()
const ndc = new THREE.Vector2()
const hit = new THREE.Vector3()

/** Intersect a client-space pointer position with the horizontal plane y = `y`. */
export function floorPointFromClient(clientX: number, clientY: number, y = 0): THREE.Vector3 | null {
  const s = sceneApi.get?.()
  if (!s) return null
  const rect = s.gl.domElement.getBoundingClientRect()
  ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -(((clientY - rect.top) / rect.height) * 2 - 1))
  ray.setFromCamera(ndc, s.camera)
  plane.constant = -y
  return ray.ray.intersectPlane(plane, hit) ? hit.clone() : null
}

export function setControlsEnabled(v: boolean) {
  if (sceneApi.controls) sceneApi.controls.enabled = v
}

/** Run `onMove` / `onEnd` from window pointer events until the button is released. */
export function trackPointer(onMove: (e: PointerEvent) => void, onEnd: (e: PointerEvent, moved: boolean) => void) {
  setControlsEnabled(false)
  let moved = false
  let sx: number | null = null
  let sy: number | null = null
  const move = (e: PointerEvent) => {
    if (sx === null) {
      sx = e.clientX
      sy = e.clientY
    }
    if (!moved && Math.hypot(e.clientX - sx, e.clientY - (sy ?? 0)) > 3) moved = true
    if (moved) onMove(e)
  }
  const up = (e: PointerEvent) => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', up)
    setControlsEnabled(true)
    document.body.style.cursor = ''
    onEnd(e, moved)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', up)
}
