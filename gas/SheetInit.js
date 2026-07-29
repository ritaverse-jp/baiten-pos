/**
 * スプレッドシートのタブ雛形生成。docs/design.md 1章の列定義に対応する。
 *
 * `売上ログ_YYYYMM` はここでは作らない。会計確定時に GAS が自動生成する
 * （appendSales。design 2.4・8.1。タスク8）。
 */

var SHEET_DEFINITIONS = [
  { name: '商品マスタ', headers: ['No.', '商品名', '金額', 'カテゴリ名', '表示順', '販売状態'] },
  { name: 'カテゴリ', headers: ['カテゴリ名', '表示順', '表示色'] },
  { name: '端末', headers: ['端末コード', '端末名', '登録日時', '状態', '最終同期日時'] },
  { name: '操作ログ', headers: ['日時', '端末コード', '操作種別', '対象', '内容'] },
]

/**
 * 4つの静的タブ（商品マスタ・カテゴリ・端末・操作ログ）が存在することを保証する。
 * 存在しないタブだけをヘッダー行付きで作成する。既存タブの内容には一切触れない
 * （冪等）。
 *
 * Apps Script エディタから手動で一度実行することを主目的とするが、
 * `getMasters` など各エンドポイントの冒頭からも安全に呼べる。
 */
function ensureCoreSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet()
  SHEET_DEFINITIONS.forEach(function (def) {
    if (ss.getSheetByName(def.name)) return
    var sheet = ss.insertSheet(def.name)
    sheet.getRange(1, 1, 1, def.headers.length).setValues([def.headers])
    sheet.setFrozenRows(1)
  })
}
