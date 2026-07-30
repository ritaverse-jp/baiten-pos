import { ticketTotal } from '@/domain/calc'
import { formatYen } from '@/domain/format'
import type { TicketLine } from '@/domain/types'
import { useTicketStore } from '@/state/ticketStore'
import TicketLineRow from './TicketLineRow'
import styles from './CheckoutScreen.module.css'

interface TicketPanelProps {
  lines: TicketLine[]
  highlightedLineId: string | null
  /** 精算モーダルを開く（タスク14で実装。現時点ではボタンの活性制御のみ行う） */
  onGoToPayment: () => void
}

/** 伝票パネル（design 7.2 右カラム）。合計算出（FR-08）・伝票クリア（FR-12）を担当する */
export default function TicketPanel({ lines, highlightedLineId, onGoToPayment }: TicketPanelProps) {
  const clear = useTicketStore((s) => s.clear)

  const handleClear = async () => {
    if (lines.length === 0) return
    if (!window.confirm('伝票をクリアします。よろしいですか？')) return
    await clear()
  }

  const total = ticketTotal(lines)

  return (
    <section className={styles.ticketPanel} aria-label="伝票">
      <h2 className={styles.ticketPanelTitle}>伝票</h2>

      {lines.length === 0 ? (
        <p className={styles.emptyMessage}>商品が追加されていません</p>
      ) : (
        <ul className={styles.ticketLines}>
          {lines.map((line) => (
            <TicketLineRow key={line.lineId} line={line} highlighted={line.lineId === highlightedLineId} />
          ))}
        </ul>
      )}

      <div className={styles.ticketTotal}>
        <span>合計</span>
        <span className={styles.ticketTotalAmount} data-testid="ticket-total">
          {formatYen(total)}
        </span>
      </div>

      <div className={styles.ticketActions}>
        <button type="button" onClick={handleClear} disabled={lines.length === 0}>
          伝票クリア
        </button>
        <button type="button" className={styles.primaryButton} onClick={onGoToPayment} disabled={lines.length === 0}>
          精算へ
        </button>
      </div>
    </section>
  )
}
