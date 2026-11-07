# 履歴から取得したDesignDocument

`v1.json`〜`v6.json` は各導入コミットの**実際のテストの生成関数**から取得した固定データです。現在の形式からフィールドを削って過去の形式を推測したデータではありません。`provenance.json` にコミット、元ファイル、生成式を記載しています。

`node scripts/capture-design-fixtures.mjs` で再取得できます。この開発用スクリプトは固定コミットの信頼済みリポジトリコードを読み、当時のパーサーで受理されることを確認します。作品からJavaScriptを読む仕組みではなく、拡張機能にも同梱しません。

v1: カードの色・枠・角丸。v2: ロックのない画像。v3: ロック済み画像。v4: GIFの再生設定。v5: プレイヤー基準の回転画像とpointer/videoマスク。v6: 3画像を参照するグループ。

利用者が実際に保存した過去のJSONはリポジトリにありません。そのデータでの互換性検証は未実施です。移行は既存の純粋な `parseDesign` を使い、読込時にはストレージを書き換えません。

`v7.json` はSignal Timeline導入時に追加した合成fixtureです。v6 fixtureの先頭をWebMのauto再生に置き換え、導入前コミット9c9cd88のパーサーでv7として受理されることを確認しています。ユーザーの保存データや過去のテスト生成物から抽出したものではありません。

依頼Eでは`history-v7.json`〜`history-v11.json`を追加した。
`node scripts/capture-design-chain-fixtures.mjs`は各導入コミットの指定テストを実行し、
テストが明示的に`parseDesign`へ渡した最初の入力を、当時のパーサーで受理された後に取得する。
元のテスト名・コミットは`chain-provenance.json`に記録した。既存の合成fixtureは置き換えていない。

`chain-expected.json`は移行チェーンへの変更前、`d1a552e`のパーサーで読み込んだ全14件の結果。
移行後の結果との完全一致をテストする固定の比較対象であり、テスト実行時には再生成しない。
v1〜v11すべてで履歴由来の入力を確保できたが、利用者が実際に保存した過去のJSONによる確認は引き続き未実施。

UI1（v13）では `history-v12.json` を追加した。v12で `renderMode` を導入した `tests/design-migrations.spec.ts` の
「v12 renderMode keeps normal by omission…」が、最初に `parseDesign` へ渡して受理された入力（雰囲気レイヤー2枚とグループ）である。
その期待値は変更前の `29b8d5b` のパーサーで取得し、`chain-expected.json` へ加えた。

`css-expected.json` は、変更前の `29b8d5b` の `compileDesign` で全fixtureを組み立てたCSS。
v13の着せ替えを追加したレンダラーでも、既存作品の見た目（CSS）がバイト単位で変わらないことを確かめる固定の比較対象。

R3-1b（v14）では `history-v13.json` を追加した。v13を導入した `3e18edc` の `tests/vrm-data.spec.ts` の
「VRM1 preserves humanoid, expression, spring and MToon capabilities with v11 roundtrip」が、最初に `parseDesign` へ渡して受理された入力（VRMの3Dレイヤー1枚）である。
取得には `scripts/capture-design-chain-fixtures.mjs` を1件だけに絞った使い捨ての写しを使った（そのテストが `three` を読むため、`three`・`@pixiv` を外部として扱う1行を足した。元のスクリプトは変えていない）。
期待値（`chain-expected.json`・`css-expected.json` の `history-v13.json`）は、変更前の `133f88b` のパーサーと `compileDesign` で取った。
v14への版上げで、`chain-expected.json` の全件の `schemaVersion` を14にした（ほかの値は変えていない）。

塊3（v15）では `history-v14.json` を追加した。v14を導入した `8003738` の `tests/character-data.spec.ts` の
「v14 character roundtrips; clip indices then address its motions」が、最初に `parseDesign` へ渡して受理された入力（キャラ付きの VRM の3Dレイヤー1枚。層の名前が "Trusie" だが、テストの中の名前の文字列だけで、モデルや素材は含まない）である。
取得は `scripts/capture-design-chain-fixtures.mjs` を1件に絞った使い捨ての写し（出力先だけ `.work/capture` に変えた）で行った。元のスクリプトは変えていない。
期待値（`chain-expected.json`・`css-expected.json` の `history-v14.json`）は、変更前の `3a41aa2` のパーサーと `compileDesign` で取った。
v15への版上げで、`chain-expected.json` の全件の `schemaVersion` を15にした（ほかの値は変えていない）。

ミルドの動きの続き（v16）では `history-v15.json` を追加した。v15を導入した `83601bb` の `tests/character-v15.spec.ts` の
「v15 roundtrips personality and the switches; absent keys keep v14 behaviour」が、最初に `parseDesign` へ渡して受理された入力（キャラ付きの VRM の3Dレイヤー1枚。層の名前 "Trusie" はテストの中の文字列だけで、モデルや素材は含まない）である。
取得は `scripts/capture-design-chain-fixtures.mjs` を1件に絞った使い捨ての写し（出力先を `.work/capture` に、`three`・`@pixiv` を外部に）で行った。元のスクリプトは変えていない。
期待値（`chain-expected.json`・`css-expected.json` の `history-v15.json`）は、変更前の `e0b14ca` のパーサーと `compileDesign` で取った。
v16への版上げで、`chain-expected.json` の全件の `schemaVersion` を16にした（ほかの値は変えていない）。

奥行きの土台（v17）では `history-v16.json` を追加した。v16を導入した `e6e958d` の `tests/character-data.spec.ts` の
「a motion hips height roundtrips at its limit and stays absent when not given」が、最初に `parseDesign` へ渡して受理された入力（キャラ付きの VRM の3Dレイヤー1枚。名前の文字列だけで、モデルや素材は含まない）である。
取得は `scripts/capture-design-chain-fixtures.mjs` を1件に絞った使い捨ての写し（出力先だけ `.work/capture` に変えた）で行った。元のスクリプトは変えていない。
期待値（`chain-expected.json`・`css-expected.json` の `history-v16.json`）は、変更前の `43ec318` のパーサーと `compileDesign` で取った。
v17への版上げで、`chain-expected.json` の全件の `schemaVersion` を17にした（ほかの値は変えていない）。
