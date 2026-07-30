import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { toYen, type TicketLine } from '@/domain/types'
import PaymentModal from './PaymentModal'

/**
 * 合計金額は PaymentModal 内で `ticketTotal(lines)` から計算する（props で
 * 別に渡さない。総額と行内容が食い違う余地を無くすための設計）。テストでも
 * `lines` だけを渡し、合計は単価×個数から自然に導かれる形にする。
 */
function lineForTotal(total: number): TicketLine {
  return {
    lineId: 'l1',
    productNo: 1,
    productName: 'からあげ串',
    unitPrice: toYen(total),
    qty: 1,
    discount: toYen(0),
  }
}

function renderModal(overrides: { total?: number; lines?: TicketLine[] } = {}) {
  const onClose = vi.fn()
  const onConfirm = vi.fn()
  const lines = overrides.lines ?? [lineForTotal(overrides.total ?? 1200)]
  render(<PaymentModal lines={lines} onClose={onClose} onConfirm={onConfirm} />)
  return { onClose, onConfirm }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('初期表示', () => {
  test('合計金額を表示する', () => {
    renderModal({ total: 1200 })
    expect(screen.getByTestId('modal-total')).toHaveTextContent('1,200円')
  })

  test('預かり金0円の初期状態では不足額（＝合計金額）を赤字表示し、会計確定は非活性（要件定義6.7）', () => {
    renderModal({ total: 1200 })
    expect(screen.getByText('不足')).toBeInTheDocument()
    expect(screen.getByTestId('change-amount')).toHaveTextContent('1,200円')
    expect(screen.getByRole('button', { name: '会計確定' })).toBeDisabled()
  })
})

describe('テンキーによる預かり金入力（FR-09）', () => {
  test('電卓式に桁を積み上げる（例：1→10→100→1000）', async () => {
    const user = userEvent.setup()
    renderModal({ total: 1200 })

    await user.click(screen.getByRole('button', { name: '1' }))
    await user.click(screen.getByRole('button', { name: '0' }))
    await user.click(screen.getByRole('button', { name: '0' }))
    await user.click(screen.getByRole('button', { name: '0' }))

    expect(screen.getByText('預かり金 1,000円')).toBeInTheDocument()
  })

  test('取消で預かり金が0に戻る', async () => {
    const user = userEvent.setup()
    renderModal({ total: 1200 })

    await user.click(screen.getByRole('button', { name: '5' }))
    expect(screen.getByText('預かり金 5円')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.getByText('預かり金 0円')).toBeInTheDocument()
  })
})

describe('クイックボタン（要件定義6.8）', () => {
  test('1,000円/5,000円/10,000円ボタンで預かり金を直接設定する', async () => {
    const user = userEvent.setup()
    renderModal({ total: 1200 })

    await user.click(screen.getByRole('button', { name: '5,000円' }))
    expect(screen.getByText('預かり金 5,000円')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '10,000円' }))
    expect(screen.getByText('預かり金 10,000円')).toBeInTheDocument()
  })

  test('「ちょうど」で預かり金が合計金額と同額になる', async () => {
    const user = userEvent.setup()
    renderModal({ total: 1200 })

    await user.click(screen.getByRole('button', { name: 'ちょうど' }))

    expect(screen.getByText('預かり金 1,200円')).toBeInTheDocument()
    expect(screen.getByText('釣銭')).toBeInTheDocument()
    expect(screen.getByTestId('change-amount')).toHaveTextContent('0円')
  })
})

describe('釣銭のリアルタイム表示（FR-10・要件定義6.7）', () => {
  test('預かり金が合計を超えると釣銭を通常表示し、会計確定が活性になる', async () => {
    const user = userEvent.setup()
    renderModal({ total: 1200 })

    // 2,000円のクイックボタンは無いのでテンキーで入力する
    await user.click(screen.getByRole('button', { name: '2' }))
    await user.click(screen.getByRole('button', { name: '0' }))
    await user.click(screen.getByRole('button', { name: '0' }))
    await user.click(screen.getByRole('button', { name: '0' }))

    expect(screen.getByText('釣銭')).toBeInTheDocument()
    expect(screen.getByTestId('change-amount')).toHaveTextContent('800円')
    expect(screen.getByRole('button', { name: '会計確定' })).toBeEnabled()
  })

  test('預かり金が合計未満の間は不足額を表示し続け、会計確定は非活性', async () => {
    const user = userEvent.setup()
    renderModal({ total: 1200 })

    await user.click(screen.getByRole('button', { name: '1,000円' }))

    expect(screen.getByText('不足')).toBeInTheDocument()
    expect(screen.getByTestId('change-amount')).toHaveTextContent('200円')
    expect(screen.getByRole('button', { name: '会計確定' })).toBeDisabled()
  })

  test('ちょうど不足なし（1円未満の端数なし）から1円減らすと不足表示に切り替わる', async () => {
    const user = userEvent.setup()
    renderModal({ total: 1200 })

    await user.click(screen.getByRole('button', { name: 'ちょうど' }))
    expect(screen.getByText('釣銭')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '取消' }))
    await user.click(screen.getByRole('button', { name: '1' }))
    await user.click(screen.getByRole('button', { name: '1' }))
    await user.click(screen.getByRole('button', { name: '9' }))
    await user.click(screen.getByRole('button', { name: '9' }))

    expect(screen.getByText('預かり金 1,199円')).toBeInTheDocument()
    expect(screen.getByText('不足')).toBeInTheDocument()
    expect(screen.getByTestId('change-amount')).toHaveTextContent('1円')
  })
})

describe('会計確定（要件定義7.3の確認ダイアログ）', () => {
  test('不足時はクリックしても呼ばれない（ボタン自体が非活性）', async () => {
    const user = userEvent.setup()
    const { onConfirm } = renderModal({ total: 1200 })

    await user.click(screen.getByRole('button', { name: '会計確定' }))

    expect(onConfirm).not.toHaveBeenCalled()
  })

  test('確認ダイアログでOKすると onConfirm が呼ばれる', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { onConfirm } = renderModal({ total: 1200 })

    await user.click(screen.getByRole('button', { name: 'ちょうど' }))
    await user.click(screen.getByRole('button', { name: '会計確定' }))

    expect(window.confirm).toHaveBeenCalled()
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  test('確認ダイアログでキャンセルすると onConfirm は呼ばれない', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { onConfirm } = renderModal({ total: 1200 })

    await user.click(screen.getByRole('button', { name: 'ちょうど' }))
    await user.click(screen.getByRole('button', { name: '会計確定' }))

    expect(onConfirm).not.toHaveBeenCalled()
  })

  test('伝票が空の場合は預かり金が十分でも会計確定できない（canConfirmの契約）', async () => {
    const user = userEvent.setup()
    const { onConfirm } = renderModal({ total: 0, lines: [] })

    // 合計0円なので「ちょうど」で預かり金0円 = 支払は足りているが、伝票が空
    await user.click(screen.getByRole('button', { name: 'ちょうど' }))

    expect(screen.getByRole('button', { name: '会計確定' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '会計確定' }))
    expect(onConfirm).not.toHaveBeenCalled()
  })
})

describe('モーダルを閉じる', () => {
  test('✕ボタンでonCloseが呼ばれる', async () => {
    const user = userEvent.setup()
    const { onClose } = renderModal()

    await user.click(screen.getByRole('button', { name: '精算を閉じる' }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  test('オーバーレイ（モーダル外）クリックでonCloseが呼ばれる', async () => {
    const user = userEvent.setup()
    const { onClose } = renderModal()

    await user.click(screen.getByRole('presentation'))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  test('モーダル内部のクリックではonCloseが呼ばれない（伝播を止める）', async () => {
    const user = userEvent.setup()
    const { onClose } = renderModal()

    await user.click(screen.getByRole('dialog'))

    expect(onClose).not.toHaveBeenCalled()
  })
})
