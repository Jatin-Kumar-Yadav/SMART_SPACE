import * as THREE from 'three'
import type { FloorMaterial, FloorPresetId } from '@/types'
import { mulberry32, rad, type Rng } from '@/utils/math'

export interface PresetInfo {
  id: FloorPresetId
  label: string
  /** physical size (m) of one repeat */
  tile: number
  roughness: number
  swatch: string
}

export const FLOOR_PRESETS: PresetInfo[] = [
  { id: 'ceramic', label: 'Ceramic', tile: 0.6, roughness: 0.3, swatch: '#ece8df' },
  { id: 'marble', label: 'Marble', tile: 1.2, roughness: 0.2, swatch: '#f1f1ef' },
  { id: 'wood', label: 'Wood', tile: 1.0, roughness: 0.55, swatch: '#c89b66' },
  { id: 'carpet', label: 'Carpet', tile: 1.0, roughness: 0.95, swatch: '#7c8aa6' },
  { id: 'concrete', label: 'Concrete', tile: 2.0, roughness: 0.85, swatch: '#a3a5a8' },
  { id: 'stone', label: 'Stone', tile: 1.2, roughness: 0.7, swatch: '#8d867c' },
  { id: 'vinyl', label: 'Vinyl', tile: 0.8, roughness: 0.4, swatch: '#cdd2d8' },
]

const SIZE = 512

function noise(ctx: CanvasRenderingContext2D, rng: Rng, amount: number, light = 255, dark = 0, count = 9000, max = 2.2) {
  for (let i = 0; i < count; i++) {
    const x = rng() * SIZE
    const y = rng() * SIZE
    const v = rng() > 0.5 ? light : dark
    ctx.fillStyle = `rgba(${v},${v},${v},${rng() * amount})`
    ctx.fillRect(x, y, 1 + rng() * max, 1 + rng() * max)
  }
}

/** The texture content is tileable: nothing is drawn across the edges except grout lines. */
function draw(id: FloorPresetId, ctx: CanvasRenderingContext2D, rng: Rng) {
  switch (id) {
    case 'ceramic': {
      const g = ctx.createLinearGradient(0, 0, SIZE, SIZE)
      g.addColorStop(0, '#f2eee6')
      g.addColorStop(1, '#e6e1d6')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, SIZE, SIZE)
      noise(ctx, rng, 0.05, 255, 90, 6000, 2)
      ctx.strokeStyle = '#c5bfb2'
      ctx.lineWidth = 6
      ctx.strokeRect(0, 0, SIZE, SIZE)
      ctx.strokeStyle = 'rgba(255,255,255,0.65)'
      ctx.lineWidth = 2
      ctx.strokeRect(5, 5, SIZE - 10, SIZE - 10)
      break
    }
    case 'marble': {
      ctx.fillStyle = '#f3f3f1'
      ctx.fillRect(0, 0, SIZE, SIZE)
      for (let i = 0; i < 9; i++) {
        ctx.beginPath()
        let x = rng() * SIZE
        let y = 0
        ctx.moveTo(x, y)
        while (y < SIZE) {
          x += (rng() - 0.5) * 70
          y += 20 + rng() * 30
          ctx.lineTo(x, y)
        }
        ctx.strokeStyle = `rgba(110,115,125,${0.08 + rng() * 0.2})`
        ctx.lineWidth = 0.6 + rng() * 2.2
        ctx.stroke()
      }
      noise(ctx, rng, 0.04, 255, 100, 4000)
      ctx.strokeStyle = '#d4d4d0'
      ctx.lineWidth = 4
      ctx.strokeRect(0, 0, SIZE, SIZE)
      break
    }
    case 'wood': {
      const planks = 5
      const h = SIZE / planks
      for (let p = 0; p < planks; p++) {
        const l = 62 + rng() * 10
        ctx.fillStyle = `hsl(${28 + rng() * 6}, ${42 + rng() * 10}%, ${l - 15 + rng() * 8}%)`
        ctx.fillRect(0, p * h, SIZE, h)
        for (let i = 0; i < 26; i++) {
          const y = p * h + rng() * h
          ctx.strokeStyle = `rgba(80,45,15,${0.05 + rng() * 0.12})`
          ctx.lineWidth = 0.6 + rng() * 1.4
          ctx.beginPath()
          ctx.moveTo(0, y)
          ctx.bezierCurveTo(SIZE * 0.3, y + (rng() - 0.5) * 8, SIZE * 0.6, y + (rng() - 0.5) * 8, SIZE, y)
          ctx.stroke()
        }
        ctx.fillStyle = 'rgba(40,20,5,0.45)'
        ctx.fillRect(0, p * h, SIZE, 2)
        const jx = rng() * SIZE
        ctx.fillRect(jx, p * h, 2, h)
      }
      break
    }
    case 'carpet': {
      ctx.fillStyle = '#7c8aa6'
      ctx.fillRect(0, 0, SIZE, SIZE)
      noise(ctx, rng, 0.35, 255, 20, 26000, 1.6)
      break
    }
    case 'concrete': {
      ctx.fillStyle = '#a6a8ab'
      ctx.fillRect(0, 0, SIZE, SIZE)
      for (let i = 0; i < 40; i++) {
        const r = 30 + rng() * 90
        const x = rng() * SIZE
        const y = rng() * SIZE
        const g = ctx.createRadialGradient(x, y, 0, x, y, r)
        const v = rng() > 0.5 ? 255 : 40
        g.addColorStop(0, `rgba(${v},${v},${v},0.08)`)
        g.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.fillStyle = g
        ctx.fillRect(x - r, y - r, r * 2, r * 2)
      }
      noise(ctx, rng, 0.12, 255, 30, 12000, 1.6)
      ctx.strokeStyle = 'rgba(60,60,60,0.35)'
      ctx.lineWidth = 3
      ctx.strokeRect(0, 0, SIZE, SIZE)
      break
    }
    case 'stone': {
      ctx.fillStyle = '#7e786f'
      ctx.fillRect(0, 0, SIZE, SIZE)
      const rows = 4
      const rh = SIZE / rows
      for (let r = 0; r < rows; r++) {
        let x = r % 2 ? -rng() * 80 : 0
        while (x < SIZE) {
          const w = 90 + rng() * 110
          ctx.fillStyle = `hsl(${30 + rng() * 10}, ${5 + rng() * 8}%, ${46 + rng() * 14}%)`
          ctx.fillRect(x + 3, r * rh + 3, w - 6, rh - 6)
          x += w
        }
      }
      noise(ctx, rng, 0.14, 255, 30, 9000)
      break
    }
    case 'vinyl': {
      ctx.fillStyle = '#d3d8de'
      ctx.fillRect(0, 0, SIZE, SIZE)
      ctx.fillStyle = 'rgba(255,255,255,0.35)'
      for (let i = 0; i < 4; i++) ctx.fillRect(0, i * 128, SIZE, 64)
      noise(ctx, rng, 0.06, 255, 80, 6000)
      ctx.strokeStyle = '#b6bcc4'
      ctx.lineWidth = 3
      ctx.strokeRect(0, 0, SIZE, SIZE)
      break
    }
  }
}

const presetCache = new Map<FloorPresetId, THREE.CanvasTexture>()

export function presetTexture(id: FloorPresetId): THREE.CanvasTexture {
  let t = presetCache.get(id)
  if (!t) {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = SIZE
    draw(id, canvas.getContext('2d')!, mulberry32(id.length * 7919 + id.charCodeAt(0)))
    t = new THREE.CanvasTexture(canvas)
    t.colorSpace = THREE.SRGBColorSpace
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.anisotropy = 8
    presetCache.set(id, t)
  }
  return t
}

/** Small data-URL swatch for UI previews. */
export function presetSwatch(id: FloorPresetId): string {
  return (presetTexture(id).image as HTMLCanvasElement).toDataURL('image/png')
}

/** Clone a source texture and apply the floor material's rotation / offset (UVs are in tile units). */
export function configureFloorTexture(src: THREE.Texture, m: FloorMaterial): THREE.Texture {
  const t = src.clone()
  t.needsUpdate = true
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  t.rotation = rad(m.rotation)
  t.center.set(0, 0)
  t.offset.set(m.offset[0], m.offset[1])
  return t
}

/** Plane whose UVs are measured in tiles, so rotation keeps tiles square for any room shape. */
export function floorGeometry(w: number, d: number, tile: number, stretch: boolean): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, d)
  g.rotateX(-Math.PI / 2)
  const pos = g.getAttribute('position')
  const uv = g.getAttribute('uv') as THREE.BufferAttribute
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + w / 2
    const z = pos.getZ(i) + d / 2
    uv.setXY(i, stretch ? x / w : x / tile, stretch ? 1 - z / d : 1 - z / tile)
  }
  uv.needsUpdate = true
  return g
}
