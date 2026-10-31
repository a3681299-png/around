# UI0-c：ページの上の印をデザインシステムにする

エディターがページの上に描く印（着せ替えの部品の枠と名札、選んだ動画カードの枠、作品のレイヤーの選択枠とハンドル、守っている場所）を、`docs/wwt-studio-design-system/` の決まりにした。エディターの中（UI0-b で済み）と、Studio・サイドパネル・ポップアップ（UI0-d）は触っていない。

## 変更点と理由

| 対象                                                       | 変更                                                                                                                                                                                                                                                                                                                                           | 理由                                                                                           |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 印の入れ物                                                 | `src/editor/page-marks.ts`・`page-marks.css`（新規）。ShadowRoot（open）を持つ `#web-world-themes-page-marks` 1 つの中に、マウスを乗せた部品の枠（`#web-world-themes-skin-hover`）と選んだ部品の枠（`#web-world-themes-selection-mark`）を置く。入れ物も中身も `pointer-events:none`。入れ物は最初に印を出したときに作り、編集を終えると外す   | 指示 1。色・書体・クラスをページへ漏らさない。エディターを閉じているときはページに何も足さない |
| マウスを乗せた部品（`skin-picker.ts`）                     | 紫の div の枠をやめ、`ww-mark`（部品の箱を 4px 広げ、四辺を `--ww-pen-h` / `--ww-pen-v` のマスクで描く。角から 4px はみ出す）と `ww-tag`（cobalt の地に on-cobalt の文字、枠の左下のすぐ下）。新しい部品に乗ったときだけ 4 コマで描き込み、同じ部品の上を動くあいだは位置だけ変える                                                            | 指示 1。pen.ts（penOutline）は使っていない（前置きのとおり）                                   |
| 未対応の部品                                               | `ww-unsupported`（ink-faint の 1px の破線、部品の箱の上）と `ww-tag--off`「未対応」                                                                                                                                                                                                                                                            | 指示 1。README の PageHighlight                                                                |
| 選んだ種類の他の部品                                       | CSS の outline のまま、`1px solid rgb(43 81 184 / 0.5)`、offset 4px（紫の 2px の破線をやめた）                                                                                                                                                                                                                                                 | 指示 1。19 個のカードを追いかけない                                                            |
| 選んだ動画カード（`controller.ts`）                        | 紫の点線（`SELECTION_CSS` の outline）をやめ、`ww-mark` で描く。scroll（document・capture・passive）と window の resize と、その 1 要素だけの ResizeObserver で、rAF 1 回にまとめて置き直す。ページの変化の通知（`refreshSelection`）でも 1 回置き直す。選択が外れる・編集を終える・強制プレビュー・全画面で、リスナーと Observer をすべて外す | 指示 2。毎フレーム回るループは無い（e2e で、動かないあいだ 500ms の変化 0 を確かめる）         |
| 着せ替えでクリックした部品                                 | 動画カードと同じ `ww-mark` の枠（前は紫の点線）                                                                                                                                                                                                                                                                                                | 選んだ部品の枠は 1 つの形にした。強制プレビュー中は前と同じく出さない                          |
| 「Studioで編集中」の札                                     | 自分の ShadowRoot の中の小さな `ww-panel`（`studio-tokens.css` のトークン、surface の地、line の罫線、radius-float、shadow-float、BIZ UDPGothic 系の書体、ボタンは `line-control` の罫線）。紫の枠をやめた                                                                                                                                     | 指示 2。ページの CSS がボタンに効かないようにした                                              |
| 作品のレイヤーの選択（`scene.ts` の CSS）                  | 選択枠：1px の cobalt の実線＋内外 1px の白い縁。グループ：cobalt の破線、ロック中：ink-muted の破線（どちらも白い縁も破線にした）。複数選択の外枠：cobalt の破線。スナップのガイド線：cobalt 1px＋白い縁。ハンドル：見える四角は 12px（地は白、縁は cobalt、角は丸めない）。回転のハンドルは丸をやめ、同じ四角に回転の記号（マスク）          | 指示 3。G-pen にしない（作品を動かす道具は定規の線）                                           |
| ハンドルの当たり判定                                       | ボタン自体は今までどおり 14×14px・同じ位置。見える 12px の四角と記号は `::before` / `::after`                                                                                                                                                                                                                                                  | 指示 3「今より小さくしない」                                                                   |
| 守っている場所（`operation-guard.ts` の CSS の文字列だけ） | `ww-protect`：45° の vermilion の斜線（1.2px / 6px）、vermilion の 1px の罫線、部品の ID を mono（IBM Plex Mono 系）で、1 行目に surface-raised の地を敷いて出す。描く場所・出し入れの処理・DOM は変えていない                                                                                                                                 | 指示 4。下の「README と違う判断」                                                              |
| 緊急OFF（Alt+Shift+Q とボタン）                            | `CreatorEditor.suspendMarks` を足し、content script の緊急OFFの通知で呼ぶ。印の入れ物を隠し、選んだ種類の outline を外し、選んだ部品の追従を止める。エディターと Undo はそのまま。再開で戻る                                                                                                                                                   | 指示 5。前は、緊急OFFでもエディターの紫の枠と outline が残っていた                             |
| エラーの文言                                               | 「紫の枠が出る部品」→「名札の付く枠が出る部品」（2 か所）                                                                                                                                                                                                                                                                                      | 枠が紫ではなくなったため                                                                       |
| README                                                     | PageHighlight の `ww-mark--sibling` を「1px の cobalt の実線、50%、描き込まない。ページの上では各部品の outline（offset 4px）」に書き換え、`bundle.css` の `.ww-mark--sibling` も同じ形にした。ページの上の印は Gesso の値で描くことを 1 行足した                                                                                              | 指示 1                                                                                         |

## README と違う判断

| 項目                | README                                           | 今回                                                                                                                                                                   | 理由                                                                                                                                                                                                                                                                              |
| ------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ページの上の印の色  | テーマ（Payne's grey / Gesso）でトークンが変わる | ページの上の印（mark・tag・unsupported・レイヤーの選択・protect）は、システムの配色によらず Gesso の値（cobalt #2b51b8、vermilion #bf3f1d など）に固定し、白い縁を足す | 印は白い YouTube・ダークの YouTube・明るい動画・暗い動画のどれの上にも出る。Payne's grey の cobalt（#7ea4f4）は白の上で 2.5:1 しかない。濃い cobalt＋白い縁なら、白の上では cobalt が、暗い絵の上では白い縁が線を運ぶ（スクリーンショット 4 種で確認）                            |
| G-pen の枠の白い縁  | 書いていない                                     | `ww-mark` に `drop-shadow` 2 段で白い縁を足した。マスクの後に効かせるため、マスクは子の `::before` に置き、親に filter を付けた                                        | 暗い動画・ダークの YouTube の上で cobalt の線が沈むため                                                                                                                                                                                                                           |
| 名札の位置          | 枠の左下のすぐ下                                 | 窓の下端に近く、下に置くと切れるときだけ、枠の左上のすぐ上                                                                                                             | 名札が窓の外に出て読めなくなるため。1920×1080 の検索結果では、2 枚目のカードが窓の下端にかかるので上に出ている                                                                                                                                                                    |
| 未対応の名札        | `ww-tag--off` 「未対応」                         | 文言は「未対応」だけにした（前は「未対応：この部品は着せ替えできません」）。`ww-tag--off` には line-control の 1px の縁を足した                                        | README どおりの文言。surface-raised の地は白い YouTube の上で輪郭が消えるため縁を足した。クリックすると下の文で「着せ替えに対応していません」と出るのは前と同じ                                                                                                                   |
| `ww-unsupported`    | 位置は書いていない                               | 部品の箱そのもの（4px 広げない）に、白い縁つきで描く                                                                                                                   | G-pen の枠のように角を越えて伸ばす必要がないため                                                                                                                                                                                                                                  |
| `ww-protect` の地   | 斜線を `vermilion-wash` の上に描く               | wash を敷かない。斜線は `background-attachment:fixed` で窓に固定した                                                                                                   | 本物の YouTube では保護範囲が 30 個近く重なる（スクロール範囲の縦長の箱）。箱ごとに wash を敷くと重なりで不透明な赤い塊になり、動画も選択枠も見えなくなった（作り直し前の画像は残していない。下の「経過」）。窓に固定すると、重なった箱の斜線が同じ線に重なり、1 つの範囲に見える |
| `ww-protect` の名札 | 左下に、余白のある地を敷いた mono の札           | 左上に、1 行目だけ地を敷く（`::first-line`）。左右に NBSP 1 文字分の余白（`::before` / `::after`）                                                                     | 指示 4「CSS の文字列だけを変える」。今の DOM は箱 1 つに文字が直接入っていて、札を別の要素にできない。和文の注記（「（スクロール範囲）」など）は mono の書体の並びの後ろに和文の書体を足し、和文だけ UI の書体で出る                                                              |
| 回転のハンドル      | （README は丸を「保存済み」に使う）              | 四角の中に、開いた円弧と矢じりの記号                                                                                                                                   | 指示 3。丸の形そのものは使わない                                                                                                                                                                                                                                                  |

### 経過

- 最初の `ww-protect` は、箱ごとに `vermilion-wash`（12%）と斜線を敷いた。本物の YouTube で撮ると、重なった箱で動画がほぼ見えなくなった。wash をやめ、斜線を窓に固定して撮り直した（最終の画像）
- グループとロックの枠は、最初は破線の外に白い実線の縁を付けた。暗い星空の動画の上では白い実線しか見えず、選択枠（実線）と見分けられなかった。白い縁も破線（`outline`）にして撮り直した

## スクリーンショット（本物の YouTube、1920×1080、未ログイン）

`tests/page-marks-live.spec.ts`（`WW_LIVE_PAGE_MARKS=1`）で、変更前（`890d157` のビルド）と変更後を同じ手順で撮った。白い YouTube は `prefers-color-scheme: light`、ダークの YouTube は `PREF=f6=400` で作った。動画は検索の 1 件目を固定した（明るい：`5Vfni0QBn6Y` 30 秒、暗い：`B5unCXpegAw` 30 秒。画面の中央半分の平均の明るさは、明るい 124〜137、暗い 53〜55）。

| 撮ったもの                 | 白い YouTube                                                                                                                   | ダークの YouTube                                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| マウスを乗せた枠           | [前](screenshots/ui0c/before-light-skin-hover.png) / [後](screenshots/ui0c/after-light-skin-hover.png)                         | [前](screenshots/ui0c/before-dark-skin-hover.png) / [後](screenshots/ui0c/after-dark-skin-hover.png)                         |
| 未対応                     | [前](screenshots/ui0c/before-light-skin-unsupported.png) / [後](screenshots/ui0c/after-light-skin-unsupported.png)             | [前](screenshots/ui0c/before-dark-skin-unsupported.png) / [後](screenshots/ui0c/after-dark-skin-unsupported.png)             |
| 選んだ種類                 | [前](screenshots/ui0c/before-light-skin-siblings.png) / [後](screenshots/ui0c/after-light-skin-siblings.png)                   | [前](screenshots/ui0c/before-dark-skin-siblings.png) / [後](screenshots/ui0c/after-dark-skin-siblings.png)                   |
| 選んだ動画カード           | [前](screenshots/ui0c/before-light-card-selected.png) / [後](screenshots/ui0c/after-light-card-selected.png)                   | [前](screenshots/ui0c/before-dark-card-selected.png) / [後](screenshots/ui0c/after-dark-card-selected.png)                   |
| 同・240px スクロールのあと | [前](screenshots/ui0c/before-light-card-selected-scrolled.png) / [後](screenshots/ui0c/after-light-card-selected-scrolled.png) | [前](screenshots/ui0c/before-dark-card-selected-scrolled.png) / [後](screenshots/ui0c/after-dark-card-selected-scrolled.png) |
| Studioで編集中の札         | [前](screenshots/ui0c/before-light-studio-badge.png) / [後](screenshots/ui0c/after-light-studio-badge.png)                     | [前](screenshots/ui0c/before-dark-studio-badge.png) / [後](screenshots/ui0c/after-dark-studio-badge.png)                     |

| 撮ったもの（動画の上）   | 白い YouTube・明るい動画                                                                                                     | 白い YouTube・暗い動画                                                                                                   | ダークの YouTube・明るい動画                                                                                               | ダークの YouTube・暗い動画                                                                                             |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| レイヤーの選択とハンドル | [前](screenshots/ui0c/before-light-bright-layer-selected.png) / [後](screenshots/ui0c/after-light-bright-layer-selected.png) | [前](screenshots/ui0c/before-light-dark-layer-selected.png) / [後](screenshots/ui0c/after-light-dark-layer-selected.png) | [前](screenshots/ui0c/before-dark-bright-layer-selected.png) / [後](screenshots/ui0c/after-dark-bright-layer-selected.png) | [前](screenshots/ui0c/before-dark-dark-layer-selected.png) / [後](screenshots/ui0c/after-dark-dark-layer-selected.png) |
| グループ                 | [前](screenshots/ui0c/before-light-bright-layer-group.png) / [後](screenshots/ui0c/after-light-bright-layer-group.png)       | [前](screenshots/ui0c/before-light-dark-layer-group.png) / [後](screenshots/ui0c/after-light-dark-layer-group.png)       | [前](screenshots/ui0c/before-dark-bright-layer-group.png) / [後](screenshots/ui0c/after-dark-bright-layer-group.png)       | [前](screenshots/ui0c/before-dark-dark-layer-group.png) / [後](screenshots/ui0c/after-dark-dark-layer-group.png)       |
| ロック                   | [前](screenshots/ui0c/before-light-bright-layer-locked.png) / [後](screenshots/ui0c/after-light-bright-layer-locked.png)     | [前](screenshots/ui0c/before-light-dark-layer-locked.png) / [後](screenshots/ui0c/after-light-dark-layer-locked.png)     | [前](screenshots/ui0c/before-dark-bright-layer-locked.png) / [後](screenshots/ui0c/after-dark-bright-layer-locked.png)     | [前](screenshots/ui0c/before-dark-dark-layer-locked.png) / [後](screenshots/ui0c/after-dark-dark-layer-locked.png)     |
| スナップの線             | [前](screenshots/ui0c/before-light-bright-layer-snap.png) / [後](screenshots/ui0c/after-light-bright-layer-snap.png)         | [前](screenshots/ui0c/before-light-dark-layer-snap.png) / [後](screenshots/ui0c/after-light-dark-layer-snap.png)         | [前](screenshots/ui0c/before-dark-bright-layer-snap.png) / [後](screenshots/ui0c/after-dark-bright-layer-snap.png)         | [前](screenshots/ui0c/before-dark-dark-layer-snap.png) / [後](screenshots/ui0c/after-dark-dark-layer-snap.png)         |
| 守っている場所           | [前](screenshots/ui0c/before-light-bright-protect.png) / [後](screenshots/ui0c/after-light-bright-protect.png)               | [前](screenshots/ui0c/before-light-dark-protect.png) / [後](screenshots/ui0c/after-light-dark-protect.png)               | [前](screenshots/ui0c/before-dark-bright-protect.png) / [後](screenshots/ui0c/after-dark-bright-protect.png)               | [前](screenshots/ui0c/before-dark-dark-protect.png) / [後](screenshots/ui0c/after-dark-dark-protect.png)               |

目で見たこと：

- マウスを乗せた枠：白・ダークのどちらでも、四辺の G-pen と角の 4px のはみ出しが見える。中ほどは約 3px、端は細い。名札は cobalt の地に白い文字で読める
- 選んだ種類：他のカードに 1px の cobalt（50%）の線が出る。白の上ではっきり、ダークの上では薄いが見える
- 選んだ動画カード：240px スクロールしたあとも枠がカードに合っている
- レイヤー：選択枠・ハンドル・スナップの線は、明るい動画（雪）・暗い動画（星空）のどちらでも白い縁で読める。グループとロックは破線として読める（暗い動画の上では白い破線、明るい動画の上では cobalt・ink-muted の破線が主に見える）
- Studioで編集中の札：ダークの YouTube の上でも、surface の地と罫線のボタンで、紫の枠なしに読める
- 守っている場所：斜線の向こうに動画と選択枠が見える。名札は surface-raised の地で読める

## 操作

| 確かめたこと                                   | 方法                                                                                                                                                                                                                                                                                                                                                | 結果                                                                      |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 印の上をクリックしても本物の部品が押せる       | 模擬ページの e2e：枠の線の上・名札の下の点で `elementFromPoint` がカードの中を返す。入れ物・枠・名札・ShadowRoot の host の `pointer-events` が none。本物の YouTube：マウスを乗せた枠の上辺・下辺の点（カードの 70% の位置）でカードの中を返す（変更前・後、白・ダークとも）。右辺の点はエディターのパネルの下にあり、パネルが返る（変更前も同じ） | 押せる                                                                    |
| ハンドルの当たり判定                           | ボタンの箱は 14×14px のまま（e2e）。見える四角 12px は `::before`。本物の YouTube で、5 つのハンドルの箱が 14×14px、その中心で `elementFromPoint` がハンドルを返す（変更前・後、4 通りすべて）                                                                                                                                                      | 小さくなっていない                                                        |
| G1 の操作帯（上 64px・下 112px）の上のハンドル | CSS だけを変え、ハンドルの位置・大きさ・`pointer-events`・`clip-path` の扱いは変えていない。e2e の `operation-safety`・`operation-controls`・`layer-editor`・`signal-motion-editor` が通る                                                                                                                                                          | 扱いは変わっていない（帯の上での押し比べは本物の YouTube ではしていない） |
| 緊急OFFで印が消える                            | e2e：ポップアップの「緊急OFF」で、印の入れ物が隠れ、選んだ種類の outline が消え、エディターは残る。「描画を再開」で戻る。保護範囲の表示は Studio の「緊急OFF」で消える。Alt+Shift+Q は同じ保存値（`webWorldThemes.safety.emergencyOff`）を立てる（`editor-entry` の e2e がショートカットの割り当てを確かめている）                                  | 消える                                                                    |

## 計測

ページの上で動く処理（`skin-picker.ts` のマウスの追従、`controller.ts` の選んだカードの追従）を変えたので、本物の YouTube の検索結果で、変更前と変更後を 2 組、短く測った（`scripts/ui0c/marks.mjs`。拡張のコールバックの計測は `scripts/ui1/build.mjs` の isolated world のラッパー）。フルの交互計測はしていない（指示 3）。

| 場面                               | ビルド | 拡張 CPU/フレーム 中央値（組 1, 2） | p95（組 1, 2） | 一番長い拡張のコールバック | 50ms を超える長いタスク |
| ---------------------------------- | ------ | ----------------------------------- | -------------- | -------------------------- | ----------------------- |
| 着せ替えで部品の上を動かす（6 秒） | 変更前 | 0, 0 ms                             | 0.90, 0.80 ms  | 2.7, 1.8 ms                | 0, 0                    |
|                                    | 変更後 | 0, 0 ms                             | 0.60, 0.80 ms  | 1.8, 4.0 ms                | 0, 0                    |
| 動画カードを選んで 10 秒スクロール | 変更前 | 0, 0 ms                             | 0.90, 0.80 ms  | 8.4, 7.1 ms                | 0, 0                    |
|                                    | 変更後 | 0, 0 ms                             | 0.80, 0.80 ms  | 6.9, 7.2 ms                | 0, 0                    |

- 増えていない。プロファイルは取っていない（大きく増えなかったため）
- 中央値が 0 なのは、ほとんどのフレームで拡張のコールバックが動いていないため（計測の分解能は 0.1ms）
- 生データの要約：`docs/benchmarks/ui0c-marks.json`。ヘッドレスの Chromium なので、フレームは 60fps に揃っていない（10 秒で約 1460 フレーム）
- エディターを閉じているとき：模擬ページの e2e で、エディターを開いて印を出し、閉じたあとの「拡張の isolated world の document と window のリスナー」「`web-world-themes-` の要素」「style と link の数」「html の `data-ww` 属性」「`ww-` のクラスの数」が、開く前と同じことを確かめた（着せ替え・選んだカードの 2 通り）。印の入れ物は印を出すまで作らないので、エディターを開いたことのないページには何も足さない

## テスト

| 層                      | 件数・結果                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| unit                    | 402 件、全件成功                                                                                                                                                                                                                                                                                                                                                  |
| e2e（全件、引き渡し前） | 315 件（268 実行、47 件は `WW_LIVE_*` 未指定でスキップ）。268 件成功、失敗 0、16.1 分。そのあとグループとロックの枠の CSS だけを変え、`page-marks`・`layer-editor`・`group-editor` を回し直して 23 件成功                                                                                                                                                         |
| e2e（途中）             | `page-marks`・`skin-editor`・`creator-editor`・`studio`・`operation-controls`・`operation-safety`・`signal-motion-editor`（58 件成功）、`layer-editor`（12 件成功）                                                                                                                                                                                               |
| 実サイト                | `WW_LIVE_PAGE_MARKS=1` の `page-marks-live.spec.ts`（白・ダークの 2 件）を、変更前のビルドと変更後のビルドで最終 1 回ずつ。全項目 ok。途中で、明るい動画の再生エラー（Big Buck Bunny が「Something went wrong」）、動画の読み込み前のスクリーンショット（空の範囲）、YouTube のホバーのプレビューの video が点を取る、の 3 つで撮り直した。どれもテストの側の原因 |
| CI                      | `1caafdc`（run 41176751669）：unit と e2e の 4 分割、すべて成功                                                                                                                                                                                                                                                                                                   |

## 変えたテスト

| テスト                                                        | 変えたところ                                                   | 理由                                                                                          |
| ------------------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `tests/skin-editor.spec.ts`「skin tool: hover names parts …」 | 選んだ種類の他のカードの `outline-style` を `dashed` → `solid` | 指示どおり、選んだ種類の線を 1px の実線にしたため。「全部のカードに線が出る」という判定は同じ |

`#web-world-themes-skin-hover` を見ている既存の判定（`toBeVisible`・`toContainText('動画カード')`・`toContainText('未対応')` など）は、同じ id を ShadowRoot の中の要素に付けたので、変えずに通っている。

足したテスト：

- `tests/page-marks.spec.ts`（e2e 4 件）：着せ替えの印（入れ物 1 つ・open の ShadowRoot・枠の位置＝部品＋4px・名札の位置と色・pointer-events・押せる・同じ部品の上で描き直さない・未対応・選んだ種類の outline・緊急OFFと再開・閉じたあとの足跡が開く前と同じ）／選んだ動画カード（枠・スクロールと大きさの変化への追従・リスナーが編集中だけ・動かないあいだ変化 0・閉じたあとの足跡）／レイヤーの選択（1px の cobalt・ハンドルの箱 14px・見える四角 12px・回転だけ記号）／守っている場所（斜線・罫線・mono・名札の地・緊急OFFで消える）
- `tests/page-marks-live.spec.ts`（実サイト、`WW_LIVE_PAGE_MARKS=1`）：スクリーンショットと、押せるか・ハンドルの箱の記録

## 未確認の点・気になっている点

- グループとロックの破線は、`border` の cobalt の破線と `outline` の白い破線の目がそろっていない。破線としては読める（「見た目が少しずれる×いつも」なので記録だけ）
- 保護範囲の表示では、YouTube のスクロール範囲の箱が 30 個近く重なり、上端の名札が重なって読めない（変更前も同じ。描く場所の処理は変えない指示のため、今回は触っていない）
- 「選んだ種類」の outline は、ダークの YouTube の上では 50% の cobalt が薄い（1px・50% は指示の値）
- 名札が窓の下端で上に回るとき、上のカードの絵に重なる（pointer-events は none なので押せる）
- G1 の操作帯の上でハンドルを実際に押し比べることは、本物の YouTube ではしていない（CSS だけの変更のため）
- Alt+Shift+Q を本物のキー入力で押す確認はしていない（ポップアップ・Studio の「緊急OFF」ボタンと同じ保存値を使う）
- 明るい動画の明るさは 124〜137（0〜255）。真っ白な画面ではない

## 次の担当への引き継ぎ（UI0-d）

- ページの上の印の値は 3 か所にある：`src/editor/page-marks.css`（mark・tag・unsupported）、`src/renderers/dom/scene.ts` の `CSS` の先頭の `:host`（レイヤーの選択）、`src/host/operation-guard.ts` の CSS の文字列（protect）。どれも Gesso の値の固定。トークンを変えるときは 3 か所を合わせる
- `skin-picker.ts` の `css()` の outline の色（`rgb(43 81 184 / 0.5)`）も同じ cobalt
- `createSkinPicker` の引数が変わった（`marks` が 3 番目）
- 選んだ部品の追従は `controller.ts` の `follow`。リスナーを足すときは、`follow(undefined)` で外れることを e2e（`page-marks.spec.ts` の足跡の比較）で確かめる
- 危ないと思う箇所：`operation-guard.ts` の `::first-line` の名札は、DOM が箱 1 つに文字だけ、という前提に乗っている。DOM を変えるなら、名札を別の要素にして `ww-protect__label` にするのがよい
