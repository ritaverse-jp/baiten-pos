import { describe, expect, test } from 'vitest'
import { formatProductNo, formatYen } from './format'
import { toYen } from './types'

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
