/**
 * GAS の各エンドポイントに対応する型つきラッパー関数。docs/design.md 2.2 の
 * 一覧と 1:1 対応する。呼び出し側（state・screens・sync）はここだけを使い、
 * `postToGas`/`getFromGas` を直接呼ばない。
 *
 * トークン・端末コード・GAS URL は `data/db/config.ts` から読む。設定が
 * 揃っていない場合はネットワークに出ず `NOT_CONFIGURED` を返す（design 2.1
 * には無いエラーコードだが、`ClientErrorCode` として types.ts に定義済み）。
 */

import { getConfig } from '@/data/db/config'
import type {
  AppendSalesRequest,
  AppendSalesResponse,
  ApiResponse,
  AuthResponse,
  CancelSaleRequest,
  CancelSaleResponse,
  Category,
  DeleteCategoryRequest,
  DeleteCategoryResponse,
  DeleteProductRequest,
  DeleteProductResponse,
  GetMastersResponse,
  GetSalesHistoryRequest,
  GetSalesHistoryResponse,
  GetTodayMaxSeqResponse,
  LoginRequest,
  Product,
  RegisterTerminalRequest,
  SaveCategoryResponse,
  SaveProductResponse,
  DateKey,
} from '@/domain/types'
import { getFromGas, postToGas } from './client'

function notConfigured<T>(): ApiResponse<T> {
  return { ok: false, error: { code: 'NOT_CONFIGURED', message: 'GAS の接続先が設定されていません' } }
}

interface AuthedConfig {
  gasUrl: string
  apiToken: string
  terminalCode: string
}

/** トークン認証が必要な呼び出しの前提条件をまとめて取得する */
async function requireAuthedConfig(): Promise<AuthedConfig | null> {
  const config = await getConfig()
  if (!config.gasUrl || !config.apiToken || !config.terminalCode) return null
  return { gasUrl: config.gasUrl, apiToken: config.apiToken, terminalCode: config.terminalCode }
}

// ============================================================
// 疎通確認（design 2.2：認証不要・GET）
// ============================================================

export async function ping(gasUrl: string): Promise<ApiResponse<{ pong: boolean; now: string }>> {
  return getFromGas(gasUrl, { action: 'ping' })
}

// ============================================================
// 認証・端末登録（design 2.5・6章）
// ============================================================

export async function registerTerminal(req: RegisterTerminalRequest): Promise<ApiResponse<AuthResponse>> {
  const config = await getConfig()
  if (!config.gasUrl) return notConfigured()
  return postToGas(config.gasUrl, { action: 'registerTerminal', ...req })
}

export async function login(req: LoginRequest): Promise<ApiResponse<AuthResponse>> {
  const config = await getConfig()
  if (!config.gasUrl) return notConfigured()
  return postToGas(config.gasUrl, { action: 'login', ...req })
}

/**
 * トークンの巻き直し。呼び出しタイミング（残り14日を切ったら等。design 6.5）の
 * 判断は呼び出し側（タスク16の同期エンジン）の責務とし、ここでは通信のみ行う。
 */
export async function refreshToken(): Promise<ApiResponse<AuthResponse>> {
  const auth = await requireAuthedConfig()
  if (!auth) return notConfigured()
  return postToGas(auth.gasUrl, { action: 'refreshToken', apiToken: auth.apiToken, terminalCode: auth.terminalCode })
}

// ============================================================
// マスタ取得（design 2.3）
// ============================================================

export async function getMasters(): Promise<ApiResponse<GetMastersResponse>> {
  const auth = await requireAuthedConfig()
  if (!auth) return notConfigured()
  return postToGas(auth.gasUrl, { action: 'getMasters', apiToken: auth.apiToken, terminalCode: auth.terminalCode })
}

// ============================================================
// 売上追記（design 2.4）
// ============================================================

export async function appendSales(sales: AppendSalesRequest['sales']): Promise<ApiResponse<AppendSalesResponse>> {
  const auth = await requireAuthedConfig()
  if (!auth) return notConfigured()
  return postToGas(auth.gasUrl, { action: 'appendSales', apiToken: auth.apiToken, terminalCode: auth.terminalCode, sales })
}

// ============================================================
// 連番の復元（design 2.5・5.3）
// ============================================================

export async function getTodayMaxSeq(date: DateKey): Promise<ApiResponse<GetTodayMaxSeqResponse>> {
  const auth = await requireAuthedConfig()
  if (!auth) return notConfigured()
  return postToGas(auth.gasUrl, { action: 'getTodayMaxSeq', apiToken: auth.apiToken, terminalCode: auth.terminalCode, date })
}

// ============================================================
// マスタ更新（design 2.6）
// ============================================================

export async function saveProduct(product: Product, originalNo?: number): Promise<ApiResponse<SaveProductResponse>> {
  const auth = await requireAuthedConfig()
  if (!auth) return notConfigured()
  const payload: Record<string, unknown> = { action: 'saveProduct', apiToken: auth.apiToken, terminalCode: auth.terminalCode, product }
  if (originalNo !== undefined) payload.originalNo = originalNo
  return postToGas(auth.gasUrl, payload)
}

export async function deleteProduct(no: DeleteProductRequest['no']): Promise<ApiResponse<DeleteProductResponse>> {
  const auth = await requireAuthedConfig()
  if (!auth) return notConfigured()
  return postToGas(auth.gasUrl, { action: 'deleteProduct', apiToken: auth.apiToken, terminalCode: auth.terminalCode, no })
}

export async function saveCategory(category: Category, originalName?: string): Promise<ApiResponse<SaveCategoryResponse>> {
  const auth = await requireAuthedConfig()
  if (!auth) return notConfigured()
  const payload: Record<string, unknown> = {
    action: 'saveCategory',
    apiToken: auth.apiToken,
    terminalCode: auth.terminalCode,
    category,
  }
  if (originalName !== undefined) payload.originalName = originalName
  return postToGas(auth.gasUrl, payload)
}

export async function deleteCategory(name: DeleteCategoryRequest['name']): Promise<ApiResponse<DeleteCategoryResponse>> {
  const auth = await requireAuthedConfig()
  if (!auth) return notConfigured()
  return postToGas(auth.gasUrl, { action: 'deleteCategory', apiToken: auth.apiToken, terminalCode: auth.terminalCode, name })
}

// ============================================================
// 履歴・取消（design 2.7 / FR-14・FR-15）
//
// GAS 側（getSalesHistory・cancelSale）はタスク18で実装する。ここでの
// ラッパーは types.ts の定義との対応を先に用意しておくもので、現時点では
// 呼び出しても GAS 側が VALIDATION_ERROR（不明な action）を返す。
// ============================================================

export async function getSalesHistory(date: GetSalesHistoryRequest['date']): Promise<ApiResponse<GetSalesHistoryResponse>> {
  const auth = await requireAuthedConfig()
  if (!auth) return notConfigured()
  return postToGas(auth.gasUrl, { action: 'getSalesHistory', apiToken: auth.apiToken, terminalCode: auth.terminalCode, date })
}

export async function cancelSale(saleId: CancelSaleRequest['saleId']): Promise<ApiResponse<CancelSaleResponse>> {
  const auth = await requireAuthedConfig()
  if (!auth) return notConfigured()
  return postToGas(auth.gasUrl, { action: 'cancelSale', apiToken: auth.apiToken, terminalCode: auth.terminalCode, saleId })
}
