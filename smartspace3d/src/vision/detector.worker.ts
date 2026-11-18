/// <reference lib="webworker" />
/**
 * Runs the YOLO person model off the main thread with onnxruntime-web (WASM, single thread so no
 * cross-origin-isolation headers are needed). Receives the model bytes once, then frames as ImageBitmaps.
 */
import * as ort from 'onnxruntime-web/wasm'
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url'
import { decodeYolo, DEFAULT_DECODE, letterboxParams, rgbaToChw, type DecodeOptions } from './yolo'

export type WorkerIn =
  | { type: 'init'; model: ArrayBuffer }
  | { type: 'detect'; id: number; bitmap: ImageBitmap; opts?: Partial<DecodeOptions> }
export type WorkerOut =
  | { type: 'ready'; input: string; inputSize: number; output: string }
  | { type: 'error'; id?: number; message: string }
  | { type: 'result'; id: number; dets: { bbox: [number, number, number, number]; score: number }[]; ms: number }

let session: ort.InferenceSession | null = null
let inputName = 'images'
let size = 640
const post = (m: WorkerOut) => (self as unknown as Worker).postMessage(m)

self.onmessage = async (ev: MessageEvent<WorkerIn>) => {
  const msg = ev.data
  try {
    if (msg.type === 'init') {
      ort.env.wasm.numThreads = 1
      ort.env.wasm.wasmPaths = { wasm: wasmUrl }
      session = await ort.InferenceSession.create(msg.model, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' })
      inputName = session.inputNames[0]
      // static shape models report [1,3,S,S]; dynamic ones report names → keep 640
      const dims = (session as unknown as { inputMetadata?: Record<string, { shape?: (number | string)[] }> }).inputMetadata?.[inputName]?.shape
      if (dims && typeof dims[3] === 'number') size = dims[3]
      post({ type: 'ready', input: inputName, inputSize: size, output: session.outputNames[0] })
    } else if (msg.type === 'detect') {
      if (!session) throw new Error('Model not loaded')
      const t0 = performance.now()
      const { bitmap } = msg
      const lb = letterboxParams(bitmap.width, bitmap.height, size)
      const canvas = new OffscreenCanvas(size, size)
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!
      ctx.fillStyle = 'rgb(114,114,114)'
      ctx.fillRect(0, 0, size, size)
      ctx.drawImage(bitmap, lb.padX, lb.padY, lb.newW, lb.newH)
      const w = bitmap.width
      const h = bitmap.height
      bitmap.close()
      const input = new ort.Tensor('float32', rgbaToChw(ctx.getImageData(0, 0, size, size).data, size), [1, 3, size, size])
      const out = await session.run({ [inputName]: input })
      const t = out[session.outputNames[0]]
      const dets = decodeYolo(t.data as Float32Array, t.dims, lb, w, h, { ...DEFAULT_DECODE, ...msg.opts })
      post({ type: 'result', id: msg.id, dets, ms: performance.now() - t0 })
    }
  } catch (e) {
    post({ type: 'error', id: msg.type === 'detect' ? msg.id : undefined, message: e instanceof Error ? e.message : String(e) })
  }
}
