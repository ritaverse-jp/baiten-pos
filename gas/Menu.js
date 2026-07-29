/**
 * スプレッドシートのカスタムメニュー。docs/design.md 2.9・6.3・6.4・6.5 参照。
 *
 * `onOpen` はシンプルトリガーで、コンテナバインド型のプロジェクトでは関数を
 * 置くだけで自動的に有効になる（`onEdit` と同様。追加のトリガー登録は不要）。
 * `onOpen` という名前の関数もスクリプト全体で1つしか持てない。
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('売店レジ 管理')
    .addItem('選択した端末を無効化', 'disableSelectedTerminal_')
    .addItem('選択した端末のキャッシュを破棄', 'clearSelectedTerminalCache_')
    .addSeparator()
    .addItem('全端末のトークンを一斉失効', 'revokeAllTokens_')
    .addToUi()
}

/**
 * 「この端末を無効化」（design 6.3）。`端末` タブで対象行を選択してから実行する。
 * 状態を `無効` にし、トークン実体を破壊的に削除する（`revokeTerminalToken_`。
 * design 6.3）。ここはメニューからの実行＝スクリプト経由の書き換えのため、
 * `onEdit` は発火しない。したがって cache 破棄・トークン削除をこの関数自身で
 * 明示的に行う（design 6.4 が言う「カスタムメニューから無効化 → 同一処理内で
 * キャッシュを削除」はこの経路を指す）。
 */
function disableSelectedTerminal_() {
  var ui = SpreadsheetApp.getUi()
  var terminal = selectedTerminal_(ui)
  if (!terminal) return

  var response = ui.alert(
    '端末の無効化',
    '端末 "' + terminal.code + '" を無効化します。この端末は次回利用時に PIN での再ログインが必要になります。よろしいですか？',
    ui.ButtonSet.YES_NO,
  )
  if (response !== ui.Button.YES) return

  terminal.sheet.getRange(terminal.row, 4).setValue('無効') // D列: 状態
  revokeTerminalToken_(terminal.code)
  logOperation_('(管理者)', '端末無効化', '端末コード ' + terminal.code, { via: 'menu' })

  ui.alert('端末 "' + terminal.code + '" を無効化しました。')
}

/**
 * 「選択した端末のキャッシュを破棄」。状態やトークンには触れず、キャッシュ
 * だけを即時破棄する運用ツール。トラブルシューティング用（例：シート上は
 * 有効に見えるのにリクエストが弾かれる、といった食い違いの解消）。
 */
function clearSelectedTerminalCache_() {
  var ui = SpreadsheetApp.getUi()
  var terminal = selectedTerminal_(ui)
  if (!terminal) return

  invalidateTerminalStatusCache_(terminal.code)
  ui.alert('端末 "' + terminal.code + '" のキャッシュを破棄しました。次回のリクエストからシートの現在値が反映されます。')
}

/**
 * 「全端末のトークンを一斉失効」（design 6.5）。どの端末が紛失したか特定
 * できない場合に、`tokenEpoch` を進めて発行済みの全トークンを一括で
 * 無効化する。`端末` タブの状態列には触れない（有効端末はそのまま次回
 * PIN 再ログインでアクセスを再開できる）。
 */
function revokeAllTokens_() {
  var ui = SpreadsheetApp.getUi()
  var response = ui.alert(
    '全端末の一斉失効',
    '発行済みの全端末のトークンを無効化します。各端末は次回利用時に PIN での再ログインが必要になります。よろしいですか？',
    ui.ButtonSet.YES_NO,
  )
  if (response !== ui.Button.YES) return

  var props = PropertiesService.getScriptProperties()
  var epoch = Number(props.getProperty(TOKEN_EPOCH_PROP) || '0')
  props.setProperty(TOKEN_EPOCH_PROP, String(epoch + 1))

  logOperation_('(管理者)', '端末無効化', '全端末', { via: 'menu', reason: '一斉失効' })

  ui.alert('全端末のトークンを失効しました。')
}

/**
 * `端末` タブでユーザーが選択している行から端末情報を取得する。
 * タブ違い・見出し行選択・端末コード空欄はアラートを出して null を返す。
 */
function selectedTerminal_(ui) {
  var activeSheet = SpreadsheetApp.getActiveSheet()
  if (activeSheet.getName() !== TERMINAL_SHEET_NAME) {
    ui.alert('「' + TERMINAL_SHEET_NAME + '」タブで対象の端末の行を選択してから実行してください。')
    return null
  }

  var row = activeSheet.getActiveCell().getRow()
  if (row < 2) {
    ui.alert('端末の行を選択してから実行してください（見出し行は選択できません）。')
    return null
  }

  var code = activeSheet.getRange(row, 1).getValue()
  if (!code) {
    ui.alert('選択した行に端末コードがありません。')
    return null
  }

  return { sheet: activeSheet, row: row, code: code }
}
