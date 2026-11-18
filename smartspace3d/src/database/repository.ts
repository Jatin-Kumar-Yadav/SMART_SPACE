import { totalSeatCapacity } from '@/simulation/occupancy'
import { newId } from '@/utils/math'
import type { Space, SpaceSummary, StoredTexture } from '@/types'
import { SmartSpaceDB } from './db'
import { migrateSpace } from './migrate'

/**
 * Persistence boundary. The app only talks to this interface so the IndexedDB
 * implementation can later be swapped for an HTTP / PostgreSQL backend.
 */
export interface SpaceRepository {
  list(): Promise<SpaceSummary[]>
  get(id: string): Promise<Space | undefined>
  /** `touch: false` keeps `updatedAt` (used when only the thumbnail was generated) */
  save(space: Space, opts?: { touch?: boolean }): Promise<void>
  remove(id: string): Promise<void>
  duplicate(id: string): Promise<Space | undefined>
  rename(id: string, name: string): Promise<void>
  saveTexture(blob: Blob, name: string): Promise<StoredTexture>
  getTexture(id: string): Promise<StoredTexture | undefined>
  listTextures(): Promise<StoredTexture[]>
  removeTexture(id: string): Promise<void>
}

export const summarize = (s: Space): SpaceSummary => ({
  id: s.id,
  name: s.name,
  type: s.type,
  dims: s.dims,
  objectCount: s.objects.length,
  seatCapacity: totalSeatCapacity(s.objects),
  thumbnail: s.thumbnail,
  updatedAt: s.updatedAt,
})

export class DexieSpaceRepository implements SpaceRepository {
  private db: SmartSpaceDB

  constructor(db: SmartSpaceDB = new SmartSpaceDB()) {
    this.db = db
  }

  async list() {
    const rows = await this.db.spaces.orderBy('updatedAt').reverse().toArray()
    return rows.map((r) => summarize(migrateSpace(r.data)))
  }

  async get(id: string) {
    const row = await this.db.spaces.get(id)
    return row ? migrateSpace(row.data) : undefined
  }

  async save(space: Space, opts?: { touch?: boolean }) {
    const data: Space = opts?.touch === false ? space : { ...space, updatedAt: Date.now() }
    await this.db.spaces.put({ id: data.id, name: data.name, updatedAt: data.updatedAt, data })
  }

  async remove(id: string) {
    await this.db.spaces.delete(id)
  }

  async rename(id: string, name: string) {
    const s = await this.get(id)
    if (s) await this.save({ ...s, name })
  }

  async duplicate(id: string) {
    const s = await this.get(id)
    if (!s) return undefined
    const copy: Space = {
      ...structuredClone(s),
      id: newId('space'),
      name: `${s.name} (copy)`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    // scenarios & objects keep their ids (they are scoped to the space); only the space id changes
    await this.save(copy)
    return copy
  }

  async saveTexture(blob: Blob, name: string) {
    const tex: StoredTexture = { id: newId('tex'), name, blob, createdAt: Date.now() }
    await this.db.textures.put(tex)
    return tex
  }

  getTexture(id: string) {
    return this.db.textures.get(id)
  }

  listTextures() {
    return this.db.textures.orderBy('createdAt').reverse().toArray()
  }

  async removeTexture(id: string) {
    await this.db.textures.delete(id)
  }
}

let repo: SpaceRepository | null = null
export const getRepository = (): SpaceRepository => (repo ??= new DexieSpaceRepository())
export const setRepository = (r: SpaceRepository) => {
  repo = r
}
