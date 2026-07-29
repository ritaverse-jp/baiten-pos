import { beforeEach, describe, expect, test } from 'vitest'
import { toYen, type Category, type Product } from '@/domain/types'
import { getAllCategories, getAllProducts, replaceCategories, replaceProducts } from './masters'
import { db } from './schema'

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
})

describe('products', () => {
  test('初期状態は空', async () => {
    expect(await getAllProducts()).toEqual([])
  })

  test('置き換えた内容がそのまま読める', async () => {
    await replaceProducts([product({ no: 1 }), product({ no: 2, name: 'ラムネ' })])
    const all = await getAllProducts()
    expect(all).toHaveLength(2)
    expect(all.map((p) => p.no).sort()).toEqual([1, 2])
  })

  test('再度置き換えると前回分は残らない（マージではなく丸ごと置換）', async () => {
    await replaceProducts([product({ no: 1 }), product({ no: 2 })])
    await replaceProducts([product({ no: 3 })])
    const all = await getAllProducts()
    // clear を忘れて bulkPut だけする実装だと no:1,2 が残ってしまう
    expect(all.map((p) => p.no)).toEqual([3])
  })

  test('空配列で置き換えるとキャッシュが空になる', async () => {
    await replaceProducts([product({ no: 1 })])
    await replaceProducts([])
    expect(await getAllProducts()).toEqual([])
  })
})

describe('categories', () => {
  test('置き換えた内容がそのまま読める', async () => {
    await replaceCategories([category({ name: 'フード' }), category({ name: 'ドリンク' })])
    const all = await getAllCategories()
    expect(all.map((c) => c.name).sort()).toEqual(['ドリンク', 'フード'])
  })

  test('再度置き換えると前回分は残らない', async () => {
    await replaceCategories([category({ name: 'フード' })])
    await replaceCategories([category({ name: 'その他' })])
    expect((await getAllCategories()).map((c) => c.name)).toEqual(['その他'])
  })
})
