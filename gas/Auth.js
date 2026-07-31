/**
 * `registerTerminal`・`login`・`refreshToken`。docs/design.md 2.5・6章参照。
 */

var PIN_HASH_PROP = 'pinHash'
var PIN_FAIL_PREFIX = 'pinFail_'
var PIN_MAX_ATTEMPTS = 5
var PIN_LOCK_SECONDS = 15 * 60
var PIN_REGISTER_RATE_LIMIT_KEY = '__register__'
var TOKEN_TTL_DAYS = 90
var TERMINAL_CODE_PATTERN = /^[A-Z]{1,4}$/
var TERMINAL_CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

/**
 * 端末登録。design 2.5「registerTerminal」・5.4「端末コードの一意性は
 * このロックだけで保証される」を実装する。
 *
 * 空きコードの採番（希望コードの重複確認を含む）はロック内で行う。ここが
 * 複数台運用における採番の一意性の唯一の保証点であり、ロックの外に出すと
 * 2端末がほぼ同時に登録した場合にコードが重複しうる。
 */
function registerTerminal(params) {
  var pin = params && params.pin
  var terminalName = params && params.terminalName
  var requestedCode = params && params.requestedCode

  if (!pin || !terminalName) {
    throw new ApiError('VALIDATION_ERROR', 'pin と terminalName は必須です')
  }
  if (requestedCode && !TERMINAL_CODE_PATTERN.test(requestedCode)) {
    throw new ApiError('VALIDATION_ERROR', '端末コードは英大文字1〜4文字で指定してください')
  }

  // 端末登録の時点ではまだ端末コードが存在しないため、専用の固定キーで
  // PIN総当たりを制限する（login は端末コード別。design 6.7）
  verifyPin_(pin, PIN_REGISTER_RATE_LIMIT_KEY)

  var lock = LockService.getScriptLock()
  try {
    lock.waitLock(LOCK_WAIT_MS)
  } catch (err) {
    throw new ApiError('LOCK_TIMEOUT', 'ロックを取得できませんでした。しばらくしてから再試行してください')
  }

  try {
    ensureCoreSheets()
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TERMINAL_SHEET_NAME)
    var existingCodes = readTerminalCodes_(sheet)

    var terminalCode
    if (requestedCode) {
      if (existingCodes.indexOf(requestedCode) !== -1) {
        throw new ApiError('DUPLICATE_KEY', 'この端末コードは既に使用されています: ' + requestedCode)
      }
      terminalCode = requestedCode
    } else {
      terminalCode = allocateTerminalCode_(existingCodes)
    }

    sheet.appendRow([terminalCode, terminalName, new Date().toISOString(), '有効', ''])

    var issued = issueToken_(terminalCode)
    logOperation_(terminalCode, '端末登録', '端末コード ' + terminalCode, { terminalName: terminalName })

    return {
      terminalCode: terminalCode,
      terminalName: terminalName,
      apiToken: issued.token,
      expiresAt: issued.expiresAt,
    }
  } finally {
    lock.releaseLock()
  }
}

/**
 * 既存端末の再認証。トークンを再発行する。ロック不要（Script Property の
 * 上書きは単一キーの置換であり、read-modify-write の競合が生じないため。
 * design 2.2）。
 */
function login(params) {
  var pin = params && params.pin
  var terminalCode = params && params.terminalCode
  if (!pin || !terminalCode) {
    throw new ApiError('VALIDATION_ERROR', 'pin と terminalCode は必須です')
  }

  verifyPin_(pin, terminalCode)

  var terminal = findTerminalRow_(terminalCode)
  if (!terminal || terminal.status !== '有効') {
    // 無効な端末は再ログインもできない（design 6.3）
    throw new ApiError('TERMINAL_DISABLED', 'この端末は登録されていないか無効化されています')
  }

  var issued = issueToken_(terminalCode)

  return {
    terminalCode: terminalCode,
    terminalName: terminal.name,
    apiToken: issued.token,
    expiresAt: issued.expiresAt,
  }
}

/**
 * 有効期限の巻き直し。現行の有効なトークンで認証する（PIN 不要。design 6.5）。
 */
function refreshToken(params) {
  var terminalCode = requireAuth_(params)
  var terminal = findTerminalRow_(terminalCode)
  var issued = issueToken_(terminalCode)

  return {
    terminalCode: terminalCode,
    terminalName: terminal ? terminal.name : '',
    apiToken: issued.token,
    expiresAt: issued.expiresAt,
  }
}

/**
 * 端末名の変更（`端末` タブ B列。design 1.4）。現行の有効なトークンで
 * 認証する（PIN 不要。表示用の名称変更でしかなく、端末コード・認証には
 * 影響しないため）。
 */
function renameTerminal(params) {
  var terminalCode = requireAuth_(params)
  var terminalName = params && params.terminalName
  if (typeof terminalName !== 'string' || terminalName.trim().length === 0) {
    throw new ApiError('VALIDATION_ERROR', '端末名は必須です')
  }

  var lock = LockService.getScriptLock()
  try {
    lock.waitLock(LOCK_WAIT_MS)
  } catch (err) {
    throw new ApiError('LOCK_TIMEOUT', 'ロックを取得できませんでした。しばらくしてから再試行してください')
  }

  try {
    var terminal = findTerminalRow_(terminalCode)
    if (!terminal) {
      throw new ApiError('VALIDATION_ERROR', '端末が見つかりません: ' + terminalCode)
    }

    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TERMINAL_SHEET_NAME)
    sheet.getRange(terminal.rowIndex, 2).setValue(terminalName) // B列: 端末名

    logOperation_(terminalCode, '端末名変更', '端末コード ' + terminalCode, { before: terminal.name, after: terminalName })

    return { terminalCode: terminalCode, terminalName: terminalName }
  } finally {
    lock.releaseLock()
  }
}

/**
 * PIN 検証と総当たり対策（design 6.7）。5回失敗で15分ロックする。
 * `rateLimitKey` は login では端末コード、registerTerminal では
 * 端末コードがまだ存在しないため固定のキーを使う。
 */
function verifyPin_(pin, rateLimitKey) {
  var cache = CacheService.getScriptCache()
  var failKey = PIN_FAIL_PREFIX + rateLimitKey
  var fails = Number(cache.get(failKey) || '0')
  if (fails >= PIN_MAX_ATTEMPTS) {
    throw new ApiError('PIN_LOCKED', 'PINの入力に複数回失敗したため、しばらくしてから再試行してください')
  }

  var pinHash = PropertiesService.getScriptProperties().getProperty(PIN_HASH_PROP)
  if (!pinHash) {
    throw new ApiError('VALIDATION_ERROR', 'PINが未設定です。管理者に確認してください')
  }

  if (sha256Hex_(pin) !== pinHash) {
    cache.put(failKey, String(fails + 1), PIN_LOCK_SECONDS)
    throw new ApiError('UNAUTHORIZED', 'PINが正しくありません')
  }

  cache.remove(failKey)
}

/**
 * PIN を設定・変更する。管理者専用（HTTP ルーターには載せない。Apps Script
 * エディタから直接呼ぶ、またはカスタムメニューから呼ぶ想定。タスク10）。
 *
 * PIN 変更時はトークンエポックを進め、発行済みの全トークンを一斉失効させる
 * （design 6.5：「PIN変更時も同時にエポックを進める」）。
 */
function setPin_(pin) {
  if (!/^[0-9]{4,8}$/.test(pin)) {
    throw new Error('PINは4〜8桁の数字にしてください')
  }
  var props = PropertiesService.getScriptProperties()
  props.setProperty(PIN_HASH_PROP, sha256Hex_(pin))

  var epoch = Number(props.getProperty(TOKEN_EPOCH_PROP) || '0')
  props.setProperty(TOKEN_EPOCH_PROP, String(epoch + 1))
}

/** トークンを発行し、Script Properties にハッシュだけを保存する（design 6.2） */
function issueToken_(terminalCode) {
  var token = generateRandomToken_()
  var props = PropertiesService.getScriptProperties()
  var expiresAt = new Date(Date.now() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString()
  var epoch = Number(props.getProperty(TOKEN_EPOCH_PROP) || '0')

  props.setProperty(
    TOKEN_PROP_PREFIX + terminalCode,
    JSON.stringify({ hash: sha256Hex_(token), expiresAt: expiresAt, epoch: epoch }),
  )

  return { token: token, expiresAt: expiresAt }
}

/** UUID を2つ連結し、256ビット相当のエントロピーを持つ不透明トークンを作る */
function generateRandomToken_() {
  return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '')
}

function readTerminalCodes_(sheet) {
  var lastRow = sheet.getLastRow()
  if (lastRow < 2) return []
  return sheet
    .getRange(2, 1, lastRow - 1, 1)
    .getValues()
    .map(function (row) {
      return row[0]
    })
}

/** A→B→C…の空き最小コードを返す（design 2.5） */
function allocateTerminalCode_(existingCodes) {
  var used = {}
  existingCodes.forEach(function (code) {
    used[code] = true
  })
  for (var i = 0; i < TERMINAL_CODE_ALPHABET.length; i++) {
    var candidate = TERMINAL_CODE_ALPHABET[i]
    if (!used[candidate]) return candidate
  }
  throw new ApiError('VALIDATION_ERROR', '空いている端末コードがありません（A〜Zをすべて使用中です）')
}
