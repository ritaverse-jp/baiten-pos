import { useEffect, useState } from 'react'
import { deleteProduct, saveProduct } from '@/data/gas/endpoints'
import { formatProductNo, formatYen } from '@/domain/format'
import type { Product } from '@/domain/types'
import { useMasterStore } from '@/state/masterStore'
import { useSyncStore } from '@/state/syncStore'
import ProductForm from './ProductForm'
import styles from './ProductsScreen.module.css'

interface ProductsScreenProps {
  onBack: () => void
  onNavigateToCategories: () => void
}

/**
 * SC-03 商品マスタ管理画面。要件定義 FR-01。
 *
 * マスタ編集はオンライン時のみ許可する（要件定義 9.1・design 5.4・不変条件19）。
 * 「オンラインである」の根拠は `navigator.onLine` ではなく、この画面自身が
 * 行う直近の GAS リクエスト（`getMasters`／保存／削除）の成否とする
 * （design 4.3・不変条件18。`data/sync/engine.ts` の `runSync` と同じ考え方）。
 * 未送信の売上同期が別途バックグラウンドで走っていても、この画面は自分自身の
 * 通信結果でしか `connection` を判断しない。
 */
export default function ProductsScreen({ onBack, onNavigateToCategories }: ProductsScreenProps) {
  const products = useMasterStore((s) => s.products)
  const categories = useMasterStore((s) => s.categories)
  const connection = useSyncStore((s) => s.connection)
  const editable = connection === 'online'

  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editingProduct, setEditingProduct] = useState<Product | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    const result = await useMasterStore.getState().refreshFromServer()
    useSyncStore.getState().setConnection(result.ok ? 'online' : 'offline')
    setLoadError(result.ok ? null : result.error.message)
    setLoading(false)
  }

  useEffect(() => {
    void load()
    // 画面を開いたときに一度だけ最新化する。以降の更新は保存・削除の都度行う
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const openAddForm = () => {
    setEditingProduct(null)
    setSubmitError(null)
    setFormOpen(true)
  }

  const openEditForm = (product: Product) => {
    setEditingProduct(product)
    setSubmitError(null)
    setFormOpen(true)
  }

  const handleSubmit = async (product: Product, originalNo?: number) => {
    setSubmitting(true)
    const result = await saveProduct(product, originalNo)
    useSyncStore.getState().setConnection(result.ok ? 'online' : 'offline')
    setSubmitting(false)
    if (!result.ok) {
      setSubmitError(result.error.message)
      return
    }
    // 一覧を最新化してからフォームを閉じる（先に閉じると、まだ古い一覧が
    // 一瞬見えてから更新される「ちらつき」が起きる）
    await load()
    setFormOpen(false)
  }

  const handleDelete = async (product: Product) => {
    if (!window.confirm(`「${product.name}」を削除します。よろしいですか？`)) return
    const result = await deleteProduct(product.no)
    useSyncStore.getState().setConnection(result.ok ? 'online' : 'offline')
    if (!result.ok) {
      window.alert(result.error.message)
      return
    }
    await load()
  }

  const sortedProducts = [...products].sort((a, b) => (a.displayOrder ?? a.no) - (b.displayOrder ?? b.no))

  return (
    <main className={styles.screen}>
      <header className={styles.header}>
        <div className={styles.headerTitleGroup}>
          <button type="button" className={styles.backButton} onClick={onBack} aria-label="会計画面に戻る">
            戻る
          </button>
          <h1 className={styles.headerTitle}>商品マスタ管理</h1>
        </div>
        <nav className={styles.headerNav} aria-label="画面切り替え">
          <button type="button" onClick={onNavigateToCategories}>
            カテゴリ管理
          </button>
        </nav>
        <span
          className={`${styles.connectionBadge} ${editable ? styles.connectionOnline : styles.connectionOffline}`}
          data-testid="connection-badge"
        >
          {editable ? 'オンライン' : 'オフライン'}
        </span>
      </header>

      <div className={styles.toolbar}>
        <button type="button" onClick={() => void load()} disabled={loading}>
          再読み込み
        </button>
        <button type="button" className={styles.primaryButton} onClick={openAddForm} disabled={!editable}>
          + 商品を追加
        </button>
      </div>

      {loadError && (
        <p className={styles.loadError} role="alert">
          {loadError}
        </p>
      )}
      {!editable && !loadError && (
        <p className={styles.offlineNotice} data-testid="offline-notice">
          オフラインのため編集できません。オンラインに戻ってから「再読み込み」を押してください。
        </p>
      )}

      <ul className={styles.list}>
        {sortedProducts.length === 0 && <li className={styles.emptyMessage}>商品が登録されていません</li>}
        {sortedProducts.map((product) => (
          <li key={product.no} className={`${styles.row} ${product.status === '無効' ? styles.rowInactive : ''}`}>
            <div className={styles.rowMain}>
              <div className={styles.rowTitle}>
                <span className={styles.rowNo}>{formatProductNo(product.no)}</span>
                <span>{product.name}</span>
                <span className={`${styles.statusBadge} ${product.status === '無効' ? styles.statusBadgeInactive : ''}`}>
                  {product.status}
                </span>
              </div>
              <div className={styles.rowMeta}>
                <span className={styles.rowPrice}>{formatYen(product.price)}</span>
                <span>{product.categoryName}</span>
              </div>
            </div>
            <div className={styles.rowActions}>
              <button type="button" aria-label={`${product.name}を編集`} onClick={() => openEditForm(product)} disabled={!editable}>
                編集
              </button>
              <button
                type="button"
                aria-label={`${product.name}を削除`}
                onClick={() => void handleDelete(product)}
                disabled={!editable}
              >
                削除
              </button>
            </div>
          </li>
        ))}
      </ul>

      {formOpen && (
        <ProductForm
          product={editingProduct}
          categories={categories}
          products={products}
          submitting={submitting}
          submitError={submitError}
          onCancel={() => setFormOpen(false)}
          onSubmit={(product, originalNo) => void handleSubmit(product, originalNo)}
        />
      )}
    </main>
  )
}
