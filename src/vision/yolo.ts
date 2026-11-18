import { iou, type BBox } from './geometry'
import type { Detection } from './tracker'

/**
 * Pure YOLO helpers (no DOM, no onnxruntime) so pre/post-processing is unit-testable
 * with synthetic tensors. Tested against the Ultralytics YOLOv8 export conventions:
 *   input  : [1, 3, S, S] float32, RGB, 0..1, letterboxed with grey (114) padding
 *   output : [1, 4 + nc, N]  (cx, cy, w, h, class scores…)   ← default YOLOv8 / YOLO11 export
 *            [1, N, 4 + nc]  (transposed variant)
 *            [1, N, 6]       (x1, y1, x2, y2, score, class)  ← NMS-free end-to-end exports
 */

export interface Letterbox {
  /** source → network scale */
  scale: number
  padX: number
  padY: number
  /** size of the resized image inside the S×S canvas */
  newW: number
  newH: number
  size: number
}

export function letterboxParams(srcW: number, srcH: number, size: number): Letterbox {
  const scale = Math.min(size / srcW, size / srcH)
  const newW = Math.round(srcW * scale)
  const newH = Math.round(srcH * scale)
  return { scale, newW, newH, padX: Math.floor((size - newW) / 2), padY: Math.floor((size - newH) / 2), size }
}

/** RGBA pixels of the already-letterboxed S×S image → planar CHW float32 in 0..1. */
export function rgbaToChw(rgba: ArrayLike<number>, size: number): Float32Array {
  const plane = size * size
  const out = new Float32Array(3 * plane)
  for (let i = 0; i < plane; i++) {
    out[i] = rgba[i * 4] / 255
    out[plane + i] = rgba[i * 4 + 1] / 255
    out[2 * plane + i] = rgba[i * 4 + 2] / 255
  }
  return out
}

export interface DecodeOptions {
  /** minimum score */
  conf: number
  /** NMS IoU threshold */
  iou: number
  /** index of the 'person' class (0 in COCO and in single-class person models) */
  personClass: number
  maxDetections: number
}

export const DEFAULT_DECODE: DecodeOptions = { conf: 0.35, iou: 0.45, personClass: 0, maxDetections: 100 }

/** Greedy non-maximum suppression. Boxes are [x, y, w, h]. */
export function nms(dets: Detection[], iouThr: number): Detection[] {
  const sorted = [...dets].sort((a, b) => b.score - a.score)
  const keep: Detection[] = []
  for (const d of sorted) if (keep.every((k) => iou(k.bbox, d.bbox) < iouThr)) keep.push(d)
  return keep
}

/** Map a box from letterboxed network pixels back to source-image pixels and clip it to the image. */
export function unletterbox(x1: number, y1: number, x2: number, y2: number, lb: Letterbox, srcW: number, srcH: number): BBox | null {
  const ax1 = Math.max(0, Math.min(srcW, (x1 - lb.padX) / lb.scale))
  const ay1 = Math.max(0, Math.min(srcH, (y1 - lb.padY) / lb.scale))
  const ax2 = Math.max(0, Math.min(srcW, (x2 - lb.padX) / lb.scale))
  const ay2 = Math.max(0, Math.min(srcH, (y2 - lb.padY) / lb.scale))
  const w = ax2 - ax1
  const h = ay2 - ay1
  return w >= 2 && h >= 2 ? [ax1, ay1, w, h] : null
}

export type OutputLayout = 'channels-first' | 'rows' | 'end-to-end'

export function detectLayout(dims: readonly number[]): OutputLayout {
  if (dims.length !== 3) throw new Error(`Unexpected detector output shape [${dims.join(', ')}]`)
  const [, a, b] = dims
  if (b === 6 && a > 6) return 'end-to-end'
  return a < b ? 'channels-first' : 'rows'
}

/** Decode a YOLO output tensor into person detections in SOURCE image pixels. */
export function decodeYolo(data: ArrayLike<number>, dims: readonly number[], lb: Letterbox, srcW: number, srcH: number, o: DecodeOptions = DEFAULT_DECODE): Detection[] {
  const layout = detectLayout(dims)
  const raw: Detection[] = []
  const push = (x1: number, y1: number, x2: number, y2: number, score: number) => {
    if (score < o.conf) return
    const b = unletterbox(x1, y1, x2, y2, lb, srcW, srcH)
    if (b) raw.push({ bbox: b, score })
  }
  if (layout === 'end-to-end') {
    const n = dims[1]
    for (let i = 0; i < n; i++) {
      const r = i * 6
      if (Math.round(data[r + 5]) !== o.personClass) continue
      push(data[r], data[r + 1], data[r + 2], data[r + 3], data[r + 4])
    }
    return raw.sort((a, b) => b.score - a.score).slice(0, o.maxDetections)
  }
  const channels = layout === 'channels-first' ? dims[1] : dims[2]
  const n = layout === 'channels-first' ? dims[2] : dims[1]
  const nc = channels - 4
  if (nc < 1 || o.personClass >= nc) throw new Error(`Model has ${nc} classes; person class ${o.personClass} does not exist`)
  const at = (ch: number, i: number) => (layout === 'channels-first' ? data[ch * n + i] : data[i * channels + ch])
  for (let i = 0; i < n; i++) {
    const score = at(4 + o.personClass, i)
    if (score < o.conf) continue
    const cx = at(0, i)
    const cy = at(1, i)
    const w = at(2, i)
    const h = at(3, i)
    push(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2, score)
  }
  return nms(raw, o.iou).slice(0, o.maxDetections)
}
