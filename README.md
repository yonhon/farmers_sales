# Farmers Sales Dashboard

農大ファーマーズマーケットの販売状況を表示する、認証付きの公開フロントエンドです。ソースコードとGitHub PagesのURLは公開されますが、売上データはSupabase AuthとRLSで保護します。

## セキュリティ境界

- このリポジトリにraw/processed販売データを置かない
- Database password、connection string、secret/service-role keyを置かない
- ブラウザではProject URLとpublishable keyだけを使用する
- 未認証の`anon`には集計ビューの権限を付与しない
- 認証と認可はSupabase Auth・RLSで実施する

## ローカル開発

`.env.example`を`.env.local`へコピーし、Supabase Dashboardから取得したProject URLとpublishable keyを設定します。

```bash
npm install
npm run dev
```

`.env.local`はGit管理対象外です。

## Supabase

非公開リポジトリ側のマイグレーションとseedを適用した後、Data APIのExposed schemasへ`analytics`を追加します。画面は次の読み取り専用ビューだけを参照します。

- `analytics.daily_sales_summary`
- `analytics.daily_product_sales`

## GitHub Pages

リポジトリのSettingsで次を設定します。

1. Pages → Build and deployment → Sourceを`GitHub Actions`にする
2. Settings → Secrets and variables → Actions → Variablesで以下を追加する
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
3. `main`ブランチへpushする

公開URLは`https://yonhon.github.io/farmers_sales/`です。Viteの`base`も`/farmers_sales/`に設定済みです。

## 検証

```bash
npm test
npm run typecheck
npm run build
```
