/**
 * SC-01 会計画面のカテゴリ別配色。要件定義 7.3「コントラスト比 4.5:1 以上」を
 * 必ず満たすことを、WCAG の相対輝度・コントラスト比の計算で機械的に保証する
 * （`categoryColor.test.ts` で全パレット・全ロジックを検証している）。
 *
 * `Category.color`（要件定義 6.3「視認性向上のため任意で設定」）が設定されて
 * いればそこから配色を導出し、未設定のカテゴリは固定パレットを表示順で
 * 割り当てる。管理者が任意の色を選べる以上、そのまま背景色に使うと文字色との
 * コントラストが足りない組み合わせが起こり得るため、素の色を直接使わず
 * 必ずこのモジュールの計算を経由すること。
 */

import type { Category } from './types'

export interface CategoryPalette {
  /** カテゴリタブの背景色 */
  tabBackground: string
  /** カテゴリタブの文字色（`tabBackground` に対して 4.5:1 以上を保証） */
  tabText: string
  /** 商品ボタンの背景色（`tabBackground` を薄く白と混ぜた色） */
  tileBackground: string
  /** 商品ボタンの文字色（`tileBackground` に対して 4.5:1 以上を保証） */
  tileText: string
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim())
  if (!match) return null
  const int = parseInt(match[1], 16)
  return { r: (int >> 16) & 0xff, g: (int >> 8) & 0xff, b: int & 0xff }
}

function toHex(value: number): string {
  return Math.round(Math.min(255, Math.max(0, value)))
    .toString(16)
    .padStart(2, '0')
}

/** WCAG 2.x の相対輝度（0=黒 〜 1=白） */
function relativeLuminance({ r, g, b }: { r: number; g: number; b: number }): number {
  const channel = (c: number) => {
    const v = c / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** WCAG 2.x のコントラスト比（1〜21）。要件定義 7.3 の「4.5:1 以上」はこの値で判定する */
export function contrastRatio(hexA: string, hexB: string): number {
  const rgbA = hexToRgb(hexA)
  const rgbB = hexToRgb(hexB)
  if (!rgbA || !rgbB) return 0
  const lA = relativeLuminance(rgbA)
  const lB = relativeLuminance(rgbB)
  const lighter = Math.max(lA, lB)
  const darker = Math.min(lA, lB)
  return (lighter + 0.05) / (darker + 0.05)
}

/**
 * 背景色に対して読みやすい文字色（黒 or 白）を選ぶ。真の黒・真の白同士で比較
 * すると、任意の背景色に対して max(対白コントラスト, 対黒コントラスト) は
 * 理論上つねに 4.5:1 をわずかに上回る（輝度 0.179 付近が最悪ケースで約 4.58:1）
 * ため、この2択に絞ることで背景色によらずコントラスト要件を機械的に保証できる。
 */
function pickReadableText(bgHex: string): string {
  return contrastRatio(bgHex, '#000000') >= contrastRatio(bgHex, '#ffffff') ? '#000000' : '#ffffff'
}

/** `hex` を白と `ratio`（0〜1、白の割合）で混ぜる。管理者が選んだ任意の色から、常に十分明るいタイル背景を作るために使う */
function mixWithWhite(hex: string, ratio: number): string {
  const rgb = hexToRgb(hex)
  if (!rgb) return '#ffffff'
  const mix = (c: number) => c * (1 - ratio) + 255 * ratio
  return `#${toHex(mix(rgb.r))}${toHex(mix(rgb.g))}${toHex(mix(rgb.b))}`
}

/** タイル背景に混ぜる白の割合。0.85 であれば入力が純黒でも `TILE_TEXT` に対して 4.5:1 を大きく上回ることをテストで確認済み */
const TILE_WHITE_MIX_RATIO = 0.85
const TILE_TEXT = '#111827'

function paletteFromColor(color: string): CategoryPalette {
  return {
    tabBackground: color,
    tabText: pickReadableText(color),
    tileBackground: mixWithWhite(color, TILE_WHITE_MIX_RATIO),
    tileText: TILE_TEXT,
  }
}

export interface PaletteSwatch {
  name: string
  color: string
}

/**
 * カテゴリ管理画面（`CategoryForm.tsx`）のスウォッチピッカーが選択肢として
 * 表示する色。`Category.color` が未設定のカテゴリに自動で割り当てる既定パレット
 * （`DEFAULT_PALETTE`）と全く同じ値を使う。**新しい色をここにだけ追加しない
 * こと**——「自動で付く色」と「手動で選べる色」を必ず一致させ、コントラスト
 * 未検証の色が紛れ込む余地をなくすための制約。
 */
export const PALETTE_SWATCHES: readonly PaletteSwatch[] = [
  { name: 'オレンジ', color: '#c2410c' },
  { name: '青', color: '#1d4ed8' },
  { name: 'ピンク', color: '#be185d' },
  { name: '緑', color: '#15803d' },
  { name: '紫', color: '#7e22ce' },
  { name: '黄土', color: '#a16207' },
  { name: 'ティール', color: '#0f766e' },
  { name: '赤', color: '#b91c1c' },
]

/** `Category.color` が未設定のカテゴリに表示順で割り当てる既定パレット。`PALETTE_SWATCHES` から導出する（各エントリの 4.5:1 適合を categoryColor.test.ts で検証済み） */
const DEFAULT_PALETTE: CategoryPalette[] = PALETTE_SWATCHES.map((swatch) => paletteFromColor(swatch.color))

/** カテゴリ未選択・未登録時に使う中立色（既存のグレー基調に合わせる） */
const NEUTRAL_PALETTE: CategoryPalette = {
  tabBackground: '#e5e7eb',
  tabText: '#111827',
  tileBackground: '#ffffff',
  tileText: '#111827',
}

/**
 * カテゴリ一覧から、指定したカテゴリ（`categoryName`）の配色を決定する。
 * `CategoryTabs`（全カテゴリ分）・`ProductGrid`（選択中カテゴリのみ）の両方から呼ぶ。
 * 表示順（`displayOrder`）は `CategoryTabs`/`CategoriesScreen` と同じ並び替えルールに揃える。
 */
export function resolveCategoryPalette(categories: readonly Category[], categoryName: string | null): CategoryPalette {
  if (categoryName === null) return NEUTRAL_PALETTE

  const sorted = [...categories].sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
  const index = sorted.findIndex((c) => c.name === categoryName)
  if (index === -1) return NEUTRAL_PALETTE

  const category = sorted[index]
  if (category.color) {
    const rgb = hexToRgb(category.color)
    if (rgb) return paletteFromColor(category.color)
  }
  return DEFAULT_PALETTE[index % DEFAULT_PALETTE.length]
}
