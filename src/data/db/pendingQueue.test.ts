import { beforeEach, describe, expect, test } from 'vitest'
import { toTerminalCode, toYen, type PendingSale, type SaleId } from '@/domain/types'
import {
  enqueuePendingSale,
  getAllPendingSales,
  getPendingCount,
  removePendingSale,
  updatePendingSaleRetry,
} from './pendingQueue'
import { db } from './schema'

function pending(overrides: Partial<PendingSale> = {}): PendingSale {
  const saleId = overrides.saleId ?? ('20260723-A001' as SaleId)
  return {
    saleId,
    payload: {
      saleId,
      terminalCode: toTerminalCode('A'),
      confirmedAt: '2026-07-23T14:32:00+09:00',
      note: '',
      lines: [
        {
          lineNo: 1,
          productName: 'からあげ串',
          netUnitPrice: toYen(500),
          qty: 1,
          subtotal: toYen(500),
          discount: toYen(0),
        },
      ],
    },
    enqueuedAt: '2026-07-23T14:32:00+09:00',
    retryCount: 0,
    lastTriedAt: null,
    lastError: null,
    ...overrides,
  }
}

beforeEach(async () => {
  await db.pendingQueue.clear()
})

describe('enqueuePendingSale / getAllPendingSales', () => {
  test('積んだ内容をそのまま読める', async () => {
    await enqueuePendingSale(pending())
    expect(await getAllPendingSales()).toEqual([pending()])
  })

  test('古い順（enqueuedAt昇順）に返す', async () => {
    await enqueuePendingSale(
      pending({ saleId: '20260723-A003' as SaleId, enqueuedAt: '2026-07-23T14:34:00+09:00' }),
    )
    await enqueuePendingSale(
      pending({ saleId: '20260723-A001' as SaleId, enqueuedAt: '2026-07-23T14:32:00+09:00' }),
    )
    await enqueuePendingSale(
      pending({ saleId: '20260723-A002' as SaleId, enqueuedAt: '2026-07-23T14:33:00+09:00' }),
    )
    const all = await getAllPendingSales()
    // 挿入順や saleId 順ではなく、enqueuedAt の昇順であることを確認する
    expect(all.map((p) => p.saleId)).toEqual(['20260723-A001', '20260723-A002', '20260723-A003'])
  })
})

describe('getPendingCount', () => {
  test('未送信件数バッジに使う件数を返す', async () => {
    expect(await getPendingCount()).toBe(0)
    await enqueuePendingSale(pending({ saleId: '20260723-A001' as SaleId }))
    await enqueuePendingSale(pending({ saleId: '20260723-A002' as SaleId }))
    expect(await getPendingCount()).toBe(2)
  })
})

describe('removePendingSale', () => {
  test('指定したsaleIdだけをキューから取り除く', async () => {
    await enqueuePendingSale(pending({ saleId: '20260723-A001' as SaleId }))
    await enqueuePendingSale(pending({ saleId: '20260723-A002' as SaleId }))
    await removePendingSale('20260723-A001' as SaleId)
    const remaining = await getAllPendingSales()
    expect(remaining.map((p) => p.saleId)).toEqual(['20260723-A002'])
  })
})

describe('updatePendingSaleRetry', () => {
  test('再試行状況を更新する。キューからは削除されない', async () => {
    await enqueuePendingSale(pending())
    await updatePendingSaleRetry('20260723-A001' as SaleId, {
      retryCount: 1,
      lastTriedAt: '2026-07-23T14:35:00+09:00',
      lastError: 'NETWORK_ERROR',
    })
    const [updated] = await getAllPendingSales()
    expect(updated.retryCount).toBe(1)
    expect(updated.lastError).toBe('NETWORK_ERROR')
    // 送信ペイロード自体は変わらない
    expect(updated.payload.saleId).toBe('20260723-A001')
  })
})
