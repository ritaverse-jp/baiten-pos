/**
 * IndexedDB スキーマ（Dexie）。
 *
 * データベースは1つに統一する。IndexedDB の接続はデータベース単位で管理されるため、
 * 機能ごとに複数のデータベースへ分けると接続・バージョン管理が煩雑になる。
 * docs/design.md 3.3 の7テーブルをすべてこのファイルに集約する。
 *
 * 各テーブルへのアクセサは `data/db/` 配下にテーブルごとのファイルで分ける
 * （`masters.ts`・`currentTicket.ts`・`sales.ts`・`pendingQueue.ts`・`config.ts`。
 * `counters` のみ、連番の排他制御と一体のため `data/sync/counter.ts` に置く）。
 */

import Dexie, { type EntityTable } from 'dexie'
import type {
  AppConfig,
  CachedProductImage,
  Category,
  PendingSale,
  Product,
  SaleRecord,
  SeqCounter,
  Ticket,
} from '@/domain/types'

/**
 * `currentTicket` テーブルの主キー。
 *
 * 伝票は常に1件しか存在しない（入力中の伝票はこの端末のものだけ）ため、
 * 固定のキーを使う。`Ticket`（ドメイン型）自体には DB 固有のキーを持たせず、
 * 永続化の境界（`data/db/currentTicket.ts`）でだけこの形に変換する。
 */
export const CURRENT_TICKET_ID = 'current'
export interface StoredTicket extends Ticket {
  id: typeof CURRENT_TICKET_ID
}

export class AppDatabase extends Dexie {
  products!: EntityTable<Product, 'no'>
  categories!: EntityTable<Category, 'name'>
  currentTicket!: EntityTable<StoredTicket, 'id'>
  sales!: EntityTable<SaleRecord, 'saleId'>
  pendingQueue!: EntityTable<PendingSale, 'saleId'>
  counters!: EntityTable<SeqCounter, 'dateKey'>
  config!: EntityTable<AppConfig, 'id'>
  productImages!: EntityTable<CachedProductImage, 'imageId'>

  constructor() {
    super('baiten-pos')
    this.version(1).stores({
      products: 'no',
      categories: 'name',
      currentTicket: 'id',
      sales: 'saleId',
      // enqueuedAt に索引を張る。同期エンジンは未送信キューを古い順に消化する
      // ため（docs/design.md 4.1）
      pendingQueue: 'saleId, enqueuedAt',
      counters: 'dateKey',
      config: 'id',
    })
    /*
     * v2: 商品写真のキャッシュ（docs/design.md 9.4・タスク22）。
     *
     * Dexie は差分だけを書けばよく、ここに挙げていないテーブルは v1 の定義が
     * そのまま引き継がれる。**v1 の宣言は消さないこと**——既存端末の
     * IndexedDB を v1 から v2 へ移行するために必要。
     *
     * 主キーは画像ID。写真を差し替えると Drive のファイルIDが変わるため、
     * ID が一致していれば中身も同じと言い切れる。これによりキャッシュの
     * 失効判定そのものが不要になる（design 9.4）。
     */
    this.version(2).stores({
      productImages: 'imageId',
    })
  }
}

export const db = new AppDatabase()
