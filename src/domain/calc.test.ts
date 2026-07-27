import { describe, expect, test } from 'vitest'
import {
  buildSaleLines,
  canConfirm,
  change,
  isSettleable,
  lineDiscountTotal,
  lineSubtotal,
  netUnitPrice,
  saleLinesTotal,
  shortage,
  ticketDiscountTotal,
  ticketItemCount,
  ticketTotal,
  validateDiscount,
  validatePrice,
  validateQty,
  validateReceived,
  validateTicketLine,
} from './calc'
import { toYen, type TicketLine } from './types'

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

describe('netUnitPrice', () => {
  test('単価から1点あたりの割引額を引く', () => {
    expect(netUnitPrice({ unitPrice: toYen(500), discount: toYen(50) })).toBe(450)
  })

  test('割引なしなら単価のまま', () => {
    expect(netUnitPrice({ unitPrice: toYen(500), discount: toYen(0) })).toBe(500)
  })

  test('割引が単価と同額なら0円', () => {
    expect(netUnitPrice({ unitPrice: toYen(500), discount: toYen(500) })).toBe(0)
  })
})

describe('lineSubtotal', () => {
  test('要件定義 6.6 の例：単価500・個数2・割引50 → 900円', () => {
    expect(lineSubtotal({ unitPrice: toYen(500), discount: toYen(50), qty: 2 })).toBe(900)
  })

  test('割引は合計からではなく1点あたりの単価から引く', () => {
    // 合計から引く実装だと (500 * 2) - 50 = 950 になってしまう
    expect(lineSubtotal({ unitPrice: toYen(500), discount: toYen(50), qty: 2 })).not.toBe(950)
  })

  test('個数1なら割引後単価と一致する', () => {
    expect(lineSubtotal({ unitPrice: toYen(300), discount: toYen(30), qty: 1 })).toBe(270)
  })

  test('個数の上限99でも整数のまま計算できる', () => {
    expect(lineSubtotal({ unitPrice: toYen(600), discount: toYen(0), qty: 99 })).toBe(59400)
  })

  test('割引が単価と同額なら個数によらず0円', () => {
    expect(lineSubtotal({ unitPrice: toYen(500), discount: toYen(500), qty: 3 })).toBe(0)
  })
})

describe('lineDiscountTotal', () => {
  test('1点あたりの割引額に個数を掛ける', () => {
    expect(lineDiscountTotal({ discount: toYen(50), qty: 2 })).toBe(100)
  })
})

describe('ticketTotal', () => {
  test('全行の行小計を合計する', () => {
    const lines = [
      line({ lineId: 'a', unitPrice: toYen(500), discount: toYen(50), qty: 2 }), // 900
      line({ lineId: 'b', unitPrice: toYen(200), discount: toYen(0), qty: 1 }), // 200
    ]
    expect(ticketTotal(lines)).toBe(1100)
  })

  test('空の伝票は0円', () => {
    expect(ticketTotal([])).toBe(0)
  })

  test('要件定義 7.2 のレイアウト例と一致する', () => {
    // ①からあげ串 500円×2 割引50円 ＝ 900円、④ラムネ 200円×1 ＝ 200円
    const lines = [
      line({ lineId: 'a', productNo: 1, unitPrice: toYen(500), discount: toYen(50), qty: 2 }),
      line({ lineId: 'b', productNo: 4, productName: 'ラムネ', unitPrice: toYen(200), qty: 1 }),
    ]
    expect(ticketTotal(lines)).toBe(1100)
  })
})

describe('ticketItemCount', () => {
  test('個数の総和を返す', () => {
    expect(ticketItemCount([line({ qty: 2 }), line({ lineId: 'b', qty: 3 })])).toBe(5)
  })

  test('空の伝票は0点', () => {
    expect(ticketItemCount([])).toBe(0)
  })
})

describe('ticketDiscountTotal', () => {
  test('全行の割引総額を返す', () => {
    const lines = [
      line({ lineId: 'a', discount: toYen(50), qty: 2 }), // 100
      line({ lineId: 'b', discount: toYen(10), qty: 3 }), // 30
    ]
    expect(ticketDiscountTotal(lines)).toBe(130)
  })
})

describe('change', () => {
  test('預かり金から合計を引く', () => {
    expect(change(toYen(1200), toYen(2000))).toBe(800)
  })

  test('ちょうどなら0円', () => {
    expect(change(toYen(1200), toYen(1200))).toBe(0)
  })

  test('不足している場合は負の値を返す', () => {
    expect(change(toYen(1200), toYen(1000))).toBe(-200)
  })
})

describe('shortage', () => {
  test('不足額を正の値で返す', () => {
    expect(shortage(toYen(1200), toYen(1000))).toBe(200)
  })

  test('足りている場合は0', () => {
    expect(shortage(toYen(1200), toYen(2000))).toBe(0)
    expect(shortage(toYen(1200), toYen(1200))).toBe(0)
  })
})

describe('isSettleable', () => {
  test('預かり金が合計以上なら成立する', () => {
    expect(isSettleable(toYen(1200), toYen(1200))).toBe(true)
    expect(isSettleable(toYen(1200), toYen(1201))).toBe(true)
  })

  test('1円でも不足していれば成立しない', () => {
    expect(isSettleable(toYen(1200), toYen(1199))).toBe(false)
  })

  test('合計0円なら預かり金0円でも成立する', () => {
    expect(isSettleable(toYen(0), toYen(0))).toBe(true)
  })
})

describe('canConfirm', () => {
  test('伝票があり預かり金が足りていれば確定できる', () => {
    expect(canConfirm([line({ unitPrice: toYen(500), qty: 1 })], toYen(500))).toBe(true)
  })

  test('預かり金が不足していれば確定できない', () => {
    expect(canConfirm([line({ unitPrice: toYen(500), qty: 1 })], toYen(499))).toBe(false)
  })

  test('空の伝票は確定できない', () => {
    expect(canConfirm([], toYen(0))).toBe(false)
    expect(canConfirm([], toYen(1000))).toBe(false)
  })
})

describe('validatePrice', () => {
  test('0円以上の整数を受け付ける', () => {
    expect(validatePrice(0)).toBeNull()
    expect(validatePrice(500)).toBeNull()
  })

  test('負数・小数を拒否する', () => {
    expect(validatePrice(-1)).toBe('priceNegative')
    expect(validatePrice(1.5)).toBe('priceNotInteger')
    expect(validatePrice(NaN)).toBe('priceNotInteger')
  })
})

describe('validateDiscount', () => {
  test('0円以上・単価以下を受け付ける', () => {
    expect(validateDiscount(toYen(500), 0)).toBeNull()
    expect(validateDiscount(toYen(500), 500)).toBeNull()
  })

  test('単価を超える割引を拒否する', () => {
    expect(validateDiscount(toYen(500), 501)).toBe('discountExceedsUnitPrice')
  })

  test('負数・小数を拒否する', () => {
    expect(validateDiscount(toYen(500), -1)).toBe('discountNegative')
    expect(validateDiscount(toYen(500), 0.5)).toBe('discountNotInteger')
  })
})

describe('validateQty', () => {
  test('1〜99を受け付ける', () => {
    expect(validateQty(1)).toBeNull()
    expect(validateQty(99)).toBeNull()
  })

  test('範囲外を拒否する', () => {
    expect(validateQty(0)).toBe('qtyBelowMin')
    expect(validateQty(-1)).toBe('qtyBelowMin')
    expect(validateQty(100)).toBe('qtyAboveMax')
  })

  test('小数を拒否する', () => {
    expect(validateQty(1.5)).toBe('qtyNotInteger')
  })
})

describe('validateReceived', () => {
  test('0円以上の整数を受け付ける', () => {
    expect(validateReceived(0)).toBeNull()
    expect(validateReceived(10000)).toBeNull()
  })

  test('負数・小数を拒否する', () => {
    expect(validateReceived(-1)).toBe('receivedNegative')
    expect(validateReceived(0.5)).toBe('receivedNotInteger')
  })
})

describe('validateTicketLine', () => {
  test('妥当な行はnullを返す', () => {
    expect(validateTicketLine(line({ unitPrice: toYen(500), discount: toYen(50), qty: 2 }))).toBeNull()
  })

  test('割引が単価を超える行を弾く', () => {
    expect(validateTicketLine(line({ unitPrice: toYen(500), discount: toYen(600) }))).toBe(
      'discountExceedsUnitPrice',
    )
  })

  test('個数が範囲外の行を弾く', () => {
    expect(validateTicketLine(line({ qty: 0 }))).toBe('qtyBelowMin')
  })
})

describe('buildSaleLines', () => {
  const lines = [
    line({ lineId: 'a', productName: 'からあげ串', unitPrice: toYen(500), discount: toYen(50), qty: 2 }),
    line({ lineId: 'b', productName: 'ラムネ', unitPrice: toYen(200), qty: 1 }),
  ]

  test('lineNoを1始まりで振る', () => {
    expect(buildSaleLines(lines).map((l) => l.lineNo)).toEqual([1, 2])
  })

  test('単価は割引後の金額を書き込む', () => {
    expect(buildSaleLines(lines)[0].netUnitPrice).toBe(450)
  })

  test('小計は割引後単価×個数', () => {
    expect(buildSaleLines(lines)[0].subtotal).toBe(900)
  })

  test('1点あたりの割引額をそのまま持つ', () => {
    expect(buildSaleLines(lines)[0].discount).toBe(50)
  })

  test('小計は 単価 × 個数 と一致する（F列×G列＝H列）', () => {
    for (const saleLine of buildSaleLines(lines)) {
      expect(saleLine.subtotal).toBe(saleLine.netUnitPrice * saleLine.qty)
    }
  })

  test('空の伝票は空配列', () => {
    expect(buildSaleLines([])).toEqual([])
  })
})

describe('saleLinesTotal', () => {
  test('伝票の合計と一致する', () => {
    const lines = [
      line({ lineId: 'a', unitPrice: toYen(500), discount: toYen(50), qty: 2 }),
      line({ lineId: 'b', unitPrice: toYen(200), qty: 1 }),
    ]
    expect(saleLinesTotal(buildSaleLines(lines))).toBe(ticketTotal(lines))
  })

  test('空なら0円', () => {
    expect(saleLinesTotal([])).toBe(0)
  })
})
