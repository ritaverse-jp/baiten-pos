/**
 * 商品タイルへの写真表示（タスク24）。
 *
 * 見た目（下地の不透明度・タイル寸法が変わらないこと）は CSS が持つため
 * jsdom では検証できない。**コントラスト比の保証そのものは
 * `domain/categoryColor.test.ts` が計算で検証している。**
 * ここで確かめるのは、写真の有無で DOM がどう変わるか。
 */

import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { putProductImage } from '@/data/db/productImages'
import { db } from '@/data/db/schema'
import { resolveCategoryPalette } from '@/domain/categoryColor'
import { toYen, type Category, type Product } from '@/domain/types'
import { __resetProductImageUrlsForTests } from '@/state/productImageUrls'
import ProductGrid from './ProductGrid'

const FOOD: Category = { name: 'フード', displayOrder: 0, color: null }
const PALETTE = resolveCategoryPalette([FOOD], 'フード')

function product(overrides: Partial<Product> = {}): Product {
  return { no: 1, name: 'からあげ串', price: toYen(500), categoryName: 'フード', displayOrder: 1, status: '有効', ...overrides }
}

function bytes(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer as ArrayBuffer
}

beforeEach(async () => {
  await db.productImages.clear()
  __resetProductImageUrlsForTests()
  vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:mock'), revokeObjectURL: vi.fn() })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('商品タイルの写真', () => {
  test('写真があれば背景に敷く', async () => {
    await putProductImage('img-1', bytes('画像'), 'image/jpeg')

    const { container } = render(<ProductGrid products={[product({ imageId: 'img-1' })]} onAdd={() => {}} palette={PALETTE} />)

    await waitFor(() => expect(container.querySelector('img')).not.toBeNull())
    expect(container.querySelector('img')).toHaveAttribute('src', 'blob:mock')
  })

  test('写真が無ければ img 要素を出さない（従来どおりの白カード）', () => {
    const { container } = render(<ProductGrid products={[product({ imageId: null })]} onAdd={() => {}} palette={PALETTE} />)

    expect(container.querySelector('img')).toBeNull()
  })

  /*
   * 写真の色は事前に分からないため、文字を直接重ねるとコントラスト比を
   * 保証できない。下地は写真がある場合にだけ敷く
   */
  test('写真があるときだけ文字の背後に下地を敷く', async () => {
    await putProductImage('img-1', bytes('画像'), 'image/jpeg')

    const { container, rerender } = render(
      <ProductGrid products={[product({ imageId: 'img-1' })]} onAdd={() => {}} palette={PALETTE} />,
    )
    await waitFor(() => expect(container.querySelector('img')).not.toBeNull())

    const withPhoto = screen.getByRole('button', { name: 'からあげ串を追加' })
    expect(withPhoto.innerHTML).toContain('rgba(255, 255, 255,')

    rerender(<ProductGrid products={[product({ imageId: null })]} onAdd={() => {}} palette={PALETTE} />)
    expect(screen.getByRole('button', { name: 'からあげ串を追加' }).innerHTML).not.toContain('rgba(255, 255, 255,')
  })

  /*
   * 写真は装飾であり、読み上げ対象は商品名・金額。ボタン自体の aria-label が
   * 名前を伝えるため、img には空の alt を付けて読み上げから外す
   */
  test('写真は装飾として扱う（alt が空・ボタンのラベルは変わらない）', async () => {
    await putProductImage('img-1', bytes('画像'), 'image/jpeg')

    const { container } = render(<ProductGrid products={[product({ imageId: 'img-1' })]} onAdd={() => {}} palette={PALETTE} />)

    await waitFor(() => expect(container.querySelector('img')).not.toBeNull())
    expect(container.querySelector('img')).toHaveAttribute('alt', '')
    expect(screen.getByRole('button', { name: 'からあげ串を追加' })).toBeInTheDocument()
  })

  test('写真あり・なしが混在しても両方描画される', async () => {
    await putProductImage('img-1', bytes('画像'), 'image/jpeg')

    const { container } = render(
      <ProductGrid
        products={[product({ no: 1, imageId: 'img-1' }), product({ no: 2, name: 'ラムネ', imageId: null })]}
        onAdd={() => {}}
        palette={PALETTE}
      />,
    )

    await waitFor(() => expect(container.querySelectorAll('img')).toHaveLength(1))
    expect(screen.getByRole('button', { name: 'からあげ串を追加' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'ラムネを追加' })).toBeInTheDocument()
  })
})
