/**
 * 金額計算。要件定義 6.6〜6.8 の計算仕様をそのまま実装する。
 *
 *   行小計   = （商品単価 − 行割引額）× 個数
 *   合計金額 = 全行の行小計の総和
 *   釣銭     = 預かり金 − 合計金額
 *
 * すべて整数円で計算する（要件定義 3-5）。この層は純粋関数のみで構成し、
 * React・通信・Dexie に依存しない（docs/design.md 3.2）。
 */

import { LIMITS, toYen, type SaleLine, type TicketLine, type Yen } from './types'

// ============================================================
// 入力値の検証
// ============================================================

export type CalcError =
  | 'priceNotInteger'
  | 'priceNegative'
  | 'discountNotInteger'
  | 'discountNegative'
  | 'discountExceedsUnitPrice'
  | 'qtyNotInteger'
  | 'qtyBelowMin'
  | 'qtyAboveMax'
  | 'receivedNotInteger'
  | 'receivedNegative'

export const CALC_ERROR_MESSAGES: Record<CalcError, string> = {
  priceNotInteger: '金額は整数で入力してください',
  priceNegative: '金額は0円以上で入力してください',
  discountNotInteger: '割引額は整数で入力してください',
  discountNegative: '割引額は0円以上で入力してください',
  discountExceedsUnitPrice: '割引額は単価を超えられません',
  qtyNotInteger: '個数は整数で入力してください',
  qtyBelowMin: `個数は${LIMITS.qtyMin}以上で入力してください`,
  qtyAboveMax: `個数は${LIMITS.qtyMax}以下で入力してください`,
  receivedNotInteger: '預かり金は整数で入力してください',
  receivedNegative: '預かり金は0円以上で入力してください',
}

/** 商品単価の検証（要件定義 6.2：0円以上の整数） */
export function validatePrice(price: number): CalcError | null {
  if (!Number.isSafeInteger(price)) return 'priceNotInteger'
  if (price < 0) return 'priceNegative'
  return null
}

/** 割引額の検証（要件定義 6.6：0円以上・単価以下） */
export function validateDiscount(unitPrice: Yen, discount: number): CalcError | null {
  if (!Number.isSafeInteger(discount)) return 'discountNotInteger'
  if (discount < 0) return 'discountNegative'
  if (discount > unitPrice) return 'discountExceedsUnitPrice'
  return null
}

/** 個数の検証（要件定義 6.5：1〜99） */
export function validateQty(qty: number): CalcError | null {
  if (!Number.isSafeInteger(qty)) return 'qtyNotInteger'
  if (qty < LIMITS.qtyMin) return 'qtyBelowMin'
  if (qty > LIMITS.qtyMax) return 'qtyAboveMax'
  return null
}

/** 預かり金の検証。合計未満かどうかは別途 `isSettleable` で判定する */
export function validateReceived(received: number): CalcError | null {
  if (!Number.isSafeInteger(received)) return 'receivedNotInteger'
  if (received < 0) return 'receivedNegative'
  return null
}

/**
 * 伝票 1 行として成立しているかの検証。
 * ここを通った行だけを伝票に入れることで、以降の計算関数は妥当な入力を前提にできる。
 */
export function validateTicketLine(line: TicketLine): CalcError | null {
  return validatePrice(line.unitPrice) ?? validateDiscount(line.unitPrice, line.discount) ?? validateQty(line.qty)
}

// ============================================================
// 行の計算
// ============================================================

/**
 * 割引適用後の 1 点あたり単価。売上ログ F 列（`SaleLine.netUnitPrice`）になる。
 *
 * 割引は**商品単体（1点あたりの単価）に対して適用する**（要件定義 6.6）。
 * 合計金額から割引額を引くのではない。
 */
export function netUnitPrice(line: Pick<TicketLine, 'unitPrice' | 'discount'>): Yen {
  return toYen(line.unitPrice - line.discount)
}

/**
 * 行小計 ＝（単価 − 割引額）× 個数。
 * 例：単価500円・個数2・割引50円 →（500 − 50）× 2 ＝ 900円
 */
export function lineSubtotal(line: Pick<TicketLine, 'unitPrice' | 'discount' | 'qty'>): Yen {
  return toYen(netUnitPrice(line) * line.qty)
}

/** 行に適用された割引の総額（表示用。合計計算には使わない） */
export function lineDiscountTotal(line: Pick<TicketLine, 'discount' | 'qty'>): Yen {
  return toYen(line.discount * line.qty)
}

// ============================================================
// 伝票の計算
// ============================================================

/** 合計金額 ＝ 全行の行小計の総和。空の伝票は 0 円 */
export function ticketTotal(lines: readonly TicketLine[]): Yen {
  return toYen(lines.reduce((sum, line) => sum + lineSubtotal(line), 0))
}

/** 伝票内の総点数（個数の合計） */
export function ticketItemCount(lines: readonly TicketLine[]): number {
  return lines.reduce((sum, line) => sum + line.qty, 0)
}

/** 伝票全体の割引総額（表示用） */
export function ticketDiscountTotal(lines: readonly TicketLine[]): Yen {
  return toYen(lines.reduce((sum, line) => sum + lineDiscountTotal(line), 0))
}

// ============================================================
// 精算
// ============================================================

/**
 * 釣銭 ＝ 預かり金 − 合計金額。
 * 預かり金が不足している場合は負の値を返す（不足額の表示には `shortage` を使う）。
 */
export function change(total: Yen, received: Yen): Yen {
  return toYen(received - total)
}

/** 不足額。足りている場合は 0（要件定義 6.7：不足額を赤字表示する） */
export function shortage(total: Yen, received: Yen): Yen {
  return toYen(Math.max(0, total - received))
}

/** 預かり金が合計金額以上か。ちょうどの場合も成立する */
export function isSettleable(total: Yen, received: Yen): boolean {
  return received >= total
}

/**
 * 会計確定ボタンを活性にしてよいか（要件定義 6.7）。
 * 空の伝票では確定できない。
 */
export function canConfirm(lines: readonly TicketLine[], received: Yen): boolean {
  return lines.length > 0 && isSettleable(ticketTotal(lines), received)
}

// ============================================================
// 確定時の変換
// ============================================================

/**
 * 伝票の行を売上ログの明細行に変換する。
 *
 * `lineNo` は 1 始まりで、同一会計内の明細順（売上ログ K 列）。
 * 単価は割引前の `unitPrice` ではなく**割引後の `netUnitPrice`** を書き込む点に注意
 * （売上ログ F 列の定義。docs/design.md 1.5）。
 */
export function buildSaleLines(lines: readonly TicketLine[]): SaleLine[] {
  return lines.map((line, index) => ({
    lineNo: index + 1,
    productName: line.productName,
    netUnitPrice: netUnitPrice(line),
    qty: line.qty,
    subtotal: lineSubtotal(line),
    discount: line.discount,
  }))
}

/** 売上明細から合計を再計算する。ローカル保存済みの会計や履歴の検算に使う */
export function saleLinesTotal(lines: readonly SaleLine[]): Yen {
  return toYen(lines.reduce((sum, line) => sum + line.subtotal, 0))
}
