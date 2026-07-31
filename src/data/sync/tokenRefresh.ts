/**
 * トークンのプロアクティブ更新（design 6.5）。
 *
 * 絶対期限90日のトークンが残り14日を切ったら、オンライン時に `refreshToken` を
 * 静かに呼んで巻き直す（現行の有効なトークンで認証するため PIN 入力は不要）。
 * 期限切れまで放置された場合は `data/sync/engine.ts` の `runSync` が
 * `TOKEN_EXPIRED` を検知して同期を止め、画面が PIN 再ログインを促す
 * （screens/settings/SettingsScreen.tsx）。
 */

import { getConfig, saveConfig } from '@/data/db/config'
import { refreshToken } from '@/data/gas/endpoints'

const DAYS_BEFORE_EXPIRY_TO_REFRESH = 14
const MS_PER_DAY = 24 * 60 * 60 * 1000
/** 期限切れ間近かの判定を毎回サーバーに問い合わせないための最小間隔。90日の期限に対して1時間おきで十分 */
const CHECK_INTERVAL_MS = 60 * 60 * 1000

let lastCheckedAt = 0

/**
 * 残り日数が閾値を切っていれば `refreshToken` を呼び、成功時のみ `config` を
 * 更新する。失敗時は何もしない（次回のこの関数呼び出し、または期限切れ後に
 * 同期エンジンが `TOKEN_EXPIRED` として検知する通常フローに任せる）。
 */
export async function checkTokenExpiry(now: Date = new Date()): Promise<void> {
  if (now.getTime() - lastCheckedAt < CHECK_INTERVAL_MS) return
  lastCheckedAt = now.getTime()

  const config = await getConfig()
  if (!config.apiToken || !config.tokenExpiresAt) return

  const daysLeft = (new Date(config.tokenExpiresAt).getTime() - now.getTime()) / MS_PER_DAY
  if (daysLeft > DAYS_BEFORE_EXPIRY_TO_REFRESH) return

  const result = await refreshToken()
  if (result.ok) {
    await saveConfig({ apiToken: result.data.apiToken, tokenExpiresAt: result.data.expiresAt })
  }
}

let started = false
let intervalId: ReturnType<typeof setInterval> | undefined

/**
 * `app/App.tsx` の起動時に一度だけ呼ぶ。`data/sync/engine.ts` の
 * `startSyncEngine` と同じ間隔（`CHECK_INTERVAL_MS`）でタイマーを配線する
 * （`checkTokenExpiry` 自身の間引きにより、実際にサーバーへ問い合わせるのは
 * 期限が近いときだけ）。
 */
export function startTokenRefreshWatcher(): void {
  if (started) return
  started = true
  intervalId = setInterval(() => void checkTokenExpiry(), CHECK_INTERVAL_MS)
  void checkTokenExpiry()
}

/** テスト専用。間引き用の状態とタイマーを初期化する */
export function __resetTokenRefreshWatcherForTests(): void {
  lastCheckedAt = 0
  started = false
  if (intervalId !== undefined) {
    clearInterval(intervalId)
    intervalId = undefined
  }
}
