/**
 * 会計確定フロー。docs/design.md 4.1・CLAUDE.md 不変条件9 を実装する。
 *
 *   採番 → sales へ保存 ＋ pendingQueue へ投入 ＋ currentTicket をクリア
 *
 * を **同一の Dexie トランザクション内**で行う。ここまで完全にローカルで
 * 完結し、ネットワークには一切依存しない（design 4.1「会計成立はネットワークに
 * 一切依存しない」）。
 *
 * 同期エンジンの起動（design 4.1 手順4：確定後に非同期でキューを送信する）は
 * タスク16で実装する。この関数はローカルでの確定までを担当し、呼び出し側
 * （画面）が確定成功後に同期エンジンをキックする形にする。
 */

import { getConfig } from '@/data/db/config'
import { enqueuePendingSale } from '@/data/db/pendingQueue'
import { putSale } from '@/data/db/sales'
import { CURRENT_TICKET_ID, db } from '@/data/db/schema'
import { buildSaleLines, change, ticketTotal } from '@/domain/calc'
import { buildSaleId, toDateKey } from '@/domain/saleNumber'
import type { IsoDateTime, PendingSale, SaleId, SaleRecord, TicketLine, Yen } from '@/domain/types'

export type ConfirmSaleError = 'terminalNotConfigured'

export type ConfirmSaleResult = { ok: true; saleId: SaleId } | { ok: false; error: ConfirmSaleError }

export const CONFIRM_SALE_ERROR_MESSAGES: Record<ConfirmSaleError, string> = {
  terminalNotConfigured: 'この端末はまだ登録されていません。設定画面で端末登録を行ってください。',
}

/**
 * 会計を確定する。呼び出し側（精算モーダル）は事前に `canConfirm(lines, received)`
 * で伝票の非空・預かり金の充足を確認済みであることを前提とする（ここでは
 * 再検証しない）。端末未登録（`config.terminalCode` が無い）の場合のみ、
 * ここで拒否する。会計番号の生成に端末コードが必須なため（design 5.4）。
 */
export async function confirmSale(
  lines: readonly TicketLine[],
  note: string,
  received: Yen,
  now: Date,
): Promise<ConfirmSaleResult> {
  const config = await getConfig()
  if (!config.terminalCode) {
    return { ok: false, error: 'terminalNotConfigured' }
  }
  const terminalCode = config.terminalCode

  const confirmedAt: IsoDateTime = now.toISOString()
  const dateKey = toDateKey(now)
  const total = ticketTotal(lines)
  const saleLines = buildSaleLines(lines)

  const saleId = await db.transaction('rw', db.counters, db.sales, db.pendingQueue, db.currentTicket, async () => {
    // counters の read → +1 → write を、sales・pendingQueue への書き込みと
    // 同一トランザクションにする（不変条件9：二重タップで同番号が出ないように）。
    // db.transaction の呼び出しネストにより、この中の db.counters への操作は
    // 新規トランザクションを作らず外側のこのトランザクションに参加する
    // （data/sync/counter.ts の設計どおり）。
    const current = await db.counters.get(dateKey)
    const seq = (current?.lastSeq ?? 0) + 1
    await db.counters.put({ dateKey, lastSeq: seq })

    const saleId = buildSaleId(now, terminalCode, seq)

    const payload = {
      saleId,
      terminalCode,
      confirmedAt,
      note,
      lines: saleLines,
    }

    const saleRecord: SaleRecord = {
      ...payload,
      total,
      received,
      change: change(total, received),
      synced: false,
      canceledAt: null,
    }
    await putSale(saleRecord)

    const pending: PendingSale = {
      saleId,
      payload,
      enqueuedAt: confirmedAt,
      retryCount: 0,
      lastTriedAt: null,
      lastError: null,
    }
    await enqueuePendingSale(pending)

    await db.currentTicket.delete(CURRENT_TICKET_ID)

    return saleId
  })

  return { ok: true, saleId }
}
