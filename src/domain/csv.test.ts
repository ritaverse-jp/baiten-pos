import { describe, expect, test } from 'vitest'
import { pendingSalesToCsv } from './csv'
import { toTerminalCode, toYen, type PendingSale, type SaleId } from './types'

function pending(overrides: Partial<PendingSale> = {}): PendingSale {
  const saleId = '20260730-A001' as SaleId
  return {
    saleId,
    payload: {
      saleId,
      terminalCode: toTerminalCode('A'),
      confirmedAt: '2026-07-30T05:32:00.000Z', // JST 14:32
      note: '',
      lines: [
        { lineNo: 1, productName: 'からあげ串', netUnitPrice: toYen(500), qty: 2, subtotal: toYen(1000), discount: toYen(0) },
      ],
    },
    enqueuedAt: '2026-07-30T05:32:00.000Z',
    retryCount: 0,
    lastTriedAt: null,
    lastError: null,
    ...overrides,
  }
}

describe('pendingSalesToCsv', () => {
  test('ヘッダー行が売上ログの列構成と一致する', () => {
    const csv = pendingSalesToCsv([])
    expect(csv).toBe('日付,時刻,会計番号,端末コード,商品名,金額,個数,小計,割引額,備考,行番号')
  })

  test('1商品1行で出力し、confirmedAtをJSTの日付・時刻に分ける', () => {
    const csv = pendingSalesToCsv([pending()])
    const lines = csv.split('\r\n')
    expect(lines).toHaveLength(2)
    expect(lines[1]).toBe('2026/07/30,14:32,20260730-A001,A,からあげ串,500,2,1000,0,,1')
  })

  test('同一会計で複数商品があれば商品ごとに行を分ける', () => {
    const p = pending({
      payload: {
        ...pending().payload,
        lines: [
          { lineNo: 1, productName: 'からあげ串', netUnitPrice: toYen(500), qty: 1, subtotal: toYen(500), discount: toYen(0) },
          { lineNo: 2, productName: 'ラムネ', netUnitPrice: toYen(200), qty: 1, subtotal: toYen(200), discount: toYen(0) },
        ],
      },
    })
    const csv = pendingSalesToCsv([p])
    expect(csv.split('\r\n')).toHaveLength(3)
  })

  test('カンマ・改行を含む備考はダブルクォートでエスケープする', () => {
    const p = pending({ payload: { ...pending().payload, note: 'イベント割,特別価格' } })
    const csv = pendingSalesToCsv([p])
    expect(csv).toContain('"イベント割,特別価格"')
  })
})
