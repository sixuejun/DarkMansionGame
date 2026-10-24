/**
 * 极简 ZIP 读写（不依赖任何第三方库）。
 * 写：本地文件头 + 中央目录 + EOCD，优先 deflate-raw 压缩。
 * 读：解析中央目录，按需解压。
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[i] = c >>> 0
  }
  return t
})()

/** CRC32 校验和 */
export function crc32(buf: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function dosStamp(d: Date): { time: number; date: number } {
  return {
    time: ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff,
    date: (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff,
  }
}

async function deflateRaw(u8: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === 'undefined') return null
  try {
    const s = new Blob([u8 as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw'))
    return new Uint8Array(await new Response(s).arrayBuffer())
  } catch {
    return null
  }
}

async function inflateRaw(u8: Uint8Array): Promise<Uint8Array> {
  const s = new Blob([u8 as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(s).arrayBuffer())
}

/** 待写入 ZIP 的文件 */
export interface ZipEntry {
  name: string
  data: Uint8Array
}

/** 打包成 ZIP */
export async function makeZip(files: ZipEntry[]): Promise<Blob> {
  const enc = new TextEncoder()
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  const stamp = dosStamp(new Date())
  let offset = 0

  for (const f of files) {
    const nameB = enc.encode(f.name)
    const raw = f.data
    const crc = crc32(raw)
    const packed = await deflateRaw(raw)
    const useDeflate = !!packed && packed.length < raw.length
    const method = useDeflate ? 8 : 0
    const body = useDeflate ? (packed as Uint8Array) : raw

    const lh = new Uint8Array(30 + nameB.length)
    const lv = new DataView(lh.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, 20, true)
    lv.setUint16(6, 0x0800, true)
    lv.setUint16(8, method, true)
    lv.setUint16(10, stamp.time, true)
    lv.setUint16(12, stamp.date, true)
    lv.setUint32(14, crc, true)
    lv.setUint32(18, body.length, true)
    lv.setUint32(22, raw.length, true)
    lv.setUint16(26, nameB.length, true)
    lh.set(nameB, 30)
    parts.push(lh, body)

    const ch = new Uint8Array(46 + nameB.length)
    const cv = new DataView(ch.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true)
    cv.setUint16(6, 20, true)
    cv.setUint16(8, 0x0800, true)
    cv.setUint16(10, method, true)
    cv.setUint16(12, stamp.time, true)
    cv.setUint16(14, stamp.date, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, body.length, true)
    cv.setUint32(24, raw.length, true)
    cv.setUint16(28, nameB.length, true)
    cv.setUint32(42, offset, true)
    ch.set(nameB, 46)
    central.push(ch)

    offset += lh.length + body.length
  }

  let cdSize = 0
  for (const c of central) cdSize += c.length
  const eocd = new Uint8Array(22)
  const ev = new DataView(eocd.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, files.length, true)
  ev.setUint16(10, files.length, true)
  ev.setUint32(12, cdSize, true)
  ev.setUint32(16, offset, true)

  return new Blob([...parts, ...central, eocd] as BlobPart[], { type: 'application/zip' })
}

/** 解析 ZIP，返回「文件名 → 二进制内容」 */
export async function readZip(input: ArrayBuffer | Uint8Array): Promise<Map<string, Uint8Array>> {
  const u8 = input instanceof Uint8Array ? input : new Uint8Array(input)
  const buf = u8.buffer
  const dv = new DataView(buf)
  const len = u8.byteLength
  let eocd = -1
  for (let i = len - 22; i >= Math.max(0, len - 66000); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('不是有效的 ZIP 文件')
  const total = dv.getUint16(eocd + 10, true)
  let p = dv.getUint32(eocd + 16, true)
  const enc = new TextDecoder()
  const out = new Map<string, Uint8Array>()

  for (let k = 0; k < total; k++) {
    if (p + 46 > len || dv.getUint32(p, true) !== 0x02014b50) break
    const method = dv.getUint16(p + 10, true)
    const compSize = dv.getUint32(p + 20, true)
    const nameLen = dv.getUint16(p + 28, true)
    const extraLen = dv.getUint16(p + 30, true)
    const cmtLen = dv.getUint16(p + 32, true)
    const local = dv.getUint32(p + 42, true)
    const name = enc.decode(new Uint8Array(buf, p + 46, nameLen))
    p += 46 + nameLen + extraLen + cmtLen

    if (local + 30 > len || dv.getUint32(local, true) !== 0x04034b50) break
    const lNameLen = dv.getUint16(local + 26, true)
    const lExtraLen = dv.getUint16(local + 28, true)
    const start = local + 30 + lNameLen + lExtraLen
    if (start + compSize > len) break
    const body = new Uint8Array(buf, start, compSize)
    const data = method === 8 ? await inflateRaw(body) : body
    out.set(name, data)
  }
  return out
}
