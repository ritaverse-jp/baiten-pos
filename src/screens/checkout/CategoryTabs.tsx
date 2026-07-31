import { resolveCategoryPalette } from '@/domain/categoryColor'
import type { Category } from '@/domain/types'
import styles from './CheckoutScreen.module.css'

interface CategoryTabsProps {
  categories: Category[]
  selected: string | null
  onSelect: (name: string) => void
}

/**
 * カテゴリタブ（design 7.2 左上）。選択すると該当カテゴリの商品のみが一覧表示される（要件定義 6.3）。
 *
 * 各タブは `domain/categoryColor.ts` で決めた自身のカテゴリ色を常に背景に表示する
 * （混雑時に目視で探しやすくするため）。選択中のタブは色だけで区別せず、
 * 太い下線でも示す（色の判別が難しいスタッフ・環境でも選択状態が分かるように）。
 */
export default function CategoryTabs({ categories, selected, onSelect }: CategoryTabsProps) {
  const sorted = [...categories].sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))

  return (
    <div className={styles.categoryTabs} role="tablist" aria-label="カテゴリ">
      {sorted.map((category) => {
        const palette = resolveCategoryPalette(sorted, category.name)
        const isSelected = category.name === selected
        return (
          <button
            key={category.name}
            type="button"
            role="tab"
            aria-selected={isSelected}
            className={`${styles.categoryTab} ${isSelected ? styles.categoryTabActive : ''}`}
            style={{ backgroundColor: palette.tabBackground, color: palette.tabText }}
            onClick={() => onSelect(category.name)}
          >
            {category.name}
          </button>
        )
      })}
      {sorted.length === 0 && <p className={styles.emptyMessage}>カテゴリが登録されていません</p>}
    </div>
  )
}
