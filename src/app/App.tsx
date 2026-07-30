import { useEffect } from 'react'
import CheckoutScreen from '@/screens/checkout/CheckoutScreen'
import { useMasterStore } from '@/state/masterStore'
import { useSyncStore } from '@/state/syncStore'
import { useTicketStore } from '@/state/ticketStore'

export default function App() {
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
  }, [hydrateTicket, hydrateMasters, hydrateSync])

  return <CheckoutScreen />
}
