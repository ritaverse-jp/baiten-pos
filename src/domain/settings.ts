/**
 * SC-06 設定画面（端末登録・PINログイン・GAS URL設定）の入力検証。要件定義 NF-05・
 * docs/design.md 5.4・6章。
 *
 * GAS 側（`gas/Auth.js`）の検証（`pin`/`terminalName` の必須チェック、端末コードの
 * パターン）を最終防衛線としつつ、ここでは往復通信なしの即時フィードバックを返す
 * （`domain/masters.ts` と同じ方針）。
 */

export type GasUrlError = 'required' | 'invalidFormat'
export type TerminalNameError = 'required'
export type PinError = 'required' | 'invalidFormat'

export const GAS_URL_ERROR_MESSAGES: Record<GasUrlError, string> = {
  required: 'GAS Web アプリの URL を入力してください',
  invalidFormat: 'https:// で始まる正しい URL を入力してください',
}

export const TERMINAL_NAME_ERROR_MESSAGES: Record<TerminalNameError, string> = {
  required: '端末名を入力してください',
}

export const PIN_ERROR_MESSAGES: Record<PinError, string> = {
  required: 'PIN を入力してください',
  invalidFormat: 'PIN は4〜8桁の数字で入力してください',
}

/** NF-06「通信はすべて HTTPS とする」を満たさない URL を弾く */
export function validateGasUrl(url: string): GasUrlError | null {
  if (url.trim().length === 0) return 'required'
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return 'invalidFormat'
  }
  if (parsed.protocol !== 'https:') return 'invalidFormat'
  return null
}

export function validateTerminalName(name: string): TerminalNameError | null {
  return name.trim().length === 0 ? 'required' : null
}

/** GAS 側（`setPin_`）が PIN を4〜8桁の数字に限定しているため、同じ形式を入力段階で確認する */
export function validatePin(pin: string): PinError | null {
  if (pin.length === 0) return 'required'
  if (!/^\d{4,8}$/.test(pin)) return 'invalidFormat'
  return null
}
