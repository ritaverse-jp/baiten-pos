import { describe, expect, test } from 'vitest'
import { ticketItemCount } from './calc'
import {
  addProductByNo,
  decrementLineQty,
  incrementLineQty,
  isLastUnit,
  removeLine,
  setLineDiscount,
  setLineQty,
  splitLine,
} from './ticket'
import { toYen, type Product, type TicketLine } from './types'

function makeIdGenerator(prefix: string) {
  let n = 0
  return () => `${prefix}-${++n}`
}

function product(overrides: Partial<Product> = {}): Product {
  return {
    no: 1,
    name: 'からあげ串',
    price: toYen(500),
    categoryName: 'フード',
    displayOrder: null,
    status: '有効',
    ...overrides,
  }
}

function line(overrides: Partial<TicketLine> = {}): TicketLine {
  return {
    lineId: 'l1',
    productNo: 1,
    productName: 'からあげ串',
    unitPrice: toYen(500),
    qty: 1,
    discount: toYen(0),
    ...overrides,
  }
}

describe('addProductByNo', () => {
  test('伝票にない No. を追加すると新規行ができる', () => {
    const products = [product()]
    const result = addProductByNo([], products, 1, makeIdGenerator('new'))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.lines).toEqual([
      { lineId: 'new-1', productNo: 1, productName: 'からあげ串', unitPrice: 500, qty: 1, discount: 0 },
    ])
  })

  test('存在しない No. はエラーとし、伝票を変更しない', () => {
    const products = [product({ no: 1 })]
    const result = addProductByNo([], products, 99)
    expect(result).toEqual({ ok: false, error: 'productNotFound' })
  })

  test('販売状態が無効の商品は追加できない', () => {
    const products = [product({ status: '無効' })]
    const result = addProductByNo([], products, 1)
    expect(result).toEqual({ ok: false, error: 'productInactive' })
  })

  test('既存の同じ No. がある場合は新規行を作らず個数を+1する', () => {
    const products = [product()]
    const existing = [line({ qty: 2 })]
    const result = addProductByNo(existing, products, 1, makeIdGenerator('new'))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // 新規行が追加され行数が2になってしまう実装を否定する
    expect(result.lines).toHaveLength(1)
    expect(result.lines[0].qty).toBe(3)
  })

  test('割引済みの行に同一 No. を追加すると、個数だけ増え割引は据え置かれる', () => {
    const products = [product()]
    const existing = [line({ qty: 1, discount: toYen(50) })]
    const result = addProductByNo(existing, products, 1)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.lines).toHaveLength(1)
    expect(result.lines[0].qty).toBe(2)
    // 割引が0にリセットされたり、割引なしの新規行が別に作られたりしてはならない
    expect(result.lines[0].discount).toBe(50)
  })

  test('行を分けた後の追加は、割引0円の行に+1する', () => {
    const products = [product()]
    // 行を分けた後、割引0円の行が「後から作られた行（配列上は2番目）」であるケース
    const split = [
      line({ lineId: 'discounted', qty: 1, discount: toYen(50) }),
      line({ lineId: 'plain', qty: 1, discount: toYen(0) }),
    ]
    const result = addProductByNo(split, products, 1)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const discounted = result.lines.find((l) => l.lineId === 'discounted')
    const plain = result.lines.find((l) => l.lineId === 'plain')
    // 配列上の位置（最初に見つかった行）に+1してしまう実装を否定する。
    // それだと discounted 行が増え、テンキー入力しただけの1点に無断で割引がかかる
    expect(discounted?.qty).toBe(1)
    expect(plain?.qty).toBe(2)
  })

  test('割引0円の行が配列の先頭にある場合も、同じ行に+1する（位置ではなく割引の有無で決まる）', () => {
    const products = [product()]
    const split = [
      line({ lineId: 'plain', qty: 1, discount: toYen(0) }),
      line({ lineId: 'discounted', qty: 1, discount: toYen(50) }),
    ]
    const result = addProductByNo(split, products, 1)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const plain = result.lines.find((l) => l.lineId === 'plain')
    const discounted = result.lines.find((l) => l.lineId === 'discounted')
    expect(plain?.qty).toBe(2)
    expect(discounted?.qty).toBe(1)
  })

  test('全行が割引済みの場合は、最初に見つかった行に+1する（フォールバック）', () => {
    const products = [product()]
    const split = [
      line({ lineId: 'a', qty: 1, discount: toYen(50) }),
      line({ lineId: 'b', qty: 1, discount: toYen(30) }),
    ]
    const result = addProductByNo(split, products, 1)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.lines.find((l) => l.lineId === 'a')?.qty).toBe(2)
    expect(result.lines.find((l) => l.lineId === 'b')?.qty).toBe(1)
  })

  test('個数が上限99に達している行への追加はエラーとし、伝票を変更しない', () => {
    const products = [product()]
    const existing = [line({ qty: 99 })]
    const result = addProductByNo(existing, products, 1)
    expect(result).toEqual({ ok: false, error: 'qtyAboveMax' })
  })

  test('元の配列を書き換えない', () => {
    const products = [product()]
    const original = [line({ qty: 1 })]
    const originalCopy = [...original]
    addProductByNo(original, products, 1)
    expect(original).toEqual(originalCopy)
  })
})

describe('incrementLineQty', () => {
  test('個数を1増やす', () => {
    const result = incrementLineQty([line({ qty: 1 })], 'l1')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.lines[0].qty).toBe(2)
  })

  test('上限99を超える増加はエラーとし、伝票を変更しない', () => {
    const result = incrementLineQty([line({ qty: 99 })], 'l1')
    expect(result).toEqual({ ok: false, error: 'qtyAboveMax' })
  })

  test('存在しない行 ID はエラーとする', () => {
    const result = incrementLineQty([line()], 'missing')
    expect(result).toEqual({ ok: false, error: 'lineNotFound' })
  })
})

describe('isLastUnit', () => {
  test('個数1はtrue', () => {
    expect(isLastUnit({ qty: 1 })).toBe(true)
  })

  test('個数2以上はfalse', () => {
    expect(isLastUnit({ qty: 2 })).toBe(false)
  })
})

describe('decrementLineQty', () => {
  test('個数2以上の行は1減らすだけで残る', () => {
    const result = decrementLineQty([line({ qty: 2 })], 'l1')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.lines).toHaveLength(1)
    expect(result.lines[0].qty).toBe(1)
  })

  test('個数1の行を減らすと行ごと削除される（qty:0の行を残さない）', () => {
    const result = decrementLineQty([line({ qty: 1 })], 'l1')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.lines).toHaveLength(0)
    // 削除されず qty:0 の行が残る実装を否定する
    expect(result.lines.find((l) => l.lineId === 'l1')).toBeUndefined()
  })

  test('他の行には影響しない', () => {
    const lines = [line({ lineId: 'a', qty: 1 }), line({ lineId: 'b', qty: 3 })]
    const result = decrementLineQty(lines, 'a')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.lines).toEqual([expect.objectContaining({ lineId: 'b', qty: 3 })])
  })

  test('存在しない行 ID はエラーとする', () => {
    const result = decrementLineQty([line()], 'missing')
    expect(result).toEqual({ ok: false, error: 'lineNotFound' })
  })
})

describe('setLineQty', () => {
  test('1〜99の範囲内で個数を直接設定できる', () => {
    const result = setLineQty([line({ qty: 1 })], 'l1', 50)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.lines[0].qty).toBe(50)
  })

  test('0を指定すると行が削除される（減算ボタンと同じ扱い）', () => {
    const result = setLineQty([line({ qty: 5 })], 'l1', 0)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.lines).toHaveLength(0)
  })

  test('範囲外の値はエラーとし、伝票を変更しない', () => {
    expect(setLineQty([line()], 'l1', 100)).toEqual({ ok: false, error: 'qtyAboveMax' })
    expect(setLineQty([line()], 'l1', -1)).toEqual({ ok: false, error: 'qtyBelowMin' })
  })

  test('小数はエラーとする', () => {
    expect(setLineQty([line()], 'l1', 1.5)).toEqual({ ok: false, error: 'qtyNotInteger' })
  })

  test('存在しない行 ID はエラーとする', () => {
    expect(setLineQty([line()], 'missing', 5)).toEqual({ ok: false, error: 'lineNotFound' })
  })
})

describe('removeLine', () => {
  test('個数によらず行ごと削除する', () => {
    const result = removeLine([line({ qty: 99 })], 'l1')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.lines).toHaveLength(0)
  })

  test('他の行には影響しない', () => {
    const lines = [line({ lineId: 'a' }), line({ lineId: 'b' })]
    const result = removeLine(lines, 'a')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.lines.map((l) => l.lineId)).toEqual(['b'])
  })

  test('存在しない行 ID はエラーとする', () => {
    expect(removeLine([line()], 'missing')).toEqual({ ok: false, error: 'lineNotFound' })
  })
})

describe('splitLine', () => {
  test('個数を2行に分割し、割引・単価・商品名を引き継ぐ', () => {
    const original = [line({ qty: 3, discount: toYen(50) })]
    const result = splitLine(original, 'l1', 1, makeIdGenerator('split'))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.lines).toHaveLength(2)
    expect(result.lines[0]).toEqual(expect.objectContaining({ lineId: 'l1', qty: 2, discount: 50 }))
    expect(result.lines[1]).toEqual(
      expect.objectContaining({
        lineId: 'split-1',
        productNo: 1,
        productName: 'からあげ串',
        unitPrice: 500,
        qty: 1,
        discount: 50,
      }),
    )
  })

  test('分割前後で総個数が変わらない', () => {
    const original = [line({ qty: 5 })]
    const result = splitLine(original, 'l1', 2)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(ticketItemCount(result.lines)).toBe(ticketItemCount(original))
  })

  test('分割後、元の行を割引前の単価から書き換えてはならない', () => {
    const original = [line({ qty: 4, unitPrice: toYen(500) })]
    const result = splitLine(original, 'l1', 1)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // 分割は割引を変えない操作であり、単価を割引後の値に変換してしまう実装を否定する
    for (const l of result.lines) {
      expect(l.unitPrice).toBe(500)
    }
  })

  test('分割数量が0以下はエラーとする', () => {
    expect(splitLine([line({ qty: 3 })], 'l1', 0)).toEqual({ ok: false, error: 'splitQtyTooSmall' })
    expect(splitLine([line({ qty: 3 })], 'l1', -1)).toEqual({ ok: false, error: 'splitQtyTooSmall' })
  })

  test('分割数量が元の個数以上はエラーとする（全量の切り出しは分割ではない）', () => {
    expect(splitLine([line({ qty: 3 })], 'l1', 3)).toEqual({ ok: false, error: 'splitQtyTooLarge' })
    expect(splitLine([line({ qty: 3 })], 'l1', 4)).toEqual({ ok: false, error: 'splitQtyTooLarge' })
  })

  test('存在しない行 ID はエラーとする', () => {
    expect(splitLine([line()], 'missing', 1)).toEqual({ ok: false, error: 'lineNotFound' })
  })
})

describe('setLineDiscount', () => {
  test('割引額を設定できる', () => {
    const result = setLineDiscount([line({ unitPrice: toYen(500) })], 'l1', 50)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.lines[0].discount).toBe(50)
  })

  test('単価を超える割引はエラーとし、伝票を変更しない', () => {
    const result = setLineDiscount([line({ unitPrice: toYen(500) })], 'l1', 600)
    expect(result).toEqual({ ok: false, error: 'discountExceedsUnitPrice' })
  })

  test('負の割引はエラーとする', () => {
    expect(setLineDiscount([line()], 'l1', -1)).toEqual({ ok: false, error: 'discountNegative' })
  })

  test('lineId で対象を特定し、同一商品の他の行には影響しない', () => {
    // 行を分けた後の2行に対して、指定した行だけに割引が適用されることを確認する
    const lines = [
      line({ lineId: 'a', productNo: 1, unitPrice: toYen(500), discount: toYen(0) }),
      line({ lineId: 'b', productNo: 1, unitPrice: toYen(500), discount: toYen(0) }),
    ]
    const result = setLineDiscount(lines, 'b', 100)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const a = result.lines.find((l) => l.lineId === 'a')
    const b = result.lines.find((l) => l.lineId === 'b')
    // productNo が同じ行すべてに割引をかけてしまう実装を否定する
    expect(a?.discount).toBe(0)
    expect(b?.discount).toBe(100)
  })

  test('存在しない行 ID はエラーとする', () => {
    expect(setLineDiscount([line()], 'missing', 10)).toEqual({ ok: false, error: 'lineNotFound' })
  })
})
