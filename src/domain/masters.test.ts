import { describe, expect, test } from 'vitest'
import { toYen } from './types'
import {
  categoryHasProducts,
  isCategoryNameDuplicate,
  isProductNoDuplicate,
  validateCategoryForm,
  validateCategoryName,
  validateProductForm,
  validateProductName,
  validateProductNo,
} from './masters'

describe('validateProductNo', () => {
  test('1〜99の範囲は許可する（境界値）', () => {
    expect(validateProductNo(1)).toBeNull()
    expect(validateProductNo(99)).toBeNull()
  })

  test('0は範囲外', () => {
    expect(validateProductNo(0)).toBe('outOfRange')
  })

  test('100は範囲外', () => {
    expect(validateProductNo(100)).toBe('outOfRange')
  })

  test('整数でない値はrequired扱い', () => {
    expect(validateProductNo(1.5)).toBe('required')
    expect(validateProductNo(NaN)).toBe('required')
  })
})

describe('validateProductName', () => {
  test('30文字ちょうどは許可する', () => {
    expect(validateProductName('あ'.repeat(30))).toBeNull()
  })

  test('31文字はtooLong', () => {
    expect(validateProductName('あ'.repeat(31))).toBe('tooLong')
  })

  test('空文字・空白のみはrequired', () => {
    expect(validateProductName('')).toBe('required')
    expect(validateProductName('   ')).toBe('required')
  })
})

describe('validateCategoryName', () => {
  test('20文字ちょうどは許可する', () => {
    expect(validateCategoryName('あ'.repeat(20))).toBeNull()
  })

  test('21文字はtooLong', () => {
    expect(validateCategoryName('あ'.repeat(21))).toBe('tooLong')
  })

  test('空文字はrequired', () => {
    expect(validateCategoryName('')).toBe('required')
  })
})

const product = (no: number, categoryName = 'カテゴリA') => ({
  no,
  name: `商品${no}`,
  price: toYen(100),
  categoryName,
  displayOrder: null,
  status: '有効' as const,
})

describe('isProductNoDuplicate', () => {
  test('既存のNo.と重複していれば true', () => {
    expect(isProductNoDuplicate([product(1)], 1)).toBe(true)
  })

  test('excludeNoに一致する行自身は重複とみなさない（編集時）', () => {
    expect(isProductNoDuplicate([product(1)], 1, 1)).toBe(false)
  })

  test('重複がなければ false', () => {
    expect(isProductNoDuplicate([product(1)], 2)).toBe(false)
  })
})

describe('isCategoryNameDuplicate', () => {
  const category = (name: string) => ({ name, displayOrder: null, color: null })

  test('既存のカテゴリ名と重複していれば true', () => {
    expect(isCategoryNameDuplicate([category('飲み物')], '飲み物')).toBe(true)
  })

  test('excludeNameに一致する自分自身は重複とみなさない（改名時）', () => {
    expect(isCategoryNameDuplicate([category('飲み物')], '飲み物', '飲み物')).toBe(false)
  })
})

describe('categoryHasProducts', () => {
  test('紐づく商品が1件以上あれば true（要件定義6.3：削除不可の判定）', () => {
    expect(categoryHasProducts([product(1, 'カテゴリA')], 'カテゴリA')).toBe(true)
  })

  test('紐づく商品がなければ false', () => {
    expect(categoryHasProducts([product(1, 'カテゴリA')], 'カテゴリB')).toBe(false)
  })
})

describe('validateProductForm', () => {
  const validInput = { no: 5, name: '新商品', price: 300, categoryName: 'カテゴリA' }

  test('妥当な入力はnull', () => {
    expect(validateProductForm(validInput, [])).toBeNull()
  })

  test('No.重複はnoDuplicate（新規追加時）', () => {
    expect(validateProductForm(validInput, [product(5)])).toBe('noDuplicate')
  })

  test('編集時はexcludeNoで自分自身を重複から除外する', () => {
    expect(validateProductForm(validInput, [product(5)], 5)).toBeNull()
  })

  test('金額が負ならcalc.tsのpriceNegativeを返す', () => {
    expect(validateProductForm({ ...validInput, price: -1 }, [])).toBe('priceNegative')
  })

  test('カテゴリ未選択はcategoryRequired', () => {
    expect(validateProductForm({ ...validInput, categoryName: '' }, [])).toBe('categoryRequired')
  })

  test('No.が範囲外ならnoOutOfRange（名前や金額のエラーより先に判定する）', () => {
    expect(validateProductForm({ ...validInput, no: 0, name: '' }, [])).toBe('noOutOfRange')
  })
})

describe('validateCategoryForm', () => {
  test('妥当な入力はnull', () => {
    expect(validateCategoryForm({ name: '飲み物' }, [])).toBeNull()
  })

  test('重複はnameDuplicate', () => {
    expect(validateCategoryForm({ name: '飲み物' }, [{ name: '飲み物', displayOrder: null, color: null }])).toBe(
      'nameDuplicate',
    )
  })

  test('改名時はexcludeNameで自分自身を重複から除外する', () => {
    expect(
      validateCategoryForm({ name: '飲み物' }, [{ name: '飲み物', displayOrder: null, color: null }], '飲み物'),
    ).toBeNull()
  })
})
