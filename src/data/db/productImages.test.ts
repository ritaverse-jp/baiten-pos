import { beforeEach, describe, expect, test } from 'vitest'
import {
  clearProductImages,
  deleteUnreferencedImages,
  getCachedImageIds,
  getProductImageBlob,
  putProductImage,
} from './productImages'
import { db } from './schema'

/** テスト用の生バイト。保存は ArrayBuffer で行う（CachedProductImage 参照） */
function bytes(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer as ArrayBuffer
}

beforeEach(async () => {
  await db.productImages.clear()
})

describe('putProductImage / getProductImageBlob', () => {
  test('保存した画像を画像IDで取り出せる', async () => {
    await putProductImage('drive-1', bytes('画像データ'), 'image/jpeg')

    const stored = await getProductImageBlob('drive-1')
    expect(stored).toBeInstanceOf(Blob)
    expect(await stored!.text()).toBe('画像データ')
    expect(stored!.type).toBe('image/jpeg')
  })

  test('未取得の画像IDは undefined（＝写真なしとして扱う）', async () => {
    expect(await getProductImageBlob('未取得')).toBeUndefined()
  })

  test('取得日時を記録する', async () => {
    await putProductImage('drive-1', bytes('x'), 'image/jpeg', new Date('2026-08-01T10:00:00+09:00'))

    const record = await db.productImages.get('drive-1')
    expect(record?.fetchedAt).toBe(new Date('2026-08-01T10:00:00+09:00').toISOString())
  })
})

describe('getCachedImageIds', () => {
  test('キャッシュ済みの画像IDをすべて返す', async () => {
    await putProductImage('a', bytes('1'), 'image/jpeg')
    await putProductImage('b', bytes('2'), 'image/jpeg')

    expect((await getCachedImageIds()).sort()).toEqual(['a', 'b'])
  })

  test('空なら空配列', async () => {
    expect(await getCachedImageIds()).toEqual([])
  })
})

describe('deleteUnreferencedImages', () => {
  test('参照されていない画像だけを削除する', async () => {
    await putProductImage('使用中', bytes('1'), 'image/jpeg')
    await putProductImage('孤児1', bytes('2'), 'image/jpeg')
    await putProductImage('孤児2', bytes('3'), 'image/jpeg')

    const deleted = await deleteUnreferencedImages(new Set(['使用中']))

    expect(deleted).toBe(2)
    expect(await getCachedImageIds()).toEqual(['使用中'])
  })

  /*
   * 差し替え時は Drive のファイルIDが変わるため、古いIDは参照されなくなる。
   * この後片付けが無いと端末の容量が単調増加する（docs/design.md 9.4）
   */
  test('写真の差し替えで参照されなくなった古い画像も削除される', async () => {
    await putProductImage('旧ID', bytes('古い写真'), 'image/jpeg')
    await putProductImage('新ID', bytes('新しい写真'), 'image/jpeg')

    await deleteUnreferencedImages(new Set(['新ID']))

    expect(await getProductImageBlob('旧ID')).toBeUndefined()
    expect(await getProductImageBlob('新ID')).toBeDefined()
  })

  test('削除対象が無ければ0を返す', async () => {
    await putProductImage('a', bytes('1'), 'image/jpeg')
    expect(await deleteUnreferencedImages(new Set(['a']))).toBe(0)
  })
})

describe('clearProductImages', () => {
  test('すべて削除する', async () => {
    await putProductImage('a', bytes('1'), 'image/jpeg')
    await putProductImage('b', bytes('2'), 'image/jpeg')

    await clearProductImages()

    expect(await getCachedImageIds()).toEqual([])
  })
})
