import { useEffect, useState } from 'react'
import { deleteCategory, saveCategory } from '@/data/gas/endpoints'
import { categoryHasProducts } from '@/domain/masters'
import type { Category } from '@/domain/types'
import { useMasterStore } from '@/state/masterStore'
import { useSyncStore } from '@/state/syncStore'
import CategoryForm from './CategoryForm'
import styles from './CategoriesScreen.module.css'

interface CategoriesScreenProps {
  onBack: () => void
}

/**
 * SC-04 カテゴリ管理画面。要件定義 FR-02。
 *
 * 商品マスタ管理（`screens/products/ProductsScreen.tsx`）と同じ考え方で、
 * この画面自身の直近の GAS リクエストの成否だけを「オンライン」の根拠とする
 * （design 4.3・不変条件18・19）。
 */
export default function CategoriesScreen({ onBack }: CategoriesScreenProps) {
  const products = useMasterStore((s) => s.products)
  const categories = useMasterStore((s) => s.categories)
  const connection = useSyncStore((s) => s.connection)
  const editable = connection === 'online'

  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editingCategory, setEditingCategory] = useState<Category | null>(null)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const openAddForm = () => {
    setEditingCategory(null)
    setSubmitError(null)
    setFormOpen(true)
  }

  const openEditForm = (category: Category) => {
    setEditingCategory(category)
    setSubmitError(null)
    setFormOpen(true)
  }

  const handleSubmit = async (category: Category, originalName?: string) => {
    setSubmitting(true)
    const result = await saveCategory(category, originalName)
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

  const handleDelete = async (category: Category) => {
    // 要件定義 6.3：商品が1件以上紐づくカテゴリは削除できない。往復通信の前に
    // ローカルのキャッシュで分かる範囲を伝える（GAS 側も同じ判定をロック内で行う）
    if (categoryHasProducts(products, category.name)) {
      window.alert('このカテゴリには商品が登録されているため削除できません。先に商品の移動または削除が必要です。')
      return
    }
    if (!window.confirm(`「${category.name}」を削除します。よろしいですか？`)) return
    const result = await deleteCategory(category.name)
    useSyncStore.getState().setConnection(result.ok ? 'online' : 'offline')
    if (!result.ok) {
      window.alert(result.error.message)
      return
    }
    await load()
  }

  const sortedCategories = [...categories].sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))

  return (
    <main className={styles.screen}>
      <header className={styles.header}>
        <div className={styles.headerTitleGroup}>
          <button type="button" className={styles.backButton} onClick={onBack} aria-label="商品マスタ管理に戻る">
            戻る
          </button>
          <h1 className={styles.headerTitle}>カテゴリ管理</h1>
        </div>
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
          + カテゴリを追加
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
        {sortedCategories.length === 0 && <li className={styles.emptyMessage}>カテゴリが登録されていません</li>}
        {sortedCategories.map((category) => (
          <li key={category.name} className={styles.row}>
            <div className={styles.rowMain}>
              {category.color && <span className={styles.colorSwatch} style={{ backgroundColor: category.color }} />}
              <span>{category.name}</span>
            </div>
            <div className={styles.rowActions}>
              <button
                type="button"
                aria-label={`${category.name}を編集`}
                onClick={() => openEditForm(category)}
                disabled={!editable}
              >
                編集
              </button>
              <button
                type="button"
                aria-label={`${category.name}を削除`}
                onClick={() => void handleDelete(category)}
                disabled={!editable}
              >
                削除
              </button>
            </div>
          </li>
        ))}
      </ul>

      {formOpen && (
        <CategoryForm
          category={editingCategory}
          categories={categories}
          submitting={submitting}
          submitError={submitError}
          onCancel={() => setFormOpen(false)}
          onSubmit={(category, originalName) => void handleSubmit(category, originalName)}
        />
      )}
    </main>
  )
}
