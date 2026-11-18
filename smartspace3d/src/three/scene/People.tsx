import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { activeScenario, useEditor } from '@/store/editorStore'
import type { Occupant } from '@/types'
import { bakePerson, bucketMaterial, type BakedBucket } from '../bake'

const SKINS = ['#e0b48c', '#c68b59', '#8d5a3b', '#f1cfae']
const SHIRTS = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6', '#64748b', '#f97316', '#0ea5e9']

const hash = (s: string) => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _p = new THREE.Vector3()
const _s = new THREE.Vector3(1, 1, 1)
const _e = new THREE.Euler()
const _c = new THREE.Color()

function PersonBucket({ bucket, people, tinted }: { bucket: BakedBucket; people: Occupant[]; tinted: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null)
  const material = useMemo(() => bucketMaterial(bucket), [bucket])
  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    people.forEach((o, i) => {
      _p.set(o.position[0], o.position[1], o.position[2])
      _q.setFromEuler(_e.set(0, o.facing, 0))
      _m.compose(_p, _q, _s)
      mesh.setMatrixAt(i, _m)
      if (tinted) mesh.setColorAt(i, _c.set(SHIRTS[hash(o.id) % SHIRTS.length]))
    })
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [people, tinted])
  return <instancedMesh ref={ref} args={[bucket.geometry, material, people.length]} castShadow receiveShadow frustumCulled={false} raycast={() => null} />
}

/** Seated occupants drawn as instanced low-poly figures (one draw call per material bucket). */
export function PeopleLayer() {
  const occupants = useEditor((s) => activeScenario(s.space!).occupants)
  const show = useEditor((s) => s.showOccupants)
  const groups = useMemo(() => {
    const g: Occupant[][] = SKINS.map(() => [])
    for (const o of occupants) g[hash(o.id + 'skin') % SKINS.length].push(o)
    return g
  }, [occupants])
  if (!show || !occupants.length) return null
  return (
    <group>
      {groups.map((people, i) => {
        if (!people.length) return null
        const baked = bakePerson(SKINS[i])
        return (
          <group key={`${i}-${people.length}`}>
            {baked.shirt.map((b) => (
              <PersonBucket key={b.key} bucket={b} people={people} tinted />
            ))}
            {baked.fixed.map((b) => (
              <PersonBucket key={b.key} bucket={b} people={people} tinted={false} />
            ))}
          </group>
        )
      })}
    </group>
  )
}
