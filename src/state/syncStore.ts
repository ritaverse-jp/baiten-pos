/**
 * 接続状態・未送信件数のストア（Zustand）。docs/design.md 3.2・4.3・9.1。
 *
 * `connection` の真実は直近の GAS リクエストの成否であり、`navigator.onLine`
 * ではない（design 4.3・CLAUDE.md 不変条件18）。この値を書き換えるのは
 * 同期エンジン（タスク16）の責務で、ここでは器（setter）だけを提供する。
 *
 * `pendingCount` は未送信キュー（`data/db/pendingQueue.ts`）の実件数を反映する
 * 値であり、画面上部のバッジに使う（要件定義 9.1）。永続化はしない
 * （真実は常に Dexie の `pendingQueue` テーブルであり、ここはその複製）。
 */

import { create } from 'zustand'
import { getPendingCount } from '@/data/db/pendingQueue'
import type { ConnectionState, IsoDateTime, SyncBlockReason, SyncState } from '@/domain/types'

interface SyncStoreActions {
  /** 起動時に一度だけ呼ぶ。未送信件数を Dexie の実データで初期化する */
  hydrate: () => Promise<void>
  setConnection: (connection: ConnectionState) => void
  /** 未送信キューを操作した箇所（同期エンジン等）から、変更のたびに呼ぶ */
  refreshPendingCount: () => Promise<void>
  setSyncing: (syncing: boolean) => void
  setLastSyncedAt: (at: IsoDateTime) => void
  setBlockedBy: (reason: SyncBlockReason | null) => void
}

export type SyncStore = SyncState & SyncStoreActions

export const useSyncStore = create<SyncStore>((set) => ({
  connection: 'unknown',
  pendingCount: 0,
  syncing: false,
  lastSyncedAt: null,
  blockedBy: null,

  hydrate: async () => {
    const pendingCount = await getPendingCount()
    set({ pendingCount })
  },

  setConnection: (connection) => set({ connection }),

  refreshPendingCount: async () => {
    const pendingCount = await getPendingCount()
    set({ pendingCount })
  },

  setSyncing: (syncing) => set({ syncing }),
  setLastSyncedAt: (lastSyncedAt) => set({ lastSyncedAt }),
  setBlockedBy: (blockedBy) => set({ blockedBy }),
}))
