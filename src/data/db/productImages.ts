/**
 * 商品写真のローカルキャッシュ（docs/design.md 9.4・タスク22）。
 *
 * 主キーは画像ID（Drive のファイルID）。写真を差し替えると GAS 側が新しい
 * ファイルを作るためIDが変わる。したがって**「IDが一致する＝中身も同じ」**が
 * 常に成り立ち、キャッシュの鮮度を判定する仕組みを持たなくてよい。
 * 端末は「マスタが参照しているIDのうち、ここに無いものだけ」を取りに行く。
 *
 * 取得・破棄の制御は `data/sync/productImages.ts` の担当。この層は
 * テーブル操作だけを提供する。
 */

import type { CachedProductImage } from '@/domain/types'
import { db } from './schema'

/**
 * 1件取得し、表示に使える `Blob` に組み立てて返す。未取得なら `undefined`
 * （＝写真なしとして扱う）。保存は生バイトで行っている（`CachedProductImage`
 * のコメント参照）ため、Blob 化はこの読み出しの側で行う。
 */
export async function getProductImageBlob(imageId: string): Promise<Blob | undefined> {
  const record = await db.productImages.get(imageId)
  if (!record) return undefined
  return new Blob([record.bytes], { type: record.mimeType })
}

/** キャッシュ済みの画像IDをすべて返す。未取得ぶんの差分を出すのに使う */
export async function getCachedImageIds(): Promise<string[]> {
  return db.productImages.toCollection().primaryKeys()
}

/** 1件保存（同じIDなら中身も同じため、上書きしても等価） */
export async function putProductImage(
  imageId: string,
  bytes: ArrayBuffer,
  mimeType: string,
  now: Date = new Date(),
): Promise<void> {
  const record: CachedProductImage = { imageId, bytes, mimeType, fetchedAt: now.toISOString() }
  await db.productImages.put(record)
}

/**
 * どの商品からも参照されなくなった画像を削除する。
 * 端末の容量が単調増加しないようにするための後片付け（design 9.4）。
 */
export async function deleteUnreferencedImages(referencedIds: ReadonlySet<string>): Promise<number> {
  const cached = await getCachedImageIds()
  const orphans = cached.filter((id) => !referencedIds.has(id))
  if (orphans.length === 0) return 0

  await db.productImages.bulkDelete(orphans)
  return orphans.length
}

/** 全削除。端末登録のリセット等でキャッシュを捨てたい場合に使う */
export async function clearProductImages(): Promise<void> {
  await db.productImages.clear()
}
