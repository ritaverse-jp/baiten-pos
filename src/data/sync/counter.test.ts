import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { saveConfig } from '@/data/db/config'
import { db } from '@/data/db/schema'
import { toTerminalCode, type DateKey } from '@/domain/types'
import { ensureMinSeq, nextSeq, peekSeq, reconcileCounterOnStartup } from './counter'

const DAY1 = '20260723' as DateKey
const DAY2 = '20260724' as DateKey
const DAY1_DATE = new Date(2026, 6, 23) // toDateKey で DAY1 になる
const GAS_URL = 'https://script.google.com/macros/s/FAKE/exec'

beforeEach(async () => {
  await db.counters.clear()
  await db.config.clear()
})

describe('nextSeq', () => {
  test('初回は1から始まる', async () => {
    expect(await nextSeq(DAY1)).toBe(1)
  })

  test('呼ぶたびに1ずつ増える', async () => {
    expect(await nextSeq(DAY1)).toBe(1)
    expect(await nextSeq(DAY1)).toBe(2)
    expect(await nextSeq(DAY1)).toBe(3)
  })

  test('日付が変わると001から再開する（別の日付キーは独立している）', async () => {
    expect(await nextSeq(DAY1)).toBe(1)
    expect(await nextSeq(DAY1)).toBe(2)
    expect(await nextSeq(DAY2)).toBe(1)
  })

  test('同時に大量に呼び出しても連番が重複しない（トランザクションによる直列化）', async () => {
    const N = 50
    const results = await Promise.all(Array.from({ length: N }, () => nextSeq(DAY1)))
    const unique = new Set(results)
    // read→+1→write がトランザクションで直列化されない実装だと、複数の呼び出しが
    // 同じ現在値を読んでしまい、重複した連番を返してしまう（二重タップと同じ状況）
    expect(unique.size).toBe(N)
    expect([...unique].sort((a, b) => a - b)).toEqual(Array.from({ length: N }, (_, i) => i + 1))
  })

  test('異なる日付キーへの同時採番も、それぞれ独立して重複なく1から振られる', async () => {
    const N = 20
    const [resultsA, resultsB] = await Promise.all([
      Promise.all(Array.from({ length: N }, () => nextSeq(DAY1))),
      Promise.all(Array.from({ length: N }, () => nextSeq(DAY2))),
    ])
    expect(new Set(resultsA).size).toBe(N)
    expect(new Set(resultsB).size).toBe(N)
    expect(Math.max(...resultsA)).toBe(N)
    expect(Math.max(...resultsB)).toBe(N)
  })
})

describe('peekSeq', () => {
  test('カウンタが存在しなければ0を返す', async () => {
    expect(await peekSeq(DAY1)).toBe(0)
  })

  test('採番を行わずに現在値だけを読む（呼んでも連番は進まない）', async () => {
    await nextSeq(DAY1)
    await nextSeq(DAY1)
    expect(await peekSeq(DAY1)).toBe(2)
    expect(await peekSeq(DAY1)).toBe(2)
  })
})

describe('ensureMinSeq', () => {
  test('現在値が指定値未満なら引き上げる', async () => {
    await nextSeq(DAY1) // 1
    await ensureMinSeq(DAY1, 14)
    expect(await peekSeq(DAY1)).toBe(14)
  })

  test('現在値が指定値以上なら何もしない（採番済みの番号を巻き戻さない）', async () => {
    for (let i = 0; i < 5; i++) await nextSeq(DAY1) // -> 5
    await ensureMinSeq(DAY1, 3)
    expect(await peekSeq(DAY1)).toBe(5)
  })

  test('引き上げ後の次の採番は指定値の続きから始まる', async () => {
    await ensureMinSeq(DAY1, 14)
    expect(await nextSeq(DAY1)).toBe(15)
  })

  test('カウンタが未初期化の日付キーにも適用できる', async () => {
    await ensureMinSeq(DAY1, 7)
    expect(await peekSeq(DAY1)).toBe(7)
  })
})

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 })
}

describe('reconcileCounterOnStartup', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('端末未登録なら何もせずokを返す（サーバーに問い合わせない）', async () => {
    vi.stubGlobal('fetch', vi.fn())
    const result = await reconcileCounterOnStartup(DAY1_DATE)
    expect(result).toBe('ok')
    expect(fetch).not.toHaveBeenCalled()
  })

  test('カウンタが既に初期化済みなら何もせずokを返す（サーバーに問い合わせない）', async () => {
    await saveConfig({ gasUrl: GAS_URL, apiToken: 'tok', terminalCode: toTerminalCode('A') })
    await nextSeq(DAY1) // カウンタを1にしておく
    vi.stubGlobal('fetch', vi.fn())

    const result = await reconcileCounterOnStartup(DAY1_DATE)

    expect(result).toBe('ok')
    expect(fetch).not.toHaveBeenCalled()
    expect(await peekSeq(DAY1)).toBe(1) // 書き換えられていない
  })

  test('端末登録済みでカウンタ未初期化なら getTodayMaxSeq で復元する', async () => {
    await saveConfig({ gasUrl: GAS_URL, apiToken: 'tok', terminalCode: toTerminalCode('A') })
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true, data: { maxSeq: 14 } }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await reconcileCounterOnStartup(DAY1_DATE)

    expect(result).toBe('ok')
    expect(await peekSeq(DAY1)).toBe(14)
    // 次の採番はサーバー最大値+1から始まる
    expect(await nextSeq(DAY1)).toBe(15)
  })

  test('サーバーの最大連番が0（当日まだ1件もない）でも正しく復元する', async () => {
    await saveConfig({ gasUrl: GAS_URL, apiToken: 'tok', terminalCode: toTerminalCode('A') })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ ok: true, data: { maxSeq: 0 } })))

    const result = await reconcileCounterOnStartup(DAY1_DATE)

    expect(result).toBe('ok')
    expect(await nextSeq(DAY1)).toBe(1)
  })

  test('オフラインで問い合わせできない場合はblockedを返す（design 5.3）', async () => {
    await saveConfig({ gasUrl: GAS_URL, apiToken: 'tok', terminalCode: toTerminalCode('A') })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    const result = await reconcileCounterOnStartup(DAY1_DATE)

    expect(result).toBe('blocked')
    expect(await peekSeq(DAY1)).toBe(0) // 復元されていない
  })

  test('日付が変わればその日付キーだけを見る（前日のカウンタとは独立）', async () => {
    await saveConfig({ gasUrl: GAS_URL, apiToken: 'tok', terminalCode: toTerminalCode('A') })
    await nextSeq(DAY2) // 前日分だけ初期化済みにしておく
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ ok: true, data: { maxSeq: 5 } })))

    const result = await reconcileCounterOnStartup(DAY1_DATE)

    expect(result).toBe('ok')
    expect(await peekSeq(DAY1)).toBe(5) // 当日分はサーバー値で復元される
    expect(await peekSeq(DAY2)).toBe(1) // 前日分は影響を受けない
  })
})
