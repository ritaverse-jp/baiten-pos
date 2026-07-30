import { describe, expect, test } from 'vitest'
import { canCancelSale, isSaleOnDate, mergeSalesHistory } from './history'
import { toTerminalCode, toYen, type DateKey, type SaleId, type SaleLine, type SaleRecord, type SalesHistoryEntry } from './types'

const LINES: SaleLine[] = [
  { lineNo: 1, productName: 'からあげ串', netUnitPrice: toYen(500), qty: 2, subtotal: toYen(1000), discount: toYen(0) },
]

function localSale(overrides: Partial<SaleRecord> = {}): SaleRecord {
  return {
    saleId: '20260730-A001' as SaleId,
    terminalCode: toTerminalCode('A'),
    confirmedAt: '2026-07-30T10:00:00+09:00',
    note: '',
    lines: LINES,
    total: toYen(1000),
    received: toYen(1000),
    change: toYen(0),
    synced: false,
    canceledAt: null,
    ...overrides,
  }
}

function remoteSale(overrides: Partial<SalesHistoryEntry> = {}): SalesHistoryEntry {
  return {
    saleId: '20260730-A001' as SaleId,
    terminalCode: toTerminalCode('A'),
    confirmedAt: '2026-07-30T10:00:00+09:00',
    note: '',
    lines: LINES,
    total: toYen(1000),
    canceled: false,
    canceledAt: null,
    ...overrides,
  }
}

describe('isSaleOnDate', () => {
  test('会計番号の日付部分が一致すればtrue', () => {
    expect(isSaleOnDate('20260730-A001' as SaleId, '20260730' as DateKey)).toBe(true)
  })

  test('日付が異なればfalse', () => {
    expect(isSaleOnDate('20260729-A001' as SaleId, '20260730' as DateKey)).toBe(false)
  })

  test('不正な会計番号形式ならfalse', () => {
    expect(isSaleOnDate('invalid' as SaleId, '20260730' as DateKey)).toBe(false)
  })
})

describe('mergeSalesHistory', () => {
  test('remoteがnull（オフライン）のときはローカルのみを返す', () => {
    const result = mergeSalesHistory([localSale()], null)
    expect(result).toHaveLength(1)
    expect(result[0].synced).toBe(false)
  })

  test('同じsaleIdが両方にある場合はリモートを優先する（他端末での取消を見逃さないため）', () => {
    const result = mergeSalesHistory(
      [localSale({ canceledAt: null })],
      [remoteSale({ canceled: true, canceledAt: '2026-07-30T11:00:00+09:00' })],
    )
    expect(result).toHaveLength(1)
    expect(result[0].canceled).toBe(true)
    expect(result[0].synced).toBe(true)
  })

  test('ローカルにしか無い（未送信の）会計はそのまま残る', () => {
    const result = mergeSalesHistory(
      [localSale({ saleId: '20260730-A002' as SaleId })],
      [remoteSale()], // saleId: A001 のみ
    )
    expect(result.map((r) => r.saleId)).toEqual(expect.arrayContaining(['20260730-A001', '20260730-A002']))
    expect(result.find((r) => r.saleId === '20260730-A002')?.synced).toBe(false)
  })

  test('確定日時の昇順で返す', () => {
    const result = mergeSalesHistory(
      [
        localSale({ saleId: '20260730-A002' as SaleId, confirmedAt: '2026-07-30T12:00:00+09:00' }),
        localSale({ saleId: '20260730-A001' as SaleId, confirmedAt: '2026-07-30T09:00:00+09:00' }),
      ],
      null,
    )
    expect(result.map((r) => r.saleId)).toEqual(['20260730-A001', '20260730-A002'])
  })
})

describe('canCancelSale', () => {
  test('送信済み・未取消なら取消可能', () => {
    expect(canCancelSale({ ...remoteSale(), synced: true, canceled: false })).toBe(true)
  })

  test('未送信なら取消不可（design 2.7・不変条件12）', () => {
    expect(canCancelSale({ ...remoteSale(), synced: false, canceled: false })).toBe(false)
  })

  test('取消済みなら再度は取消不可', () => {
    expect(canCancelSale({ ...remoteSale(), synced: true, canceled: true })).toBe(false)
  })
})
