import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// GitHub Pages はプロジェクトサイトをリポジトリ名のサブパスで配信する
// （https://<user>.github.io/baiten-pos/）。ローカルの開発・`npm run preview`
// では従来どおりルートで動かしたいため、CI の GitHub Pages ビルドでだけ
// 環境変数 GITHUB_PAGES=true を渡して base を切り替える（.github/workflows/deploy.yml）
const base = process.env.GITHUB_PAGES === 'true' ? '/baiten-pos/' : '/'

export default defineConfig({
  base,
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
        start_url: base,
        scope: base,
        display: 'standalone',
        orientation: 'any',
        background_color: '#ffffff',
        theme_color: '#1f2937',
        // scripts/gen-icons.mjs で生成（タスク20）。sharp/canvas等の画像ライブラリを
        // 追加せずNode組み込みのzlibだけでPNGを直接エンコードしている
        // アイコンの src は base を手動で付ける（VitePWA は manifest.icons[].src を
        // 自動では base 起点に書き換えない。GitHub Pages 用ビルドで実際に 404 する
        // ことを確認して気づいた）
        icons: [
          { src: `${base}pwa-192x192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: `${base}pwa-512x512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: `${base}maskable-icon-512x512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
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
