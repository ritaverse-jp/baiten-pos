/**
 * 同期エンジン。docs/design.md 4.1（キュー消化・起動契機）・6.6（認証エラーの分岐）
 * を実装する。
 *
 * `runSync` が1回分の同期処理の本体。`startSyncEngine` がアプリ起動時に一度だけ
 * 呼ばれ、design 4.1 の起動契機（online イベント・visibilitychange・30秒間隔）を
 * タイマー・イベントリスナーとして配線する。会計確定直後のトリガー（design 4.1
 * 「会計確定時」）は `screens/checkout/CheckoutScreen.tsx` から呼ぶ。
 *
 * design 4.1 が挙げる残り2つの起動契機のうち、「設定画面の手動実行」は
 * `runSync({ force: true })` を呼ぶボタンとしてタスク19（設定画面）で配線する
 * （ここでは force オプションだけ用意する）。「アプリ起動時」も同様に
 * `startSyncEngine` の呼び出し元（`app/App.tsx`）が担う。
 *
 * design 6.5（残り14日を切ったら refreshToken を静かに呼ぶ）はこのタスクの
 * スコープに含めない（design 7章のタスク16行は 6.6 のみを挙げている）。
 * 同様に、design 6.6 が求める「TERMINAL_DISABLED 端末での未送信データ CSV
 * エクスポート」は UI が必要なためタスク19で行う。
 */

import { getAllPendingSales, removePendingSale, updatePendingSaleRetry } from '@/data/db/pendingQueue'
import { markSaleSynced } from '@/data/db/sales'
import { appendSales } from '@/data/gas/endpoints'
import { useSyncStore } from '@/state/syncStore'

/** 1回の appendSales で送る最大件数。design はバッチ送信のみ指示し件数は指定していないため、妥当な値として選んだ */
const BATCH_SIZE = 50
/** design 4.1 の「30秒間隔」。バックオフの単位としても使う */
const BASE_INTERVAL_MS = 30000
/** バックオフの上限（10分）。ネットワーク断が続いても送信間隔がどこまでも伸び続けないようにする */
const MAX_BACKOFF_MS = 10 * 60 * 1000

/** 多重起動ガード（design 4.1「シングルトン」）。モジュールスコープの単純なフラグで足りる（同期エンジンはタブ内に1つだけ） */
let syncing = false
/** 一時的な失敗（NETWORK_ERROR・TIMEOUT・LOCK_TIMEOUT・MALFORMED_RESPONSE等）の連続回数。指数バックオフの計算に使う */
let consecutiveFailures = 0
/** バックオフ中、次にいつなら試してよいか（epoch ms）。0 なら即座に試してよい */
let nextAttemptAt = 0

export interface RunSyncOptions {
  /**
   * true の場合、`blockedBy`（認証エラーによる一時停止・恒久停止）とバックオフの
   * 待機時間を無視して必ず送信を試みる。設定画面の「手動で再送信」用（design 9.1）。
   */
  force?: boolean
}

/**
 * 同期を1回試みる。未送信キューが空、多重起動中、認証エラーで停止中
 * （`force` 指定時を除く）、バックオフ待機中のいずれかなら何もしない。
 *
 * design 4.2 の冪等性（GAS 側がロック内で saleId の重複を判定する）により、
 * この関数を何度呼んでも・同じキューを何度送っても、シート上の行が増える
 * ことはない。
 */
export async function runSync(options: RunSyncOptions = {}): Promise<void> {
  // ガード判定と「実行中」フラグを立てるところまでを同期的に行う。
  // 間に await を挟むと、その隙に2つ目の呼び出しがまだ false のガードを
  // すり抜けてしまう（実際にこの競合でテストが落ちたことがある）。
  if (syncing) return
  const store = useSyncStore.getState()
  if (!options.force) {
    if (store.blockedBy) return
    if (Date.now() < nextAttemptAt) return
  }
  syncing = true

  try {
    const pending = await getAllPendingSales()
    if (pending.length === 0) return

    useSyncStore.getState().setSyncing(true)
    const batch = pending.slice(0, BATCH_SIZE)
    const result = await appendSales(batch.map((p) => p.payload))

    if (result.ok) {
      consecutiveFailures = 0
      nextAttemptAt = 0
      useSyncStore.getState().setConnection('online')
      // 直前まで認証エラーで停止していても、今回成功したなら解消している
      useSyncStore.getState().setBlockedBy(null)

      for (const r of result.data.results) {
        // appended・duplicate のどちらも「サーバーが受理済み」を意味する（design 4.2）
        await markSaleSynced(r.saleId)
        await removePendingSale(r.saleId)
      }
      useSyncStore.getState().setLastSyncedAt(new Date().toISOString())
      await useSyncStore.getState().refreshPendingCount()
      return
    }

    useSyncStore.getState().setConnection('offline')

    if (result.error.code === 'TOKEN_EXPIRED') {
      // design 6.6：同期を一時停止。キューは保持する。PIN再ログイン成功後の
      // 自動再開は、ログイン成功時に blockedBy を null に戻す側（タスク19）の責務
      useSyncStore.getState().setBlockedBy('tokenExpired')
      return
    }
    if (result.error.code === 'TERMINAL_DISABLED') {
      // design 6.6：同期を恒久停止。キューは保持する
      useSyncStore.getState().setBlockedBy('terminalDisabled')
      return
    }
    if (result.error.code === 'TERMINAL_NOT_REGISTERED') {
      // トークンは有効だが `端末` タブに行が無い。管理者による無効化と違い、
      // 端末側で登録をやり直せば復旧できるため、設定画面がその導線を出す。
      // 自動リトライしても状況は変わらないので、ここで停止する点は同じ
      useSyncStore.getState().setBlockedBy('terminalNotRegistered')
      return
    }

    // NETWORK_ERROR・TIMEOUT・LOCK_TIMEOUT・VALIDATION_ERROR・MALFORMED_RESPONSE・
    // NOT_CONFIGURED 等は一時的な失敗として扱い、指数バックオフで次回へ（design 4.1）。
    // キューは削除しない（design 6.6・不変条件17）
    consecutiveFailures += 1
    nextAttemptAt = Date.now() + Math.min(BASE_INTERVAL_MS * 2 ** consecutiveFailures, MAX_BACKOFF_MS)

    const attemptedAt = new Date().toISOString()
    for (const p of batch) {
      await updatePendingSaleRetry(p.saleId, {
        retryCount: p.retryCount + 1,
        lastTriedAt: attemptedAt,
        lastError: result.error.code,
      })
    }
  } finally {
    syncing = false
    useSyncStore.getState().setSyncing(false)
  }
}

let started = false

/**
 * 同期エンジンを起動する。design 4.1 の起動契機のうち、イベント駆動のもの
 * （online 復帰・タブ復帰・30秒間隔）を配線する。アプリ起動時に一度だけ
 * 呼ぶこと（`app/App.tsx` の他の `hydrate()` 呼び出しと同じ場所）。
 *
 * 二重に呼んでもイベントリスナー・タイマーが重複登録されないよう
 * ガードする（React の StrictMode による2度目の effect 実行等を想定）。
 */
export function startSyncEngine(): void {
  if (started) return
  started = true

  window.addEventListener('online', () => void runSync())
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void runSync()
  })
  setInterval(() => void runSync(), BASE_INTERVAL_MS)

  // 起動時点で未送信が残っていれば、そのタイミングでも一度試す
  void runSync()
}

/**
 * テスト専用。モジュールスコープの多重起動ガード・バックオフ状態・起動フラグを
 * 初期化する。本番コードから呼ばないこと。
 */
export function __resetSyncEngineForTests(): void {
  syncing = false
  consecutiveFailures = 0
  nextAttemptAt = 0
  started = false
}
