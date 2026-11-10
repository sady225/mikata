# 2026-11-11 認証ゲートの実装・セキュリティ一次レビュー（未公開）

## 事実確認
- GitHub `master:kodomo-denchi.html` は2026-11-10の v0.2.1。無料アプリの7STEP・端末内localStorage保存キーは既存のまま。
- 公開URL `https://mikata.ryukyu-tane.com/kodomo-denchi.html` の直接HTTP確認は利用中のWebツールで失敗。サイト停止を意味するとは断定しない。
- Cloudflare Workerの試作ソースとNode `node:test` 用テストを別ブランチに追加した。
- **Cloudflareへのデプロイ、R2バケットの作成、秘密情報設定、実PDF配信、Nodeテスト実行、ブラウザ/スマホ実機検証はしていない。**
- 11月8日の資料6テーマの販売とStripe webhookはこの試作の対象外。

## セキュリティ一次レビュー（実行テストではない）
| 観点 | 現在の対策 | 判定 |
| --- | --- | --- |
| 未認証PDF直アクセス | /material で署名Cookieを検証、R2はWorker binding経由 | コードに実装／実環境未検証 |
| 秘密漏洩 | 合言葉・署名鍵は環境Secretのみ。Gitに実値なし | コード上の対策あり |
| Cookie偽造・期限 | HMAC-SHA256署名、2時間、HttpOnly・Secure・SameSite Strict | コード上の対策あり／試験未実行 |
| CSRF | ログインとログアウトはOrigin一致・POST限定 | コード上の対策あり／試験未実行 |
| 入力検証 | Content-Type判定、合言葉長制限、URL固定。Content-Length事前検査と最大1024バイトのストリーミング読取で巨大なPOSTを遮断 | コード修正済み／未試験 |
| 総当たり | Workers Rate Limiting bindingを必須にし失敗は429 | **要改善：Rate Limitingは近似的。公開前にWAF・厳密限度・運用監視を確認** |
| PDFの情報流出 | Cache-Control no-store、Cookie依存、固定R2キー。公共GitHubに実資料を置かない | コード上の対策あり／R2公開設定要確認 |
| PII・本人データ | こどものでんち既存コード・localStorageと認証ゲートを分離 | コード分離済み／サイト統合時は再確認 |
| 依存関係 | Workerは外部npmライブラリ未導入 | 新規依存なし |
| 独立レビュー | 自己レビューのみ | **別レビュー未実施：公開不可** |

## 残る高優先度ブロッカー
- 実際のCloudflare環境・HTTPS Cookie・R2バケット・CDN経由のアクセス制御が未検証。
- 大容量POST本文の受信制限はコード上修正済み（commit 2384dec）。境界値・異常な転送・文字コードのテストは未実施。
- 同一合言葉の共有・流出・全員分の失効は共通合言葉方式の制約。高エントロピー鍵、配布範囲、ローテーション、ログ取り扱いを管理。
- 別担当の敵対的レビュー、レート制限/WAF検証、実端末Safari/Android Chromeとアクセシビリティ、実際の公開URLの健全性検査が未完了。
- 完了するまでは**Critical/High = 0 を認定しない**、本番公開しない。

## 実機確認の手順
1. iPhone Safariで無料版 `kodomo-denchi.html` を開き、7STEP、タップ選択、答えない選択、カード印刷、保存→再起動→履歴復元、v0.1履歴を確認。
2. Android Chromeで同条件を再検証し、共有端末とブラウザデータ削除の挙動も観察。
3. Cloudflareのテストドメインで合言葉入力、Cookie期限、未ログイン直リンク拒否、改変Cookie、PDF配信、戻る/再読込、タブ共有・別端末の独立性を確認。
4. VoiceOver/TalkBackでフォームラベル、エラー、フォーカス、拡大表示を確認。
5. 実端末からアクセスした事実・端末OS/ブラウザバージョン・結果をLayer1に記録。未実施を合格にしない。
