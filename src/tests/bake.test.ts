import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { CATALOG } from '@/objects/catalog'
import { bakeModel, bakePerson } from '@/three/bake'
import { wallPieces } from '@/three/wallGeometry'
import { createObject } from '@/objects/catalog'
import { createSpace } from '@/objects/spaceFactory'
import { closestWall, placeOnWall } from '@/objects/spaceFactory'
import type { ObjectKind } from '@/types'

const bounds = (kind: ObjectKind) => {
  const e = CATALOG[kind]
  const box = new THREE.Box3()
  for (const b of bakeModel(kind, e.dims, e.color ?? '#999999')) {
    b.geometry.computeBoundingBox()
    box.union(b.geometry.boundingBox!)
  }
  return box
}

describe('model baking', () => {
  it('produces real geometry for every catalogued model', () => {
    for (const kind of Object.keys(CATALOG) as ObjectKind[]) {
      const buckets = bakeModel(kind, CATALOG[kind].dims, CATALOG[kind].color ?? '#999999')
      expect(buckets.length, kind).toBeGreaterThan(0)
      const verts = buckets.reduce((n, b) => n + b.geometry.getAttribute('position').count, 0)
      expect(verts, kind).toBeGreaterThan(24) // more than a single box
      expect(buckets[0].geometry.getAttribute('color'), kind).toBeTruthy()
    }
  })

  it('a chair has legs, a seat and a back-rest (multiple parts) and fits its footprint', () => {
    const box = bounds('chair')
    const [w, h, d] = CATALOG.chair.dims
    const size = box.getSize(new THREE.Vector3())
    expect(size.x).toBeLessThanOrEqual(w + 0.02)
    expect(size.z).toBeLessThanOrEqual(d + 0.02)
    expect(size.y).toBeGreaterThan(h * 0.9)
    const verts = bakeModel('chair', CATALOG.chair.dims, '#8a5a3b').reduce((n, b) => n + b.geometry.getAttribute('position').count, 0)
    expect(verts).toBeGreaterThanOrEqual(24 * 8) // ≥ 8 boxes
  })

  it('a dining table has a table-top and four legs reaching the floor', () => {
    const box = bounds('diningTable')
    expect(box.min.y).toBeCloseTo(0, 1)
    expect(box.max.y).toBeGreaterThan(CATALOG.diningTable.dims[1] - 0.01)
  })

  it('the person model splits into tintable shirt parts and fixed parts', () => {
    const p = bakePerson('#e0b48c')
    expect(p.shirt.length).toBeGreaterThan(0)
    expect(p.fixed.length).toBeGreaterThan(0)
  })
})

describe('wall pieces', () => {
  it('cuts a real opening for a window', () => {
    const space = createSpace({ name: 't', type: 'custom', dims: { length: 10, width: 8, height: 3 } })
    const win = createObject('window', 5, 0, space)
    const hit = closestWall(space.walls, 5, 0, 2)!
    const placed = placeOnWall(win, hit.wall, hit.offset, 1)
    const pieces = wallPieces(hit.wall, [placed])
    // two full-height piers + sill + lintel
    expect(pieces.length).toBe(4)
    const covered = pieces.reduce((a, p) => a + p.length * p.height, 0)
    const total = (10 + 0.4) * 3
    expect(covered).toBeLessThan(total - win.dims[0] * win.dims[1] + 1e-6 + 0.01)
  })
})
