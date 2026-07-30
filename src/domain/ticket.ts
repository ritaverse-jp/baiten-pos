/**
 * 伝票操作。要件定義 6.4・6.5 の仕様を実装する。
 *
 * 会計中の伝票（`TicketLine[]`）に対する追加・個数変更・行分割・割引設定・削除を
 * 提供する。すべて純粋関数とし、渡された配列を書き換えず新しい配列を返す
 * （React の状態更新・IndexedDB への永続化と相性がよいため。docs/design.md 3.2）。
 *
 * この層が扱うのは**確定前**の伝票のみ。確定済み会計（`SaleRecord`）の取消可否
 * （未送信の会計は取り消せない。CLAUDE.md）はここでは扱わない。
 */

import { CALC_ERROR_MESSAGES, validateDiscount, validateQty, type CalcError } from './calc'
import { toYen, type Product, type TicketLine } from './types'

export type TicketError =
  | 'productNotFound'
  | 'productInactive'
  | 'lineNotFound'
  | 'splitQtyTooSmall'
  | 'splitQtyTooLarge'
  | CalcError

/**
 * 操作結果。失敗時は伝票を変更しない（要件定義 6.4「伝票は変更しない」）ため、
 * 呼び出し側は `ok: true` のときだけ状態を更新すればよい。
 */
export type TicketOpResult = { ok: true; lines: TicketLine[] } | { ok: false; error: TicketError }

export const TICKET_ERROR_MESSAGES: Record<Exclude<TicketError, CalcError>, string> = {
  productNotFound: '入力された商品番号が見つかりません',
  productInactive: 'この商品は現在お取り扱いできません',
  lineNotFound: '対象の行が見つかりません',
  splitQtyTooSmall: '分割する数量は1以上にしてください',
  splitQtyTooLarge: '分割する数量は元の個数未満にしてください',
}

/**
 * `TicketError`（`TicketError` 固有のコード ＋ `CalcError`）から日本語メッセージを
 * 引く。画面はエラーコードの出自（ticket.ts か calc.ts か）を意識せず、
 * この関数だけ呼べばよい。
 */
export function ticketErrorMessage(error: TicketError): string {
  if (error in TICKET_ERROR_MESSAGES) {
    return TICKET_ERROR_MESSAGES[error as Exclude<TicketError, CalcError>]
  }
  return CALC_ERROR_MESSAGES[error as CalcError]
}

// ============================================================
// 行 ID
// ============================================================

export type GenerateLineId = () => string

/**
 * 行 ID は商品 No. と独立させている（要件定義 6.4「行を分ける」により、
 * 同一 No. の行が複数存在しうるため）。乱数生成のため通常のテスト
 * （`domain/*.test.ts`）はこれを直接呼ばず、決定的な `generateId` を注入する。
 */
const generateLineId: GenerateLineId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `line-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

function findLineIndex(lines: readonly TicketLine[], lineId: string): number {
  return lines.findIndex((line) => line.lineId === lineId)
}

// ============================================================
// FR-03: No. 入力による商品追加（要件定義 6.4）
// ============================================================

/**
 * No. を入力して伝票に商品行を追加する。
 *
 * - 存在しない No. はエラーとし、伝票は変更しない
 * - 販売状態が「無効」の商品も同様にエラーとする（要件定義 6.2 は商品一覧タップ時の
 *   非表示のみを規定しているが、無効化の目的が「一時的に販売停止」であるため、
 *   No. 直接入力からの追加も同様に拒否する。これは要件からの解釈であり明文規定ではない）
 * - すでに伝票に存在する同じ No. の行があれば、新規行を作らず既存行の個数を +1 する。
 *   割引が適用済みの行であっても据え置いたまま +1 する（割引は商品単体への設定のため、
 *   追加された1点にも自動的に適用される。要件定義 6.4）
 * - 「行を分ける」操作により同一 No. の行が複数存在する場合、要件定義に優先順位の
 *   明記はない。ここでは**割引が 0 円の行を優先して** +1 する。
 *
 *   位置（配列上どちらが先に作られたか）で決めると、どちらの行に割引を設定したかに
 *   よって +1 の挙動が変わってしまい、画面を見ただけではスタッフが次にどちらの行が
 *   増えるか予測できない。さらに、割引を設定した方の行がたまたま「先に作られた行」
 *   だった場合、テンキーで何も割引を指定していないのに追加した1点へ無断で割引が
 *   適用されてしまう（売上が静かに目減りする）。
 *
 *   割引 0 円の行を優先すれば、「テンキー入力＝割引を一切指定しない操作」という
 *   意味に一貫し、常に「素の1点を追加する」動作になる。唯一マッチする行が
 *   割引済みの場合（要件定義 6.4 が明記する単一行のケース）は、そのまま増やして
 *   割引を適用する。全行が割引済みという稀なケースのみ、フォールバックとして
 *   最初の行に +1 する（要件に規定がなく発生頻度も低いため許容する）
 */
export function addProductByNo(
  lines: readonly TicketLine[],
  products: readonly Product[],
  no: number,
  generateId: GenerateLineId = generateLineId,
): TicketOpResult {
  const product = products.find((p) => p.no === no)
  if (!product) {
    return { ok: false, error: 'productNotFound' }
  }
  if (product.status === '無効') {
    return { ok: false, error: 'productInactive' }
  }

  const matchIndices: number[] = []
  lines.forEach((line, i) => {
    if (line.productNo === no) matchIndices.push(i)
  })

  if (matchIndices.length === 0) {
    const newLine: TicketLine = {
      lineId: generateId(),
      productNo: product.no,
      productName: product.name,
      unitPrice: product.price,
      qty: 1,
      discount: toYen(0),
    }
    return { ok: true, lines: [...lines, newLine] }
  }

  const targetIndex = matchIndices.find((i) => lines[i].discount === 0) ?? matchIndices[0]
  const existing = lines[targetIndex]
  const qtyError = validateQty(existing.qty + 1)
  if (qtyError) {
    return { ok: false, error: qtyError }
  }

  const updated = [...lines]
  updated[targetIndex] = { ...existing, qty: existing.qty + 1 }
  return { ok: true, lines: updated }
}

// ============================================================
// FR-05: 個数変更（要件定義 6.5）
// ============================================================

export function incrementLineQty(lines: readonly TicketLine[], lineId: string): TicketOpResult {
  const index = findLineIndex(lines, lineId)
  if (index === -1) return { ok: false, error: 'lineNotFound' }

  const line = lines[index]
  const qtyError = validateQty(line.qty + 1)
  if (qtyError) return { ok: false, error: qtyError }

  const updated = [...lines]
  updated[index] = { ...line, qty: line.qty + 1 }
  return { ok: true, lines: updated }
}

/**
 * この行を減算すると個数が 0 になる（＝行が削除される）かどうか。
 *
 * 確認ダイアログを出すのは UI 層の責務（要件定義 7.3）。ドメイン層は削除を
 * 確定させるだけなので、UI はこの関数で事前に判定してからダイアログを出し、
 * 確認後に `decrementLineQty` を呼ぶ。
 */
export function isLastUnit(line: Pick<TicketLine, 'qty'>): boolean {
  return line.qty <= 1
}

/**
 * 個数を1減らす。個数が1の行を減算した場合は、要件定義 6.5
 * 「個数を 0 にした場合は行を削除する」に従い、行自体を取り除く
 * （qty: 0 の行を伝票に残さない）。
 */
export function decrementLineQty(lines: readonly TicketLine[], lineId: string): TicketOpResult {
  const index = findLineIndex(lines, lineId)
  if (index === -1) return { ok: false, error: 'lineNotFound' }

  const line = lines[index]
  if (isLastUnit(line)) {
    return { ok: true, lines: lines.filter((_, i) => i !== index) }
  }

  const updated = [...lines]
  updated[index] = { ...line, qty: line.qty - 1 }
  return { ok: true, lines: updated }
}

/**
 * 個数を直接指定する（要件定義 6.5「個数の直接入力も可能とする（1〜99）」）。
 * 0 を指定した場合は減算ボタンと同じ扱いで行を削除する。1〜99 の範囲外は
 * エラーとし、伝票は変更しない。
 */
export function setLineQty(lines: readonly TicketLine[], lineId: string, qty: number): TicketOpResult {
  const index = findLineIndex(lines, lineId)
  if (index === -1) return { ok: false, error: 'lineNotFound' }

  if (qty === 0) {
    return { ok: true, lines: lines.filter((_, i) => i !== index) }
  }

  const qtyError = validateQty(qty)
  if (qtyError) return { ok: false, error: qtyError }

  const updated = [...lines]
  updated[index] = { ...lines[index], qty }
  return { ok: true, lines: updated }
}

// ============================================================
// FR-06: 商品行の削除
// ============================================================

/** 商品行を取り消す。個数によらず行ごと削除する（要件定義 FR-06） */
export function removeLine(lines: readonly TicketLine[], lineId: string): TicketOpResult {
  const index = findLineIndex(lines, lineId)
  if (index === -1) return { ok: false, error: 'lineNotFound' }
  return { ok: true, lines: lines.filter((_, i) => i !== index) }
}

// ============================================================
// 行を分ける（要件定義 6.4）
// ============================================================

/**
 * 行を分ける。「同一商品で異なる割引を設定したい場合は、伝票行の
 * 『行を分ける』操作により別行として扱える」（要件定義 6.4）を実現する操作。
 *
 * 分割直後の2行は productNo・productName・unitPrice・discount をすべて
 * 引き継ぐ（分割の時点では割引を変えない。分割後に `setLineDiscount` で
 * 個別に設定する）。個数の総和は分割前後で変わらない。
 */
export function splitLine(
  lines: readonly TicketLine[],
  lineId: string,
  splitQty: number,
  generateId: GenerateLineId = generateLineId,
): TicketOpResult {
  const index = findLineIndex(lines, lineId)
  if (index === -1) return { ok: false, error: 'lineNotFound' }

  const line = lines[index]
  if (!Number.isSafeInteger(splitQty) || splitQty < 1) {
    return { ok: false, error: 'splitQtyTooSmall' }
  }
  // 分割後も元の行に1点以上残す必要がある。全量の切り出しは「分割」ではない
  if (splitQty >= line.qty) {
    return { ok: false, error: 'splitQtyTooLarge' }
  }

  const newLine: TicketLine = {
    lineId: generateId(),
    productNo: line.productNo,
    productName: line.productName,
    unitPrice: line.unitPrice,
    qty: splitQty,
    discount: line.discount,
  }

  const updated = [...lines]
  updated[index] = { ...line, qty: line.qty - splitQty }
  updated.splice(index + 1, 0, newLine)
  return { ok: true, lines: updated }
}

// ============================================================
// FR-07: 円割引（要件定義 6.6）
// ============================================================

/**
 * 行の割引額を設定する。`lineId` で対象を特定するため、同一商品が
 * 複数行に分かれていても、指定した行だけに適用され他の行には影響しない
 * （要件定義 6.6「割引は伝票内の行単位で個別に設定でき、同一商品でも別行に
 * 分けて異なる割引を設定できる」）。
 */
export function setLineDiscount(lines: readonly TicketLine[], lineId: string, discount: number): TicketOpResult {
  const index = findLineIndex(lines, lineId)
  if (index === -1) return { ok: false, error: 'lineNotFound' }

  const line = lines[index]
  const discountError = validateDiscount(line.unitPrice, discount)
  if (discountError) return { ok: false, error: discountError }

  const updated = [...lines]
  updated[index] = { ...line, discount: toYen(discount) }
  return { ok: true, lines: updated }
}
