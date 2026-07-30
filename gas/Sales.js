/**
 * `appendSales`・`getTodayMaxSeq`・`getSalesHistory`・`cancelSale` エンドポイント。
 * docs/design.md 2.4・2.5・2.6.1・2.7 参照。
 *
 * `getTodayMaxSeq` は design 2.9 のファイル表では明記していなかったが、
 * 売上ログのタブ・列を直接読む点で appendSales と関心が近いためここに置く。
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

/**
 * 自端末・指定日の最大連番を返す。IndexedDB が消えた端末がカウンタを
 * 復元するために使う（design 2.5・5.3）。ロック不要（読み取り専用）。
 */
function getTodayMaxSeq(params) {
  var terminalCode = requireAuth_(params)
  var date = params && params.date
  if (!date || !/^\d{8}$/.test(date)) {
    throw new ApiError('VALIDATION_ERROR', 'date は YYYYMMDD 形式で指定してください')
  }

  var tabName = SALES_SHEET_PREFIX + date.slice(0, 6)
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(tabName)
  var prefix = date + '-' + terminalCode
  var maxSeq = 0

  if (sheet) {
    var lastRow = sheet.getLastRow()
    if (lastRow >= 2) {
      var saleIds = sheet.getRange(2, 3, lastRow - 1, 1).getValues() // C列: 会計番号
      saleIds.forEach(function (row) {
        var saleId = row[0]
        if (typeof saleId !== 'string' || saleId.indexOf(prefix) !== 0) return
        var seq = parseInt(saleId.slice(prefix.length), 10)
        if (!isNaN(seq) && seq > maxSeq) maxSeq = seq
      })
    }
  }

  return { maxSeq: maxSeq }
}

/**
 * 指定日の会計履歴を全端末分まとめて返す（design 2.6.1・FR-14）。
 * ロック不要（読み取り専用。design 2.4 の「同時追記」対策はロックの目的であり、
 * 読み取りだけならロックを取らなくても不整合は起きない）。
 *
 * 売上ログは1商品1行（design 8.2）のため、`saleId`（C列）でグルーピングして
 * 1会計1エントリに組み立て直す。取消（design 2.7）は同じ `saleId` で個数が
 * マイナスの行を追記する方式のため、正の行（確定時点の明細）と負の行
 * （取消の記録）を分けて扱う：正の行から `lines`/`total` を組み立て、
 * 負の行が1件でもあれば `canceled: true` とする。
 */
function getSalesHistory(params) {
  // 全端末分の履歴を返す（design task18「オンライン時は全端末分」）ため、
  // 参照自体は認証済みであれば端末を問わない
  requireAuth_(params)

  var date = params && params.date
  if (!date || !/^\d{8}$/.test(date)) {
    throw new ApiError('VALIDATION_ERROR', 'date は YYYYMMDD 形式で指定してください')
  }

  var tabName = SALES_SHEET_PREFIX + date.slice(0, 6)
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(tabName)
  if (!sheet) return { sales: [] }

  var lastRow = sheet.getLastRow()
  if (lastRow < 2) return { sales: [] }

  var targetDateStr = date.slice(0, 4) + '/' + date.slice(4, 6) + '/' + date.slice(6, 8)
  var rows = sheet.getRange(2, 1, lastRow - 1, SALES_SHEET_HEADERS.length).getValues()

  var groups = {} // saleId -> { originalRows: [][], cancelRows: [][] }
  var order = [] // saleId の初出順（グルーピング後の表示順を安定させる）

  rows.forEach(function (row) {
    if (cellDateString_(row[0]) !== targetDateStr) return
    var saleId = row[2]
    if (!saleId) return
    if (!groups[saleId]) {
      groups[saleId] = { originalRows: [], cancelRows: [] }
      order.push(saleId)
    }
    if (row[6] < 0) {
      groups[saleId].cancelRows.push(row)
    } else {
      groups[saleId].originalRows.push(row)
    }
  })

  var sales = order
    .map(function (saleId) {
      return buildSalesHistoryEntry_(saleId, groups[saleId])
    })
    .filter(function (entry) {
      return entry !== null
    })

  return { sales: sales }
}

/** 1件の `saleId` グループから `SalesHistoryEntry`（domain/types.ts）を組み立てる */
function buildSalesHistoryEntry_(saleId, group) {
  // 正の行が1件も無い（負の行しか無い）状態は本来起こらないが、防御的に除外する
  if (group.originalRows.length === 0) return null

  var first = group.originalRows[0]
  var lines = group.originalRows
    .map(function (row) {
      return { lineNo: row[10], productName: row[4], netUnitPrice: row[5], qty: row[6], subtotal: row[7], discount: row[8] }
    })
    .sort(function (a, b) {
      return a.lineNo - b.lineNo
    })

  var total = group.originalRows.reduce(function (sum, row) {
    return sum + row[7]
  }, 0)

  var canceled = group.cancelRows.length > 0
  var canceledAt = canceled ? isoFromCells_(group.cancelRows[0][0], group.cancelRows[0][1]) : null

  return {
    saleId: saleId,
    terminalCode: first[3],
    confirmedAt: isoFromCells_(first[0], first[1]),
    note: first[9],
    lines: lines,
    total: total,
    canceled: canceled,
    canceledAt: canceledAt,
  }
}

/**
 * 会計の取消（design 2.7・FR-15）。元会計の全行を読み、個数・小計をマイナスに
 * した行を追記する。元の行は削除しない（追記専用の原則。design 1.1・4.4）。
 *
 * 未送信の会計は取り消せない【確定】：シートに載っていない（＝まだ未送信
 * キューに残っている）会計は、そもそも該当行が見つからないため
 * VALIDATION_ERROR になる。クライアント側は加えて、履歴画面で未送信の
 * 会計の取消ボタンをあらかじめ非活性にする（design 2.7・CLAUDE.md）。
 *
 * 重複チェック・追記を同一ロック内で行うのは appendSales と同じ理由
 * （check-then-act の競合を避ける。design 2.8）。既に取消済み（負の行が
 * 既に存在する）場合は再度の取消を拒否し、二重の負数計上を防ぐ。
 */
function cancelSale(params) {
  var terminalCode = requireAuth_(params)
  var saleId = params && params.saleId
  if (typeof saleId !== 'string' || !saleId) {
    throw new ApiError('VALIDATION_ERROR', 'saleId は必須です')
  }
  var datePart = saleId.slice(0, 8)
  if (!/^\d{8}$/.test(datePart)) {
    throw new ApiError('VALIDATION_ERROR', 'saleId の形式が不正です: ' + saleId)
  }

  var lock = LockService.getScriptLock()
  try {
    lock.waitLock(LOCK_WAIT_MS)
  } catch (err) {
    throw new ApiError('LOCK_TIMEOUT', 'ロックを取得できませんでした。しばらくしてから再試行してください')
  }

  try {
    var tabName = SALES_SHEET_PREFIX + datePart.slice(0, 6)
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(tabName)
    var lastRow = sheet ? sheet.getLastRow() : 0
    if (!sheet || lastRow < 2) {
      throw new ApiError('VALIDATION_ERROR', '指定された会計が見つかりません（未送信の可能性があります）: ' + saleId)
    }

    var rows = sheet.getRange(2, 1, lastRow - 1, SALES_SHEET_HEADERS.length).getValues()
    var originalRows = []
    var alreadyCanceled = false
    rows.forEach(function (row) {
      if (row[2] !== saleId) return
      if (row[6] < 0) {
        alreadyCanceled = true
      } else {
        originalRows.push(row)
      }
    })

    if (originalRows.length === 0) {
      throw new ApiError('VALIDATION_ERROR', '指定された会計が見つかりません（未送信の可能性があります）: ' + saleId)
    }
    if (alreadyCanceled) {
      throw new ApiError('VALIDATION_ERROR', 'この会計は既に取消済みです: ' + saleId)
    }

    var now = new Date()
    var dateStr = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy/MM/dd')
    var timeStr = Utilities.formatDate(now, 'Asia/Tokyo', 'HH:mm')
    var note = '取消（' + saleId + '）'

    // 個数（G列）・小計（H列）のみマイナスにする。金額（F列）・割引額（I列）は
    // そのまま据え置く（design 2.7：「個数と小計をマイナスにした行を追記する」）
    var cancelRows = originalRows.map(function (row) {
      return [dateStr, timeStr, saleId, terminalCode, row[4], row[5], -row[6], -row[7], row[8], note, row[10]]
    })

    sheet.getRange(sheet.getLastRow() + 1, 1, cancelRows.length, SALES_SHEET_HEADERS.length).setValues(cancelRows)

    logOperation_(terminalCode, '会計取消', '会計番号 ' + saleId, { canceledRows: cancelRows.length })

    return { saleId: saleId, canceledAt: now.toISOString() }
  } finally {
    lock.releaseLock()
  }
}

/**
 * A列（日付）・B列（時刻）は文字列として書き込むが、スプレッドシート側の
 * 自動書式認識により Date 型のセルとして保存され得る。読み取り時はどちらの
 * 型でも対応できるよう、Date であれば改めてフォーマットし直す。
 */
function cellDateString_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return Utilities.formatDate(value, 'Asia/Tokyo', 'yyyy/MM/dd')
  }
  return String(value)
}

function cellTimeString_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return Utilities.formatDate(value, 'Asia/Tokyo', 'HH:mm')
  }
  return String(value)
}

/** A列・B列のセル値から ISO 8601（JST）を組み立てる。秒以下は保持していないため 00 固定 */
function isoFromCells_(dateCell, timeCell) {
  return cellDateString_(dateCell).replace(/\//g, '-') + 'T' + cellTimeString_(timeCell) + ':00+09:00'
}
