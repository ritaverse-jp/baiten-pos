import { describe, expect, test } from 'vitest'
import { buildSaleId, formatSaleId, isValidDateKey, parseSaleId, toDateKey } from './saleNumber'
import { toTerminalCode, type DateKey } from './types'

describe('toDateKey', () => {
  test('YYYYMMDD形式にする', () => {
    expect(toDateKey(new Date(2026, 6, 23))).toBe('20260723')
  })

  test('月・日は2桁にゼロ埋めする', () => {
    expect(toDateKey(new Date(2026, 0, 5))).toBe('20260105')
  })
})

describe('isValidDateKey', () => {
  test('実在する日付を受け付ける', () => {
    expect(isValidDateKey('20260723')).toBe(true)
  })

  test('うるう年の2/29を受け付ける', () => {
    expect(isValidDateKey('20240229')).toBe(true) // 2024はうるう年
  })

  test('平年の2/29を拒否する', () => {
    expect(isValidDateKey('20230229')).toBe(false) // 2023はうるう年でない
  })

  test('存在しない月日は、日付の自動繰り上げに惑わされず拒否する', () => {
    // Date は 2/31 を自動的に 3/3 として解釈してしまうため、
    // 単純に new Date() が例外を投げないことだけを見る実装だと通ってしまう
    expect(isValidDateKey('20260231')).toBe(false)
    expect(isValidDateKey('20261301')).toBe(false)
    expect(isValidDateKey('20260100')).toBe(false)
  })

  test('桁数・書式が違う値を拒否する', () => {
    expect(isValidDateKey('2026723')).toBe(false)
    expect(isValidDateKey('2026-07-23')).toBe(false)
    expect(isValidDateKey('')).toBe(false)
  })
})

describe('formatSaleId', () => {
  test('要件定義の例と一致する：20260723-A014', () => {
    expect(formatSaleId('20260723' as DateKey, toTerminalCode('A'), 14)).toBe('20260723-A014')
  })

  test('1桁・2桁の連番も3桁にゼロ埋めする', () => {
    expect(formatSaleId('20260723' as DateKey, toTerminalCode('A'), 1)).toBe('20260723-A001')
    expect(formatSaleId('20260723' as DateKey, toTerminalCode('A'), 23)).toBe('20260723-A023')
  })

  test('999を超える連番は切り詰めず4桁以上のまま自然延長する', () => {
    // 3桁に切り詰める実装（末尾3桁だけ取る等）だと 1000 が "000" になってしまう
    expect(formatSaleId('20260723' as DateKey, toTerminalCode('A'), 1000)).toBe('20260723-A1000')
    expect(formatSaleId('20260723' as DateKey, toTerminalCode('A'), 12345)).toBe('20260723-A12345')
  })

  test('0以下・非整数の連番はエラーとする', () => {
    expect(() => formatSaleId('20260723' as DateKey, toTerminalCode('A'), 0)).toThrow(RangeError)
    expect(() => formatSaleId('20260723' as DateKey, toTerminalCode('A'), -1)).toThrow(RangeError)
    expect(() => formatSaleId('20260723' as DateKey, toTerminalCode('A'), 1.5)).toThrow(RangeError)
  })
})

describe('buildSaleId', () => {
  test('日付と端末コードと連番から会計番号を組み立てる', () => {
    expect(buildSaleId(new Date(2026, 6, 23), toTerminalCode('A'), 14)).toBe('20260723-A014')
  })

  test('複数文字の端末コードにも対応する', () => {
    expect(buildSaleId(new Date(2026, 6, 23), toTerminalCode('AB'), 3)).toBe('20260723-AB003')
  })
})

describe('parseSaleId', () => {
  test('組み立てた会計番号を元の値に復元できる（往復変換）', () => {
    const cases: Array<[Date, string, number]> = [
      [new Date(2026, 6, 23), 'A', 14],
      [new Date(2026, 0, 1), 'B', 3],
      [new Date(2026, 6, 23), 'AB', 1],
      [new Date(2026, 6, 23), 'ABCD', 99],
    ]
    for (const [date, code, seq] of cases) {
      const terminalCode = toTerminalCode(code)
      const saleId = buildSaleId(date, terminalCode, seq)
      expect(parseSaleId(saleId)).toEqual({
        dateKey: toDateKey(date),
        terminalCode,
        seq,
      })
    }
  })

  test('4桁以上に自然延長した連番も、3桁固定を前提にせず正しく復元する', () => {
    // 先頭3桁だけを連番とみなす実装（固定幅パース）だと 1000 が 100 になってしまう
    const saleId = buildSaleId(new Date(2026, 6, 23), toTerminalCode('A'), 1000)
    expect(parseSaleId(saleId)).toEqual({
      dateKey: '20260723',
      terminalCode: 'A',
      seq: 1000,
    })
  })

  test('最長の端末コード（4文字）と連番の境界も曖昧さなく分解する', () => {
    const saleId = buildSaleId(new Date(2026, 6, 23), toTerminalCode('WXYZ'), 5)
    expect(parseSaleId(saleId)).toEqual({
      dateKey: '20260723',
      terminalCode: 'WXYZ',
      seq: 5,
    })
  })

  test('ハイフンがない・区切りが違う等の不正な形式は null を返す', () => {
    expect(parseSaleId('20260723A014')).toBeNull()
    expect(parseSaleId('20260723_A014')).toBeNull()
    expect(parseSaleId('')).toBeNull()
  })

  test('端末コードが小文字の不正な値は null を返す', () => {
    expect(parseSaleId('20260723-a014')).toBeNull()
  })

  test('1文字の端末コード直後に4桁の連番が続いても "A1"+"014" のように誤読しない', () => {
    // 端末コードは英字のみなので、後続の数字はすべて連番として切り出される。
    // 固定幅（先頭1〜2文字を無条件に端末コードとみなす）でパースする実装だと
    // ここが "A1" + "014" や "A" + "1" + "014" のように誤って分解されてしまう
    expect(parseSaleId('20260723-A1014')).toEqual({
      dateKey: '20260723',
      terminalCode: 'A',
      seq: 1014,
    })
  })

  test('連番が0または非数値は null を返す', () => {
    expect(parseSaleId('20260723-A000')).toBeNull()
    expect(parseSaleId('20260723-A')).toBeNull()
  })

  test('日付部分が存在しない暦日の場合は null を返す', () => {
    // 桁数・区切りは正しいが 2/31 が実在しない日付であるケース
    expect(parseSaleId('20260231-A014')).toBeNull()
  })
})
