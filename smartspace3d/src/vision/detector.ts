import type { DecodeOptions } from './yolo'
import type { Detection } from './tracker'
import type { WorkerIn, WorkerOut } from './detector.worker'

export type FrameSource = ImageBitmap | HTMLVideoElement | HTMLImageElement | HTMLCanvasElement

/** A person detector: boxes are in the SOURCE frame's pixels. Implementations never invent detections. */
export interface PersonDetector {
  readonly name: string
  detect(frame: FrameSource, opts?: Partial<DecodeOptions>): Promise<Detection[]>
  dispose(): void
}

export const DEFAULT_MODEL_FILE = 'yolov8n-person.onnx'
export const MODEL_URL: string = (import.meta.env.VITE_PERSON_MODEL_URL as string | undefined) ?? `/models/${DEFAULT_MODEL_FILE}`
export const FETCH_MODEL_COMMAND = 'npm run fetch-model'

/** The model file is not installed. The message carries the exact command to fix it. */
export class ModelMissingError extends Error {
  readonly command = FETCH_MODEL_COMMAND
  readonly url: string
  constructor(url: string, detail: string) {
    super(`Person-detection model not found at ${url} (${detail}). Run \`${FETCH_MODEL_COMMAND}\` in the project folder, then reload this page.`)
    this.name = 'ModelMissingError'
    this.url = url
  }
}

/** Download and sanity-check the model bytes. A dev server answers missing files with index.html, so check for that. */
export async function loadModelBytes(url = MODEL_URL, fetchFn: typeof fetch = fetch): Promise<ArrayBuffer> {
  let res: Response
  try {
    res = await fetchFn(url, { cache: 'force-cache' })
  } catch (e) {
    throw new ModelMissingError(url, e instanceof Error ? e.message : 'network error')
  }
  if (!res.ok) throw new ModelMissingError(url, `HTTP ${res.status}`)
  const type = res.headers.get('content-type') ?? ''
  const buf = await res.arrayBuffer()
  if (type.includes('text/html') || buf.byteLength < 100_000 || new Uint8Array(buf)[0] === 0x3c) throw new ModelMissingError(url, 'the server returned a web page instead of a model file')
  return buf
}

/** YOLO person detector running onnxruntime-web inside a Web Worker. */
export async function createOnnxPersonDetector(url = MODEL_URL, onStatus?: (s: string) => void): Promise<PersonDetector> {
  onStatus?.('Downloading model…')
  return createOnnxPersonDetectorFromBytes(await loadModelBytes(url), onStatus)
}

/** Same detector, from model bytes the user picked in the UI (no server file needed). */
export async function createOnnxPersonDetectorFromBytes(model: ArrayBuffer, onStatus?: (s: string) => void): Promise<PersonDetector> {
  if (model.byteLength < 100_000 || new Uint8Array(model)[0] === 0x3c) throw new Error('That file does not look like an ONNX model.')
  const worker = new Worker(new URL('./detector.worker.ts', import.meta.url), { type: 'module' })
  const pending = new Map<number, { ok: (d: Detection[]) => void; fail: (e: Error) => void }>()
  let nextId = 1
  let ready!: { ok: () => void; fail: (e: Error) => void }
  const readyP = new Promise<void>((ok, fail) => (ready = { ok, fail }))
  worker.onmessage = (ev: MessageEvent<WorkerOut>) => {
    const m = ev.data
    if (m.type === 'ready') ready.ok()
    else if (m.type === 'error') {
      if (m.id === undefined) ready.fail(new Error(m.message))
      else pending.get(m.id)?.fail(new Error(m.message))
      if (m.id !== undefined) pending.delete(m.id)
    } else {
      pending.get(m.id)?.ok(m.dets)
      pending.delete(m.id)
    }
  }
  worker.onerror = (e) => ready.fail(new Error(e.message || 'detector worker crashed'))
  onStatus?.('Starting inference engine…')
  worker.postMessage({ type: 'init', model } satisfies WorkerIn, [model])
  await readyP
  onStatus?.('Model ready')
  return {
    name: 'YOLOv8-nano person (onnxruntime-web, WASM)',
    async detect(frame, opts) {
      const bitmap = frame instanceof ImageBitmap ? frame : await createImageBitmap(frame)
      return new Promise<Detection[]>((ok, fail) => {
        const id = nextId++
        pending.set(id, { ok, fail })
        worker.postMessage({ type: 'detect', id, bitmap, opts } satisfies WorkerIn, [bitmap])
      })
    },
    dispose() {
      worker.terminate()
      for (const p of pending.values()) p.fail(new Error('detector stopped'))
      pending.clear()
    },
  }
}
