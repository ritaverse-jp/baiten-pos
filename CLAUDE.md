# CLAUDE.md

売店向け注文精算アプリ（スマホ／タブレット用 PWA レジ）。

## 参照文書

| ファイル | 位置づけ |
| --- | --- |
| `docs/requirements.md`（v1.4） | **仕様の正。** 本ファイルや設計書と矛盾する場合はこちらを優先し、矛盾していること自体を指摘する |
| `docs/design.md`（v1.1） | 基本設計。GAS エンドポイントの入出力、オフライン同期フロー、認証設計、実装タスク一覧はここにある |

本ファイルはそれらの要約ではなく、**実装時に判断を誤りやすい点だけ**を集めたもの。詳細が必要になったら `docs/design.md` を読むこと。

## 現在の状態

**商品写真（要件定義 v1.4 の 6.2・design 9章）は タスク21（GAS側）・22（端末側の画像キャッシュ層）・23（SC-03 登録UI）まで実装済み。タスク24（会計画面への写真表示）は未着手。** タスク21・22はユーザーが実機で動作確認済み（写真の差し替えでDrive上の旧ファイルがゴミ箱に移り、`productImages` の古いレコードが消えることまで確認）。

**タスク23で `商品本体の保存 → 写真の送信` の順序制御を `ProductsScreen.handleSubmit` に置いた。** GAS の `saveProductImage` は `商品マスタ` に該当行があることを前提とするため、新規追加では商品の保存が成功していないと写真を送れない。**写真の送信に失敗しても商品自体の保存は取り消さない**（写真は任意項目であり、商品が登録できていれば会計は行える）。その場合はフォームを開いたままにして写真だけ再試行できるようにしている。

**タスク21で `商品マスタ` に G列（画像ID）を追加した。** `ensureCoreSheets()` が既存タブの見出し行の不足分を書き足すようになっており（`ensureHeaderColumns_`）、運用中のスプレッドシートを手で直さなくても列が増える。データ行には触れない。**`saveProduct` は A〜F列しか書かない**（商品名や金額の編集で写真が消えないようにするため。G列の更新は `saveProductImage` の専任）。

**GAS が DriveApp を使うようになったため、OAuth スコープが増えている。** 反映後に初回実行で認可が必要になる場合がある。

 ユーザーからの「商品設定の際に写真も入れられるようにできるか」という質問を受けて要件定義・設計書に落とした段階。**保存先は Google Drive（シートには画像IDのみ）**で、画像の実体をスプレッドシートに置かない理由・端末側で320pxに縮小してから送る理由・`getMasters` に画像を混ぜてはいけない理由は design 9.1〜9.3 に書いてある。着手前に必ず design 9章を読むこと。**タスク24（SC-01への写真表示）は、タスク20で調整したレイアウト寸法（`--tile-min` 等）の再調整を伴う。**

**タスク20（PWA仕上げ）は完了。ユーザーが実機で「圏外でホーム画面から起動し会計を完了できる」ことを確認済み（2026-08-01）。** これで `docs/design.md` 7章のタスク1〜20はすべて完了した（21〜24は商品写真として後から追加したもので、20とは独立）。タスク20では manifest・アイコン・precache・GitHub Pages配信・確認ダイアログ類の網羅・端末名変更機能・登録リセット機能に加え、**スマホ／タブレットのレイアウト調整**（下記 `screens/checkout/` の項。レイアウト分岐を幅ではなく画面の向きで行う形に変更）も行った。

**`端末` タブの行が失われた事象は調査済み（2026-08-01）。原因は GAS ではなくシート側の手操作。** 症状は「トークンのハッシュ照合は通る（＝Script Properties のトークン実体は存在する）のに、`端末` タブに対応する行が1件も無く `TERMINAL_DISABLED` になる」。`操作ログ` タブと `端末` タブを突き合わせて判明した事実：

- `registerTerminal` は空きコードを A→B→C… の順に探すため、**同じコード `A` が再発行されているということは、その時点で `端末` タブが空だったことを意味する。** `操作ログ` には `A` の端末登録が4回記録されており、行が消えたのは1回ではなく**少なくとも3回**（2026-07-30 13:10前・同 15:23前・07-31 13:38前、いずれも JST）
- GAS 側には `端末` タブの行を削除する処理が本当に存在しない（`deleteRow` はカテゴリ削除のみ。`Menu.js` の3メニューも行を消さない。`ensureCoreSheets()` はタブが存在しない場合のみ作成し既存タブに触れない）
- 3回とも検証セッションの区切りで発生しており、`売上ログ` も同様に空になっている一方 `操作ログ` だけ残っている。**検証をやり直すためシートの行を手で消した際に `端末` タブも巻き込んだ**、という説明が全事実と整合する

**この事象が起きる機構（設計上の弱点として認識しておくこと）：トークンのハッシュは Script Properties に、端末の行はシートに、別々に保存されている。** シート側だけが消えるとハッシュ照合は通るのに `findTerminalRow_` が null を返し、`getTerminalStatus_` が安全側に倒して「無効」と判定するため、いつまでも復旧しない。**「管理者が意図的に無効化した」と「行が失われた」が現状どちらも `TERMINAL_DISABLED` になり区別できない。**

**対応済み（2026-08-01）：** `getTerminalStatus_` が「行が無い」を `無効` に畳まず `TERMINAL_STATUS_NOT_REGISTERED`（`'(未登録)'`）として返すようにし、`requireAuth_`・`login` が `TERMINAL_NOT_REGISTERED` を投げるようにした。フロント側は `syncStore.blockedBy = 'terminalNotRegistered'` として `terminalDisabled` と別扱いし、設定画面が復旧導線を出す。**`TERMINAL_DISABLED`（管理者が意図的に停止／端末側では復旧不可）と `TERMINAL_NOT_REGISTERED`（行が失われただけ／登録し直せば復旧可能）を今後も畳まないこと。**（「シートに注意書きを置く」案はユーザー判断で見送り。）

**この対応で判明した重要な副作用：登録をやり直すと新しい端末コードが割り当てられるため、未送信データは二度と送信できなくなる。** `gas/Sales.js` が認証済み端末と異なる `terminalCode` の売上を拒否するため、古いコードを持つキューは永久に `VALIDATION_ERROR` になる。そのため `handleResetRegistration` は実行直前に未送信件数を確認し、0件でなければ確認ダイアログで影響を伝える。**件数は state の `pendingSales` ではなくその場で `getAllPendingSales()` を読み直す**（この画面はマウント時にしか未送信一覧を読まないため、画面を開いたまま会計を確定していると state が古く、警告を出し損ねる）。リセットの入口が「端末情報」セクションと復旧導線の2箇所にあるため、**警告は画面の説明文ではなく実行直前のダイアログに置く**こと。

**タスク19はユーザーが実ブラウザで動作確認済み。** GAS URL設定→端末登録→未送信データ表示・同期まで一連の操作を画面のみで完結できることを確認した。確認の過程で「会計確定直後は設定画面の未送信一覧に何も出ない」という報告があったが、調査の結果バグではなく、`CheckoutScreen.handleConfirmSale` が確定のたびに `void runSync()` を即座に呼ぶため、オンライン端末ではほぼ即座に同期・キューから削除されるのが正常な挙動だった（下記 `screens/settings/` の項を参照）。副次的に見つかった本物のギャップ（設定画面がマウント時にしか未送信一覧を読み直さない）は「再読み込み」ボタンを追加して解消した。

**タスク19で、これまでコンソールからの手動 IndexedDB 操作に頼っていた `config` の設定（GAS URL・端末登録・トークンの再ログイン）がすべて画面操作だけで完結するようになった。** GAS URL 未設定→端末未登録→登録済み、の順で必要なセクションだけを出し分ける形（`screens/settings/SettingsScreen.tsx`）。GAS URL は保存のたびに `ping` で接続確認し、結果を画面に表示する（入力ミス・スキーマ不一致に気づきにくい状態を避けるため。タスク18の実ブラウザ検証で `config` の主キー名を取り違えた事故を踏まえた要望）。`syncStore.blockedBy` に応じて通常時とは異なる導線を出す：`tokenExpired` は PIN 再ログイン欄（成功後に自動で同期再開）、`terminalDisabled` は未送信データの CSV エクスポート欄（`domain/csv.ts`。売上ログと同じ列構成で出力し、管理者がそのままシートに貼り付けられるようにした）。`data/sync/engine.ts` の `runSync({force:true})`（タスク16で用意だけしてあった）を「今すぐ同期」ボタンに、design 6.5 の残り14日プロアクティブ更新を `data/sync/tokenRefresh.ts`（新規。`app/App.tsx` に `startTokenRefreshWatcher()` として配線）にそれぞれ実装した。

**タスク18はユーザーが実ブラウザ・実デプロイ済みGAS（バージョン11）で動作確認済み。** 本日の会計一覧表示、送信済み・未取消の会計の取消（確認ダイアログ→取消済みバッジ表示）、スプレッドシートへのマイナス行追記（元の行は残る・I列割引額は据え置き）、未送信の会計の取消ボタン非活性、表示時刻（HH:mm）の正確性のすべてを確認済み。A列・B列を読み返す実装（`cellDateString_`/`cellTimeString_`。下記参照）が実データで正しく機能することもこれで確認できた。

**タスク18で `GetSalesHistoryResponse` の型を変更した。** `sales: SalePayload[]`（タスク11時点の仮の型）から `sales: SalesHistoryEntry[]` に変更している。理由：`SalePayload` は「取消済みかどうか」を表現できず、取消（同じ `saleId` に負の数量の行を追記する方式）で正の行と負の行が同じ `saleId` に混在すると、素朴に全行を `lines` に詰めた場合に正負が混ざってしまう。`SalesHistoryEntry` は正の行だけから `lines`/`total` を組み立て、`canceled`/`canceledAt` を別フィールドとして持つ。GAS 側（`gas/Sales.js` の `getSalesHistory`）はシートの生データから `saleId` でグルーピングし、負の数量の行の有無で `canceled` を判定する。

**A列（日付）・B列（時刻）をコードから読み返す実装は今回が初めて。** これまでの GAS 実装（`appendSales`・`getTodayMaxSeq`）は売上ログに書き込むだけ、または C列（会計番号・文字列)を読むだけで、日付・時刻セルを読み返す処理が無かった。日付・時刻の文字列（`Utilities.formatDate` で書き込んだもの）はスプレッドシート側の自動書式認識により Date 型セルとして保存され得るため、`getSalesHistory` の実装では `cellDateString_`/`cellTimeString_`（`gas/Sales.js`）で Date 型・文字列型のどちらでも正しく扱えるようにしている。実ブラウザ確認で正しく動作することを確認済み。

**タスク18の検証中に判明した重要な注意点：複数の `npm run dev` を別ポートで起動したまま放置すると、IndexedDB の書き込み先を誤りやすい。** IndexedDB はオリジン（ホスト＋ポート）単位で分かれるため、`localhost:5173`・`5174`・`5183` のように複数の dev サーバーが同時に立ち上がっていると、コンソールでの手動書き込みと実際に開いているタブが別ポート（＝別オリジン＝別データベース）を指してしまい、「何度書き込んでも反映されない」という分かりにくい症状になる。タスク18ではこれが実際に発生し、`config` テーブルの主キー名の誤り（`'default'` vs 正しい `'singleton'`）を先に疑って時間を使った後、真因はポート違いだと判明した。**フロント側の実ブラウザ検証を始める前に、`lsof -iTCP -sTCP:LISTEN -P | grep node` 等で立ち上がっている dev サーバーを確認し、使うポートを1つに絞ってから（`--strictPort` を付けて起動すると勝手に別ポートへ逃げないので安全）検証を始めること。**

**タスク17のオフライン編集禁止（要件定義9.1・不変条件19）の検証方法：** 自動テスト（`ProductsScreen.test.tsx`・`CategoriesScreen.test.tsx`）で、(1) `getMasters` が通信エラーで失敗するケース、(2) 画面表示後にバックグラウンドの同期エンジンが `connection` を `offline` にするケース、の両方で追加・編集・削除ボタンが `disabled` になることを確認済み。**実ブラウザでの確認は今回は行っていない**（このセッションでは Chrome 拡張のブラウザ操作を使わない運用のため）。`npm run dev` を起動すれば、タスク16で使った手順（DevTools の Network タブを Offline にする）で同じ確認ができる。

**タスク16はユーザーが実ブラウザ・実デプロイ済みGASで動作確認済み。** これがこのプロジェクトで初めて「実ブラウザ→実GAS」の通信を検証した回（タスク7〜10はcurl、タスク11はNode、タスク13〜15はネットワーク通信を伴わない検証だった）。`registerTerminal` をブラウザのconsoleから直接fetchして実際のapiTokenを取得・configに設定 → Offline化 → 会計確定 → Online復帰 → `pendingQueue`が空になり実際のスプレッドシートに行が追加されることを確認した。副次的に、検証中に何度もオフライン/オンラインを切り替えたにもかかわらずシートの行数が一貫して増えなかったことから、「再送しても行が増えない」も実地で確認できた。

**タスク15はユーザーが実ブラウザ（Chrome DevTools の Network タブを Offline に設定＝機内モード相当）で動作確認済み。** 商品追加→精算→会計確定の操作後、`sales`・`pendingQueue` の両テーブルに一致する `saleId` で記録され、`currentTicket` が空になることを IndexedDB ビュー（Application タブ）で直接確認した。タスク19（設定画面・端末登録）がまだ無いため、確認時は `config.terminalCode` をコンソールから直接 IndexedDB に書き込んで仮設定した（`registerTerminal` を経由しない仮の値。本番の端末登録フローとは別）。

GAS はデプロイ済み（コンテナバインド型、Webアプリとして公開）。Webアプリ URL はユーザーが把握しており、`.clasp.json`（gitignore 済み）に紐づく。`registerTerminal` の実装により、`getMasters`・`appendSales`・`getTodayMaxSeq`・`saveProduct`/`deleteProduct`/`saveCategory`/`deleteCategory` を実トークンでの一気通貫フローとして curl で確認済み。カスタムメニュー（`onOpen`／Menu.js）はユーザーが実際にスプレッドシートUIから操作して確認済み。PIN のハッシュ値は Script Properties の `pinHash` にユーザーが直接設定済み（PIN 自体はアシスタントには開示していない運用）。

**フロント側の実ブラウザ検証で使える手法（タスク19が無い間、今後のタスクでも使う）：**
- 設定画面（端末登録・マスタ取得）が無いため、`npm run dev` で開いたブラウザの開発者ツールコンソールから、生の `indexedDB.open('baiten-pos')` API で直接テーブルに仮データ（`products`・`categories`・`config` 等）を書き込むと、UI を実際に動かして確認できる。書き込み後は**ページのリロードが必須**（各ストアの `hydrate()` は起動時に一度しか走らないため）
- オフライン状態の検証は実機の機内モードより、DevTools の Network タブを「Offline」にする方が手軽で確実
- **実際のGASと通信する検証（同期エンジン等）では、`config.terminalCode` を仮の値で済ませられない。** `apiToken` はGAS側でハッシュ照合されるため、コンソールから `fetch(gasUrl, {method:'POST', ...})` で本物の `registerTerminal` を直接呼び、返ってきた本物の `apiToken` を `config` に書き込む必要がある（PIN はユーザー側で入力し、アシスタントには開示しない運用を継続）
- **DevTools の IndexedDB パネルは、ページのリロードをまたいでも表示が古いまま更新されないことがある**（更新ボタン・ページリロードでも直らない場合がある）。「Data may be stale」という警告が出続けて実データと食い違って見えるときは、**DevTools 自体を閉じて開き直す**と直ることがある。同期エンジンの検証中、この表示の古さを実際のバグと誤認しかけたことがあるため、キューが「消えない」ように見えたら、まずこれを疑うこと

**タスク9・10の検証で判明した重要な注意点（今後のタスクにも影響する）：**
- **`CacheService` の60秒TTLのような短い時間窓を、チャットでのユーザーとのやり取り（往復）を挟んで検証しようとすると、往復自体の実時間が60秒に匹敵し、正確なタイミング検証が実務上困難。** タイミング依存の検証は、ユーザーの手操作を1回のスクリプト実行に閉じ込め（例：「キャッシュ書き込み」と「実値の書き換え」を同一関数内で連続実行する）、以降の観測はこちらだけで完結する（ポーリング等）設計にすること。可能なら、まず自分専用の診断用エンドポイント（例：キャッシュの中身を直接読むだけの一時アクション）を先に用意し、状態を都度確認できるようにしてから本題の検証に入るとよい
- **一時的な検証用ファイル（`_debugXxx.js`）は、その中の関数をユーザーに実行してもらう前に削除・pushしないこと。** タスク9で、後片付け関数 `_debugCleanupTask9` を含むファイルを実行依頼前に削除・push してしまい、ユーザーが Apps Script エディタで関数を見つけられない事態が発生した。後片付け関数は「本当に全部の検証が終わった後」まで残しておく
- ユーザーの「続けて」等の短い返答は、直前に自分が何を待っていたかによって意味が変わりうる。複数の確認事項を並べて依頼したときは、**どの項目が完了したかを名指しで確認する**ほうが安全（曖昧な返答をそのまま「全部完了」と解釈しない）
- **スプレッドシートのカスタムメニュー（`SpreadsheetApp.getUi()` を使う関数）は、Apps Script エディタの「実行」ボタンや `clasp run` では動かせない。** UI コンテキストが必要なため、実際のメニュークリックでしか検証できない。ユーザーに手動でのメニュー操作を依頼すること
- **`onEdit` はスクリプト経由（`SpreadsheetApp` API からの書き換え）では発火しない。** カスタムメニューの操作でセルを書き換える場合、`onEdit` に書いた処理（キャッシュ破棄・トークン削除など）は自動では実行されないため、メニューのハンドラ自身が同じ処理を明示的に呼ぶ必要がある（例：`revokeTerminalToken_` を `onEdit` とメニューハンドラの両方から呼ぶ）

**GAS のデプロイ更新の注意：** `clasp push` は HEAD（開発用スナップショット）を更新するだけで、既存の Web アプリの `/exec` URL が配信する内容は変わらない。コードを反映するには `npx clasp version "<説明>"` → `npx clasp redeploy <deploymentId> -V <バージョン番号>` で既存デプロイをそのバージョンに向け直す（URL は変わらない）。deploymentId は `npx clasp deployments` で確認できる。
**`clasp push` がファイルの削除を検知しないことがある。** ローカルでファイルを消して push しても「Script is already up to date.」と表示され、リモートに残ったままになる場合がある（task8・task9 双方で発生）。`npx clasp pull` を別ディレクトリに行い、リモートのファイル一覧を突き合わせて確認すること。削除が反映されないときは、いずれかの追跡ファイルに実質的な変更を1つ加えてから push すると解消する。

実体は Vite 8 + React 19 + TypeScript 7。

- `src/domain/types.ts` — シート列・API・Dexie の型。**新しい型を足す前にまずここを見ること**（同義の型を二重定義しやすい）
- `src/domain/calc.ts` — 金額計算と入力値検証。**金額の計算をここ以外に書かないこと。** 画面やストアで `price * qty` を直に書くと割引の適用単位を間違える
- `src/domain/ticket.ts` — 伝票操作（追加・個数変更・行分割・割引設定・削除）。すべて `{ok, lines}` 形式で返す純粋関数。**伝票の更新は画面から直接配列操作せず、必ずここの関数を経由すること**。行の一意キーは `lineId` であり `productNo` ではない（「行を分ける」で同一商品が複数行になるため）
- `src/domain/saleNumber.ts` — 会計番号の生成・パース（純粋関数、日時以外の外部依存なし）
- `src/data/db/schema.ts` — Dexie スキーマ本体。**データベースは1つに統一する。** 新しいテーブルは別の Dexie インスタンスを作らずここに追加すること。テーブルごとのアクセサは `masters.ts`（products・categories）・`currentTicket.ts`・`sales.ts`・`pendingQueue.ts`・`config.ts` に分けている（`counters` のみ排他制御と一体のため `data/sync/counter.ts` に置く）
- `src/data/db/masters.ts` — 商品・カテゴリキャッシュ。**1件ずつの追加・更新は提供しない。** 常に `replaceProducts`/`replaceCategories` による丸ごと置き換え（GAS からの再取得結果を反映する形のみ。編集自体はオンライン時に GAS 経由で行う）
- `src/data/db/currentTicket.ts` — 入力中伝票の永続化。DB 固有の主キー（`id: 'current'`）はこの層の外に漏らさない。呼び出し側は `Ticket` 型だけを扱う
- `src/data/db/pendingQueue.ts` — 未送信キュー。**`removePendingSale` は GAS の受理応答を受け取った後にのみ呼ぶこと**（不変条件17）。`getAllPendingSales` は enqueuedAt 昇順で返す
- `src/data/sync/counter.ts` — 連番カウンタの get-and-increment。`db.transaction('rw', db.counters, ...)` を自前で開くが、`db.counters` を含む外側のトランザクションから呼ばれた場合はそれに参加する（Dexie のトランザクション伝播）。`data/sync/checkout.ts` の `confirmSale` がこれを利用し、採番と会計データの保存を1つの外側トランザクションにまとめている（不変条件9）。`reconcileCounterOnStartup` は起動時にカウンタ未初期化を検知したら `getTodayMaxSeq` で復元する（design 5.3）。**`app/App.tsx` の起動時 `hydrate()` 群と同じ `useEffect` から呼ぶよう配線済み**（タスク16）。オフラインで復元できない場合は `'blocked'` を返すが、**この結果を見て会計開始を実際にブロックする画面側の対応はまだ無い**（起動時のベストエフォート補正のみ）
- `src/data/sync/checkout.ts` — 会計確定（FR-11）。`confirmSale(lines, note, received, now)` が採番・`sales`保存・`pendingQueue`投入・`currentTicket`削除を**単一のDexieトランザクション**で行う（design 4.1・不変条件9）。`端末未登録`（`config.terminalCode` が無い）の場合のみ拒否する（`canConfirm` による預かり金・空伝票のチェックは呼び出し側の責務で、ここでは再検証しない）。`CheckoutScreen.handleConfirmSale` が確定成功後に `data/sync/engine.ts` の `runSync()` を fire-and-forget で呼ぶ（design 4.1 手順4「会計確定時」トリガー）
- `src/data/sync/engine.ts` — 同期エンジン（design 4.1・6.6）。`runSync(options?)` が1回分の送信を担当し、`startSyncEngine()` が `app/App.tsx` の起動時に一度だけ呼ばれ online イベント・visibilitychange・30秒間隔を配線する。**多重起動ガード（モジュールスコープの `syncing` フラグ）は、ガード判定とフラグを立てる処理の間に `await` を挟むと競合する。** 実装時に実際にこの競合でテストが落ちた（2つの `runSync()` を同時に呼ぶと2回送信されてしまっていた）。ガード関連のコードを触るときは、`if (syncing) return` から `syncing = true` までを**同期的に**（`await` を挟まずに）行うこと。`blockedBy`（`TOKEN_EXPIRED`/`TERMINAL_DISABLED`）が立っている間、`force: true` を指定しない限り自動トリガーは何もしない。`force: true` は設定画面（`screens/settings/SettingsScreen.tsx`）の「今すぐ同期」ボタンから使う（タスク19で配線）
- `src/data/gas/client.ts` — GAS への低レベル通信（`postToGas`/`getFromGas`）。text/plain POST・タイムアウト（35秒。GAS 側の `waitLock(30000)` より長く取ること）・エラー正規化を行う。**`fetch()` はデフォルトのリダイレクト追従で問題なく動く**（GAS の 302 リダイレクトは Node の `fetch()` で実機確認済み。curl の `-L` で起きたボディ破損は curl 固有の挙動でブラウザの `fetch()` では発生しない）
- `src/data/gas/endpoints.ts` — GAS の13エンドポイントに対応する型つきラッパー。**呼び出し側はここだけを使い、`client.ts` を直接呼ばない。** トークン・端末コード・GAS URL は `data/db/config.ts` から読み、未設定なら通信せず `NOT_CONFIGURED` を返す。**`getTodayMaxSeq`/`getSalesHistory` のワイヤーフィールド名は `date`（`dateKey` ではない）。** `domain/types.ts` の命名と GAS 側実装（`gas/Sales.js`）を突き合わせて見つかった不一致を修正済み。**新しいリクエスト/レスポンス型を `domain/types.ts` に追加するときは、必ず対応する GAS 側のコード（`gas/*.js`）のフィールド名と一字一句突き合わせること**（型だけを見て「良さそう」と判断しない）
- `src/state/ticketStore.ts`（Zustand） — 入力中伝票。**すべての変更操作は `domain/ticket.ts` に委譲し、成功時のみ書き込みのたびに `currentTicket` テーブルへ保存する**（NF-04）。画面はストアのアクション（`addProductByNo` 等）だけを呼び、`lines` 配列を直接書き換えないこと
- `src/state/masterStore.ts`（Zustand） — 商品・カテゴリのキャッシュ。`replace()` が `data/db/masters.ts` の丸ごと置き換えとストアの更新を同時に行う。1件ずつの更新はここにも生やさないこと。`refreshFromServer()`（タスク17）は `getMasters` を呼び、成功時のみ `replace()` する。**失敗時はストアを一切変更しない**（呼び出し側がエラーを見て表示する）
- `src/state/syncStore.ts`（Zustand） — 接続状態・未送信件数・同期状態。`connection` を書き換えるのは `data/sync/engine.ts`（売上の同期）と `screens/products/`・`screens/categories/`（マスタ編集画面が自分自身の `getMasters`／保存／削除の成否で更新する。タスク17）の両方。**どちらも「直近の GAS リクエストの成否」という同じルールで書き換えており（design 4.3・不変条件18）、どちらか一方が offline を検知すれば、もう一方の画面にも Zustand のライブ購読を通じて即座に反映される**（例：マスタ管理画面を開いている最中に売上同期が offline を検知すると、マスタ編集ボタンも自動的に非活性になる）
- `src/index.css` — グローバルスタイル。**セーフエリアのインセット（`--safe-l`／`--safe-r`／`--safe-b`）は `:root` で一度だけ定義し、各画面の CSS Module はこれを継承して使う。** `index.html` に `viewport-fit=cover` があるため、画面の縁に接する要素（ヘッダー・一覧・モーダルのオーバーレイ等）は必ずこの分を padding に足すこと。横向きの iPhone では左右どちらかにノッチが来る。2カラムなどで画面の縁に接しなくなった要素だけが、自分自身に `--safe-r: 0px` のように再定義して打ち消す（`CheckoutScreen.module.css` の `orientation: landscape` ブロックが例）。**各 CSS Module で `env(safe-area-inset-*)` を直接書き直さないこと**
- `src/domain/format.ts` — 商品 No. の丸数字表示・金額の3桁区切り表示。React に依存しない純粋関数（要件定義 6.2・7.2）
- `src/domain/ticket.ts` の `ticketErrorMessage()` — `TicketError`（`TicketError` 固有＋`CalcError`）から日本語メッセージを引く統合関数。画面はこれだけ呼べばよく、エラーの出自（ticket.ts か calc.ts か）を気にしなくてよい
- `src/app/App.tsx` — 起動時に3ストアの `hydrate()`・`reconcileCounterOnStartup`・`startSyncEngine` を呼ぶ配線をここに置いている。画面を追加する際も、この起動時フックの位置は変えないこと。**画面遷移はルーティングライブラリを使わず、`useState<'checkout' | 'products' | 'categories' | 'history'>` の単純な出し分けにしている**（タスク17・18。この規模のキオスクアプリで URL ベースの遷移・ブラウザ履歴は不要と判断）。`CheckoutScreen` の「商品管理」ボタン→`ProductsScreen`→「カテゴリ管理」ボタン→`CategoriesScreen`、「履歴」ボタン→`HistoryScreen` で、各画面が `onBack` で1つ前に戻る
- `src/domain/masters.ts` — 商品・カテゴリのフォーム検証（要件定義6.2・6.3）。`ticket.ts` が `calc.ts` の個別検証を束ねるのと同じ形で、`validateProductForm`/`validateCategoryForm` が単一のエラーコードを返す。No. 重複・カテゴリ名重複・カテゴリ削除可否（`isProductNoDuplicate`/`isCategoryNameDuplicate`/`categoryHasProducts`）もここにある。**この層の検証は往復通信なしの即時フィードバック用であり、最終的な正は GAS 側（`gas/Products.js`・`gas/Categories.js`）のロック内検証。** 画面はここでの検証を通っても GAS が `VALIDATION_ERROR`/`DUPLICATE_KEY` を返す可能性を前提にエラー表示を用意すること
- `src/domain/history.ts` — SC-05 会計履歴（要件定義 FR-14・FR-15。タスク18）。`mergeSalesHistory(local, remote)` がローカル（IndexedDB `sales`。未送信も含むこの端末の当日分）とリモート（GAS `getSalesHistory`。オンライン時のみ取得できる全端末分）を1つの `HistoryEntry[]` にまとめる。**同じ `saleId` が両方にある場合はリモートを優先する**（他端末での取消をローカルのキャッシュが知らない可能性があるため）。`canCancelSale(entry)` が「未送信でない・未取消」の唯一の判定（design 2.7・不変条件12「未送信の会計は取り消せない」）で、画面はこれだけを見て取消ボタンの活性・非活性を決める
- `src/screens/checkout/` — SC-01 会計画面 ＋ SC-02 精算モーダル。`CheckoutScreen.tsx` が親で、`CategoryTabs`・`ProductGrid`・`Numpad`・`TicketPanel`・`TicketLineRow`・`PaymentModal` に分割している。スタイルは `CheckoutScreen.module.css`（CSS Modules）に集約し、他コンポーネントもここから import する。**hydration ガードはヘッダーの外側にだけかける**（`ticketHydrated && masterHydrated` が false の間は本文だけ「読み込み中」にし、ヘッダーは常に表示する。空の伝票が一瞬見えてから中身が現れる「ちらつき」を防ぐ設計。詳細はタスク13の完了報告を参照）。確認ダイアログ（伝票クリア・削除・会計確定）は `window.confirm` を使う（専用ダイアログコンポーネントはまだ無いため）。会計確定（FR-11）は `CheckoutScreen.handleConfirmSale` が `data/sync/checkout.ts` の `confirmSale` を呼ぶ形で実装済み。`PaymentModal` の `onConfirm` は預かり金（`Yen`）を引数に取る。**`onNavigateToProducts`・`onNavigateToHistory`・`onNavigateToSettings` を props で受け取る**（タスク17・18・19）。**カテゴリ別の色分けデザイン**（タスク20、ユーザー要望）：`domain/categoryColor.ts` の `resolveCategoryPalette` がカテゴリタブ・商品タイル（No.バッジ＋左端アクセントバー）の配色を決める。管理者が `CategoriesScreen` のスウォッチピッカーで色を選ばなければ、`displayOrder` 順に固定パレット（8色）を自動割り当てする。**コントラスト比4.5:1（要件定義7.3）はこのモジュールが常に保証する。** 商品タイルは白地カード＋シャドウで立体感を出し、カテゴリ色は面全体ではなくNo.バッジと左アクセントバーに絞っている（全面パステル塗りは「安っぽく見える」というユーザー指摘で変更した）。カテゴリタブ・主要CTA（精算へ・会計確定）の選択/押下状態は色やopacityを変えずシャドウ・浮き上がり・太字だけで表現している（**色を変えると同じ要素内で保証していたコントラスト比が崩れる可能性があるため、意図的に色を固定したままにしている**）。**レイアウトの切り替えは画面の幅ではなく「向き」（`@media (orientation: landscape)`）で行う。** 以前は `min-width: 900px` だけで縦積み↔2カラムを切り替えていたが、幅で判定するとスマホ横向き（852×393 等）が900px未満で縦積みに落ち、高さ393pxに5段積む形で破綻していた。`min-width: 900px` は現在「タブレット相当としてサイズを拡大する」用途に役割変更してあり、**ここでレイアウト（`grid-template-areas`）を切り替え直さないこと**。寸法は `.screen` のカスタムプロパティ（`--tile-min`・`--font-amount`・`--font-total`・`--pad`）に集約しモードごとに上書きする形で、**各トークンの下限が要件定義7.3の最小値（金額24px・合計40px）と一致させてあるため、新しいモードを足すときもトークンを上書きする限り7.3を割らない**（個別の `font-size` を直接書くとこの保証が消える）。**テンキーは全モード共通で収納式（初期状態は閉じる）。** 商品タイルのタップだけで会計する運用が主で、No. 直接入力を使わない担当者には常時表示のテンキーが場所を取るだけになるため（ユーザー要望）。開いたテンキーはグリッドの行を広げず商品グリッドの上に重ねる（行を広げると開閉のたびに商品タイルの位置が動く）。**トグルもテンキー本体も常に DOM に置き、開閉は `data-open` 属性で CSS に伝える**（条件レンダリングにすると jsdom ではメディアクエリが効かないため、テストから見える DOM と実機の DOM が食い違う。`CheckoutScreen.test.tsx` の「収納式テンキー」も、見た目ではなくこの属性を検証している）。**縦積み時の伝票エリアの高さ `--ticket-h` は行数によらない固定の割合にしてある。** 内容に応じて伸びる指定（`auto` や `minmax(min-content, ...)`）にすると、商品を追加するたびに商品グリッドが少しずつ狭くなってタップ先が動く（実際にユーザーから「商品を追加すると画面がどんどん狭くなる」と指摘があり、上限付きの可変から固定に変更した経緯がある）
- `src/screens/products/`・`src/screens/categories/` — SC-03 商品マスタ管理・SC-04 カテゴリ管理（要件定義 FR-01・FR-02。タスク17）。`ProductsScreen.tsx`/`CategoriesScreen.tsx` が一覧＋追加/編集フォーム（`ProductForm.tsx`/`CategoryForm.tsx`）を持つ。**オンライン時のみ編集可（要件定義9.1・不変条件19）の判定は `useSyncStore((s) => s.connection) === 'online'` のみを根拠にする。** 画面はマウント時に自分自身で `masterStore.refreshFromServer()`（内部で `getMasters` を呼ぶ）を実行し、その成否で `syncStore.setConnection()` を書き換える。保存・削除（`saveProduct`/`deleteProduct`/`saveCategory`/`deleteCategory`）も同様に成否で `connection` を更新し、成功時は必ず `refreshFromServer()` で全件再取得してからフォームを閉じる（`masterStore` は1件ずつの更新を提供しないため。CLAUDE.md 冒頭の `data/db/masters.ts` の項を参照）。カテゴリ削除は送信前にローカルキャッシュ（`categoryHasProducts`）で商品紐づきを確認し、往復通信なしで警告できる場合はそうする（GAS 側も同じ判定をロック内で行うため二重の安全網になる）。**`CategoryForm.tsx` の「表示色」は hex を手入力させず、`domain/categoryColor.ts` の `PALETTE_SWATCHES`（8色）から選ぶスウォッチピッカーにしている**（タスク20）。この8色は SC-01 側の自動割り当てパレットと完全に同じ値で、新しい色を片方にだけ追加しないこと（コントラスト未検証の色が紛れ込む）
- `src/domain/categoryColor.ts` — SC-01 のカテゴリ別配色（要件定義7.3のコントラスト比4.5:1を機械的に保証。タスク20）。`resolveCategoryPalette(categories, categoryName)` がタブ・タイルの背景色/文字色を返す。管理者が `Category.color` を設定していればそこから導出（WCAG輝度計算で黒/白いずれか読みやすい方を自動選択。任意の色に対しても4.5:1以上になることを理論上・テストの両方で確認済み）、未設定なら `displayOrder` 順に固定パレットを割り当てる。**色に関わるUIを新しく追加するときは、素の色を直接使わず必ずこのモジュールを経由すること**
- `src/screens/history/` — SC-05 会計履歴（要件定義 FR-14・FR-15。タスク18）。`HistoryScreen.tsx` がマウント時にローカル（`getAllSales` を当日の `saleId` で絞り込み）とリモート（`getSalesHistory`。成否で `syncStore.setConnection()` を更新）を取得し、`domain/history.ts` の `mergeSalesHistory` でまとめる。取消（`cancelSale`）成功後、この端末の `sales` に該当レコードがあれば `markSaleCanceled` でローカルにも反映してから一覧を再読み込みする（他端末の会計にはローカルレコードが無いため反映不要）。取消ボタンの活性条件は `online && canCancelSale(entry)` の両方（未送信・取消済みに加え、取消自体がオンライン時のみ実行できる GAS 呼び出しのため）
- `src/domain/settings.ts` — SC-06 設定画面の入力検証（GAS URL・端末名・PIN）。要件定義 NF-05・NF-06。`validateGasUrl` は `https://` 以外を弾く。`validatePin` は GAS 側 `setPin_` が PIN を4〜8桁の数字に限定していることに合わせている
- `src/domain/csv.ts` — 未送信データの CSV エクスポート（design 6.6・`TERMINAL_DISABLED` 時の回収経路）。`pendingSalesToCsv` は `gas/Sales.js` の `SALES_SHEET_HEADERS` と同じ列構成で出力する純粋関数。`confirmedAt`（UTC・JST offset どちらもあり得る）は `Intl`（`timeZone: 'Asia/Tokyo'`）で日付・時刻に分けてから出す（`domain/format.ts` の `formatTime`/`formatDate` と同じ考え方）
- `src/data/image/resize.ts` — 商品写真の縮小（design 9.2・タスク23）。**`domain/` ではなく `data/` に置く**（`canvas`・`createImageBitmap` というブラウザ API に依存するため。`domain/` は React にも通信にも DOM にも依存させない）。長辺320px・JPEG品質0.75。**アップロード前に必ずここを通すこと。** JPEG は透過を表現できないため、白で下地を敷いてから描画している（透過部分が黒く落ちるのを防ぐ）。**`createImageBitmap`・`canvas.toDataURL` は jsdom に無いため自動テストでは検証できない**（`ProductImage.test.tsx` はこのモジュールをモックしており、縮小そのものの正しさは実ブラウザでの確認が必要）
- `src/data/db/productImages.ts`・`src/data/sync/productImages.ts` — 商品写真のローカルキャッシュと取得制御（design 9.4・タスク22）。**`syncProductImages` は fire-and-forget で呼ばれるため、絶対に例外を投げてはいけない。** 応答の `imageBase64` が壊れていると `atob` が投げ、未処理の Promise 拒否になるうえ残りの写真の取得まで巻き添えで止まる（実装当初これで実際に落ちていた）。1枚ごとに try/catch で囲み、失敗した1枚だけ諦めて次へ進む。**主キーは画像ID（Drive のファイルID）で、写真を差し替えると GAS 側が新しいファイルを作るためIDが変わる。したがって「IDが一致する＝中身も同じ」が常に成り立ち、キャッシュの鮮度判定を持たなくてよい**（端末は「マスタが参照しているIDのうち手元に無いものだけ」を取る）。**値は `Blob` ではなく `ArrayBuffer` ＋ `mimeType` で保存する**——IndexedDB は仕様上 Blob を格納できるが iOS Safari に既知の不具合があり、オフライン必須の本アプリでは採れない（`fake-indexeddb` でも Blob は構造化クローンを通らず `{}` になるため、テストでも検知できない形になっていた）。`syncProductImages` は `masterStore.refreshFromServer()` の成功後に **await せずに** 呼ばれる（写真は補助表示であり、取得を待って商品一覧を遅らせない。要件定義 9.1）。**通信失敗時は例外を投げずその場で打ち切り、残りは次回に持ち越す。** 1回の上限は20枚
- `src/data/sync/tokenRefresh.ts` — design 6.5 のプロアクティブなトークン更新。`checkTokenExpiry(now)` は残り14日を切っていれば `refreshToken` を呼び、成功時のみ `config` の `apiToken`/`tokenExpiresAt` を更新する。**呼び出しのたびに GAS へ問い合わせるのは無駄なため、モジュールスコープの `lastCheckedAt` で1時間に1回まで間引く**（`data/sync/engine.ts` の30秒間隔にそのまま相乗りさせると期限が近いときに何十回も呼んでしまうため、あえて別のタイマー・別ファイルにした）。`startTokenRefreshWatcher()` を `app/App.tsx` の起動時 `useEffect` から呼ぶ
- `src/screens/settings/` — SC-06 設定・初回セットアップ（要件定義 NF-05・design 5.4・6章。タスク19）。`SettingsScreen.tsx` は `config`（GAS URL・端末コード・トークン等）の状態に応じて `'gasUrl' | 'register' | 'ready'` の3段階を出し分ける「ウィザード」。**未送信件数の表示は `syncStore.pendingCount` を使わず、画面が自前で読み込んだ `pendingSales`（`getAllPendingSales()`）の配列長から出す**（一覧表示と件数表示を別ソースから取ると食い違う。`PaymentModal` の `total` 二重管理事故（タスク14）と同じ轍を踏むところだったのを、このタスクのテスト作成中に自分で見つけて修正した）。`blockedBy === 'tokenExpired'`／`'terminalDisabled'` のときは通常の未送信データ欄を出さず、それぞれ専用の導線（PIN 再ログイン／CSV エクスポート）に差し替える。**マウント時にしか `getAllPendingSales()` を読み直さないため、画面を開いたまま別の操作（会計確定等）で未送信キューが変化しても自動では反映されない。** `products`/`categories`/`history` と同じ「再読み込み」ボタンを設けているので、最新状態を見たい場合はそれを押すこと（ライブ購読は行わない設計）。**会計確定直後は `CheckoutScreen.handleConfirmSale` が確定成功のたびに `void runSync()` を fire-and-forget で呼んでおり（design 4.1 手順4）、端末が実際にオンラインならほぼ即座に同期・キューから削除されるため、確定後すぐに設定画面を開いても未送信一覧に何も見えないのが正常な場合がある。** 「本当に未送信キューに積まれているか」を確認したいときは、DevTools の Network タブを Offline にしてから会計を確定すること（同期が起きず、キューに残った状態を確実に見られる）。**端末名の変更**（タスク20で追加。design 2.5.1）は `gas/Auth.js` の `renameTerminal` を呼ぶ。現行の有効なトークンで認証し PIN は不要（表示用の名称変更でしかなく認証には影響しないため。`refreshToken` と同じ考え方）。**「登録をやり直す（リセット）」ボタン**（タスク20で追加）は `config` の `terminalCode`/`terminalName`/`apiToken`/`tokenExpiresAt` だけを消去する（`gasUrl` は残す）。`step` の判定がこれらの有無で決まるため、押すと自動的に `'register'` に戻り、コンソール操作なしで端末登録をやり直せる。**GAS 側のトークン実体・端末タブの行は消さない**（フロントの `config` を空にするだけのローカル操作）ため、同じ端末コードで別デバイスが動いていた場合そちらは影響を受けない。GitHub Pages デプロイ後の実機検証で、トークンのハッシュは有効なのに `端末` タブに対応する行が無く `TERMINAL_DISABLED` から抜け出せなくなる事象が実際に発生し、その復旧手段として追加した（原因は特定できていない。行が失われた経緯は不明のまま）
- `PaymentModal` は `total` を props で受け取らない。**合計金額は必ず `ticketTotal(lines)` から計算すること。** `total` を別 prop として渡す設計にしたところ、`canConfirm()` が内部で `lines` から独自に合計を再計算するため、渡した `total` と実際の `lines` の中身が食い違うとテストが誤って通ってしまう事故が実際に起きた（タスク14）。合計が絡む値は常に `lines` 1箇所から導出し、並行して別経路で渡さないこと

CSS Modules を使うコンポーネントをテストするとき、クラス名はハッシュ化される（`_ticketTotalAmount_xxxxx`）ため、`{ selector: '.className' }` のような生のクラス名指定では要素を見つけられない。**曖昧になりうる要素（同じテキストが複数箇所に出る等）は `data-testid` を振るか `within()` でスコープを絞ること。** 商品ボタン等インタラクティブ要素には明示的な `aria-label` を付け、`getByRole('button', { name: ... })` が正規表現で複数ヒットしないようにする（同じ商品名を含むボタンが1行に複数存在しうるため）。

テストで IndexedDB を使う場合は `fake-indexeddb/auto`（`src/test/setup.ts` で読み込み済み）が有効なので追加の対応は不要。各アクセサのテストは対象テーブルを `beforeEach` で `clear()` してから実行する（同一 Dexie インスタンスをテスト間で共有しているため）。Zustand ストアのテストも同様に `beforeEach` で `useXxxStore.setState({...初期値})` してから実行する（ストアはモジュールレベルのシングルトンでテスト間を跨いで状態が残るため）。`data/gas/` のテストは `vi.stubGlobal('fetch', ...)` でモックする。実機確認をしたい場合は一時的な `*.test.ts` を作って `npx vitest run <path>` で個別実行し、確認後に削除すること（自動テストスイートに実ネットワーク依存のテストを含めない）。UI コンポーネントのテストは `@testing-library/react` ＋ `@testing-library/user-event` を使う。

`src/` 配下の他のディレクトリは設計 3.1 の構成で用意済みだが、まだ空。

**まだ対応できていないこと：** `data/sync/counter.ts` の `reconcileCounterOnStartup` は `app/App.tsx` の起動時 `useEffect` から呼ぶよう配線済み（タスク16）だが、**`'blocked'` が返った場合に会計開始を実際にブロックして表示する画面側の対応はまだ無い**（起動時のベストエフォート補正のみで、戻り値を見ているだけの状態）。着手時にこの CLAUDE.md を検索して見つけること。

## 技術スタック（確定・変更不可）

ユーザーとの合意事項であり、勝手に置き換えないこと。別案が優れていると考える場合は提案に留める。

| 層 | 技術 |
| --- | --- |
| データストア | Google スプレッドシートのみ。**専用DB（Supabase / Firebase 等）は使わない** |
| バックエンド | Google Apps Script の Web アプリ（`doGet` / `doPost`）。専用サーバーは立てない |
| フロント | Vite + React + TypeScript の PWA（Service Worker + IndexedDB） |
| 状態管理 | Zustand |
| IndexedDB | Dexie |
| PWA | vite-plugin-pwa（Workbox） |

「月額のサーバー・DB費用を発生させない」ことが構成上の要件（要件定義 1.2 / 5.2）。有料マネージドサービスの導入提案はこの前提に反する。

## ディレクトリ構成

```
src/
├─ app/       エントリ・ルーティング・認証ガード
├─ screens/   画面。SC-01〜06 と 1:1（checkout / products / categories / history / settings）
├─ domain/    純粋ロジック。types / calc / saleNumber / ticket
├─ state/     Zustand ストア。ticketStore / masterStore / syncStore
└─ data/
    ├─ gas/   GAS 通信層
    ├─ db/    Dexie スキーマ・アクセサ
    └─ sync/  同期エンジン・接続監視・採番カウンタ
gas/          Apps Script 側（clasp 管理）
docs/         要件定義
```

`domain/` は React にも通信にも Dexie にも依存させない。金額計算と採番のバグを UI・通信から切り離すための境界であり、ここにテストを集中させる。

## 絶対に守る不変条件

破ると金額ずれ・売上重複・データ消失のいずれかを起こす。

**金額**
1. すべて整数円。金額に浮動小数点を使わない。小数は発生しない（要件定義 3-5, 6.7）
2. 割引は **1点あたりの単価** に対して適用する。`行小計 = (単価 − 行割引額) × 個数`。合計金額から引くのではない（6.6）
3. 割引額は 0 以上・単価以下。超過はエラー
4. 商品金額は税込。アプリ内で税計算は一切しない（3-6）
5. **`TicketLine.unitPrice` は割引前、`SaleLine.netUnitPrice` は割引後。** 同じ「単価」でも意味が違う。取り違えると金額がずれる
6. 金額は `Yen` 型（整数保証つきブランド型）。通信・DB・入力の境界では必ず `toYen()` を通してから使う

**会計番号**

7. 形式は `YYYYMMDD-{端末コード}{連番3桁}`（例 `20260723-A014`）。連番は端末ごと・日付ごとに 001 から（5.4）
8. **端末コードは英大文字1〜4文字のみ。** 数字を許すと、連番が4桁に延びたとき `A1014` を `A1`+`014` と `A10`+`14` に分解できなくなる（設計 5.4）
9. 連番の採番と会計データの保存は **同一の Dexie トランザクション内** で行う。分離すると二重タップで同番号が発生する
10. 端末コードの発行は `registerTerminal` のみが行い、GAS のロック内で一意性を保証する。端末側で勝手に決めない

**売上ログ**

11. 追記専用。既存行を書き換えない。会計取消はマイナス個数の行を追記して表現する（6.10）
12. **未送信の会計は取り消せない。** 履歴画面では取消ボタンを非活性にし、同期完了後にのみ取消可能とする。キューから取り下げる方式は採らない（追記専用の原則と衝突するため。設計 2.7）
13. `appendSales` は `saleId` で冪等。同じ `saleId` は二度書かない
14. 重複チェックと追記は **同一の ScriptLock 内** で行う。チェックだけロック外に出すと競合する。**月タブが存在しない場合の自動生成も同じロック内で行う**（タブの有無確認 → 作成の間をロック外に出すと、複数端末が月初の初回会計をほぼ同時に送った際に「シート名の重複」で例外になりうる。理由は重複チェックと同じ）
15. 追記は組み立てた二次元配列を1回の `setValues` で書く。`appendRow` の連打はしない

**オフライン（要件定義 9.1・必須要件）**

16. 会計確定はネットワークを待たない。ローカル保存が完了した時点で会計成立とする
17. 未送信キューは **サーバーの受理応答を受け取るまで削除しない**。認証エラー・タイムアウトのいずれでも削除しない。キューの消失は売上の消失を意味する
18. 接続状態の真実は直近の GAS リクエストの成否。`navigator.onLine` は同期を試すきっかけにのみ使い、状態表示の根拠にしない
19. マスタ編集（商品・カテゴリ）はオンライン時のみ許可する。オフライン編集を許すと端末間で不整合が起きる

**認証・失効（NF-05 / NF-09）**

20. apiToken は端末に紐づく。端末ごとに別のトークンを発行し、共有トークンにしない
21. 認証が必要な全リクエストで `トークン → 端末コード → 端末タブの状態` を検証し、状態が `無効` なら拒否する。`login` も同様に拒否する
22. 端末を無効化したら、その端末のトークン実体を破棄する。フラグを見るだけにしない
23. トークンは平文で保存せず、ハッシュのみを保持する。PIN も同様

## GAS 固有の注意

- **コード管理は clasp。Apps Script エディタで直接編集しない。** `gas/` はこのリポジトリの一部として git 管理する
- **言語は素の JavaScript。TypeScript は使わない。** GAS は ES モジュール（import/export）を解決できず、バンドラーを組むほどの規模でもないため。複数の `.js` ファイルが GAS のグローバルスコープを共有する前提でファイルを分ける（設計 2.9 のファイル構成）
- Apps Script プロジェクトは**コンテナバインド型**（正データのスプレッドシートに紐づく）。スタンドアロン型にしてスプレッドシートIDを持ち回る必要はない
- **CORS**：GAS はプリフライト（OPTIONS）に応答できない。POST は `Content-Type: text/plain` で JSON 文字列を送る単純リクエストに限定し、GAS 側で `JSON.parse(e.postData.contents)` する。`application/json` を指定すると必ず失敗する
- 認証つきの呼び出しは GET を使わず POST に寄せる。GET だとトークンが URL に載り実行ログに残る
- ロックは `LockService.getScriptLock()` に統一する。`getDocumentLock()` と混在させると排他が効かない
- `waitLock` のタイムアウト時はエラーを返すだけにし、リトライはクライアントの同期エンジンに任せる。GAS 側で待ち続けると6分の実行時間制限を圧迫する
- ロックの解放は必ず `finally` で行う
- 売上ログは月次タブ `売上ログ_YYYYMM`。当月タブが無ければ GAS が自動生成する
- シークレット（PIN ハッシュ・トークンハッシュ・トークンエポック）は Script Properties に置く。スプレッドシート上には置かない（店舗スタッフがシートを閲覧できるため）
- 全ての書き込み系の前に `ensureCoreSheets()`（`SheetInit.js`）を呼び、静的タブ（商品マスタ・カテゴリ・端末・操作ログ）の存在を保証する。冪等なので毎回呼んでよい
- **デプロイした Web アプリを `curl` で疎通確認するとき、`curl -L` でリダイレクトを自動追従させると POST が壊れる。** GAS の Web アプリは応答を `script.googleusercontent.com` への 302 リダイレクトとして返すが、`-L` に `-d`（POSTボディ）を組み合わせると、リダイレクト先への再送でボディが壊れて Google 側の汎用エラーページが返る（`--post302 --post303` を足しても同様に壊れる）。**確実な方法：`curl -D -` などで一旦 `Location` ヘッダを取り出し、そのURLに対して改めて単純な `GET` を投げる。** ヘビーな処理（doGet/doPost の実行）は最初のリクエストで完了しており、リダイレクト先は結果を返すだけなので、2段階目は常に GET でよい（元のリクエストが POST でも）

## UI の制約

- ユーザー向け文言はすべて日本語
- タップ領域 44×44pt 以上、金額表示 24pt 以上、合計・釣銭は 40pt 以上、コントラスト比 4.5:1 以上（7.3）
- 「伝票クリア」「削除」「会計確定」は確認ダイアログを挟む
- 商品 No. は 1〜20 を丸数字（①〜⑳）、21 以降は通常数字で表示する
- 預かり金が合計未満のときは不足額を赤字表示し、会計確定ボタンを非活性にする

## コマンド

```bash
npm run dev            # 開発サーバー
npm run build          # 本番ビルド（型チェック込み）
npm run preview        # ビルド結果の確認。Service Worker の確認はこちら
npm run test           # 単体テスト（domain 層中心）
npm run typecheck      # tsc -b
npm run lint           # oxlint

cd gas && npx clasp push     # GAS へ反映（gas/ はタスク7で作成）
cd gas && npx clasp deploy   # Web アプリとして再デプロイ
```

**Service Worker は開発サーバーでは無効**にしてある（`vite.config.ts` の `devOptions.enabled: false`）。古いキャッシュで変更が反映されない事故を避けるため。オフライン動作の確認は `npm run build && npm run preview` で行う。

GAS を再デプロイすると Web アプリ URL のバージョンが変わる場合がある。既存端末の設定 URL に影響しないよう、デプロイは既存デプロイの更新として行うこと。

TypeScript 7 では `baseUrl` が削除されている。パスエイリアスは `paths` に相対パス（`"@/*": ["./src/*"]`）で書く。

## 規約

- テストは `domain/` の純粋関数を最優先で書く。特に金額計算（6.7）と採番（5.4）は境界値まで網羅する
- コミットは実装タスク単位（1タスク＝1コミット）
- スプレッドシートの列を増減したら `docs/requirements.md` 8章・`docs/design.md` 1章・GAS の列定数を必ず同時に更新する。片方だけ変えるとデータがずれる
