import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { migrateSpace } from '@/database/migrate'
import { exportProject, importProject, parseProject, serializeProject } from '@/database/projectIO'
import { DexieSpaceRepository } from '@/database/repository'
import { SmartSpaceDB } from '@/database/db'
import { createObject } from '@/objects/catalog'
import { createSpace } from '@/objects/spaceFactory'
import { SCHEMA_VERSION } from '@/types'

let repo: DexieSpaceRepository
beforeEach(() => {
  repo = new DexieSpaceRepository(new SmartSpaceDB(`test_${Math.random()}`))
})

describe('persistence', () => {
  it('saves and restores a space with objects, coordinates and rotations', async () => {
    const s = createSpace({ name: 'Hall', type: 'seminar-hall', dims: { length: 20, width: 15, height: 4 } })
    const chair = createObject('chair', 3.25, 4.5, s)
    chair.rotationY = 1.2
    s.objects.push(chair, createObject('ceilingFan', 5, 5, s))
    await repo.save(s)
    const back = await repo.get(s.id)
    expect(back?.objects).toHaveLength(2)
    expect(back?.objects[0].position).toEqual([3.25, 0, 4.5])
    expect(back?.objects[0].rotationY).toBe(1.2)
    expect(back?.objects[1].device?.type).toBe('fan')
  })

  it('keeps several spaces independent', async () => {
    const mk = (n: string) => createSpace({ name: n, type: 'custom', dims: { length: 5, width: 5, height: 3 } })
    const [a, b, c] = [mk('A'), mk('B'), mk('C')]
    b.objects.push(createObject('sofa', 1, 1, b))
    await Promise.all([a, b, c].map((s) => repo.save(s)))
    const list = await repo.list()
    expect(list.map((x) => x.name).sort()).toEqual(['A', 'B', 'C'])
    expect(list.find((x) => x.name === 'B')?.objectCount).toBe(1)
    expect(list.find((x) => x.name === 'A')?.objectCount).toBe(0)
    await repo.remove(a.id)
    expect((await repo.list()).length).toBe(2)
  })

  it('stores uploaded textures as blobs that survive a reload', async () => {
    const blob = new Blob(['hello'], { type: 'image/png' })
    const t = await repo.saveTexture(blob, 'tile.png')
    const got = await repo.getTexture(t.id)
    expect(got?.name).toBe('tile.png')
    expect(got?.blob.size).toBe(5)
  })

  it('exports and re-imports a project (JSON) with its textures and a new id', async () => {
    const s = createSpace({ name: 'Lab', type: 'custom', dims: { length: 6, width: 6, height: 3 } })
    const t = await repo.saveTexture(new Blob(['x'], { type: 'image/png' }), 'floor.png')
    s.floor.textureId = t.id
    await repo.save(s)
    const json = serializeProject(await exportProject(s, repo))
    const parsed = parseProject(json)
    expect(parsed.schemaVersion).toBe(SCHEMA_VERSION)
    const imported = await importProject(parsed, repo)
    expect(imported.id).not.toBe(s.id)
    expect(imported.floor.textureId).toBeTruthy()
    expect(imported.floor.textureId).not.toBe(t.id)
    expect((await repo.getTexture(imported.floor.textureId!))?.blob.size).toBe(1)
  })

  it('migrates old schema versions and rejects newer / invalid ones', () => {
    const old = { id: 'x', name: 'old', dims: { length: 5, width: 4, height: 3 }, objects: [], schemaVersion: 1 }
    const m = migrateSpace(old)
    expect(m.schemaVersion).toBe(SCHEMA_VERSION)
    expect(m.walls).toHaveLength(4)
    expect(m.scenarios).toHaveLength(1)
    expect(m.floor.tileSize).toBeGreaterThan(0)
    expect(() => migrateSpace({ ...old, schemaVersion: 999 })).toThrow()
    expect(() => parseProject('{"format":"nope"}')).toThrow()
  })
})
