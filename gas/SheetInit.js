/**
 * スプレッドシートのタブ雛形生成。docs/design.md 1章の列定義に対応する。
 *
 * `売上ログ_YYYYMM` はここでは作らない。会計確定時に GAS が自動生成する
 * （appendSales。design 2.4・8.1。タスク8）。
 */

var SHEET_DEFINITIONS = [
  { name: '商品マスタ', headers: ['No.', '商品名', '金額', 'カテゴリ名', '表示順', '販売状態', '画像ID'] },
  { name: 'カテゴリ', headers: ['カテゴリ名', '表示順', '表示色'] },
  { name: '端末', headers: ['端末コード', '端末名', '登録日時', '状態', '最終同期日時'] },
  { name: '操作ログ', headers: ['日時', '端末コード', '操作種別', '対象', '内容'] },
]

/**
 * 4つの静的タブ（商品マスタ・カテゴリ・端末・操作ログ）が存在することを保証する。
 * 存在しないタブはヘッダー行付きで作成する。冪等なので毎回呼んでよい。
 *
 * **既存タブに対しては、見出し行（1行目）の不足分だけを書き足す。**
 * データ行には一切触れない。列を後から追加した場合（画像ID・タスク21）に、
 * 運用中のスプレッドシートを手で直さなくても済むようにするための処理。
 * 既に値が入っている見出しセルは上書きしない。
 *
 * Apps Script エディタから手動で一度実行することを主目的とするが、
 * `getMasters` など各エンドポイントの冒頭からも安全に呼べる。
 */
function ensureCoreSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet()
  SHEET_DEFINITIONS.forEach(function (def) {
    var sheet = ss.getSheetByName(def.name)
    if (!sheet) {
      sheet = ss.insertSheet(def.name)
      sheet.getRange(1, 1, 1, def.headers.length).setValues([def.headers])
      sheet.setFrozenRows(1)
      return
    }
    ensureHeaderColumns_(sheet, def.headers)
  })
}

/**
 * 既存タブの見出し行に、定義にあって実際には無い列を書き足す。
 * シートの物理的な列数が足りない場合は先に列を追加する。
 */
function ensureHeaderColumns_(sheet, headers) {
  if (sheet.getMaxColumns() < headers.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), headers.length - sheet.getMaxColumns())
  }

  var current = sheet.getRange(1, 1, 1, headers.length).getValues()[0]
  for (var i = 0; i < headers.length; i++) {
    // 既に何か入っている見出しは尊重する（管理者が独自に付けた名前を消さない）
    if (current[i] === '' || current[i] === null) {
      sheet.getRange(1, i + 1).setValue(headers[i])
    }
  }
}
