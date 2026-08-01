/**
 * 商品写真のエンドポイント。docs/design.md 9.3 参照（タスク21）。
 *
 * 画像の実体は Google Drive に置き、`商品マスタ` G列にはファイルIDだけを持つ。
 * スプレッドシートのセルに Base64 を埋め込む案は、セル上限（5万文字＝実質37KB）
 * と `getMasters` の肥大化のため採らなかった（design 9.1）。
 */

/** 画像を入れる Drive フォルダのIDを保持する Script Property */
var PRODUCT_IMAGE_FOLDER_PROP = 'productImageFolderId'
var PRODUCT_IMAGE_FOLDER_NAME = '売店レジ 商品画像'

/** `商品マスタ` G列（画像ID）の列番号。1始まり */
var PRODUCT_IMAGE_COLUMN = 7

/**
 * 受け付ける Base64 文字列の最大長。
 *
 * design 9.2 のとおり端末側で 320px・JPEG品質0.75 に縮小してから送るため
 * 実際は1枚20〜40KB に収まる。この上限は**改変されたクライアントから巨大な
 * 入力が来た場合の防波堤**であり、縮小そのものを保証するものではない
 * （ロック内の検証を正とする既存方針＝design 2.6 と同じ考え方）。
 * 200KB のバイナリは Base64 で約 273,067 文字になる。
 */
var PRODUCT_IMAGE_MAX_BYTES = 200 * 1024
var PRODUCT_IMAGE_MAX_BASE64_LENGTH = Math.ceil((PRODUCT_IMAGE_MAX_BYTES / 3) * 4)

var PRODUCT_IMAGE_ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp']

/**
 * 画像フォルダを用意し、IDを実行ログに出す。**Apps Script エディタから
 * 手動で実行するための入口。**
 *
 * この機能で `DriveApp` を使うようになったため OAuth スコープが増えており、
 * Web アプリからの初回呼び出しが認可エラーになることがある。エディタで
 * この関数を1度実行して承認しておけば解消する（`_` で終わる関数はエディタの
 * 実行対象に出てこないため、承認用に公開名の関数を用意している）。
 *
 * 冪等。既にフォルダがあれば作らずそのIDを返す。
 */
function setupProductImageFolder() {
  var folder = productImageFolder_()
  Logger.log('商品画像フォルダ: ' + folder.getName() + ' / ID: ' + folder.getId())
  return folder.getId()
}

/**
 * 商品写真の保存（差し替えを含む）。ロック内で
 * 「対象行を特定 → Drive に保存 → G列を更新 → 旧ファイルを破棄 → 操作ログ」を行う。
 */
function saveProductImage(params) {
  var terminalCode = requireAuth_(params)
  var no = params && params.productNo
  var imageBase64 = params && params.imageBase64
  var mimeType = params && params.mimeType

  if (typeof no !== 'number' || !Number.isInteger(no) || no < 1 || no > 99) {
    throw new ApiError('VALIDATION_ERROR', 'productNo は1〜99の整数で指定してください')
  }
  if (typeof imageBase64 !== 'string' || imageBase64.length === 0) {
    throw new ApiError('VALIDATION_ERROR', 'imageBase64 は必須です')
  }
  if (imageBase64.length > PRODUCT_IMAGE_MAX_BASE64_LENGTH) {
    throw new ApiError('VALIDATION_ERROR', '画像が大きすぎます（上限 ' + PRODUCT_IMAGE_MAX_BYTES / 1024 + 'KB）')
  }
  if (PRODUCT_IMAGE_ALLOWED_MIME_TYPES.indexOf(mimeType) === -1) {
    throw new ApiError('VALIDATION_ERROR', '対応していない画像形式です: ' + mimeType)
  }

  var lock = LockService.getScriptLock()
  try {
    lock.waitLock(LOCK_WAIT_MS)
  } catch (err) {
    throw new ApiError('LOCK_TIMEOUT', 'ロックを取得できませんでした。しばらくしてから再試行してください')
  }

  try {
    ensureCoreSheets()
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PRODUCTS_SHEET_NAME)
    var rowIndex = findProductRowIndex_(sheet, no)
    if (rowIndex === -1) {
      throw new ApiError('VALIDATION_ERROR', '指定された商品No.が見つかりません: ' + no)
    }

    var previousImageId = String(sheet.getRange(rowIndex, PRODUCT_IMAGE_COLUMN).getValue() || '')

    var decoded = Utilities.base64Decode(imageBase64)
    var blob = Utilities.newBlob(decoded, mimeType, 'product-' + no + '-' + Date.now())
    var file = productImageFolder_().createFile(blob)
    var imageId = file.getId()

    sheet.getRange(rowIndex, PRODUCT_IMAGE_COLUMN).setValue(imageId)

    // 差し替え時に古いファイルを残さない（要件定義 6.2）。
    // G列の更新が済んでから捨てる（順序を逆にすると、破棄後に書き込みが
    // 失敗した場合に「G列は古いIDのままファイルは存在しない」状態になる）
    trashImageQuietly_(previousImageId)

    logOperation_(terminalCode, '商品画像変更', '商品No.' + no, { before: previousImageId || null, after: imageId })

    return { productNo: no, imageId: imageId }
  } finally {
    lock.releaseLock()
  }
}

/** 商品写真の削除。G列を空にし、Drive のファイルを破棄する */
function deleteProductImage(params) {
  var terminalCode = requireAuth_(params)
  var no = params && params.productNo
  if (typeof no !== 'number' || !Number.isInteger(no)) {
    throw new ApiError('VALIDATION_ERROR', 'productNo は数値で指定してください')
  }

  var lock = LockService.getScriptLock()
  try {
    lock.waitLock(LOCK_WAIT_MS)
  } catch (err) {
    throw new ApiError('LOCK_TIMEOUT', 'ロックを取得できませんでした。しばらくしてから再試行してください')
  }

  try {
    ensureCoreSheets()
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PRODUCTS_SHEET_NAME)
    var rowIndex = findProductRowIndex_(sheet, no)
    if (rowIndex === -1) {
      throw new ApiError('VALIDATION_ERROR', '指定された商品No.が見つかりません: ' + no)
    }

    var previousImageId = String(sheet.getRange(rowIndex, PRODUCT_IMAGE_COLUMN).getValue() || '')
    sheet.getRange(rowIndex, PRODUCT_IMAGE_COLUMN).setValue('')
    trashImageQuietly_(previousImageId)

    logOperation_(terminalCode, '商品画像削除', '商品No.' + no, { before: previousImageId || null })

    return { productNo: no }
  } finally {
    lock.releaseLock()
  }
}

/**
 * 商品写真の取得。1件ずつ取る（design 9.3：全件まとめて返すと数MBになり、
 * 1枚差し替えただけで全件取り直しになるため）。読み取り専用のためロック不要。
 */
function getProductImage(params) {
  requireAuth_(params)
  var imageId = params && params.imageId
  if (typeof imageId !== 'string' || imageId.length === 0) {
    throw new ApiError('VALIDATION_ERROR', 'imageId は必須です')
  }

  /*
   * **`商品マスタ` G列に載っているIDだけを許可する。**
   * このチェックが無いと、認証済みの端末が任意の Drive ファイルIDを指定して
   * オーナーのドライブ内のファイルを読み出せてしまう。
   */
  if (!isRegisteredProductImageId_(imageId)) {
    throw new ApiError('VALIDATION_ERROR', '商品に紐づかない画像IDです')
  }

  var file
  try {
    file = DriveApp.getFileById(imageId)
  } catch (err) {
    // シートには載っているが実体が消えている（ゴミ箱を空にした等）。
    // 端末側はこの商品を写真なしとして扱えばよい
    throw new ApiError('VALIDATION_ERROR', '画像が見つかりません: ' + imageId)
  }

  var blob = file.getBlob()
  return {
    imageId: imageId,
    mimeType: blob.getContentType(),
    imageBase64: Utilities.base64Encode(blob.getBytes()),
  }
}

/** `商品マスタ` の該当 No. の実シート行番号（1始まり）。見つからなければ -1 */
function findProductRowIndex_(sheet, no) {
  var lastRow = sheet.getLastRow()
  if (lastRow < 2) return -1
  var values = sheet.getRange(2, 1, lastRow - 1, 1).getValues()
  for (var i = 0; i < values.length; i++) {
    if (values[i][0] === no) return i + 2
  }
  return -1
}

/** 指定の画像IDが `商品マスタ` G列のいずれかに載っているか */
function isRegisteredProductImageId_(imageId) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PRODUCTS_SHEET_NAME)
  if (!sheet) return false
  var lastRow = sheet.getLastRow()
  if (lastRow < 2) return false

  var values = sheet.getRange(2, PRODUCT_IMAGE_COLUMN, lastRow - 1, 1).getValues()
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0] || '') === imageId) return true
  }
  return false
}

/**
 * 画像の保存先フォルダ。無ければ作って Script Properties に覚える。
 * フォルダを手で消された場合も作り直せるよう、取得に失敗したら作り直す。
 */
function productImageFolder_() {
  var props = PropertiesService.getScriptProperties()
  var folderId = props.getProperty(PRODUCT_IMAGE_FOLDER_PROP)

  if (folderId) {
    try {
      var existing = DriveApp.getFolderById(folderId)
      if (!existing.isTrashed()) return existing
    } catch (err) {
      // 消された・権限が無い等。下で作り直す
    }
  }

  var folder = DriveApp.createFolder(PRODUCT_IMAGE_FOLDER_NAME)
  props.setProperty(PRODUCT_IMAGE_FOLDER_PROP, folder.getId())
  return folder
}

/**
 * 画像ファイルをゴミ箱に入れる。既に消えている・IDが空の場合は何もしない。
 * **失敗しても呼び出し元の処理は止めない**（後片付けであり、ここで例外を
 * 投げるとシート側の更新は済んでいるのにエラー応答になってしまう）。
 */
function trashImageQuietly_(imageId) {
  if (!imageId) return
  try {
    DriveApp.getFileById(imageId).setTrashed(true)
  } catch (err) {
    Logger.log('画像の破棄に失敗（無視して継続）: ' + imageId + ' / ' + err)
  }
}
