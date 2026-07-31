// PWAアイコン生成（タスク20）。sharp/canvas等の画像ライブラリを追加せず、
// Node組み込みのzlibだけでPNGを直接エンコードする。
// 図案：16x16の論理グリッドに「¥」を描き、スケールして塗る。
// 使い方: node scripts/gen-icons.mjs public
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'

const BG = [0x1f, 0x29, 0x37] // #1f2937（アプリのヘッダー・テーマカラーと統一）
const FG = [0xff, 0xff, 0xff] // 白

// 16x16グリッドに「¥」を描く（1=前景）
function buildGlyphGrid() {
  const size = 16
  const grid = Array.from({ length: size }, () => new Array(size).fill(0))
  const set = (r, c) => {
    if (r >= 0 && r < size && c >= 0 && c < size) grid[r][c] = 1
  }
  // Yの上側の腕（左右の斜め線、太さ2）
  for (let r = 0; r <= 7; r++) {
    set(r, r + 1)
    set(r, r + 2)
    set(r, 13 - r)
    set(r, 14 - r)
  }
  // 縦の軸（太さ2）
  for (let r = 7; r <= 15; r++) {
    set(r, 7)
    set(r, 8)
  }
  // 横棒2本（円マークの二重線）
  for (const r of [10, 13]) {
    for (let c = 4; c <= 11; c++) set(r, c)
  }
  return grid
}

const GLYPH = buildGlyphGrid()

/**
 * @param {number} canvasSize 出力画像の一辺（px）
 * @param {number} glyphFraction 図案が占めるキャンバスの割合（マスカブルアイコンは余白を広めに取る）
 */
function renderPixels(canvasSize, glyphFraction) {
  const glyphPx = Math.round(canvasSize * glyphFraction)
  const offset = Math.floor((canvasSize - glyphPx) / 2)
  const cell = glyphPx / GLYPH.length

  const pixels = new Uint8Array(canvasSize * canvasSize * 4)
  for (let y = 0; y < canvasSize; y++) {
    for (let x = 0; x < canvasSize; x++) {
      let color = BG
      const gx = x - offset
      const gy = y - offset
      if (gx >= 0 && gy >= 0 && gx < glyphPx && gy < glyphPx) {
        const col = Math.floor(gx / cell)
        const row = Math.floor(gy / cell)
        if (GLYPH[row]?.[col]) color = FG
      }
      const i = (y * canvasSize + x) * 4
      pixels[i] = color[0]
      pixels[i + 1] = color[1]
      pixels[i + 2] = color[2]
      pixels[i + 3] = 255
    }
  }
  return pixels
}

function crc32(buf) {
  let c
  const table = crc32.table || (crc32.table = (() => {
    const t = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      t[n] = c >>> 0
    }
    return t
  })())
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii')
  const lenBuf = Buffer.alloc(4)
  lenBuf.writeUInt32BE(data.length, 0)
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf])
}

function encodePng(canvasSize, glyphFraction) {
  const pixels = renderPixels(canvasSize, glyphFraction)

  // スキャンラインごとにフィルタタイプ0（None）バイトを先頭に付ける
  const raw = Buffer.alloc(canvasSize * (1 + canvasSize * 4))
  for (let y = 0; y < canvasSize; y++) {
    raw[y * (1 + canvasSize * 4)] = 0
  }
  const pixelBuf = Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength)
  for (let y = 0; y < canvasSize; y++) {
    const rowStart = y * (1 + canvasSize * 4)
    pixelBuf.copy(raw, rowStart + 1, y * canvasSize * 4, (y + 1) * canvasSize * 4)
  }

  const idatData = deflateSync(raw, { level: 9 })

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(canvasSize, 0) // width
  ihdr.writeUInt32BE(canvasSize, 4) // height
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type: RGBA
  ihdr[10] = 0 // compression
  ihdr[11] = 0 // filter
  ihdr[12] = 0 // interlace

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', idatData), chunk('IEND', Buffer.alloc(0))])
}

const outDir = process.argv[2]
if (!outDir) {
  console.error('usage: node gen-icons.mjs <outDir>')
  process.exit(1)
}

const targets = [
  { file: 'pwa-192x192.png', size: 192, fraction: 0.82 },
  { file: 'pwa-512x512.png', size: 512, fraction: 0.82 },
  { file: 'maskable-icon-512x512.png', size: 512, fraction: 0.6 }, // マスカブルは余白を広く
  { file: 'apple-touch-icon.png', size: 180, fraction: 0.82 },
  { file: 'favicon.png', size: 64, fraction: 0.82 },
]

for (const t of targets) {
  const png = encodePng(t.size, t.fraction)
  writeFileSync(`${outDir}/${t.file}`, png)
  console.log(`wrote ${t.file} (${png.length} bytes)`)
}
