import { useEffect, useState } from 'react'
import { getAllSales, getSale, markSaleCanceled } from '@/data/db/sales'
import { cancelSale, getSalesHistory } from '@/data/gas/endpoints'
import { formatTime, formatYen } from '@/domain/format'
import { canCancelSale, isSaleOnDate, mergeSalesHistory } from '@/domain/history'
import { toDateKey } from '@/domain/saleNumber'
import type { HistoryEntry } from '@/domain/types'
import { useSyncStore } from '@/state/syncStore'
import styles from './HistoryScreen.module.css'

interface HistoryScreenProps {
  onBack: () => void
}

/**
 * SC-05 会計履歴画面。要件定義 FR-14（当日の会計履歴閲覧）・FR-15（会計取消）。
 *
 * 当日の会計は常にローカル（IndexedDB `sales`）から取得する。これは未送信の
 * 会計も含む「この端末が確定したもの」の一覧で、オフラインでも表示できる
 * （design task18「当日履歴（ローカル）」）。オンライン時は `getSalesHistory`
 * で全端末分を追加取得し、`domain/history.ts` の `mergeSalesHistory` で1つの
 * 一覧にまとめる（同じ会計番号が両方にある場合はリモートを優先し、他端末での
 * 取消も見逃さない）。
 *
 * 取消（FR-15）は未送信の会計に対しては実行できない（design 2.7・不変条件12）。
 * 可否の判定は `domain/history.ts` の `canCancelSale` に一本化している。
 */
export default function HistoryScreen({ onBack }: HistoryScreenProps) {
  const connection = useSyncStore((s) => s.connection)
  const online = connection === 'online'

  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [loadErrorMessage, setLoadErrorMessage] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    const dateKey = toDateKey(new Date())
    const localSales = (await getAllSales()).filter((s) => isSaleOnDate(s.saleId, dateKey))

    const result = await getSalesHistory(dateKey)
    useSyncStore.getState().setConnection(result.ok ? 'online' : 'offline')
    setLoadErrorMessage(result.ok ? null : result.error.message)
    setEntries(mergeSalesHistory(localSales, result.ok ? result.data.sales : null))
    setLoading(false)
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleCancel = async (entry: HistoryEntry) => {
    if (!window.confirm(`会計番号 ${entry.saleId} を取り消します。よろしいですか？`)) return

    const result = await cancelSale(entry.saleId)
    useSyncStore.getState().setConnection(result.ok ? 'online' : 'offline')
    if (!result.ok) {
      window.alert(result.error.message)
      return
    }

    // 自端末の会計として `sales` に残っていれば取消日時を反映する
    // （他端末の会計はそもそもこの端末の IndexedDB には無い）
    const local = await getSale(entry.saleId)
    if (local) {
      await markSaleCanceled(entry.saleId, result.data.canceledAt)
    }
    await load()
  }

  return (
    <main className={styles.screen}>
      <header className={styles.header}>
        <div className={styles.headerTitleGroup}>
          <button type="button" className={styles.backButton} onClick={onBack} aria-label="会計画面に戻る">
            戻る
          </button>
          <h1 className={styles.headerTitle}>会計履歴</h1>
        </div>
        <span
          className={`${styles.connectionBadge} ${online ? styles.connectionOnline : styles.connectionOffline}`}
          data-testid="connection-badge"
        >
          {online ? 'オンライン' : 'オフライン'}
        </span>
      </header>

      <div className={styles.toolbar}>
        <button type="button" onClick={() => void load()} disabled={loading}>
          再読み込み
        </button>
      </div>

      {loadErrorMessage && (
        <p className={styles.loadNotice} role="alert">
          他端末分の履歴・取消は利用できません（{loadErrorMessage}）。この端末の履歴のみ表示しています
        </p>
      )}

      <ul className={styles.list}>
        {entries.length === 0 && <li className={styles.emptyMessage}>本日の会計はまだありません</li>}
        {entries.map((entry) => {
          const cancelable = online && canCancelSale(entry)
          return (
            <li key={entry.saleId} className={`${styles.row} ${entry.canceled ? styles.rowCanceled : ''}`}>
              <div className={styles.rowMain}>
                <div className={styles.rowTitle}>
                  <span className={styles.rowTime}>{formatTime(entry.confirmedAt)}</span>
                  <span className={styles.rowSaleId}>
                    {entry.saleId}（{entry.terminalCode}）
                  </span>
                  {!entry.synced && <span className={`${styles.statusBadge} ${styles.statusBadgePending}`}>未送信</span>}
                  {entry.canceled && <span className={`${styles.statusBadge} ${styles.statusBadgeCanceled}`}>取消済み</span>}
                </div>
                <div className={styles.rowLines}>
                  {entry.lines.map((line) => `${line.productName}×${line.qty}`).join('、')}
                </div>
                <div className={styles.rowTotal}>{formatYen(entry.total)}</div>
              </div>
              <div className={styles.rowActions}>
                <button
                  type="button"
                  aria-label={`会計番号${entry.saleId}を取消`}
                  onClick={() => void handleCancel(entry)}
                  disabled={!cancelable}
                  title={!entry.synced ? '未送信の会計は取り消せません' : entry.canceled ? '取消済みです' : undefined}
                >
                  取消
                </button>
              </div>
            </li>
          )
        })}
      </ul>
    </main>
  )
}
