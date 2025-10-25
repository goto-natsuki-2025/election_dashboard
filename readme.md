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

- 選挙データや報酬データを更新した場合は、次のスクリプトで集計ファイルを再生成してください。  
  `python generate_compensation_data.py`  
  実行後に以下のファイルが更新されます。
  - `data/party_compensation_2020.csv`（summary/yearly/municipality をまとめた一覧）
