import { describe, expect, test } from 'vitest'
import { isTerminalCode, isYen, toTerminalCode, toYen, TERMINAL_CODE_PATTERN } from './types'

describe('toYen', () => {
  test('整数を受け付ける', () => {
    expect(toYen(0)).toBe(0)
    expect(toYen(500)).toBe(500)
    expect(toYen(-1000)).toBe(-1000) // 取消行はマイナスになりうる
  })

  test('小数を拒否する', () => {
    expect(() => toYen(1.5)).toThrow(RangeError)
    expect(() => toYen(0.1 + 0.2)).toThrow(RangeError)
  })

  test('数値として扱えない値を拒否する', () => {
    expect(() => toYen(NaN)).toThrow(RangeError)
    expect(() => toYen(Infinity)).toThrow(RangeError)
    expect(() => toYen(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError)
  })
})

describe('isYen', () => {
  test('整数のみ真', () => {
    expect(isYen(500)).toBe(true)
    expect(isYen(1.5)).toBe(false)
    expect(isYen('500')).toBe(false)
    expect(isYen(null)).toBe(false)
  })
})

describe('toTerminalCode', () => {
  test('英大文字1〜4文字を受け付ける', () => {
    expect(toTerminalCode('A')).toBe('A')
    expect(toTerminalCode('ABCD')).toBe('ABCD')
  })

  test('数字を含むコードを拒否する', () => {
    // 数字を許すと、連番が4桁に延びたとき `A1014` を A1+014 と A10+14 に
    // 分解できなくなる（docs/design.md 5.3）
    expect(() => toTerminalCode('A1')).toThrow(RangeError)
    expect(() => toTerminalCode('1')).toThrow(RangeError)
  })

  test('小文字・空文字・長すぎるコード・区切り文字を拒否する', () => {
    expect(() => toTerminalCode('a')).toThrow(RangeError)
    expect(() => toTerminalCode('')).toThrow(RangeError)
    expect(() => toTerminalCode('ABCDE')).toThrow(RangeError)
    expect(() => toTerminalCode('A-B')).toThrow(RangeError)
  })
})

describe('isTerminalCode', () => {
  test('文字列以外は偽', () => {
    expect(isTerminalCode('A')).toBe(true)
    expect(isTerminalCode(1)).toBe(false)
    expect(isTerminalCode(undefined)).toBe(false)
  })
})

describe('TERMINAL_CODE_PATTERN', () => {
  test('会計番号の末尾数字列を連番として一意に切り出せる', () => {
    const saleId = '20260723-ABCD1014'
    const [, tail] = saleId.split('-')
    const code = tail.replace(/\d+$/, '')
    const seq = tail.slice(code.length)
    expect(TERMINAL_CODE_PATTERN.test(code)).toBe(true)
    expect(code).toBe('ABCD')
    expect(seq).toBe('1014')
  })
})
