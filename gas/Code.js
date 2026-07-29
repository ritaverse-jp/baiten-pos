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
 *
 * 現時点（タスク7）では registerTerminal（タスク9）がまだ存在せず、
 * トークンを発行する手段がないため、あらゆる呼び出しが UNAUTHORIZED になる
 * のが正しい挙動である。
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
  if (hashToken_(token) !== record.hash) {
    throw new ApiError('UNAUTHORIZED', 'トークンが無効です')
  }

  var currentEpoch = Number(props.getProperty(TOKEN_EPOCH_PROP) || '0')
  if ((record.epoch || 0) !== currentEpoch) {
    throw new ApiError('UNAUTHORIZED', 'トークンが失効しています')
  }

  if (new Date(record.expiresAt).getTime() < Date.now()) {
    throw new ApiError('TOKEN_EXPIRED', 'トークンの有効期限が切れています')
  }

  if (getTerminalStatus_(terminalCode) !== '有効') {
    throw new ApiError('TERMINAL_DISABLED', 'この端末は無効化されています')
  }

  return terminalCode
}

function hashToken_(token) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token)
  return bytes
    .map(function (b) {
      return ((b < 0 ? b + 256 : b) & 0xff).toString(16).padStart(2, '0')
    })
    .join('')
}

/**
 * `端末` タブの状態を返す。60秒キャッシュする（design 6.4）。
 * タブが存在しない・該当コードの行がない場合は `無効` として扱う
 * （安全側に倒す。存在しない端末を有効扱いしない）。
 */
function getTerminalStatus_(terminalCode) {
  var cache = CacheService.getScriptCache()
  var cacheKey = TERMINAL_STATUS_CACHE_PREFIX + terminalCode
  var cached = cache.get(cacheKey)
  if (cached !== null) return cached

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TERMINAL_SHEET_NAME)
  var status = '無効'
  if (sheet) {
    var lastRow = sheet.getLastRow()
    if (lastRow >= 2) {
      var values = sheet.getRange(2, 1, lastRow - 1, 4).getValues() // A:端末コード, D:状態
      for (var i = 0; i < values.length; i++) {
        if (values[i][0] === terminalCode) {
          status = values[i][3]
          break
        }
      }
    }
  }

  cache.put(cacheKey, status, TERMINAL_STATUS_CACHE_SECONDS)
  return status
}

/**
 * 端末状態のキャッシュを即時破棄する。カスタムメニューからの無効化操作・
 * `端末` タブの手編集（onEdit）から呼ぶ想定（design 6.4。タスク10で配線）。
 */
function invalidateTerminalStatusCache_(terminalCode) {
  CacheService.getScriptCache().remove(TERMINAL_STATUS_CACHE_PREFIX + terminalCode)
}
