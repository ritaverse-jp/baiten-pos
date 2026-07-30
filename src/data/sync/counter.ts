/**
 * 連番カウンタ。docs/design.md 5.1・5.2 の採番方式を実装する。
 *
 * 会計番号の連番部分は、Dexie の `counters` テーブル（キー＝日付キー）を
 * read → +1 → write する。この一連の操作を単一の Dexie トランザクションに
 * 収めることで、同時実行（二重タップ・複数の呼び出しが競合するタイミング）でも
 * 同じ連番が2度払い出されることがない（IndexedDB のトランザクションが
 * 同一テーブルへの読み書きを直列化するため。docs/design.md 5.2）。
 *
 * `nextSeq` は自前でトランザクションを開くが、Dexie はすでに `db.counters` を
 * 含む外側のトランザクションの中から呼ばれた場合、新規トランザクションを
 * 作らずそれに参加する。したがって CLAUDE.md の不変条件「連番の採番と会計
 * データの保存は同一の Dexie トランザクション内で行う」を満たすには、
 * 呼び出し側（タスク15の会計確定処理）が `db.counters` を含む外側の
 * トランザクションの中で `nextSeq` を呼べばよく、ここに特別な対応は要らない。
 *
 * `reconcileCounterOnStartup` は起動時に GAS 通信層（タスク11）を使ってカウンタを
 * 補正する（docs/design.md 5.3）。
 */

import { getConfig } from '@/data/db/config'
import { getTodayMaxSeq } from '@/data/gas/endpoints'
import { db } from '@/data/db/schema'
import { toDateKey } from '@/domain/saleNumber'
import type { DateKey } from '@/domain/types'

/**
 * 指定した日付キーの次の連番を払い出す。該当日のカウンタが存在しなければ
 * 1 から開始する（日付が変われば別キーになるため、日次で自然に 001 から
 * 再開する。docs/design.md 5.1）。
 */
export async function nextSeq(dateKey: DateKey): Promise<number> {
  return db.transaction('rw', db.counters, async () => {
    const current = await db.counters.get(dateKey)
    const seq = (current?.lastSeq ?? 0) + 1
    await db.counters.put({ dateKey, lastSeq: seq })
    return seq
  })
}

/**
 * 現在のカウンタ値を、払い出しを行わずに読む。存在しなければ 0。
 *
 * 起動時に「当日分のカウンタが存在するか」を確認する用途に使う
 * （docs/design.md 5.3 の IndexedDB 消失リスクへの対処。呼び出し元は
 * `reconcileCounterOnStartup`）。
 */
export async function peekSeq(dateKey: DateKey): Promise<number> {
  const current = await db.counters.get(dateKey)
  return current?.lastSeq ?? 0
}

/**
 * カウンタを少なくとも `minSeq` まで引き上げる。現在値がそれ以上なら何もしない
 * （採番済みの番号を巻き戻さない）。
 *
 * IndexedDB が消去された端末で、シート上の当日最大連番（`getTodayMaxSeq` の
 * 応答）からカウンタを復元する際に使う（docs/design.md 5.3）。呼び出し元は
 * `reconcileCounterOnStartup`。
 */
export async function ensureMinSeq(dateKey: DateKey, minSeq: number): Promise<void> {
  await db.transaction('rw', db.counters, async () => {
    const current = await db.counters.get(dateKey)
    if ((current?.lastSeq ?? 0) < minSeq) {
      await db.counters.put({ dateKey, lastSeq: minSeq })
    }
  })
}

/**
 * `ok`：復元不要、または復元できた（会計を開始してよい）。
 * `blocked`：端末データを消した直後に圏外で営業を始めたなど、当日カウンタが
 * 未初期化なのにサーバーへ問い合わせもできない状態（docs/design.md 5.3
 * 「オフラインで復元できない場合は会計開始をブロックし、その旨を表示する」）。
 */
export type ReconcileCounterResult = 'ok' | 'blocked'

/**
 * 起動時に呼ぶ。端末登録済みなのに当日のカウンタが未初期化（IndexedDB 消去等）
 * の場合、`getTodayMaxSeq` でシート上の当日最大連番を取得し、カウンタを
 * そこまで引き上げて復元する（docs/design.md 5.3）。
 *
 * カウンタが既に初期化済みなら何もしない（サーバーに問い合わせない）。
 * 端末が未登録の場合もここでは何もしない（登録前は会計自体が開始できず、
 * この関数が守るべき不変条件がそもそも成立しないため）。
 *
 * 呼び出し側（会計画面。タスク13以降）は `blocked` を見て会計開始をブロックし、
 * その旨を表示すること。
 */
export async function reconcileCounterOnStartup(now: Date): Promise<ReconcileCounterResult> {
  const config = await getConfig()
  if (!config.terminalCode) return 'ok'

  const dateKey = toDateKey(now)
  const current = await peekSeq(dateKey)
  if (current > 0) return 'ok'

  const response = await getTodayMaxSeq(dateKey)
  if (!response.ok) return 'blocked'

  await ensureMinSeq(dateKey, response.data.maxSeq)
  return 'ok'
}
