import { useState } from 'react'
import { canConfirm, change, isSettleable, shortage, ticketTotal } from '@/domain/calc'
import { formatYen } from '@/domain/format'
import { toYen, type TicketLine } from '@/domain/types'
import styles from './CheckoutScreen.module.css'

/** クイックボタンの金額（要件定義 6.8） */
const QUICK_AMOUNTS = [1000, 5000, 10000] as const

interface PaymentModalProps {
  lines: TicketLine[]
  onClose: () => void
  /** 会計確定の実処理（採番・保存・キュー投入）はタスク15で実装する。ここでは確認後に呼ぶだけ */
  onConfirm: () => void
}

/**
 * SC-02 精算モーダル。要件定義 FR-09・FR-10・6.7・6.8 を実装する。
 *
 * 合計金額は `total` を props で受け取らず、常に `ticketTotal(lines)` から
 * その場で計算する。`canConfirm` も内部で `lines` から合計を再計算するため、
 * 呼び出し側が別々に計算した合計を渡すと値がずれる余地がある
 * （実装中に実際にこの不整合でテストが誤って通ってしまう事故があった）。
 * 合計の算出元を `lines` の1箇所に統一することでこの手のずれを構造的に防ぐ。
 *
 * 預かり金はテンキー（電卓式：桁を押すたびに `値×10+桁` で積み上げる）または
 * クイックボタンで入力する。釣銭は入力のたびにリアルタイムで再計算する（6.8）。
 */
export default function PaymentModal({ lines, onClose, onConfirm }: PaymentModalProps) {
  const [received, setReceived] = useState(0)
  const total = ticketTotal(lines)

  const pressDigit = (digit: number) => {
    // 電卓と同じ桁上げ方式。文字列連結と違い先頭の0が残る心配がない
    setReceived((prev) => prev * 10 + digit)
  }
  const clear = () => setReceived(0)
  const setExact = () => setReceived(total)

  const receivedYen = toYen(received)
  const settleable = isSettleable(total, receivedYen)
  const confirmable = canConfirm(lines, receivedYen)

  const handleConfirm = () => {
    if (!confirmable) return
    // 要件定義 7.3：「会計確定」は確認ダイアログを挟む
    if (!window.confirm('会計を確定します。よろしいですか？')) return
    onConfirm()
  }

  return (
    <div className={styles.modalOverlay} role="presentation" onClick={onClose}>
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-label="精算"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>精算</h2>
          <button type="button" onClick={onClose} aria-label="精算を閉じる">
            ✕
          </button>
        </div>

        <div className={styles.modalTotal}>
          <span>合計</span>
          <span className={styles.modalTotalAmount} data-testid="modal-total">
            {formatYen(total)}
          </span>
        </div>

        <div
          className={settleable ? styles.changeDisplay : styles.shortageDisplay}
          aria-live="polite"
        >
          <span className={styles.changeLabel}>{settleable ? '釣銭' : '不足'}</span>
          <span className={styles.changeAmount} data-testid="change-amount">
            {settleable ? formatYen(change(total, receivedYen)) : formatYen(shortage(total, receivedYen))}
          </span>
        </div>

        <div className={styles.receivedDisplay} aria-live="polite">
          預かり金 {formatYen(receivedYen)}
        </div>

        <div className={styles.quickAmounts}>
          {QUICK_AMOUNTS.map((amount) => (
            <button key={amount} type="button" onClick={() => setReceived(amount)}>
              {amount.toLocaleString('ja-JP')}円
            </button>
          ))}
          <button type="button" onClick={setExact}>
            ちょうど
          </button>
        </div>

        <div className={styles.paymentKeypad}>
          {([1, 2, 3, 4, 5, 6, 7, 8, 9] as const).map((digit) => (
            <button key={digit} type="button" onClick={() => pressDigit(digit)}>
              {digit}
            </button>
          ))}
          <button type="button" onClick={clear} className={styles.paymentKeypadClear}>
            取消
          </button>
          <button type="button" onClick={() => pressDigit(0)}>
            0
          </button>
        </div>

        <button
          type="button"
          className={styles.confirmButton}
          onClick={handleConfirm}
          disabled={!confirmable}
        >
          会計確定
        </button>
      </div>
    </div>
  )
}
