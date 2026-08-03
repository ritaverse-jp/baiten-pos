import type { CategoryPalette } from '@/domain/categoryColor'
import { formatProductNo, formatYen } from '@/domain/format'
import type { Product } from '@/domain/types'
import { useProductImageUrl } from '@/state/productImageUrls'
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
        <ProductTile key={product.no} product={product} palette={palette} onAdd={onAdd} />
      ))}
    </div>
  )
}

/**
 * 商品ボタン1枚。写真があれば背景に敷く（タスク24）。
 *
 * **タイルの寸法・余白は写真の有無で変えない。** 写真あり・なしが混在しても
 * 一覧の行が揃うようにするため。写真は絶対配置で敷くだけなので、レイアウトの
 * 計算に影響しない。
 *
 * フックを使うためタイル単位のコンポーネントに切り出している（`map` の中で
 * フックは呼べない）。
 */
function ProductTile({
  product,
  palette,
  onAdd,
}: {
  product: Product
  palette: CategoryPalette
  onAdd: (no: number) => void
}) {
  const imageUrl = useProductImageUrl(product.imageId)

  return (
    <button
      type="button"
      className={styles.productButton}
      style={{ borderLeftColor: palette.tabBackground }}
      onClick={() => onAdd(product.no)}
      aria-label={`${product.name}を追加`}
    >
      {imageUrl && <img className={styles.productPhoto} src={imageUrl} alt="" />}
      <span className={styles.productNo} style={{ backgroundColor: palette.tabBackground, color: palette.tabText }}>
        {formatProductNo(product.no)}
      </span>
      {/*
        写真の上に文字を載せるときは、文字の背後に下地を敷く。写真の色は
        事前に分からないため、直接重ねると要件定義7.3のコントラスト比
        4.5:1 を保証できない。下地の不透明度は `PHOTO_SCRIM_ALPHA` で決めて
        あり、写真が純黒でも 4.5:1 を満たすことをテストで検証している。
        写真が無いタイルでは下地を敷かない（従来どおりの白カード）。
      */}
      <span
        className={imageUrl ? `${styles.productText} ${styles.productTextScrim}` : styles.productText}
        style={imageUrl ? { background: palette.photoScrim } : undefined}
      >
        <span className={styles.productName}>{product.name}</span>
        <span className={styles.productPrice}>{formatYen(product.price)}</span>
      </span>
    </button>
  )
}
