import { beforeEach, describe, expect, test } from 'vitest'
import { saveConfig } from '@/data/db/config'
import { getAllPendingSales } from '@/data/db/pendingQueue'
import { getAllSales } from '@/data/db/sales'
import { db } from '@/data/db/schema'
import { peekSeq } from '@/data/sync/counter'
import { toDateKey } from '@/domain/saleNumber'
import { toTerminalCode, toYen, type TicketLine } from '@/domain/types'
import { confirmSale } from './checkout'

const NOW = new Date(2026, 6, 23, 14, 32, 0) // 2026-07-23 14:32
const DATE_KEY = toDateKey(NOW)

function line(overrides: Partial<TicketLine> = {}): TicketLine {
  return {
    lineId: 'l1',
    productNo: 1,
    productName: 'からあげ串',
    unitPrice: toYen(500),
    qty: 2,
    discount: toYen(50),
    ...overrides,
  }
}

beforeEach(async () => {
  await db.config.clear()
  await db.counters.clear()
  await db.sales.clear()
  await db.pendingQueue.clear()
  await db.currentTicket.clear()
})

describe('端末未登録の場合', () => {
  test('terminalNotConfiguredを返し、何も書き込まない', async () => {
    const result = await confirmSale([line()], '', toYen(1000), NOW)

    expect(result).toEqual({ ok: false, error: 'terminalNotConfigured' })
    expect(await getAllSales()).toEqual([])
    expect(await getAllPendingSales()).toEqual([])
    expect(await peekSeq(DATE_KEY)).toBe(0)
  })
})

describe('確定成功時', () => {
  beforeEach(async () => {
    await saveConfig({ terminalCode: toTerminalCode('A') })
  })

  test('会計番号が要件定義5.4の形式で採番される', async () => {
    const result = await confirmSale([line()], '', toYen(1000), NOW)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.saleId).toBe('20260723-A001')
  })

  test('salesテーブルに保存される。金額はdomain/calcの計算どおり', async () => {
    const result = await confirmSale([line({ unitPrice: toYen(500), discount: toYen(50), qty: 2 })], 'イベント割', toYen(1000), NOW)
    if (!result.ok) throw new Error('confirm failed')

    const sales = await getAllSales()
    expect(sales).toHaveLength(1)
    const sale = sales[0]
    expect(sale.saleId).toBe(result.saleId)
    expect(sale.terminalCode).toBe('A')
    expect(sale.note).toBe('イベント割')
    expect(sale.total).toBe(900) // (500-50)×2
    expect(sale.received).toBe(1000)
    expect(sale.change).toBe(100)
    expect(sale.synced).toBe(false)
    expect(sale.canceledAt).toBeNull()
    // 売上ログの単価は割引後（netUnitPrice）。割引前のunitPriceと取り違えていないか
    expect(sale.lines[0].netUnitPrice).toBe(450)
    expect(sale.lines[0].subtotal).toBe(900)
    expect(sale.lines[0].lineNo).toBe(1)
  })

  test('pendingQueueに投入される。ペイロードはsalesと同じ明細を持つ', async () => {
    const result = await confirmSale([line()], '', toYen(1000), NOW)
    if (!result.ok) throw new Error('confirm failed')

    const pending = await getAllPendingSales()
    expect(pending).toHaveLength(1)
    expect(pending[0].saleId).toBe(result.saleId)
    expect(pending[0].retryCount).toBe(0)
    expect(pending[0].lastError).toBeNull()
    expect(pending[0].payload.lines[0].netUnitPrice).toBe(450)
  })

  test('currentTicketが削除される（伝票クリア）', async () => {
    await db.currentTicket.put({ id: 'current', lines: [line()], note: '', updatedAt: NOW.toISOString() })

    await confirmSale([line()], '', toYen(1000), NOW)

    expect(await db.currentTicket.get('current')).toBeUndefined()
  })

  test('同じ端末・同じ日に連続して確定すると連番が進む', async () => {
    const first = await confirmSale([line()], '', toYen(1000), NOW)
    const second = await confirmSale([line()], '', toYen(1000), NOW)

    expect(first.ok && first.saleId).toBe('20260723-A001')
    expect(second.ok && second.saleId).toBe('20260723-A002')
  })

  test('日付が変わると連番は001から再開する', async () => {
    await confirmSale([line()], '', toYen(1000), NOW)
    const nextDay = new Date(2026, 6, 24, 9, 0, 0)

    const result = await confirmSale([line()], '', toYen(1000), nextDay)

    expect(result.ok && result.saleId).toBe('20260724-A001')
  })
})

describe('不変条件9：採番と会計データの保存が同一トランザクション', () => {
  beforeEach(async () => {
    await saveConfig({ terminalCode: toTerminalCode('A') })
  })

  test('二重タップ相当の同時確定でも会計番号が重複しない', async () => {
    const N = 30
    const results = await Promise.all(
      Array.from({ length: N }, () => confirmSale([line()], '', toYen(1000), NOW)),
    )

    const saleIds = results.map((r) => (r.ok ? r.saleId : null))
    expect(saleIds.every((id) => id !== null)).toBe(true)
    // read→+1→write がトランザクションで直列化されない実装だと、複数の呼び出しが
    // 同じ現在値を読んでしまい、重複した会計番号（＝同じ連番）で2件保存されてしまう
    expect(new Set(saleIds).size).toBe(N)

    const sales = await getAllSales()
    expect(sales).toHaveLength(N)
    const pending = await getAllPendingSales()
    expect(pending).toHaveLength(N)
  })

  test('同時確定してもカウンタは最終的に確定件数と一致する（採番の取りこぼし・重複が無い）', async () => {
    const N = 20
    await Promise.all(Array.from({ length: N }, () => confirmSale([line()], '', toYen(1000), NOW)))

    expect(await peekSeq(DATE_KEY)).toBe(N)
  })
})
