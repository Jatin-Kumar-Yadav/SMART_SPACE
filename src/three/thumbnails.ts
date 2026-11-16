import * as THREE from 'three'
import { CATALOG, CATALOG_LIST } from '@/objects/catalog'
import type { ObjectKind, Space } from '@/types'
import { wallYaw } from '@/utils/geometry'
import { bakeModel, bucketMaterial } from './bake'
import { configureFloorTexture, floorGeometry, presetTexture } from './textures'
import { wallPieces } from './wallGeometry'

/**
 * Offscreen renderers used for library icons and space thumbnails. They render
 * the *same* baked 3D models as the editor, so previews are real renders and
 * never flat icons.
 */

function makeRenderer(w: number, h: number, alpha: boolean) {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha, preserveDrawingBuffer: true })
  r.setSize(w, h, false)
  r.setPixelRatio(1)
  r.toneMapping = THREE.ACESFilmicToneMapping
  r.shadowMap.enabled = true
  r.shadowMap.type = THREE.PCFSoftShadowMap
  return r
}

function addLights(scene: THREE.Scene, span: number, center: THREE.Vector3) {
  scene.add(new THREE.HemisphereLight(0xffffff, 0xcfd2d8, 1.1))
  scene.add(new THREE.AmbientLight(0xffffff, 0.25))
  const sun = new THREE.DirectionalLight(0xffffff, 2.3)
  sun.position.set(center.x - span * 0.7, span * 1.4, center.z + span * 0.9)
  sun.target.position.copy(center)
  sun.castShadow = true
  sun.shadow.mapSize.set(1024, 1024)
  const c = sun.shadow.camera
  c.left = -span
  c.right = span
  c.top = span
  c.bottom = -span
  c.near = 1
  c.far = span * 6
  sun.shadow.bias = -0.0005
  sun.shadow.normalBias = 0.04
  scene.add(sun, sun.target)
}

const ISO = new THREE.Vector3(Math.sin((28 * Math.PI) / 180) * Math.cos((50 * Math.PI) / 180), Math.sin((50 * Math.PI) / 180), Math.cos((28 * Math.PI) / 180) * Math.cos((50 * Math.PI) / 180))

/** Fit an orthographic camera around a bounding box seen from the isometric direction. */
function fitCamera(box: THREE.Box3, aspect: number, margin = 1.12): THREE.OrthographicCamera {
  const c = box.getCenter(new THREE.Vector3())
  const s = box.getSize(new THREE.Vector3())
  const dist = Math.max(20, s.length() * 2)
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, dist * 4)
  cam.position.copy(c).addScaledVector(ISO, dist)
  cam.lookAt(c)
  cam.updateMatrixWorld()
  const inv = cam.matrixWorldInverse
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  const v = new THREE.Vector3()
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
    v.set(x, y, z).applyMatrix4(inv)
    minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x)
    minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y)
  }
  let w = (maxX - minX) * margin
  let h = (maxY - minY) * margin
  if (w / h < aspect) w = h * aspect
  else h = w / aspect
  const mx = (minX + maxX) / 2
  const my = (minY + maxY) / 2
  cam.left = mx - w / 2
  cam.right = mx + w / 2
  cam.top = my + h / 2
  cam.bottom = my - h / 2
  cam.updateProjectionMatrix()
  return cam
}

function modelGroup(kind: ObjectKind, dims: [number, number, number], color: string, glow = 0, open = false) {
  const g = new THREE.Group()
  for (const b of bakeModel(kind, dims, color, { glow, open })) {
    const m = new THREE.Mesh(b.geometry, bucketMaterial(b))
    m.castShadow = b.cast && b.opacity >= 1
    m.receiveShadow = true
    g.add(m)
  }
  return g
}

let iconCache: Record<string, string> | null = null

/** One 3D rendered icon per catalogue entry (cached). */
export function kindIcons(): Record<string, string> {
  if (iconCache) return iconCache
  const W = 176
  const H = 132
  const r = makeRenderer(W, H, true)
  const out: Record<string, string> = {}
  try {
    for (const e of CATALOG_LIST) {
      const scene = new THREE.Scene()
      const dims: [number, number, number] = [...e.dims]
      const g = modelGroup(e.kind, dims, e.color ?? '#999999', e.category === 'device' ? 0.9 : 0)
      // place wall / ceiling items in a sensible pose
      scene.add(g)
      const box = new THREE.Box3().setFromObject(g)
      const ground = new THREE.Mesh(new THREE.CircleGeometry(box.getSize(new THREE.Vector3()).length() * 0.7, 40), new THREE.ShadowMaterial({ opacity: 0.18 }))
      ground.rotation.x = -Math.PI / 2
      ground.position.set(box.getCenter(new THREE.Vector3()).x, box.min.y - 0.005, box.getCenter(new THREE.Vector3()).z)
      ground.receiveShadow = true
      if (e.mount !== 'ceiling') scene.add(ground)
      addLights(scene, box.getSize(new THREE.Vector3()).length(), box.getCenter(new THREE.Vector3()))
      const cam = fitCamera(box, W / H, 1.25)
      r.setClearColor(0x000000, 0)
      r.render(scene, cam)
      out[e.kind] = r.domElement.toDataURL('image/png')
      scene.traverse((o) => {
        if (o instanceof THREE.DirectionalLight && o.shadow?.map) o.shadow.map.dispose()
      })
    }
  } finally {
    r.dispose()
    r.forceContextLoss()
  }
  iconCache = out
  return out
}

/** Offscreen dollhouse render of a whole space, used for dashboard cards. */
export function renderSpaceThumbnail(space: Space, w = 480, h = 300): string {
  const r = makeRenderer(w, h, false)
  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#dcdfe4')
  const { length: L, width: W, height: H } = space.dims
  const center = new THREE.Vector3(L / 2, 0, W / 2)
  try {
    // floor
    const tex = configureFloorTexture(presetTexture(space.floor.preset), space.floor)
    const floor = new THREE.Mesh(floorGeometry(L, W, Math.max(0.05, space.floor.tileSize), space.floor.stretch), new THREE.MeshStandardMaterial({ map: tex, color: space.floor.tint, roughness: space.floor.roughness }))
    floor.position.set(L / 2, 0, W / 2)
    floor.receiveShadow = true
    scene.add(floor)
    for (const reg of space.floorRegions) {
      const t = configureFloorTexture(presetTexture(reg.material.preset), reg.material)
      const m = new THREE.Mesh(floorGeometry(reg.w, reg.d, Math.max(0.05, reg.material.tileSize), reg.material.stretch), new THREE.MeshStandardMaterial({ map: t, color: reg.material.tint, roughness: reg.material.roughness }))
      m.position.set(reg.x + reg.w / 2, 0.004, reg.z + reg.d / 2)
      m.receiveShadow = true
      scene.add(m)
    }
    // walls: the two walls facing the camera (south & east) are cut away
    const wallMat = new THREE.MeshStandardMaterial({ color: '#f3f1ec', roughness: 0.85 })
    const box = new THREE.BoxGeometry(1, 1, 1)
    const cutIds = new Set<string>()
    for (const wl of space.walls) {
      const cut = !!wl.perimeter && !!wl.outward && wl.outward[0] * ISO.x + wl.outward[1] * ISO.z > 0.3
      if (cut) cutIds.add(wl.id)
      const g = new THREE.Group()
      g.position.set(wl.a[0], 0, wl.a[1])
      g.rotation.y = wallYaw(wl)
      for (const p of wallPieces(wl, space.objects)) {
        const m = new THREE.Mesh(box, wallMat)
        m.position.set(p.x, p.y, 0)
        m.scale.set(p.length, p.height, wl.thickness)
        m.castShadow = true
        m.receiveShadow = true
        g.add(m)
      }
      if (cut) g.scale.y = Math.min(1, 0.14 / wl.height)
      scene.add(g)
    }
    // objects
    for (const o of space.objects) {
      if (!o.visible) continue
      if (o.wall && cutIds.has(o.wall.wallId)) continue
      const live = o.device?.type === 'light' ? (o.device.on ? 0.8 : 0) : 0
      const g = modelGroup(o.kind, o.dims, o.color ?? CATALOG[o.kind].color ?? '#999999', live, o.window?.open)
      g.position.set(o.position[0], o.position[1], o.position[2])
      g.rotation.y = o.rotationY
      scene.add(g)
    }
    // people
    const bbox = new THREE.Box3(new THREE.Vector3(-0.4, 0, -0.4), new THREE.Vector3(L + 0.4, H, W + 0.4))
    addLights(scene, Math.hypot(L, W) / 2 + 4, center)
    const cam = fitCamera(bbox, w / h, 1.08)
    r.render(scene, cam)
    return r.domElement.toDataURL('image/jpeg', 0.82)
  } finally {
    scene.traverse((o) => {
      if (o instanceof THREE.DirectionalLight && o.shadow?.map) o.shadow.map.dispose()
    })
    r.dispose()
    r.forceContextLoss()
  }
}
