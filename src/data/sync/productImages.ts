/**
 * 商品写真の取得・後片付け（docs/design.md 9.4・タスク22）。
 *
 * マスタ取得の成功後にバックグラウンドで走らせる。**写真の取得完了を待って
 * 商品一覧の表示を止めない**（要件定義 9.1：写真はあくまで補助であり、
 * 取得可否が会計業務の可否を左右してはならない）。
 *
 * キャッシュキーが画像ID＝Drive のファイルIDであり、写真を差し替えると
 * IDが変わるため、ここでは「マスタが参照しているIDのうち手元に無いもの」を
 * 取りに行くだけでよい。古いキャッシュの判定は不要（design 9.4）。
 */

import { deleteUnreferencedImages, getCachedImageIds, putProductImage } from '@/data/db/productImages'
import { getProductImage } from '@/data/gas/endpoints'
import type { Product } from '@/domain/types'

/**
 * 一度の同期で取得する最大枚数。
 *
 * 写真は1件ずつ取得する（design 9.3）ため、初回のように未取得が大量にある
 * 場合、GAS への往復が枚数ぶん発生する。1回の同期で全部取り切ろうとすると
 * その間ずっと通信し続けることになるため上限を設ける。取り切れなかったぶんは
 * 次回のマスタ取得時に持ち越される（写真は補助表示なので遅れて揃ってよい）。
 */
const MAX_FETCH_PER_RUN = 20

export interface SyncProductImagesResult {
  /** 今回新たに取得できた枚数 */
  fetched: number
  /** 参照されなくなり削除した枚数 */
  pruned: number
  /** 上限・通信失敗により今回取得しきれなかった枚数 */
  remaining: number
}

/** `Product` の配列から、実際に参照されている画像IDの集合を作る */
function referencedImageIds(products: readonly Product[]): Set<string> {
  const ids = new Set<string>()
  for (const product of products) {
    if (product.imageId) ids.add(product.imageId)
  }
  return ids
}

/**
 * 商品写真のキャッシュをマスタの状態に合わせる。
 *
 * 通信に失敗した時点で打ち切り、既に取得できたぶんは保持する（部分的に
 * 揃った状態は正常。次回の呼び出しで続きを取る）。**失敗を例外として
 * 投げない**——呼び出し元はマスタ表示を優先し、写真の失敗で止まらないため。
 */
export async function syncProductImages(products: readonly Product[]): Promise<SyncProductImagesResult> {
  const referenced = referencedImageIds(products)

  // 先に後片付け。削除された商品・差し替えられた古い写真をここで捨てる
  const pruned = await deleteUnreferencedImages(referenced)

  const cached = new Set(await getCachedImageIds())
  const missing = [...referenced].filter((id) => !cached.has(id))
  const targets = missing.slice(0, MAX_FETCH_PER_RUN)

  let fetched = 0
  for (const imageId of targets) {
    const result = await getProductImage(imageId)
    if (!result.ok) {
      // オフライン・トークン失効など。ここで打ち切る（残りは次回に持ち越す）。
      // 画像が見つからない（VALIDATION_ERROR）ケースも同様に打ち切って構わない
      // ——写真なしとして表示できるため、リトライを急ぐ理由がない
      break
    }
    await putProductImage(imageId, base64ToBytes(result.data.imageBase64), result.data.mimeType)
    fetched += 1
  }

  return { fetched, pruned, remaining: missing.length - fetched }
}

/**
 * GAS から受け取った生の Base64 を `ArrayBuffer` に変換する。
 * `data:` 接頭辞は含まれない前提（gas/ProductImages.js の応答仕様）。
 */
export function base64ToBytes(base64: string): ArrayBuffer {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes.buffer
}
