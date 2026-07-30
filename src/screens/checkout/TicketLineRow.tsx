import { useState } from 'react'
import { lineSubtotal } from '@/domain/calc'
import { formatYen } from '@/domain/format'
import { isLastUnit, ticketErrorMessage } from '@/domain/ticket'
import { LIMITS, type TicketLine } from '@/domain/types'
import { useTicketStore } from '@/state/ticketStore'
import styles from './CheckoutScreen.module.css'

interface TicketLineRowProps {
  line: TicketLine
  highlighted: boolean
}

/**
 * 伝票内の1商品行。要件定義 FR-05〜07（個数変更・削除・円割引）を担当する。
 *
 * 個数を0にする操作（−で最後の1点を減らす／削除ボタン）は確認ダイアログを
 * 挟む（要件定義 7.3・6.5）。`window.confirm` を使う（このタスクの時点で
 * 専用のダイアログコンポーネントは無いため。要件が求めるのは「確認を挟む」
 * ことであり、実装手段は問わない）。
 */
export default function TicketLineRow({ line, highlighted }: TicketLineRowProps) {
  const incrementLineQty = useTicketStore((s) => s.incrementLineQty)
  const decrementLineQty = useTicketStore((s) => s.decrementLineQty)
  const setLineDiscount = useTicketStore((s) => s.setLineDiscount)
  const splitLine = useTicketStore((s) => s.splitLine)
  const removeLine = useTicketStore((s) => s.removeLine)

  const [discountDraft, setDiscountDraft] = useState(String(line.discount))
  const [discountError, setDiscountError] = useState<string | null>(null)
  const [qtyError, setQtyError] = useState<string | null>(null)

  const confirmRemove = () => window.confirm(`「${line.productName}」を伝票から削除します。よろしいですか？`)

  const handleIncrement = async () => {
    const result = await incrementLineQty(line.lineId)
    setQtyError(result.ok ? null : ticketErrorMessage(result.error))
  }

  const handleDecrement = async () => {
    if (isLastUnit(line) && !confirmRemove()) return
    const result = await decrementLineQty(line.lineId)
    setQtyError(result.ok ? null : ticketErrorMessage(result.error))
  }

  const handleRemove = async () => {
    if (!confirmRemove()) return
    await removeLine(line.lineId)
  }

  const handleSplit = async () => {
    const result = await splitLine(line.lineId, 1)
    if (!result.ok) window.alert(ticketErrorMessage(result.error))
  }

  const commitDiscount = async () => {
    const value = Number(discountDraft)
    if (!Number.isFinite(value)) {
      setDiscountError('数値を入力してください')
      return
    }
    const result = await setLineDiscount(line.lineId, value)
    if (result.ok) {
      setDiscountError(null)
    } else {
      setDiscountError(ticketErrorMessage(result.error))
      setDiscountDraft(String(line.discount)) // 反映されなかったので表示を現在値に戻す
    }
  }

  return (
    <li className={`${styles.ticketLine} ${highlighted ? styles.ticketLineHighlighted : ''}`}>
      <div className={styles.ticketLineHeader}>
        <span className={styles.ticketLineName}>{line.productName}</span>
        <span className={styles.ticketLineSubtotal}>{formatYen(lineSubtotal(line))}</span>
      </div>

      <div className={styles.ticketLineDetail}>
        <span className={styles.ticketLinePrice}>
          {line.discount > 0 ? (
            <>
              {formatYen(line.unitPrice)} − {formatYen(line.discount)}
            </>
          ) : (
            formatYen(line.unitPrice)
          )}
          {' × '}
          {line.qty}
        </span>
        <div className={styles.stepper}>
          <button type="button" onClick={handleDecrement} aria-label={`${line.productName}の個数を減らす`}>
            −
          </button>
          <span className={styles.qty}>{line.qty}</span>
          <button
            type="button"
            onClick={handleIncrement}
            disabled={line.qty >= LIMITS.qtyMax}
            aria-label={`${line.productName}の個数を増やす`}
          >
            ＋
          </button>
        </div>
      </div>
      {qtyError && <p className={styles.errorText}>{qtyError}</p>}

      <div className={styles.ticketLineActions}>
        <label className={styles.discountField}>
          割引
          <input
            type="number"
            inputMode="numeric"
            min={0}
            max={line.unitPrice}
            value={discountDraft}
            onChange={(e) => setDiscountDraft(e.target.value)}
            onBlur={commitDiscount}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
            }}
            aria-label={`${line.productName}の割引額`}
          />
          円
        </label>
        <button type="button" onClick={handleSplit}>
          行を分ける
        </button>
        <button type="button" onClick={handleRemove} aria-label={`${line.productName}を削除`}>
          ✕ 削除
        </button>
      </div>
      {discountError && <p className={styles.errorText}>{discountError}</p>}
    </li>
  )
}
