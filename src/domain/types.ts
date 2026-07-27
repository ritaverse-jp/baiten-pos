/**
 * ドメイン型定義。
 *
 * スプレッドシートの列（docs/design.md 1章 ＝ 要件定義 8.2）と 1:1 で対応させる。
 * 各フィールドのコメントにある A〜K は、対応するシートの列を指す。
 *
 * この層は React・通信・Dexie のいずれにも依存しない（docs/design.md 3.2）。
 */

// ============================================================
// ブランド型
// ============================================================

declare const brandKey: unique symbol
type Brand<T, B extends string> = T & { readonly [brandKey]: B }

/**
 * 整数円。要件定義 3-5 により小数は発生しない。
 * `toYen()` を通した値のみが Yen 型になるため、浮動小数が金額に混入しない。
 */
export type Yen = Brand<number, 'Yen'>

/** 会計番号。形式 `YYYYMMDD-{端末コード}{連番3桁}`（docs/design.md 5章） */
export type SaleId = Brand<string, 'SaleId'>

/** 端末コード。英大文字のみ（理由は TERMINAL_CODE_PATTERN のコメント参照） */
export type TerminalCode = Brand<string, 'TerminalCode'>

/** 日付キー `YYYYMMDD`。連番カウンタのキー、および当日データの絞り込みに使う */
export type DateKey = Brand<string, 'DateKey'>

/** ISO 8601 形式の日時文字列（例 `2026-07-23T14:32:00+09:00`） */
export type IsoDateTime = string

// ============================================================
// 制約値
// ============================================================

export const LIMITS = {
  /** 商品 No. の範囲（要件定義 6.2） */
  productNoMin: 1,
  productNoMax: 99,
  /** 丸数字（①〜⑳）で表示する上限。21 以降は通常数字（要件定義 6.2） */
  circledNumberMax: 20,
  /** 商品名の最大文字数（要件定義 6.2） */
  productNameMaxLength: 30,
  /** カテゴリ名の最大文字数（要件定義 6.3） */
  categoryNameMaxLength: 20,
  /** 伝票 1 行あたりの個数（要件定義 6.5） */
  qtyMin: 1,
  qtyMax: 99,
  /** 未送信キューの保持上限（要件定義 9.1） */
  pendingQueueMax: 1000,
  /** 連番の桁数。999 を超えたら桁が増える（docs/design.md 5.3） */
  seqDigits: 3,
} as const

/**
 * 端末コードは英大文字のみとする。
 *
 * 会計番号 `20260723-A014` は「ハイフン以降の末尾が連番、その手前が端末コード」
 * という構造で解釈する。端末コードに数字を許すと、連番が 999 を超えて 4 桁に
 * 延びた時点で `A1014` が「A1 + 014」なのか「A10 + 14」なのか判別できなくなる。
 * コードを英字に限定すれば、桁数によらず「末尾の数字列＝連番」で一意に解釈できる。
 *
 * 人間向けの表示名は端末名（`Terminal.name`）が担うため、コードを英字に絞っても
 * 運用上の不都合はない。
 */
export const TERMINAL_CODE_PATTERN = /^[A-Z]{1,4}$/

// ============================================================
// ブランド型のコンストラクタ
// ============================================================

export function isYen(value: unknown): value is Yen {
  return typeof value === 'number' && Number.isSafeInteger(value)
}

/** 整数でない値は金額として受け付けない。境界（通信・DB・入力）で必ず通すこと。 */
export function toYen(value: number): Yen {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`金額は整数でなければならない: ${value}`)
  }
  return value as Yen
}

export const ZERO_YEN = 0 as Yen

export function isTerminalCode(value: unknown): value is TerminalCode {
  return typeof value === 'string' && TERMINAL_CODE_PATTERN.test(value)
}

export function toTerminalCode(value: string): TerminalCode {
  if (!TERMINAL_CODE_PATTERN.test(value)) {
    throw new RangeError(`端末コードは英大文字1〜4文字でなければならない: ${value}`)
  }
  return value as TerminalCode
}

// SaleId / DateKey の生成・検証は domain/saleNumber.ts（タスク5）が担う。
// ここでは型だけを定義し、生成規則は 1 箇所に閉じ込める。

// ============================================================
// マスタ
// ============================================================

/** 商品の販売状態・端末の状態に共通の区分（シート上の表記そのまま） */
export type ActiveFlag = '有効' | '無効'

/** `商品マスタ` タブ 1 行（docs/design.md 1.2） */
export interface Product {
  /** A列: No. 1〜99・一意 */
  no: number
  /** B列: 商品名 30文字以内 */
  name: string
  /** C列: 金額（税込・割引前の単価） */
  price: Yen
  /** D列: カテゴリ名。`Category.name` への参照 */
  categoryName: string
  /** E列: 表示順。未指定時は No. 順 */
  displayOrder: number | null
  /** F列: 販売状態。`無効` は会計画面に表示しない */
  status: ActiveFlag
}

/** `カテゴリ` タブ 1 行（docs/design.md 1.3） */
export interface Category {
  /** A列: カテゴリ名。一意。商品からの参照キー */
  name: string
  /** B列: 表示順（会計画面のタブ並び順） */
  displayOrder: number | null
  /** C列: 表示色 */
  color: string | null
}

/** `端末` タブ 1 行（docs/design.md 1.4） */
export interface Terminal {
  /** A列: 端末コード */
  code: TerminalCode
  /** B列: 端末名（「レジ1」等の表示用） */
  name: string
  /** C列: 登録日時 */
  registeredAt: IsoDateTime
  /** D列: 状態。アクセス失効の唯一のスイッチ（docs/design.md 6.3） */
  status: ActiveFlag
  /** E列: 最終同期日時。GAS が売上受信のたびに更新する */
  lastSyncedAt: IsoDateTime | null
}

// ============================================================
// 伝票（入力中・未確定）
// ============================================================

/**
 * 入力中の伝票の 1 行。
 *
 * 商品名・単価は追加時点のマスタからコピーする。マスタが他端末で編集されても、
 * 入力中の伝票の金額が動かないようにするため（要件定義 6.2）。
 */
export interface TicketLine {
  /**
   * 行の一意キー。商品 No. とは独立させる。
   * 同一商品を異なる割引で別行として扱う「行を分ける」操作があるため（要件定義 6.4）。
   */
  lineId: string
  productNo: number
  productName: string
  /** 割引を引く前の単価。`SaleLine.netUnitPrice`（割引後）とは別物 */
  unitPrice: Yen
  /** 1〜99 */
  qty: number
  /** 1 点あたりの割引額。0 以上・`unitPrice` 以下（要件定義 6.6） */
  discount: Yen
}

/** 入力中の伝票。IndexedDB に永続化し、再読み込み時に復元する（NF-04） */
export interface Ticket {
  lines: TicketLine[]
  /** FR-13: 会計単位の備考 */
  note: string
  updatedAt: IsoDateTime
}

// ============================================================
// 確定した会計
// ============================================================

/**
 * `売上ログ_YYYYMM` タブ 1 行に対応する明細（docs/design.md 1.5）。
 *
 * A〜D・J 列は会計単位の値のため `SaleRecord` 側が持ち、ここには含めない。
 */
export interface SaleLine {
  /** K列: 同一会計内の明細順。1 始まり */
  lineNo: number
  /** E列: 確定時点の商品名 */
  productName: string
  /**
   * F列: 金額。**割引適用後**の 1 点あたり単価（＝ `TicketLine.unitPrice - discount`）。
   * 伝票側の `unitPrice`（割引前）と取り違えると金額がずれるため、名前を分けている。
   */
  netUnitPrice: Yen
  /** G列: 個数。取消行ではマイナス値（要件定義 6.10） */
  qty: number
  /** H列: 小計 ＝ `netUnitPrice × qty` */
  subtotal: Yen
  /** I列: 1 点あたりの割引額 */
  discount: Yen
}

/**
 * GAS へ送信する会計 1 件分。スプレッドシートに転記される情報はこれで過不足ない。
 * ローカル保持用の `SaleRecord` はこれを拡張したものなので、送信ペイロードは
 * `SaleRecord` からの射影で作れる。
 */
export interface SalePayload {
  /** C列: 会計番号 */
  saleId: SaleId
  /** D列: 端末コード */
  terminalCode: TerminalCode
  /** A列（日付）・B列（時刻）の元になる確定日時 */
  confirmedAt: IsoDateTime
  /** J列: 会計単位の備考。同一会計の全行に同じ値が入る */
  note: string
  lines: SaleLine[]
}

/**
 * 端末内に保持する確定済み会計（Dexie `sales` テーブル）。
 *
 * 合計・預かり金・釣銭はスプレッドシートに転記しない（会計番号でグルーピングすれば
 * 算出できるため。docs/design.md 1.5 末尾）。当日履歴画面の表示にのみ使う。
 */
export interface SaleRecord extends SalePayload {
  /** 全行の小計の総和（要件定義 6.7） */
  total: Yen
  received: Yen
  /** 釣銭 ＝ `received - total` */
  change: Yen
  /** GAS が受理済みか。未送信キューの有無とは独立に持つ */
  synced: boolean
  /** 取消済みの場合の取消日時（FR-15）。元の会計自体は残す */
  canceledAt: IsoDateTime | null
}

// ============================================================
// 未送信キュー・採番カウンタ・端末設定（Dexie。docs/design.md 3.3）
// ============================================================

/**
 * 未送信キュー 1 件（Dexie `pendingQueue`）。
 *
 * GAS の受理応答を受け取るまで削除してはならない。認証エラーでも削除しない
 * （docs/design.md 4.4 / 6.6）。
 */
export interface PendingSale {
  saleId: SaleId
  /** 送信するペイロードそのもの。マスタ変更の影響を受けないよう確定時の値で固定する */
  payload: SalePayload
  enqueuedAt: IsoDateTime
  retryCount: number
  lastTriedAt: IsoDateTime | null
  lastError: string | null
}

/** 連番カウンタ（Dexie `counters`）。日付ごとに 1 レコード */
export interface SeqCounter {
  /** 主キー。`YYYYMMDD` */
  dateKey: DateKey
  /** 直近に払い出した連番。次回は +1 を使う。未払い出しは 0 */
  lastSeq: number
}

/** 端末設定（Dexie `config`）。1 レコードのみ */
export interface AppConfig {
  /** 固定の主キー */
  id: 'singleton'
  /** GAS Web アプリの URL */
  gasUrl: string | null
  terminalCode: TerminalCode | null
  terminalName: string | null
  /** 端末別のアクセストークン（docs/design.md 6.2） */
  apiToken: string | null
  /** トークンの有効期限。残り 14 日を切ったら `refreshToken` を呼ぶ（6.5） */
  tokenExpiresAt: IsoDateTime | null
}

// ============================================================
// 操作ログ（docs/design.md 1.6 / NF-07）
// ============================================================

export type OperationType =
  | '商品追加'
  | '商品編集'
  | '商品削除'
  | 'カテゴリ追加'
  | 'カテゴリ編集'
  | 'カテゴリ削除'
  | '会計取消'
  | '端末登録'
  | '端末無効化'

/** `操作ログ` タブ 1 行。E列にはこの `detail` を JSON 文字列化して書き込む */
export interface OperationLog {
  /** A列: 日時 */
  at: IsoDateTime
  /** B列: 端末コード */
  terminalCode: TerminalCode
  /** C列: 操作種別 */
  type: OperationType
  /** D列: 対象（例 `商品No.3`・`会計番号 20260723-A014`） */
  target: string
  /** E列: 変更内容 */
  detail: OperationLogDetail
}

export interface OperationLogDetail {
  before?: Record<string, unknown>
  after?: Record<string, unknown>
}

// ============================================================
// GAS API（docs/design.md 2章）
// ============================================================

export type ApiAction =
  | 'ping'
  | 'registerTerminal'
  | 'login'
  | 'refreshToken'
  | 'getMasters'
  | 'getTodayMaxSeq'
  | 'appendSales'
  | 'saveProduct'
  | 'deleteProduct'
  | 'saveCategory'
  | 'deleteCategory'
  | 'getSalesHistory'
  | 'cancelSale'

/** GAS が返すエラーコード（docs/design.md 2.1） */
export type ServerErrorCode =
  | 'UNAUTHORIZED'
  | 'TOKEN_EXPIRED'
  | 'TERMINAL_DISABLED'
  | 'LOCK_TIMEOUT'
  | 'VALIDATION_ERROR'
  | 'DUPLICATE_KEY'
  | 'PIN_LOCKED'

/**
 * 通信層が生成するエラーコード。サーバー由来と区別する。
 * どちらの場合も未送信キューは削除しない（docs/design.md 6.6）。
 */
export type ClientErrorCode = 'NETWORK_ERROR' | 'TIMEOUT' | 'MALFORMED_RESPONSE' | 'NOT_CONFIGURED'

export type ApiErrorCode = ServerErrorCode | ClientErrorCode

export interface ApiError {
  code: ApiErrorCode
  message: string
}

export type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: ApiError }

/** トークン認証が必要なリクエストの共通部分 */
export interface AuthedRequest {
  apiToken: string
  terminalCode: TerminalCode
}

// --- 認証・端末登録（docs/design.md 2.5 / 6章） ---

export interface RegisterTerminalRequest {
  pin: string
  terminalName: string
  /** 希望する端末コード。未指定なら GAS が空きの最小コードを採番する */
  requestedCode?: TerminalCode
}

export interface LoginRequest {
  pin: string
  terminalCode: TerminalCode
}

export interface RefreshTokenRequest extends AuthedRequest {}

/** `registerTerminal` / `login` / `refreshToken` に共通の応答 */
export interface AuthResponse {
  terminalCode: TerminalCode
  terminalName: string
  apiToken: string
  expiresAt: IsoDateTime
}

// --- マスタ取得（docs/design.md 2.3） ---

export interface GetMastersRequest extends AuthedRequest {}

export interface GetMastersResponse {
  products: Product[]
  categories: Category[]
  /** 自端末の状態。`無効` ならクライアントは同期を恒久停止する */
  terminalStatus: ActiveFlag
  fetchedAt: IsoDateTime
}

// --- 売上追記（docs/design.md 2.4） ---

export interface AppendSalesRequest extends AuthedRequest {
  sales: SalePayload[]
}

/** `duplicate` は「既に追記済み」。クライアントは成功と同義に扱う（docs/design.md 4.2） */
export type AppendStatus = 'appended' | 'duplicate'

export interface AppendSalesResult {
  saleId: SaleId
  status: AppendStatus
}

export interface AppendSalesResponse {
  results: AppendSalesResult[]
}

// --- 連番の復元（docs/design.md 2.5 / 5.3） ---

export interface GetTodayMaxSeqRequest extends AuthedRequest {
  dateKey: DateKey
}

export interface GetTodayMaxSeqResponse {
  /** シート上に存在する自端末・当日の最大連番。1 件もなければ 0 */
  maxSeq: number
}

// --- マスタ更新（docs/design.md 2.6） ---

export interface SaveProductRequest extends AuthedRequest {
  product: Product
  /** 編集で No. を変更する場合の変更前の No.。新規追加時は省略 */
  originalNo?: number
}

export interface DeleteProductRequest extends AuthedRequest {
  no: number
}

export interface SaveCategoryRequest extends AuthedRequest {
  category: Category
  /**
   * 改名する場合の変更前のカテゴリ名。新規追加時は省略。
   * GAS はこれを見て `商品マスタ` D列を同一ロック内で一括置換する（docs/design.md 1.7）。
   */
  originalName?: string
}

export interface DeleteCategoryRequest extends AuthedRequest {
  name: string
}

// --- 履歴・取消（docs/design.md 2.7 / FR-14・FR-15） ---

export interface GetSalesHistoryRequest extends AuthedRequest {
  dateKey: DateKey
}

export interface GetSalesHistoryResponse {
  /** 全端末分を統合して返す（要件定義 5.4 の「履歴の統合」） */
  sales: SalePayload[]
}

/**
 * 会計取消。GAS が元会計の行を読んでマイナス行を追記するため、オンライン時のみ実行できる
 * （docs/design.md 2.7）。未送信の会計は取り消せない。
 */
export interface CancelSaleRequest extends AuthedRequest {
  saleId: SaleId
}

export interface CancelSaleResponse {
  saleId: SaleId
  canceledAt: IsoDateTime
}

// ============================================================
// 同期状態（docs/design.md 4.3）
// ============================================================

/**
 * 接続状態。真実は直近の GAS リクエストの成否であり、`navigator.onLine` ではない。
 * 一度も通信していない状態が `unknown`。
 */
export type ConnectionState = 'unknown' | 'online' | 'offline'

/** 同期エンジンの停止理由。`disabled` は恒久停止（docs/design.md 6.6） */
export type SyncBlockReason = 'tokenExpired' | 'terminalDisabled' | 'notConfigured'

export interface SyncState {
  connection: ConnectionState
  /** 未送信件数。画面上部のバッジに出す（要件定義 9.1） */
  pendingCount: number
  syncing: boolean
  lastSyncedAt: IsoDateTime | null
  /** 同期が止まっている理由。null なら通常運転 */
  blockedBy: SyncBlockReason | null
}
