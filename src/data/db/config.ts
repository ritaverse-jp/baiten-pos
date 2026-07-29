/**
 * 端末設定（`config`）へのアクセサ。
 *
 * レコードは常に1件（`AppConfig.id === 'singleton'`）。未設定の項目は
 * `null` として扱い、テーブルに行が存在しない状態と1件だけ存在する状態を
 * 呼び出し側が区別しなくて済むようにする（`getConfig` は常に `AppConfig` を返す）。
 */

import type { AppConfig } from '@/domain/types'
import { db } from './schema'

const CONFIG_ID = 'singleton' as const

const DEFAULT_CONFIG: AppConfig = {
  id: CONFIG_ID,
  gasUrl: null,
  terminalCode: null,
  terminalName: null,
  apiToken: null,
  tokenExpiresAt: null,
}

export async function getConfig(): Promise<AppConfig> {
  const existing = await db.config.get(CONFIG_ID)
  return existing ?? DEFAULT_CONFIG
}

/** 指定した項目だけを更新する。未指定の項目は現在の値を保つ */
export async function saveConfig(patch: Partial<Omit<AppConfig, 'id'>>): Promise<AppConfig> {
  const current = await getConfig()
  const next: AppConfig = { ...current, ...patch, id: CONFIG_ID }
  await db.config.put(next)
  return next
}

/** 端末を未登録状態に戻す。テスト・工場出荷リセット用途 */
export async function clearConfig(): Promise<void> {
  await db.config.delete(CONFIG_ID)
}
