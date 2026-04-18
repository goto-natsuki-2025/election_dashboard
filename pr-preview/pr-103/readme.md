# 選挙集図盤の起動手順

## リモート

次の URL で公開版を閲覧できます。

https://goto-natsuki-2025.github.io/election_dashboard/

## ローカル表示

1. プロジェクト直下に移動します  
   `cd .\election_dashboard\`
2. 静的サーバーを起動します  
   `python -m http.server 8000`
3. ブラウザで下記にアクセスします  
   `http://localhost:8000/index.html`

## データの再生成

選挙スクレイピング後に `election_dashboard/data/*.db` を更新した場合は、以下のコマンドで静的データをまとめて再生成できます。

- `python -m election_dashboard.data_pipeline.run_pipeline`  
  順番に次のスクリプトを実行します。
  1. `regenerate_static_data.py`（`data/election_summary.csv`, `data/candidate_details.csv.gz` を出力）  
  2. `generate_compensation_data.py`（各種報酬集計CSVを出力）  
  3. `build_dashboard_data.py`（`*.json.gz` を更新）
  実行後は上記の中間CSV／圧縮ファイルを自動で削除します。

個別に確認したい場合は、従来どおり各スクリプトを単独で実行しても構いません。
（例）`python -m election_dashboard.data_pipeline.regenerate_static_data`
