/**
 * 伝票行のサムネイル表示（ユーザー要望）。
 *
 * 表示の有無とサイズは CSS が持つため jsdom では検証できない。ここで
 * 確かめるのは「どの写真を引いてくるか」と「無いときに要素を出さないか」。
 */

import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { putProductImage } from '@/data/db/productImages'
import { db } from '@/data/db/schema'
import { toYen, type Category, type Product, type TicketLine } from '@/domain/types'
import { useMasterStore } from '@/state/masterStore'
import { __resetProductImageUrlsForTests } from '@/state/productImageUrls'
import { useTicketStore } from '@/state/ticketStore'
import TicketLineRow from './TicketLineRow'

const FOOD: Category = { name: 'フード', displayOrder: 1, color: null }

function product(overrides: Partial<Product> = {}): Product {
  return { no: 1, name: 'からあげ串', price: toYen(500), categoryName: 'フード', displayOrder: 1, status: '有効', ...overrides }
}

function line(overrides: Partial<TicketLine> = {}): TicketLine {
  return {
    lineId: 'l1',
    productNo: 1,
    productName: 'からあげ串',
    unitPrice: toYen(500),
    qty: 1,
    discount: toYen(0),
    ...overrides,
  }
}

function bytes(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer as ArrayBuffer
}

beforeEach(async () => {
  await db.productImages.clear()
  __resetProductImageUrlsForTests()
  useTicketStore.setState({ hydrated: true, lines: [], note: '' })
  vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:mock'), revokeObjectURL: vi.fn() })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('伝票行のサムネイル', () => {
  test('商品に写真があれば表示する', async () => {
    useMasterStore.setState({ products: [product({ imageId: 'img-1' })], categories: [FOOD], hydrated: true })
    await putProductImage('img-1', bytes('画像'), 'image/jpeg')

    render(<TicketLineRow line={line()} highlighted={false} />)

    await waitFor(() => expect(screen.getByRole('presentation', { hidden: true })).toBeInTheDocument())
  })

  /*
   * 空の四角が並ぶと見苦しく、写真ありの行と混在したときに情報量が増える
   * だけになるため、無いときは要素ごと出さない
   */
  test('写真が未設定なら要素ごと出さない', () => {
    useMasterStore.setState({ products: [product({ imageId: null })], categories: [FOOD], hydrated: true })

    const { container } = render(<TicketLineRow line={line()} highlighted={false} />)

    expect(container.querySelector('img')).toBeNull()
  })

  /*
   * オフラインで一度も取得していない場合。写真が出ないだけで、個数変更などの
   * 操作は一切妨げない（要件定義 9.1）
   */
  test('写真IDはあるが未取得なら出さず、行の操作は妨げない', async () => {
    useMasterStore.setState({ products: [product({ imageId: 'img-未取得' })], categories: [FOOD], hydrated: true })

    const { container } = render(<TicketLineRow line={line()} highlighted={false} />)

    await waitFor(() => expect(container.querySelector('img')).toBeNull())
    expect(screen.getByRole('button', { name: 'からあげ串の個数を増やす' })).not.toBeDisabled()
  })

  /*
   * TicketLine は確定時点の商品名・金額を持つが画像IDは持たない（写真は表示の
   * 補助であり伝票の内容ではないため）。マスタから No. で引く
   */
  test('マスタから消えた商品の行でも落ちず、写真なしで表示する', () => {
    useMasterStore.setState({ products: [], categories: [FOOD], hydrated: true })

    const { container } = render(<TicketLineRow line={line()} highlighted={false} />)

    expect(screen.getByText('からあげ串')).toBeInTheDocument()
    expect(container.querySelector('img')).toBeNull()
  })

  test('同じ商品でも行ごとに正しい写真を引く（行を分けた場合）', async () => {
    useMasterStore.setState({
      products: [product({ no: 1, imageId: 'img-1' }), product({ no: 2, name: 'ラムネ', imageId: 'img-2' })],
      categories: [FOOD],
      hydrated: true,
    })
    await putProductImage('img-2', bytes('ラムネの画像'), 'image/jpeg')

    const { container } = render(
      <TicketLineRow line={line({ lineId: 'l2', productNo: 2, productName: 'ラムネ' })} highlighted={false} />,
    )

    // img-1 は未取得、img-2 は取得済み。No.2 の行なので表示される
    await waitFor(() => expect(container.querySelector('img')).not.toBeNull())
  })
})
