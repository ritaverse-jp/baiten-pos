/**
 * マスタキャッシュ（`products`・`categories`）へのアクセサ。
 *
 * 正データはスプレッドシートであり、ここは端末側の複製にすぎない
 * （docs/design.md 8.3）。書き込みは「起動時・オンライン復帰時に GAS から
 * 再取得した内容で丸ごと置き換える」形のみを想定し、1件ずつの追加・更新は
 * 提供しない（編集自体はオンライン時に GAS を経由して行われ、その結果を
 * 反映するのは常に `getMasters` からの一括再取得であるため。設計 8.3・9.1）。
 */

import type { Category, Product } from '@/domain/types'
import { db } from './schema'

export async function getAllProducts(): Promise<Product[]> {
  return db.products.toArray()
}

export async function getAllCategories(): Promise<Category[]> {
  return db.categories.toArray()
}

/**
 * 商品マスタを丸ごと置き換える。クリアと書き込みを1トランザクションにまとめ、
 * 途中で中断してもキャッシュが空のまま残らないようにする。
 */
export async function replaceProducts(products: readonly Product[]): Promise<void> {
  await db.transaction('rw', db.products, async () => {
    await db.products.clear()
    await db.products.bulkPut(products as Product[])
  })
}

/** カテゴリマスタを丸ごと置き換える（`replaceProducts` と同じ理由で1トランザクション） */
export async function replaceCategories(categories: readonly Category[]): Promise<void> {
  await db.transaction('rw', db.categories, async () => {
    await db.categories.clear()
    await db.categories.bulkPut(categories as Category[])
  })
}
