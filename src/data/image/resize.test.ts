/**
 * `data/image/resize.ts` のうち、jsdom で検証できる範囲のテスト。
 *
 * canvas への描画（`toDataURL`）は jsdom に無いため、**縮小そのものの結果は
 * ここでは検証できない**（実ブラウザでの確認が必要）。ここで確かめるのは
 * ブラウザ差による失敗の扱い——`imageOrientation: 'from-image'` に未対応の
 * ブラウザでも写真を登録できること。
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { resizeImageFile } from './resize'

const file = new File([new Uint8Array([1, 2, 3])], 'p.jpg', { type: 'image/jpeg' })

function fakeBitmap() {
  return { width: 640, height: 480, close: vi.fn() } as unknown as ImageBitmap
}

/** canvas の 2d コンテキストを最低限モックする（jsdom には実装が無い） */
function stubCanvas() {
  vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    if (tag !== 'canvas') throw new Error(`想定外の要素: ${tag}`)
    return {
      width: 0,
      height: 0,
      getContext: () => ({ fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn() }),
      toDataURL: () => 'data:image/jpeg;base64,YWJj',
    } as unknown as HTMLElement
  })
}

beforeEach(() => {
  stubCanvas()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('ブラウザが imageOrientation: from-image に未対応の場合', () => {
  /*
   * 'from-image' は比較的新しい値で、未対応のブラウザは不正な列挙値として
   * TypeError を投げる。iOS Safari では通るのに PC ブラウザで写真を追加
   * できない、という不具合が実際に出た
   */
  test('オプション指定をやめて再試行し、写真を登録できる', async () => {
    const createImageBitmapMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("The provided value 'from-image' is not a valid enum value"))
      .mockResolvedValueOnce(fakeBitmap())
    vi.stubGlobal('createImageBitmap', createImageBitmapMock)

    const result = await resizeImageFile(file)

    expect(result.base64).toBe('YWJj')
    expect(createImageBitmapMock).toHaveBeenCalledTimes(2)
    // 2回目はオプションなしで呼ぶ
    expect(createImageBitmapMock.mock.calls[1]).toHaveLength(1)
  })

  test('再試行しても失敗する画像は例外を投げる（呼び出し側がメッセージを出す）', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new TypeError('壊れた画像')))

    await expect(resizeImageFile(file)).rejects.toThrow('壊れた画像')
  })

  test('TypeError 以外はそのまま投げる（無駄な再試行をしない）', async () => {
    const createImageBitmapMock = vi.fn().mockRejectedValue(new DOMException('復号できません', 'InvalidStateError'))
    vi.stubGlobal('createImageBitmap', createImageBitmapMock)

    await expect(resizeImageFile(file)).rejects.toThrow('復号できません')
    expect(createImageBitmapMock).toHaveBeenCalledTimes(1)
  })
})

describe('createImageBitmap 自体が無いブラウザ', () => {
  test('その旨のメッセージで失敗する', async () => {
    vi.stubGlobal('createImageBitmap', undefined)

    await expect(resizeImageFile(file)).rejects.toThrow(/createImageBitmap/)
  })
})

describe('長辺を上限に収める', () => {
  test('640×480 は 320×240 に縮小される', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(fakeBitmap()))

    const result = await resizeImageFile(file)

    expect(result.width).toBe(320)
    expect(result.height).toBe(240)
  })

  test('元が小さい画像は拡大しない', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValue({ width: 100, height: 50, close: vi.fn() } as unknown as ImageBitmap),
    )

    const result = await resizeImageFile(file)

    expect(result.width).toBe(100)
    expect(result.height).toBe(50)
  })
})
