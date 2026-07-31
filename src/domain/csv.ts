/**
 * 未送信データの CSV エクスポート（design 6.6）。
 *
 * `TERMINAL_DISABLED` の端末は同期が恒久停止するため、GAS 経由での回収ができない。
 * 誤操作や端末故障による無効化でも正当な売上を手動で回収できるよう、売上ログ
 * （`gas/Sales.js` の `SALES_SHEET_HEADERS`）と同じ列構成で出力し、管理者がそのまま
 * スプレッドシートに貼り付けられるようにする。
 */

import type { PendingSale } from './types'

export const PENDING_SALES_CSV_HEADER = ['日付', '時刻', '会計番号', '端末コード', '商品名', '金額', '個数', '小計', '割引額', '備考', '行番号']

function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

/** `confirmedAt`（ISO 8601。UTC・JST offset のどちらもあり得る）から JST の日付・時刻を取り出す */
function splitConfirmedAt(confirmedAt: string): { date: string; time: string } {
  const formatted = new Date(confirmedAt).toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  // Intl.DateTimeFormat（ja-JP）は "2026/07/30 14:32" 形式で返す
  const [date, time] = formatted.split(' ')
  return { date, time }
}

/**
 * 未送信キューを、売上ログと同じ列構成の CSV 文字列に変換する（1商品1行）。
 * 改行は CRLF（多くの表計算ソフトの既定と揃える）。
 */
export function pendingSalesToCsv(pending: readonly PendingSale[]): string {
  const rows = pending.flatMap((p) => {
    const { date, time } = splitConfirmedAt(p.payload.confirmedAt)
    return p.payload.lines.map((line) => [
      date,
      time,
      p.payload.saleId,
      p.payload.terminalCode,
      line.productName,
      String(line.netUnitPrice),
      String(line.qty),
      String(line.subtotal),
      String(line.discount),
      p.payload.note,
      String(line.lineNo),
    ])
  })

  return [PENDING_SALES_CSV_HEADER, ...rows].map((row) => row.map(csvEscape).join(',')).join('\r\n')
}
