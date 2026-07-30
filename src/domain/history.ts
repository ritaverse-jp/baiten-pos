/**
 * SC-05 会計履歴画面（要件定義 FR-14・FR-15）向けの純粋関数。
 *
 * 履歴は2つのソースを持つ：
 * - ローカル（IndexedDB `sales`）：この端末が確定した当日の会計。未送信でも見える
 * - リモート（GAS `getSalesHistory`）：オンライン時のみ取得できる、全端末分の当日会計
 *
 * `mergeSalesHistory` はこの2つを1つの一覧にまとめる。同じ `saleId` が両方に
 * 存在する場合はリモートを優先する（他端末での取消など、ローカルの
 * `SaleRecord` がまだ知らない変更を正としたいため）。ローカルにしか無い
 * エントリ（＝まだ未送信）はそのままローカルの値を使う。
 */

import type { DateKey, HistoryEntry, SaleId, SaleRecord, SalesHistoryEntry } from './types'
import { parseSaleId } from './saleNumber'

/** `saleId` に含まれる日付が `dateKey` と一致するかどうか（要件定義6.10「当日の会計履歴」） */
export function isSaleOnDate(saleId: SaleId, dateKey: DateKey): boolean {
  return parseSaleId(saleId)?.dateKey === dateKey
}

function fromLocal(sale: SaleRecord): HistoryEntry {
  return {
    saleId: sale.saleId,
    terminalCode: sale.terminalCode,
    confirmedAt: sale.confirmedAt,
    lines: sale.lines,
    total: sale.total,
    synced: sale.synced,
    canceled: sale.canceledAt !== null,
    canceledAt: sale.canceledAt,
  }
}

function fromRemote(sale: SalesHistoryEntry): HistoryEntry {
  return {
    saleId: sale.saleId,
    terminalCode: sale.terminalCode,
    confirmedAt: sale.confirmedAt,
    lines: sale.lines,
    total: sale.total,
    // リモートは売上ログ（シート）から読んでいるため、載っている時点で送信済み
    synced: true,
    canceled: sale.canceled,
    canceledAt: sale.canceledAt,
  }
}

/**
 * ローカル・リモートの当日会計を1つの一覧にまとめる。`remote` は未取得（オフライン等）
 * なら `null` を渡す。確定日時の昇順で返す。
 */
export function mergeSalesHistory(local: readonly SaleRecord[], remote: readonly SalesHistoryEntry[] | null): HistoryEntry[] {
  const bySaleId = new Map<SaleId, HistoryEntry>()

  for (const sale of local) {
    bySaleId.set(sale.saleId, fromLocal(sale))
  }
  if (remote) {
    for (const sale of remote) {
      bySaleId.set(sale.saleId, fromRemote(sale))
    }
  }

  return [...bySaleId.values()].sort((a, b) => a.confirmedAt.localeCompare(b.confirmedAt))
}

/**
 * 取消可能かどうかの唯一の判定。未送信の会計は取り消せない
 * （design.md 2.7・不変条件12「未送信の会計は取り消せない」）。
 * 取消済みの会計も再度は取り消せない。
 */
export function canCancelSale(entry: HistoryEntry): boolean {
  return entry.synced && !entry.canceled
}
