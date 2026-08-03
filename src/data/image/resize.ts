/**
 * 商品写真の縮小（docs/design.md 9.2・タスク23）。
 *
 * **`domain/` ではなく `data/` に置く。** `canvas`・`createImageBitmap` という
 * ブラウザ API に依存するため、React にも通信にも DOM にも依存させない
 * `domain/` の方針（design 3.2）に反するため。
 *
 * アップロード前に必ずここを通す。原寸のまま送ると GAS の実行時間・Drive の
 * 容量・取得時の通信量のすべてを圧迫する。GAS 側（gas/ProductImages.js）にも
 * 200KB 相当の上限があるが、あれは改変されたクライアント向けの防波堤であり、
 * 通常の経路ではここで十分小さくしておく。
 */

/** 長辺の上限（px）。商品タイルの実効表示幅は最大168px、Retina 相当の2倍で320px あれば足りる */
export const MAX_IMAGE_EDGE_PX = 320

/** JPEG の品質。0.75 で1枚20〜40KB に収まる */
export const IMAGE_JPEG_QUALITY = 0.75

export const RESIZED_IMAGE_MIME_TYPE = 'image/jpeg'

export interface ResizedImage {
  /** 生の Base64 文字列。**`data:` 接頭辞は含まない**（GAS の入力仕様に合わせる） */
  base64: string
  mimeType: string
  width: number
  height: number
  /** 縮小後のおおよそのバイト数。UI での表示・上限チェックに使う */
  approximateBytes: number
}

/**
 * 画像ファイルを長辺 `MAX_IMAGE_EDGE_PX` 以内に縮小し、JPEG の Base64 で返す。
 * 元画像が既に十分小さい場合は拡大しない（`scale` を1で頭打ちにする）。
 *
 * 画像として読めないファイルを渡された場合は例外を投げる。呼び出し側で
 * 捕捉してユーザーにメッセージを出すこと。
 */
export async function resizeImageFile(file: File | Blob): Promise<ResizedImage> {
  const bitmap = await createImageBitmap(file)

  try {
    const scale = Math.min(1, MAX_IMAGE_EDGE_PX / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height

    const context = canvas.getContext('2d')
    if (!context) throw new Error('canvas の 2d コンテキストを取得できませんでした')

    // JPEG は透過を表現できず、透過部分が黒く落ちる。白で下地を敷いてから描く
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, width, height)
    context.drawImage(bitmap, 0, 0, width, height)

    const dataUrl = canvas.toDataURL(RESIZED_IMAGE_MIME_TYPE, IMAGE_JPEG_QUALITY)
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)

    return {
      base64,
      mimeType: RESIZED_IMAGE_MIME_TYPE,
      width,
      height,
      approximateBytes: Math.round((base64.length * 3) / 4),
    }
  } finally {
    // ImageBitmap は明示的に破棄しないとメモリが残る
    bitmap.close()
  }
}
