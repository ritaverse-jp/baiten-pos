/**
 * 入力中伝票のストア（Zustand）。docs/design.md 3.2・要件定義 NF-04。
 *
 * すべての変更操作は `domain/ticket.ts` の純粋関数に委譲し、成功時は
 * **書き込みのたびに** IndexedDB（`currentTicket` テーブル）へ保存する。
 * 起動時は `hydrate()` を呼んで復元する（呼び出し元は `app/`。NF-04）。
 *
 * 画面から配列を直接操作させないため、`lines`/`note` は読み取り専用として
 * 公開し、更新は必ずこのストアのアクション経由で行う（CLAUDE.md の
 * 「伝票の更新は画面から直接配列操作せず、必ず domain/ticket.ts の関数を
 * 経由すること」を、状態管理の入口でも徹底する）。
 */

import { create } from 'zustand'
import { clearCurrentTicket, getCurrentTicket, saveCurrentTicket } from '@/data/db/currentTicket'
import {
  addProductByNo as addProductByNoOp,
  decrementLineQty as decrementLineQtyOp,
  incrementLineQty as incrementLineQtyOp,
  removeLine as removeLineOp,
  setLineDiscount as setLineDiscountOp,
  setLineQty as setLineQtyOp,
  splitLine as splitLineOp,
  type TicketOpResult,
} from '@/domain/ticket'
import type { Product, Ticket, TicketLine } from '@/domain/types'

interface TicketStoreState {
  lines: TicketLine[]
  note: string
  /** `hydrate()` が完了したか。完了前に画面へ空の伝票を一瞬表示してしまうのを避けるために使う */
  hydrated: boolean
}

interface TicketStoreActions {
  /** 起動時に一度だけ呼ぶ。IndexedDB から入力中伝票を復元する（NF-04） */
  hydrate: () => Promise<void>
  addProductByNo: (no: number, products: readonly Product[]) => Promise<TicketOpResult>
  incrementLineQty: (lineId: string) => Promise<TicketOpResult>
  decrementLineQty: (lineId: string) => Promise<TicketOpResult>
  setLineQty: (lineId: string, qty: number) => Promise<TicketOpResult>
  removeLine: (lineId: string) => Promise<TicketOpResult>
  splitLine: (lineId: string, splitQty: number) => Promise<TicketOpResult>
  setLineDiscount: (lineId: string, discount: number) => Promise<TicketOpResult>
  /** FR-13: 会計単位の備考 */
  setNote: (note: string) => Promise<void>
  /** 会計確定後・伝票クリア時に呼ぶ。IndexedDB からも削除する（FR-12） */
  clear: () => Promise<void>
}

export type TicketStore = TicketStoreState & TicketStoreActions

/**
 * ドメイン関数の呼び出し結果を店ステートに反映し、成功時のみ永続化する。
 * 失敗時（`ok: false`）は状態を変更しない（domain/ticket.ts の
 * 「失敗時は伝票を変更しない」という契約を、ここでも維持する）。
 */
async function applyResult(
  set: (partial: Partial<TicketStoreState>) => void,
  get: () => TicketStoreState,
  result: TicketOpResult,
): Promise<TicketOpResult> {
  if (!result.ok) return result

  set({ lines: result.lines })
  await persist(result.lines, get().note)
  return result
}

async function persist(lines: TicketLine[], note: string): Promise<void> {
  const ticket: Ticket = { lines, note, updatedAt: new Date().toISOString() }
  await saveCurrentTicket(ticket)
}

export const useTicketStore = create<TicketStore>((set, get) => ({
  lines: [],
  note: '',
  hydrated: false,

  hydrate: async () => {
    const ticket = await getCurrentTicket()
    set({ lines: ticket?.lines ?? [], note: ticket?.note ?? '', hydrated: true })
  },

  addProductByNo: async (no, products) => {
    const result = addProductByNoOp(get().lines, products, no)
    return applyResult(set, get, result)
  },

  incrementLineQty: async (lineId) => {
    const result = incrementLineQtyOp(get().lines, lineId)
    return applyResult(set, get, result)
  },

  decrementLineQty: async (lineId) => {
    const result = decrementLineQtyOp(get().lines, lineId)
    return applyResult(set, get, result)
  },

  setLineQty: async (lineId, qty) => {
    const result = setLineQtyOp(get().lines, lineId, qty)
    return applyResult(set, get, result)
  },

  removeLine: async (lineId) => {
    const result = removeLineOp(get().lines, lineId)
    return applyResult(set, get, result)
  },

  splitLine: async (lineId, splitQty) => {
    const result = splitLineOp(get().lines, lineId, splitQty)
    return applyResult(set, get, result)
  },

  setLineDiscount: async (lineId, discount) => {
    const result = setLineDiscountOp(get().lines, lineId, discount)
    return applyResult(set, get, result)
  },

  setNote: async (note) => {
    set({ note })
    await persist(get().lines, note)
  },

  clear: async () => {
    set({ lines: [], note: '' })
    await clearCurrentTicket()
  },
}))
