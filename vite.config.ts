import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Service Worker はアプリ本体の precache のみを担当する。
      // GAS への API 通信は runtimeCaching に載せない（データの鮮度とキュー制御は
      // data/sync の責務に一本化する。docs/design.md 3.2）
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: 'index.html',
      },
      // 開発中は SW を無効にする。有効にすると古いキャッシュが残って
      // 変更が反映されない事故が起きるため。オフライン確認は build + preview で行う
      devOptions: { enabled: false },
      manifest: {
        name: '売店レジ',
        short_name: '売店レジ',
        description: '売店向け注文精算アプリ',
        lang: 'ja',
        start_url: '/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#ffffff',
        theme_color: '#1f2937',
        // icons はタスク20（PWA仕上げ）で追加する
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
