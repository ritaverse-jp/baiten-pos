import { useEffect, useState } from 'react'
import { confirmSale, CONFIRM_SALE_ERROR_MESSAGES } from '@/data/sync/checkout'
import { runSync } from '@/data/sync/engine'
import { resolveCategoryPalette } from '@/domain/categoryColor'
import { ticketErrorMessage } from '@/domain/ticket'
import type { Yen } from '@/domain/types'
import { useMasterStore } from '@/state/masterStore'
import { useSyncStore } from '@/state/syncStore'
import { useTicketStore } from '@/state/ticketStore'
import CategoryTabs from './CategoryTabs'
import Numpad from './Numpad'
import PaymentModal from './PaymentModal'
import ProductGrid from './ProductGrid'
import TicketPanel from './TicketPanel'
import styles from './CheckoutScreen.module.css'

/** 追加直後の視覚的ハイライトを表示する時間（要件定義 7.3） */
const HIGHLIGHT_DURATION_MS = 600

/**
 * SC-01 会計画面。要件定義 7.2 のレイアウト・FR-03〜08 の操作を実装する。
 *
 * 精算モーダル（SC-02・FR-09/10）はタスク14で実装済み。会計確定
 * （採番・ローカル保存・キュー投入・伝票クリア。FR-11）は `data/sync/checkout.ts`
 * の `confirmSale` に委譲する（design 4.1・不変条件9）。同期エンジンの起動
 * （確定後に非同期でキューを送信する。design 4.1 手順4）はタスク16の担当。
 */
interface CheckoutScreenProps {
  /** SC-03 商品マスタ管理への遷移（タスク17） */
  onNavigateToProducts: () => void
  /** SC-05 会計履歴への遷移（タスク18） */
  onNavigateToHistory: () => void
  /** SC-06 設定・初回セットアップへの遷移（タスク19） */
  onNavigateToSettings: () => void
}

export default function CheckoutScreen({ onNavigateToProducts, onNavigateToHistory, onNavigateToSettings }: CheckoutScreenProps) {
  const ticketHydrated = useTicketStore((s) => s.hydrated)
  const lines = useTicketStore((s) => s.lines)
  const note = useTicketStore((s) => s.note)
  const addProductByNo = useTicketStore((s) => s.addProductByNo)

  const masterHydrated = useMasterStore((s) => s.hydrated)
  const products = useMasterStore((s) => s.products)
  const categories = useMasterStore((s) => s.categories)

  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [numpadValue, setNumpadValue] = useState('')
  const [numpadError, setNumpadError] = useState<string | null>(null)
  const [highlightedLineId, setHighlightedLineId] = useState<string | null>(null)
  const [paymentModalOpen, setPaymentModalOpen] = useState(false)
  // 収納式テンキーの開閉状態。全モード共通で、初期状態は閉じる。
  // 商品タイルのタップだけで会計する運用が主で、No. 直接入力を使わない
  // 担当者にはテンキーが場所を取るだけになるため（ユーザー要望）
  const [numpadOpen, setNumpadOpen] = useState(false)

  // カテゴリが読み込まれたら、表示順が最初のものを既定選択にする
  useEffect(() => {
    if (selectedCategory || categories.length === 0) return
    const first = [...categories].sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))[0]
    setSelectedCategory(first.name)
  }, [categories, selectedCategory])

  /**
   * 商品追加の共通処理。No. 入力（テンキー）・商品ボタンタップの両方から呼ぶ。
   * 成功時は追加／個数が増えた行を検出し、視覚的ハイライトと振動を与える
   * （要件定義 7.3「商品追加時に軽微な振動と視覚的ハイライトを与える」）。
   */
  const handleAddProduct = async (no: number) => {
    const before = useTicketStore.getState().lines
    const result = await addProductByNo(no, products)

    if (!result.ok) {
      setNumpadError(ticketErrorMessage(result.error))
      return
    }

    setNumpadError(null)
    const changedLine = result.lines.find((line) => {
      const beforeLine = before.find((b) => b.lineId === line.lineId)
      return !beforeLine || beforeLine.qty !== line.qty
    })
    if (changedLine) {
      setHighlightedLineId(changedLine.lineId)
      setTimeout(() => setHighlightedLineId(null), HIGHLIGHT_DURATION_MS)
    }
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(15)
    }
  }

  const handleNumpadSubmit = () => {
    if (!numpadValue) return
    void handleAddProduct(Number(numpadValue)).then(() => {
      setNumpadValue('')
      // 追加できたらテンキーを閉じ、商品グリッドが見える状態に戻す
      setNumpadOpen(false)
    })
  }

  /**
   * 会計確定（FR-11）。ステップ3「UI は即座に次の会計へ」（design 4.1）を
   * 満たすため、確定後は即座にモーダルを閉じて伝票をクリアする。
   * 同期エンジン（タスク16）の起動はここに追加する。
   */
  const handleConfirmSale = async (received: Yen) => {
    const result = await confirmSale(lines, note, received, new Date())
    if (!result.ok) {
      window.alert(CONFIRM_SALE_ERROR_MESSAGES[result.error])
      return
    }

    setPaymentModalOpen(false)
    // confirmSale が同一トランザクションで currentTicket を既に削除している。
    // ここでは画面（Zustand の in-memory 状態）側を空に戻すだけでよい
    await useTicketStore.getState().clear()
    await useSyncStore.getState().refreshPendingCount()

    // design 4.1 の起動契機「会計確定時」。fire-and-forget（確定自体は
    // 既にローカルで完了しているため、送信の成否を待って画面を止めない）
    void runSync()
  }

  const visibleProducts = products.filter((p) => p.categoryName === selectedCategory)
  const categoryPalette = resolveCategoryPalette(categories, selectedCategory)
  // NF-04：起動時の復元が終わるまで、空の伝票・空の商品一覧を一瞬見せない。
  // ヘッダーだけは常に表示し、読み込み中に画面が真っ白になるのを避ける。
  const hydrated = ticketHydrated && masterHydrated

  return (
    <main className={styles.screen}>
      <header className={styles.header}>
        <h1 className={styles.headerTitle}>売店レジ</h1>
        <nav className={styles.headerNav} aria-label="画面切り替え">
          <button type="button" onClick={onNavigateToHistory}>
            履歴
          </button>
          <button type="button" onClick={onNavigateToProducts}>
            商品管理
          </button>
          <button type="button" onClick={onNavigateToSettings}>
            設定
          </button>
        </nav>
      </header>

      {!hydrated ? (
        <p className={styles.loading}>読み込み中…</p>
      ) : (
        <>
          <div className={styles.categoriesArea}>
            <CategoryTabs categories={categories} selected={selectedCategory} onSelect={setSelectedCategory} />
          </div>

          <div className={styles.productsArea}>
            <ProductGrid products={visibleProducts} onAdd={handleAddProduct} palette={categoryPalette} />
          </div>

          <div className={styles.numpadArea}>
            {/*
              テンキー本体は常に DOM に置き、開閉は data-open 属性で CSS に
              伝える（条件レンダリングにすると jsdom ではメディアクエリが
              効かず、テストから見える DOM と実機が食い違う）。
            */}
            <button
              type="button"
              className={styles.numpadToggle}
              aria-expanded={numpadOpen}
              aria-controls="numpad-panel"
              onClick={() => setNumpadOpen((open) => !open)}
            >
              {numpadOpen ? 'テンキーを閉じる' : `No. 入力${numpadValue ? `（${numpadValue}）` : ''}`}
            </button>
            <div id="numpad-panel" className={styles.numpadPanel} data-open={numpadOpen ? 'true' : 'false'}>
              <Numpad value={numpadValue} onChange={setNumpadValue} onSubmit={handleNumpadSubmit} error={numpadError} />
            </div>
          </div>

          <div className={styles.ticketArea}>
            <TicketPanel
              lines={lines}
              highlightedLineId={highlightedLineId}
              onGoToPayment={() => setPaymentModalOpen(true)}
            />
          </div>
        </>
      )}

      {paymentModalOpen && (
        <PaymentModal
          lines={lines}
          onClose={() => setPaymentModalOpen(false)}
          onConfirm={(received) => void handleConfirmSale(received)}
        />
      )}
    </main>
  )
}
