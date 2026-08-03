import { useEffect, useState } from 'react'
import {
  deleteProductImageFromCache,
  getProductImageBlob,
  putProductImage,
  subscribeProductImages,
} from '@/data/db/productImages'
import { deleteProduct, deleteProductImage, saveProduct, saveProductImage } from '@/data/gas/endpoints'
import { base64ToBytes } from '@/data/sync/productImages'
import { formatProductNo, formatYen } from '@/domain/format'
import type { Product } from '@/domain/types'
import { useMasterStore } from '@/state/masterStore'
import { useSyncStore } from '@/state/syncStore'
import ProductForm, { type ProductImageAction } from './ProductForm'
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
  /** 編集中の商品に登録済みの写真（ローカルキャッシュ由来の object URL） */
  const [editingImageUrl, setEditingImageUrl] = useState<string | null>(null)

  /*
   * 編集フォームを開いたら、登録済みの写真をローカルキャッシュから読んで
   * プレビュー用の object URL を作る。**GAS には取りに行かない**——
   * `syncProductImages` が取得済みのはずで、未取得なら「写真なし」として
   * 表示すればよい（要件定義 9.1：写真の取得可否で操作を止めない）。
   *
   * **キャッシュの更新も購読する。** 写真の取得はバックグラウンドで走り
   * GAS への往復を挟むため、フォームを開いた時点ではまだ手元に無いことが
   * 普通にある。購読しないと「開いた瞬間に有ったものだけ」を表示して
   * 固まってしまい、保存直後の写真がいつまでも出ない。
   */
  useEffect(() => {
    let disposed = false
    let url: string | null = null

    const imageId = editingProduct?.imageId
    if (!formOpen || !imageId) {
      setEditingImageUrl(null)
      return
    }

    const read = async () => {
      const blob = await getProductImageBlob(imageId)
      if (disposed) return
      if (url) URL.revokeObjectURL(url)
      url = blob ? URL.createObjectURL(blob) : null
      setEditingImageUrl(url)
    }

    void read()
    const unsubscribe = subscribeProductImages(() => void read())

    return () => {
      disposed = true
      unsubscribe()
      if (url) URL.revokeObjectURL(url)
      setEditingImageUrl(null)
    }
  }, [formOpen, editingProduct])

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

  /**
   * 商品の保存と写真の反映。
   *
   * **商品本体 → 写真 の順で送る。** GAS の `saveProductImage` は
   * `商品マスタ` に該当行があることを前提とするため、新規追加では商品の保存が
   * 成功していないと写真を送れない（design 9.3）。
   *
   * 写真の送信に失敗しても**商品自体の保存は取り消さない**。写真は任意項目で
   * あり（要件定義 6.2）、商品が登録できていれば会計は行える。失敗はメッセージで
   * 伝え、写真だけ後からやり直せる状態にする。
   */
  const handleSubmit = async (product: Product, imageAction: ProductImageAction, originalNo?: number) => {
    setSubmitting(true)
    const result = await saveProduct(product, originalNo)
    useSyncStore.getState().setConnection(result.ok ? 'online' : 'offline')
    if (!result.ok) {
      setSubmitting(false)
      setSubmitError(result.error.message)
      return
    }

    const imageError = await applyImageAction(product.no, imageAction)
    setSubmitting(false)
    if (imageError) {
      // 商品は保存済み。一覧を最新化したうえでフォームは開いたままにし、
      // 写真だけ再試行できるようにする
      await load()
      setSubmitError(`商品は保存しましたが、写真の反映に失敗しました：${imageError}`)
      return
    }

    // 一覧を最新化してからフォームを閉じる（先に閉じると、まだ古い一覧が
    // 一瞬見えてから更新される「ちらつき」が起きる）
    await load()
    setFormOpen(false)
  }

  /**
   * 写真の操作を GAS に送る。成功なら null、失敗ならメッセージを返す。
   *
   * **成功したら、その場でローカルキャッシュにも反映する。** 送った画像の
   * バイト列は手元にあるので、`syncProductImages` の取得（GAS への往復が
   * 1枚あたり数秒かかる）を待つ理由がない。これを待つ作りだったために、
   * 保存直後にフォームを開き直しても写真が出ない状態になっていた。
   */
  const applyImageAction = async (no: number, action: ProductImageAction): Promise<string | null> => {
    if (action.type === 'keep') return null

    if (action.type === 'remove') {
      const removed = await deleteProductImage(no)
      useSyncStore.getState().setConnection(removed.ok ? 'online' : 'offline')
      if (!removed.ok) return removed.error.message
      const imageId = editingProduct?.imageId
      if (imageId) await deleteProductImageFromCache(imageId)
      return null
    }

    const saved = await saveProductImage(no, action.image.base64, action.image.mimeType)
    useSyncStore.getState().setConnection(saved.ok ? 'online' : 'offline')
    if (!saved.ok) return saved.error.message

    /*
     * ローカルへの反映は「あくまで往復を省くための先回り」。応答に imageId が
     * 無い等でここが失敗しても、写真自体は保存できている（＝画面としては成功）
     * ため、保存の成否には影響させない。次回のマスタ取得で
     * `syncProductImages` が正規の経路で取り直す
     */
    const imageId = saved.data?.imageId
    if (typeof imageId === 'string' && imageId.length > 0) {
      try {
        await putProductImage(imageId, base64ToBytes(action.image.base64), action.image.mimeType)
      } catch {
        // 先回りに失敗しただけ。次回のマスタ取得で取り直される
      }
    }
    return null
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
          currentImageUrl={editingImageUrl}
          onCancel={() => setFormOpen(false)}
          onSubmit={(product, imageAction, originalNo) => void handleSubmit(product, imageAction, originalNo)}
        />
      )}
    </main>
  )
}
