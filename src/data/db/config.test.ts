import { beforeEach, describe, expect, test } from 'vitest'
import { toTerminalCode } from '@/domain/types'
import { clearConfig, getConfig, saveConfig } from './config'
import { db } from './schema'

beforeEach(async () => {
  await db.config.clear()
})

describe('getConfig', () => {
  test('未設定の状態でも全項目nullのAppConfigを返す（行の有無を呼び出し側に意識させない）', async () => {
    expect(await getConfig()).toEqual({
      id: 'singleton',
      gasUrl: null,
      terminalCode: null,
      terminalName: null,
      apiToken: null,
      tokenExpiresAt: null,
    })
  })
})

describe('saveConfig', () => {
  test('指定した項目だけを更新し、他は保持する', async () => {
    await saveConfig({ gasUrl: 'https://script.google.com/example' })
    await saveConfig({ terminalCode: toTerminalCode('A'), terminalName: 'レジ1' })
    const config = await getConfig()
    expect(config.gasUrl).toBe('https://script.google.com/example')
    expect(config.terminalCode).toBe('A')
    expect(config.terminalName).toBe('レジ1')
  })

  test('レコードは常に1件のまま更新される', async () => {
    await saveConfig({ gasUrl: 'https://a.example' })
    await saveConfig({ gasUrl: 'https://b.example' })
    expect(await db.config.count()).toBe(1)
    expect((await getConfig()).gasUrl).toBe('https://b.example')
  })
})

describe('clearConfig', () => {
  test('端末を未登録状態に戻す', async () => {
    await saveConfig({ terminalCode: toTerminalCode('A') })
    await clearConfig()
    expect((await getConfig()).terminalCode).toBeNull()
  })
})
