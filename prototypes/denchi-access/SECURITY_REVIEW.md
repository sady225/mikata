# 2026-11-11 認証ゲートの実装・動作確認・セキュリティレビュー（未公開）

## 事実確認
- GitHub `master:kodomo-denchi.html` は2026-11-10の v0.2.1。無料アプリの7STEP・端末内localStorage保存キーは既存のまま。
- 公開URL `https://mikata.ryukyu-tane.com/kodomo-denchi.html` はHTTP 200、v0.2.1、作業ブランチのHTMLとバイト一致。本試作から本番変更はしていない。
- Cloudflare Workerの試作ソースとNode `node:test` 用テストを別ブランチに追加した。
- Node.js v22.14.0で16件の自動テストを実行し全件成功。Wrangler 4.160.0のローカルWorker+R2で架空PDFのHTTP E2Eも成功。
- Safariレスポンシブ表示390x844で無料版の7STEP、タップ選択、任意入力、カード、localStorage保存と再読込後の履歴を確認。
- **Cloudflareへのデプロイ、クラウドR2作成、クラウドSecret設定、実資料配信、iPhone/Android実機確認はしていない。** OAuth期限切れの再ログインを完了できず、Cloudflareアカウントは無変更。
- 11月8日の資料6テーマの販売とStripe webhookはこの試作の対象外。

## セキュリティ検証
| 観点 | 現在の対策 | 判定 |
| --- | --- | --- |
| 未認証PDF直アクセス | /material で署名Cookieを検証、R2はWorker binding経由 | コードに実装／実環境未検証 |
| 秘密漏洩 | 合言葉・署名鍵は環境Secretのみ。Gitに実値なし | コード上の対策あり |
| Cookie偽造・期限 | HMAC-SHA256署名、2時間、HttpOnly・Secure・SameSite Strict | NodeとローカルHTTPで成功 |
| CSRF | ログインとログアウトはOrigin一致・POST限定 | NodeとローカルHTTPで成功 |
| 入力検証 | Content-Type判定、合言葉長制限、URL固定。Content-Lengthの厳密検査と最大1024バイトのストリーミング読取。異常UTF-8は403 | Nodeで境界/異常系成功 |
| 総当たり | Workers Rate Limiting bindingを必須にし6回目は429 | ローカルHTTP成功／**クラウドでは近似的。WAF・厳密限度・監視は未確認** |
| PDFの情報流出 | Cache-Control no-store、Cookie依存、固定R2キー。公共GitHubに実資料を置かない | ローカルR2で成功／クラウド公開設定要確認 |
| PII・本人データ | こどものでんち既存コード・localStorageと認証ゲートを分離 | コード分離済み／サイト統合時は再確認 |
| 依存関係 | Workerは外部npmライブラリ未導入 | 新規依存なし |
| XSS/情報漏洩 | 入力を反射せず、固定HTMLはCSP、カードはtextContent。障害応答は詳細を隠す | Node検証成功 |
| 独立レビュー | 自己レビューのみ | **別レビュー未実施：公開不可** |

## 検出事項の分類

### Critical
- 0件（ローカルで確認した範囲）。

### High
- 0件（ローカルで確認した範囲）。クラウド構成を未検証のため、本番について0件とは認定しない。

### Medium
1. **Rate LimitはPoPごとの近似値**。分散試行で5回/分を超え得る。専用WAF、必要ならDurable Object等による厳密限度、監視を公開前に確認する。
2. **共通合言葉は本人識別・個別失効ができない**。20字以上の高エントロピー値、限定配布、期限ごとのローテーション、漏洩時の全体失効を運用条件にする。
3. **クラウドR2の非公開設定とWorker経由以外の到達不能性が未検証**。`r2.dev` とCustom Domainを無効にし、直アクセス不能をクラウド環境で確認する。

### Low
1. **認証失敗の監視・アラート運用が未設計**。合言葉、Cookie、本文、児童情報を記録せず、異常回数だけを最小限に監視する。
2. **実機と支援技術が未検証**。iPhone Safari、Android Chrome、VoiceOver/TalkBackでフォーカス、エラー通知、戻る/再読込を確認する。

## 残る公開ブロッカー
- 実際のCloudflare環境・HTTPS Cookie・クラウドR2・CDN経由のアクセス制御が未検証。
- クラウドR2のPublic Development URLとCustom Domainが無効であることを未確認。
- 同一合言葉の共有・流出・全員分の失効は共通合言葉方式の制約。高エントロピー鍵、配布範囲、ローテーション、ログ取り扱いを管理。
- 別担当の敵対的レビュー、クラウドのレート制限/WAF検証、実端末Safari/Android Chromeとアクセシビリティが未完了。
- 実資料の権利・対象者・再配布条件を人間が確認していない。
- 完了するまでは本番について**Critical/High = 0 を認定しない**。本番公開しない。

## 実機確認の手順
1. iPhone Safariで無料版 `kodomo-denchi.html` を開き、7STEP、タップ選択、答えない選択、カード印刷、保存→再起動→履歴復元、v0.1履歴を確認。
2. Android Chromeで同条件を再検証し、共有端末とブラウザデータ削除の挙動も観察。
3. Cloudflareのテストドメインで合言葉入力、Cookie期限、未ログイン直リンク拒否、改変Cookie、PDF配信、戻る/再読込、タブ共有・別端末の独立性を確認。
4. VoiceOver/TalkBackでフォームラベル、エラー、フォーカス、拡大表示を確認。
5. 実端末からアクセスした事実・端末OS/ブラウザバージョン・結果をLayer1に記録。未実施を合格にしない。
