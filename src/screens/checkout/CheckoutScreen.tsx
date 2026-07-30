import { useEffect, useState } from 'react'
import { ticketErrorMessage } from '@/domain/ticket'
import { useMasterStore } from '@/state/masterStore'
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
 * 精算モーダル（SC-02・FR-09/10）はタスク14で実装済み。会計確定の実処理
 * （採番・ローカル保存・キュー投入・伝票クリア。FR-11）はタスク15の担当で、
 * `PaymentModal` の `onConfirm` は今はまだ何もしないスタブになっている。
 */
export default function CheckoutScreen() {
  const ticketHydrated = useTicketStore((s) => s.hydrated)
  const lines = useTicketStore((s) => s.lines)
  const addProductByNo = useTicketStore((s) => s.addProductByNo)

  const masterHydrated = useMasterStore((s) => s.hydrated)
  const products = useMasterStore((s) => s.products)
  const categories = useMasterStore((s) => s.categories)

  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [numpadValue, setNumpadValue] = useState('')
  const [numpadError, setNumpadError] = useState<string | null>(null)
  const [highlightedLineId, setHighlightedLineId] = useState<string | null>(null)
  const [paymentModalOpen, setPaymentModalOpen] = useState(false)

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
    void handleAddProduct(Number(numpadValue)).then(() => setNumpadValue(''))
  }

  const visibleProducts = products.filter((p) => p.categoryName === selectedCategory)
  // NF-04：起動時の復元が終わるまで、空の伝票・空の商品一覧を一瞬見せない。
  // ヘッダーだけは常に表示し、読み込み中に画面が真っ白になるのを避ける。
  const hydrated = ticketHydrated && masterHydrated

  return (
    <main className={styles.screen}>
      <header className={styles.header}>
        <h1 className={styles.headerTitle}>売店レジ</h1>
        <nav className={styles.headerNav} aria-label="画面切り替え">
          {/* 履歴・商品管理・設定への遷移はタスク17〜19で実装する */}
          <button type="button" disabled>
            履歴
          </button>
          <button type="button" disabled>
            商品管理
          </button>
          <button type="button" disabled>
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
            <ProductGrid products={visibleProducts} onAdd={handleAddProduct} />
          </div>

          <div className={styles.numpadArea}>
            <Numpad value={numpadValue} onChange={setNumpadValue} onSubmit={handleNumpadSubmit} error={numpadError} />
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
          onConfirm={() => {
            // FR-11 の実処理（採番・保存・キュー投入・伝票クリア）はタスク15で実装する
            setPaymentModalOpen(false)
          }}
        />
      )}
    </main>
  )
}
