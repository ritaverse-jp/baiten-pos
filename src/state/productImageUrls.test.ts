import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { deleteProductImageFromCache, putProductImage } from '@/data/db/productImages'
import { db } from '@/data/db/schema'
import { __resetProductImageUrlsForTests, useProductImageUrl } from './productImageUrls'

function bytes(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer as ArrayBuffer
}

let created: string[] = []
let revoked: string[] = []

beforeEach(async () => {
  await db.productImages.clear()
  __resetProductImageUrlsForTests()
  created = []
  revoked = []
  let counter = 0
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => {
      const url = `blob:mock-${(counter += 1)}`
      created.push(url)
      return url
    }),
    revokeObjectURL: vi.fn((url: string) => revoked.push(url)),
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useProductImageUrl', () => {
  test('キャッシュ済みの画像IDに対して表示用URLを返す', async () => {
    await putProductImage('img-1', bytes('画像'), 'image/jpeg')

    const { result } = renderHook(() => useProductImageUrl('img-1'))

    await waitFor(() => expect(result.current).toBe('blob:mock-1'))
  })

  test('未設定（null）なら常にnull', async () => {
    await putProductImage('img-1', bytes('画像'), 'image/jpeg')

    const { result } = renderHook(() => useProductImageUrl(null))

    expect(result.current).toBeNull()
  })

  /*
   * 未取得は異常ではない（オフラインで一度も取れていない等）。呼び出し側は
   * 写真なしの見た目にフォールバックし、操作は制限しない（要件定義 9.1）
   */
  test('キャッシュに無い画像IDはnull', async () => {
    const { result } = renderHook(() => useProductImageUrl('img-未取得'))

    await waitFor(() => expect(result.current).toBeNull())
  })

  /*
   * 写真の取得はバックグラウンドで GAS への往復を挟むため、画面を描いた後に
   * 完了するのが普通。購読していないと「開いた瞬間に手元にあったものだけ」を
   * 表示して固まる（実際にこの不具合が出た）
   */
  test('あとからキャッシュに届いた写真が自動で反映される', async () => {
    const { result } = renderHook(() => useProductImageUrl('img-1'))
    await waitFor(() => expect(result.current).toBeNull())

    await putProductImage('img-1', bytes('あとから'), 'image/jpeg')

    await waitFor(() => expect(result.current).toBe('blob:mock-1'))
  })

  test('キャッシュから消えたらURLを解放してnullに戻す', async () => {
    await putProductImage('img-1', bytes('画像'), 'image/jpeg')
    const { result } = renderHook(() => useProductImageUrl('img-1'))
    await waitFor(() => expect(result.current).toBe('blob:mock-1'))

    await deleteProductImageFromCache('img-1')

    await waitFor(() => expect(result.current).toBeNull())
    expect(revoked).toContain('blob:mock-1')
  })
})

/*
 * 同じ写真が商品タイルと伝票行に同時に出るうえ、伝票行は個数変更のたびに
 * 再描画される。表示のたびに createObjectURL を呼ぶ作りだと object URL が
 * 際限なく増えるため、画像IDごとに1本だけ作って共有する
 */
describe('object URL は画像IDごとに1本だけ作る', () => {
  test('同じ画像IDを複数箇所で使ってもURLは1本', async () => {
    await putProductImage('img-1', bytes('画像'), 'image/jpeg')

    const a = renderHook(() => useProductImageUrl('img-1'))
    const b = renderHook(() => useProductImageUrl('img-1'))
    await waitFor(() => expect(a.result.current).toBe('blob:mock-1'))

    expect(b.result.current).toBe(a.result.current)
    expect(created).toHaveLength(1)
  })

  test('再描画を繰り返してもURLは増えない', async () => {
    await putProductImage('img-1', bytes('画像'), 'image/jpeg')
    const { result, rerender } = renderHook(() => useProductImageUrl('img-1'))
    await waitFor(() => expect(result.current).toBe('blob:mock-1'))

    rerender()
    rerender()
    rerender()

    expect(created).toHaveLength(1)
  })
})
