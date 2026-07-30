import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { saveConfig } from '@/data/db/config'
import { db } from '@/data/db/schema'
import { toTerminalCode, toYen, type DateKey, type SaleId } from '@/domain/types'
import { appendSales, getMasters, getTodayMaxSeq, login, ping, registerTerminal, saveProduct } from './endpoints'

const GAS_URL = 'https://script.google.com/macros/s/FAKE/exec'

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 })
}

beforeEach(async () => {
  await db.config.clear()
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('設定未完了時', () => {
  test('gasUrl未設定なら通信せずNOT_CONFIGUREDを返す（getMasters）', async () => {
    const result = await getMasters()
    expect(result).toEqual({ ok: false, error: { code: 'NOT_CONFIGURED', message: expect.any(String) } })
    expect(fetch).not.toHaveBeenCalled()
  })

  test('gasUrlはあるがトークン未登録ならNOT_CONFIGURED（appendSales）', async () => {
    await saveConfig({ gasUrl: GAS_URL })
    const result = await appendSales([])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('NOT_CONFIGURED')
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('registerTerminal / login', () => {
  test('registerTerminalはgasUrlさえあればトークン未登録でも呼べる', async () => {
    await saveConfig({ gasUrl: GAS_URL })
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(
      jsonResponse({
        ok: true,
        data: { terminalCode: 'A', terminalName: 'レジ1', apiToken: 'tok', expiresAt: '2026-10-01T00:00:00Z' },
      }),
    )

    const result = await registerTerminal({ pin: '1234', terminalName: 'レジ1' })

    expect(result).toEqual({
      ok: true,
      data: { terminalCode: 'A', terminalName: 'レジ1', apiToken: 'tok', expiresAt: '2026-10-01T00:00:00Z' },
    })
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body).toEqual({ action: 'registerTerminal', pin: '1234', terminalName: 'レジ1' })
  })

  test('loginもgasUrlさえあれば呼べる', async () => {
    await saveConfig({ gasUrl: GAS_URL })
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(jsonResponse({ ok: false, error: { code: 'PIN_LOCKED', message: 'ロック中' } }))

    const result = await login({ pin: '0000', terminalCode: toTerminalCode('A') })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('PIN_LOCKED')
  })
})

describe('認証つきエンドポイント', () => {
  beforeEach(async () => {
    await saveConfig({
      gasUrl: GAS_URL,
      apiToken: 'test-token',
      terminalCode: toTerminalCode('A'),
      terminalName: 'レジ1',
    })
  })

  test('getMastersはapiToken・terminalCodeを送る', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(
      jsonResponse({ ok: true, data: { products: [], categories: [], terminalStatus: '有効', fetchedAt: '2026-07-23T00:00:00Z' } }),
    )

    await getMasters()

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body).toEqual({ action: 'getMasters', apiToken: 'test-token', terminalCode: 'A' })
  })

  test('getTodayMaxSeqは date フィールドで送る（dateKeyではない。gas/Sales.jsとの整合）', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, data: { maxSeq: 14 } }))

    const result = await getTodayMaxSeq('20260723' as DateKey)

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body).toEqual({ action: 'getTodayMaxSeq', apiToken: 'test-token', terminalCode: 'A', date: '20260723' })
    expect(body.dateKey).toBeUndefined()
    expect(result).toEqual({ ok: true, data: { maxSeq: 14 } })
  })

  test('appendSalesはsales配列を送る', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, data: { results: [{ saleId: '20260723-A001', status: 'appended' }] } }))

    const sales = [
      {
        saleId: '20260723-A001' as SaleId,
        terminalCode: toTerminalCode('A'),
        confirmedAt: '2026-07-23T14:32:00+09:00',
        note: '',
        lines: [
          { lineNo: 1, productName: 'テスト', netUnitPrice: toYen(100), qty: 1, subtotal: toYen(100), discount: toYen(0) },
        ],
      },
    ]

    const result = await appendSales(sales)

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body.sales).toEqual(sales)
    expect(result.ok).toBe(true)
  })

  test('saveProductはoriginalNo未指定なら送らない', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(
      jsonResponse({
        ok: true,
        data: { product: { no: 1, name: 'test', price: 100, categoryName: 'c', displayOrder: null, status: '有効' } },
      }),
    )

    await saveProduct({
      no: 1,
      name: 'test',
      price: toYen(100),
      categoryName: 'c',
      displayOrder: null,
      status: '有効',
    })

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body.originalNo).toBeUndefined()
  })

  test('saveProductはoriginalNo指定時はそれを送る', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(
      jsonResponse({
        ok: true,
        data: { product: { no: 2, name: 'test', price: 100, categoryName: 'c', displayOrder: null, status: '有効' } },
      }),
    )

    await saveProduct(
      { no: 2, name: 'test', price: toYen(100), categoryName: 'c', displayOrder: null, status: '有効' },
      1,
    )

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body.originalNo).toBe(1)
  })

  test('TOKEN_EXPIRED をそのまま呼び出し側に返す（同期エンジンでの分岐に使う。design 6.6）', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(jsonResponse({ ok: false, error: { code: 'TOKEN_EXPIRED', message: '期限切れ' } }))

    const result = await getMasters()

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('TOKEN_EXPIRED')
  })

  test('TERMINAL_DISABLED をそのまま呼び出し側に返す（design 6.6）', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(jsonResponse({ ok: false, error: { code: 'TERMINAL_DISABLED', message: '無効化' } }))

    const result = await getMasters()

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('TERMINAL_DISABLED')
  })
})

describe('ping', () => {
  test('GETで疎通確認する。設定不要でgasUrlを直接渡す', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, data: { pong: true, now: '2026-07-23T00:00:00Z' } }))

    const result = await ping(GAS_URL)

    expect(result).toEqual({ ok: true, data: { pong: true, now: '2026-07-23T00:00:00Z' } })
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('GET')
  })
})
