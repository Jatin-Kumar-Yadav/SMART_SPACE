/** Axis-aligned box in pixels: [x, y, width, height] (top-left origin). */
export type BBox = [number, number, number, number]

export const area = (b: BBox) => Math.max(0, b[2]) * Math.max(0, b[3])
export const center = (b: BBox): [number, number] => [b[0] + b[2] / 2, b[1] + b[3] / 2]

export function intersection(a: BBox, b: BBox): number {
  const w = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0])
  const h = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1])
  return w > 0 && h > 0 ? w * h : 0
}

export function iou(a: BBox, b: BBox): number {
  const i = intersection(a, b)
  const u = area(a) + area(b) - i
  return u > 0 ? i / u : 0
}

export const scaleBox = (b: BBox, sx: number, sy: number): BBox => [b[0] * sx, b[1] * sy, b[2] * sx, b[3] * sy]
