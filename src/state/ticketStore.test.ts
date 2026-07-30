import { beforeEach, describe, expect, test } from 'vitest'
import { getCurrentTicket } from '@/data/db/currentTicket'
import { db } from '@/data/db/schema'
import { toYen, type Product } from '@/domain/types'
import { useTicketStore } from './ticketStore'

function product(overrides: Partial<Product> = {}): Product {
  return {
    no: 1,
    name: 'からあげ串',
    price: toYen(500),
    categoryName: 'フード',
    displayOrder: null,
    status: '有効',
    ...overrides,
  }
}

beforeEach(async () => {
  await db.currentTicket.clear()
  useTicketStore.setState({ lines: [], note: '', hydrated: false })
})

describe('hydrate', () => {
  test('IndexedDBに何もなければ空の伝票になる', async () => {
    await useTicketStore.getState().hydrate()
    const state = useTicketStore.getState()
    expect(state.lines).toEqual([])
    expect(state.note).toBe('')
    expect(state.hydrated).toBe(true)
  })

  test('IndexedDBに保存済みの伝票があれば復元する（NF-04：再読み込み後の復元）', async () => {
    const products = [product()]
    await useTicketStore.getState().addProductByNo(1, products)
    await useTicketStore.getState().setNote('イベント割')

    // 「リロード」を模して、ストアの状態だけを空に戻す（IndexedDBの中身は残る）
    useTicketStore.setState({ lines: [], note: '', hydrated: false })

    await useTicketStore.getState().hydrate()

    const state = useTicketStore.getState()
    expect(state.lines).toHaveLength(1)
    expect(state.lines[0].productNo).toBe(1)
    expect(state.note).toBe('イベント割')
    expect(state.hydrated).toBe(true)
  })
})

describe('addProductByNo', () => {
  test('成功すると状態を更新し、IndexedDBにも保存する', async () => {
    const products = [product()]
    const result = await useTicketStore.getState().addProductByNo(1, products)

    expect(result.ok).toBe(true)
    expect(useTicketStore.getState().lines).toHaveLength(1)

    const persisted = await getCurrentTicket()
    expect(persisted?.lines).toHaveLength(1)
    expect(persisted?.lines[0].productNo).toBe(1)
  })

  test('存在しないNo.はエラーを返し、状態もIndexedDBも変更しない', async () => {
    const products = [product({ no: 1 })]
    const result = await useTicketStore.getState().addProductByNo(99, products)

    expect(result).toEqual({ ok: false, error: 'productNotFound' })
    expect(useTicketStore.getState().lines).toEqual([])
    expect(await getCurrentTicket()).toBeNull()
  })

  test('同一No.を連続追加すると個数が増える（新規行は増えない）', async () => {
    const products = [product()]
    await useTicketStore.getState().addProductByNo(1, products)
    await useTicketStore.getState().addProductByNo(1, products)

    const state = useTicketStore.getState()
    expect(state.lines).toHaveLength(1)
    expect(state.lines[0].qty).toBe(2)
  })
})

describe('incrementLineQty / decrementLineQty', () => {
  test('個数を増減し、都度永続化する', async () => {
    const products = [product()]
    await useTicketStore.getState().addProductByNo(1, products)
    const lineId = useTicketStore.getState().lines[0].lineId

    await useTicketStore.getState().incrementLineQty(lineId)
    expect(useTicketStore.getState().lines[0].qty).toBe(2)
    expect((await getCurrentTicket())?.lines[0].qty).toBe(2)

    await useTicketStore.getState().decrementLineQty(lineId)
    expect(useTicketStore.getState().lines[0].qty).toBe(1)
    expect((await getCurrentTicket())?.lines[0].qty).toBe(1)
  })

  test('個数1の行を減らすと行ごと削除され、永続化にも反映される', async () => {
    const products = [product()]
    await useTicketStore.getState().addProductByNo(1, products)
    const lineId = useTicketStore.getState().lines[0].lineId

    await useTicketStore.getState().decrementLineQty(lineId)

    expect(useTicketStore.getState().lines).toEqual([])
    expect((await getCurrentTicket())?.lines).toEqual([])
  })

  test('存在しない行IDはエラーを返し、状態を変更しない', async () => {
    const result = await useTicketStore.getState().incrementLineQty('missing')
    expect(result).toEqual({ ok: false, error: 'lineNotFound' })
  })
})

describe('setLineQty / removeLine / splitLine / setLineDiscount', () => {
  test('setLineQtyで直接個数を変更できる', async () => {
    const products = [product()]
    await useTicketStore.getState().addProductByNo(1, products)
    const lineId = useTicketStore.getState().lines[0].lineId

    await useTicketStore.getState().setLineQty(lineId, 5)

    expect(useTicketStore.getState().lines[0].qty).toBe(5)
    expect((await getCurrentTicket())?.lines[0].qty).toBe(5)
  })

  test('removeLineで行を削除できる', async () => {
    const products = [product()]
    await useTicketStore.getState().addProductByNo(1, products)
    const lineId = useTicketStore.getState().lines[0].lineId

    await useTicketStore.getState().removeLine(lineId)

    expect(useTicketStore.getState().lines).toEqual([])
    expect((await getCurrentTicket())?.lines).toEqual([])
  })

  test('splitLineで行を分割できる', async () => {
    const products = [product()]
    await useTicketStore.getState().addProductByNo(1, products)
    await useTicketStore.getState().incrementLineQty(useTicketStore.getState().lines[0].lineId)
    await useTicketStore.getState().incrementLineQty(useTicketStore.getState().lines[0].lineId)
    const lineId = useTicketStore.getState().lines[0].lineId // qty: 3

    const result = await useTicketStore.getState().splitLine(lineId, 1)

    expect(result.ok).toBe(true)
    expect(useTicketStore.getState().lines).toHaveLength(2)
    expect((await getCurrentTicket())?.lines).toHaveLength(2)
  })

  test('setLineDiscountで割引を設定できる', async () => {
    const products = [product({ price: toYen(500) })]
    await useTicketStore.getState().addProductByNo(1, products)
    const lineId = useTicketStore.getState().lines[0].lineId

    await useTicketStore.getState().setLineDiscount(lineId, 50)

    expect(useTicketStore.getState().lines[0].discount).toBe(50)
    expect((await getCurrentTicket())?.lines[0].discount).toBe(50)
  })

  test('単価を超える割引はエラーを返し、状態を変更しない', async () => {
    const products = [product({ price: toYen(500) })]
    await useTicketStore.getState().addProductByNo(1, products)
    const lineId = useTicketStore.getState().lines[0].lineId

    const result = await useTicketStore.getState().setLineDiscount(lineId, 600)

    expect(result).toEqual({ ok: false, error: 'discountExceedsUnitPrice' })
    expect(useTicketStore.getState().lines[0].discount).toBe(0)
  })
})

describe('setNote', () => {
  test('備考を設定し、永続化する（FR-13）', async () => {
    await useTicketStore.getState().setNote('テスト備考')

    expect(useTicketStore.getState().note).toBe('テスト備考')
    expect((await getCurrentTicket())?.note).toBe('テスト備考')
  })
})

describe('clear', () => {
  test('伝票を空にし、IndexedDBからも削除する（FR-12）', async () => {
    const products = [product()]
    await useTicketStore.getState().addProductByNo(1, products)
    await useTicketStore.getState().setNote('備考')

    await useTicketStore.getState().clear()

    expect(useTicketStore.getState().lines).toEqual([])
    expect(useTicketStore.getState().note).toBe('')
    expect(await getCurrentTicket()).toBeNull()
  })
})
