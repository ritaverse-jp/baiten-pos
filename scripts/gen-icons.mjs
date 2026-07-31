// PWAアイコン生成（タスク20）。sharp/canvas等の画像ライブラリを追加せず、
// Node組み込みのzlibだけでPNGを直接エンコードする。
//
// 図案：中央の白い円（コインのモチーフ）のみ。当初「¥」を16x16のドット絵で
// 描いていたが、ファビコンサイズまで縮小すると斜め線の階段状のギザギザが
// 虫の脚のように見えるという指摘を受け、単純な円に変更した（タスク20）。
// 円はどんな解像度でも階段状になりにくく、判読性の問題が起きにくい。
//
// 使い方: node scripts/gen-icons.mjs public
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'

const BG = [0x1f, 0x29, 0x37] // #1f2937（アプリのヘッダー・テーマカラーと統一）
const FG = [0xff, 0xff, 0xff] // 白

/** スーパーサンプリングの倍率。最終出力の何倍かで内部レンダリングし、
 * 縮小時に平均化することでアンチエイリアスをかける（階段状のギザギザを防ぐ） */
const SUPERSAMPLE = 4

/**
 * @param {number} x 0〜1に正規化したx座標（キャンバス左上原点）
 * @param {number} y 0〜1に正規化したy座標
 * @param {number} radiusFraction 円の半径（キャンバス一辺に対する比率）
 */
function isInsideCircle(x, y, radiusFraction) {
  const dx = x - 0.5
  const dy = y - 0.5
  return Math.sqrt(dx * dx + dy * dy) <= radiusFraction
}

/**
 * @param {number} canvasSize 出力画像の一辺（px）
 * @param {number} radiusFraction 円の半径（マスカブルアイコンは余白を広めに取るため小さくする）
 */
function renderPixels(canvasSize, radiusFraction) {
  const ssSize = canvasSize * SUPERSAMPLE
  const ss = new Uint8Array(ssSize * ssSize) // 1=前景, 0=背景

  for (let y = 0; y < ssSize; y++) {
    for (let x = 0; x < ssSize; x++) {
      const nx = (x + 0.5) / ssSize
      const ny = (y + 0.5) / ssSize
      ss[y * ssSize + x] = isInsideCircle(nx, ny, radiusFraction) ? 1 : 0
    }
  }

  const pixels = new Uint8Array(canvasSize * canvasSize * 4)
  const samplesPerPixel = SUPERSAMPLE * SUPERSAMPLE
  for (let y = 0; y < canvasSize; y++) {
    for (let x = 0; x < canvasSize; x++) {
      let filled = 0
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          filled += ss[(y * SUPERSAMPLE + sy) * ssSize + (x * SUPERSAMPLE + sx)]
        }
      }
      const t = filled / samplesPerPixel // 0〜1のカバレッジ（アンチエイリアス用）
      const i = (y * canvasSize + x) * 4
      pixels[i] = BG[0] + (FG[0] - BG[0]) * t
      pixels[i + 1] = BG[1] + (FG[1] - BG[1]) * t
      pixels[i + 2] = BG[2] + (FG[2] - BG[2]) * t
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

function encodePng(canvasSize, radiusFraction) {
  const pixels = renderPixels(canvasSize, radiusFraction)

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
  { file: 'pwa-192x192.png', size: 192, radiusFraction: 0.38 },
  { file: 'pwa-512x512.png', size: 512, radiusFraction: 0.38 },
  { file: 'maskable-icon-512x512.png', size: 512, radiusFraction: 0.28 }, // マスカブルは余白を広く
  { file: 'apple-touch-icon.png', size: 180, radiusFraction: 0.38 },
  { file: 'favicon.png', size: 64, radiusFraction: 0.38 },
]

for (const t of targets) {
  const png = encodePng(t.size, t.radiusFraction)
  writeFileSync(`${outDir}/${t.file}`, png)
  console.log(`wrote ${t.file} (${png.length} bytes)`)
}
