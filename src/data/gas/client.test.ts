import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { getFromGas, postToGas } from './client'

const GAS_URL = 'https://script.google.com/macros/s/FAKE/exec'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('postToGas', () => {
  test('text/plain で POST し、action を含むボディを送る', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, data: { pong: true } }))

    await postToGas(GAS_URL, { action: 'ping' })

    expect(fetchMock).toHaveBeenCalledWith(
      GAS_URL,
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ action: 'ping' }),
      }),
    )
  })

  test('application/json ではなく text/plain を指定する（GASのCORS制約。design 2.1）', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, data: {} }))

    await postToGas(GAS_URL, { action: 'ping' })

    const options = fetchMock.mock.calls[0][1] as RequestInit
    expect((options.headers as Record<string, string>)['Content-Type']).toBe('text/plain')
  })

  test('サーバーの成功応答をそのまま透過する', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, data: { products: [], categories: [] } }))

    const result = await postToGas(GAS_URL, { action: 'getMasters' })

    expect(result).toEqual({ ok: true, data: { products: [], categories: [] } })
  })

  test('サーバーのエラー応答（ServerErrorCode）をそのまま透過する', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(jsonResponse({ ok: false, error: { code: 'UNAUTHORIZED', message: 'トークンが無効です' } }))

    const result = await postToGas(GAS_URL, { action: 'getMasters' })

    expect(result).toEqual({ ok: false, error: { code: 'UNAUTHORIZED', message: 'トークンが無効です' } })
  })

  test('TOKEN_EXPIRED をそのまま透過する（design 6.6 の分岐に必要）', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(jsonResponse({ ok: false, error: { code: 'TOKEN_EXPIRED', message: '期限切れ' } }))

    const result = await postToGas(GAS_URL, { action: 'getMasters' })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('TOKEN_EXPIRED')
  })

  test('TERMINAL_DISABLED をそのまま透過する（design 6.6 の分岐に必要）', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(jsonResponse({ ok: false, error: { code: 'TERMINAL_DISABLED', message: '無効化されています' } }))

    const result = await postToGas(GAS_URL, { action: 'getMasters' })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('TERMINAL_DISABLED')
  })

  test('fetch自体が例外を投げた場合はNETWORK_ERRORにする', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))

    const result = await postToGas(GAS_URL, { action: 'ping' })

    expect(result).toEqual({
      ok: false,
      error: { code: 'NETWORK_ERROR', message: expect.any(String) },
    })
  })

  test('タイムアウト時はTIMEOUTを返す', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          const signal = (init as RequestInit).signal
          signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted', 'AbortError'))
          })
        }),
    )

    const promise = postToGas(GAS_URL, { action: 'ping' }, { timeoutMs: 1000 })
    await vi.advanceTimersByTimeAsync(1000)
    const result = await promise

    expect(result).toEqual({
      ok: false,
      error: { code: 'TIMEOUT', message: expect.any(String) },
    })
  })

  test('JSONとして解釈できない応答はMALFORMED_RESPONSEにする', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(new Response('<html>アクセスが拒否されました</html>', { status: 200 }))

    const result = await postToGas(GAS_URL, { action: 'ping' })

    expect(result).toEqual({
      ok: false,
      error: { code: 'MALFORMED_RESPONSE', message: expect.any(String) },
    })
  })

  test('okフィールドを欠いた応答はMALFORMED_RESPONSEにする', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(jsonResponse({ pong: true }))

    const result = await postToGas(GAS_URL, { action: 'ping' })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('MALFORMED_RESPONSE')
  })

  test('ok:falseなのにerrorが欠けている応答はMALFORMED_RESPONSEにする', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(jsonResponse({ ok: false }))

    const result = await postToGas(GAS_URL, { action: 'ping' })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('MALFORMED_RESPONSE')
  })
})

describe('getFromGas', () => {
  test('GETでクエリパラメータを付与する（pingの疎通確認専用。design 2.1）', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, data: { pong: true } }))

    await getFromGas(GAS_URL, { action: 'ping' })

    const [calledUrl, options] = fetchMock.mock.calls[0]
    expect(String(calledUrl)).toBe(`${GAS_URL}?action=ping`)
    expect((options as RequestInit).method).toBe('GET')
  })

  test('サーバー応答を透過する', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, data: { pong: true, now: '2026-07-23T00:00:00Z' } }))

    const result = await getFromGas(GAS_URL, { action: 'ping' })

    expect(result).toEqual({ ok: true, data: { pong: true, now: '2026-07-23T00:00:00Z' } })
  })

  test('ネットワークエラーをNETWORK_ERRORに正規化する', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))

    const result = await getFromGas(GAS_URL, { action: 'ping' })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('NETWORK_ERROR')
  })
})
