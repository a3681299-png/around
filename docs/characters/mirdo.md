# ミルド（mirdo）を WWT で動かす

Playground と WWT の見せ場のキャラを、BOOTH の「オリジナル3Dモデル ミルド - mirdo」にする（2026-11-07、翔太の決定）。この文書は、取り出し・変換・重さ・動作の確認の記録。

**素材はリポジトリに入れない。** ミルドの元のファイル・取り出した中身・変換した VRM・Quaternius の素材は、すべて `C:\wwt-private\` の下に置き、リポジトリにはスクリプトと名前の対応（`scripts/characters/mirdo.json`）だけを入れる。Playground への組み込みは、規約の確認が済んでから次の塊で行う。

## 1. 規約

- ミルド：VN3 の簡易一覧で判断した（映像・ソフトへの組み込み・改変したデータの配布が許可されていることを、2026-11-07 に翔太が確かめた）
- Quaternius Universal Animation Library：同梱の `License.txt` と `README.txt` は CC0 1.0（パブリックドメイン）。クレジットは求められていない（Patreon の案内だけ）

## 2. unitypackage からの取り出し（Unity なし）

`scripts/characters/unitypackage.mjs`（依存なし。R7 の製品の取り込みにも使える形）。unitypackage は gzip の tar で、GUID ごとのフォルダに `pathname`（Unity の中のパス）・`asset`（中身）・`asset.meta` がある。元のパスで書き出し、取り出し先の外に出るパス（`..`・絶対パス・ドライブ名）は、書き出す前に全体を止める。単体テストは `tests/unitypackage.spec.ts`（4件）。

```bash
node scripts/characters/unitypackage.mjs "C:/wwt-private/ローポリモデル用/mirdo_ver2/mirdo_ver2/mirdo_ver2.unitypackage" C:/wwt-private/mirdo/extracted
```

元のファイル：`C:\wwt-private\ローポリモデル用\mirdo_ver2\mirdo_ver2\mirdo_ver2.unitypackage`（5.3MB。指示の `C:\wwt-private\mirdo\` ではなく、ここにあった）。取り出した 25 ファイル（`C:\wwt-private\mirdo\extracted\Assets\mirdo_ver2\`）：

| 種類       | ファイル（バイト）                                                                                                                                                                               |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| モデル     | `FBX/mirdo.remake.fbx`（842,668）、輪郭用のメッシュ `FBX/mirdo_{body,cloth,hair,head}_Outline.asset`（Unity 専用、使わない）、`mirdo.remake_prefab.prefab`（39,605）                             |
| テクスチャ | `Texture&Material/mirdo_BaseColor.png`（4096×4096、2,388,165）、`mirdo_BaseColor_cloth_off.png`（4096×4096、服なし。使わない）、`Mask/mirdo_Mask_{shade,light,highlight,outline}.png`（128×128） |
| 材質       | `Texture&Material/mirdo_Material.mat`（lilToon。値だけ読んだ）                                                                                                                                   |
| アニメ     | `Animatopn/`（綴りは元のまま）：表情の `Angry`・`Fun`・`Joy`・`Question`・`sorrow`・`Surprised`・`Blink_on`・`Blink_off`、`mirdo_Idle`・`mirdo_afk`、VRChat の controller 2つ                    |

## 3. VRM への変換

`scripts/characters/fbx_to_vrm.py`（Blender 5.2.2・VRM Add-on for Blender 4.10.2）。名前と数値は `scripts/characters/mirdo.json`。

```bash
blender -b --python scripts/characters/fbx_to_vrm.py -- scripts/characters/mirdo.json C:/wwt-private/mirdo/extracted/Assets/mirdo_ver2/FBX/mirdo.remake.fbx "C:/wwt-private/mirdo/extracted/Assets/mirdo_ver2/Texture&Material" C:/wwt-private/mirdo/work/mirdo-1024.vrm 1024
```

| 部分     | やったこと                                                                                                                                                                                                                                                |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 骨       | 元の骨の名前が人型にそろっている（`hips`・`upper_arm.L` など）。51 本を対応。親指は `thumb_proximal/intermediate/distal` を VRM の metacarpal/proximal/distal に。つま先の骨はない                                                                        |
| 表情     | 頭のメッシュのモーフから：喜 Joy・怒 Angry・哀 Sorrow・楽 Fun・驚 Surprised（髪の Surprised も）・口 aa/ih/ou/E/oh・まばたき Blink/Blink_L/Blink_R。喜怒哀楽と驚きはまばたきを止める。`Question` と VRChat の口の形（sil・PP など）は使っていない         |
| 材質     | lilToon の値を MToon に移した：影の色 (0.86, 0.75, 0.77)、境目 0.6 → shift −0.2・toony 0.9、輪郭 0.3 → 世界座標 3mm・色 (0.95, 0.7, 0.7)、輪郭の太さのマスク。材質は1つのまま                                                                             |
| 揺れもの | PhysBone は読めないので骨の名前から：髪 8 本（`hair_front`・`hair_back`・`hair_side`・`hair_aho` など、頭と胸の当たり判定）、裾 10 本（`A_hem`〜`F_hem`、腰と太ももの当たり判定）                                                                         |
| 見た目   | `scripts/characters/render-vrm.mjs` で正面・斜め・横・後ろを描いて確かめた（画像はリポジトリの外 `C:\wwt-private\mirdo\work\views.png`）。Unity のプレビュー（128px）は小さすぎて比べられなかった。lilToon のリムライト・ハイライトのマスクは移していない |

## 4. 重さ

| 版                   | ファイル    | 三角形 | 材質 | テクスチャ           | GPU のメモリ（WWT の見積もり） | WWT の検査の時間 |
| -------------------- | ----------- | ------ | ---- | -------------------- | ------------------------------ | ---------------- |
| 2048px               | 2,445,260 B | 7,653  | 1    | 2048² ＋ マスク 128² | 24.2MB                         | 28.7ms           |
| **1024px（使う版）** | 1,853,156 B | 7,653  | 1    | 1024² ＋ マスク 128² | 7.4MB                          | 26.8ms           |

元から軽い（三角形 7,653・材質1）ので、メッシュは減らしていない。1024px の版は、400px 角に描いた比べ（`compare-2048-1024.png`）で見分けがつかなかった。

## 5. 体型（WWT の測定）

`scripts/characters/measure-vrm.mjs`（`src/assets/glb.ts` の取り込みの検査と `src/characters/humanoid.ts` の測定をそのまま通す）。WWT の検査は通った（VRM 1.0、人型の骨 51、表情 18、視線・揺れもの・MToon あり）。

| 測定         | ミルド | 基準      |
| ------------ | ------ | --------- |
| 身長         | 1.054m | —         |
| 頭身         | 3.60   | 4 以上    |
| 足の長さの比 | 0.421  | 0.42 以上 |
| 腰の高さの比 | 0.442  | 0.48 以上 |

**判定は段階1**（頭と腰が基準より下）。自動（`standardMotions: 'auto'`）では標準の動作を使わず、計算の動き（視線・呼吸・揺れ・跳ねる）になる。キャラの動作として読み込んだもの（origin が character）は段階によらず再生される。足の比は基準をぎりぎり超えている。

## 6. 動作（Quaternius Universal Animation Library）

「当てて、直して、試す」の最初の形。ミルドだけの調整値は使わず、どのキャラにも同じ手順で効くように作った。素材と、ミルドに当てた .vrma はリポジトリに入れない（`C:\wwt-private\mirdo\motions\`、合格したものは `motions-pass\`）。

### 素材の中身

`C:\wwt-private\quaternius-ual\Universal Animation Library[Standard]\…\`：`Unity/UAL1_Standard{,_RM}.fbx`、`Unreal-Godot/UAL1_Standard{,_RM}.glb`、`License.txt`・`README.txt`（CC0 1.0）。`_RM` は根の移動あり。骨は UE のマネキンの名前（`pelvis`・`spine_01〜03`・`thigh_l` など 65 本）、T ポーズ、身長 約1.8m（腰 0.92m）、正面は −Y。動作は 43 本（秒、Loop は名前に `_Loop` があるもの）：

| 種類         | 動作（秒）                                                                                                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 待つ         | Idle_Loop 2.50・Idle_Talking_Loop 2.93・Idle_Torch_Loop 1.27・Crouch_Idle_Loop 2.93                                                                                            |
| 移動         | Walk_Loop 1.33・Walk_Formal_Loop 1.33・Jog_Fwd_Loop 0.93・Sprint_Loop 0.67・Crouch_Fwd_Loop 2.00・Swim_Fwd_Loop 1.33・Swim_Idle_Loop 3.33・Push_Loop 2.67・Roll 1.47           |
| 座る         | Sitting_Enter 1.30・Sitting_Idle_Loop 1.67・Sitting_Talking_Loop 2.93・Sitting_Exit 1.03                                                                                       |
| 跳ぶ         | Jump_Start 1.33・Jump_Loop 2.50・Jump_Land 1.27                                                                                                                                |
| 反応         | Hit_Chest 0.33・Hit_Head 0.43・Death01 2.40                                                                                                                                    |
| 喜ぶ・身ぶり | Dance_Loop 1.00・Interact 2.00・PickUp_Table 0.83・Fixing_Kneeling 5.20・Spell_Simple_Enter 0.53・Spell_Simple_Idle_Loop 2.10・Spell_Simple_Exit 0.43・Spell_Simple_Shoot 0.50 |
| 使わない     | A_TPose・Driving_Loop・Pistol_*（6本）・Punch_Cross・Punch_Jab・Sword_Attack・Sword_Idle                                                                                       |

**眠る動作はない。** 驚くは Hit_Head・Hit_Chest（叩かれた身ぶり）で代える。

### 当てる・直す（`scripts/characters/retarget_vrma.py`）

```bash
blender -b -P scripts/characters/retarget_vrma.py -- C:/wwt-private/mirdo/work/mirdo-1024.vrm ".../Unreal-Godot/UAL1_Standard_RM.glb" scripts/characters/rigs/ual.json scripts/characters/clips/ual.json C:/wwt-private/mirdo/motions
```

元の骨の対応は `scripts/characters/rigs/ual.json`、当てる動作の一覧は `scripts/characters/clips/ual.json`（19本。出力の名前は元の名前のまま。WWT の自動の見分けが、ほかの取り込みと同じ「よくある名前」から働くように）。1回の Blender で全部を処理する（ノート PC で約8分）。トルーシェ用の当て方（人型の骨ごとに世界での回転を写す）を一般化し、補正はすべて二つの体から計算する：

| 補正           | 計算                                                                                                                                                                                                                   | ミルドでの値                               |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| 腰の高さ・歩幅 | 腰の動きを「先の休止姿勢の腰の高さ ÷ 元の腰の高さ」で縮める                                                                                                                                                            | 0.4995                                     |
| 足の接地       | コマごとに、変形したメッシュの足の裏（足に付いた頂点の一番低い所）を、元の足の裏の高さ×比に合わせて腰を上下させる。跳ぶ高さは元に従う。足首では足の傾き（かかと・つま先）を拾えず左右でずれた（右足だけ 1.7cm 浮いた） | 腰の上下 −7.3〜+0.9cm                      |
| 腕の開き       | コマごとに、前腕・手がメッシュの胴の内側に入らない最小の角度（2.5°刻み、45° まで）だけ腕を肩で開き、前後でならす                                                                                                       | 0〜45°（服が厚いので多くの動作で 30〜45°） |
| その場の移動   | `inPlace` の動作は1周期の前進を引く。足が保つ速さは「試す」で測る                                                                                                                                                      | 歩く 0.54m/s・走る 3.05m/s（足が保つ速さ） |

### 試す（`scripts/characters/check-motions.mjs`）

```bash
node scripts/characters/check-motions.mjs --vrm C:/wwt-private/mirdo/work/mirdo-1024.vrm --dir C:/wwt-private/mirdo/motions --out C:/wwt-private/mirdo/check
```

three-vrm で見えない所で再生し（30fps）、身長に対する割合で測る。合格の線（`LINES`、単体テスト `tests/check-motions.spec.ts`）：

| 崩れ         | 測り方                                                                                                         | 不合格の線                                                   |
| ------------ | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 手が体に入る | 前腕・手の頂点が、背骨の線から見て同じ高さの胴の頂点（の 8 割）より内側                                        | 3 頂点以上のコマが 10% 超                                    |
| 足が浮く     | 低い方の足の裏が、休止姿勢の足の裏より上                                                                       | 3% 超のコマが 10% 超。走る・跳ぶは「一度も床に着かない」とき |
| 床に沈む     | 低い方の足の裏が下                                                                                             | 2% 超のコマが 5% 超                                          |
| すべる       | 床に着いている同じ頂点が、隣のコマで動いた速さ（その場の移動では、足が保つ速さを中央値で求めてそこからのずれ） | 0.08 身長／秒。移動は保つ速さの 15%                          |

### 結果と、目で見た結果との比べ（5コマの一覧は `C:\wwt-private\mirdo\check\<名前>.png`）

| 動作                   | 秒         | ループ | 自動     | 理由         | 目で見て                                                                 |
| ---------------------- | ---------- | ------ | -------- | ------------ | ------------------------------------------------------------------------ |
| Idle_Loop              | 2.50       | する   | 合格     |              | 崩れなし（腕は服を避けて少し開く）                                       |
| Idle_Talking_Loop      | 2.93       | する   | 合格     |              | 崩れなし                                                                 |
| Crouch_Idle_Loop       | 2.93       | する   | 合格     |              | 崩れなし                                                                 |
| Walk_Loop              | 1.33       | する   | 合格     |              | 崩れなし                                                                 |
| Walk_Formal_Loop       | 1.33       | する   | 合格     |              | 崩れなし（最初と最後が 1° 以上ずれ、当て直しでは「ループしない」と出た） |
| Jog_Fwd_Loop           | 0.93       | する   | 合格     |              | 崩れなし。両足が浮く瞬間は走りとして自然                                 |
| Sprint_Loop            | 0.67       | する   | **外す** | すべる       | 静止画では分からない（保つ速さ 4.5m/s に対し 28% ずれる）                |
| Sitting_Idle_Loop      | 1.67       | する   | 合格     |              | 崩れなし                                                                 |
| Sitting_Talking_Loop   | 2.93       | する   | 合格     |              | 崩れなし                                                                 |
| Sitting_Enter          | 1.30       | しない | **外す** | すべる       | 一致：座りながら足が前へ動く                                             |
| Sitting_Exit           | 1.03       | しない | **外す** | すべる       | 一致：立ちながら足が動く                                                 |
| Jump_Start             | 1.33       | しない | **外す** | 沈む・すべる | 一致：しゃがむコマで足が床に入り気味                                     |
| Jump_Loop              | 2.50       | する   | **外す** | 沈む         | 一致：空中の姿勢を床の上で見るので足が床に入る（空中で使う動作）         |
| Jump_Land              | 1.27       | しない | 合格     |              | 崩れなし                                                                 |
| Hit_Head・Hit_Chest    | 0.43・0.33 | しない | 合格     |              | 崩れなし（動きが小さい）                                                 |
| Dance_Loop             | 1.00       | する   | 合格     |              | 崩れなし                                                                 |
| Interact               | 2.00       | しない | 合格     |              | 崩れなし                                                                 |
| Spell_Simple_Idle_Loop | 2.10       | する   | 合格     |              | 崩れなし                                                                 |

**食い違い**：最初の線では、走る2本を「浮く」で不合格にした（走りは両足が浮く瞬間がある）。目で見て自然だったので、線のほうを「移動・跳ぶは一度も床に着かないときだけ浮く」に直した。Sprint の「すべる」は静止画では確かめられない（目で見た結果とは比べられていない）。

### 割り当て（`src/characters/auto-motions.ts`、単体テスト `tests/auto-motions.spec.ts`）

「動作を追加」で読み込んだとき、manifest.json がなければ、名前（Idle・Walk・Jog/Run/Sprint・Sitting・Jump・Hit・Dance・Talk・Sleep など、Mixamo と UAL の名前）と、.vrma から測った事実（腰の移動、1コマの姿勢）で役割（今ある7種）とループを決める。名前と測定が食い違えば測定を優先し、分からない名前は確かさの低い「身ぶり」にする。続けて自律の行動に当てる：休む＝座るのループ（なければ待つ。家の縁に座る）、逃げる＝走る（なければ歩く）、近づく・戻る＝歩く、うとうと＝眠る（なければ座るのループ）。作者が変えた行は残し、自動の行は動作が増えるたびに選び直す（保存する項目は増やさない）。キャラが「動作を追加」で初めてできたときは、自律を on にする。

ミルドに 14 本を読み込んだ結果：休む・うとうと＝Sitting_Idle_Loop、逃げる＝Jog_Fwd_Loop、近づく・戻る＝Walk_Loop。

## 7. 本物の YouTube（2026-11-07、ノート PC）

`tests/flicker-live.spec.ts` を `WW_FLICKER_PRIVATE=1 WW_VRM_FILE=C:/wwt-private/mirdo/work/mirdo-1024.vrm` で、リポジトリの公開の動作2本（座る・立つ）と一緒に回した。動画とスクリーンショットは `.work/flicker-live/`（コミットしない）。

| 場面                                               | 結果                                                                                                                                                                                                                                                                                                                       |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 編集中、画面基準、カーソルを真上・ゆっくり・出入り | 止まったコマ 0・隠れた回数 0（自律 on・off とも）。段階1の計算の座り方（ひざを抱える）で描かれ、崩れは見えない                                                                                                                                                                                                             |
| プレーヤーの右下（プレーヤー基準）                 | 見ている間 2,595 コマ・編集中 2,516 コマ、止まったコマ 0・方式の切り替え 0                                                                                                                                                                                                                                                 |
| 見ている間、画面基準                               | 自律 off の1回で、ゆっくり動かす区間に止まったコマ 11・隠れた回数 2。理由は「操作バー（controls.bottom）が動いている間は止める」守り。カーソルで YouTube の操作バーが出入りした。ホバーとは別の原因で、マネキンでも起動直後に同じ理由で止まる                                                                              |
| 見ている間の見た目（画面基準）                     | **写らない**。取り込んだ直後の既定の置き場所（画面基準・画面の中央＝動画の上）では、見ている間、ホストの切り抜きが操作バー（`player.controls.bottom`）の列を上から下まで外し、キャラ全体が切られる。守りの設計どおり（案内文：映像上にはプレーヤー基準を使う）。マネキンでも塊3（c5cbb68）でも同じ。プレーヤー基準なら写る |

### 読み込むだけで（`tests/character-import-live.spec.ts`、2026-11-07）

`WW_LIVE_CHARACTER_IMPORT=1 WW_CHARACTER_VRM=C:/wwt-private/mirdo/work/mirdo-1024.vrm WW_CHARACTER_MOTIONS=C:/wwt-private/mirdo/motions-pass`。エディターで VRM と 14 本を読み込み、置き場所・自律・割り当てに手を加えずに保存して、見ている間を確かめた（表示あり・画面外、撮影は `caret: 'initial'`）。画像は `.work/character-import-live/`（コミットしない）。

| 確かめたこと                         | 結果                                                                   |
| ------------------------------------ | ---------------------------------------------------------------------- |
| 置き場所                             | プレーヤー基準・右下（x 90%・y 74%・150×190）                          |
| 見ている間に見える                   | 見える。キャラを隠した画像との差 2,891（線 50）                        |
| 休む                                 | Sitting_Idle_Loop、腰を置き場所の点に合わせて座る（`seat`）。崩れなし  |
| 逃げる・戻る                         | カーソルを急に近づけると Jog_Fwd_Loop、離すと Walk_Loop に切り替わった |
| カーソルをキャラの真上に置いて動かす | 346 コマで止まったコマ 0                                               |
| 読み込みの時間                       | VRM と 14 本で 2.7 秒                                                  |

## 8. 重さの短い確認（合否は Codex）

`tests/r32-perf.spec.ts` の `body`（キャラあり・自律 off の定常）を、マネキン（A）とミルド（B、`WW_PERF_R32_MODEL`）で A→B→B→A。ノート PC（i7-13650HX）・Chromium 153.0.8010.12・画面 144Hz・表示あり・画面外・実 GPU。拡張の rAF の CPU 時間（ms／フレーム）。読み込みは、作品を保存してからキャラが最初に描かれるまで。

| 回  | モデル   | 中央値（2回） | p95（2回） | 読み込み（ms、2回） |
| --- | -------- | ------------- | ---------- | ------------------- |
| 1   | マネキン | 0.5・0.7      | 1.3・1.8   | 159・83             |
| 2   | ミルド   | 0.5・0.5      | 1.6・1.5   | 211・109            |
| 3   | ミルド   | 0.6・0.5      | 1.9・1.6   | 248・99             |
| 4   | マネキン | 0.6・0.6      | 1.4・1.4   | 159・157            |

CPU はほぼ同じ。最初の読み込みはミルドが約 70ms 長い（ファイルが 1.85MB と大きい）。GPU の時間は測っていない。

## 確かめていないこと・気になる点

- 「縁に座る」：休むときは座って、腰が置き場所の点（操作バーのすぐ上）に合う。操作バーが隠れている間は、動画の上の空中に座って見える。プレーヤーの下の縁や上の縁に座らせる置き場所は、まだない
- うとうと（doze）は長く待たないと起きないので、実サイトでは確かめていない
- Sprint の「すべる」は目で確かめられていない。WWT が歩く・走る間にキャラを動かす速さと、足が保つ速さ（歩く 0.54m/s・走る 3.05m/s）を合わせる仕組みはまだない（.vrma には速さを入れておらず、作品データにも項目がない）。実サイトで足がすべって見えるかは、動画で見ていない
- 眠る動作は UAL にない。驚くは Hit_Head・Hit_Chest で代えた
- 当て直しと試すは、ミルド1体でしか回していない。ほかのキャラ（トルーシェなど）で同じ線が合うかは確かめていない
- Playwright の既定のスクリーンショット（`caret: 'hide'`）は入力欄のスタイルを変え、守りが一瞬描画を止める（キャンバスが 1×1 になる）。撮影は `caret: 'initial'` にした（Codex の調査）
- 元の見た目（Unity の lilToon）との比べは、BOOTH の商品画像か Unity での表示がないとできない。リムライト・ハイライトのマスクは移していない
- 表情の `Question`、VRChat の口の形（sil・PP など）、体のメッシュの補正のモーフ（upper_leg など）は使っていない
- 揺れものの強さと当たり判定の大きさは目で決めた値。動作を当てたときの髪と裾の貫通は見ていない
