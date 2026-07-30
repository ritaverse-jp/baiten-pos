import { useEffect } from 'react'
import { useMasterStore } from '@/state/masterStore'
import { useSyncStore } from '@/state/syncStore'
import { useTicketStore } from '@/state/ticketStore'

export default function App() {
  const hydrateTicket = useTicketStore((s) => s.hydrate)
  const ticketHydrated = useTicketStore((s) => s.hydrated)
  const hydrateMasters = useMasterStore((s) => s.hydrate)
  const hydrateSync = useSyncStore((s) => s.hydrate)

  // 起動時に一度だけ、入力中伝票（NF-04）・商品マスタキャッシュ・
  // 未送信件数を IndexedDB から復元する（docs/design.md 3.2）
  useEffect(() => {
    void hydrateTicket()
    void hydrateMasters()
    void hydrateSync()
  }, [hydrateTicket, hydrateMasters, hydrateSync])

  return (
    <main
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        gap: '0.5rem',
      }}
    >
      <h1 style={{ margin: 0, fontSize: '1.5rem' }}>売店レジ</h1>
      <p style={{ margin: 0, color: '#6b7280' }}>
        セットアップ中（タスク12：状態管理）{ticketHydrated ? ' — 伝票を復元しました' : ''}
      </p>
    </main>
  )
}
