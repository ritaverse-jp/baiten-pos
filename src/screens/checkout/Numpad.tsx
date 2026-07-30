import { LIMITS } from '@/domain/types'
import styles from './CheckoutScreen.module.css'

interface NumpadProps {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  error: string | null
}

const MAX_DIGITS = String(LIMITS.productNoMax).length // No. は1〜99なので2桁まで

/** No. 入力用テンキー（design 7.2 左下・要件定義 FR-03） */
export default function Numpad({ value, onChange, onSubmit, error }: NumpadProps) {
  const pressDigit = (digit: string) => {
    if (value.length >= MAX_DIGITS) return
    onChange(value + digit)
  }
  const clear = () => onChange('')

  return (
    <div className={styles.numpad}>
      <div className={styles.numpadDisplay} aria-live="polite">
        No. {value || '−−'}
      </div>
      {error && <p className={styles.errorText}>{error}</p>}
      <div className={styles.numpadGrid}>
        {(['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const).map((digit) => (
          <button key={digit} type="button" style={{ gridArea: `n${digit}` }} onClick={() => pressDigit(digit)}>
            {digit}
          </button>
        ))}
        <button type="button" style={{ gridArea: 'clear' }} onClick={clear}>
          取消
        </button>
        <button type="button" className={styles.primaryButton} style={{ gridArea: 'submit' }} onClick={onSubmit}>
          追加
        </button>
        <button type="button" style={{ gridArea: 'n0' }} onClick={() => pressDigit('0')}>
          0
        </button>
      </div>
    </div>
  )
}
