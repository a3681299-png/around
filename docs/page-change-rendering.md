# ページ変更時の描画処理（依頼F）

基準コミットは `28d594a`。作品形式・Chrome権限・通常版distは変更しない。

## 固定した計測条件

- DOM変更：ローカルYouTube fixture、1920×1080、保存済みのカード装飾ルール1本、既定のfeatures。
  プレイヤー内の時刻テキストを60回変更し、各回2RAF待つ。CDP `Performance.ScriptDuration` の差を記録する。
  旧版と新版を同じChromeで交互に5組実行する。待機・描画・GPUの時間は含めない。
- World：Eのスクロール32本×64キーの計測をそのまま再利用する。
  検索を使う距離・角度についても32本×64キー、anchor/layer各座標系の計測を追加する。
  いずれも閾値でテストを落とさず、前後を別Nodeプロセスで交互に5組実行する。

変更前の予備計測では、60回のテキスト変更に対してテーマ変数の計算・作品のコンパイル・features.refreshが
それぞれ約120回発生した。スクリプト時間は1組の同一コード比較で57.9ms／67.8ms。
これは計測系の動作確認であり、変更の効果を示す比較値ではない。

## 分離する処理

設定・作品の変更では、従来の全体反映を維持する。ページ変更では既存styleの再接続、表面の更新、
素材の配置基準と選択状態の更新を行う。テーマ変数の再計算・作品のコンパイル・素材一覧の再設定は行わない。
文字だけの変更ではfeatures.refreshも呼ばない。構造の変更・遷移・mode・全画面では、
既存の機能が新しいDOMへ追従するためのrefreshを残す。

スクロール入力はイベント内でレイアウト値を読まず、次のRAFで採取する。
採取後にさらに次のRAFを予約する経路がないか、固定入力のテストとブラウザーのフレーム単位のテストで確認する。

## 再現コマンド

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH=(Resolve-Path '../../.work/browsers').Path
node scripts/benchmark-page-changes.mjs 28d594a 5
node scripts/compare-editor-benchmark.mjs 28d594a 5 world
# world-lookups は計測追加コミットを基準にする（本体の変更前）。
node scripts/compare-editor-benchmark.mjs <計測追加コミット> 5 world-lookups
```

最終計測と回帰テストの結果は、実装後に追記する。
