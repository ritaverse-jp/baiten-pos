/**
 * `getMasters` エンドポイント。docs/design.md 2.3 参照。
 */

var PRODUCTS_SHEET_NAME = '商品マスタ'
var CATEGORIES_SHEET_NAME = 'カテゴリ'

/**
 * 商品・カテゴリ・自端末状態の一括取得。
 * `ensureCoreSheets` を先頭で呼び、静的タブが未作成でも安全に動作させる。
 */
function getMasters(params) {
  ensureCoreSheets()
  var terminalCode = requireAuth_(params)

  return {
    products: readProducts_(),
    categories: readCategories_(),
    terminalStatus: getTerminalStatus_(terminalCode),
    fetchedAt: new Date().toISOString(),
  }
}

function readProducts_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PRODUCTS_SHEET_NAME)
  // G列（画像ID）まで読む。画像の実体はここに含めない——`getMasters` は
  // オフライン復帰時に必ず走る経路であり、重くすると同期全体が遅くなる
  // （design 9.3）。端末は ID を見て未取得のぶんだけ別途取りに行く
  return sheetRowsAfterHeader_(sheet, 7).map(function (row) {
    return {
      no: row[0],
      name: row[1],
      price: row[2],
      categoryName: row[3],
      displayOrder: row[4] === '' ? null : row[4],
      status: row[5],
      imageId: row[6] === '' ? null : row[6],
    }
  })
}

function readCategories_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CATEGORIES_SHEET_NAME)
  return sheetRowsAfterHeader_(sheet, 3).map(function (row) {
    return {
      name: row[0],
      displayOrder: row[1] === '' ? null : row[1],
      color: row[2] === '' ? null : row[2],
    }
  })
}

/**
 * ヘッダー行を除いた全データ行を返す。シートが存在しない、またはヘッダー行
 * しかない場合は空配列。
 */
function sheetRowsAfterHeader_(sheet, columnCount) {
  if (!sheet) return []
  var lastRow = sheet.getLastRow()
  if (lastRow < 2) return []
  return sheet.getRange(2, 1, lastRow - 1, columnCount).getValues()
}
