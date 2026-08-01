import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { saveConfig } from '@/data/db/config'
import { enqueuePendingSale, getAllPendingSales } from '@/data/db/pendingQueue'
import { putSale } from '@/data/db/sales'
import { db } from '@/data/db/schema'
import { useSyncStore } from '@/state/syncStore'
import { toTerminalCode, toYen, type PendingSale, type SaleId } from '@/domain/types'
import { __resetSyncEngineForTests, runSync } from './engine'

const GAS_URL = 'https://script.google.com/macros/s/FAKE/exec'

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 })
}

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
        { lineNo: 1, productName: 'テスト', netUnitPrice: toYen(500), qty: 1, subtotal: toYen(500), discount: toYen(0) },
      ],
    },
    enqueuedAt: '2026-07-23T14:32:00+09:00',
    retryCount: 0,
    lastTriedAt: null,
    lastError: null,
  }
}

async function seedPendingSale(saleId: string) {
  const p = pending(saleId)
  await enqueuePendingSale(p)
  await putSale({
    ...p.payload,
    total: toYen(500),
    received: toYen(500),
    change: toYen(0),
    synced: false,
    canceledAt: null,
  })
}

beforeEach(async () => {
  __resetSyncEngineForTests()
  await db.config.clear()
  await db.sales.clear()
  await db.pendingQueue.clear()
  await saveConfig({ gasUrl: GAS_URL, apiToken: 'tok', terminalCode: toTerminalCode('A') })
  useSyncStore.setState({ connection: 'unknown', pendingCount: 0, syncing: false, lastSyncedAt: null, blockedBy: null })
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('未送信キューが空のとき', () => {
  test('通信しない', async () => {
    await runSync()
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('送信成功時', () => {
  test('salesをsynced化し、pendingQueueから削除する', async () => {
    await seedPendingSale('20260723-A001')
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ ok: true, data: { results: [{ saleId: '20260723-A001', status: 'appended' }] } }),
    )

    await runSync()

    expect(await getAllPendingSales()).toEqual([])
    const sale = await db.sales.get('20260723-A001' as SaleId)
    expect(sale?.synced).toBe(true)
  })

  test('duplicate応答もappendedと同様に成功扱いでキューから削除する（design 4.2）', async () => {
    await seedPendingSale('20260723-A001')
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ ok: true, data: { results: [{ saleId: '20260723-A001', status: 'duplicate' }] } }),
    )

    await runSync()

    expect(await getAllPendingSales()).toEqual([])
  })

  test('connectionをonlineにし、lastSyncedAtとpendingCountを更新する', async () => {
    await seedPendingSale('20260723-A001')
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ ok: true, data: { results: [{ saleId: '20260723-A001', status: 'appended' }] } }),
    )

    await runSync()

    const state = useSyncStore.getState()
    expect(state.connection).toBe('online')
    expect(state.lastSyncedAt).not.toBeNull()
    expect(state.pendingCount).toBe(0)
    expect(state.syncing).toBe(false)
  })

  test('直前までTOKEN_EXPIREDで停止していても、成功したらblockedByを解除する', async () => {
    useSyncStore.setState({ blockedBy: 'tokenExpired' })
    await seedPendingSale('20260723-A001')
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ ok: true, data: { results: [{ saleId: '20260723-A001', status: 'appended' }] } }),
    )

    await runSync({ force: true })

    expect(useSyncStore.getState().blockedBy).toBeNull()
  })

  test('50件を超える分は次回に回す（design 4.1のバッチ送信）', async () => {
    for (let i = 1; i <= 60; i++) {
      await seedPendingSale(`20260723-A${String(i).padStart(3, '0')}`)
    }
    vi.mocked(fetch).mockImplementation(async (_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string)
      return jsonResponse({
        ok: true,
        data: { results: body.sales.map((s: { saleId: string }) => ({ saleId: s.saleId, status: 'appended' })) },
      })
    })

    await runSync()

    // 1回のリクエストで送られたのは50件まで。残り10件はキューに残る
    expect(await getAllPendingSales()).toHaveLength(10)
  })
})

describe('design 6.6：TOKEN_EXPIRED / TERMINAL_DISABLED の分岐', () => {
  test('TOKEN_EXPIREDはblockedByをtokenExpiredにし、キューを保持する（同期は一時停止）', async () => {
    await seedPendingSale('20260723-A001')
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ ok: false, error: { code: 'TOKEN_EXPIRED', message: '期限切れ' } }))

    await runSync()

    expect(useSyncStore.getState().blockedBy).toBe('tokenExpired')
    expect(await getAllPendingSales()).toHaveLength(1)
  })

  test('TERMINAL_DISABLEDはblockedByをterminalDisabledにし、キューを保持する（同期は恒久停止）', async () => {
    await seedPendingSale('20260723-A001')
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ ok: false, error: { code: 'TERMINAL_DISABLED', message: '無効化' } }),
    )

    await runSync()

    expect(useSyncStore.getState().blockedBy).toBe('terminalDisabled')
    expect(await getAllPendingSales()).toHaveLength(1)
  })

  test('TERMINAL_NOT_REGISTEREDはblockedByをterminalNotRegisteredにし、キューを保持する', async () => {
    // 端末タブの行が失われた状態。管理者による無効化（terminalDisabled）とは
    // 復旧手段が違うため、別の停止理由として区別する
    await seedPendingSale('20260723-A001')
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ ok: false, error: { code: 'TERMINAL_NOT_REGISTERED', message: '登録情報が見つかりません' } }),
    )

    await runSync()

    expect(useSyncStore.getState().blockedBy).toBe('terminalNotRegistered')
    expect(await getAllPendingSales()).toHaveLength(1)
  })

  test('blockedByが立っている間、force指定なしのrunSyncは通信しない', async () => {
    await seedPendingSale('20260723-A001')
    useSyncStore.setState({ blockedBy: 'tokenExpired' })

    await runSync()

    expect(fetch).not.toHaveBeenCalled()
  })

  test('blockedByが立っていてもforce:trueなら通信を試みる（設定画面の手動再送信用）', async () => {
    await seedPendingSale('20260723-A001')
    useSyncStore.setState({ blockedBy: 'tokenExpired' })
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ ok: false, error: { code: 'TOKEN_EXPIRED', message: '期限切れ' } }),
    )

    await runSync({ force: true })

    expect(fetch).toHaveBeenCalled()
  })
})

describe('一時的な失敗（NETWORK_ERROR等）', () => {
  test('キューを削除せず、retryCountを増やす（不変条件17）', async () => {
    await seedPendingSale('20260723-A001')
    vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'))

    await runSync()

    const remaining = await getAllPendingSales()
    expect(remaining).toHaveLength(1)
    expect(remaining[0].retryCount).toBe(1)
    expect(remaining[0].lastError).toBe('NETWORK_ERROR')
  })

  test('connectionをofflineにする', async () => {
    await seedPendingSale('20260723-A001')
    vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'))

    await runSync()

    expect(useSyncStore.getState().connection).toBe('offline')
  })

  test('失敗直後の非forceな再試行はバックオフによりスキップされる', async () => {
    await seedPendingSale('20260723-A001')
    vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'))
    await runSync()
    vi.mocked(fetch).mockClear()

    await runSync()

    expect(fetch).not.toHaveBeenCalled()
  })

  test('force:trueならバックオフ中でも再試行する', async () => {
    await seedPendingSale('20260723-A001')
    vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'))
    await runSync()
    vi.mocked(fetch).mockClear()

    await runSync({ force: true })

    expect(fetch).toHaveBeenCalled()
  })
})

describe('多重起動ガード（design 4.1「シングルトン」）', () => {
  test('同時に呼んでも1回しか送信しない', async () => {
    await seedPendingSale('20260723-A001')
    let resolveFetch!: (value: Response) => void
    const fetchPromise = new Promise<Response>((resolve) => {
      resolveFetch = resolve
    })
    vi.mocked(fetch).mockReturnValue(fetchPromise)

    const first = runSync()
    const second = runSync() // 1回目が完了する前に呼ぶ

    resolveFetch(jsonResponse({ ok: true, data: { results: [{ saleId: '20260723-A001', status: 'appended' }] } }))
    await Promise.all([first, second])

    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
