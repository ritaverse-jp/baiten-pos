import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { getConfig, saveConfig } from '@/data/db/config'
import { db } from '@/data/db/schema'
import { toTerminalCode } from '@/domain/types'
import { __resetTokenRefreshWatcherForTests, checkTokenExpiry } from './tokenRefresh'

const GAS_URL = 'https://script.google.com/macros/s/FAKE/exec'

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 })
}

function daysFromNow(now: Date, days: number): string {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString()
}

beforeEach(async () => {
  __resetTokenRefreshWatcherForTests()
  await db.config.clear()
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('残り日数が14日を切っていない場合', () => {
  test('refreshTokenを呼ばない', async () => {
    const now = new Date('2026-07-30T00:00:00+09:00')
    await saveConfig({
      gasUrl: GAS_URL,
      apiToken: 'tok',
      terminalCode: toTerminalCode('A'),
      tokenExpiresAt: daysFromNow(now, 20),
    })

    await checkTokenExpiry(now)

    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('残り日数が14日を切っている場合（design 6.5）', () => {
  test('refreshTokenを呼び、成功したらconfigのapiToken・tokenExpiresAtを更新する', async () => {
    const now = new Date('2026-07-30T00:00:00+09:00')
    await saveConfig({
      gasUrl: GAS_URL,
      apiToken: 'old-token',
      terminalCode: toTerminalCode('A'),
      tokenExpiresAt: daysFromNow(now, 10),
    })
    const newExpiresAt = daysFromNow(now, 90)
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        ok: true,
        data: { terminalCode: 'A', terminalName: 'レジ1', apiToken: 'new-token', expiresAt: newExpiresAt },
      }),
    )

    await checkTokenExpiry(now)

    const config = await getConfig()
    expect(config.apiToken).toBe('new-token')
    expect(config.tokenExpiresAt).toBe(newExpiresAt)
  })

  test('失敗した場合はconfigを変更しない', async () => {
    const now = new Date('2026-07-30T00:00:00+09:00')
    await saveConfig({
      gasUrl: GAS_URL,
      apiToken: 'old-token',
      terminalCode: toTerminalCode('A'),
      tokenExpiresAt: daysFromNow(now, 10),
    })
    vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'))

    await checkTokenExpiry(now)

    const config = await getConfig()
    expect(config.apiToken).toBe('old-token')
  })

  test('境界値：ちょうど14日残りでも巻き直す', async () => {
    const now = new Date('2026-07-30T00:00:00+09:00')
    await saveConfig({
      gasUrl: GAS_URL,
      apiToken: 'old-token',
      terminalCode: toTerminalCode('A'),
      tokenExpiresAt: daysFromNow(now, 14),
    })
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ ok: true, data: { terminalCode: 'A', terminalName: 'レジ1', apiToken: 'new-token', expiresAt: daysFromNow(now, 90) } }),
    )

    await checkTokenExpiry(now)

    expect(fetch).toHaveBeenCalled()
  })
})

describe('未設定・未登録の端末', () => {
  test('apiTokenが無ければ何もしない', async () => {
    await checkTokenExpiry(new Date('2026-07-30T00:00:00+09:00'))
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('短時間での連続呼び出し', () => {
  test('間引かれ、直近のチェックから1時間未満なら再度は問い合わせない', async () => {
    const now = new Date('2026-07-30T00:00:00+09:00')
    await saveConfig({
      gasUrl: GAS_URL,
      apiToken: 'old-token',
      terminalCode: toTerminalCode('A'),
      tokenExpiresAt: daysFromNow(now, 10),
    })
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ ok: true, data: { terminalCode: 'A', terminalName: 'レジ1', apiToken: 'new-token', expiresAt: daysFromNow(now, 90) } }),
    )

    await checkTokenExpiry(now)
    vi.mocked(fetch).mockClear()
    await checkTokenExpiry(new Date(now.getTime() + 60 * 1000)) // 1分後

    expect(fetch).not.toHaveBeenCalled()
  })
})
