import { useState } from 'react'
import { resizeImageFile, type ResizedImage } from '@/data/image/resize'
import { PRODUCT_FORM_ERROR_MESSAGES, validateProductForm } from '@/domain/masters'
import { toYen, type ActiveFlag, type Category, type Product } from '@/domain/types'
import styles from './ProductsScreen.module.css'

/**
 * 写真の編集操作（タスク23）。フォームは「何をするか」だけを持ち、実際の
 * 送信は `ProductsScreen` が商品本体の保存と順序を揃えて行う。
 *
 * **新規追加では商品の保存が先に成功していないと写真を送れない**
 * （GAS の `saveProductImage` が `商品マスタ` に該当行があることを前提とするため）。
 * この順序制御を画面側に集めるため、フォームは操作内容を返すだけにしている。
 */
export type ProductImageAction =
  | { type: 'keep' }
  | { type: 'replace'; image: ResizedImage }
  | { type: 'remove' }

interface ProductFormProps {
  /** 編集対象。新規追加時は null */
  product: Product | null
  categories: Category[]
  products: Product[]
  submitting: boolean
  /** サーバー側で弾かれた場合のエラーメッセージ（送信直後に呼び出し側が設定する） */
  submitError: string | null
  /** 編集対象に登録済みの写真（ローカルキャッシュから取得したもの）。無ければ null */
  currentImageUrl: string | null
  onCancel: () => void
  onSubmit: (product: Product, imageAction: ProductImageAction, originalNo?: number) => void
}

/** SC-03 商品の新規追加・編集フォーム。要件定義 6.2 の登録項目に対応する */
export default function ProductForm({
  product,
  categories,
  products,
  submitting,
  submitError,
  currentImageUrl,
  onCancel,
  onSubmit,
}: ProductFormProps) {
  const isEdit = product !== null
  const [no, setNo] = useState(product ? String(product.no) : '')
  const [name, setName] = useState(product?.name ?? '')
  const [price, setPrice] = useState(product ? String(product.price) : '')
  const [categoryName, setCategoryName] = useState(product?.categoryName ?? categories[0]?.name ?? '')
  const [displayOrder, setDisplayOrder] = useState(product?.displayOrder != null ? String(product.displayOrder) : '')
  const [status, setStatus] = useState<ActiveFlag>(product?.status ?? '有効')
  const [validationError, setValidationError] = useState<string | null>(null)

  // 写真（タスク23）。`imageAction` が確定した操作、`previewUrl` は選択した
  // 写真の**縮小後**の data URL（登録済み写真の表示には currentImageUrl を使う）
  const [imageAction, setImageAction] = useState<ProductImageAction>({ type: 'keep' })
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [imageError, setImageError] = useState<string | null>(null)
  const [resizing, setResizing] = useState(false)

  const handleSelectImage = async (file: File | undefined) => {
    if (!file) return
    setImageError(null)
    setResizing(true)
    try {
      // 送信前に必ず縮小する（design 9.2）。原寸のままだと GAS 側の上限にも掛かる
      const image = await resizeImageFile(file)
      setImageAction({ type: 'replace', image })
      /*
       * **プレビューには元ファイルではなく縮小後の画像を出す。**
       * 元ファイルを表示すると、ブラウザが `<img>` 表示時に EXIF の回転を
       * 自動適用したり透過をそのまま描いたりするため、「画面では正しいのに
       * 保存された写真は回転している／透過部分が黒い」という食い違いを
       * 見逃す。実際に送るものをそのまま見せる。
       */
      setPreviewUrl(`data:${image.mimeType};base64,${image.base64}`)
    } catch (err) {
      /*
       * 失敗の原因を画面に出す。当初は「読み込めませんでした」とだけ表示して
       * いたが、ブラウザ依存の失敗（`createImageBitmap` のオプション非対応など）
       * が起きたときに原因が全く分からず、実機での切り分けに時間を要した。
       * 端末を触っている人がそのまま報告できる情報を出す。
       */
      const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
      setImageError(`画像を読み込めませんでした。別の画像を選んでください（${detail}）`)
    } finally {
      setResizing(false)
    }
  }

  const handleRemoveImage = () => {
    setImageError(null)
    setImageAction({ type: 'remove' })
    // プレビューは data URL のため、object URL のような明示的な解放は不要
    setPreviewUrl(null)
  }

  // 表示する写真：選択直後はプレビュー、未操作なら登録済み、削除操作後は無し
  const shownImageUrl = imageAction.type === 'remove' ? null : (previewUrl ?? currentImageUrl)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    const parsedNo = Number(no)
    const parsedPrice = Number(price)
    const parsedDisplayOrder = displayOrder.trim() === '' ? null : Number(displayOrder)

    const error = validateProductForm(
      { no: parsedNo, name, price: parsedPrice, categoryName },
      products,
      isEdit ? product.no : undefined,
    )
    if (error) {
      setValidationError(PRODUCT_FORM_ERROR_MESSAGES[error])
      return
    }
    setValidationError(null)

    const nextProduct: Product = {
      no: parsedNo,
      name,
      price: toYen(parsedPrice),
      categoryName,
      displayOrder: parsedDisplayOrder,
      status,
      // 写真は saveProduct では更新しない（GAS 側も A〜F列しか書かない）。
      // 既存の値をそのまま持ち回し、写真の変更は imageAction 側で伝える
      imageId: product?.imageId ?? null,
    }
    onSubmit(nextProduct, imageAction, isEdit ? product.no : undefined)
  }

  const errorMessage = validationError ?? submitError

  return (
    <div className={styles.modalOverlay} role="presentation" onClick={onCancel}>
      <form
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-label={isEdit ? '商品を編集' : '商品を追加'}
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>{isEdit ? '商品を編集' : '商品を追加'}</h2>
          <button type="button" onClick={onCancel} aria-label="フォームを閉じる">
            ✕
          </button>
        </div>

        <div className={styles.formField}>
          <label htmlFor="product-no">No.（1〜99）</label>
          <input id="product-no" type="number" inputMode="numeric" value={no} onChange={(e) => setNo(e.target.value)} />
        </div>

        <div className={styles.formField}>
          <label htmlFor="product-name">商品名</label>
          <input id="product-name" type="text" value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div className={styles.formField}>
          <label htmlFor="product-price">金額（円）</label>
          <input id="product-price" type="number" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} />
        </div>

        <div className={styles.formField}>
          <label htmlFor="product-category">カテゴリ</label>
          <select id="product-category" value={categoryName} onChange={(e) => setCategoryName(e.target.value)}>
            {categories.length === 0 && <option value="">（カテゴリが未登録です）</option>}
            {categories.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.formField}>
          <label htmlFor="product-display-order">表示順（任意）</label>
          <input
            id="product-display-order"
            type="number"
            inputMode="numeric"
            value={displayOrder}
            onChange={(e) => setDisplayOrder(e.target.value)}
          />
        </div>

        <div className={styles.formField}>
          <label htmlFor="product-status">販売状態</label>
          <select id="product-status" value={status} onChange={(e) => setStatus(e.target.value as ActiveFlag)}>
            <option value="有効">有効</option>
            <option value="無効">無効</option>
          </select>
        </div>

        {/*
          写真（要件定義 6.2・タスク23）。任意項目であり、未設定でも商品は
          登録・販売できる。新規追加時は商品の保存が成功してから写真を送るため、
          ここでは選択とプレビューだけを行う（送信は ProductsScreen の担当）
        */}
        <div className={styles.formField}>
          <span id="product-image-label">写真（任意）</span>
          <div className={styles.imageField}>
            {shownImageUrl ? (
              <img className={styles.imagePreview} src={shownImageUrl} alt="商品写真のプレビュー" />
            ) : (
              <div className={styles.imagePlaceholder} aria-hidden="true">
                なし
              </div>
            )}
            <div className={styles.imageActions}>
              <label className={styles.imageSelectButton}>
                {resizing ? '読み込み中…' : shownImageUrl ? '写真を変更' : '写真を選ぶ'}
                <input
                  type="file"
                  accept="image/*"
                  aria-labelledby="product-image-label"
                  disabled={resizing || submitting}
                  onChange={(e) => void handleSelectImage(e.target.files?.[0])}
                />
              </label>
              {shownImageUrl && (
                <button type="button" onClick={handleRemoveImage} disabled={resizing || submitting}>
                  写真を削除
                </button>
              )}
            </div>
          </div>
          {imageAction.type === 'replace' && (
            <p className={styles.imageMeta}>
              {imageAction.image.width}×{imageAction.image.height}px ・約
              {Math.max(1, Math.round(imageAction.image.approximateBytes / 1024))}KB に縮小しました
            </p>
          )}
          {imageError && (
            <p className={styles.errorText} role="alert">
              {imageError}
            </p>
          )}
        </div>

        {errorMessage && (
          <p className={styles.errorText} role="alert">
            {errorMessage}
          </p>
        )}

        <div className={styles.formActions}>
          <button type="button" onClick={onCancel}>
            キャンセル
          </button>
          <button type="submit" className={styles.primaryButton} disabled={submitting}>
            {submitting ? '保存中…' : '保存'}
          </button>
        </div>
      </form>
    </div>
  )
}
