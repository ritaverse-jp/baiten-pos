import type { CategoryPalette } from '@/domain/categoryColor'
import { formatProductNo, formatYen } from '@/domain/format'
import type { Product } from '@/domain/types'
import styles from './CheckoutScreen.module.css'

interface ProductGridProps {
  /** 選択中カテゴリの商品のみを渡す想定（絞り込みは呼び出し側の責務） */
  products: Product[]
  onAdd: (no: number) => void
  /** 選択中カテゴリの配色（`domain/categoryColor.ts`）。呼び出し側（CheckoutScreen）で解決済みのものを渡す */
  palette: CategoryPalette
}

/**
 * 商品ボタン一覧（design 7.2 左下）。タップで即座に伝票へ追加する（FR-04）。
 * 販売状態が `無効` の商品は表示しない（要件定義 6.2）。
 *
 * ボタンの背景・文字色は選択中カテゴリの配色に合わせる（混雑時に目視で
 * 探しやすくするため）。`domain/categoryColor.ts` がコントラスト比4.5:1以上
 * （要件定義7.3）を保証した色を返す前提で、そのまま使う。
 */
export default function ProductGrid({ products, onAdd, palette }: ProductGridProps) {
  const visible = products
    .filter((p) => p.status === '有効')
    .sort((a, b) => (a.displayOrder ?? a.no) - (b.displayOrder ?? b.no))

  if (visible.length === 0) {
    return <p className={styles.emptyMessage}>このカテゴリには商品がありません</p>
  }

  return (
    <div className={styles.productGrid}>
      {visible.map((product) => (
        <button
          key={product.no}
          type="button"
          className={styles.productButton}
          style={{ borderLeftColor: palette.tabBackground }}
          onClick={() => onAdd(product.no)}
          aria-label={`${product.name}を追加`}
        >
          <span
            className={styles.productNo}
            style={{ backgroundColor: palette.tabBackground, color: palette.tabText }}
          >
            {formatProductNo(product.no)}
          </span>
          <span className={styles.productName}>{product.name}</span>
          <span className={styles.productPrice}>{formatYen(product.price)}</span>
        </button>
      ))}
    </div>
  )
}
