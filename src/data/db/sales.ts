/**
 * 確定済み会計（`sales`）へのアクセサ。
 *
 * 当日の会計履歴表示（FR-14）・同期状態の追跡・取消（FR-15）の基礎データを
 * 保持する。日付や端末での絞り込みは画面側（タスク18）の責務とし、ここでは
 * 汎用的な読み書きのみを提供する。
 */

import type { IsoDateTime, SaleId, SaleRecord } from '@/domain/types'
import { db } from './schema'

export async function putSale(sale: SaleRecord): Promise<void> {
  await db.sales.put(sale)
}

export async function getSale(saleId: SaleId): Promise<SaleRecord | undefined> {
  return db.sales.get(saleId)
}

export async function getAllSales(): Promise<SaleRecord[]> {
  return db.sales.toArray()
}

/** GAS への送信が受理された後に呼ぶ。売上ログへの追記は行わない（確定時に完了済み） */
export async function markSaleSynced(saleId: SaleId): Promise<void> {
  await db.sales.update(saleId, { synced: true })
}

/**
 * 取消済みにする（FR-15）。元の `SaleRecord` は削除せず残す。
 * 未送信の会計は取り消せない（design.md 2.7・CLAUDE.md）ため、呼び出し側は
 * `synced === true` を確認してから呼ぶこと。
 */
export async function markSaleCanceled(saleId: SaleId, canceledAt: IsoDateTime): Promise<void> {
  await db.sales.update(saleId, { canceledAt })
}
