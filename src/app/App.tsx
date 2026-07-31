import { useEffect, useState } from 'react'
import CategoriesScreen from '@/screens/categories/CategoriesScreen'
import CheckoutScreen from '@/screens/checkout/CheckoutScreen'
import HistoryScreen from '@/screens/history/HistoryScreen'
import ProductsScreen from '@/screens/products/ProductsScreen'
import SettingsScreen from '@/screens/settings/SettingsScreen'
import { reconcileCounterOnStartup } from '@/data/sync/counter'
import { startSyncEngine } from '@/data/sync/engine'
import { startTokenRefreshWatcher } from '@/data/sync/tokenRefresh'
import { useMasterStore } from '@/state/masterStore'
import { useSyncStore } from '@/state/syncStore'
import { useTicketStore } from '@/state/ticketStore'

/** 画面遷移。ルーティングライブラリを使うほどの規模ではないため単純な状態切り替えにする */
type View = 'checkout' | 'products' | 'categories' | 'history' | 'settings'

export default function App() {
  const [view, setView] = useState<View>('checkout')
  const hydrateTicket = useTicketStore((s) => s.hydrate)
  const hydrateMasters = useMasterStore((s) => s.hydrate)
  const hydrateSync = useSyncStore((s) => s.hydrate)

  // 起動時に一度だけ、入力中伝票（NF-04）・商品マスタキャッシュ・
  // 未送信件数を IndexedDB から復元する（docs/design.md 3.2）。
  // 画面（screens/）を追加してもこの位置は変えないこと（CLAUDE.md）。
  useEffect(() => {
    void hydrateTicket()
    void hydrateMasters()
    void hydrateSync()

    // 端末データを消した直後に圏外で営業を始めた場合等に、当日カウンタが
    // 未初期化のままにならないよう、起動時にサーバーの最大連番で補正する
    // （design 5.3）。'blocked' の扱い（会計開始のブロック・表示）は、
    // 会計画面が採番を必要とするタイミング（タスク13で実装済みの
    // CheckoutScreen）側で今後扱う。現時点では起動時のベストエフォートの
    // 補正のみ行う
    void reconcileCounterOnStartup(new Date())

    // design 4.1 の起動契機（online復帰・タブ復帰・30秒間隔）を配線する
    startSyncEngine()

    // design 6.5：残り14日を切ったらオンライン時に静かにトークンを巻き直す
    startTokenRefreshWatcher()
  }, [hydrateTicket, hydrateMasters, hydrateSync])

  if (view === 'products') {
    return <ProductsScreen onBack={() => setView('checkout')} onNavigateToCategories={() => setView('categories')} />
  }
  if (view === 'categories') {
    return <CategoriesScreen onBack={() => setView('products')} />
  }
  if (view === 'history') {
    return <HistoryScreen onBack={() => setView('checkout')} />
  }
  if (view === 'settings') {
    return <SettingsScreen onBack={() => setView('checkout')} />
  }
  return (
    <CheckoutScreen
      onNavigateToProducts={() => setView('products')}
      onNavigateToHistory={() => setView('history')}
      onNavigateToSettings={() => setView('settings')}
    />
  )
}
