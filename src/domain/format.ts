/**
 * 画面表示用のフォーマット。要件定義 6.2・7.2 の表示ルールを実装する。
 * React・DOM には依存しない純粋関数（docs/design.md 3.2）。
 */

import { LIMITS, type IsoDateTime, type Yen } from './types'

const CIRCLED_DIGITS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩', '⑪', '⑫', '⑬', '⑭', '⑮', '⑯', '⑰', '⑱', '⑲', '⑳']

/**
 * 商品 No. の表示形式。1〜20 は丸数字（①〜⑳）、21 以降は通常数字
 * （要件定義 6.2）。
 */
export function formatProductNo(no: number): string {
  if (Number.isInteger(no) && no >= 1 && no <= LIMITS.circledNumberMax) {
    return CIRCLED_DIGITS[no - 1]
  }
  return String(no)
}

/** 金額を3桁区切り＋「円」で表示する（例：1200 → "1,200円"） */
export function formatYen(amount: Yen): string {
  return `${amount.toLocaleString('ja-JP')}円`
}

/**
 * `IsoDateTime` を `HH:mm`（JST）で表示する（SC-05 会計履歴。要件定義6.9）。
 *
 * ローカルの `SaleRecord.confirmedAt`（`Date.toISOString()` = UTC・`Z`表記）と
 * GAS `getSalesHistory` が組み立てる `confirmedAt`（明示的な `+09:00`表記）は
 * 文字列表現が異なるため、文字列の切り出しではなく `Date` として解釈した上で
 * `timeZone: 'Asia/Tokyo'` を明示して整形する（どちらの表現でも正しく変換される）。
 */
export function formatTime(iso: IsoDateTime): string {
  return new Date(iso).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Tokyo' })
}
