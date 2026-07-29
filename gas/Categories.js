/**
 * `saveCategory`・`deleteCategory` エンドポイント。docs/design.md 2.6 参照。
 */

/**
 * カテゴリの追加・編集。**改名時は同一ロック内で `商品マスタ` D 列の同名セルも
 * 一括置換する**（design 1.7・2.6）。カテゴリ名は `商品マスタ` D 列の外部キーで
 * あり、改名とマスタ側の一括置換を別ロックに分けると、その間に商品が追加・
 * 編集されて参照が食い違う可能性があるため、同一ロック内で完結させる。
 */
function saveCategory(params) {
  var terminalCode = requireAuth_(params)
  var category = validateCategoryInput_(params && params.category)
  var originalName = params && params.originalName // 改名する場合のみ指定

  var lock = LockService.getScriptLock()
  try {
    lock.waitLock(LOCK_WAIT_MS)
  } catch (err) {
    throw new ApiError('LOCK_TIMEOUT', 'ロックを取得できませんでした。しばらくしてから再試行してください')
  }

  try {
    ensureCoreSheets()
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CATEGORIES_SHEET_NAME)
    var rows = categoryRows_(sheet)

    var targetRowIndex = -1
    for (var i = 0; i < rows.length; i++) {
      var name = rows[i].name
      var isSelf = originalName !== undefined && name === originalName
      if (name === category.name && !isSelf) {
        throw new ApiError('DUPLICATE_KEY', 'このカテゴリ名は既に使用されています: ' + category.name)
      }
      if (isSelf) targetRowIndex = i
    }
    if (originalName === undefined) {
      for (var j = 0; j < rows.length; j++) {
        if (rows[j].name === category.name) targetRowIndex = j
      }
    }

    var before = targetRowIndex >= 0 ? rows[targetRowIndex] : null
    var rowValues = [category.name, category.displayOrder, category.color]

    if (targetRowIndex >= 0) {
      sheet.getRange(targetRowIndex + 2, 1, 1, rowValues.length).setValues([rowValues])
    } else {
      sheet.appendRow(rowValues)
    }

    var renamed = originalName !== undefined && originalName !== category.name
    if (renamed) {
      cascadeCategoryRename_(originalName, category.name)
    }

    logOperation_(terminalCode, before ? 'カテゴリ編集' : 'カテゴリ追加', 'カテゴリ ' + (originalName || category.name), {
      before: before,
      after: category,
    })

    return { category: category }
  } finally {
    lock.releaseLock()
  }
}

/**
 * カテゴリの削除。商品が1件以上紐づく場合は拒否する（要件定義 6.3）。
 */
function deleteCategory(params) {
  var terminalCode = requireAuth_(params)
  var name = params && params.name
  if (typeof name !== 'string' || !name) {
    throw new ApiError('VALIDATION_ERROR', 'name は必須です')
  }

  var lock = LockService.getScriptLock()
  try {
    lock.waitLock(LOCK_WAIT_MS)
  } catch (err) {
    throw new ApiError('LOCK_TIMEOUT', 'ロックを取得できませんでした。しばらくしてから再試行してください')
  }

  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CATEGORIES_SHEET_NAME)
    var rows = categoryRows_(sheet)
    var targetIndex = -1
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].name === name) {
        targetIndex = i
        break
      }
    }
    if (targetIndex === -1) {
      throw new ApiError('VALIDATION_ERROR', '指定されたカテゴリが見つかりません: ' + name)
    }

    if (categoryHasProducts_(name)) {
      throw new ApiError('VALIDATION_ERROR', 'このカテゴリには商品が紐づいているため削除できません: ' + name)
    }

    var before = rows[targetIndex]
    sheet.deleteRow(targetIndex + 2)

    logOperation_(terminalCode, 'カテゴリ削除', 'カテゴリ ' + name, { before: before })

    return { name: name }
  } finally {
    lock.releaseLock()
  }
}

/** `商品マスタ` D列のうち `from` と一致するセルをすべて `to` に置換する */
function cascadeCategoryRename_(from, to) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PRODUCTS_SHEET_NAME)
  if (!sheet) return
  var lastRow = sheet.getLastRow()
  if (lastRow < 2) return

  var range = sheet.getRange(2, 4, lastRow - 1, 1) // D列: カテゴリ名
  var values = range.getValues()
  var changed = false
  for (var i = 0; i < values.length; i++) {
    if (values[i][0] === from) {
      values[i][0] = to
      changed = true
    }
  }
  if (changed) range.setValues(values)
}

/** 指定カテゴリに紐づく商品が1件でもあるか */
function categoryHasProducts_(categoryName) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PRODUCTS_SHEET_NAME)
  if (!sheet) return false
  var lastRow = sheet.getLastRow()
  if (lastRow < 2) return false

  var categoryNames = sheet.getRange(2, 4, lastRow - 1, 1).getValues() // D列
  for (var i = 0; i < categoryNames.length; i++) {
    if (categoryNames[i][0] === categoryName) return true
  }
  return false
}

/** 要件定義 6.3 の入力検証。カテゴリ名20文字以内 */
function validateCategoryInput_(category) {
  if (!category) throw new ApiError('VALIDATION_ERROR', 'category は必須です')

  if (typeof category.name !== 'string' || category.name.length === 0 || category.name.length > 20) {
    throw new ApiError('VALIDATION_ERROR', 'カテゴリ名は1〜20文字で指定してください')
  }
  var displayOrder = category.displayOrder === null || category.displayOrder === undefined ? '' : category.displayOrder
  var color = category.color === null || category.color === undefined ? '' : category.color

  return { name: category.name, displayOrder: displayOrder, color: color }
}

/** `カテゴリ` タブの全データ行を { name, displayOrder, color } の配列で返す */
function categoryRows_(sheet) {
  var lastRow = sheet.getLastRow()
  if (lastRow < 2) return []
  return sheet
    .getRange(2, 1, lastRow - 1, 3)
    .getValues()
    .map(function (row) {
      return { name: row[0], displayOrder: row[1], color: row[2] }
    })
}
