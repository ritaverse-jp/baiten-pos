import { describe, expect, test } from 'vitest'
import { validateGasUrl, validatePin, validateTerminalName } from './settings'

describe('validateGasUrl', () => {
  test('httpsのURLは許可する', () => {
    expect(validateGasUrl('https://script.google.com/macros/s/xxx/exec')).toBeNull()
  })

  test('空文字はrequired', () => {
    expect(validateGasUrl('')).toBe('required')
    expect(validateGasUrl('   ')).toBe('required')
  })

  test('httpはinvalidFormat（NF-06：通信はすべてHTTPS）', () => {
    expect(validateGasUrl('http://script.google.com/macros/s/xxx/exec')).toBe('invalidFormat')
  })

  test('URLとして解釈できない文字列はinvalidFormat', () => {
    expect(validateGasUrl('not a url')).toBe('invalidFormat')
  })
})

describe('validateTerminalName', () => {
  test('非空文字は許可する', () => {
    expect(validateTerminalName('レジ1')).toBeNull()
  })

  test('空文字・空白のみはrequired', () => {
    expect(validateTerminalName('')).toBe('required')
    expect(validateTerminalName('   ')).toBe('required')
  })
})

describe('validatePin', () => {
  test('4〜8桁の数字は許可する（境界値）', () => {
    expect(validatePin('1234')).toBeNull()
    expect(validatePin('12345678')).toBeNull()
  })

  test('3桁はinvalidFormat', () => {
    expect(validatePin('123')).toBe('invalidFormat')
  })

  test('9桁はinvalidFormat', () => {
    expect(validatePin('123456789')).toBe('invalidFormat')
  })

  test('数字以外を含むとinvalidFormat', () => {
    expect(validatePin('12a4')).toBe('invalidFormat')
  })

  test('空文字はrequired', () => {
    expect(validatePin('')).toBe('required')
  })
})
