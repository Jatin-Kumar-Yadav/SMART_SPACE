/** Smallest useful ZIP writer (stored, no compression) so exports need no extra dependency. */
const TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
export function crc32(b: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < b.length; i++) c = TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

export function makeZip(files: { name: string; data: string | Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder()
  const chunks: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  const u16 = (v: number) => [v & 255, (v >>> 8) & 255]
  const u32 = (v: number) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]
  const time = 0x6000 // 12:00
  const date = 0x5a21 // 2025-01-01
  for (const f of files) {
    const name = enc.encode(f.name)
    const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data
    const crc = crc32(data)
    const local = Uint8Array.from([0x50, 0x4b, 3, 4, ...u16(20), ...u16(0x0800), ...u16(0), ...u16(time), ...u16(date), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0)])
    chunks.push(local, name, data)
    central.push(Uint8Array.from([0x50, 0x4b, 1, 2, ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(time), ...u16(date), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)]), name)
    offset += local.length + name.length + data.length
  }
  const cdSize = central.reduce((n, c) => n + c.length, 0)
  const end = Uint8Array.from([0x50, 0x4b, 5, 6, ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cdSize), ...u32(offset), ...u16(0)])
  const all = [...chunks, ...central, end]
  const out = new Uint8Array(all.reduce((n, c) => n + c.length, 0))
  let p = 0
  for (const c of all) { out.set(c, p); p += c.length }
  return out
}
