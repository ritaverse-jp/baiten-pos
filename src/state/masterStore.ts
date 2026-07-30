/**
 * 商品・カテゴリキャッシュのストア（Zustand）。docs/design.md 3.2・8.3。
 *
 * 正データはスプレッドシートであり、ここは IndexedDB キャッシュ
 * （`data/db/masters.ts`）の読み取り専用ミラーに近い。1件ずつの更新は
 * 提供せず、`replace()` による丸ごと置き換えのみを公開する
 * （`replaceProducts`/`replaceCategories` の契約をストアでも維持する。
 * CLAUDE.md「1件ずつの追加・更新は提供しない」）。
 *
 * `replace()` は `refreshFromServer()`（タスク17：商品・カテゴリ編集画面が
 * 自身の保存・削除の直後に呼ぶ）から使う。GAS から `getMasters` を取得し
 * 直すことで、他端末の変更や「後勝ち」の結果も含めて常に最新化する。
 */

import { create } from 'zustand'
import { getAllCategories, getAllProducts, replaceCategories, replaceProducts } from '@/data/db/masters'
import { getMasters } from '@/data/gas/endpoints'
import type { ApiResponse, Category, Product } from '@/domain/types'

interface MasterStoreState {
  products: Product[]
  categories: Category[]
  /** `hydrate()` が完了したか */
  hydrated: boolean
}

interface MasterStoreActions {
  /** 起動時に一度だけ呼ぶ。IndexedDB のキャッシュを読み込む */
  hydrate: () => Promise<void>
  /** GAS から取得したマスタで、IndexedDB とストアの両方を丸ごと置き換える */
  replace: (products: readonly Product[], categories: readonly Category[]) => Promise<void>
  /** `getMasters` を呼び、成功時は `replace()` する。失敗時はストアを変更せずエラーを返す */
  refreshFromServer: () => Promise<ApiResponse<void>>
}

export type MasterStore = MasterStoreState & MasterStoreActions

export const useMasterStore = create<MasterStore>((set, get) => ({
  products: [],
  categories: [],
  hydrated: false,

  hydrate: async () => {
    const [products, categories] = await Promise.all([getAllProducts(), getAllCategories()])
    set({ products, categories, hydrated: true })
  },

  replace: async (products, categories) => {
    await Promise.all([replaceProducts(products), replaceCategories(categories)])
    set({ products: [...products], categories: [...categories] })
  },

  refreshFromServer: async () => {
    const result = await getMasters()
    if (!result.ok) return result
    await get().replace(result.data.products, result.data.categories)
    return { ok: true, data: undefined }
  },
}))
