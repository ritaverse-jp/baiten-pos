import { useState } from 'react'
import { PRODUCT_FORM_ERROR_MESSAGES, validateProductForm } from '@/domain/masters'
import { toYen, type ActiveFlag, type Category, type Product } from '@/domain/types'
import styles from './ProductsScreen.module.css'

interface ProductFormProps {
  /** 編集対象。新規追加時は null */
  product: Product | null
  categories: Category[]
  products: Product[]
  submitting: boolean
  /** サーバー側で弾かれた場合のエラーメッセージ（送信直後に呼び出し側が設定する） */
  submitError: string | null
  onCancel: () => void
  onSubmit: (product: Product, originalNo?: number) => void
}

/** SC-03 商品の新規追加・編集フォーム。要件定義 6.2 の登録項目に対応する */
export default function ProductForm({ product, categories, products, submitting, submitError, onCancel, onSubmit }: ProductFormProps) {
  const isEdit = product !== null
  const [no, setNo] = useState(product ? String(product.no) : '')
  const [name, setName] = useState(product?.name ?? '')
  const [price, setPrice] = useState(product ? String(product.price) : '')
  const [categoryName, setCategoryName] = useState(product?.categoryName ?? categories[0]?.name ?? '')
  const [displayOrder, setDisplayOrder] = useState(product?.displayOrder != null ? String(product.displayOrder) : '')
  const [status, setStatus] = useState<ActiveFlag>(product?.status ?? '有効')
  const [validationError, setValidationError] = useState<string | null>(null)

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
    }
    onSubmit(nextProduct, isEdit ? product.no : undefined)
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
