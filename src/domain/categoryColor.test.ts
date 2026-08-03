import { describe, expect, test } from 'vitest'
import {
  contrastRatio,
  PALETTE_SWATCHES,
  PHOTO_SCRIM_ALPHA,
  resolveCategoryPalette,
  worstCaseScrimContrast,
} from './categoryColor'
import type { Category } from './types'

const MIN_CONTRAST = 4.5 // 要件定義7.3「背景と文字のコントラスト比4.5:1以上を確保」

function category(overrides: Partial<Category> = {}): Category {
  return { name: 'フード', displayOrder: 0, color: null, ...overrides }
}

describe('contrastRatio', () => {
  test('黒と白は21:1（WCAGの理論最大値）', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1)
  })

  test('同色は1:1', () => {
    expect(contrastRatio('#ff0000', '#ff0000')).toBeCloseTo(1, 5)
  })

  test('順序を入れ替えても同じ値になる', () => {
    expect(contrastRatio('#123456', '#abcdef')).toBeCloseTo(contrastRatio('#abcdef', '#123456'), 10)
  })
})

describe('resolveCategoryPalette', () => {
  test('カテゴリ未選択（null）は中立色を返す', () => {
    const palette = resolveCategoryPalette([category()], null)
    expect(contrastRatio(palette.tabBackground, palette.tabText)).toBeGreaterThanOrEqual(MIN_CONTRAST)
  })

  test('存在しないカテゴリ名は中立色にフォールバックする', () => {
    const palette = resolveCategoryPalette([category({ name: 'フード' })], '存在しない')
    expect(contrastRatio(palette.tabBackground, palette.tabText)).toBeGreaterThanOrEqual(MIN_CONTRAST)
  })

  describe('要件定義7.3：全パレットがコントラスト比4.5:1以上を満たす', () => {
    // 件数は PALETTE_SWATCHES から導出する。パレットに色を足したとき、
    // 追加分が検証されないまま通ってしまうのを防ぐため
    const PALETTE_SIZE = PALETTE_SWATCHES.length

    test('color未設定のカテゴリを既定パレット一巡ぶん並べても、タブ・タイルとも4.5:1以上', () => {
      const categories = Array.from({ length: PALETTE_SIZE }, (_, i) =>
        category({ name: `カテゴリ${i}`, displayOrder: i, color: null }),
      )

      categories.forEach((c) => {
        const palette = resolveCategoryPalette(categories, c.name)
        expect(contrastRatio(palette.tabBackground, palette.tabText)).toBeGreaterThanOrEqual(MIN_CONTRAST)
        expect(contrastRatio(palette.tileBackground, palette.tileText)).toBeGreaterThanOrEqual(MIN_CONTRAST)
      })
    })

    test('パレットが一巡して繰り返される件目も4.5:1以上', () => {
      const categories = Array.from({ length: PALETTE_SIZE + 1 }, (_, i) =>
        category({ name: `カテゴリ${i}`, displayOrder: i, color: null }),
      )
      const palette = resolveCategoryPalette(categories, `カテゴリ${PALETTE_SIZE}`)
      expect(contrastRatio(palette.tabBackground, palette.tabText)).toBeGreaterThanOrEqual(MIN_CONTRAST)
      expect(contrastRatio(palette.tileBackground, palette.tileText)).toBeGreaterThanOrEqual(MIN_CONTRAST)
    })

    /*
     * 商品タイルに写真を敷くと、文字の背景が「管理者が登録した任意の画像」に
     * なる。色を事前に知れないため、文字の背後に不透明な下地を敷いて
     * コントラストを保証する（タスク24）。最悪ケースは写真が純黒のとき
     */
    test('写真の下地は、写真が純黒でも4.5:1以上を満たす', () => {
      expect(worstCaseScrimContrast(PHOTO_SCRIM_ALPHA)).toBeGreaterThanOrEqual(MIN_CONTRAST)
    })

    test('全パレットが写真用の下地を持ち、その下地でも4.5:1以上', () => {
      const categories = Array.from({ length: PALETTE_SWATCHES.length }, (_, i) =>
        category({ name: `カテゴリ${i}`, displayOrder: i, color: null }),
      )

      categories.forEach((c) => {
        const palette = resolveCategoryPalette(categories, c.name)
        expect(palette.photoScrim).toMatch(/^rgba\(255, 255, 255, /)
        // 下地は白のみ（カテゴリ色を混ぜない）。混ぜると色ごとに保証が変わる
        expect(worstCaseScrimContrast(PHOTO_SCRIM_ALPHA, palette.tileText)).toBeGreaterThanOrEqual(MIN_CONTRAST)
      })
    })

    /*
     * 不透明度を下げると写真はよく見えるが、あるところで 4.5:1 を割る。
     * 「下げるときは必ずテストで確認する」という制約を、テスト自体で示しておく
     */
    test('不透明度を0.5まで下げると4.5:1を割る（下限の存在を明示する）', () => {
      expect(worstCaseScrimContrast(0.5)).toBeLessThan(MIN_CONTRAST)
    })

    test('スウォッチどうしが同じ色になっていない（見分けがつくこと）', () => {
      const colors = PALETTE_SWATCHES.map((s) => s.color.toLowerCase())
      expect(new Set(colors).size).toBe(colors.length)

      const names = PALETTE_SWATCHES.map((s) => s.name)
      expect(new Set(names).size).toBe(names.length)
    })
  })

  describe('管理者が任意に設定したcolor（要件定義6.3）を使う場合も4.5:1以上を保証する', () => {
    // 純黒・純白を含む極端な値と、代表的な有彩色をサンプルにする
    const sampleColors = [
      '#000000', // 純黒（最も暗い）
      '#ffffff', // 純白（最も明るい）
      '#ff0000',
      '#00ff00',
      '#0000ff',
      '#ffff00',
      '#00ffff',
      '#ff00ff',
      '#808080',
      '#f97316', // タスク19までのテストで使ったオレンジ
    ]

    test.each(sampleColors)('color: %s', (color) => {
      const categories = [category({ name: 'カスタム', displayOrder: 0, color })]
      const palette = resolveCategoryPalette(categories, 'カスタム')

      expect(contrastRatio(palette.tabBackground, palette.tabText)).toBeGreaterThanOrEqual(MIN_CONTRAST)
      expect(contrastRatio(palette.tileBackground, palette.tileText)).toBeGreaterThanOrEqual(MIN_CONTRAST)
    })

    test('管理者色が設定されている場合、tabBackgroundはその色そのものを使う', () => {
      const categories = [category({ name: 'カスタム', color: '#f97316' })]
      const palette = resolveCategoryPalette(categories, 'カスタム')
      expect(palette.tabBackground).toBe('#f97316')
    })
  })

  describe('不正なcolor値', () => {
    test('16進数として解釈できないcolorは既定パレットにフォールバックする', () => {
      const categories = [category({ name: 'こわれた', displayOrder: 0, color: 'not-a-color' })]
      const palette = resolveCategoryPalette(categories, 'こわれた')
      expect(contrastRatio(palette.tabBackground, palette.tabText)).toBeGreaterThanOrEqual(MIN_CONTRAST)
      expect(palette.tabBackground).toBe('#c2410c') // DEFAULT_PALETTE[0]
    })
  })

  test('同じカテゴリ名には常に同じ配色を返す（安定性）', () => {
    const categories = [category({ name: 'A', displayOrder: 0 }), category({ name: 'B', displayOrder: 1 })]
    const first = resolveCategoryPalette(categories, 'B')
    const second = resolveCategoryPalette(categories, 'B')
    expect(first).toEqual(second)
  })

  test('表示順（displayOrder）でパレットを割り当てる。並び替えても同じカテゴリは同じ色を保つ', () => {
    const categories = [category({ name: 'B', displayOrder: 1 }), category({ name: 'A', displayOrder: 0 })]
    // 配列の並び順とdisplayOrderが食い違っていても、displayOrderでソートしてから割り当てる
    const paletteA = resolveCategoryPalette(categories, 'A')
    const paletteB = resolveCategoryPalette(categories, 'B')
    expect(paletteA).not.toEqual(paletteB)
  })
})
