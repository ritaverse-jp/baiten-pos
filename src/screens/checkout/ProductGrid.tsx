import { formatProductNo, formatYen } from '@/domain/format'
import type { Product } from '@/domain/types'
import styles from './CheckoutScreen.module.css'

interface ProductGridProps {
  /** 選択中カテゴリの商品のみを渡す想定（絞り込みは呼び出し側の責務） */
  products: Product[]
  onAdd: (no: number) => void
}

/**
 * 商品ボタン一覧（design 7.2 左下）。タップで即座に伝票へ追加する（FR-04）。
 * 販売状態が `無効` の商品は表示しない（要件定義 6.2）。
 */
export default function ProductGrid({ products, onAdd }: ProductGridProps) {
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
          onClick={() => onAdd(product.no)}
          aria-label={`${product.name}を追加`}
        >
          <span className={styles.productNo}>{formatProductNo(product.no)}</span>
          <span className={styles.productName}>{product.name}</span>
          <span className={styles.productPrice}>{formatYen(product.price)}</span>
        </button>
      ))}
    </div>
  )
}
