import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { saveConfig } from '@/data/db/config'
import { getSale, putSale } from '@/data/db/sales'
import { db } from '@/data/db/schema'
import { buildSaleId } from '@/domain/saleNumber'
import { toTerminalCode, toYen, type SaleLine, type SaleRecord, type SalesHistoryEntry } from '@/domain/types'
import { useSyncStore } from '@/state/syncStore'
import HistoryScreen from './HistoryScreen'

const GAS_URL = 'https://script.google.com/macros/s/FAKE/exec'
const NOW = new Date()
const SALE_ID = buildSaleId(NOW, toTerminalCode('A'), 1)

const LINES: SaleLine[] = [
  { lineNo: 1, productName: 'からあげ串', netUnitPrice: toYen(500), qty: 2, subtotal: toYen(1000), discount: toYen(0) },
]

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 })
}

function historyResponse(sales: SalesHistoryEntry[]) {
  return jsonResponse({ ok: true, data: { sales } })
}

function localSale(overrides: Partial<SaleRecord> = {}): SaleRecord {
  return {
    saleId: SALE_ID,
    terminalCode: toTerminalCode('A'),
    confirmedAt: NOW.toISOString(),
    note: '',
    lines: LINES,
    total: toYen(1000),
    received: toYen(1000),
    change: toYen(0),
    synced: false,
    canceledAt: null,
    ...overrides,
  }
}

function remoteEntry(overrides: Partial<SalesHistoryEntry> = {}): SalesHistoryEntry {
  return {
    saleId: SALE_ID,
    terminalCode: toTerminalCode('A'),
    confirmedAt: NOW.toISOString(),
    note: '',
    lines: LINES,
    total: toYen(1000),
    canceled: false,
    canceledAt: null,
    ...overrides,
  }
}

beforeEach(async () => {
  await db.config.clear()
  await db.sales.clear()
  await saveConfig({ gasUrl: GAS_URL, apiToken: 'tok', terminalCode: toTerminalCode('A') })
  useSyncStore.setState({ connection: 'unknown', pendingCount: 0, syncing: false, lastSyncedAt: null, blockedBy: null })
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('起動時の読み込み', () => {
  test('オフライン時はローカルの会計のみ表示し、未送信バッジと取消不可を示す', async () => {
    await putSale(localSale({ synced: false }))
    vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'))

    render(<HistoryScreen onBack={() => {}} />)

    await waitFor(() => expect(screen.getByText('からあげ串×2')).toBeInTheDocument())
    expect(screen.getByTestId('connection-badge')).toHaveTextContent('オフライン')
    expect(screen.getByText('未送信')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: `会計番号${SALE_ID}を取消` })).toBeDisabled()
  })

  test('オンライン時はリモートの結果を優先し、取消済みなら取消ボタンを非活性にする', async () => {
    await putSale(localSale({ synced: false, canceledAt: null }))
    vi.mocked(fetch).mockResolvedValue(historyResponse([remoteEntry({ canceled: true, canceledAt: NOW.toISOString() })]))

    render(<HistoryScreen onBack={() => {}} />)

    await waitFor(() => expect(screen.getByTestId('connection-badge')).toHaveTextContent('オンライン'))
    expect(screen.getByText('取消済み')).toBeInTheDocument()
    expect(screen.queryByText('未送信')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: `会計番号${SALE_ID}を取消` })).toBeDisabled()
  })

  test('送信済み・未取消の会計はオンライン時に取消可能になる', async () => {
    await putSale(localSale({ synced: true }))
    vi.mocked(fetch).mockResolvedValue(historyResponse([remoteEntry()]))

    render(<HistoryScreen onBack={() => {}} />)

    await waitFor(() => expect(screen.getByTestId('connection-badge')).toHaveTextContent('オンライン'))
    expect(screen.getByRole('button', { name: `会計番号${SALE_ID}を取消` })).not.toBeDisabled()
  })

  test('本日の会計が無ければその旨を表示する', async () => {
    vi.mocked(fetch).mockResolvedValue(historyResponse([]))

    render(<HistoryScreen onBack={() => {}} />)

    await waitFor(() => expect(screen.getByText('本日の会計はまだありません')).toBeInTheDocument())
  })
})

describe('取消操作', () => {
  test('確認ダイアログでOKすると取消が成功し、ローカルのsalesにも反映される', async () => {
    const user = userEvent.setup()
    await putSale(localSale({ synced: true }))
    vi.mocked(fetch).mockResolvedValueOnce(historyResponse([remoteEntry()]))
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(<HistoryScreen onBack={() => {}} />)
    await waitFor(() => expect(screen.getByRole('button', { name: `会計番号${SALE_ID}を取消` })).not.toBeDisabled())

    const canceledAt = '2026-07-30T12:00:00+09:00'
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ ok: true, data: { saleId: SALE_ID, canceledAt } }))
    vi.mocked(fetch).mockResolvedValueOnce(historyResponse([remoteEntry({ canceled: true, canceledAt })]))

    await user.click(screen.getByRole('button', { name: `会計番号${SALE_ID}を取消` }))

    await waitFor(() => expect(screen.getByText('取消済み')).toBeInTheDocument())
    const localAfter = await getSale(SALE_ID)
    expect(localAfter?.canceledAt).toBe(canceledAt)
  })

  test('確認ダイアログでキャンセルすると通信しない', async () => {
    const user = userEvent.setup()
    await putSale(localSale({ synced: true }))
    vi.mocked(fetch).mockResolvedValueOnce(historyResponse([remoteEntry()]))
    vi.spyOn(window, 'confirm').mockReturnValue(false)

    render(<HistoryScreen onBack={() => {}} />)
    await waitFor(() => expect(screen.getByRole('button', { name: `会計番号${SALE_ID}を取消` })).not.toBeDisabled())

    const callsBefore = vi.mocked(fetch).mock.calls.length
    await user.click(screen.getByRole('button', { name: `会計番号${SALE_ID}を取消` }))

    expect(vi.mocked(fetch).mock.calls.length).toBe(callsBefore)
  })

  test('GASが既に取消済みと拒否した場合はエラーを表示する', async () => {
    const user = userEvent.setup()
    await putSale(localSale({ synced: true }))
    vi.mocked(fetch).mockResolvedValueOnce(historyResponse([remoteEntry()]))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})

    render(<HistoryScreen onBack={() => {}} />)
    await waitFor(() => expect(screen.getByRole('button', { name: `会計番号${SALE_ID}を取消` })).not.toBeDisabled())

    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'この会計は既に取消済みです' } }),
    )

    await user.click(screen.getByRole('button', { name: `会計番号${SALE_ID}を取消` }))

    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('この会計は既に取消済みです'))
  })
})
