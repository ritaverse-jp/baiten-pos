/**
 * `saveProduct`・`deleteProduct` エンドポイント。docs/design.md 2.6 参照。
 */

/**
 * 商品の追加・編集。ロック内で「対象行を特定 → 検証 → 上書き → 操作ログ追記」を行う。
 * 同時編集は最後にロックを取った側が勝つ（design 2.6「後勝ち」）。
 */
function saveProduct(params) {
  var terminalCode = requireAuth_(params)
  var product = validateProductInput_(params && params.product)
  var originalNo = params && params.originalNo // 編集で No. を変更する場合のみ指定

  var lock = LockService.getScriptLock()
  try {
    lock.waitLock(LOCK_WAIT_MS)
  } catch (err) {
    throw new ApiError('LOCK_TIMEOUT', 'ロックを取得できませんでした。しばらくしてから再試行してください')
  }

  try {
    ensureCoreSheets()
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PRODUCTS_SHEET_NAME)
    var rows = productRows_(sheet)

    // No. 重複チェック（要件定義 6.2「既存の No. と重複する登録・編集はエラー」）。
    // 編集で自分自身の行に上書きする場合（No. を変えない、または originalNo で
    // 自分の行を除外する）は重複とみなさない。
    var targetRowIndex = -1 // 上書き対象の実シート行（0始まりのrows配列index）
    for (var i = 0; i < rows.length; i++) {
      var no = rows[i].no
      var isSelf = originalNo !== undefined && no === originalNo
      if (no === product.no && !isSelf) {
        throw new ApiError('DUPLICATE_KEY', 'この商品No.は既に使用されています: ' + product.no)
      }
      if (isSelf) targetRowIndex = i
    }
    if (originalNo === undefined) {
      // 新規追加。ただし No. が既存と一致する行があれば上書き編集として扱う
      for (var j = 0; j < rows.length; j++) {
        if (rows[j].no === product.no) targetRowIndex = j
      }
    }

    var before = targetRowIndex >= 0 ? rows[targetRowIndex] : null
    var rowValues = [product.no, product.name, product.price, product.categoryName, product.displayOrder, product.status]

    if (targetRowIndex >= 0) {
      sheet.getRange(targetRowIndex + 2, 1, 1, rowValues.length).setValues([rowValues])
    } else {
      sheet.appendRow(rowValues)
    }

    logOperation_(terminalCode, before ? '商品編集' : '商品追加', '商品No.' + product.no, {
      before: before,
      after: product,
    })

    return { product: product }
  } finally {
    lock.releaseLock()
  }
}

/**
 * 商品の削除。過去の売上ログには影響しない（売上ログは確定時点の商品名・
 * 金額を保持しているため。design 2.6）。
 */
function deleteProduct(params) {
  var terminalCode = requireAuth_(params)
  var no = params && params.no
  if (typeof no !== 'number') {
    throw new ApiError('VALIDATION_ERROR', 'no は数値で指定してください')
  }

  var lock = LockService.getScriptLock()
  try {
    lock.waitLock(LOCK_WAIT_MS)
  } catch (err) {
    throw new ApiError('LOCK_TIMEOUT', 'ロックを取得できませんでした。しばらくしてから再試行してください')
  }

  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PRODUCTS_SHEET_NAME)
    var rows = productRows_(sheet)
    var targetIndex = -1
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].no === no) {
        targetIndex = i
        break
      }
    }
    if (targetIndex === -1) {
      throw new ApiError('VALIDATION_ERROR', '指定された商品No.が見つかりません: ' + no)
    }

    var before = rows[targetIndex]
    sheet.deleteRow(targetIndex + 2)

    logOperation_(terminalCode, '商品削除', '商品No.' + no, { before: before })

    return { no: no }
  } finally {
    lock.releaseLock()
  }
}

/** 要件定義 6.2 の入力検証。No. 1〜99、商品名30文字以内、金額0以上、状態は有効/無効 */
function validateProductInput_(product) {
  if (!product) throw new ApiError('VALIDATION_ERROR', 'product は必須です')

  if (typeof product.no !== 'number' || product.no < 1 || product.no > 99 || !Number.isInteger(product.no)) {
    throw new ApiError('VALIDATION_ERROR', 'No.は1〜99の整数で指定してください')
  }
  if (typeof product.name !== 'string' || product.name.length === 0 || product.name.length > 30) {
    throw new ApiError('VALIDATION_ERROR', '商品名は1〜30文字で指定してください')
  }
  if (typeof product.price !== 'number' || product.price < 0 || !Number.isInteger(product.price)) {
    throw new ApiError('VALIDATION_ERROR', '金額は0以上の整数で指定してください')
  }
  if (typeof product.categoryName !== 'string' || product.categoryName.length === 0) {
    throw new ApiError('VALIDATION_ERROR', 'カテゴリ名は必須です')
  }
  if (product.status !== '有効' && product.status !== '無効') {
    throw new ApiError('VALIDATION_ERROR', '販売状態は 有効 または 無効 で指定してください')
  }
  var displayOrder = product.displayOrder === null || product.displayOrder === undefined ? '' : product.displayOrder

  return {
    no: product.no,
    name: product.name,
    price: product.price,
    categoryName: product.categoryName,
    displayOrder: displayOrder,
    status: product.status,
  }
}

/** `商品マスタ` タブの全データ行を { no, name, price, categoryName, displayOrder, status } の配列で返す */
function productRows_(sheet) {
  var lastRow = sheet.getLastRow()
  if (lastRow < 2) return []
  return sheet
    .getRange(2, 1, lastRow - 1, 6)
    .getValues()
    .map(function (row) {
      return {
        no: row[0],
        name: row[1],
        price: row[2],
        categoryName: row[3],
        displayOrder: row[4],
        status: row[5],
      }
    })
}
