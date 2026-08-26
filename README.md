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

非公開リポジトリ側のマイグレーションとseedを適用した後、Data APIのExposed schemasへ`analytics`を追加します。ダッシュボードは次の集計ビューを参照します。

- `analytics.daily_sales_summary`
- `analytics.daily_product_sales`

`admin`または`inputter`には「データ登録」が表示されます。対象年を選択して売上状況を貼り付けると、合計と商品対応を確認した後、`public.import_sales_blocks` RPCでトランザクション登録します。ブラウザからSecret Keyや`service_role`は使用しません。

認証画面はLINEログインを標準とし、既存のメール・パスワード認証は管理者用の予備手段として残しています。初回のLINEログイン直後はデータへアクセスできず、画面に表示された確認コードを管理者が承認すると利用可能になります。

Supabase AuthにはIdentifierが`custom:line-oauth`のCustom OAuth2 Provider（Manual configuration）が必要です。LINE Channel secretはSupabase Dashboardだけに保存し、この公開リポジトリやGitHub Actions Variablesへ登録しないでください。DB migrationとLINE Developers Consoleを含む設定手順は、非公開データプラットフォーム側の`docs/supabase_setup.md`を参照してください。

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
