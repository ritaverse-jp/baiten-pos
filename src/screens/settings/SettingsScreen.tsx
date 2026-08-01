import { useEffect, useState } from 'react'
import { getConfig, saveConfig } from '@/data/db/config'
import { getAllPendingSales } from '@/data/db/pendingQueue'
import { login, ping, registerTerminal, renameTerminal } from '@/data/gas/endpoints'
import { runSync } from '@/data/sync/engine'
import { saleLinesTotal } from '@/domain/calc'
import { pendingSalesToCsv } from '@/domain/csv'
import { formatDate, formatYen } from '@/domain/format'
import {
  GAS_URL_ERROR_MESSAGES,
  PIN_ERROR_MESSAGES,
  TERMINAL_NAME_ERROR_MESSAGES,
  validateGasUrl,
  validatePin,
  validateTerminalName,
} from '@/domain/settings'
import type { AppConfig, PendingSale } from '@/domain/types'
import { useSyncStore } from '@/state/syncStore'
import styles from './SettingsScreen.module.css'

interface SettingsScreenProps {
  onBack: () => void
}

/**
 * SC-06 設定・初回セットアップ。要件定義 NF-05・docs/design.md 5.4・6章。
 *
 * GAS URL が未設定 → 端末未登録 → 登録済み、の順で必要なセクションだけを
 * 出し分ける「ウィザード」形式にしている（design task19「端末登録ウィザード」）。
 * 登録済みになった後も GAS URL は変更可能なまま残す。
 *
 * `syncStore.blockedBy` に応じて、通常時とは異なる導線を出す：
 * - `tokenExpired`：PIN 再ログイン（`login`）。成功後は自動で同期を再開する（design 6.6）
 * - `terminalDisabled`：同期は恒久停止のため、未送信データの CSV エクスポート経路を出す（design 6.6）
 */
export default function SettingsScreen({ onBack }: SettingsScreenProps) {
  const connection = useSyncStore((s) => s.connection)
  const blockedBy = useSyncStore((s) => s.blockedBy)
  const syncing = useSyncStore((s) => s.syncing)

  const [config, setConfig] = useState<AppConfig | null>(null)
  const [pendingSales, setPendingSales] = useState<PendingSale[]>([])
  const [loading, setLoading] = useState(false)

  const [gasUrlInput, setGasUrlInput] = useState('')
  const [gasUrlError, setGasUrlError] = useState<string | null>(null)
  const [gasUrlChecking, setGasUrlChecking] = useState(false)
  const [gasUrlResult, setGasUrlResult] = useState<{ ok: boolean; message: string } | null>(null)

  const [terminalName, setTerminalName] = useState('')
  const [registerPin, setRegisterPin] = useState('')
  const [registerError, setRegisterError] = useState<string | null>(null)
  const [registering, setRegistering] = useState(false)

  const [reLoginPin, setReLoginPin] = useState('')
  const [reLoginError, setReLoginError] = useState<string | null>(null)
  const [reLoginSubmitting, setReLoginSubmitting] = useState(false)

  const [renameInput, setRenameInput] = useState('')
  const [renameError, setRenameError] = useState<string | null>(null)
  const [renaming, setRenaming] = useState(false)

  const load = async () => {
    setLoading(true)
    const [nextConfig, nextPending] = await Promise.all([getConfig(), getAllPendingSales()])
    setConfig(nextConfig)
    setGasUrlInput(nextConfig.gasUrl ?? '')
    setRenameInput(nextConfig.terminalName ?? '')
    setPendingSales(nextPending)
    setLoading(false)
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSaveGasUrl = async () => {
    const error = validateGasUrl(gasUrlInput)
    if (error) {
      setGasUrlError(GAS_URL_ERROR_MESSAGES[error])
      setGasUrlResult(null)
      return
    }
    setGasUrlError(null)
    await saveConfig({ gasUrl: gasUrlInput })

    setGasUrlChecking(true)
    const result = await ping(gasUrlInput)
    setGasUrlChecking(false)
    setGasUrlResult(result.ok ? { ok: true, message: '接続を確認しました' } : { ok: false, message: result.error.message })

    await load()
  }

  const handleRegister = async () => {
    const nameError = validateTerminalName(terminalName)
    const pinError = validatePin(registerPin)
    if (nameError) {
      setRegisterError(TERMINAL_NAME_ERROR_MESSAGES[nameError])
      return
    }
    if (pinError) {
      setRegisterError(PIN_ERROR_MESSAGES[pinError])
      return
    }
    setRegisterError(null)
    setRegistering(true)
    const result = await registerTerminal({ pin: registerPin, terminalName })
    setRegistering(false)
    if (!result.ok) {
      setRegisterError(result.error.message)
      return
    }

    await saveConfig({
      terminalCode: result.data.terminalCode,
      terminalName: result.data.terminalName,
      apiToken: result.data.apiToken,
      tokenExpiresAt: result.data.expiresAt,
    })
    setRegisterPin('')
    await load()
  }

  const handleRelogin = async () => {
    if (!config?.terminalCode) return
    const pinError = validatePin(reLoginPin)
    if (pinError) {
      setReLoginError(PIN_ERROR_MESSAGES[pinError])
      return
    }
    setReLoginError(null)
    setReLoginSubmitting(true)
    const result = await login({ pin: reLoginPin, terminalCode: config.terminalCode })
    setReLoginSubmitting(false)
    if (!result.ok) {
      setReLoginError(result.error.message)
      return
    }

    await saveConfig({ apiToken: result.data.apiToken, tokenExpiresAt: result.data.expiresAt })
    useSyncStore.getState().setBlockedBy(null)
    setReLoginPin('')
    await load()
    // design 6.6：「成功後に自動で同期再開」
    void runSync()
  }

  /** 端末名の変更（`端末` タブ B列。design 1.4）。表示用の名称変更のみで PIN は不要 */
  const handleRename = async () => {
    const error = validateTerminalName(renameInput)
    if (error) {
      setRenameError(TERMINAL_NAME_ERROR_MESSAGES[error])
      return
    }
    setRenameError(null)
    setRenaming(true)
    const result = await renameTerminal(renameInput)
    setRenaming(false)
    if (!result.ok) {
      setRenameError(result.error.message)
      return
    }

    await saveConfig({ terminalName: result.data.terminalName })
    await load()
  }

  /**
   * 端末登録のやり直し（リセット）。ローカルの端末登録情報だけを消去し、
   * GAS URL は残す。`config.terminalCode`/`apiToken` が無くなることで
   * `step` が自動的に `'register'` に戻り、登録ウィザードを最初からやり直せる。
   *
   * トークンが端末タブの行と食い違って `TERMINAL_DISABLED` から抜け出せなく
   * なった場合の復旧手段としても使う（登録済みのつもりが実際には端末タブに
   * 行が無い状態になっていたケースがあったため用意した）。GAS 側のトークン
   * 実体・端末タブの行はそのまま残るため、後片付けが必要な場合は別途行うこと。
   */
  const handleResetRegistration = async () => {
    if (!window.confirm('この端末の登録情報を消去し、登録をやり直します。よろしいですか？')) return
    await saveConfig({ terminalCode: null, terminalName: null, apiToken: null, tokenExpiresAt: null })
    useSyncStore.getState().setBlockedBy(null)
    setRegisterPin('')
    setRegisterError(null)
    await load()
  }

  const handleForceSync = async () => {
    await runSync({ force: true })
    await load()
  }

  const handleExportCsv = () => {
    const csv = pendingSalesToCsv(pendingSales)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const today = new Date().toISOString().slice(0, 10)
    a.href = url
    a.download = `未送信データ_${config?.terminalCode ?? '端末'}_${today}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (!config) {
    return (
      <main className={styles.screen}>
        <p className={styles.emptyMessage}>読み込み中…</p>
      </main>
    )
  }

  const step: 'gasUrl' | 'register' | 'ready' = !config.gasUrl ? 'gasUrl' : !config.terminalCode || !config.apiToken ? 'register' : 'ready'

  return (
    <main className={styles.screen}>
      <header className={styles.header}>
        <div className={styles.headerTitleGroup}>
          <button type="button" className={styles.backButton} onClick={onBack} aria-label="会計画面に戻る">
            戻る
          </button>
          <h1 className={styles.headerTitle}>設定</h1>
        </div>
        <span
          className={`${styles.connectionBadge} ${connection === 'online' ? styles.connectionOnline : styles.connectionOffline}`}
          data-testid="connection-badge"
        >
          {connection === 'online' ? 'オンライン' : 'オフライン'}
        </span>
      </header>

      <div className={styles.toolbar}>
        <button type="button" onClick={() => void load()} disabled={loading}>
          再読み込み
        </button>
      </div>

      <div className={styles.body}>
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>GAS Web アプリ URL</h2>
          <p className={styles.sectionDescription}>
            スプレッドシートに紐づく GAS Web アプリの URL を設定します（https:// で始まる URL。NF-06）。
          </p>
          <div className={styles.formField}>
            <label htmlFor="gas-url">URL</label>
            <input
              id="gas-url"
              type="text"
              value={gasUrlInput}
              onChange={(e) => setGasUrlInput(e.target.value)}
              placeholder="https://script.google.com/macros/s/.../exec"
            />
          </div>
          {gasUrlError && (
            <p className={styles.errorText} role="alert">
              {gasUrlError}
            </p>
          )}
          {gasUrlResult && (
            <p className={gasUrlResult.ok ? styles.successText : styles.errorText} role={gasUrlResult.ok ? 'status' : 'alert'}>
              {gasUrlResult.message}
            </p>
          )}
          <button type="button" className={styles.primaryButton} onClick={() => void handleSaveGasUrl()} disabled={gasUrlChecking}>
            {gasUrlChecking ? '接続確認中…' : '保存して接続確認'}
          </button>
        </section>

        {step === 'register' && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>端末登録</h2>
            <p className={styles.sectionDescription}>PIN と端末名を入力し、この端末を登録してください（初回のみ）。</p>
            <div className={styles.formField}>
              <label htmlFor="terminal-name">端末名</label>
              <input
                id="terminal-name"
                type="text"
                value={terminalName}
                onChange={(e) => setTerminalName(e.target.value)}
                placeholder="レジ1"
              />
            </div>
            <div className={styles.formField}>
              <label htmlFor="register-pin">PIN</label>
              <input
                id="register-pin"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                value={registerPin}
                onChange={(e) => setRegisterPin(e.target.value)}
              />
            </div>
            {registerError && (
              <p className={styles.errorText} role="alert">
                {registerError}
              </p>
            )}
            <button type="button" className={styles.primaryButton} onClick={() => void handleRegister()} disabled={registering}>
              {registering ? '登録中…' : 'この端末を登録'}
            </button>
          </section>
        )}

        {step === 'ready' && (
          <>
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>端末情報</h2>
              <div className={styles.infoList}>
                <div className={styles.infoRow}>
                  <span className={styles.infoLabel}>端末コード</span>
                  <span>{config.terminalCode}</span>
                </div>
                {config.tokenExpiresAt && (
                  <div className={styles.infoRow}>
                    <span className={styles.infoLabel}>トークン有効期限</span>
                    <span>{formatDate(config.tokenExpiresAt)}</span>
                  </div>
                )}
              </div>
              <div className={styles.formField}>
                <label htmlFor="rename-terminal">端末名</label>
                <input id="rename-terminal" type="text" value={renameInput} onChange={(e) => setRenameInput(e.target.value)} />
              </div>
              {renameError && (
                <p className={styles.errorText} role="alert">
                  {renameError}
                </p>
              )}
              <button
                type="button"
                onClick={() => void handleRename()}
                disabled={renaming || renameInput === config.terminalName}
              >
                {renaming ? '変更中…' : '端末名を変更'}
              </button>
              <button type="button" onClick={() => void handleResetRegistration()}>
                登録をやり直す（リセット）
              </button>
            </section>

            {blockedBy === 'tokenExpired' && (
              <section className={styles.section}>
                <div className={styles.tokenExpiredBox}>
                  <strong>トークンの有効期限が切れています。PIN を再入力してください。</strong>
                  <div className={styles.formField}>
                    <label htmlFor="relogin-pin">PIN</label>
                    <input
                      id="relogin-pin"
                      type="password"
                      inputMode="numeric"
                      autoComplete="off"
                      value={reLoginPin}
                      onChange={(e) => setReLoginPin(e.target.value)}
                    />
                  </div>
                  {reLoginError && (
                    <p className={styles.errorText} role="alert">
                      {reLoginError}
                    </p>
                  )}
                  <button
                    type="button"
                    className={styles.primaryButton}
                    onClick={() => void handleRelogin()}
                    disabled={reLoginSubmitting}
                  >
                    {reLoginSubmitting ? '再ログイン中…' : '再ログイン'}
                  </button>
                </div>
              </section>
            )}

            {blockedBy === 'terminalDisabled' && (
              <section className={styles.section}>
                <div className={styles.warningBox}>
                  この端末は管理者により無効化されています。未送信データ（{pendingSales.length}件）は自動送信されません。
                  下のボタンから CSV としてダウンロードし、管理者に手動での反映を依頼してください。
                </div>
                <button
                  type="button"
                  className={styles.primaryButton}
                  onClick={handleExportCsv}
                  disabled={pendingSales.length === 0}
                >
                  未送信データを CSV でダウンロード
                </button>
              </section>
            )}

            {!blockedBy && (
              <section className={styles.section}>
                <h2 className={styles.sectionTitle}>未送信データ（{pendingSales.length}件）</h2>
                {pendingSales.length === 0 ? (
                  <p className={styles.emptyMessage}>未送信の会計はありません</p>
                ) : (
                  <ul className={styles.pendingList}>
                    {pendingSales.map((p) => (
                      <li key={p.saleId} className={styles.pendingRow}>
                        <span>{p.saleId}</span>
                        <span>{formatYen(saleLinesTotal(p.payload.lines))}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <button
                  type="button"
                  className={styles.primaryButton}
                  onClick={() => void handleForceSync()}
                  disabled={syncing || pendingSales.length === 0}
                >
                  {syncing ? '送信中…' : '今すぐ同期'}
                </button>
              </section>
            )}
          </>
        )}
      </div>
    </main>
  )
}
