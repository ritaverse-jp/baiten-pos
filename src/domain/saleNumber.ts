/**
 * 会計番号の生成・パース。docs/design.md 5章の採番方式を実装する。
 *
 * 形式：`YYYYMMDD-{端末コード}{連番}`（例 `20260723-A014`）。端末コードは
 * 英大文字のみ（`TERMINAL_CODE_PATTERN`）に限定しているため、ハイフン以降の
 * 末尾の数字列を連番として、連番が何桁に延びても一意に切り出せる
 * （docs/design.md 5.4）。
 *
 * この層は端末のシステム時計（`Date`）以外に外部依存を持たない純粋関数。
 * 連番そのものの採番（Dexie トランザクションでの排他制御）は
 * `data/sync/counter.ts` が担う。
 */

import { LIMITS, type DateKey, type SaleId, type TerminalCode } from './types'

const SALE_ID_PATTERN = /^(\d{8})-([A-Z]{1,4})(\d+)$/

/**
 * 日付から `YYYYMMDD` の日付キーを作る。
 *
 * 端末の**ローカル日時**（システムのタイムゾーン）で日付境界を決める。UTC で
 * 切ると、日本時間の深夜0時前後の会計が前日/翌日どちらのタブに転記されるかが
 * 実際の営業日とずれる。端末時計そのもののずれは別途警告対象とする（5.3）
 */
export function toDateKey(date: Date): DateKey {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}${m}${d}` as DateKey
}

/**
 * `YYYYMMDD` 文字列が実在する暦日かどうかを検証する。
 * `20260231`（存在しない2/31）や `20261301`（存在しない13月）のような
 * 桁数だけ揃った不正な値を弾く。
 */
export function isValidDateKey(value: string): value is DateKey {
  if (!/^\d{8}$/.test(value)) return false

  const y = Number(value.slice(0, 4))
  const m = Number(value.slice(4, 6))
  const d = Number(value.slice(6, 8))
  const date = new Date(y, m - 1, d)

  // 月・日が範囲外だと Date は自動的に繰り上がる（2/31 → 3/3 等）。
  // 構成した日付を読み戻して元の値と一致するかで実在性を確認する
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d
}

/**
 * 会計番号を組み立てる。連番は `LIMITS.seqDigits`（3桁）でゼロ埋めするが、
 * 999 を超えても切り詰めない。自然に桁数が延びる（docs/design.md 5.3）
 */
export function formatSaleId(dateKey: DateKey, terminalCode: TerminalCode, seq: number): SaleId {
  if (!Number.isSafeInteger(seq) || seq < 1) {
    throw new RangeError(`連番は1以上の整数でなければならない: ${seq}`)
  }
  const seqStr = String(seq).padStart(LIMITS.seqDigits, '0')
  return `${dateKey}-${terminalCode}${seqStr}` as SaleId
}

/** `toDateKey` と `formatSaleId` をまとめた便宜関数 */
export function buildSaleId(date: Date, terminalCode: TerminalCode, seq: number): SaleId {
  return formatSaleId(toDateKey(date), terminalCode, seq)
}

export interface ParsedSaleId {
  dateKey: DateKey
  terminalCode: TerminalCode
  seq: number
}

/**
 * 会計番号を分解する。フォーマットが不正な場合は例外を投げず null を返す
 * （サーバーから受信した会計履歴の表示や取消処理など、外部由来の文字列を
 * 防御的にパースしたい場面があるため）。
 *
 * 端末コードが英字のみであることを前提に、正規表現は「英字の並び」から
 * 「数字の並び」への切り替わりを境界として連番を取り出す。文字クラスが
 * 排反（英字か数字のいずれか）なので、連番が何桁でも・端末コードが1〜4文字
 * どれでも曖昧さなく分解できる（docs/design.md 5.4）
 */
export function parseSaleId(saleId: string): ParsedSaleId | null {
  const match = SALE_ID_PATTERN.exec(saleId)
  if (!match) return null

  const [, dateKeyPart, terminalCodePart, seqPart] = match
  if (!isValidDateKey(dateKeyPart)) return null

  const seq = Number(seqPart)
  if (!Number.isSafeInteger(seq) || seq < 1) return null

  return {
    dateKey: dateKeyPart as DateKey,
    terminalCode: terminalCodePart as TerminalCode,
    seq,
  }
}
