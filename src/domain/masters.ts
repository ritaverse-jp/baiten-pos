/**
 * 商品・カテゴリマスタのフォーム検証。要件定義 6.2（FR-01）・6.3（FR-02）を実装する。
 *
 * GAS 側（gas/Products.js・gas/Categories.js）にも同じ検証があり、そちらが
 * 最終的な正（ロック内で判定するため）。ここでの検証は画面での即時フィード
 * バック用で、往復通信なしに明らかな入力ミスを弾く。
 */

import { CALC_ERROR_MESSAGES, validatePrice, type CalcError } from './calc'
import { LIMITS, type Category, type Product } from './types'

export type ProductNoError = 'required' | 'outOfRange'
export type NameError = 'required' | 'tooLong'

export const PRODUCT_NO_ERROR_MESSAGES: Record<ProductNoError, string> = {
  required: 'No. を入力してください',
  outOfRange: `No. は${LIMITS.productNoMin}〜${LIMITS.productNoMax}の範囲で入力してください`,
}

export const PRODUCT_NAME_ERROR_MESSAGES: Record<NameError, string> = {
  required: '商品名を入力してください',
  tooLong: `商品名は${LIMITS.productNameMaxLength}文字以内で入力してください`,
}

export const CATEGORY_NAME_ERROR_MESSAGES: Record<NameError, string> = {
  required: 'カテゴリ名を入力してください',
  tooLong: `カテゴリ名は${LIMITS.categoryNameMaxLength}文字以内で入力してください`,
}

export function validateProductNo(no: number): ProductNoError | null {
  if (!Number.isInteger(no)) return 'required'
  if (no < LIMITS.productNoMin || no > LIMITS.productNoMax) return 'outOfRange'
  return null
}

export function validateProductName(name: string): NameError | null {
  if (name.trim().length === 0) return 'required'
  if (name.length > LIMITS.productNameMaxLength) return 'tooLong'
  return null
}

export function validateCategoryName(name: string): NameError | null {
  if (name.trim().length === 0) return 'required'
  if (name.length > LIMITS.categoryNameMaxLength) return 'tooLong'
  return null
}

/** 要件定義 6.2「既存の No. と重複する登録・編集はエラーとする」。`excludeNo` は編集中の自分自身を除外するため */
export function isProductNoDuplicate(products: readonly Product[], no: number, excludeNo?: number): boolean {
  return products.some((p) => p.no === no && p.no !== excludeNo)
}

/** 要件定義 6.3「カテゴリ名は重複不可」 */
export function isCategoryNameDuplicate(categories: readonly Category[], name: string, excludeName?: string): boolean {
  return categories.some((c) => c.name === name && c.name !== excludeName)
}

/** 要件定義 6.3「商品が1件以上紐づくカテゴリは削除できない」 */
export function categoryHasProducts(products: readonly Product[], categoryName: string): boolean {
  return products.some((p) => p.categoryName === categoryName)
}

// ============================================================
// フォーム全体の検証。ticket.ts が calc.ts の個別検証を束ねて1つの
// エラーコードにまとめるのと同じ形にする（画面側は1箇所だけ見ればよい）。
// ============================================================

export type ProductFormError =
  | 'noRequired'
  | 'noOutOfRange'
  | 'noDuplicate'
  | 'nameRequired'
  | 'nameTooLong'
  | 'categoryRequired'
  | CalcError

export const PRODUCT_FORM_ERROR_MESSAGES: Record<ProductFormError, string> = {
  noRequired: PRODUCT_NO_ERROR_MESSAGES.required,
  noOutOfRange: PRODUCT_NO_ERROR_MESSAGES.outOfRange,
  noDuplicate: 'この No. は既に使われています（要件定義 6.2）',
  nameRequired: PRODUCT_NAME_ERROR_MESSAGES.required,
  nameTooLong: PRODUCT_NAME_ERROR_MESSAGES.tooLong,
  categoryRequired: 'カテゴリを選択してください',
  ...CALC_ERROR_MESSAGES,
}

export interface ProductFormInput {
  no: number
  name: string
  price: number
  categoryName: string
}

/**
 * 商品フォームの全項目検証。`excludeNo` は編集中の商品自身を No. 重複判定から
 * 除外するために渡す（新規追加時は省略）。
 */
export function validateProductForm(
  input: ProductFormInput,
  existingProducts: readonly Product[],
  excludeNo?: number,
): ProductFormError | null {
  const noError = validateProductNo(input.no)
  if (noError === 'required') return 'noRequired'
  if (noError === 'outOfRange') return 'noOutOfRange'
  if (isProductNoDuplicate(existingProducts, input.no, excludeNo)) return 'noDuplicate'

  const nameError = validateProductName(input.name)
  if (nameError === 'required') return 'nameRequired'
  if (nameError === 'tooLong') return 'nameTooLong'

  const priceError = validatePrice(input.price)
  if (priceError) return priceError

  if (input.categoryName.length === 0) return 'categoryRequired'

  return null
}

export type CategoryFormError = 'nameRequired' | 'nameTooLong' | 'nameDuplicate'

export const CATEGORY_FORM_ERROR_MESSAGES: Record<CategoryFormError, string> = {
  nameRequired: CATEGORY_NAME_ERROR_MESSAGES.required,
  nameTooLong: CATEGORY_NAME_ERROR_MESSAGES.tooLong,
  nameDuplicate: 'このカテゴリ名は既に使われています（要件定義 6.3）',
}

export interface CategoryFormInput {
  name: string
}

/** `excludeName` は改名中のカテゴリ自身を重複判定から除外するために渡す（新規追加時は省略） */
export function validateCategoryForm(
  input: CategoryFormInput,
  existingCategories: readonly Category[],
  excludeName?: string,
): CategoryFormError | null {
  const nameError = validateCategoryName(input.name)
  if (nameError === 'required') return 'nameRequired'
  if (nameError === 'tooLong') return 'nameTooLong'

  if (isCategoryNameDuplicate(existingCategories, input.name, excludeName)) return 'nameDuplicate'

  return null
}
