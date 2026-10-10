# AGENTS.md — Align Clinical Operations Radar Chat

このリポジトリは、Align TechnologyのClinical / Treatment Planning Operationsを題材にした
独立クラウドポータルです。

- `bi-evidence-radar*`、`shd-platform`を実行時依存にしない。
- 既存Radarを変更せず、必要な契約だけをこのリポジトリ内へ複製する。
- 公開フィードまたは明示設定されたNotionコーパスだけを根拠として回答する。
- 根拠にない内容・数値・症例数を補完しない。
- ブラウザAPIはCloudflare Accessと同一Origin Gatewayを通し、Worker直アクセスを拒否する。
- OpenAI APIや有料フォールバックを追加しない。
- Cloudflare AI呼び出し前にD1予算を予約し、利用者別レート制限を維持する。
- コード変更には比例したテストを追加し、WorkerとPagesを個別に検証する。
