import { beforeEach, describe, expect, test } from 'vitest'
import { db } from '@/data/db/schema'
import type { DateKey } from '@/domain/types'
import { ensureMinSeq, nextSeq, peekSeq } from './counter'

const DAY1 = '20260723' as DateKey
const DAY2 = '20260724' as DateKey

beforeEach(async () => {
  await db.counters.clear()
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
