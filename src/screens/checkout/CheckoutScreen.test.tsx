import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { db } from '@/data/db/schema'
import { toYen, type Category, type Product } from '@/domain/types'
import { useMasterStore } from '@/state/masterStore'
import { useTicketStore } from '@/state/ticketStore'
import CheckoutScreen from './CheckoutScreen'

const FOOD: Category = { name: 'フード', displayOrder: 1, color: null }
const DRINK: Category = { name: 'ドリンク', displayOrder: 2, color: null }

const KARAAGE: Product = {
  no: 1,
  name: 'からあげ串',
  price: toYen(500),
  categoryName: 'フード',
  displayOrder: 1,
  status: '有効',
}
const RAMUNE: Product = {
  no: 4,
  name: 'ラムネ',
  price: toYen(200),
  categoryName: 'ドリンク',
  displayOrder: 1,
  status: '有効',
}
const DISCONTINUED: Product = {
  no: 9,
  name: '販売終了品',
  price: toYen(100),
  categoryName: 'フード',
  displayOrder: 2,
  status: '無効',
}

/**
 * マスタ・伝票の両方を「復元済み」の状態にしてから商品・カテゴリを投入する
 * （GAS通信や実際の復元フローを挟まないテスト用の近道。復元フロー自体は
 * 別の describe ブロックで個別に検証する）。
 */
function seedMasters(products: Product[], categories: Category[]) {
  useMasterStore.setState({ products, categories, hydrated: true })
  useTicketStore.setState({ hydrated: true })
}

beforeEach(async () => {
  await db.currentTicket.clear()
  await db.products.clear()
  await db.categories.clear()
  useTicketStore.setState({ lines: [], note: '', hydrated: false })
  useMasterStore.setState({ products: [], categories: [], hydrated: false })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('起動時の復元とちらつき対策（NF-04）', () => {
  test('ヘッダーは復元前から表示され、本文は復元完了まで「読み込み中」のままになる', () => {
    // hydrated: false のまま（beforeEach の初期状態）でマウント
    render(<CheckoutScreen />)

    expect(screen.getByRole('heading', { name: '売店レジ' })).toBeInTheDocument()
    expect(screen.getByText('読み込み中…')).toBeInTheDocument()
    // 復元前に「商品が追加されていません」という伝票の空状態文言が一瞬でも
    // 出てしまうと、後から商品が現れた際に空→有りの切り替わりが見えてしまう。
    // 読み込み中はそもそも伝票パネル自体を描画しないことで、この見え方を防ぐ
    expect(screen.queryByText('商品が追加されていません')).not.toBeInTheDocument()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })

  test('復元済みの伝票がある場合、空の伝票が一瞬表示されてから復元されるのではなく、最初から復元済みの内容で表示される', async () => {
    await useTicketStore.getState().addProductByNo(1, [KARAAGE])
    // 「リロード直後」を模す：ストアの状態だけを空に戻す（IndexedDBは残す）
    useTicketStore.setState({ lines: [], note: '', hydrated: false })
    seedMasters([KARAAGE], [FOOD])
    useMasterStore.setState({ hydrated: false }) // マスタも未復元から始める

    render(<CheckoutScreen />)

    // 復元完了前は「読み込み中」で、伝票の中身（からあげ串）はまだ見えない
    expect(screen.getByText('読み込み中…')).toBeInTheDocument()
    expect(screen.queryByText('からあげ串', { selector: 'span' })).not.toBeInTheDocument()

    await useTicketStore.getState().hydrate()
    useMasterStore.setState({ hydrated: true })

    await waitFor(() => {
      expect(screen.queryByText('読み込み中…')).not.toBeInTheDocument()
    })
    // 復元完了後は最初から1点入った状態で表示される（0件→1件のちらつきが無い）
    expect(useTicketStore.getState().lines).toHaveLength(1)
  })
})

describe('FR-03: No.入力による商品追加', () => {
  test('No.を入力して「追加」を押すと伝票に追加される', async () => {
    const user = userEvent.setup()
    seedMasters([KARAAGE], [FOOD])
    render(<CheckoutScreen />)

    await user.click(screen.getByRole('button', { name: '1' }))
    await user.click(screen.getByRole('button', { name: '追加' }))

    await waitFor(() => {
      expect(useTicketStore.getState().lines).toHaveLength(1)
    })
    expect(useTicketStore.getState().lines[0].productNo).toBe(1)
  })

  test('存在しないNo.を入力するとエラーメッセージが表示され、伝票は変更されない', async () => {
    const user = userEvent.setup()
    seedMasters([KARAAGE], [FOOD])
    render(<CheckoutScreen />)

    await user.click(screen.getByRole('button', { name: '9' }))
    await user.click(screen.getByRole('button', { name: '9' }))
    await user.click(screen.getByRole('button', { name: '追加' }))

    await waitFor(() => {
      expect(screen.getByText('入力された商品番号が見つかりません')).toBeInTheDocument()
    })
    expect(useTicketStore.getState().lines).toEqual([])
  })

  test('同一No.を続けて追加すると個数が増える（新規行は増えない。要件定義6.4）', async () => {
    const user = userEvent.setup()
    seedMasters([KARAAGE], [FOOD])
    render(<CheckoutScreen />)

    await user.click(screen.getByRole('button', { name: '1' }))
    await user.click(screen.getByRole('button', { name: '追加' }))
    await waitFor(() => expect(useTicketStore.getState().lines).toHaveLength(1))

    await user.click(screen.getByRole('button', { name: '1' }))
    await user.click(screen.getByRole('button', { name: '追加' }))

    await waitFor(() => {
      expect(useTicketStore.getState().lines).toHaveLength(1)
      expect(useTicketStore.getState().lines[0].qty).toBe(2)
    })
  })

  test('「取消」はテンキーの入力中の数字だけを消し、伝票には影響しない', async () => {
    const user = userEvent.setup()
    seedMasters([KARAAGE], [FOOD])
    render(<CheckoutScreen />)

    await user.click(screen.getByRole('button', { name: '1' }))
    expect(screen.getByText('No. 1')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '取消' }))

    expect(screen.getByText('No. −−')).toBeInTheDocument()
    expect(useTicketStore.getState().lines).toEqual([])
  })
})

describe('FR-04: 商品一覧タップによる追加', () => {
  test('商品ボタンをタップすると1タップで伝票に追加される', async () => {
    const user = userEvent.setup()
    seedMasters([KARAAGE], [FOOD])
    render(<CheckoutScreen />)

    await user.click(screen.getByRole('button', { name: 'からあげ串を追加' }))

    await waitFor(() => {
      expect(useTicketStore.getState().lines).toHaveLength(1)
    })
  })

  test('カテゴリを切り替えると該当カテゴリの商品のみ表示される（要件定義6.3）', async () => {
    const user = userEvent.setup()
    seedMasters([KARAAGE, RAMUNE], [FOOD, DRINK])
    render(<CheckoutScreen />)

    // 既定では表示順が最初のカテゴリ（フード）が選択される
    expect(screen.getByRole('button', { name: 'からあげ串を追加' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'ラムネを追加' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'ドリンク' }))

    expect(screen.getByRole('button', { name: 'ラムネを追加' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'からあげ串を追加' })).not.toBeInTheDocument()
  })

  test('販売状態が無効の商品は一覧に表示されない（要件定義6.2）', () => {
    seedMasters([KARAAGE, DISCONTINUED], [FOOD])
    render(<CheckoutScreen />)

    expect(screen.getByRole('button', { name: 'からあげ串を追加' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '販売終了品を追加' })).not.toBeInTheDocument()
  })
})

describe('FR-05: 個数変更', () => {
  async function addKaraage(user: ReturnType<typeof userEvent.setup>) {
    seedMasters([KARAAGE], [FOOD])
    render(<CheckoutScreen />)
    await user.click(screen.getByRole('button', { name: 'からあげ串を追加' }))
    await waitFor(() => expect(useTicketStore.getState().lines).toHaveLength(1))
  }

  test('＋で個数が増える', async () => {
    const user = userEvent.setup()
    await addKaraage(user)

    await user.click(screen.getByRole('button', { name: 'からあげ串の個数を増やす' }))

    await waitFor(() => expect(useTicketStore.getState().lines[0].qty).toBe(2))
  })

  test('個数2以上のときは確認なしで−で減る', async () => {
    const user = userEvent.setup()
    const confirmSpy = vi.spyOn(window, 'confirm')
    await addKaraage(user)
    await user.click(screen.getByRole('button', { name: 'からあげ串の個数を増やす' }))
    await waitFor(() => expect(useTicketStore.getState().lines[0].qty).toBe(2))

    await user.click(screen.getByRole('button', { name: 'からあげ串の個数を減らす' }))

    expect(confirmSpy).not.toHaveBeenCalled()
    await waitFor(() => expect(useTicketStore.getState().lines[0].qty).toBe(1))
  })

  test('個数1で−を押すと確認ダイアログを挟み、OKなら行が削除される（要件定義6.5・7.3）', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await addKaraage(user)

    await user.click(screen.getByRole('button', { name: 'からあげ串の個数を減らす' }))

    expect(window.confirm).toHaveBeenCalled()
    await waitFor(() => expect(useTicketStore.getState().lines).toEqual([]))
  })

  test('確認ダイアログでキャンセルすると行は消えない', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    await addKaraage(user)

    await user.click(screen.getByRole('button', { name: 'からあげ串の個数を減らす' }))

    expect(useTicketStore.getState().lines).toHaveLength(1)
  })
})

describe('FR-06: 商品行の削除', () => {
  test('削除ボタンは確認ダイアログを挟んでから行を削除する', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    seedMasters([KARAAGE], [FOOD])
    render(<CheckoutScreen />)
    await user.click(screen.getByRole('button', { name: 'からあげ串を追加' }))
    await waitFor(() => expect(useTicketStore.getState().lines).toHaveLength(1))

    await user.click(screen.getByRole('button', { name: 'からあげ串を削除' }))

    expect(window.confirm).toHaveBeenCalled()
    await waitFor(() => expect(useTicketStore.getState().lines).toEqual([]))
  })
})

describe('FR-07: 円割引', () => {
  test('割引額を入力すると行に反映され、小計が(単価-割引)×個数になる', async () => {
    const user = userEvent.setup()
    seedMasters([KARAAGE], [FOOD])
    render(<CheckoutScreen />)
    await user.click(screen.getByRole('button', { name: 'からあげ串を追加' }))
    await user.click(screen.getByRole('button', { name: 'からあげ串を追加' })) // qty: 2
    await waitFor(() => expect(useTicketStore.getState().lines[0].qty).toBe(2))

    const discountInput = screen.getByRole('spinbutton', { name: 'からあげ串の割引額' })
    await user.clear(discountInput)
    await user.type(discountInput, '50')
    await user.tab() // blur で確定

    await waitFor(() => expect(useTicketStore.getState().lines[0].discount).toBe(50))
    // 単価500・個数2・割引50 → (500-50)×2 = 900円（要件定義6.6の例）
    // 伝票がこの1行だけなので合計欄も900円になり紛らわしい。行の中だけを見る
    expect(within(screen.getByRole('listitem')).getByText('900円')).toBeInTheDocument()
  })

  test('単価を超える割引はエラーを表示し、反映されない', async () => {
    const user = userEvent.setup()
    seedMasters([KARAAGE], [FOOD])
    render(<CheckoutScreen />)
    await user.click(screen.getByRole('button', { name: 'からあげ串を追加' }))
    await waitFor(() => expect(useTicketStore.getState().lines).toHaveLength(1))

    const discountInput = screen.getByRole('spinbutton', { name: 'からあげ串の割引額' })
    await user.clear(discountInput)
    await user.type(discountInput, '600')
    await user.tab()

    await waitFor(() => {
      expect(screen.getByText('割引額は単価を超えられません')).toBeInTheDocument()
    })
    expect(useTicketStore.getState().lines[0].discount).toBe(0)
  })
})

describe('FR-08: 合計金額算出', () => {
  test('複数行の合計が正しく表示される', async () => {
    const user = userEvent.setup()
    seedMasters([KARAAGE, RAMUNE], [FOOD, DRINK])
    render(<CheckoutScreen />)

    await user.click(screen.getByRole('button', { name: 'からあげ串を追加' })) // 500円
    await user.click(screen.getByRole('tab', { name: 'ドリンク' }))
    await user.click(screen.getByRole('button', { name: 'ラムネを追加' })) // 200円

    await waitFor(() => {
      expect(useTicketStore.getState().lines).toHaveLength(2)
    })
    expect(screen.getByTestId('ticket-total')).toHaveTextContent('700円')
  })

  test('伝票が空のときの合計は0円', () => {
    seedMasters([KARAAGE], [FOOD])
    render(<CheckoutScreen />)
    expect(screen.getByTestId('ticket-total')).toHaveTextContent('0円')
  })
})

describe('伝票クリア（FR-12・7.3の確認ダイアログ）', () => {
  test('確認ダイアログを挟んでから伝票を空にする', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    seedMasters([KARAAGE], [FOOD])
    render(<CheckoutScreen />)
    await user.click(screen.getByRole('button', { name: 'からあげ串を追加' }))
    await waitFor(() => expect(useTicketStore.getState().lines).toHaveLength(1))

    await user.click(screen.getByRole('button', { name: '伝票クリア' }))

    expect(window.confirm).toHaveBeenCalled()
    await waitFor(() => expect(useTicketStore.getState().lines).toEqual([]))
  })

  test('伝票が空のときはクリアボタンが非活性', () => {
    seedMasters([KARAAGE], [FOOD])
    render(<CheckoutScreen />)
    expect(screen.getByRole('button', { name: '伝票クリア' })).toBeDisabled()
  })
})

describe('精算へボタン', () => {
  test('伝票が空のときは非活性', () => {
    seedMasters([KARAAGE], [FOOD])
    render(<CheckoutScreen />)
    expect(screen.getByRole('button', { name: '精算へ' })).toBeDisabled()
  })

  test('商品を追加すると活性になる', async () => {
    const user = userEvent.setup()
    seedMasters([KARAAGE], [FOOD])
    render(<CheckoutScreen />)

    await user.click(screen.getByRole('button', { name: 'からあげ串を追加' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '精算へ' })).toBeEnabled()
    })
  })

  test('タップすると精算モーダル（SC-02）が開く', async () => {
    const user = userEvent.setup()
    seedMasters([KARAAGE], [FOOD])
    render(<CheckoutScreen />)
    await user.click(screen.getByRole('button', { name: 'からあげ串を追加' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '精算へ' })).toBeEnabled())

    await user.click(screen.getByRole('button', { name: '精算へ' }))

    expect(screen.getByRole('dialog', { name: '精算' })).toBeInTheDocument()
    expect(screen.getByTestId('modal-total')).toHaveTextContent('500円')
  })

  test('精算モーダルを閉じると会計画面に戻る', async () => {
    const user = userEvent.setup()
    seedMasters([KARAAGE], [FOOD])
    render(<CheckoutScreen />)
    await user.click(screen.getByRole('button', { name: 'からあげ串を追加' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '精算へ' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: '精算へ' }))

    await user.click(screen.getByRole('button', { name: '精算を閉じる' }))

    expect(screen.queryByRole('dialog', { name: '精算' })).not.toBeInTheDocument()
  })
})

describe('商品追加時のフィードバック（要件定義7.3）', () => {
  test('対応していれば振動を発生させる', async () => {
    const user = userEvent.setup()
    Object.defineProperty(navigator, 'vibrate', { value: vi.fn(), configurable: true })
    seedMasters([KARAAGE], [FOOD])
    render(<CheckoutScreen />)

    await user.click(screen.getByRole('button', { name: 'からあげ串を追加' }))

    await waitFor(() => {
      expect(navigator.vibrate).toHaveBeenCalled()
    })
  })

  test('vibrate未対応環境でもエラーにならない', async () => {
    const user = userEvent.setup()
    Object.defineProperty(navigator, 'vibrate', { value: undefined, configurable: true })
    seedMasters([KARAAGE], [FOOD])
    render(<CheckoutScreen />)

    await expect(user.click(screen.getByRole('button', { name: 'からあげ串を追加' }))).resolves.not.toThrow()
  })
})
