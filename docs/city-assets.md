# 星の旅の 3D 素材（素材の側、Claude Code）

設計書 rev 127（`.work/design/product-design-2026-11-08b.md`）。スキルは `wwt-asset-director`・`wwt-asset-contract`・`wwt-blender-modeling`・`wwt-asset-review-loop`。ブランチ `codex/city-assets`（作業ブランチ `codex/creator-editor-spike` の `3699008` から）。素材の元とスクリプトは wwt-private-assets の `city-assets/`。

**判定は「取り込んでよい（残りあり）」。** P1 は全部 draft、P2 の一部（住人 8 種、帆の小舟、クレーン、標識）も draft。

## 決めたこと

| こと                  | 決めた内容                                                                                                                                                                                          | 理由                                                                                                                                                                             |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 公開の置き場所        | `src/playground/city-assets/`（`manifest.json`・`humanoid.json`・`colorways.json`・`<kind>/<id>.glb`）                                                                                              | Playground の公開ビルドの元は `src/playground/` にあり、出力の検査はビルドが写した模型だけを許す。世界の側は行ごとに `content/asset-<sha256>.glb` へ写す（つむと同じ形）         |
| つむ                  | GLB は公開のリポジトリに置かない。Codex の変換（`tsumu_glb.py` と `retarget_vrma.py --glb-out`）のまま。素材の側は `city-assets/tools/build_tsumu.py` で同じ手順を呼び、承認済みの SHA-256 と照らす | 変換は Codex が済ませていた（翔太の確認どおり）。ノート PC で作り直してもバイト一致した                                                                                          |
| 骨の対応表            | 鍵は VRM の人型の名前、値は GLB の骨の名前。住人は素体の名前（`UpperArm.L`）、つむは `Upper_arm.L`。骨の名前は付け替えない                                                                          | `scripts/characters/rigs/*.json` と同じ形にして、`retarget_vrma.py --target-map` にそのまま渡せる。住人に UAL の待機・歩行・`Interact` を焼いて、49 本の対応・足の接地を確かめた |
| 動作                  | 住人の GLB には入れない（約束どおり）。つむだけ焼き込み済み（今の世界の作りの例外）                                                                                                                 | 世界の今の住人の読み込みは、つむの焼き込みを前提にしている                                                                                                                       |
| 付ける所              | 住人の `attach_hand_*` は +Y（glTF）が手から肩の向き                                                                                                                                                | 腕を下ろした待機で、持った小物がまっすぐ下がる                                                                                                                                   |
| 材質の名前を1つ足した | `slot_plant`（木の葉・植え込み）                                                                                                                                                                    | 葉を布や差し色と同じ色の段で塗らないため。約束の表に足すだけ                                                                                                                     |
| 住人の色              | `colorways.json`（服の組 8・肌 4・髪 5）。肌と髪の色は toon-look の表になかったので提案として足した                                                                                                 | 世界が色を当てる約束のまま、同じ形を別の人に見せる                                                                                                                               |
| 検査                  | `node scripts/city-assets/check.mjs`（unit：`tests/city-assets-check.spec.ts` 7 件）                                                                                                                | Khronos の gltf-validator は入れず、GLB の構造・三角形・材質・変形・原点・高さ・骨・付ける所・出どころ・禁止の名前を読む                                                         |
| 並べるページ          | `scripts/city-assets/lineup/`、撮るのは `node scripts/city-assets/capture-lineup.mjs <out>`（画面の外の表示ありの Chromium）                                                                        | 開発用。製品と公開のビルドには入らない                                                                                                                                           |

## 素材の一覧（状態と三角形）

| id                     | 種類     | ファイル                                     | 状態           | 三角形 | 高さ m | 役割        |
| ---------------------- | -------- | -------------------------------------------- | -------------- | ------ | ------ | ----------- |
| hero-tsumu             | hero     | wwt-private-assets/tsumu/work/tsumu-city.glb | final（Codex） | 1766   | 1.006  | hero        |
| resident-dockworker-a  | resident | residents/dockworker-a.glb                   | draft          | 2448   | 1.134  | dockworker  |
| resident-dockworker-b  | resident | residents/dockworker-b.glb                   | draft          | 2236   | 1.138  | dockworker  |
| resident-lamplighter-a | resident | residents/lamplighter-a.glb                  | draft          | 2536   | 1.398  | lamplighter |
| resident-shopkeeper-a  | resident | residents/shopkeeper-a.glb                   | draft          | 2500   | 1.105  | shopkeeper  |
| resident-shopkeeper-b  | resident | residents/shopkeeper-b.glb                   | draft          | 2268   | 1.133  | shopkeeper  |
| resident-walker-a      | resident | residents/walker-a.glb                       | draft          | 2516   | 1.162  | walker      |
| resident-walker-b      | resident | residents/walker-b.glb                       | draft          | 2524   | 1.113  | walker      |
| resident-walker-c      | resident | residents/walker-c.glb                       | draft          | 2352   | 1.113  | walker      |
| prop-crate             | prop     | props/crate.glb                              | draft          | 80     | 0.195  | dockworker  |
| prop-lantern           | prop     | props/lantern.glb                            | draft          | 220    | 0.325  | lamplighter |
| prop-broom             | prop     | props/broom.glb                              | draft          | 120    | 1.01   | shopkeeper  |
| prop-paper-bag         | prop     | props/paper-bag.glb                          | draft          | 76     | 0.295  | shopkeeper  |
| prop-lighter-pole      | prop     | props/lighter-pole.glb                       | draft          | 96     | 1.42   | lamplighter |
| ship-cargo-a           | ship     | ships/cargo-a.glb                            | draft          | 712    | 1.51   | dockworker  |
| ship-sail-a            | ship     | ships/sail-a.glb                             | draft          | 192    | 2.09   | fisher      |
| harbor-pier            | harbor   | harbor/pier.glb                              | draft          | 696    | 0.97   | dockworker  |
| harbor-bollard         | harbor   | harbor/bollard.glb                           | draft          | 212    | 0.325  | dockworker  |
| harbor-cargo-pile      | harbor   | harbor/cargo-pile.glb                        | draft          | 424    | 0.84   | dockworker  |
| harbor-crane           | harbor   | harbor/crane.glb                             | draft          | 328    | 2.94   | dockworker  |
| street-lamp            | street   | street/lamp.glb                              | draft          | 212    | 2.17   | lamplighter |
| street-bench           | street   | street/bench.glb                             | draft          | 200    | 0.751  | walker      |
| street-tree            | street   | street/tree.glb                              | draft          | 140    | 2.279  | —           |
| street-hedge           | street   | street/hedge.glb                             | draft          | 104    | 0.56   | —           |
| street-sign            | street   | street/sign.glb                              | draft          | 152    | 1.3    | —           |

住人の高さは帽子込み。体は 1.05〜1.12m（世界はつむを 0.72 倍の約 1.0m で描く。住人は倍率なしで置く）。まだの行（placeholder）：P2 の自転車・ポスト、P3 の文化の住人 5・文化の小物 5・文化の建物 5。

## 採点（wwt-asset-review-loop、0〜3）

before は最初に並べた絵（素体の半分の鏡で帽子が二重、顔のくぼみ、輪郭線が内側）。after は今の絵。

| 項目                | before | after | 根拠（after）                                                                                                                               |
| ------------------- | ------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. 遠くで読める     | 1      | 2     | 影絵で灯り番（高い帽子とコート）・散歩（つば広）・港（きのこ形のヘルメット）・店員（A 字の前掛け）が分かる。ベレーとはちまきの2人はまだ似る |
| 2. 街に馴染む       | 1      | 2     | 色は色の表、紺の輪郭、3 段の陰。住人がつむより少し背が高い                                                                                  |
| 3. 数の豊かさ       | 2      | 2     | 形 8 × 服の組 8 × 肌 4 × 髪 5。24 人の広場で同じ人が並ばない。顔がない分、髪型の差が弱い                                                    |
| 4. 近くで気持ちいい | 0      | 2     | 顔は平らな卵形、袖・すそは太い。体の陰がまだらに出る所が残る                                                                                |
| 5. 小物の説得力     | 1      | 2     | 箱は両手の間、ランタンとほうきは手から下がる。箱は少し浮いて見える                                                                          |
| 6. 夜               | 1      | 2     | 窓・灯り・ボタン・ランタンが光る。住人の縁の光は弱い                                                                                        |
| 7. 軽さ             | 1      | 3     | 住人 2,236〜2,536（上限 3,000）、物はすべて上限の半分以下                                                                                   |
| 8. 約束             | —      | 3     | `check.mjs` 0 件、unit 7 件                                                                                                                 |

絵：[before](screenshots/city-assets/p1-before/)、[after](screenshots/city-assets/p1-after/)（far・mid・near・sil・night・props）。

## 残り

- 前髪の下の縁がぎざぎざで、目のように見える住人がいる（球を面で切っているため。平面で切り直す）
- 体の陰のまだら（減らした面と滑らかな法線の組み合わせ）
- ベレーの散歩する人とはちまきの港の作業員が、影絵で似る
- 箱を持つ姿は並べるページの仮の姿勢。世界が動作を当てたときの手の位置で見直す
- 住人の夜の縁の光は世界の側の光で決まる。並べるページの夜は仮
- 素体の作者の表記（readme.txt は「シロタカブ」、依頼文は「おなかにやさしい」）を翔太が確かめる
