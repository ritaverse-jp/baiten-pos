import type { Category } from '@/domain/types'
import styles from './CheckoutScreen.module.css'

interface CategoryTabsProps {
  categories: Category[]
  selected: string | null
  onSelect: (name: string) => void
}

/** カテゴリタブ（design 7.2 左上）。選択すると該当カテゴリの商品のみが一覧表示される（要件定義 6.3） */
export default function CategoryTabs({ categories, selected, onSelect }: CategoryTabsProps) {
  const sorted = [...categories].sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))

  return (
    <div className={styles.categoryTabs} role="tablist" aria-label="カテゴリ">
      {sorted.map((category) => (
        <button
          key={category.name}
          type="button"
          role="tab"
          aria-selected={category.name === selected}
          className={`${styles.categoryTab} ${category.name === selected ? styles.categoryTabActive : ''}`}
          onClick={() => onSelect(category.name)}
        >
          {category.name}
        </button>
      ))}
      {sorted.length === 0 && <p className={styles.emptyMessage}>カテゴリが登録されていません</p>}
    </div>
  )
}
