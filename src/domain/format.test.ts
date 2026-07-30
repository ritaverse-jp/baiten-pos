import { describe, expect, test } from 'vitest'
import { formatProductNo, formatTime, formatYen } from './format'
import { toYen, type IsoDateTime } from './types'

describe('formatProductNo', () => {
  test('1〜20は丸数字にする', () => {
    expect(formatProductNo(1)).toBe('①')
    expect(formatProductNo(10)).toBe('⑩')
    expect(formatProductNo(20)).toBe('⑳')
  })

  test('21以降は通常数字のまま', () => {
    expect(formatProductNo(21)).toBe('21')
    expect(formatProductNo(99)).toBe('99')
  })

  test('0以下は丸数字にしない（範囲外）', () => {
    expect(formatProductNo(0)).toBe('0')
  })
})

describe('formatYen', () => {
  test('3桁区切りで円を付ける', () => {
    expect(formatYen(toYen(500))).toBe('500円')
    expect(formatYen(toYen(1200))).toBe('1,200円')
    expect(formatYen(toYen(1000000))).toBe('1,000,000円')
  })

  test('0円も表示できる', () => {
    expect(formatYen(toYen(0))).toBe('0円')
  })

  test('マイナスの金額（取消行相当）も表示できる', () => {
    expect(formatYen(toYen(-500))).toBe('-500円')
  })
})

describe('formatTime', () => {
  test('明示的な+09:00表記（GAS getSalesHistory由来）はそのままJSTとして表示する', () => {
    expect(formatTime('2026-07-30T14:32:00+09:00' as IsoDateTime)).toBe('14:32')
  })

  test('UTC・Z表記（ローカルのSaleRecord.confirmedAt由来）もJSTに変換して表示する', () => {
    // 2026-07-30T05:32:00Z は JST で 14:32
    expect(formatTime('2026-07-30T05:32:00.000Z' as IsoDateTime)).toBe('14:32')
  })
})
