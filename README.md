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
- `analytics.daily_product_weighted_prices`
- `analytics.daily_product_shipment_balances`
- `analytics.daily_product_market_prices`

`admin`または`inputter`には「データ登録」が表示されます。対象年を選択して売上状況を貼り付けると、合計と商品対応を確認した後、`public.import_sales_blocks` RPCでトランザクション登録します。ブラウザからSecret Keyや`service_role`は使用しません。

認証画面はLINEログインを標準とし、既存のメール・パスワード認証は管理者用の予備手段として残しています。初回のLINEログイン直後はデータへアクセスできず、画面に表示された確認コードを管理者が承認すると利用可能になります。

Supabase AuthにはIdentifierが`custom:line-oauth`のCustom OAuth2 Provider（Manual configuration）が必要です。LINE Channel secretはSupabase Dashboardだけに保存し、この公開リポジトリやGitHub Actions Variablesへ登録しないでください。DB migrationとLINE Developers Consoleを含む設定手順は、非公開データプラットフォーム側の`docs/supabase_setup.md`を参照してください。

## 沖縄協同青果の市況価格

品目別販売状況の「平均kg単価の推移」では、自社平均kg単価を実線、沖縄協同青果の市況中値を破線で表示します。

- 自社平均kg単価は、FIFOで対応付けた純売上を販売重量で割った値です。
- 市況中値は、沖縄協同青果の市況PDFに記載された1kgあたりの税込価格です。
- 市況データの`avg_price`は元帳票の「中値」を表し、算術平均ではありません。
- 市況を表示するすべての商品で、参照している市況品目名をグラフ下のキャプションに明示します。
- 市況がない日を補間値で埋めず、自社と市況の実データが存在する日付の和集合を描画します。

市況データはブラウザから別のSupabaseへ直接取得しません。非公開データプラットフォームが`agri_db`から同期し、販売管理側Supabaseの`analytics.daily_product_market_prices`を通して認証済みユーザーに公開します。品目対応も同じデータプラットフォームで管理するため、この公開リポジトリに変換辞書やsecret/service-role keyを置きません。

DBマイグレーションと初回市況同期を完了してから、このフロントエンドをデプロイしてください。未適用のまま公開すると、商品別画面が`analytics.daily_product_market_prices`を取得できません。詳細な適用順序、28品目の対応一覧、追加方法、検証、障害対応は、非公開データプラットフォームの`docs/market_price_integration.md`を参照してください。

## 出荷確認（最小確認画面）

`admin`または`inputter`でログインすると、ヘッダーの「出荷確認」から `#/shipments/review` を開けます。この画面は手書き出荷画像と転記CSVを同じ画面で照合し、各行を修正して「承認」「保留」「出荷なし」に分類するためのローカル確認ツールです。

- 月別の未確認CSVと対応する原画像をブラウザから選択する
- 行番号と画像を並べて確認し、必要な値を修正する
- 承認後に訂正した場合は、訂正内容でもう一度承認する
- 未確認または保留が残る間は、確認済みCSVを出力できない
- 「出荷なし」の行は確認済みCSVから除外される
- 作業途中の値と進捗はブラウザのローカルストレージへ保存される

選択した画像とCSVはSupabaseや外部APIへ送信されず、この画面から本番DBへの書き込みも行いません。確認済みCSVの検証、正規化、SQL生成、Supabase投入は、非公開データプラットフォーム側の月次運用として実施します。

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
