/**
 * 入力中の伝票（`currentTicket`）へのアクセサ。
 *
 * 操作のたびに保存し、端末のスリープやブラウザ再読み込み後も復元できるように
 * する（要件定義 NF-04）。呼び出し側（タスク12の `state/ticketStore.ts`）は
 * `Ticket` 型だけを扱えばよく、DB 固有の固定キー（`CURRENT_TICKET_ID`）は
 * この層の外に出さない。
 */

import type { Ticket } from '@/domain/types'
import { CURRENT_TICKET_ID, db, type StoredTicket } from './schema'

export async function getCurrentTicket(): Promise<Ticket | null> {
  const stored = await db.currentTicket.get(CURRENT_TICKET_ID)
  if (!stored) return null
  const { id: _id, ...ticket } = stored
  return ticket
}

export async function saveCurrentTicket(ticket: Ticket): Promise<void> {
  const stored: StoredTicket = { ...ticket, id: CURRENT_TICKET_ID }
  await db.currentTicket.put(stored)
}

/** 会計確定後、または伝票クリア時に呼ぶ（要件定義 FR-12） */
export async function clearCurrentTicket(): Promise<void> {
  await db.currentTicket.delete(CURRENT_TICKET_ID)
}
