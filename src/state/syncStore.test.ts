import { beforeEach, describe, expect, test } from 'vitest'
import { enqueuePendingSale } from '@/data/db/pendingQueue'
import { db } from '@/data/db/schema'
import { toTerminalCode, toYen, type PendingSale, type SaleId } from '@/domain/types'
import { useSyncStore } from './syncStore'

function pending(saleId: string): PendingSale {
  const id = saleId as SaleId
  return {
    saleId: id,
    payload: {
      saleId: id,
      terminalCode: toTerminalCode('A'),
      confirmedAt: '2026-07-23T14:32:00+09:00',
      note: '',
      lines: [
        { lineNo: 1, productName: 'テスト', netUnitPrice: toYen(100), qty: 1, subtotal: toYen(100), discount: toYen(0) },
      ],
    },
    enqueuedAt: '2026-07-23T14:32:00+09:00',
    retryCount: 0,
    lastTriedAt: null,
    lastError: null,
  }
}

beforeEach(async () => {
  await db.pendingQueue.clear()
  useSyncStore.setState({
    connection: 'unknown',
    pendingCount: 0,
    syncing: false,
    lastSyncedAt: null,
    blockedBy: null,
  })
})

describe('初期状態', () => {
  test('connectionはunknownで始まる（navigator.onLineではなく通信結果で決まる。design 4.3）', () => {
    expect(useSyncStore.getState().connection).toBe('unknown')
  })
})

describe('hydrate', () => {
  test('未送信キューが空なら0のまま', async () => {
    await useSyncStore.getState().hydrate()
    expect(useSyncStore.getState().pendingCount).toBe(0)
  })

  test('未送信キューの実件数で初期化する（要件定義9.1のバッジ表示に使う）', async () => {
    await enqueuePendingSale(pending('20260723-A001'))
    await enqueuePendingSale(pending('20260723-A002'))

    await useSyncStore.getState().hydrate()

    expect(useSyncStore.getState().pendingCount).toBe(2)
  })
})

describe('refreshPendingCount', () => {
  test('キューの増減を都度反映できる', async () => {
    await useSyncStore.getState().refreshPendingCount()
    expect(useSyncStore.getState().pendingCount).toBe(0)

    await enqueuePendingSale(pending('20260723-A001'))
    await useSyncStore.getState().refreshPendingCount()
    expect(useSyncStore.getState().pendingCount).toBe(1)
  })
})

describe('setConnection', () => {
  test('接続状態を更新する', () => {
    useSyncStore.getState().setConnection('online')
    expect(useSyncStore.getState().connection).toBe('online')

    useSyncStore.getState().setConnection('offline')
    expect(useSyncStore.getState().connection).toBe('offline')
  })
})

describe('setSyncing / setLastSyncedAt / setBlockedBy', () => {
  test('同期中フラグを更新する', () => {
    useSyncStore.getState().setSyncing(true)
    expect(useSyncStore.getState().syncing).toBe(true)
  })

  test('最終同期日時を更新する', () => {
    useSyncStore.getState().setLastSyncedAt('2026-07-23T14:32:00+09:00')
    expect(useSyncStore.getState().lastSyncedAt).toBe('2026-07-23T14:32:00+09:00')
  })

  test('同期の停止理由を更新する（design 6.6のTOKEN_EXPIRED/TERMINAL_DISABLED分岐で使う）', () => {
    useSyncStore.getState().setBlockedBy('tokenExpired')
    expect(useSyncStore.getState().blockedBy).toBe('tokenExpired')

    useSyncStore.getState().setBlockedBy('terminalDisabled')
    expect(useSyncStore.getState().blockedBy).toBe('terminalDisabled')

    useSyncStore.getState().setBlockedBy(null)
    expect(useSyncStore.getState().blockedBy).toBeNull()
  })
})
