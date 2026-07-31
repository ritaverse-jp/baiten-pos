import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { saveConfig } from '@/data/db/config'
import { enqueuePendingSale } from '@/data/db/pendingQueue'
import { db } from '@/data/db/schema'
import { __resetSyncEngineForTests } from '@/data/sync/engine'
import { toTerminalCode, toYen, type PendingSale, type SaleId } from '@/domain/types'
import { useSyncStore } from '@/state/syncStore'
import SettingsScreen from './SettingsScreen'

const GAS_URL = 'https://script.google.com/macros/s/FAKE/exec'

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 })
}

function pendingSale(saleId: string): PendingSale {
  const id = saleId as SaleId
  return {
    saleId: id,
    payload: {
      saleId: id,
      terminalCode: toTerminalCode('A'),
      confirmedAt: '2026-07-30T05:32:00.000Z',
      note: '',
      lines: [
        { lineNo: 1, productName: 'からあげ串', netUnitPrice: toYen(500), qty: 1, subtotal: toYen(500), discount: toYen(0) },
      ],
    },
    enqueuedAt: '2026-07-30T05:32:00.000Z',
    retryCount: 0,
    lastTriedAt: null,
    lastError: null,
  }
}

beforeEach(async () => {
  __resetSyncEngineForTests()
  await db.config.clear()
  await db.pendingQueue.clear()
  useSyncStore.setState({ connection: 'unknown', pendingCount: 0, syncing: false, lastSyncedAt: null, blockedBy: null })
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('GAS URL未設定（初回セットアップの最初のステップ）', () => {
  test('GAS URLの入力欄のみを表示し、端末登録欄は出さない', async () => {
    render(<SettingsScreen onBack={() => {}} />)

    await waitFor(() => expect(screen.getByLabelText('URL')).toBeInTheDocument())
    expect(screen.queryByLabelText('端末名')).not.toBeInTheDocument()
  })

  test('空欄で保存するとエラーを表示し、通信しない', async () => {
    const user = userEvent.setup()
    render(<SettingsScreen onBack={() => {}} />)
    await waitFor(() => expect(screen.getByLabelText('URL')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: '保存して接続確認' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('GAS Web アプリの URL を入力してください')
    expect(fetch).not.toHaveBeenCalled()
  })

  test('httpのURLはエラーになる（NF-06）', async () => {
    const user = userEvent.setup()
    render(<SettingsScreen onBack={() => {}} />)
    await waitFor(() => expect(screen.getByLabelText('URL')).toBeInTheDocument())

    await user.type(screen.getByLabelText('URL'), 'http://example.com/exec')
    await user.click(screen.getByRole('button', { name: '保存して接続確認' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('https://')
  })

  test('保存すると接続確認（ping）を行い、結果を表示する。成功後は端末登録欄に進む', async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ ok: true, data: { pong: true, now: '2026-07-30T00:00:00Z' } }))
    render(<SettingsScreen onBack={() => {}} />)
    await waitFor(() => expect(screen.getByLabelText('URL')).toBeInTheDocument())

    await user.type(screen.getByLabelText('URL'), GAS_URL)
    await user.click(screen.getByRole('button', { name: '保存して接続確認' }))

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('接続を確認しました'))
    expect(screen.getByLabelText('端末名')).toBeInTheDocument()
  })

  test('pingが失敗してもエラーメッセージを表示しつつ端末登録欄には進める', async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'))
    render(<SettingsScreen onBack={() => {}} />)
    await waitFor(() => expect(screen.getByLabelText('URL')).toBeInTheDocument())

    await user.type(screen.getByLabelText('URL'), GAS_URL)
    await user.click(screen.getByRole('button', { name: '保存して接続確認' }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('GAS へ通信できませんでした'))
    expect(screen.getByLabelText('端末名')).toBeInTheDocument()
  })
})

describe('端末登録（GAS URL設定済み・端末未登録）', () => {
  beforeEach(async () => {
    await saveConfig({ gasUrl: GAS_URL })
  })

  test('端末名・PINの入力欄を表示する', async () => {
    render(<SettingsScreen onBack={() => {}} />)
    await waitFor(() => expect(screen.getByLabelText('端末名')).toBeInTheDocument())
    expect(screen.getByLabelText('PIN')).toBeInTheDocument()
  })

  test('PINの形式が不正だと登録前にエラーを表示し、通信しない', async () => {
    const user = userEvent.setup()
    render(<SettingsScreen onBack={() => {}} />)
    await waitFor(() => expect(screen.getByLabelText('端末名')).toBeInTheDocument())

    await user.type(screen.getByLabelText('端末名'), 'レジ1')
    await user.type(screen.getByLabelText('PIN'), '12')
    await user.click(screen.getByRole('button', { name: 'この端末を登録' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('4〜8桁')
    expect(fetch).not.toHaveBeenCalled()
  })

  test('登録に成功すると端末情報が表示される', async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        ok: true,
        data: { terminalCode: 'A', terminalName: 'レジ1', apiToken: 'tok', expiresAt: '2026-10-28T00:00:00+09:00' },
      }),
    )
    render(<SettingsScreen onBack={() => {}} />)
    await waitFor(() => expect(screen.getByLabelText('端末名')).toBeInTheDocument())

    await user.type(screen.getByLabelText('端末名'), 'レジ1')
    await user.type(screen.getByLabelText('PIN'), '1234')
    await user.click(screen.getByRole('button', { name: 'この端末を登録' }))

    await waitFor(() => expect(screen.getByText('端末コード')).toBeInTheDocument())
    const codeRow = screen.getByText('端末コード').closest('div')
    expect(codeRow).toHaveTextContent('A')
  })

  test('PINを間違えるとエラーメッセージを表示する', async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ ok: false, error: { code: 'UNAUTHORIZED', message: 'PINが正しくありません' } }))
    render(<SettingsScreen onBack={() => {}} />)
    await waitFor(() => expect(screen.getByLabelText('端末名')).toBeInTheDocument())

    await user.type(screen.getByLabelText('端末名'), 'レジ1')
    await user.type(screen.getByLabelText('PIN'), '9999')
    await user.click(screen.getByRole('button', { name: 'この端末を登録' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('PINが正しくありません')
  })
})

describe('登録済み・通常運転（blockedByなし）', () => {
  beforeEach(async () => {
    await saveConfig({
      gasUrl: GAS_URL,
      terminalCode: toTerminalCode('A'),
      terminalName: 'レジ1',
      apiToken: 'tok',
      tokenExpiresAt: '2026-10-28T00:00:00+09:00',
    })
  })

  test('端末情報と未送信件数を表示する', async () => {
    await enqueuePendingSale(pendingSale('20260730-A001'))

    render(<SettingsScreen onBack={() => {}} />)

    await waitFor(() => expect(screen.getByText('未送信データ（1件）')).toBeInTheDocument())
    expect(screen.getByLabelText('端末名')).toHaveValue('レジ1')
    expect(screen.getByText('2026/10/28')).toBeInTheDocument()
  })

  test('端末名の変更に成功すると入力欄に反映される', async () => {
    const user = userEvent.setup()
    render(<SettingsScreen onBack={() => {}} />)
    await waitFor(() => expect(screen.getByLabelText('端末名')).toHaveValue('レジ1'))

    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ ok: true, data: { terminalCode: 'A', terminalName: 'レジ2' } }),
    )

    await user.clear(screen.getByLabelText('端末名'))
    await user.type(screen.getByLabelText('端末名'), 'レジ2')
    await user.click(screen.getByRole('button', { name: '端末名を変更' }))

    await waitFor(() => expect(screen.getByLabelText('端末名')).toHaveValue('レジ2'))
  })

  test('入力欄を変更していなければ「端末名を変更」は非活性', async () => {
    render(<SettingsScreen onBack={() => {}} />)
    await waitFor(() => expect(screen.getByLabelText('端末名')).toHaveValue('レジ1'))
    expect(screen.getByRole('button', { name: '端末名を変更' })).toBeDisabled()
  })

  test('「登録をやり直す」で確認後、端末登録情報を消去し登録ウィザードに戻る', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    useSyncStore.setState({ blockedBy: 'terminalDisabled' })
    render(<SettingsScreen onBack={() => {}} />)
    await waitFor(() => expect(screen.getByLabelText('端末名')).toHaveValue('レジ1'))

    await user.click(screen.getByRole('button', { name: '登録をやり直す（リセット）' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'この端末を登録' })).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: '端末名を変更' })).not.toBeInTheDocument() // 端末情報セクションは消える
    expect(useSyncStore.getState().blockedBy).toBeNull()
  })

  test('「登録をやり直す」で確認をキャンセルすると何も変わらない', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<SettingsScreen onBack={() => {}} />)
    await waitFor(() => expect(screen.getByLabelText('端末名')).toHaveValue('レジ1'))

    await user.click(screen.getByRole('button', { name: '登録をやり直す（リセット）' }))

    expect(screen.getByLabelText('端末名')).toHaveValue('レジ1')
  })

  test('未送信が無ければ「今すぐ同期」は非活性', async () => {
    render(<SettingsScreen onBack={() => {}} />)
    await waitFor(() => expect(screen.getByText('未送信データ（0件）')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: '今すぐ同期' })).toBeDisabled()
  })

  test('「今すぐ同期」を押すと同期が実行される', async () => {
    const user = userEvent.setup()
    await enqueuePendingSale(pendingSale('20260730-A001'))
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ ok: true, data: { results: [{ saleId: '20260730-A001', status: 'appended' }] } }),
    )

    render(<SettingsScreen onBack={() => {}} />)
    await waitFor(() => expect(screen.getByRole('button', { name: '今すぐ同期' })).not.toBeDisabled())

    await user.click(screen.getByRole('button', { name: '今すぐ同期' }))

    await waitFor(() => expect(fetch).toHaveBeenCalled())
  })

  test('画面表示後に会計が確定された場合、「再読み込み」を押すと未送信一覧に反映される', async () => {
    const user = userEvent.setup()
    render(<SettingsScreen onBack={() => {}} />)
    await waitFor(() => expect(screen.getByText('未送信データ（0件）')).toBeInTheDocument())

    // 画面を開いた後に、他の操作（会計確定）でキューに積まれた状況を模す
    await enqueuePendingSale(pendingSale('20260730-A001'))
    expect(screen.getByText('未送信データ（0件）')).toBeInTheDocument() // 自動では反映されない

    await user.click(screen.getByRole('button', { name: '再読み込み' }))

    await waitFor(() => expect(screen.getByText('未送信データ（1件）')).toBeInTheDocument())
  })
})

describe('blockedBy: tokenExpired（design 6.6）', () => {
  beforeEach(async () => {
    await saveConfig({
      gasUrl: GAS_URL,
      terminalCode: toTerminalCode('A'),
      terminalName: 'レジ1',
      apiToken: 'old-tok',
      tokenExpiresAt: '2026-07-25T00:00:00+09:00',
    })
    useSyncStore.setState({ blockedBy: 'tokenExpired' })
  })

  test('通常の未送信データ欄の代わりにPIN再ログイン欄を表示する', async () => {
    render(<SettingsScreen onBack={() => {}} />)
    await waitFor(() => expect(screen.getByText(/トークンの有効期限が切れています/)).toBeInTheDocument())
    expect(screen.queryByText(/未送信データ（/)).not.toBeInTheDocument()
  })

  test('再ログインに成功するとblockedByが解除される', async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        ok: true,
        data: { terminalCode: 'A', terminalName: 'レジ1', apiToken: 'new-tok', expiresAt: '2026-10-28T00:00:00+09:00' },
      }),
    )
    render(<SettingsScreen onBack={() => {}} />)
    await waitFor(() => expect(screen.getByLabelText('PIN')).toBeInTheDocument())

    await user.type(screen.getByLabelText('PIN'), '1234')
    await user.click(screen.getByRole('button', { name: '再ログイン' }))

    await waitFor(() => expect(useSyncStore.getState().blockedBy).toBeNull())
  })
})

describe('blockedBy: terminalDisabled（design 6.6）', () => {
  beforeEach(async () => {
    await saveConfig({
      gasUrl: GAS_URL,
      terminalCode: toTerminalCode('A'),
      terminalName: 'レジ1',
      apiToken: 'tok',
      tokenExpiresAt: '2026-10-28T00:00:00+09:00',
    })
    useSyncStore.setState({ blockedBy: 'terminalDisabled', pendingCount: 1 })
  })

  test('無効化の警告とCSVエクスポートボタンを表示する', async () => {
    await enqueuePendingSale(pendingSale('20260730-A001'))
    render(<SettingsScreen onBack={() => {}} />)

    await waitFor(() => expect(screen.getByText(/管理者により無効化されています/)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: '未送信データを CSV でダウンロード' })).not.toBeDisabled()
  })

  test('未送信データがCSVとしてダウンロードされる', async () => {
    const user = userEvent.setup()
    await enqueuePendingSale(pendingSale('20260730-A001'))
    const createObjectURL = vi.fn().mockReturnValue('blob:mock')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL })
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    render(<SettingsScreen onBack={() => {}} />)
    await waitFor(() => expect(screen.getByRole('button', { name: '未送信データを CSV でダウンロード' })).not.toBeDisabled())

    await user.click(screen.getByRole('button', { name: '未送信データを CSV でダウンロード' }))

    expect(createObjectURL).toHaveBeenCalled()
    expect(clickSpy).toHaveBeenCalled()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock')
  })
})
