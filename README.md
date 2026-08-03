# baiten-pos

売店向け注文精算アプリ。スマートフォン／タブレットで動作する PWA レジ。

データストアは Google スプレッドシート、バックエンドは Google Apps Script、フロントは Vite + React + TypeScript の PWA。専用の DB・サーバーは持たない。

## 配信

https://ritaverse-jp.github.io/baiten-pos/ （GitHub Pages。`main` への push で GitHub Actions が自動デプロイする。`.github/workflows/deploy.yml`）

## 文書

| ファイル | 内容 |
| --- | --- |
| [docs/requirements.md](docs/requirements.md) | 要件定義書（仕様の正） |
| [docs/design.md](docs/design.md) | 基本設計書（API・同期・認証・実装タスク一覧） |
| [docs/manual.md](docs/manual.md) | 使い方ガイド（店舗の会計担当・管理者向け。そのまま配布できる内容） |
| [CLAUDE.md](CLAUDE.md) | 実装時に守る不変条件 |

## セットアップ

```bash
npm install
npm run dev
```

## コマンド

| コマンド | 内容 |
| --- | --- |
| `npm run dev` | 開発サーバー |
| `npm run build` | 本番ビルド（型チェック込み） |
| `npm run preview` | ビルド結果の確認。Service Worker の動作確認はこちらで行う |
| `npm run test` | 単体テスト |
| `npm run typecheck` | 型チェック |
| `npm run lint` | oxlint |

Service Worker は開発サーバーでは無効にしてある（古いキャッシュによる混乱を避けるため）。オフライン動作の確認は `npm run build && npm run preview` で行う。
