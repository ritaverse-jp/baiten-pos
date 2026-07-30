import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { saveConfig } from '@/data/db/config'
import { db } from '@/data/db/schema'
import { toTerminalCode, toYen, type Category, type Product } from '@/domain/types'
import { useMasterStore } from '@/state/masterStore'
import { useSyncStore } from '@/state/syncStore'
import ProductsScreen from './ProductsScreen'

const GAS_URL = 'https://script.google.com/macros/s/FAKE/exec'

const FOOD: Category = { name: 'フード', displayOrder: 1, color: null }
const KARAAGE: Product = { no: 1, name: 'からあげ串', price: toYen(500), categoryName: 'フード', displayOrder: 1, status: '有効' }

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 })
}

function mastersResponse(products: Product[], categories: Category[]) {
  return jsonResponse({
    ok: true,
    data: { products, categories, terminalStatus: '有効', fetchedAt: '2026-07-30T00:00:00+09:00' },
  })
}

beforeEach(async () => {
  await db.config.clear()
  await db.products.clear()
  await db.categories.clear()
  await saveConfig({ gasUrl: GAS_URL, apiToken: 'tok', terminalCode: toTerminalCode('A') })
  useMasterStore.setState({ products: [], categories: [], hydrated: false })
  useSyncStore.setState({ connection: 'unknown', pendingCount: 0, syncing: false, lastSyncedAt: null, blockedBy: null })
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('起動時の読み込み', () => {
  test('getMastersに成功すると一覧が表示され、オンライン表示になる', async () => {
    vi.mocked(fetch).mockResolvedValue(mastersResponse([KARAAGE], [FOOD]))

    render(<ProductsScreen onBack={() => {}} onNavigateToCategories={() => {}} />)

    await waitFor(() => expect(screen.getByText('からあげ串')).toBeInTheDocument())
    expect(screen.getByTestId('connection-badge')).toHaveTextContent('オンライン')
  })

  test('getMastersに失敗するとオフライン表示になり、編集系ボタンが非活性になる（要件定義9.1）', async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'))
    useMasterStore.setState({ products: [KARAAGE], categories: [FOOD], hydrated: true })

    render(<ProductsScreen onBack={() => {}} onNavigateToCategories={() => {}} />)

    await waitFor(() => expect(screen.getByTestId('connection-badge')).toHaveTextContent('オフライン'))
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+ 商品を追加' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'からあげ串を編集' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'からあげ串を削除' })).toBeDisabled()
  })
})

describe('画面を開いた後に接続状態が変わった場合', () => {
  test('バックグラウンドの同期エンジンがofflineを検知すると、この画面の編集ボタンも非活性になる', async () => {
    vi.mocked(fetch).mockResolvedValue(mastersResponse([KARAAGE], [FOOD]))

    render(<ProductsScreen onBack={() => {}} onNavigateToCategories={() => {}} />)
    await waitFor(() => expect(screen.getByTestId('connection-badge')).toHaveTextContent('オンライン'))
    expect(screen.getByRole('button', { name: '+ 商品を追加' })).not.toBeDisabled()

    // data/sync/engine.ts の runSync が別途 offline を検知した場合を模す
    useSyncStore.getState().setConnection('offline')

    await waitFor(() => expect(screen.getByTestId('connection-badge')).toHaveTextContent('オフライン'))
    expect(screen.getByTestId('offline-notice')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+ 商品を追加' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'からあげ串を編集' })).toBeDisabled()
  })
})

describe('商品の追加', () => {
  test('保存に成功するとフォームが閉じ、一覧に反映される', async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValueOnce(mastersResponse([], [FOOD]))

    render(<ProductsScreen onBack={() => {}} onNavigateToCategories={() => {}} />)
    await waitFor(() => expect(screen.getByTestId('connection-badge')).toHaveTextContent('オンライン'))

    await user.click(screen.getByRole('button', { name: '+ 商品を追加' }))
    const dialog = screen.getByRole('dialog', { name: '商品を追加' })

    await user.type(within(dialog).getByLabelText('No.（1〜99）'), '2')
    await user.type(within(dialog).getByLabelText('商品名'), 'たこ焼き')
    await user.type(within(dialog).getByLabelText('金額（円）'), '450')

    const newProduct: Product = { no: 2, name: 'たこ焼き', price: toYen(450), categoryName: 'フード', displayOrder: null, status: '有効' }
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ ok: true, data: { product: newProduct } }))
    vi.mocked(fetch).mockResolvedValueOnce(mastersResponse([newProduct], [FOOD]))

    await user.click(within(dialog).getByRole('button', { name: '保存' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByText('たこ焼き')).toBeInTheDocument()
  })

  test('No.が重複していると保存前にエラーを表示し、通信しない（要件定義6.2）', async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValueOnce(mastersResponse([KARAAGE], [FOOD]))

    render(<ProductsScreen onBack={() => {}} onNavigateToCategories={() => {}} />)
    await waitFor(() => expect(screen.getByText('からあげ串')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: '+ 商品を追加' }))
    const dialog = screen.getByRole('dialog', { name: '商品を追加' })
    await user.type(within(dialog).getByLabelText('No.（1〜99）'), '1')
    await user.type(within(dialog).getByLabelText('商品名'), '重複商品')
    await user.type(within(dialog).getByLabelText('金額（円）'), '100')

    const callsBefore = vi.mocked(fetch).mock.calls.length
    await user.click(within(dialog).getByRole('button', { name: '保存' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('この No. は既に使われています')
    expect(vi.mocked(fetch).mock.calls.length).toBe(callsBefore)
  })
})

describe('商品の削除', () => {
  test('確認ダイアログでOKすると削除し、一覧から消える', async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValueOnce(mastersResponse([KARAAGE], [FOOD]))
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(<ProductsScreen onBack={() => {}} onNavigateToCategories={() => {}} />)
    await waitFor(() => expect(screen.getByText('からあげ串')).toBeInTheDocument())

    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ ok: true, data: { no: 1 } }))
    vi.mocked(fetch).mockResolvedValueOnce(mastersResponse([], [FOOD]))

    await user.click(screen.getByRole('button', { name: 'からあげ串を削除' }))

    await waitFor(() => expect(screen.queryByText('からあげ串')).not.toBeInTheDocument())
  })

  test('確認ダイアログでキャンセルすると削除通信をしない', async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValueOnce(mastersResponse([KARAAGE], [FOOD]))
    vi.spyOn(window, 'confirm').mockReturnValue(false)

    render(<ProductsScreen onBack={() => {}} onNavigateToCategories={() => {}} />)
    await waitFor(() => expect(screen.getByText('からあげ串')).toBeInTheDocument())

    const callsBefore = vi.mocked(fetch).mock.calls.length
    await user.click(screen.getByRole('button', { name: 'からあげ串を削除' }))

    expect(vi.mocked(fetch).mock.calls.length).toBe(callsBefore)
    expect(screen.getByText('からあげ串')).toBeInTheDocument()
  })
})
