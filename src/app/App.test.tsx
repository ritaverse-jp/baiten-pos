import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, test } from 'vitest'
import { db } from '@/data/db/schema'
import { toYen, type Product } from '@/domain/types'
import { useMasterStore } from '@/state/masterStore'
import { useSyncStore } from '@/state/syncStore'
import { useTicketStore } from '@/state/ticketStore'
import App from './App'

beforeEach(async () => {
  await db.currentTicket.clear()
  await db.products.clear()
  await db.categories.clear()
  useTicketStore.setState({ lines: [], note: '', hydrated: false })
  useMasterStore.setState({ products: [], categories: [], hydrated: false })
  useSyncStore.setState({ connection: 'unknown', pendingCount: 0, syncing: false, lastSyncedAt: null, blockedBy: null })
})

test('アプリのシェルが描画される。ヘッダーは復元中でも常に表示する', () => {
  render(<App />)
  expect(screen.getByRole('heading', { name: '売店レジ' })).toBeInTheDocument()
})

test('起動時にIndexedDBの入力中伝票を復元する（NF-04：再読み込み後の復元）', async () => {
  // 「前回のセッションで保存されていた伝票」を模して直接 IndexedDB に書いておく
  const product: Product = {
    no: 1,
    name: 'からあげ串',
    price: toYen(500),
    categoryName: 'フード',
    displayOrder: null,
    status: '有効',
  }
  await useTicketStore.getState().addProductByNo(1, [product])
  // App マウント前の状態（＝再読み込み直後）に戻す。IndexedDB の中身はそのまま
  useTicketStore.setState({ lines: [], note: '', hydrated: false })

  render(<App />)

  await waitFor(() => {
    expect(screen.getByText('からあげ串')).toBeInTheDocument()
  })
  expect(useTicketStore.getState().lines).toHaveLength(1)
  expect(useTicketStore.getState().lines[0].productNo).toBe(1)
})
