import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { saveConfig } from '@/data/db/config'
import { getCachedImageIds, getProductImageBlob, putProductImage } from '@/data/db/productImages'
import { db } from '@/data/db/schema'
import { toTerminalCode, toYen, type Product } from '@/domain/types'
import { base64ToBytes, syncProductImages } from './productImages'

const GAS_URL = 'https://script.google.com/macros/s/FAKE/exec'

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 })
}

function product(no: number, imageId: string | null): Product {
  return {
    no,
    name: `商品${no}`,
    price: toYen(100),
    categoryName: '食べ物',
    displayOrder: null,
    status: '有効',
    imageId,
  }
}

/** GAS の `getProductImage` 応答（生の Base64。`data:` 接頭辞は含まない） */
function imageResponse(imageId: string, base64 = 'YWJj') {
  return jsonResponse({ ok: true, data: { imageId, mimeType: 'image/jpeg', imageBase64: base64 } })
}

beforeEach(async () => {
  await db.productImages.clear()
  await db.config.clear()
  await saveConfig({
    gasUrl: GAS_URL,
    apiToken: 'test-token',
    terminalCode: toTerminalCode('A'),
    terminalName: 'レジ1',
  })
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('未取得ぶんだけを取りに行く（docs/design.md 9.4）', () => {
  test('参照されている画像のうち手元に無いものを取得する', async () => {
    vi.mocked(fetch).mockResolvedValue(imageResponse('img-1'))

    const result = await syncProductImages([product(1, 'img-1')])

    expect(result.fetched).toBe(1)
    expect(await getProductImageBlob('img-1')).toBeDefined()
  })

  /*
   * 写真を差し替えると Drive のファイルIDが変わるため、IDが一致していれば
   * 中身も同じと言い切れる。キャッシュ済みを取り直さないのがこの設計の要点
   */
  test('既にキャッシュ済みの画像は取得しに行かない', async () => {
    await putProductImage('img-1', new TextEncoder().encode('既存').buffer as ArrayBuffer, 'image/jpeg')

    const result = await syncProductImages([product(1, 'img-1')])

    expect(result.fetched).toBe(0)
    expect(fetch).not.toHaveBeenCalled()
    expect(await (await getProductImageBlob('img-1'))!.text()).toBe('既存')
  })

  test('imageId が無い商品は何も取得しない', async () => {
    const result = await syncProductImages([product(1, null), product(2, null)])

    expect(result.fetched).toBe(0)
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('参照されなくなった画像の後片付け', () => {
  test('マスタから消えた商品の画像を削除する', async () => {
    await putProductImage('img-削除済み', new TextEncoder().encode('x').buffer as ArrayBuffer, 'image/jpeg')
    await putProductImage('img-1', new TextEncoder().encode('y').buffer as ArrayBuffer, 'image/jpeg')

    const result = await syncProductImages([product(1, 'img-1')])

    expect(result.pruned).toBe(1)
    expect(await getCachedImageIds()).toEqual(['img-1'])
  })

  test('写真を差し替えると、古い画像は削除され新しい画像が取得される', async () => {
    await putProductImage('img-旧', new TextEncoder().encode('古い').buffer as ArrayBuffer, 'image/jpeg')
    vi.mocked(fetch).mockResolvedValue(imageResponse('img-新'))

    const result = await syncProductImages([product(1, 'img-新')])

    expect(result.pruned).toBe(1)
    expect(result.fetched).toBe(1)
    expect(await getProductImageBlob('img-旧')).toBeUndefined()
    expect(await getProductImageBlob('img-新')).toBeDefined()
  })
})

describe('通信できない場合（要件定義 9.1：写真の失敗で業務を止めない）', () => {
  test('取得に失敗しても例外を投げず、取得済みぶんは保持する', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(imageResponse('img-1'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))

    const result = await syncProductImages([product(1, 'img-1'), product(2, 'img-2')])

    expect(result.fetched).toBe(1)
    expect(result.remaining).toBe(1)
    expect(await getProductImageBlob('img-1')).toBeDefined()
    expect(await getProductImageBlob('img-2')).toBeUndefined()
  })

  test('1件目で失敗したら以降は試さない（残りは次回に持ち越す）', async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'))

    const result = await syncProductImages([product(1, 'img-1'), product(2, 'img-2')])

    expect(result.fetched).toBe(0)
    expect(result.remaining).toBe(2)
    expect(vi.mocked(fetch).mock.calls).toHaveLength(1)
  })
})

describe('1回あたりの取得枚数に上限を設ける', () => {
  test('上限を超えるぶんは remaining として次回に持ち越す', async () => {
    vi.mocked(fetch).mockImplementation(() => Promise.resolve(imageResponse('img')))
    const products = Array.from({ length: 25 }, (_, i) => product(i + 1, `img-${i + 1}`))

    const result = await syncProductImages(products)

    expect(result.fetched).toBe(20)
    expect(result.remaining).toBe(5)
  })
})

/*
 * この関数は `masterStore.refreshFromServer` から fire-and-forget で呼ばれる。
 * 例外を投げると未処理の Promise 拒否になり、しかも残りの写真の取得まで
 * 巻き添えで止まる。実際に実装当初はここで落ちていた
 */
describe('応答が壊れていても例外を投げない', () => {
  test('imageBase64 が壊れていても、その1枚を諦めて次へ進む', async () => {
    vi.mocked(fetch).mockImplementation(async (_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string)
      return body.imageId === 'img-壊れ'
        ? jsonResponse({ ok: true, data: { imageId: 'img-壊れ', mimeType: 'image/jpeg', imageBase64: '!!!不正!!!' } })
        : imageResponse(body.imageId)
    })

    const result = await syncProductImages([product(1, 'img-壊れ'), product(2, 'img-正常')])

    expect(result.fetched).toBe(1)
    expect(await getProductImageBlob('img-壊れ')).toBeUndefined()
    expect(await getProductImageBlob('img-正常')).toBeDefined()
  })

  test('imageBase64 が欠けている応答でも例外を投げない', async () => {
    vi.mocked(fetch).mockImplementation(async () =>
      jsonResponse({ ok: true, data: { imageId: 'img-1', mimeType: 'image/jpeg' } }),
    )

    await expect(syncProductImages([product(1, 'img-1')])).resolves.toMatchObject({ fetched: 0 })
  })
})

describe('base64ToBytes', () => {
  test('生のBase64をArrayBufferに変換する（data:接頭辞は含まない前提）', () => {
    const buffer = base64ToBytes('YWJj') // "abc"

    expect(new TextDecoder().decode(buffer)).toBe('abc')
  })
})
