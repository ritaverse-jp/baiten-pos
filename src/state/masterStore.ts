/**
 * 商品・カテゴリキャッシュのストア（Zustand）。docs/design.md 3.2・8.3。
 *
 * 正データはスプレッドシートであり、ここは IndexedDB キャッシュ
 * （`data/db/masters.ts`）の読み取り専用ミラーに近い。1件ずつの更新は
 * 提供せず、`replace()` による丸ごと置き換えのみを公開する
 * （`replaceProducts`/`replaceCategories` の契約をストアでも維持する。
 * CLAUDE.md「1件ずつの追加・更新は提供しない」）。
 *
 * `replace()` の呼び出し元は GAS から `getMasters` を取得した後の処理
 * （タスク16の同期エンジン・タスク19の設定画面）で、まだ配線されていない。
 */

import { create } from 'zustand'
import { getAllCategories, getAllProducts, replaceCategories, replaceProducts } from '@/data/db/masters'
import type { Category, Product } from '@/domain/types'

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
}

export type MasterStore = MasterStoreState & MasterStoreActions

export const useMasterStore = create<MasterStore>((set) => ({
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
}))
