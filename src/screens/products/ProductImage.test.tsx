/**
 * SC-03 写真の登録UI（タスク23）のテスト。
 *
 * 縮小処理（`data/image/resize.ts`）は `createImageBitmap`・`canvas.toDataURL`
 * に依存し jsdom では動かないため、このテストではモックする。**縮小そのものの
 * 正しさ（長辺320px・JPEG化）はここでは検証できない**——実ブラウザでの確認が必要。
 * ここで確かめるのは、フォームの操作が正しい順序で正しいエンドポイントに
 * 繋がっているか。
 */

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { saveConfig } from '@/data/db/config'
import { getProductImageBlob, putProductImage } from '@/data/db/productImages'
import { db } from '@/data/db/schema'
import { toTerminalCode, toYen, type Category, type Product } from '@/domain/types'
import { useMasterStore } from '@/state/masterStore'
import { useSyncStore } from '@/state/syncStore'
import ProductsScreen from './ProductsScreen'

vi.mock('@/data/image/resize', () => ({
  resizeImageFile: vi.fn(async () => ({
    base64: 'YWJj',
    mimeType: 'image/jpeg',
    width: 320,
    height: 240,
    approximateBytes: 30 * 1024,
  })),
}))

const GAS_URL = 'https://script.google.com/macros/s/FAKE/exec'
const FOOD: Category = { name: 'フード', displayOrder: 1, color: null }
const KARAAGE: Product = { no: 1, name: 'からあげ串', price: toYen(500), categoryName: 'フード', displayOrder: 1, status: '有効' }
const WITH_IMAGE: Product = { ...KARAAGE, imageId: 'img-1' }

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 })
}

function mastersResponse(products: Product[]) {
  return jsonResponse({
    ok: true,
    data: { products, categories: [FOOD], terminalStatus: '有効', fetchedAt: '2026-08-03T00:00:00+09:00' },
  })
}

/** 送信された action の並び。順序の検証に使う */
function sentActions(): string[] {
  return vi
    .mocked(fetch)
    .mock.calls.map((call) => JSON.parse((call[1] as RequestInit).body as string).action as string)
}

function imageFile(): File {
  return new File([new Uint8Array([1, 2, 3])], 'photo.jpg', { type: 'image/jpeg' })
}

beforeEach(async () => {
  await db.config.clear()
  await db.products.clear()
  await db.categories.clear()
  await db.productImages.clear()
  await saveConfig({ gasUrl: GAS_URL, apiToken: 'tok', terminalCode: toTerminalCode('A') })
  useMasterStore.setState({ products: [], categories: [], hydrated: false })
  useSyncStore.setState({ connection: 'unknown', pendingCount: 0, syncing: false, lastSyncedAt: null, blockedBy: null })
  vi.stubGlobal('fetch', vi.fn())
  vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:mock'), revokeObjectURL: vi.fn() })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/**
 * 一覧を表示し、1件目の編集フォームを開く。
 *
 * `mockResolvedValue` で同じ `Response` インスタンスを使い回すと、body は
 * 一度しか読めないため2回目以降の呼び出しが通信エラーになる。呼び出しごとに
 * 新しい Response を作ること。
 */
async function openEditForm(user: ReturnType<typeof userEvent.setup>, product: Product) {
  vi.mocked(fetch).mockImplementation(async (_url, init) => {
    const body = JSON.parse((init as RequestInit).body as string)
    // saveProductImage は保存後にローカルキャッシュへ先回りで書くため、
    // 実際と同じ形（imageId を含む）で応答させる必要がある
    if (body.action === 'saveProductImage') {
      return jsonResponse({ ok: true, data: { productNo: body.productNo, imageId: 'img-新規' } })
    }
    if (body.action === 'deleteProductImage') {
      return jsonResponse({ ok: true, data: { productNo: body.productNo } })
    }
    return mastersResponse([product])
  })
  render(<ProductsScreen onBack={() => {}} onNavigateToCategories={() => {}} />)
  await waitFor(() => expect(screen.getByText('からあげ串')).toBeInTheDocument())
  await user.click(screen.getByRole('button', { name: /からあげ串.*編集|編集/ }))
  await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())
}

describe('写真を選ばない場合', () => {
  test('写真のエンドポイントは呼ばれない（写真は任意項目）', async () => {
    const user = userEvent.setup()
    await openEditForm(user, KARAAGE)

    await user.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(sentActions()).toContain('saveProduct'))
    expect(sentActions()).not.toContain('saveProductImage')
    expect(sentActions()).not.toContain('deleteProductImage')
  })

  test('写真が無ければ「なし」と表示し、削除ボタンは出さない', async () => {
    const user = userEvent.setup()
    await openEditForm(user, KARAAGE)

    expect(screen.getByText('なし')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '写真を削除' })).not.toBeInTheDocument()
  })
})

describe('写真を選んで保存する', () => {
  /*
   * GAS の saveProductImage は `商品マスタ` に該当行があることを前提とするため、
   * 新規追加では商品の保存が先に成功していないと写真を送れない（design 9.3）
   */
  test('商品本体を保存してから写真を送る（この順序でなければならない）', async () => {
    const user = userEvent.setup()
    await openEditForm(user, KARAAGE)

    await user.upload(screen.getByLabelText('写真（任意）'), imageFile())
    await waitFor(() => expect(screen.getByAltText('商品写真のプレビュー')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(sentActions()).toContain('saveProductImage'))
    const actions = sentActions()
    expect(actions.indexOf('saveProduct')).toBeLessThan(actions.indexOf('saveProductImage'))
  })

  test('縮小後のBase64とmimeTypeを送る（data:接頭辞は含めない）', async () => {
    const user = userEvent.setup()
    await openEditForm(user, KARAAGE)

    await user.upload(screen.getByLabelText('写真（任意）'), imageFile())
    await user.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(sentActions()).toContain('saveProductImage'))
    const call = vi
      .mocked(fetch)
      .mock.calls.map((c) => JSON.parse((c[1] as RequestInit).body as string))
      .find((b) => b.action === 'saveProductImage')
    expect(call).toMatchObject({ productNo: 1, imageBase64: 'YWJj', mimeType: 'image/jpeg' })
    expect(call.imageBase64).not.toContain('data:')
  })

  test('縮小後のサイズを表示する', async () => {
    const user = userEvent.setup()
    await openEditForm(user, KARAAGE)

    await user.upload(screen.getByLabelText('写真（任意）'), imageFile())

    await waitFor(() => expect(screen.getByText(/320×240px ・約30KB に縮小しました/)).toBeInTheDocument())
  })
})

describe('登録済みの写真', () => {
  test('ローカルキャッシュから読み出してプレビューする（GASには取りに行かない）', async () => {
    const user = userEvent.setup()
    await putProductImage('img-1', new TextEncoder().encode('画像').buffer as ArrayBuffer, 'image/jpeg')

    await openEditForm(user, WITH_IMAGE)

    await waitFor(() => expect(screen.getByAltText('商品写真のプレビュー')).toBeInTheDocument())
    expect(sentActions()).not.toContain('getProductImage')
  })

  test('「写真を削除」で deleteProductImage を送る', async () => {
    const user = userEvent.setup()
    await putProductImage('img-1', new TextEncoder().encode('画像').buffer as ArrayBuffer, 'image/jpeg')
    await openEditForm(user, WITH_IMAGE)
    await waitFor(() => expect(screen.getByRole('button', { name: '写真を削除' })).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: '写真を削除' }))
    await user.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(sentActions()).toContain('deleteProductImage'))
  })

  /*
   * 未取得（オフラインで一度も取れていない等）の写真は表示できないが、
   * 商品の編集自体は妨げない（要件定義 9.1）
   */
  test('キャッシュに無い写真は「なし」として表示し、編集は妨げない', async () => {
    const user = userEvent.setup()
    await openEditForm(user, WITH_IMAGE) // productImages は空のまま

    expect(screen.getByText('なし')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '保存' })).not.toBeDisabled()
  })
})

/*
 * 実機で「保存は成功しているのにプレビューに写真が出ない」という不具合が出た。
 * 原因は取得の失敗ではなく、**画面がキャッシュ更新の契機を持っていなかった**こと。
 * 写真の取得はバックグラウンドで GAS への往復を挟むため、フォームを開いた
 * 時点ではまだ手元に無いのが普通で、その後に届いても画面が知る術がなかった。
 */
describe('キャッシュがあとから埋まった場合（実機で出た不具合の回帰テスト）', () => {
  test('フォームを開いた後にキャッシュへ届いた写真がプレビューに出る', async () => {
    const user = userEvent.setup()
    await openEditForm(user, WITH_IMAGE) // キャッシュは空の状態で開く

    expect(screen.getByText('なし')).toBeInTheDocument()

    // バックグラウンドの取得が完了した状況を再現する
    await putProductImage('img-1', new TextEncoder().encode('あとから').buffer as ArrayBuffer, 'image/jpeg')

    await waitFor(() => expect(screen.getByAltText('商品写真のプレビュー')).toBeInTheDocument())
  })
})

describe('保存直後のプレビュー（GASからの再取得を待たない）', () => {
  /*
   * 送った画像のバイト列は手元にあるので、`syncProductImages` の取得
   * （1枚あたり GAS への往復で数秒）を待つ理由がない。待つ作りだったために
   * 保存直後にフォームを開き直しても写真が出なかった
   */
  test('保存に成功したら、その場でローカルキャッシュにも書く', async () => {
    const user = userEvent.setup()
    await openEditForm(user, KARAAGE)

    await user.upload(screen.getByLabelText('写真（任意）'), imageFile())
    await user.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(sentActions()).toContain('saveProductImage'))
    // GAS が返した imageId で、送ったバイト列がそのままキャッシュされている
    await waitFor(async () => expect(await getProductImageBlob('img-新規')).toBeDefined())
  })

  test('写真を削除したらローカルキャッシュからも消える', async () => {
    const user = userEvent.setup()
    await putProductImage('img-1', new TextEncoder().encode('画像').buffer as ArrayBuffer, 'image/jpeg')
    await openEditForm(user, WITH_IMAGE)
    await waitFor(() => expect(screen.getByRole('button', { name: '写真を削除' })).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: '写真を削除' }))
    await user.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(sentActions()).toContain('deleteProductImage'))
    await waitFor(async () => expect(await getProductImageBlob('img-1')).toBeUndefined())
  })
})

describe('写真の送信に失敗した場合', () => {
  /*
   * 写真は任意項目であり、商品が登録できていれば会計は行える。写真の失敗で
   * 商品の保存自体を取り消すと、利用者は「保存できていない」と誤解する
   */
  test('商品の保存は取り消さず、写真だけ失敗した旨を伝えてフォームを開いたままにする', async () => {
    const user = userEvent.setup()
    await openEditForm(user, KARAAGE)
    await user.upload(screen.getByLabelText('写真（任意）'), imageFile())

    vi.mocked(fetch).mockImplementation(async (_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string)
      if (body.action === 'saveProductImage') {
        return jsonResponse({ ok: false, error: { code: 'VALIDATION_ERROR', message: '画像が大きすぎます' } })
      }
      return mastersResponse([KARAAGE])
    })

    await user.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(screen.getByText(/商品は保存しましたが、写真の反映に失敗しました/)).toBeInTheDocument())
    expect(screen.getByRole('dialog')).toBeInTheDocument() // 開いたまま＝写真だけ再試行できる
  })
})
