import { useState } from 'react'
import { CATEGORY_FORM_ERROR_MESSAGES, validateCategoryForm } from '@/domain/masters'
import type { Category } from '@/domain/types'
import styles from './CategoriesScreen.module.css'

interface CategoryFormProps {
  /** 編集対象。新規追加時は null */
  category: Category | null
  categories: Category[]
  submitting: boolean
  submitError: string | null
  onCancel: () => void
  onSubmit: (category: Category, originalName?: string) => void
}

/** SC-04 カテゴリの新規追加・編集フォーム。要件定義 6.3 の登録項目に対応する */
export default function CategoryForm({ category, categories, submitting, submitError, onCancel, onSubmit }: CategoryFormProps) {
  const isEdit = category !== null
  const [name, setName] = useState(category?.name ?? '')
  const [displayOrder, setDisplayOrder] = useState(category?.displayOrder != null ? String(category.displayOrder) : '')
  const [color, setColor] = useState(category?.color ?? '')
  const [validationError, setValidationError] = useState<string | null>(null)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    const parsedDisplayOrder = displayOrder.trim() === '' ? null : Number(displayOrder)

    const error = validateCategoryForm({ name }, categories, isEdit ? category.name : undefined)
    if (error) {
      setValidationError(CATEGORY_FORM_ERROR_MESSAGES[error])
      return
    }
    setValidationError(null)

    const nextCategory: Category = {
      name,
      displayOrder: parsedDisplayOrder,
      color: color.trim() === '' ? null : color,
    }
    onSubmit(nextCategory, isEdit ? category.name : undefined)
  }

  const errorMessage = validationError ?? submitError

  return (
    <div className={styles.modalOverlay} role="presentation" onClick={onCancel}>
      <form
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-label={isEdit ? 'カテゴリを編集' : 'カテゴリを追加'}
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>{isEdit ? 'カテゴリを編集' : 'カテゴリを追加'}</h2>
          <button type="button" onClick={onCancel} aria-label="フォームを閉じる">
            ✕
          </button>
        </div>

        <div className={styles.formField}>
          <label htmlFor="category-name">カテゴリ名</label>
          <input id="category-name" type="text" value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div className={styles.formField}>
          <label htmlFor="category-display-order">表示順（任意）</label>
          <input
            id="category-display-order"
            type="number"
            inputMode="numeric"
            value={displayOrder}
            onChange={(e) => setDisplayOrder(e.target.value)}
          />
        </div>

        <div className={styles.formField}>
          <label htmlFor="category-color">表示色（任意）</label>
          <input id="category-color" type="text" placeholder="#RRGGBB" value={color} onChange={(e) => setColor(e.target.value)} />
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
