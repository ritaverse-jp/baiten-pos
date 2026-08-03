/**
 * 商品写真を画面で表示するための object URL を、アプリ全体で1本ずつ共有する
 * （タスク24・伝票行への表示）。
 *
 * **画面ごとに `URL.createObjectURL` を呼ばないこと。** 同じ写真が会計画面の
 * 商品タイルと伝票行に同時に出るうえ、伝票行は個数変更のたびに再描画される。
 * 都度作る作りにすると object URL が際限なく増え、解放漏れになる。
 *
 * `subscribeProductImages()`（`data/db/productImages.ts`）を購読しており、
 * **バックグラウンドで写真が届いたら自動的に画面へ反映される。** 写真の取得は
 * GAS への往復を挟むため画面を描いた後に完了するのが普通で、購読しないと
 * 「開いた瞬間に手元にあったものだけ」を表示して固まる（実際にこれで
 * 「保存したのにプレビューに出ない」不具合になった経緯がある）。
 *
 * 写真を差し替えると Drive のファイルIDが変わる設計のため、**同じ画像IDで
 * 中身だけが変わることはない。** よって「IDが増えたら作る／消えたら解放する」
 * だけでよく、内容の更新を検知する仕組みは要らない。
 */

import { useSyncExternalStore } from 'react'
import { getCachedImageIds, getProductImageBlob, subscribeProductImages } from '@/data/db/productImages'

/** 画像ID → object URL。差し替えが起きたときだけ Map ごと作り直す（参照の同一性で変更を検知させる） */
let urls: ReadonlyMap<string, string> = new Map()

const listeners = new Set<() => void>()
let started = false
/** キャッシュ更新の購読解除。アプリ稼働中は解除しないが、テストのリセットに必要 */
let unsubscribeFromCache: (() => void) | null = null

function notify(): void {
  for (const listener of listeners) listener()
}

/**
 * IndexedDB の内容に合わせて object URL の一覧を作り直す。
 * 増えたぶんだけ作り、消えたぶんを解放する。変化が無ければ何もしない
 * （`useSyncExternalStore` に同じ参照を返し続けるため、無駄な再描画が起きない）。
 */
async function rebuild(): Promise<void> {
  const cachedIds = new Set(await getCachedImageIds())
  const next = new Map(urls)
  let changed = false

  for (const [imageId, url] of urls) {
    if (cachedIds.has(imageId)) continue
    URL.revokeObjectURL(url)
    next.delete(imageId)
    changed = true
  }

  for (const imageId of cachedIds) {
    if (next.has(imageId)) continue
    const blob = await getProductImageBlob(imageId)
    if (!blob) continue
    next.set(imageId, URL.createObjectURL(blob))
    changed = true
  }

  if (!changed) return
  urls = next
  notify()
}

/** 最初に使われたときだけ、初期読み込みとキャッシュ更新の購読を始める */
function ensureStarted(): void {
  if (started) return
  started = true
  unsubscribeFromCache = subscribeProductImages(() => void rebuild())
  void rebuild()
}

function subscribe(listener: () => void): () => void {
  ensureStarted()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): ReadonlyMap<string, string> {
  return urls
}

/**
 * 指定した画像IDの表示用 URL を返す。未取得・未設定なら `null`。
 *
 * **`null` は異常ではない**（オフラインで一度も取得していない・写真未設定）。
 * 呼び出し側は写真なしの見た目にフォールバックし、操作は一切制限しないこと
 * （要件定義 9.1：写真の取得可否が会計業務の可否を左右してはならない）。
 */
export function useProductImageUrl(imageId: string | null | undefined): string | null {
  const map = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  if (!imageId) return null
  return map.get(imageId) ?? null
}

/**
 * テスト用。モジュールスコープの状態をリセットする。
 *
 * **キャッシュ側の購読解除を忘れないこと。** これを怠るとテストごとに購読が
 * 積み上がり、1回の更新で古い `rebuild` が同時に何本も走って同じ画像に複数の
 * object URL が作られる（実際にこれでテストが落ちた）。
 */
export function __resetProductImageUrlsForTests(): void {
  unsubscribeFromCache?.()
  unsubscribeFromCache = null
  for (const url of urls.values()) URL.revokeObjectURL(url)
  urls = new Map()
  listeners.clear()
  started = false
}
