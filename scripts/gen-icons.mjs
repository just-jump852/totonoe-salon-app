// 整えサロンの簡易アプリアイコンを生成する。
// 依存を増やさないため、Node 標準の zlib だけで最小構成の PNG を書き出す。
// デザイン：モスグリーンの地に、真鍮色の水平ライン3本（「整う／整列」のイメージ）。
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')

const BG = [0x3f, 0x4a, 0x3d] // moss
const LINE = [0x9c, 0x7b, 0x3d] // brass

function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii')
  const body = Buffer.concat([typeBuf, data])
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}

function makePng(size) {
  const raw = Buffer.alloc(size * (size * 3 + 1))
  // 3本のラインの縦位置（中央に等間隔）
  const lineH = Math.round(size * 0.055)
  const gap = Math.round(size * 0.13)
  const centers = [-1, 0, 1].map((i) => Math.round(size / 2 + i * gap))
  const marginX = Math.round(size * 0.24)

  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 3 + 1)
    raw[rowStart] = 0 // filter: none
    const onLine = centers.some((c) => Math.abs(y - c) <= lineH / 2)
    for (let x = 0; x < size; x++) {
      const px = rowStart + 1 + x * 3
      const useLine = onLine && x >= marginX && x < size - marginX
      const col = useLine ? LINE : BG
      raw[px] = col[0]
      raw[px + 1] = col[1]
      raw[px + 2] = col[2]
    }
  }

  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // color type: truecolor
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  const idat = deflateSync(raw, { level: 9 })
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

for (const size of [192, 512]) {
  const out = join(OUT_DIR, `icon-${size}.png`)
  writeFileSync(out, makePng(size))
  console.log('wrote', out)
}
