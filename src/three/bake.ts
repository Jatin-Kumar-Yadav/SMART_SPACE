import { Fragment, isValidElement, type ReactElement, type ReactNode } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { ObjectKind, Vec3 } from '@/types'
import { MODELS, Person } from './models'

/**
 * Model baking.
 *
 * Every procedural model in `models.tsx` is a small tree of <group>/<mesh> JSX
 * built from boxes, cylinders and spheres. Rendering 120 chairs that way would
 * mean >1000 meshes. Instead we *walk* the element tree once (no React renderer
 * needed), transform every primitive into object space and merge the result
 * into a handful of BufferGeometries — one per material bucket. The scene then
 * draws them with InstancedMesh, so all chairs cost the same as one.
 */

export interface BakedBucket {
  key: string
  geometry: THREE.BufferGeometry
  roughness: number
  metalness: number
  opacity: number
  emissive: string | null
  emissiveIntensity: number
  doubleSided: boolean
  /** true when the bucket contains parts that were authored with castShadow */
  cast: boolean
}

interface Part {
  geometry: THREE.BufferGeometry
  color: THREE.Color
  roughness: number
  metalness: number
  opacity: number
  emissive: string | null
  emissiveIntensity: number
  doubleSided: boolean
  cast: boolean
}

type Props = Record<string, unknown>

const num3 = (v: unknown, d: number): [number, number, number] => {
  if (Array.isArray(v)) return [Number(v[0] ?? d), Number(v[1] ?? d), Number(v[2] ?? d)]
  if (typeof v === 'number') return [v, v, v]
  return [d, d, d]
}

function localMatrix(props: Props): THREE.Matrix4 {
  const p = props.position ? num3(props.position, 0) : [0, 0, 0]
  const r = props.rotation ? num3(props.rotation, 0) : [0, 0, 0]
  const s = props.scale !== undefined ? num3(props.scale, 1) : [1, 1, 1]
  return new THREE.Matrix4().compose(
    new THREE.Vector3(p[0], p[1], p[2]),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(r[0], r[1], r[2], 'XYZ')),
    new THREE.Vector3(s[0], s[1], s[2]),
  )
}

const kids = (children: unknown): ReactElement[] => {
  const out: ReactElement[] = []
  const visit = (c: unknown) => {
    if (Array.isArray(c)) c.forEach(visit)
    else if (isValidElement(c)) out.push(c)
  }
  visit(children)
  return out
}

function makeGeometry(el: ReactElement): THREE.BufferGeometry | null {
  const a = ((el.props as Props).args ?? []) as number[]
  switch (el.type) {
    case 'boxGeometry':
      return new THREE.BoxGeometry(...(a as [number, number, number]))
    case 'cylinderGeometry':
      return new THREE.CylinderGeometry(...(a as [number, number, number, number, number, boolean]))
    case 'sphereGeometry':
      return new THREE.SphereGeometry(...(a as [number, number, number]))
    case 'torusGeometry':
      return new THREE.TorusGeometry(...(a as [number, number, number, number]))
    default:
      return null
  }
}

function walk(node: ReactNode, m: THREE.Matrix4, out: Part[]): void {
  if (node === null || node === undefined || typeof node === 'boolean' || typeof node === 'string' || typeof node === 'number') return
  if (Array.isArray(node)) {
    node.forEach((n) => walk(n, m, out))
    return
  }
  if (!isValidElement(node)) return
  const el = node as ReactElement<Props>
  const { type, props } = el
  if (type === Fragment) return walk(props.children as ReactNode, m, out)
  if (typeof type === 'function') return walk((type as (p: Props) => ReactNode)(props), m, out)
  if (typeof type === 'object' && type !== null && 'type' in type) {
    return walk(((type as { type: (p: Props) => ReactNode }).type)(props), m, out)
  }
  if (type === 'group') return walk(props.children as ReactNode, m.clone().multiply(localMatrix(props)), out)
  if (type === 'mesh') {
    const children = kids(props.children)
    const geoEl = children.find((c) => typeof c.type === 'string' && c.type.endsWith('Geometry'))
    const matEl = children.find((c) => typeof c.type === 'string' && c.type.endsWith('Material'))
    if (!geoEl) return
    const geometry = makeGeometry(geoEl)
    if (!geometry) return
    geometry.applyMatrix4(m.clone().multiply(localMatrix(props)))
    const mp = (matEl?.props ?? {}) as Props
    out.push({
      geometry,
      color: new THREE.Color((mp.color as string) ?? '#ffffff'),
      roughness: typeof mp.roughness === 'number' ? mp.roughness : 1,
      metalness: typeof mp.metalness === 'number' ? mp.metalness : 0,
      opacity: mp.transparent ? (typeof mp.opacity === 'number' ? mp.opacity : 1) : 1,
      emissive: typeof mp.emissive === 'string' && Number(mp.emissiveIntensity ?? 0) > 0 ? (mp.emissive as string) : null,
      emissiveIntensity: Number(mp.emissiveIntensity ?? 0),
      doubleSided: mp.side === THREE.DoubleSide,
      cast: props.castShadow !== false,
    })
  }
}

/** Merge parts into material buckets (one merged geometry each, colours stored per vertex). */
function bucketize(parts: Part[], keyPrefix: string): BakedBucket[] {
  const groups = new Map<string, Part[]>()
  for (const p of parts) {
    const rough = Math.round(p.roughness * 4) / 4
    const metal = p.metalness > 0.3 ? 0.8 : 0
    const emi = p.emissive ? `${p.emissive}:${p.emissiveIntensity.toFixed(1)}` : 'none'
    const k = `${rough}|${metal}|${p.opacity.toFixed(2)}|${emi}|${p.doubleSided ? 2 : 1}|${p.cast ? 'c' : 'n'}`
    const arr = groups.get(k)
    if (arr) arr.push(p)
    else groups.set(k, [p])
  }
  const buckets: BakedBucket[] = []
  for (const [k, list] of groups) {
    const geos = list.map((p) => {
      const g = p.geometry.index ? p.geometry : p.geometry
      const n = g.getAttribute('position').count
      const col = new Float32Array(n * 3)
      for (let i = 0; i < n; i++) {
        col[i * 3] = p.color.r
        col[i * 3 + 1] = p.color.g
        col[i * 3 + 2] = p.color.b
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3))
      return g
    })
    const merged = mergeGeometries(geos, false)
    geos.forEach((g) => g.dispose())
    if (!merged) continue
    const f = list[0]
    buckets.push({
      key: `${keyPrefix}#${k}`,
      geometry: merged,
      roughness: Math.round(f.roughness * 4) / 4,
      metalness: f.metalness > 0.3 ? 0.8 : 0,
      opacity: f.opacity,
      emissive: f.emissive,
      emissiveIntensity: f.emissiveIntensity,
      doubleSided: f.doubleSided,
      cast: f.cast,
    })
  }
  return buckets
}

const cache = new Map<string, BakedBucket[]>()

export interface BakeOptions {
  glow?: number
  open?: boolean
}

/** Baked, merged geometry of one object model. Cached by kind + size + colour. */
export function bakeModel(kind: ObjectKind, dims: Vec3, color: string, opts: BakeOptions = {}): BakedBucket[] {
  const key = `${kind}|${dims.map((d) => d.toFixed(3)).join(',')}|${color}|${(opts.glow ?? 0).toFixed(2)}|${opts.open ? 1 : 0}`
  let hit = cache.get(key)
  if (!hit) {
    const parts: Part[] = []
    walk(MODELS[kind]({ dims, color, glow: opts.glow, open: opts.open }), new THREE.Matrix4(), parts)
    hit = bucketize(parts, key)
    if (kind === 'carpet') hit.forEach((b) => (b.cast = false))
    cache.set(key, hit)
  }
  return hit
}

export interface BakedPerson {
  /** parts whose colour is the shirt: tinted per instance */
  shirt: BakedBucket[]
  /** skin, hair, trousers, shoes: fixed colours */
  fixed: BakedBucket[]
}

const personCache = new Map<string, BakedPerson>()

export function bakePerson(skin: string): BakedPerson {
  let hit = personCache.get(skin)
  if (!hit) {
    const parts: Part[] = []
    walk((Person as unknown as { type: (p: Props) => ReactNode }).type({ tint: '#ffffff', skin }), new THREE.Matrix4(), parts)
    const isShirt = (p: Part) => p.color.getHex() === 0xffffff
    hit = {
      shirt: bucketize(parts.filter(isShirt), `person-shirt-${skin}`),
      fixed: bucketize(parts.filter((p) => !isShirt(p)), `person-fixed-${skin}`),
    }
    personCache.set(skin, hit)
  }
  return hit
}

const materialCache = new Map<string, THREE.MeshStandardMaterial>()

/** Shared material for a bucket (vertex colours carry the albedo). */
export function bucketMaterial(b: BakedBucket): THREE.MeshStandardMaterial {
  let m = materialCache.get(b.key.split('#')[1])
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: b.roughness,
      metalness: b.metalness,
      transparent: b.opacity < 1,
      opacity: b.opacity,
      emissive: b.emissive ? new THREE.Color(b.emissive) : new THREE.Color('#000000'),
      emissiveIntensity: b.emissiveIntensity,
      side: b.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
      depthWrite: b.opacity >= 1,
    })
    materialCache.set(b.key.split('#')[1], m)
  }
  return m
}
