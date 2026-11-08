# 星の旅の 3D 素材（素材の側、Claude Code）

設計書 rev 127（`.work/design/product-design-2026-11-08b.md`）。スキルは `wwt-asset-director`・`wwt-asset-contract`・`wwt-blender-modeling`・`wwt-asset-review-loop`。ブランチ `codex/city-assets`（作業ブランチ `codex/creator-editor-spike` の `3699008` から）。素材の元とスクリプトは wwt-private-assets の `city-assets/`。

**判定は「取り込んでよい（残りあり）」。** P1・P2・P3 の全 43 行がそろった（つむは final、ほかは draft）。

## 決めたこと

| こと                  | 決めた内容                                                                                                                                                                                                | 理由                                                                                                                                                                     |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 公開の置き場所        | `src/playground/city-assets/`（`manifest.json`・`humanoid.json`・`colorways.json`・`<kind>/<id>.glb`）                                                                                                    | Playground の公開ビルドの元は `src/playground/` にあり、出力の検査はビルドが写した模型だけを許す。世界の側は行ごとに `content/asset-<sha256>.glb` へ写す（つむと同じ形） |
| つむ                  | GLB は公開のリポジトリに置かない。Codex の変換のまま。素材の側は `city-assets/tools/build_tsumu.py` で同じ手順を呼び、承認済みの SHA-256 と照らす                                                         | 変換は Codex が済ませていた。ノート PC で作り直してもバイト一致した                                                                                                      |
| 骨の対応表            | 鍵は VRM の人型の名前、値は GLB の骨の名前。住人は素体の名前（`UpperArm.L`）、つむは `Upper_arm.L`。骨の名前と階層は変えない                                                                              | `retarget_vrma.py --target-map` にそのまま渡せる。頭身を変えたあとも 49 本が対応し、歩きで崩れない                                                                       |
| 動作                  | 住人の GLB には入れない（約束どおり）。つむだけ焼き込み済み                                                                                                                                               | 世界の今の読み込みは、つむの焼き込みを前提にしている                                                                                                                     |
| 頭身（2 回目）        | つむ（世界で 1.006m、腰が背丈の 0.50）に合わせ、足 0.71 倍・頭 1.2 倍・腕 0.86 倍・手足を太く。骨の関節と皮膚を同じ写像で動かす。体の背丈は 0.92〜0.97m、帽子込みで 0.96〜1.08m（灯り番の高帽子は 1.25m） | 翔太の決定「つむと同じか少し低め、頭を大きく足を短く」。骨の構造を保つので UAL の動作がそのまま当たる                                                                    |
| 陰（2 回目）          | GLB に法線を入れる：顔は 1 つの向き（平らな 1 色の肌）、髪と丸い帽子は頭の楕円体の法線（陰の線が 1 本）、体は近くの法線をならす、硬い物は面の法線のまま。髪の下の頭は内側へ引っ込める                     | 顔のまだらと、髪の切れ目から肌がのぞいて目に見えたのを止める。世界の材質を変えずに直せる                                                                                 |
| 輪郭線（2 回目）      | 並べるページは世界と同じ式（`cityInk` 画素 × lineScale、近 2.1・中 1.8・遠 1.25）。住人の lineScale は 1.0 で描く                                                                                         | 世界は住人を 0.72 で描いており、中くらいの距離で線がほとんど見えない。**世界の側に 0.72 → 1.0 を提案**（約束ではなく描き方の値なので、決めるのは世界の側）               |
| 役割の印（2 回目）    | 港の作業員は全員きのこ形のヘルメット、店員は三角巾に大きな結び目、手の小物は 1.1〜1.15 倍                                                                                                                 | はちまきとベレーが影絵で似ていた。役割ごとに 1 つの形にそろえた                                                                                                          |
| 港の目印（2 回目）    | 灯台 `harbor-lighthouse`（4.6m、灯りの部屋は `slot_light`）を足した。クレーンの塔は金属色に、斜めの控えを足した                                                                                           | 赤い塔に見えていたのはクレーン。灯台は別に作って港の目印にした                                                                                                           |
| 材質の名前を1つ足した | `slot_plant`（木の葉・植え込み・花の茎）                                                                                                                                                                  | 葉を布や差し色と同じ段で塗らないため。約束の表に足すだけ                                                                                                                 |
| 住人の色              | `colorways.json`（服の組 8・肌 4・髪 5）。肌と髪の色は toon-look の表への提案                                                                                                                             | 世界が色を当てる約束のまま、同じ形を別の人に見せる                                                                                                                       |
| 大きさ（P3）          | 絵本の箱庭：建物は 2.6〜4.4m（つむの 3〜4 倍）、戸 1.2m、手の小物と街灯は少し大きめ。基準はつむの GLB の背丈                                                                                              | 2026-11-08 の決定                                                                                                                                                        |
| 文字                  | 看板・のれん・ポストの字はすべて長さの違う棒（架空）                                                                                                                                                      | 実在の文字・ロゴを入れない                                                                                                                                               |
| 検査                  | `node scripts/city-assets/check.mjs`（unit：`tests/city-assets-check.spec.ts` 7 件）                                                                                                                      | GLB の構造・三角形・材質・変形・原点・高さ・骨・付ける所・出どころ・禁止の名前を読む                                                                                     |
| 並べるページ          | `scripts/city-assets/lineup/`、`node scripts/city-assets/capture-lineup.mjs <out> [--line-scale=0.72]`。見本は far・mid・near・hero（つむと並ぶ）・sil・night・props・culture                             | 開発用。製品と公開のビルドには入らない                                                                                                                                   |
| 素体の作者名          | 「シロタカブ（おなかにやさしい）※要確認」。翔太が BOOTH で確かめるまで両方出す                                                                                                                            | 2026-11-08 の決定                                                                                                                                                        |

## 素材の一覧

| id                                                                 | 種類     | 状態           | 三角形                  | 高さ m               | 役割               | 文化                          |
| ------------------------------------------------------------------ | -------- | -------------- | ----------------------- | -------------------- | ------------------ | ----------------------------- |
| hero-tsumu                                                         | hero     | final（Codex） | 1766                    | 1.006                | hero               |                               |
| resident-dockworker-a / -b                                         | resident | draft          | 2536 / 2504             | 1.008 / 1.029        | dockworker         |                               |
| resident-shopkeeper-a / -b                                         | resident | draft          | 2736 / 2628             | 0.957 / 0.988        | shopkeeper         |                               |
| resident-walker-a / -b / -c                                        | resident | draft          | 2620 / 2608 / 2452      | 1.02 / 0.975 / 0.967 | walker, listener   |                               |
| resident-lamplighter-a                                             | resident | draft          | 2624                    | 1.247                | lamplighter        |                               |
| resident-musician-a                                                | resident | draft          | 2560                    | 1.035                | musician, listener | music                         |
| resident-stargazer-a                                               | resident | draft          | 2544                    | 1.084                | stargazer          | sky                           |
| resident-gardener-a                                                | resident | draft          | 2564                    | 1.005                | gardener           | nature                        |
| resident-vendor-a                                                  | resident | draft          | 2388                    | 0.977                | vendor             | food                          |
| resident-fisher-a                                                  | resident | draft          | 2608                    | 1.024                | fisher             | sea                           |
| prop-crate・lantern・broom・paper-bag・lighter-pole                | prop     | draft          | 80・220・120・76・96    |                      | P1 の役割          |                               |
| prop-instrument・telescope・watering-can・stall-goods・fishing-rod | prop     | draft          | 212・112・160・476・116 |                      | 文化の役割         | 各文化                        |
| ship-cargo-a・sail-a                                               | ship     | draft          | 712・192                | 1.51・2.09           |                    |                               |
| harbor-pier・bollard・cargo-pile・crane・lighthouse                | harbor   | draft          | 696・212・424・352・548 | 0.97〜4.57           | dockworker         |                               |
| street-lamp・bench・tree・hedge・sign・bicycle・postbox            | street   | draft          | 104〜276                | 0.56〜2.28           |                    |                               |
| culture-stage・observatory・garden・stall・fisher-hut              | culture  | draft          | 760・764・784・710・792 | 2.64〜4.44           | 文化の役割         | music・sky・nature・food・sea |

住人の高さは帽子込み（上限 3,000 に対して 2,388〜2,736）。物はすべて上限の半分以下。

## 採点（wwt-asset-review-loop、0〜3）

| 項目                | P1 の after | 2 回目（P3 込み） | 根拠                                                                                                                                               |
| ------------------- | ----------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. 遠くで読める     | 2           | 3                 | 影絵で港（きのこ形）・店員（結び目）・散歩（つば広・ベレーと鞄・スカート）・灯り番（高帽子とコート）が分かれる。文化の人は帽子と手の小物で分かれる |
| 2. 街に馴染む       | 2           | 3                 | つむと同じ頭身・同じ紺の線・色の表。hero の絵で同じ作品の人に見える                                                                                |
| 3. 数の豊かさ       | 2           | 3                 | 形 13 × 服の組 8 × 肌 4 × 髪 5。24 人の広場で同じ人が並ばない                                                                                      |
| 4. 近くで気持ちいい | 2           | 3                 | 顔は 1 色、髪の陰は 1 本、体のまだらなし、髪の切れ目からのぞく肌なし                                                                               |
| 5. 小物の説得力     | 2           | 2                 | 下げる物は自然。両手で持つ箱と盆は、並べるページの仮の姿勢で少し浮く                                                                               |
| 6. 夜               | 2           | 3                 | 灯台・街灯・窓・屋台の提灯・舞台の足元灯・ランタンが光る。灯り番のボタンだけが光る                                                                 |
| 7. 軽さ             | 3           | 3                 | 住人 2,388〜2,736、建物 710〜792（上限 6,000）                                                                                                     |
| 8. 約束             | 3           | 3                 | `check.mjs` 0 件、unit 7 件                                                                                                                        |

絵：P1 の [before](screenshots/city-assets/p1-before/)・[after](screenshots/city-assets/p1-after/)、2 回目の [before](screenshots/city-assets/r2-before/)（世界の今の線 0.72）・[after](screenshots/city-assets/r2-after/)、[P3 まで入れた絵](screenshots/city-assets/p3/)（far・mid・near・hero・sil・night・props・culture）。

## 残り

- 両手で持つ箱と盆は、並べるページの仮の姿勢。世界が動作を当てたときの手の位置で見直す
- 文化の人の帽子（バケット・防水帽）は、手の小物がないと港のヘルメットに少し似る。文化の星では小物を必ず持たせると読める
- 舞台の屋根は帯を並べた形で、丸い貝殻の形にはまだ見えにくい
- 住人の歩きは灯り番・散歩の人で確かめた（UAL の待機・歩行）。全員の焼き込みは世界の側で
- 体型を変えたあと、腕が胴に当たって、焼き込みの腕の開きが上限（45°）になる住人がいる（太い服）。見た目は崩れていない
- 夜の住人の縁の光は世界の側の光で決まる。並べるページの夜は仮
