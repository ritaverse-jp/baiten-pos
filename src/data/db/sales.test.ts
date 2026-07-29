import { beforeEach, describe, expect, test } from 'vitest'
import { toTerminalCode, toYen, type SaleId, type SaleRecord } from '@/domain/types'
import { getAllSales, getSale, markSaleCanceled, markSaleSynced, putSale } from './sales'
import { db } from './schema'

function sale(overrides: Partial<SaleRecord> = {}): SaleRecord {
  return {
    saleId: '20260723-A001' as SaleId,
    terminalCode: toTerminalCode('A'),
    confirmedAt: '2026-07-23T14:32:00+09:00',
    note: '',
    lines: [
      { lineNo: 1, productName: 'からあげ串', netUnitPrice: toYen(500), qty: 1, subtotal: toYen(500), discount: toYen(0) },
    ],
    total: toYen(500),
    received: toYen(1000),
    change: toYen(500),
    synced: false,
    canceledAt: null,
    ...overrides,
  }
}

beforeEach(async () => {
  await db.sales.clear()
})

describe('putSale / getSale', () => {
  test('保存した内容をそのまま読める', async () => {
    await putSale(sale())
    expect(await getSale('20260723-A001' as SaleId)).toEqual(sale())
  })

  test('存在しないsaleIdはundefinedを返す', async () => {
    expect(await getSale('20260723-A999' as SaleId)).toBeUndefined()
  })
})

describe('getAllSales', () => {
  test('保存した全件を返す', async () => {
    await putSale(sale({ saleId: '20260723-A001' as SaleId }))
    await putSale(sale({ saleId: '20260723-A002' as SaleId }))
    const all = await getAllSales()
    expect(all.map((s) => s.saleId).sort()).toEqual(['20260723-A001', '20260723-A002'])
  })
})

describe('markSaleSynced', () => {
  test('syncedをtrueにする。他のフィールドは変わらない', async () => {
    await putSale(sale({ synced: false }))
    await markSaleSynced('20260723-A001' as SaleId)
    const updated = await getSale('20260723-A001' as SaleId)
    expect(updated?.synced).toBe(true)
    expect(updated?.total).toBe(500)
  })
})

describe('markSaleCanceled', () => {
  test('canceledAtを設定する。元のレコードは削除しない（追記専用の原則）', async () => {
    await putSale(sale({ canceledAt: null }))
    await markSaleCanceled('20260723-A001' as SaleId, '2026-07-23T15:00:00+09:00')
    const canceled = await getSale('20260723-A001' as SaleId)
    expect(canceled?.canceledAt).toBe('2026-07-23T15:00:00+09:00')
    // レコード自体が消えていないことを確認する
    expect(canceled).toBeDefined()
    expect((await getAllSales())).toHaveLength(1)
  })
})
