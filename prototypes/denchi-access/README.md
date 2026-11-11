# こどものでんち｜11/8セミナー限定閲覧ゲート（未公開試作）

**Status: prototype, NOT deployed.** `sady225/mikata` の `master:kodomo-denchi.html` は変更しない。

## 目的と保護境界
- 無料公開中の「こどものでんち v0.2.1」は従来どおり利用できる。児童・保護者の自己記録 `localStorage` に触らない。
- 11/8のセミナー参加者は会員登録なしで強い共通合言葉を入力し、限定のPDFを閲覧できる。
- 限定のPDFは**公開GitHubやGitHub Pagesに置かない**。R2の公開URLを無効化したプライベートバケットからWorkerが取得。
- 現在の試作は **参加者向け単一PDF** のみ。6テーマ全体の取り扱い、非参加者へのStripe販売、購入者用認可は未実装。

## 構造
- `src/worker.mjs`: `/` 受付、`POST /login` 合言葉認証、`GET /material` サーバ認可とR2配信、`POST /logout`。
- `test/worker.test.mjs`: Node組込テストのモック（本番Cloudflareに対するE2Eではない）。
- `wrangler.example.toml`: 構成見本。**そのままデプロイ禁止**。
- R2オブジェクトキーは固定 `seminar/2026-11-08/theme-01.pdf`。パス引数で他の教材を指定できない。
- ブラウザへ合言葉や署名鍵を配信しない。ログ、GitHub、HTMLに秘密を書かない。

## ローカルテスト
Node.js 20以降を用意して `node --test test/worker.test.mjs` を実行する。

2026-11-11にNode.js v22.14.0で16件を実行し、全件成功した。認証成功・失敗、セッション期限切れ、Cookie改変、未認証アクセス、段階的な総当たり制限、CSRF、巨大/異常本文、XSS非反射、R2/Rate Limit障害時のfail-closed、キャッシュ制御を含む。ただしNodeのMockだけで本番Cloudflareを保証しない。

同日、Wrangler 4.160.0のローカル実行系とローカルR2へ架空PDFを入れてHTTP E2Eも行った。結果は `GET /` 200、未認証 `/material` 403、誤合言葉401、Origin不一致403、認証303、認証後PDF 200、改変Cookie 403、同一IPの6回目429。取得PDFはR2投入ファイルとバイト一致し、`Cache-Control: no-store, private`、`Vary: Cookie`、CookieのSecure/HttpOnly/SameSite=Strict/Max-Age=7200を確認した。

CloudflareアカウントのOAuthが期限切れで再ログインが完了しなかったため、クラウド上のWorker/R2は作成・変更していない。

## 設定・公開前のチェック（未完了）
1. 11/8資料の原本・著作権・公開範囲・価格・従来の無料教材方針との整合を人間が確認する。
2. Cloudflareの別テスト環境でWorker+Private R2を用意する。パブリックバケットを禁止し、本番の既存サイトと独立させる。
3. 共有合言葉は長いランダム文字列（最低20字）、`SEMINAR_PASSCODE` と `SESSION_SIGNING_KEY`（32文字以上）を**Cloudflare Secrets**へ設定。サンプルをそのまま使わない。`wrangler.example.toml`のダミー部分は現行公式ドキュメントで置き換える。
4. `LOGIN_LIMITER` bindingを設定し、別途WAFと可能なら厳密な試行制限を設ける。`wrangler.example.toml` は現行の `[[ratelimits]]` 構文へ更新済みだが、namespaceとbucketは専用テスト値へ置き換える。Cloudflare Rate Limiting APIは近似的・ロケーションごとであり強制的な総試行回数上限ではない。
5. 期限付きセッションの作成/検証（HMAC-SHA256/HttpOnly/Secure/SameSite=Strict）とURL直打ち・Cookie改変・未認証PDF・PDFのキャッシュを試す。
6. エラーログ・個人データ・秘密情報・スクリプトの依存関係・セキュリティヘッダを検査。別AI・人間による敵対的レビュー、Critical/High 0件、実機Safari/Chrome/VoiceOver確認を要求。
7. 既存 `mikata` 本番やCloudflare/Stripeは明示承認前に変更しない。ブランチのまま保管。

## 現時点の未検証・留意点
- **実機検証はしていない**。Safariレスポンシブ表示390x844で、無料版の7STEP、タップ選択、任意入力、カード表示、localStorage保存、再読み込み後の履歴復元を確認した。Android Chrome実機/エミュレーション、iPhone実機、VoiceOver/TalkBackは未確認。
- 公開の `https://mikata.ryukyu-tane.com/kodomo-denchi.html` は2026-11-11にHTTP 200、v0.2.1、ブランチ内HTMLとのバイト一致を確認した。本試作から本番は変更していない。
- **クラウドの認証サーバーは稼働していない**。WranglerローカルE2Eまでで、Cloudflareアカウントには何も作成していない。
- 共通合言葉は人から人へ共有可能。本人識別、購入認可、アクセス権剥奪に向かない。合言葉配布先を限定し必要に応じてローテーションする。
- Rate Limitは大域的に厳密でないので、決済連携や個人データ扱いの認証にはそのまま使わない。
- サーバー側ログインとは独立に、実端末でのJSONバックアップ/削除/印刷/PDF機能は既存アプリ側で再試験する。

公式参考:
- https://developers.cloudflare.com/workers/runtime-apis/web-crypto/
- https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
- https://developers.cloudflare.com/r2/get-started/workers-api/

正本: `sady225/obsidian` の `AGENTS.md`、アルパカすく〜る `CLAUDE.md` と `SECURITY.md`、2026-11-09限定閲覧設計記録。
