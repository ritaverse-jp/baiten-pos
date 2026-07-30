/**
 * 画面表示用のフォーマット。要件定義 6.2・7.2 の表示ルールを実装する。
 * React・DOM には依存しない純粋関数（docs/design.md 3.2）。
 */

import { LIMITS, type Yen } from './types'

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
