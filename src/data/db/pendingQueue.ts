/**
 * 未送信キュー（`pendingQueue`）へのアクセサ。
 *
 * GAS の受理応答を受け取るまで削除してはならない（CLAUDE.md 不変条件16・
 * docs/design.md 4.2・4.4）。この制約は呼び出し側（タスク16の同期エンジン）が
 * 守るべきものであり、ここでは「応答を受け取った後にだけ `remove` を呼ぶ」
 * という前提で単純な CRUD を提供する。
 */

import type { PendingSale, SaleId } from '@/domain/types'
import { db } from './schema'

export async function enqueuePendingSale(pending: PendingSale): Promise<void> {
  await db.pendingQueue.put(pending)
}

/** 古い順（`enqueuedAt` 昇順）に返す。同期エンジンは古い順に消化する（docs/design.md 4.1） */
export async function getAllPendingSales(): Promise<PendingSale[]> {
  return db.pendingQueue.orderBy('enqueuedAt').toArray()
}

/** 画面上部の未送信件数バッジに使う（要件定義 9.1） */
export async function getPendingCount(): Promise<number> {
  return db.pendingQueue.count()
}

/** GAS が受理応答を返した後にのみ呼ぶこと */
export async function removePendingSale(saleId: SaleId): Promise<void> {
  await db.pendingQueue.delete(saleId)
}

export type RetryUpdate = Pick<PendingSale, 'retryCount' | 'lastTriedAt' | 'lastError'>

/** 送信に失敗した際に再試行状況を記録する。キュー自体は削除しない */
export async function updatePendingSaleRetry(saleId: SaleId, update: RetryUpdate): Promise<void> {
  await db.pendingQueue.update(saleId, update)
}
