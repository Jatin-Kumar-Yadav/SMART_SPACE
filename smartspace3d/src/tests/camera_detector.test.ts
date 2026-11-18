import { describe, expect, it } from 'vitest'
import { loadModelBytes, ModelMissingError } from '@/vision/detector'
import { decodeYolo, DEFAULT_DECODE, detectLayout, letterboxParams, nms, rgbaToChw, unletterbox } from '@/vision/yolo'

describe('letterbox', () => {
  it('fits a 1280×720 frame into 640×640 with vertical padding', () => {
    const lb = letterboxParams(1280, 720, 640)
    expect(lb.scale).toBe(0.5)
    expect([lb.newW, lb.newH, lb.padX, lb.padY]).toEqual([640, 360, 0, 140])
  })
  it('maps network boxes back to source pixels and clips to the image', () => {
    const lb = letterboxParams(1280, 720, 640)
    // network box (100,200)-(300,500)  → source (200,120)-(600,720)
    expect(unletterbox(100, 200, 300, 500, lb, 1280, 720)).toEqual([200, 120, 400, 600])
    expect(unletterbox(-50, 140, -10, 150, lb, 1280, 720)).toEqual(null) // entirely outside the image → clipped to nothing
    expect(unletterbox(0, 0, 640, 640, lb, 1280, 720)![1]).toBe(0)
  })
  it('converts RGBA to planar CHW in 0..1', () => {
    const rgba = new Uint8ClampedArray([255, 0, 128, 255, 0, 255, 0, 255, 10, 20, 30, 255, 0, 0, 0, 255])
    const t = rgbaToChw(rgba, 2)
    expect(t.length).toBe(12)
    expect(t[0]).toBe(1)
    expect(t[4]).toBe(0) // G plane starts at 4
    expect(t[5]).toBe(1)
    expect(t[8]).toBeCloseTo(128 / 255, 6) // B plane
  })
})

/** Build a synthetic [1, 4+nc, N] YOLOv8 tensor with the given boxes (network pixels). */
function tensor(boxes: { cx: number; cy: number; w: number; h: number; scores: number[] }[], nc: number, n = 50, transposed = false) {
  const ch = 4 + nc
  const data = new Float32Array(ch * n)
  boxes.forEach((b, i) => {
    const v = [b.cx, b.cy, b.w, b.h, ...b.scores]
    for (let c = 0; c < ch; c++) data[transposed ? i * ch + c : c * n + i] = v[c]
  })
  return { data, dims: transposed ? [1, n, ch] : [1, ch, n] }
}

describe('decodeYolo', () => {
  const lb = letterboxParams(1280, 720, 640)
  it('decodes a single-class person model, thresholds, and suppresses duplicates', () => {
    const { data, dims } = tensor([
      { cx: 200, cy: 350, w: 100, h: 200, scores: [0.9] },
      { cx: 204, cy: 352, w: 104, h: 204, scores: [0.7] }, // duplicate of the first
      { cx: 500, cy: 300, w: 80, h: 160, scores: [0.2] }, // below threshold
      { cx: 450, cy: 300, w: 80, h: 160, scores: [0.6] },
    ], 1)
    const dets = decodeYolo(data, dims, lb, 1280, 720)
    expect(dets.length).toBe(2)
    expect(dets[0].score).toBeCloseTo(0.9, 5)
    expect(dets[0].bbox[0]).toBeCloseTo((150 - 0) / 0.5, 3)
    expect(dets[0].bbox[1]).toBeCloseTo((250 - 140) / 0.5, 3)
    expect(dets[0].bbox[2]).toBeCloseTo(200, 3)
  })
  it('uses only the person class of an 80-class COCO model', () => {
    const scores = new Array(80).fill(0)
    const dog = [...scores]; dog[16] = 0.95
    const person = [...scores]; person[0] = 0.8
    const { data, dims } = tensor([{ cx: 200, cy: 300, w: 80, h: 160, scores: dog }, { cx: 400, cy: 300, w: 80, h: 160, scores: person }], 80, 8400)
    const dets = decodeYolo(data, dims, lb, 1280, 720)
    expect(dets.length).toBe(1)
    expect(dets[0].score).toBeCloseTo(0.8, 5)
  })
  it('understands the transposed [1,N,4+nc] layout and the NMS-free [1,N,6] layout', () => {
    expect(detectLayout([1, 5, 8400])).toBe('channels-first')
    expect(detectLayout([1, 8400, 5])).toBe('rows')
    expect(detectLayout([1, 300, 6])).toBe('end-to-end')
    const t = tensor([{ cx: 200, cy: 350, w: 100, h: 200, scores: [0.9] }], 1, 50, true)
    expect(decodeYolo(t.data, t.dims, lb, 1280, 720).length).toBe(1)
    const e2e = new Float32Array(300 * 6)
    e2e.set([100, 250, 300, 450, 0.88, 0], 0)
    e2e.set([100, 250, 300, 450, 0.99, 16], 6) // not a person
    const d = decodeYolo(e2e, [1, 300, 6], lb, 1280, 720)
    expect(d.length).toBe(1)
    expect(d[0].score).toBeCloseTo(0.88, 5)
  })
  it('returns nothing for an empty scene and rejects shapes it cannot interpret', () => {
    const { data, dims } = tensor([], 1)
    expect(decodeYolo(data, dims, lb, 1280, 720, DEFAULT_DECODE)).toEqual([])
    expect(() => detectLayout([1, 84])).toThrow()
  })
  it('nms keeps the higher score of overlapping boxes', () => {
    const k = nms([{ bbox: [0, 0, 100, 100], score: 0.5 }, { bbox: [5, 5, 100, 100], score: 0.9 }, { bbox: [300, 0, 50, 50], score: 0.4 }], 0.45)
    expect(k.map((d) => d.score)).toEqual([0.9, 0.4])
  })
})

describe('model loading', () => {
  const resp = (body: ArrayBuffer | string, type: string, status = 200) => async () => new Response(body, { status, headers: { 'content-type': type } })
  it('explains how to install the model when the file is missing', async () => {
    await expect(loadModelBytes('/models/x.onnx', resp('nope', 'text/plain', 404) as unknown as typeof fetch)).rejects.toBeInstanceOf(ModelMissingError)
    // a dev server answers unknown paths with index.html
    const err = await loadModelBytes('/models/x.onnx', resp('<!doctype html>' + ' '.repeat(200_000), 'text/html') as unknown as typeof fetch).catch((e) => e)
    expect(err).toBeInstanceOf(ModelMissingError)
    expect(err.message).toContain('npm run fetch-model')
  })
  it('accepts a binary model file', async () => {
    const buf = new Uint8Array(300_000).fill(8).buffer
    expect((await loadModelBytes('/m.onnx', resp(buf, 'application/octet-stream') as unknown as typeof fetch)).byteLength).toBe(300_000)
  })
})
