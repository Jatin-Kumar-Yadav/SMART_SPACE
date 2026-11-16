import Dexie, { type Table } from 'dexie'
import type { Space, StoredTexture } from '@/types'

export interface SpaceRow {
  id: string
  name: string
  updatedAt: number
  data: Space
}

export class SmartSpaceDB extends Dexie {
  spaces!: Table<SpaceRow, string>
  textures!: Table<StoredTexture, string>

  constructor(name = 'smartspace3d') {
    super(name)
    this.version(1).stores({
      spaces: 'id, name, updatedAt',
      textures: 'id, name, createdAt',
    })
  }
}
