import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { saveConfig } from '@/data/db/config'
import { getAllCategories, getAllProducts } from '@/data/db/masters'
import { db } from '@/data/db/schema'
import { toTerminalCode, toYen, type Category, type Product } from '@/domain/types'
import { useMasterStore } from './masterStore'

const GAS_URL = 'https://script.google.com/macros/s/FAKE/exec'

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 })
}

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

function category(overrides: Partial<Category> = {}): Category {
  return { name: 'フード', displayOrder: null, color: null, ...overrides }
}

beforeEach(async () => {
  await db.products.clear()
  await db.categories.clear()
  useMasterStore.setState({ products: [], categories: [], hydrated: false })
})

describe('hydrate', () => {
  test('IndexedDBが空なら空のまま', async () => {
    await useMasterStore.getState().hydrate()
    const state = useMasterStore.getState()
    expect(state.products).toEqual([])
    expect(state.categories).toEqual([])
    expect(state.hydrated).toBe(true)
  })

  test('IndexedDBにキャッシュがあれば復元する', async () => {
    await useMasterStore.getState().replace([product()], [category()])
    useMasterStore.setState({ products: [], categories: [], hydrated: false })

    await useMasterStore.getState().hydrate()

    const state = useMasterStore.getState()
    expect(state.products).toHaveLength(1)
    expect(state.categories).toHaveLength(1)
    expect(state.hydrated).toBe(true)
  })
})

describe('replace', () => {
  test('IndexedDBとストアの両方を丸ごと置き換える', async () => {
    await useMasterStore.getState().replace(
      [product({ no: 1 }), product({ no: 2, name: 'ラムネ' })],
      [category({ name: 'フード' })],
    )

    expect(useMasterStore.getState().products).toHaveLength(2)
    expect(await getAllProducts()).toHaveLength(2)
    expect(await getAllCategories()).toHaveLength(1)
  })

  test('再度replaceすると前回分は残らない（マージではなく丸ごと置換）', async () => {
    await useMasterStore.getState().replace([product({ no: 1 }), product({ no: 2 })], [])
    await useMasterStore.getState().replace([product({ no: 3 })], [])

    expect(useMasterStore.getState().products.map((p) => p.no)).toEqual([3])
    expect((await getAllProducts()).map((p) => p.no)).toEqual([3])
  })

  test('空配列で置き換えるとキャッシュもストアも空になる', async () => {
    await useMasterStore.getState().replace([product()], [category()])
    await useMasterStore.getState().replace([], [])

    expect(useMasterStore.getState().products).toEqual([])
    expect(useMasterStore.getState().categories).toEqual([])
    expect(await getAllProducts()).toEqual([])
  })
})

describe('refreshFromServer', () => {
  beforeEach(async () => {
    await db.config.clear()
    await saveConfig({ gasUrl: GAS_URL, apiToken: 'tok', terminalCode: toTerminalCode('A') })
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('成功時はgetMastersの結果でreplaceする', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        ok: true,
        data: { products: [product()], categories: [category()], terminalStatus: '有効', fetchedAt: '2026-07-30T00:00:00+09:00' },
      }),
    )

    const result = await useMasterStore.getState().refreshFromServer()

    expect(result.ok).toBe(true)
    expect(useMasterStore.getState().products).toHaveLength(1)
    expect(await getAllProducts()).toHaveLength(1)
  })

  test('失敗時はストアを変更せずエラーを返す', async () => {
    await useMasterStore.getState().replace([product()], [category()])
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ ok: false, error: { code: 'TOKEN_EXPIRED', message: '期限切れ' } }))

    const result = await useMasterStore.getState().refreshFromServer()

    expect(result.ok).toBe(false)
    expect(useMasterStore.getState().products).toHaveLength(1)
  })
})
