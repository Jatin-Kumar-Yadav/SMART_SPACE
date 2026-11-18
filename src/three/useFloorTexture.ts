import { useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'
import { getRepository } from '@/database/repository'
import type { FloorMaterial } from '@/types'
import { configureFloorTexture, presetTexture } from './textures'

const uploaded = new Map<string, Promise<THREE.Texture | null>>()

/** Load an uploaded texture (stored as a Blob in IndexedDB) once and cache it. */
export function loadUploadedTexture(id: string): Promise<THREE.Texture | null> {
  let p = uploaded.get(id)
  if (!p) {
    p = getRepository()
      .getTexture(id)
      .then(
        (rec) =>
          new Promise<THREE.Texture | null>((resolve) => {
            if (!rec) return resolve(null)
            const url = URL.createObjectURL(rec.blob)
            new THREE.TextureLoader().load(
              url,
              (t) => {
                t.colorSpace = THREE.SRGBColorSpace
                resolve(t)
              },
              undefined,
              () => resolve(null),
            )
          }),
      )
    uploaded.set(id, p)
  }
  return p
}

/** Forget a cached upload (after it was deleted or replaced). */
export const forgetUploadedTexture = (id: string) => uploaded.delete(id)

/**
 * Texture for a floor material: a procedural preset or an uploaded image.
 * UVs of the floor geometry are measured in tiles, so the texture repeats
 * `size / tileSize` times across the floor.
 */
export function useFloorTexture(m: FloorMaterial): THREE.Texture | null {
  const [src, setSrc] = useState<THREE.Texture | null>(() => (m.textureId ? null : presetTexture(m.preset)))
  useEffect(() => {
    let alive = true
    if (m.textureId) {
      setSrc(null)
      loadUploadedTexture(m.textureId).then((t) => alive && setSrc(t ?? presetTexture(m.preset)))
    } else {
      setSrc(presetTexture(m.preset))
    }
    return () => {
      alive = false
    }
  }, [m.textureId, m.preset])
  return useMemo(() => (src ? configureFloorTexture(src, m) : null), [src, m.rotation, m.offset[0], m.offset[1]]) // eslint-disable-line react-hooks/exhaustive-deps
}
