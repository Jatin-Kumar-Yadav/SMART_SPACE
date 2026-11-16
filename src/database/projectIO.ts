import { SCHEMA_VERSION, type Space, type StoredTexture } from '@/types'
import { newId } from '@/utils/math'
import { migrateSpace } from './migrate'
import type { SpaceRepository } from './repository'

export interface ProjectFile {
  format: 'smartspace3d'
  schemaVersion: number
  exportedAt: string
  space: Space
  textures: { id: string; name: string; type: string; dataUrl: string }[]
}

const blobToDataUrl = async (b: Blob) => {
  const bytes = new Uint8Array(await b.arrayBuffer())
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return `data:${b.type || 'application/octet-stream'};base64,${btoa(bin)}`
}

const dataUrlToBlob = async (url: string) => (await fetch(url)).blob()

export const referencedTextureIds = (s: Space): string[] =>
  [...new Set([s.floor.textureId, ...s.floorRegions.map((r) => r.material.textureId)].filter((x): x is string => !!x))]

/** Serialise a space together with every uploaded texture it uses. */
export async function exportProject(space: Space, repo: SpaceRepository): Promise<ProjectFile> {
  const textures: ProjectFile['textures'] = []
  for (const id of referencedTextureIds(space)) {
    const t = await repo.getTexture(id)
    if (t) textures.push({ id: t.id, name: t.name, type: t.blob.type, dataUrl: await blobToDataUrl(t.blob) })
  }
  return { format: 'smartspace3d', schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), space, textures }
}

export const serializeProject = (p: ProjectFile) => JSON.stringify(p)

/** Parse + migrate a project file. Does not touch the database. */
export function parseProject(json: string): ProjectFile {
  const raw = JSON.parse(json) as Partial<ProjectFile>
  if (raw.format !== 'smartspace3d') throw new Error('This file is not a SmartSpace 3D project.')
  return { ...(raw as ProjectFile), space: migrateSpace(raw.space), textures: raw.textures ?? [] }
}

/** Import a project as a NEW space (fresh ids so nothing is overwritten). */
export async function importProject(file: ProjectFile, repo: SpaceRepository): Promise<Space> {
  const idMap = new Map<string, string>()
  for (const t of file.textures) {
    const blob = await dataUrlToBlob(t.dataUrl)
    const saved = await repo.saveTexture(blob, t.name)
    idMap.set(t.id, saved.id)
  }
  const remap = (id?: string) => (id ? idMap.get(id) ?? id : id)
  const space: Space = {
    ...file.space,
    id: newId('space'),
    name: `${file.space.name} (imported)`,
    floor: { ...file.space.floor, textureId: remap(file.space.floor.textureId) },
    floorRegions: file.space.floorRegions.map((r) => ({ ...r, material: { ...r.material, textureId: remap(r.material.textureId) } })),
    updatedAt: Date.now(),
  }
  await repo.save(space)
  return space
}

export type { StoredTexture }
