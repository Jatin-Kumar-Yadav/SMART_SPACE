#!/usr/bin/env node
/**
 * Downloads the person-detection model used by the Live Camera mode into public/models/.
 *
 *   npm run fetch-model
 *   npm run fetch-model -- --url <other .onnx url> --out yolov8n-person.onnx
 *
 * Default model: deepghs/yolo-person · yolov8n-person  (YOLOv8-nano, single class "person",
 * 640×640 input, ~12 MB). Ultralytics YOLO models are AGPL-3.0 and the Hugging Face repo carries a
 * model-distribution disclaimer license: check that this fits your use before shipping it.
 * The file is NOT bundled with the project and is never uploaded anywhere; the browser reads it
 * from your own dev server.
 */
import { mkdir, writeFile, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const url = arg('url', 'https://huggingface.co/deepghs/yolo-person/resolve/main/yolov8n-person/model.onnx')
const out = arg('out', 'yolov8n-person.onnx')
const dest = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'models', out)

console.log(`Downloading\n  ${url}\n→ ${dest}`)
const res = await fetch(url, { redirect: 'follow' })
if (!res.ok) {
  console.error(`Download failed: HTTP ${res.status} ${res.statusText}`)
  process.exit(1)
}
const buf = Buffer.from(await res.arrayBuffer())
if (buf.length < 1_000_000 || buf[0] === 0x3c /* '<' → an HTML error page */) {
  console.error(`The response (${buf.length} bytes) does not look like an ONNX model. Aborting.`)
  process.exit(1)
}
await mkdir(dirname(dest), { recursive: true })
await writeFile(dest, buf)
const { size } = await stat(dest)
console.log(`Saved ${(size / 1e6).toFixed(1)} MB. Restart nothing: the app picks it up on the next page load.`)
