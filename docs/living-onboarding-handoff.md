# Living Onboarding 引き継ぎ（2026-11-12、ノート PC）

現行の部屋の美術は **`codex/living-room-reference`**（`codex/living-room-realism` の `1fa65a4` から）。翔太の新しい参考画像に合わせ、Blender MCP で夜の制作部屋を作成し、Web の表示を確認した。状態と再現手順は [living-room-night-reference.md](living-room-night-reference.md)。以前の出窓と植物の部屋は [living-room-realism.md](living-room-realism.md) と末尾の「14」に記録する。PC の運用は [dual-pc-workflow.md](dual-pc-workflow.md)、初版の美術は [living-room-art.md](living-room-art.md)。

## 1. 作品の目的

WWT をもとにした、コンテスト用の**独立した Web 作品**。3D の部屋で生活するキャラクターが、Web 上に現れた UI を認識し、近づき、触れ、ユーザーの操作に感情的な反応を返す。

最初の到達目標は、次の一連の動きが通ること。

> 部屋で生活 → UI が出現 → 気づいて接近 → クリックで喜ぶ → UI を閉じると生活に戻る

- **今回の対象外**：Chrome 拡張、YouTube 対応、汎用エディター。WWT 本体（拡張・`dist`・Playground）は壊さない
- 過剰設計と新しい汎用基盤は避ける。美術の品質が機能の数より先（Parallax City の反省：簡素な物の大量の組み合わせでは目標の品質に届かなかった）

## 2. 前版の部屋（2026-11-11）

6.0 × 5.4m の本体に奥行き 0.8m の三面の出窓。木と生成り、くすんだ緑を中心に、制作机と読書・睡眠の場所、植物、日用品を作り込んだ。奥と左が高い壁、右が腰の高さの切断面。詳しい美術・残りは [living-room-realism.md](living-room-realism.md)。

| 物                 | 場所                                                | 備考                                                                                     |
| ------------------ | --------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Blender 原本       | `art/living-room/living-room.blend`（LFS）          | モディファイアは残してある。編集はこちら                                                 |
| Web 用の部屋       | `art/living-room/web/room.glb`（LFS、14.54MB）      | 色と光を焼いた GLB。家具・小物・画面・目印・カメラ `camera_main` を含む                  |
| ライトマップ・設定 | `art/living-room/web/lightmap.png`、`room.json`     | 通常のファイル（LFS ではない）                                                           |
| 検証画像           | `art/living-room/renders/`                          | 現行は `realism-room`・`realism-desk`・`realism-bed`・`realism-portrait`。ほかは旧版     |
| 作り直すスクリプト | `scripts/living-room/`                              | `run_all.py` で一括。部品は番号順（`lib.py`、`10_shell.py`〜`70_meta.py`、`80_bake.py`） |
| 表示ページ         | `src/living-room/`、`scripts/build-living-room.mjs` | three.js。`dist-living-room/` へ出力                                                     |

キャラのための用意（`70_meta.py`）：

- `navmesh_floor`：家具の足元を除いた歩ける床（長方形 33 枚、66 三角形）
- 座る：`marker_sit_chair`・`_bed`・`_beanbag`・`_cushion`。隠れる：`marker_hide_beanbag`・`_chair`・`_dresser`。立つ：`marker_stand_window`・`_shelf`・`_center`・`_front`・`_guitar`（合計 12 か所）
- 目印の向きは glTF の +Z（Blender では物の -Y）。`readLayout`（`src/renderers/three/room-layout.ts`）がそのまま読む
- 画面は `dyn_monitor_screen`・`dyn_monitor2_screen` の別メッシュ。あとで本物の UI を映せる
- 12 か所すべてが歩ける床の上にあり、中央から歩いて届くことを、ページのテスト用の入口 `__wwLivingRoom.reach()` で確かめた。席から次の席へ向かう経路の残りは [living-room-realism.md](living-room-realism.md) に記録した

## 3. キャラクターの設計

**2026-11-11 追記：身体制御の基礎を実装した（下の「11」と [living-body.md](living-body.md)）。この節の「提案」は実装前の案で、実際は `room-life.ts` を変えず `src/characters/` に足した。** 以下は実装前の記録。部屋の中のキャラの暮らし（歩く・座る・隠れる）の仕組みは既存の物がそのまま使える。下の「提案」は、実装前の案で、翔太の確認を取っていない。

### 既存の部品（再利用する）

| 部品                                                                | 中身                                                                                                                                                          |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/world/room-life.ts`                                            | 純粋・決定的な状態機械。活動は `idle`・`walk`・`sitDown`・`sit`・`standUp`・`hide`・`touch`・`leave`・`front`・`arrive`。床の経路探索、座る前に立つ流れがある |
| `src/renderers/three/room-resident.ts`                              | VRM に姿勢を当てる描画。歩幅と速さを合わせて足が滑らない。座りの腰合わせ、影、クリップの代わり（`pick`）                                                      |
| `src/renderers/three/vrma-clip.ts`、`src/assets/verified-source.ts` | 検証済みの VRM と .vrma だけを読む（安全の線）                                                                                                                |
| `src/renderers/three/room-layout.ts`                                | 部屋の目印と床の読み取り（`room.ts` から移した。挙動は同じ）                                                                                                  |

### 提案（未実装）

- `room-life.ts` の入力に、省略できる「UI の場所」と「クリックされた」を足し、活動を `notice`（気づく）と `joy`（喜ぶ）の2つ足す。入力がなければ今の挙動と同じ。接近は既存の `walk`、触れるは既存の `touch`（向きを UI の方へ）
- UI は、部屋の中の1点を画面に投影して置く DOM のカード。クリックは本物の DOM に届くので、操作の守り（G1）は要らない
- `room-resident.ts` にクリップの切り替えの 0.2 秒ほどのクロスフェード、`joy` と `notice` のクリップ名を足す
- 先にテスト（TDD）：UI 出現 → 気づく →（座っていれば立つ）→ 歩く → 触れる、クリック → 喜ぶ、UI を閉じる → 生活に戻る、を `room-life` の unit テストで書いてから実装する

### 動作の不足

| 場面   | 使える物                                                  | 不足                                                                           |
| ------ | --------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 生活   | `Idle_Loop`・`Walk_Loop`・`Sitting_*`・`Crouch_Idle_Loop` | なし                                                                           |
| 気づく | 専用なし                                                  | 首と体を UI へ向ける計算の動きで補う。小さな驚きに `Hit_Head` も試せる         |
| 触れる | `Interact`                                                | なし                                                                           |
| 喜ぶ   | `Dance_Loop`・`Jump_Land`                                 | 跳び上がる `Jump_Start`・`Jump_Loop` は判定に落ちて使えない。まず `Dance_Loop` |
| 表情   | —                                                         | `room-resident.ts` は表情を動かしていない。VRM に笑顔の表情があるかは未確認    |

### 使うキャラクター

| 候補     | 状態                                                                                                                                                                                                                              |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ミルド   | VRM（`C:\wwt-private\mirdo\work\mirdo-1024.vrm`）と、判定に通った .vrma 16 本（`C:\wwt-private\mirdo\motions-pass`）がある。規約は翔太が確認済み。WWT の既存の経路（ハッシュ承認）で載せられる。記録は `docs/characters/mirdo.md` |
| フェリス | `C:\wwt-private\Felis_v0.8.1\FBX\Felis.fbx`・`Felis_Android.fbx`（両 PC にある、未追跡）。VRM への変換と動作の割り当てが要る。**利用条件の記録がなく、規約を確認できていない**（下の「7. 保留」）                                 |

## 4. 使用素材

| 素材                               | 出どころ・条件                                                                                  | 公開物に入るか                           |
| ---------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------- |
| 部屋のすべての造形・材質           | `scripts/living-room/` のスクリプトで作った自作。外部の 3D 素材・写真・テクスチャは使っていない | 入る（`room.glb`）                       |
| three.js 0.186.1                   | MIT（`assets/licenses/three-MIT.txt`）                                                          | 入る                                     |
| 部屋の古い検証用の机・椅子・ランプ | 翔太の Tripo の物（`C:\wwt-private\room\source`）。今の部屋では使っていない                     | 入れない                                 |
| ミルド、Quaternius の動作          | 私用の素材リポジトリ `wwt-private-assets`（LFS）。WWT 本体には入れない                          | 入れない（公開に載せる経路は別に決める） |
| フェリス                           | 上のとおり、規約が未確認                                                                        | 確認できるまで入れない                   |

`art/living-room/living-room.blend` からは、確認のために読み込んだ古い部屋のテクスチャを取り除いて保存した（別の Blender で開いて画像が空であることを確かめた）。

## 5. 起動方法

PC によってパスが違う（ノート PC は `C:\Users\sm787\...`、デスクトップは `C:\Users\kuros\...`）。新しい美術は worktree `.work/living-room-realism` の中で行う。`feat/living-onboarding` の既存 worktree はそのまま残す。

最初の1回：

```bash
git fetch --all --prune
GIT_LFS_SKIP_SMUDGE=1 git worktree add .work/living-room-realism codex/living-room-realism   # worktree がなければ
cd .work/living-room-realism
git lfs pull          # room.glb と living-room.blend の実体を取る
npm ci
```

部屋のページを作って見る：

```bash
WW_LIVING_TEST=1 WW_LIVING_OUT=.work/living-room-preview node scripts/build-living-room.mjs
node scripts/playground/serve.mjs .work/living-room-preview 4181     # http://127.0.0.1:4181/
```

ブラウザーの画像を撮る（画面の外の窓、本物の GPU。`PLAYWRIGHT_BROWSERS_PATH` は本体の `.work/browsers`）：

```bash
node scripts/living-room/capture.mjs art/living-room/renders/web_new.png
```

部屋を作り直す（Blender MCP は要らない。`run_all.py` は同じ部屋を作ることを確かめた）：

```bash
# 作るだけ（焼かない）
WW_SKIP_BAKE=1 WW_SAVE=.work/room-test.blend WW_RENDER=.work/room-test.png \
  "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --python scripts/living-room/run_all.py
# 焼いて GLB まで（コミットした部屋と同じ画質）
WW_LM_SIZE=4096 WW_SAMPLES=128 WW_VC_SAMPLES=128 WW_OUT=art/living-room/web \
  "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --python scripts/living-room/run_all.py
```

確かめ：`npm run typecheck`、`npm run lint`、`npm run test:unit`。

## 6. 重要な設計判断

| 判断                                                                                                      | 理由                                                                                                   |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 拡張・作品データ・Playground の描画に載せず、独立したページにした                                         | 今回の対象外が多く、WWT 本体を壊さないため。共有したのは部屋の読み取り（`readLayout`）だけ             |
| 色と光は Cycles で別々に焼き、ノイズ除去後に合成。`bakedColor: true` の Web の色＝焼いた色 × `lightScale` | 木目を保って光の粒を除く。指定のない旧データは従来の材質の色 × 焼いた光のまま                          |
| 光る物（名前が `dyn_`）は焼かず自分の色で描き、ブルームをかける                                           | 画面・電球・ネオンがにじむ。焼くときは小さな光源のメッシュを外し、代わりの光（`60_lights.py`）で照らす |
| 部屋の既存の描画（`renderers/three/room.ts`）は使わなかった                                               | ライトマップを 1024 に縮め、作品データと結び付いている                                                 |
| 止まっている間は描かない。ポインターで少し回り込む間だけ描く                                              | ノート PC の CPU と GPU の負荷を抑える                                                                 |
| 目印の名前は `marker_sit_*`・`marker_hide_*`・`marker_stand_*`、床は `navmesh_floor`                      | 既存の部屋の素材の約束（`docs/depth-foundation.md`）と同じ。`room-life.ts` がそのまま使える            |
| `.blend` と `.glb` だけ Git LFS（`.gitattributes` の `art/**`）                                           | 大きな 2 件のため。画像とライトマップは通常の Git                                                      |

## 7. 未実装・保留

- UI カード（今は仮の目印）、クリックで喜ぶ、表情。体の残り（待機の腕・止まったあとの足幅・座りの脚など）は [living-body.md](living-body.md) の 7 節
- 現行の美術は、2026-11-11 に届いた窓際の制作机の参考画像をもとに作り直した。窓の外、布の輪郭、床や陶器の反射など、残りは [living-room-realism.md](living-room-realism.md) にまとめた
- `room.glb` は未圧縮で 14.54MB。短い実 GPU の参考計測は記録済み。公開前の圧縮とノート PC での確認は残る
- 縦長 430×900 の実画面は確認済み。部屋は収まるが細部は小さくなる。専用ページの身体 e2e は `tests/living-room-body-live.spec.ts` がある（ローカル素材が要る）
- **フェリスの保存（2026-11-12 に一部解決）**：翔太の指示で、変換した VRM と動作だけを `wwt-private-assets` に入れた（購入元の配布物は入れていない）。公開ビルドと WWT 本体に入れない扱いは変わらない。以下は当時の記録。両 PC の `C:\wwt-private\Felis_v0.8.1\`（約 82MB、FBX 2・unitypackage・PSD・案内のリンク）は `wwt-private-assets` の `git status` で未追跡のまま。フォルダに**規約の文書がなく**（`.url` のリンクだけ）、`wwt-private-assets` は「入れるのはミルドと Quaternius だけ」という翔太の決定（`.gitignore` のコメント、2026-11-07）なので、**保存してよいと確認できないため入れていない**。進めるには、(1) 購入元の規約で、私用のリポジトリへの保存・変換・公開物への使い方を確認、(2) 翔太が `wwt-private-assets` に入れると決める、(3) `.gitignore` に例外を足して `git add`（LFS の指定は `.fbx`・`.unitypackage` にすでにある）、の順。デスクトップで続けるときは、まず (1) の確認を取る

## 8. 次の作業

**2026-11-11 の最新指示：アニメーションはひとまず止め、部屋の見た目を優先する。** まず [living-room-realism.md](living-room-realism.md) の実画面と残りをレビューする。以下の動作・UI の作業は、その後の候補として残す。

2026-11-11 に身体制御の基礎ができた（下の「11」）。その続き：

1. フェリスの規約を確認する（上の「7」）。確認できるまで、モデル・テクスチャ・変換した VRM・フェリスが写った録画はリポジトリにも公開にも出さない
2. 録画を通して見て、[living-body.md](living-body.md) 7 節の不自然な所を直す（待機の腕、止まったあとの足幅、歩き出しの1歩、座りの脚）
3. 生活との接続：今の行動（`approach.ts`）は「目印に触れる」と「席に座る」だけ。`room-life.ts` の暮らし（歩く・座る・隠れるの選び方）から同じ体を動かす
4. UI カードの投影・出現・クリック・閉じるの配線と、喜ぶ反応（表情は VRM に 13 入れてある）
5. 椅子・ビーズクッション・座布団での座り方を見る。家具との干渉を見る
6. 重さ（モデル 55,043 三角形、毎フレーム描く）を測り、必要なら軽くする
7. 部屋の残りの美術の問題を、キャラが入った画で見て優先を決める

危ないと思う所：`room-life.ts` は `src/world/` の中核。追加だけにして、既存の `tests/` の挙動を変えない。`main` と他の worktree には触れない。私用の素材をリポジトリに入れない。

## 9. 同期の注意（LFS の実体）

2026-11-11 に、`room.glb` と `living-room.blend` のポインターだけが push され、実体が GitHub に届かなかった（デスクトップで 404）。

- **原因**：ノート PC の `.git/hooks/pre-push` が、型チェック・lint・unit を回す独自の hook（`.claude/hooks/pre-push.mjs` を呼ぶ）で、`git lfs install` が入れる標準の hook を置き換えている。そのため push のたびの LFS の送信が動かない
- **直し方（実施済み）**：`git lfs push --object-id origin <oid>…`（oid は `git lfs ls-files -l` の物）で実体を送った。`git lfs push origin <ブランチ>` は、リモートの追跡ブランチがポインターをすでに持っているため何も送らなかった。**必ず `--all` か `--object-id` を使う**
- **確かめ方**：`git lfs ls-files` の `*` は「ローカルに実体がある」だけを示す。**新しい場所に clone して `git lfs pull` が通り、SHA-256 が合うことを見る**（`room.glb` 8f8a3f20…、`living-room.blend` e3625b29…。2026-11-11 に確かめた）
- **再発の防止（ノート PC は適用済み、2026-11-11、翔太の許可）**：`.git/hooks/pre-push` の先頭で、標準入力を一時ファイルに取り、`git lfs pre-push "$@" < 一時ファイル` を先に実行し（失敗したら push を止める）、そのあと既存の `node …/pre-push.mjs < 一時ファイル` を実行するようにした。この hook は追跡しない（ノート PC にだけある）。**デスクトップの hook が独自の hook だけの作りなら、同じ手当てが要る**。新しい LFS ファイルを実際に送る場面は、まだ試していない（次に `.blend`・`.glb` を push するとき、`Uploading LFS objects` の表示が出れば動いている）。それまでは、push のあとに `git lfs push --all origin <ブランチ>` を手で実行し、新しい clone で取得を確かめる

## 10. 初期の状態（ノート PC からの過去の記録）

- ノート PC の worktree：`feat/living-onboarding`、`origin` と同じ。`77f0653`（デスクトップの運用の文書）を fast-forward で取り込み済み
- 未コミットで残してあるもの：`art/living-room/living-room.blend`（Blender が 14:18 に保存し直した。コミットした版と中身が同じかは未確認。コミットした版の控えが同じフォルダの `living-room.blend1`、未追跡）。消さない。コミットする前に、`git lfs` で取れる版（e3625b29…）と比べて決める

## 11. 身体制御の基礎（2026-11-11、デスクトップ PC）

フェリスが、部屋で待機 → 目印を見る → 向きを変えて歩く → 減速して止まる → 向きを合わせる → 目印の座標へ手を伸ばす → 戻る、を自分で行う。席に座る・立つもできる。設計・順番・再現手順・結果・残りは [living-body.md](living-body.md)。

- 足したもの：`src/characters/locomotion.ts`・`approach.ts`・`foot-plant.ts`、`src/renderers/three/living-body.ts`、`src/living-room/resident.ts`、`scripts/living-room/record.mjs`、`scripts/characters/felis.json`、`tests/living-body.spec.ts`
- 変えたもの：`src/living-room/index.ts`・`scripts/build-living-room.mjs`（キャラは環境変数で渡したときだけ、`.work` の出力にだけ入る）、`scripts/characters/fbx_to_vrm.py`（材質ごとのテクスチャ、後ろ向きの FBX）、`playwright.config.ts`（unit の一覧に1行。中核）
- フェリスの素材と、フェリスが写った録画・画像は**リポジトリに入れていない**。手元の `C:\wwt-private\Felis_v0.8.1\` の下（`extracted`・`work`・`motions`）。ノート PC で続けるときは [living-body.md](living-body.md) 5 節の手順で作り直す（Blender に VRM Add-on が要る）
- デスクトップの状態：`feat/living-onboarding`、未コミットの変更なし、`origin` と同じ。今回 LFS の物は足していない

## 12. アニメ的な演技と柔らかいベッド（2026-11-11、デスクトップ PC）

動きに緩急・予備動作・時間差・誇張を足し、「普段」「興味」「喜び」で演じ分けるようにした。ベッドは座ると沈み、立つとゆっくり戻る。詳しくは [living-body.md](living-body.md) の 9 節（気分の表、12原則の当てはめ、比較の結果、負荷、残り、比較動画の作り方）。

- 足したもの：`src/living-room/soft-surface.ts`、`scripts/living-room/compare.mjs`。変えたもの：`approach.ts`（気分・沈む・跳ねて向き直る・喜び・間の揺らぎ）、`locomotion.ts`（`turnFirst`）、`living-body.ts`（走りのブレンド・ばねの傾きと伸び縮み・視線の時間差・耳と尻尾・表情・待機の腕）、`resident.ts`・`index.ts`・`build-living-room.mjs`、`tests/living-body.spec.ts`（18 件）
- 部屋のファイル（`room.glb`・ライトマップ）は変えていない。LFS の物は足していない
- 参考の動画は見られなかった。動画は通して見ておらず、コマの並びと記録で確かめた。**翔太が比較動画（`C:\wwt-private\Felis_v0.8.1\work\compare\side-by-side\`）を見て、気持ちよさを判断してほしい**
- 次：動画を見ての直し、普段の大きな方向転換、驚き・不機嫌・眠気、暮らし（`room-life.ts`）から気分を決める、UI カードとの配線

## 13. 演技の作り込みと足の接地（2026-11-11、デスクトップ PC）

「興味を持って駆け寄る → 触れる → 喜ぶ」を作り直した。詳しくは [living-body.md](living-body.md) の 10 節（分析で見つけた原因、直したこと、数値、負荷、残り）。

- 走りは「走り×待機」の小走りに、急停止は足を踏ん張る形に、普段の大きな方向転換は左右1歩ずつの踏み替えに、接触は「触る → もう一度ぽん → 振り向く」に、喜びは「息をのむ → 溜める → 腕を上げて大きく跳ぶ → 着地 → 1回転 → 余韻」にした
- 足の滑り（見た目）は興味の一連で 125cm → 約 12cm、普段で約 1.5cm。ページが毎フレーム2回描いていた不具合も直した
- e2e を足した：`WW_LIVE_LIVING_BODY=1 WW_LIVING_CHARACTER=<vrm> WW_LIVING_MOTIONS=<dir> npm run test:e2e -- tests/living-room-body-live.spec.ts`（素材が要るので、ふだんはスキップされる）
- 動画は通して見ていない。参考の作品の動画も見ていない。**翔太が比較動画（`C:\wwt-private\Felis_v0.8.1\work\compare\side-by-side-3\`、通常視点は `after3-room\`）を見て判断してほしい**
- 次：動画を見ての直し（走りの1歩の滑り、止まったあとの立ち姿、余韻）、驚き・不機嫌・眠気、暮らし（`room-life.ts`）から気分を決める、UI カードとの配線

## 14. 出窓と生活感のある部屋（2026-11-11、デスクトップ PC）

現行の美術は `codex/living-room-realism`。元の `feat/living-onboarding`（`2db67c9`）の worktree と作業は変更していない。作業場所は `C:\Users\kuros\GitHub-Projects\web-world-themes\.work\living-room-realism`。このブランチの原本・GLB・ライトマップ・生成スクリプト・実画面をまとめて使う。

- 正方形の部屋を 6.0 × 5.4m＋三面の出窓に変更。制作机、植物、配線、マイク、MIDI キーボード、衣類、本、洗濯かごなどを追加し、木目・布目・光を作り直した。実画面と再現手順は [living-room-realism.md](living-room-realism.md)。
- `room.json` の `bakedColor` は専用ページの素材の形式。旧ライトマップも読める。DesignDocument の版上げなし、中核の変更なし。
- 部屋の制作スクリプト、`src/living-room/index.ts` の材質と検証用カメラ、`index.html` の favicon を変更。身体・行動・移動のコードは変更していない。
- 型チェック・lint・unit と `tests/living-room-body-live.spec.ts` を確認。短い A/B 計測は要約だけ保存した。
- **翔太の最新指示によりアニメーションの追加作業は止めた。** 連続着席で経路が取れない場合や低い席の姿勢は、再開するときの確認事項として美術の記録に残した。
- 次は全景と机の近景を見て、美術の密度、色、さらに作り込みたい物を決める。初版の 4.8m 四方・青紫の夜という前提は使わない。
- 実装 `2e55cb1` は GitHub へ push 済み。新しい sparse clone で LFS の 2 件を取得し、原本と SHA-256 が一致した。デスクトップの標準 LFS hook は送信を実行した。検証用 clone・ビルド・中間データは削除し、参照画像 4 枚と要約（計 3.47MB）を残した。
- この専用ブランチは CI の push 対象外のため、Actions は起動していない。手元では型チェック・lint・unit 666 件（2 件スキップ）が通過。作業ブランチへの取り込みはまだ行っていない。

## 15. モニターの光で照らされた制作部屋（2026-11-12、ノート PC）

星の旅は止め、翔太の新しい画像の部屋へ変更。作業ブランチは `codex/living-room-reference`、作業場所は `.work/living-room-reference`。Blender MCP で造形・照明・焼き込み・原本保存を行った。`reference_*.py` が今回の部品で、`run_all.py` が一括再生成する。旧番号スクリプトは前版の記録。

- 左の収納、中央奥の三画面の制作机、右の寝床、手前の格子ラグ・丸テーブル・カート・リュック・楽器を配置。画面と青い照り返しを主役に、枕元だけ暖色を入れた。
- `art/living-room/living-room.blend` と `web/` が現行。実画面は `renders/reference-*.png`。新規作成した小さな絵柄用の画像は `textures/studio-art-atlas.png`。参考画像と絵柄・小物が完全に同じという意味ではない。
- 型チェック・lint・unit 665 件通過（3 件スキップ）。10 か所へ到達可。前版と今回のミルドによる動作検査はいずれも足滑りで失敗した。Felis はこの PC に変換済みの物がなく未検証。身体・行動のコードと判定は変更していない。
- 中核の変更・DesignDocument の版上げなし。原本は圧縮保存し、依存物を共有した。実装 `8e7508e` を push し、新しい clone の LFS 取得とハッシュ一致を確認した。検証用データ約130MBを削除し、参照画像・要約約5.09MBと確認用の完成ビルド一つを残した。
- 次：全景と近景の美術レビュー。動作を再開するときは Felis のある環境で接地・席間の移動を確認する。詳細・同期状態は [living-room-night-reference.md](living-room-night-reference.md)。
- 2026-11-12 深夜 3（Claude Code）：**ライブモード**（最新）。デスクトップに YouTube のプレイヤー（公式の埋め込み）を足した。「ライブモード」でカードが部屋の奥のスクリーンになり、部屋の明かりが落ち、映像の左・中央・右の色が家具とフェリスを照らし、縁の色が床・天井・壁へ伸びる。色と音は、見ている人の許可でこのタブを取り込み、プレイヤーの箱に切り出して読む（保存・送信なし。断られたらサムネイルの色）。フェリスは曲の盛り上がりで聴く・揺れる・踊る（内蔵の `Dance_Loop`）。本物の YouTube で取り込み・照明・切り替わりを確認した。中核は `playwright.config.ts`（unit の一覧に 1 行）だけ。版上げ・LFS の変更なし。**YouTube の規約上この読み取りが許されるかは翔太の判断が要る**。設計・調べた結果・残りは [living-live.md](living-live.md)。次の候補：規約の判断、踊りの種類、縦長の画面、フロア視点の手前の家具
- 2026-11-12 深夜 2（Claude Code）：**デスクトップの見た目の作り直しと、部屋の中からの視点**。翔太の指示で、俯瞰をやめて部屋の手前・目の高さから見る視点にした（ページの側の定数 `VIEW`。Blender の再ベイクなし。切り欠きの部屋に、光を持たない右の壁と天井を足した：`enclose.ts`）。デスクトップは全幅の上部バー・大きな時計・すりガラスのカード・タイルのドックに作り直し、壁紙の色がガラス・ドック・画面の上下・モニター・部屋の光にそろって出る。バーとドックにフェリスの今と気分が出る。水平な視点に合わせて、手が届く所・座る所・光と影・叩く向きの計算を直した。心・演出役・物理はそのまま。中核の変更・版上げ・LFS の変更なし。設計・画像・残りは [living-shell.md](living-shell.md)。次の候補：部屋の手前の物の配置を視点に合わせる（Blender）、壁と天井を焼く、フェリスカム、縦長の画面
- 2026-11-12 深夜（Claude Code）：**フェリスの心と、物としての UI**。1 日の固定の流れ（`life-script.ts`）をやめ、Utility AI（欲求・感情・短期記憶・仲の数値。`src/characters/mind.ts`）と演出役（`src/living-room/director.ts`）に置き換えた。フェリスは自分でデスクトップを開いて使い、画面を内側から叩き、ボールを追い、窓に飛び乗って座る（その間は UI より手前に描く）。窓とボールは投げられ、光と影が付いて動く。乗っている窓を投げると振り落とされ、繰り返すとすねる。なでると機嫌が直る。吹き出しと体で眠い・不機嫌・混乱・驚きを見せる。LLM は使っていない。中核は `playwright.config.ts`（unit の一覧に 1 行）だけ触った。DesignDocument の版上げなし、美術（LFS）の変更なし。設計・確かめた結果・残りは [living-mind.md](living-mind.md)。次の候補：フェリスカム（顔のアップ）、掴んだまま引く動き、窓の上の座り姿、縦長の画面、身体の e2e の足の固定（以前からの失敗）
- 2026-11-12 夜（Claude Code）：**仮想デスクトップと部屋の融合**（翔太の優先 1・2）。ガラス調の窓の仮想デスクトップを部屋の上に開ける。同じ状態が机のモニターに映り、壁紙やミラー（画面共有。押したときだけ確認が出る）の色が部屋の照明になる。そのために部屋の光を「土台・モニター・手前の UI」の 3 層に焼き直した（`light-ui.png`・`light-screen.png`、頂点属性 `_UI`・`_SCREEN`）。フェリスは開くとイヤホンを外してスマホを置き、窓の縁に手をかけに来る。届かない場所なら眺める。閉じると生活に戻る。設計・画像・残りは [living-desktop.md](living-desktop.md)。次の候補：アプリの中身、Utility AI（1 日の固定の流れ `life-script.ts` の置き換え）、記憶と性格（数値）
- 2026-11-12 夕方（Claude Code、`feat/living-onboarding` に `codex/living-room-reference` を取り込んで続けた）：**フェリスの暮らし**。ベッドに飛び込んで寝転ぶ（うつ伏せでパタパタ → 寝返りして仰向け）、椅子の座面が沈み背もたれが反り揺れる、スマホを取ってイヤホンを自分で付け外しし、寝転んで・座って見る、画面の光が顔と枕・布団に届く、を1日の流れ（約 2 分半で一周）にした。設計・確かめた結果・残りは [living-life.md](living-life.md)。フェリスの VRM と動作 19 本は翔太の指示で私用の素材リポジトリ `wwt-private-assets` に入れた（`Felis_v0.8.1/work/felis-1024.vrm`・`Felis_v0.8.1/motions`）。WWT 本体と公開ビルドには入れていない。身体の e2e は足の固定の検査で落ちるが、変更前のコミットでも同じ値で落ちる（living-life.md の 5b）
- 2026-11-12 午後（Claude Code）：翔太の Tripo モデル7つ（制作机・独立した椅子・ラグ一式・左の金属棚・暗い本棚・服のラック・リュック）に置き換えた。整えた GLB は `art/living-room/models/`、手順は `prepare_models.py`→`run_all.py`。Web は `texturedMesh` で「テクスチャ×焼いた光」を描く。10 か所に到達可、unit 665 件通過（3 件スキップ）。記録は [living-room-night-reference.md](living-room-night-reference.md) の冒頭。
