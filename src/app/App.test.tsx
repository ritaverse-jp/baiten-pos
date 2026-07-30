import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, test } from 'vitest'
import { db } from '@/data/db/schema'
import { toYen, type Product } from '@/domain/types'
import { useTicketStore } from '@/state/ticketStore'
import App from './App'

beforeEach(async () => {
  await db.currentTicket.clear()
  useTicketStore.setState({ lines: [], note: '', hydrated: false })
})

test('アプリのシェルが描画される', () => {
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
    expect(useTicketStore.getState().hydrated).toBe(true)
  })
  expect(useTicketStore.getState().lines).toHaveLength(1)
  expect(useTicketStore.getState().lines[0].productNo).toBe(1)
  expect(screen.getByText('伝票を復元しました', { exact: false })).toBeInTheDocument()
})
