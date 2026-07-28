/**
 * IndexedDB スキーマ（Dexie）。
 *
 * データベースは1つに統一する。IndexedDB の接続はデータベース単位で管理されるため、
 * 機能ごとに複数のデータベースへ分けると接続・バージョン管理が煩雑になる
 * （docs/design.md 3.3 の7テーブルを、今後もすべてこのファイルに集約する）。
 *
 * 現時点ではタスク5（採番）が必要とする `counters` テーブルのみを定義している。
 * 残りのテーブル（products・categories・currentTicket・sales・pendingQueue・config）
 * はタスク6でこのスキーマに追加する。まだ本番データが存在しない開発段階のため、
 * バージョン1に追加する形で問題ない（マイグレーションを要しない）
 */

import Dexie, { type EntityTable } from 'dexie'
import type { SeqCounter } from '@/domain/types'

export class AppDatabase extends Dexie {
  counters!: EntityTable<SeqCounter, 'dateKey'>

  constructor() {
    super('baiten-pos')
    this.version(1).stores({
      counters: 'dateKey',
    })
  }
}

export const db = new AppDatabase()
