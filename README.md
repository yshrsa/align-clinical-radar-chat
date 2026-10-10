# Align Clinical Operations Radar — Cloud Chat

- AI Chat: https://align-clinical-radar-chat.pages.dev/
- News: https://yshrsa.github.io/align-clinical-radar-news/

クリアアライナー治療とClinical / Treatment Planning Operations領域の公開文献を検索し、
Cloudflare Workers AI上のQwen 3.8 27Bが根拠番号付きで回答する独立クラウドポータルです。
D1の文献テーブルを通常の検索元にし、D1が未初期化または一時障害でも、Notion（任意）、
品質ゲート通過済みのGitHub Pages JSONの順に自動退避するため、検索とチャットが停止しません。

AI ChatはStructural Heart RadarおよびBI Evidence Radarと同様にCloudflare Accessで保護します。
ブラウザはPages Functionの同一Origin APIだけを呼び、Pages FunctionがAccess認証済みメールを
Workerへ安全に引き渡します。Workerのチャット・検索・履歴APIは共有Gateway Secretなしの
直接呼び出しを拒否し、D1履歴を認証メール単位に分離します。

## 無料枠を守る設計

- OpenAI API、Vectorize、有料フォールバックは使いません。
- Qwen呼び出し前にD1で1質問600 Neurons、1要約500 Neuronsを予約します。
- チャット枠はUTC 1日6,000 Neurons、要約枠は4,000 Neuronsです。
- チャットは1利用者10回/分、検索30回/分、履歴60回/分に制限します。
- Cloudflare側の上限に達した場合、自動で有料APIへ切り替えずAI処理を停止します。

## 構成

- `frontend/`: Cloudflare Accessで保護するCloudflare Pages用UI
- `functions/`: Access認証をWorkerへ引き渡す同一Origin Gateway
- `worker/`: D1文献検索、公開フィード退避、根拠付きQwen回答、D1履歴API、分単位レート制限
- `migrations/`: 文献・同期状態、スレッド・メッセージ・日次AI予算

文献テーブルにはPubMedメタデータ、Publication Type、MeSH、製品・企業・テーマ分類、
英語抄録（英語要約）、7項目の日本語要約、同期ハッシュを保存します。初回は全件、以後は
同期ハッシュが変化した文献だけを毎日06:15 JSTのNewsワークフローから追加・更新します。

## 必要な秘密情報

- Worker secret `INGEST_SECRET`（GitHub Actionsの要約専用endpoint認証）
- Worker / Pages共通secret `PAGE_GATEWAY_SECRET`
- 任意: `NOTION_API_KEY` / `NOTION_DATABASE_ID`

Cloudflare AIは`AI` bindingを使うため、外部AIキーは不要です。D1作成後に
`worker/wrangler.toml`のIDを更新し、migration、Worker、Pagesの順にデプロイします。
Workerは`worker/wrangler.toml`、Pagesはルートの`wrangler.toml`を使い、Bindingsを混在させません。
