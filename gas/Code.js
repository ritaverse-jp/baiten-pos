/**
 * doGet / doPost ルーター、共通レスポンス整形、認証・端末状態検証の共通処理。
 * docs/design.md 2章・6章参照。
 *
 * 言語は素の JavaScript（TypeScript は使わない。docs/design.md 2.9）。
 * このファイルを含む gas/ 配下の全ファイルは GAS の仕様によりグローバル
 * スコープを共有する（import/export は使わない）。
 */

var TOKEN_PROP_PREFIX = 'token_'
var TOKEN_EPOCH_PROP = 'tokenEpoch'
var TERMINAL_SHEET_NAME = '端末'
var TERMINAL_STATUS_CACHE_PREFIX = 'terminalStatus_'
var TERMINAL_STATUS_CACHE_SECONDS = 60

function doGet(e) {
  return handleRequest_(e, 'GET')
}

function doPost(e) {
  return handleRequest_(e, 'POST')
}

/**
 * ルーティング本体。action で分岐する（design 2.1）。
 * GET は `ping` など認証不要の疎通確認専用とする。認証つきの呼び出しは
 * すべて POST に寄せる（GET だとトークンが実行ログに残るため。design 2.1）。
 */
function handleRequest_(e, method) {
  try {
    var params = parseRequestParams_(e, method)
    var action = params.action

    switch (action) {
      case 'ping':
        return respondOk_({ pong: true, now: new Date().toISOString() })
      case 'getMasters':
        return respondOk_(getMasters(params))
      case 'appendSales':
        return respondOk_(appendSales(params))
      case 'getTodayMaxSeq':
        return respondOk_(getTodayMaxSeq(params))
      case 'registerTerminal':
        return respondOk_(registerTerminal(params))
      case 'login':
        return respondOk_(login(params))
      case 'refreshToken':
        return respondOk_(refreshToken(params))
      case 'renameTerminal':
        return respondOk_(renameTerminal(params))
      case 'saveProduct':
        return respondOk_(saveProduct(params))
      case 'deleteProduct':
        return respondOk_(deleteProduct(params))
      case 'saveCategory':
        return respondOk_(saveCategory(params))
      case 'deleteCategory':
        return respondOk_(deleteCategory(params))
      case 'getSalesHistory':
        return respondOk_(getSalesHistory(params))
      case 'cancelSale':
        return respondOk_(cancelSale(params))
      default:
        throw new ApiError('VALIDATION_ERROR', '不明な action です: ' + action)
    }
  } catch (err) {
    if (err instanceof ApiError) {
      return respondError_(err.code, err.message)
    }
    // 想定外のエラーはスタックトレースを飲み込まず実行ログに残しつつ、
    // クライアントには内部情報を漏らさない
    Logger.log(err && err.stack ? err.stack : err)
    return respondError_('VALIDATION_ERROR', 'リクエストを処理できませんでした')
  }
}

/**
 * POST は `Content-Type: text/plain` で送られた JSON 文字列を手動でパースする
 * （GAS はプリフライトに応答できないため。design 2.1）。GET はクエリ文字列を使う
 * （`ping` の疎通確認専用）。
 */
function parseRequestParams_(e, method) {
  if (method === 'GET') {
    return (e && e.parameter) || {}
  }

  var raw = e && e.postData && e.postData.contents
  if (!raw) return {}

  try {
    return JSON.parse(raw)
  } catch (err) {
    throw new ApiError('VALIDATION_ERROR', 'リクエストボディを JSON として解釈できません')
  }
}

function respondOk_(data) {
  return jsonOutput_({ ok: true, data: data })
}

function respondError_(code, message) {
  return jsonOutput_({ ok: false, error: { code: code, message: message } })
}

function jsonOutput_(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON)
}

/** design 2.1 のエラーコードを運ぶ例外。ハンドラの catch で `err instanceof ApiError` として拾う */
function ApiError(code, message) {
  this.code = code
  this.message = message
}
ApiError.prototype = Object.create(Error.prototype)
ApiError.prototype.constructor = ApiError

/**
 * トークン認証。design 6.3 の検証順を実装する：
 * トークン → ハッシュ照合 → 端末コード特定 → 端末タブの状態 → 有効期限 → トークンエポック
 *
 * 成功時は検証済みの端末コードを返す。失敗時は該当する ApiError を投げる。
 */
function requireAuth_(params) {
  var token = params && params.apiToken
  var terminalCode = params && params.terminalCode
  if (!token || !terminalCode) {
    throw new ApiError('UNAUTHORIZED', 'apiToken と terminalCode は必須です')
  }

  var props = PropertiesService.getScriptProperties()
  var raw = props.getProperty(TOKEN_PROP_PREFIX + terminalCode)
  if (!raw) {
    throw new ApiError('UNAUTHORIZED', 'トークンが無効です')
  }

  var record = JSON.parse(raw)
  if (sha256Hex_(token) !== record.hash) {
    throw new ApiError('UNAUTHORIZED', 'トークンが無効です')
  }

  var currentEpoch = Number(props.getProperty(TOKEN_EPOCH_PROP) || '0')
  if ((record.epoch || 0) !== currentEpoch) {
    throw new ApiError('UNAUTHORIZED', 'トークンが失効しています')
  }

  if (new Date(record.expiresAt).getTime() < Date.now()) {
    throw new ApiError('TOKEN_EXPIRED', 'トークンの有効期限が切れています')
  }

  var status = getTerminalStatus_(terminalCode)
  if (status === TERMINAL_STATUS_NOT_REGISTERED) {
    // トークンのハッシュ（Script Properties）は有効なのに `端末` タブに行が無い状態。
    // 管理者による無効化とは復旧手段が違うため別コードで返す（設定画面が
    // 「登録をやり直す」導線を出す）
    throw new ApiError(
      'TERMINAL_NOT_REGISTERED',
      'この端末の登録情報が見つかりません。設定画面から登録をやり直してください',
    )
  }
  if (status !== '有効') {
    throw new ApiError('TERMINAL_DISABLED', 'この端末は無効化されています')
  }

  return terminalCode
}

/**
 * SHA-256 の16進ハッシュ。トークン・PIN の両方の保存に使う汎用関数
 * （design 6.2：どちらも実体を保存せずハッシュのみ保持する）。
 */
function sha256Hex_(value) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value)
  return bytes
    .map(function (b) {
      return ((b < 0 ? b + 256 : b) & 0xff).toString(16).padStart(2, '0')
    })
    .join('')
}

/**
 * `端末` タブから該当行を探す。見つからなければ null。
 * `getTerminalStatus_`・`Auth.js` の各エンドポイントから共通で使う。
 */
function findTerminalRow_(terminalCode) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TERMINAL_SHEET_NAME)
  if (!sheet) return null

  var lastRow = sheet.getLastRow()
  if (lastRow < 2) return null

  var values = sheet.getRange(2, 1, lastRow - 1, 4).getValues() // A:コード B:名前 C:登録日時 D:状態
  for (var i = 0; i < values.length; i++) {
    if (values[i][0] === terminalCode) {
      return { rowIndex: i + 2, name: values[i][1], status: values[i][3] }
    }
  }
  return null
}

/**
 * `端末` タブの状態を返す。60秒キャッシュする（design 6.4）。
 *
 * **「該当コードの行が無い」と「行はあるが状態が `無効`」を区別して返す。**
 * どちらもアクセスは拒否する（存在しない端末を有効扱いしない）が、利用者から
 * 見た意味と復旧手段が違う：前者は登録をやり直せば直り、後者は管理者が
 * 意図的に止めているため利用者側では直せない。以前はどちらも `無効` に
 * 畳んでいたため、`端末` タブの行が失われた端末が「無効化されています」と
 * だけ表示され、復旧手段の無い行き止まりになっていた（2026-07-31 に実際に発生）。
 */
var TERMINAL_STATUS_NOT_REGISTERED = '(未登録)'

function getTerminalStatus_(terminalCode) {
  var cache = CacheService.getScriptCache()
  var cacheKey = TERMINAL_STATUS_CACHE_PREFIX + terminalCode
  var cached = cache.get(cacheKey)
  if (cached !== null) return cached

  var terminal = findTerminalRow_(terminalCode)
  var status = terminal ? terminal.status : TERMINAL_STATUS_NOT_REGISTERED

  cache.put(cacheKey, status, TERMINAL_STATUS_CACHE_SECONDS)
  return status
}

/**
 * 端末状態のキャッシュを即時破棄する。カスタムメニューからの操作（Menu.js）と
 * `onEdit`（本ファイル）の両方から呼ばれる。
 */
function invalidateTerminalStatusCache_(terminalCode) {
  CacheService.getScriptCache().remove(TERMINAL_STATUS_CACHE_PREFIX + terminalCode)
}

/**
 * 端末の無効化を破壊的に行う（design 6.3）。トークンハッシュの Script Property
 * 自体を削除し、キャッシュも破棄する。フラグ（`端末` タブ D列）を戻すだけでは
 * アクセスが復活しないようにするための処理であり、状態が `無効` になる経路
 * （手編集の `onEdit`・カスタムメニューの無効化操作）の両方から呼ぶこと。
 */
function revokeTerminalToken_(terminalCode) {
  PropertiesService.getScriptProperties().deleteProperty(TOKEN_PROP_PREFIX + terminalCode)
  invalidateTerminalStatusCache_(terminalCode)
}

/**
 * シンプルトリガー。`端末` タブが手編集された行の端末コードについて、
 * 状態キャッシュを即時破棄する（design 6.4 の「シートを手編集」経路）。
 * 状態列（D列）が `無効` に変更された場合は、トークン実体も破壊的に削除する
 * （design 6.3）。コンテナバインド型のプロジェクトでは `onEdit` という名前の
 * 関数を置くだけで自動的に有効になり、追加のトリガー登録は不要。
 *
 * 複数行にまたがる編集（貼り付け等）にも対応する。
 *
 * 【重要】スクリプト経由（SpreadsheetApp API）でのセル書き換えは、この
 * シンプルトリガーを発火させない。カスタムメニューからの無効化操作（Menu.js）
 * では、この関数を経由せず自前で `revokeTerminalToken_` を呼ぶ必要がある。
 *
 * 【重要】GAS はスクリプト全体で `onEdit` という名前の関数を1つしか実行できない。
 * 将来 `端末` タブ以外の編集にも反応させたくなった場合は、この関数の中に
 * 分岐を足すこと。新しい `onEdit` を別ファイルに作らない。
 */
function onEdit(e) {
  if (!e || !e.range) return
  var sheet = e.range.getSheet()
  if (sheet.getName() !== TERMINAL_SHEET_NAME) return

  var startRow = e.range.getRow()
  var startCol = e.range.getColumn()
  var numRows = e.range.getNumRows()
  var numCols = e.range.getNumColumns()
  var touchesStatusColumn = startCol <= 4 && startCol + numCols - 1 >= 4 // D列: 状態

  for (var offset = 0; offset < numRows; offset++) {
    var row = startRow + offset
    if (row < 2) continue // ヘッダー行は無視
    var terminalCode = sheet.getRange(row, 1).getValue()
    if (!terminalCode) continue

    if (touchesStatusColumn && sheet.getRange(row, 4).getValue() === '無効') {
      revokeTerminalToken_(terminalCode)
      logOperation_('(シート編集)', '端末無効化', '端末コード ' + terminalCode, { via: 'onEdit' })
    } else {
      invalidateTerminalStatusCache_(terminalCode)
    }
  }
}

/**
 * `操作ログ` タブへの追記。NF-07（マスタ編集・削除、会計取消の操作ログ記録）。
 * 単発の管理操作向けであり、appendSales のような高頻度バッチではないため
 * `appendRow` で十分（design 2.4 の setValues 一括方針は対象外）。
 */
function logOperation_(terminalCode, type, target, detail) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('操作ログ')
  if (!sheet) return
  sheet.appendRow([new Date().toISOString(), terminalCode, type, target, JSON.stringify(detail || {})])
}
