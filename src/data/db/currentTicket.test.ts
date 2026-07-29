import { beforeEach, describe, expect, test } from 'vitest'
import { toYen, type Ticket } from '@/domain/types'
import { clearCurrentTicket, getCurrentTicket, saveCurrentTicket } from './currentTicket'
import { db } from './schema'

function ticket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    lines: [
      {
        lineId: 'l1',
        productNo: 1,
        productName: 'からあげ串',
        unitPrice: toYen(500),
        qty: 1,
        discount: toYen(0),
      },
    ],
    note: '',
    updatedAt: '2026-07-23T14:32:00+09:00',
    ...overrides,
  }
}

beforeEach(async () => {
  await db.currentTicket.clear()
})

describe('getCurrentTicket', () => {
  test('保存されていなければnullを返す', async () => {
    expect(await getCurrentTicket()).toBeNull()
  })

  test('保存した内容をそのまま復元する（NF-04）', async () => {
    await saveCurrentTicket(ticket({ note: 'イベント割' }))
    expect(await getCurrentTicket()).toEqual(ticket({ note: 'イベント割' }))
  })
})

describe('saveCurrentTicket', () => {
  test('DB固有の主キーをTicket型に漏らさない', async () => {
    await saveCurrentTicket(ticket())
    const restored = await getCurrentTicket()
    // ドメイン層は id フィールドを知らないため、復元後にも含まれてはならない
    expect(restored).not.toHaveProperty('id')
  })

  test('再保存すると内容が上書きされる（1件しか存在しない）', async () => {
    await saveCurrentTicket(ticket({ note: '1回目' }))
    await saveCurrentTicket(ticket({ note: '2回目' }))
    expect((await getCurrentTicket())?.note).toBe('2回目')
    expect(await db.currentTicket.count()).toBe(1)
  })
})

describe('clearCurrentTicket', () => {
  test('会計確定・伝票クリア後は復元されない', async () => {
    await saveCurrentTicket(ticket())
    await clearCurrentTicket()
    expect(await getCurrentTicket()).toBeNull()
  })

  test('何も保存されていない状態で呼んでもエラーにならない', async () => {
    await expect(clearCurrentTicket()).resolves.not.toThrow()
  })
})
