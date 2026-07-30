/**
 * GAS Web アプリへの低レベル通信。docs/design.md 2.1 の共通仕様を実装する。
 *
 * - POST は `Content-Type: text/plain` に固定し、ボディは JSON 文字列（`application/json`
 *   は CORS のプリフライト対象になり GAS が応答できず必ず失敗する。design 2.1）
 * - GAS の Web アプリは 302 で `script.googleusercontent.com` にリダイレクトして
 *   結果を返す。`fetch()` はデフォルト（`redirect: 'follow'`）でこれを正しく
 *   自動追従するため、特別なリダイレクト処理は不要（curl の `-L` で起きた
 *   ボディ破損は curl 固有の挙動であり、ブラウザの `fetch()` では発生しない。
 *   実機に対する Node の `fetch()` で確認済み）
 * - 認証つきの呼び出しは POST に寄せる。GET は `ping` の疎通確認専用（design 2.1）
 */

import type { ApiError, ApiErrorCode, ApiResponse } from '@/domain/types'

/**
 * GAS 側の `saveProduct` 等は `LockService.getScriptLock().waitLock(30000)` を
 * 使う（docs/design.md 2.8）。クライアントのタイムアウトはこれより短いと、
 * サーバーがロック待ちで応答しようとしている最中に見切りをつけてしまう
 * ことになるため、30秒に余裕を持たせた値にする。
 */
const DEFAULT_TIMEOUT_MS = 35000

function isPlainErrorCode(value: unknown): value is ApiErrorCode {
  return typeof value === 'string'
}

/** GAS の応答本文を design 2.1 の統一形式として検証する。形が違えば null を返す */
function parseGasEnvelope<T>(text: string): ApiResponse<T> | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }

  if (typeof parsed !== 'object' || parsed === null || !('ok' in parsed)) {
    return null
  }

  const body = parsed as { ok: unknown; data?: unknown; error?: unknown }

  if (body.ok === true) {
    return { ok: true, data: body.data as T }
  }

  if (body.ok === false) {
    const error = body.error as { code?: unknown; message?: unknown } | undefined
    if (!error || !isPlainErrorCode(error.code) || typeof error.message !== 'string') {
      return null
    }
    return { ok: false, error: { code: error.code, message: error.message } }
  }

  return null
}

function clientError(code: ApiErrorCode, message: string): { ok: false; error: ApiError } {
  return { ok: false, error: { code, message } }
}

export interface GasRequestOptions {
  timeoutMs?: number
}

/**
 * POST で GAS を呼ぶ。`payload` に `action` を含めること。
 * ネットワーク断・タイムアウト・不正な応答は `ClientErrorCode` に正規化して返す。
 * サーバーが返した `ServerErrorCode`（`TOKEN_EXPIRED`・`TERMINAL_DISABLED` 等）は
 * そのまま透過する（design 6.6 の分岐は呼び出し側が `error.code` を見て行う）。
 */
export async function postToGas<T>(
  gasUrl: string,
  payload: Record<string, unknown>,
  options?: GasRequestOptions,
): Promise<ApiResponse<T>> {
  const controller = new AbortController()
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(gasUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    const text = await res.text()
    const envelope = parseGasEnvelope<T>(text)
    if (!envelope) {
      return clientError('MALFORMED_RESPONSE', 'GAS からの応答を解釈できませんでした')
    }
    return envelope
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return clientError('TIMEOUT', `GAS への通信がタイムアウトしました（${timeoutMs}ms）`)
    }
    return clientError('NETWORK_ERROR', 'GAS へ通信できませんでした')
  } finally {
    clearTimeout(timer)
  }
}

/** GET で GAS を呼ぶ。`ping` の疎通確認専用（design 2.1）。認証つきの呼び出しには使わない */
export async function getFromGas<T>(
  gasUrl: string,
  query: Record<string, string>,
  options?: GasRequestOptions,
): Promise<ApiResponse<T>> {
  const controller = new AbortController()
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const url = new URL(gasUrl)
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value)
    }
    const res = await fetch(url.toString(), { method: 'GET', signal: controller.signal })
    const text = await res.text()
    const envelope = parseGasEnvelope<T>(text)
    if (!envelope) {
      return clientError('MALFORMED_RESPONSE', 'GAS からの応答を解釈できませんでした')
    }
    return envelope
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return clientError('TIMEOUT', `GAS への通信がタイムアウトしました（${timeoutMs}ms）`)
    }
    return clientError('NETWORK_ERROR', 'GAS へ通信できませんでした')
  } finally {
    clearTimeout(timer)
  }
}
