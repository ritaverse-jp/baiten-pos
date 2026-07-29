/**
 * `appendSales` エンドポイント。docs/design.md 2.4 参照。
 *
 * `getSalesHistory`・`cancelSale`（design 2.9 のファイル構成でこのファイルに
 * 割り当て済み）は未実装。対応するタスクで追加する。
 */

var SALES_SHEET_PREFIX = '売上ログ_'
var SALES_SHEET_HEADERS = ['日付', '時刻', '会計番号', '端末コード', '商品名', '金額', '個数', '小計', '割引額', '備考', '行番号']
var LOCK_WAIT_MS = 30000

/**
 * 売上明細の一括追記。同一 saleId は冪等（`duplicate` を返し追記しない）。
 *
 * ロックの外で行うのは「認証」と「リクエスト形状の検証」だけ。
 * `confirmedAt` から求めた月タブが存在するかどうかの判定・自動生成は、
 * 重複チェック・追記と**同一ロック内**で行う。タブの存在確認と作成を
 * ロック外に出すと、複数端末が月初の初回会計をほぼ同時に送った場合に
 * 「無いことを確認 → 作成」の間で競合し、片方が「シート名の重複」で
 * 例外になる（重複チェックをロック外に出すと check-then-act の競合が
 * 起きるのと全く同じ理由。design 2.8）。
 */
function appendSales(params) {
  var terminalCode = requireAuth_(params)
  var sales = validateAppendSalesRequest_(params, terminalCode)

  var lock = LockService.getScriptLock()
  try {
    lock.waitLock(LOCK_WAIT_MS)
  } catch (err) {
    throw new ApiError('LOCK_TIMEOUT', 'ロックを取得できませんでした。しばらくしてから再送してください')
  }

  try {
    var results = []
    var rowsByTab = {} // タブ名 -> 追記する行の二次元配列
    var queuedSaleIds = {} // タブ名 -> { saleId: true }（同一バッチ内の重複防止）

    sales.forEach(function (sale) {
      var tabName = salesSheetName_(sale.confirmedAt)
      var sheet = ensureSalesSheet_(tabName)
      queuedSaleIds[tabName] = queuedSaleIds[tabName] || {}

      var isDuplicate = queuedSaleIds[tabName][sale.saleId] || saleIdExistsInSheet_(sheet, sale.saleId)
      if (isDuplicate) {
        results.push({ saleId: sale.saleId, status: 'duplicate' })
        return
      }

      queuedSaleIds[tabName][sale.saleId] = true
      rowsByTab[tabName] = (rowsByTab[tabName] || []).concat(buildSaleRows_(sale, terminalCode))
      results.push({ saleId: sale.saleId, status: 'appended' })
    })

    // タブごとに1回の setValues で末尾へ一括追記する（appendRow の連打はしない。design 2.4）
    Object.keys(rowsByTab).forEach(function (tabName) {
      var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(tabName)
      var rows = rowsByTab[tabName]
      sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, SALES_SHEET_HEADERS.length).setValues(rows)
    })

    updateTerminalLastSynced_(terminalCode)

    return { results: results }
  } finally {
    lock.releaseLock()
  }
}

/**
 * リクエスト形状の検証と、認証済み端末となりすまし防止のチェック。
 * ロックを取得する前に行う（軽量な検証にロックの待ち時間を巻き込まないため）。
 */
function validateAppendSalesRequest_(params, authenticatedTerminalCode) {
  var sales = params && params.sales
  if (!Array.isArray(sales) || sales.length === 0) {
    throw new ApiError('VALIDATION_ERROR', 'sales は1件以上の配列で指定してください')
  }

  sales.forEach(function (sale) {
    if (!sale || typeof sale.saleId !== 'string' || !sale.saleId) {
      throw new ApiError('VALIDATION_ERROR', 'saleId は必須です')
    }
    if (!sale.confirmedAt || isNaN(new Date(sale.confirmedAt).getTime())) {
      throw new ApiError('VALIDATION_ERROR', 'confirmedAt が不正です: ' + sale.saleId)
    }
    if (!Array.isArray(sale.lines) || sale.lines.length === 0) {
      throw new ApiError('VALIDATION_ERROR', 'lines は1件以上の配列で指定してください: ' + sale.saleId)
    }
    // 認証済みの端末以外を名乗った売上を受け付けない（design 6章の認証はリクエスト
    // 全体に対するものだが、ペイロード内の terminalCode は改めて突き合わせる）
    if (sale.terminalCode && sale.terminalCode !== authenticatedTerminalCode) {
      throw new ApiError('VALIDATION_ERROR', '認証された端末と異なる terminalCode です: ' + sale.saleId)
    }
  })

  return sales
}

function salesSheetName_(confirmedAtIso) {
  var ym = Utilities.formatDate(new Date(confirmedAtIso), 'Asia/Tokyo', 'yyyyMM')
  return SALES_SHEET_PREFIX + ym
}

/** 対象月タブを返す。存在しなければヘッダー行付きで作成する（design 2.4 手順2） */
function ensureSalesSheet_(tabName) {
  var ss = SpreadsheetApp.getActiveSpreadsheet()
  var sheet = ss.getSheetByName(tabName)
  if (sheet) return sheet

  sheet = ss.insertSheet(tabName)
  sheet.getRange(1, 1, 1, SALES_SHEET_HEADERS.length).setValues([SALES_SHEET_HEADERS])
  sheet.setFrozenRows(1)
  return sheet
}

/** C列（会計番号）を TextFinder で検索する（design 2.4 手順3） */
function saleIdExistsInSheet_(sheet, saleId) {
  var lastRow = sheet.getLastRow()
  if (lastRow < 2) return false
  var column = sheet.getRange(2, 3, lastRow - 1, 1) // C列
  return column.createTextFinder(saleId).matchEntireCell(true).findNext() !== null
}

/**
 * 1会計分の明細行を、売上ログの列順（A〜K）の二次元配列に組み立てる。
 * design 1.5：A日付 B時刻 C会計番号 D端末コード E商品名 F金額 G個数 H小計 I割引額 J備考 K行番号
 */
function buildSaleRows_(sale, terminalCode) {
  var confirmedAt = new Date(sale.confirmedAt)
  var dateStr = Utilities.formatDate(confirmedAt, 'Asia/Tokyo', 'yyyy/MM/dd')
  var timeStr = Utilities.formatDate(confirmedAt, 'Asia/Tokyo', 'HH:mm')
  var note = sale.note || ''

  return sale.lines.map(function (line) {
    return [
      dateStr,
      timeStr,
      sale.saleId,
      terminalCode,
      line.productName,
      line.netUnitPrice,
      line.qty,
      line.subtotal,
      line.discount,
      note,
      line.lineNo,
    ]
  })
}

/** `端末` タブ E列（最終同期日時）を更新する（design 2.4 手順5） */
function updateTerminalLastSynced_(terminalCode) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TERMINAL_SHEET_NAME)
  if (!sheet) return

  var lastRow = sheet.getLastRow()
  if (lastRow < 2) return

  var codes = sheet.getRange(2, 1, lastRow - 1, 1).getValues() // A列: 端末コード
  for (var i = 0; i < codes.length; i++) {
    if (codes[i][0] === terminalCode) {
      sheet.getRange(i + 2, 5).setValue(new Date()) // E列
      return
    }
  }
}
