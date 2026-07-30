import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { saveConfig } from '@/data/db/config'
import { db } from '@/data/db/schema'
import { toTerminalCode, toYen, type Category, type Product } from '@/domain/types'
import { useMasterStore } from '@/state/masterStore'
import { useSyncStore } from '@/state/syncStore'
import CategoriesScreen from './CategoriesScreen'

const GAS_URL = 'https://script.google.com/macros/s/FAKE/exec'

const FOOD: Category = { name: 'フード', displayOrder: 1, color: '#f97316' }
const DRINK: Category = { name: 'ドリンク', displayOrder: 2, color: null }
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
  test('getMastersに成功すると一覧が表示される', async () => {
    vi.mocked(fetch).mockResolvedValue(mastersResponse([], [FOOD, DRINK]))

    render(<CategoriesScreen onBack={() => {}} />)

    await waitFor(() => expect(screen.getByText('フード')).toBeInTheDocument())
    expect(screen.getByText('ドリンク')).toBeInTheDocument()
    expect(screen.getByTestId('connection-badge')).toHaveTextContent('オンライン')
  })

  test('getMastersに失敗すると編集系ボタンが非活性になる（要件定義9.1）', async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'))
    useMasterStore.setState({ products: [], categories: [FOOD], hydrated: true })

    render(<CategoriesScreen onBack={() => {}} />)

    await waitFor(() => expect(screen.getByTestId('connection-badge')).toHaveTextContent('オフライン'))
    expect(screen.getByRole('button', { name: '+ カテゴリを追加' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'フードを編集' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'フードを削除' })).toBeDisabled()
  })
})

describe('カテゴリの追加・編集', () => {
  test('新規追加に成功するとフォームが閉じ、一覧に反映される', async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValueOnce(mastersResponse([], []))

    render(<CategoriesScreen onBack={() => {}} />)
    await waitFor(() => expect(screen.getByTestId('connection-badge')).toHaveTextContent('オンライン'))

    await user.click(screen.getByRole('button', { name: '+ カテゴリを追加' }))
    const dialog = screen.getByRole('dialog', { name: 'カテゴリを追加' })
    await user.type(within(dialog).getByLabelText('カテゴリ名'), 'おもちゃ')

    const newCategory: Category = { name: 'おもちゃ', displayOrder: null, color: null }
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ ok: true, data: { category: newCategory } }))
    vi.mocked(fetch).mockResolvedValueOnce(mastersResponse([], [newCategory]))

    await user.click(within(dialog).getByRole('button', { name: '保存' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByText('おもちゃ')).toBeInTheDocument()
  })

  test('名前が重複していると保存前にエラーを表示し、通信しない（要件定義6.3）', async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValueOnce(mastersResponse([], [FOOD]))

    render(<CategoriesScreen onBack={() => {}} />)
    await waitFor(() => expect(screen.getByText('フード')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: '+ カテゴリを追加' }))
    const dialog = screen.getByRole('dialog', { name: 'カテゴリを追加' })
    await user.type(within(dialog).getByLabelText('カテゴリ名'), 'フード')

    const callsBefore = vi.mocked(fetch).mock.calls.length
    await user.click(within(dialog).getByRole('button', { name: '保存' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('既に使われています')
    expect(vi.mocked(fetch).mock.calls.length).toBe(callsBefore)
  })
})

describe('カテゴリの削除', () => {
  test('商品が紐づくカテゴリは削除前に警告し、通信しない（要件定義6.3）', async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValueOnce(mastersResponse([KARAAGE], [FOOD]))
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
    const confirmSpy = vi.spyOn(window, 'confirm')

    render(<CategoriesScreen onBack={() => {}} />)
    await waitFor(() => expect(screen.getByText('フード')).toBeInTheDocument())

    const callsBefore = vi.mocked(fetch).mock.calls.length
    await user.click(screen.getByRole('button', { name: 'フードを削除' }))

    expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining('削除できません'))
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(vi.mocked(fetch).mock.calls.length).toBe(callsBefore)
  })

  test('商品が紐づかないカテゴリは確認ダイアログの上で削除できる', async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValueOnce(mastersResponse([], [DRINK]))
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(<CategoriesScreen onBack={() => {}} />)
    await waitFor(() => expect(screen.getByText('ドリンク')).toBeInTheDocument())

    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ ok: true, data: { name: 'ドリンク' } }))
    vi.mocked(fetch).mockResolvedValueOnce(mastersResponse([], []))

    await user.click(screen.getByRole('button', { name: 'ドリンクを削除' }))

    await waitFor(() => expect(screen.queryByText('ドリンク')).not.toBeInTheDocument())
  })
})
