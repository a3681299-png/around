# UI0-a：浮かぶエディターをデザインシステムに合わせる

ページの上に浮かぶエディター（`src/editor/panel.ts` の Shadow DOM。ポップアップの「エディターを開く」で出るもの）の見た目を、`docs/wwt-studio-design-system/` に合わせた。ボタンの文言・DOM の形・操作は変えていない（例外は下の「README と違う判断」の 1 か所の文言）。

## 変更点と理由

| ファイル                                                                | 変更                                                                                                                                                                                                                                          | 理由                                                                                                                             |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `src/editor/studio-tokens.css`（新規）                                  | `tokens.css` の色・大きさ・角丸・書体と、`bundle.css` のうち使うもの（`--ww-frame`、G-pen の形 `--ww-pen-h`、`ww-stroke`・`ww-appear` のキーフレーム）を、すべて `:host` に宣言。ライト（Gesso）は `prefers-color-scheme: light` で切り替える | Shadow DOM の外（YouTube のページ）へ色・クラス・キーフレームの名前を出さないため。`:root` と `.ww-*` のクラスは持ち込んでいない |
| `src/editor/panel.css`                                                  | 全面的に書き直し。下の「部品の対応」の決まりで、色はすべてトークン、大きさは 4・8・12・20・32・52・84・136、文字は 13/20・見出し 20/32・数値とラベルは mono 12/20                                                                             | 紫（#baa0f8 など）・グラデーション（サムネイルの市松）・ボタンや選択の影をなくし、アクセントを cobalt だけにした                 |
| `src/editor/skin-panel.css`                                             | 同じ決まりで書き直し。部品の状態は「言葉＋形」（適用済み＝塗りの丸、見つからない・読み込み中・エラー＝三角、なし＝小さな点）。スライスの案内線は 1px の cobalt の定規線                                                                       | README の「状態は言葉と形。色だけにしない」「赤はエンジンの保護だけ」                                                            |
| `src/editor/panel.ts`                                                   | 浮かぶエディターだけ `studio-tokens.css＋panel.css` を使い、Studio の作業台（ウィンドウ・サイドパネル・ページ内 Studio）は従来のスタイルを使う                                                                                                | 下の「Studio 系を旧スタイルのままにした理由」                                                                                    |
| `src/studio/editor-base.css`・`src/studio/editor-skin-base.css`（新規） | 変更前の `panel.css`・`skin-panel.css` の複製（先頭に説明の注釈だけ追加）                                                                                                                                                                     | 同上。UI0-b で Studio を移すときに消す                                                                                           |
| `src/editor/skin-panel.ts`                                              | 案内文の「紫の線」→「青い線」                                                                                                                                                                                                                 | 線の色を cobalt にしたため。文言の変更はこの 1 か所だけ                                                                          |
| `tests/editor-ux.spec.ts`                                               | 左に寄せたときの位置の期待値を 14 → 20                                                                                                                                                                                                        | README の「ページの端から space-20」に合わせた。判定の厳しさは同じ（`toBe`）                                                     |

### 部品の対応

DOM にクラスは足していない。既存の要素に、デザインシステムの部品の決まりを当てた。

| 部品                                           | 当てた要素                                                                                                                                                                                       |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ww-panel--float`                              | `:host`（角丸 8、内側 4、`surface-raised`、`shadow-float`）。中の帯・本体・フッターは角丸 4                                                                                                      |
| `ww-btn` / `--primary` / `--ghost` / `--dense` | すべての `button`（1px の `line-control` の縁、角丸 4、高さ 32）。主ボタンは「保存」だけ。「すべて選択」「選択解除」「パネルを左へ」「表示設定」「元に戻す」「やり直す」「並べる」は dense（20） |
| `ww-icon-btn`                                  | `.icon-button`（操作ツール・素材追加）と「−」「×」。押されたツールは cobalt の文字と `cobalt-wash`                                                                                               |
| `ww-tabs` / `ww-tab`                           | `[role=tab]`（作業領域のタブ、着せ替えの状態タブ）。選ばれたタブは太字と G-pen の線（84px、4 コマで描く）                                                                                        |
| `ww-field` / `ww-input`                        | `input[type=text                                                                                                                                                                                 | number]`・`select`（`surface-sunk`、`line-control` の縁、高さ 32）。数値は mono・右寄せ・等幅数字 |
| `ww-check` / `ww-toggle`                       | チェックボックスは 12px の `ww-check`。スナップだけはすぐ効く設定なので `ww-toggle`（32×20、つまみは 3 コマ）                                                                                    |
| `ww-swatch`                                    | `input[type=color]`（52×32、平らな色）                                                                                                                                                           |
| `ww-chip--saved` / `--dirty`                   | `.dirty`（保存済み＝塗りの丸、未保存＝破線の丸）。ヘッダーの 2 行目の右端に置き、画面で 1 か所だけにした                                                                                         |
| `ww-row`                                       | `.layer`（行は定規線で区切る。選択は 1px の cobalt の縁と `cobalt-wash`）                                                                                                                        |
| `ww-part`                                      | `.skin-part`                                                                                                                                                                                     |
| `ww-eyebrow`                                   | `.eyebrow`（mono 12、大文字）                                                                                                                                                                    |

### 書体

- ネットワークから書体を読まない。同梱もしない。Chrome の権限は増やしていない。
- UI は `'BIZ UDPGothic', 'Hiragino Sans', 'Yu Gothic UI', 'Meiryo UI', 'Noto Sans JP', system-ui, sans-serif`。等幅は `'IBM Plex Mono', ui-monospace, 'SFMono-Regular', 'Cascadia Mono', Consolas, monospace`（Plex Mono は入っている PC でだけ使われる）。
- 実際に描かれた書体を CDP（`CSS.getPlatformFontsForNode`）で確かめた：見出しは `BIZ UDPGothic Bold`（`isCustomFont: false`＝PC に入っている書体）、英字の見出しは `Cascadia Mono`。

## README と違う判断

| 項目                   | README                                                     | この段階の判断                                                                                                                                                                                                                          | 理由                                                                                                                                                                                                                                                                                               |
| ---------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `local()` での読み込み | 指示は「BIZ UDPGothic は `local()` で読む」                | `@font-face { src: local() }` は使わず、書体名で PC の書体に一致させる                                                                                                                                                                  | 最初は Shadow DOM の中に `@font-face … local('BIZ UDPGothic')` を置いたが、Chrome は shadow root の中の `@font-face` を使わなかった（上の CDP の結果が `isCustomFont: false`）。ページ側に置くと書体の名前がページへ漏れる。書体名での一致も「PC に入っている書体だけを使う」点は `local()` と同じ |
| 影                     | 指示は「影は消す」。README は浮かぶパネルに `shadow-float` | 浮かぶパネル（`:host`）と右クリックメニューにだけ `shadow-float` を残した。ほかの影（ボタンの光、選択の内側の影、スライス線の縁取り）はすべて消した                                                                                     | README の float の決まり。YouTube の上で、パネルの縁がページの絵と混ざらないようにするため                                                                                                                                                                                                         |
| パネルの幅             | 340                                                        | 360（変更なし）                                                                                                                                                                                                                         | 幅は `workspace.ts` が 320〜520 を 20 刻みで決める操作。TS と操作は UI0-a の範囲外                                                                                                                                                                                                                 |
| 位置                   | ページの端から space-20                                    | 左右は 20。上は 76（YouTube の上の帯 56＋20）、高さは `100dvh − 96`。狭い画面（740 以下）は 12                                                                                                                                          | 上の位置はページの形から決まる値                                                                                                                                                                                                                                                                   |
| ヘッダー               | 高さ `control`（32）の 1 行                                | 32＋20 の 2 行。1 行目に WORLD CREATOR・見出し・折りたたむ・終了、2 行目に「パネルを左へ」「表示設定」と保存のチップ                                                                                                                    | 見出しを 20/32 にすると 1 行に入らない。保存のチップは README のとおりヘッダーに置いた（DOM は `.toolbar` の中のまま、位置だけ移した）                                                                                                                                                             |
| 押されたツール         | 色だけ（`ww-rail` では G-pen の円も）                      | cobalt の文字に `cobalt-wash` の塗りも足した                                                                                                                                                                                            | G-pen の円（`ww-rail`）は UI0-b。円がない間、色だけだと選択が弱いため。「選択の背後は `cobalt-wash`」の決まりの範囲                                                                                                                                                                                |
| エラーの表示           | 赤はエンジンの保護だけ                                     | 保存失敗・入力エラー・着せ替えの読み込みエラーは `lamp-amber`（助言の三角）                                                                                                                                                             | 赤（`vermilion`）を使えないため。「保存失敗」は助言ではないので、意味の割り当ては UI0-b で決めたい                                                                                                                                                                                                 |
| 「グループ化」ボタン   | 主ボタンはパネルに 1 つ                                    | 有効なときの紫の塗りをやめ、普通のボタンにした                                                                                                                                                                                          | 「保存」と主ボタンが 2 つになるため                                                                                                                                                                                                                                                                |
| ライトとダークの切替   | Payne's grey が既定、Gesso                                 | `prefers-color-scheme` に従う                                                                                                                                                                                                           | エディターにテーマの設定がない。YouTube のテーマ（`html[dark]`）とは連動しない                                                                                                                                                                                                                     |
| 文言                   | —                                                          | 「紫の線をドラッグして」→「青い線をドラッグして」                                                                                                                                                                                       | 線の色を cobalt にしたので、そのままだと誤り。`controller.ts` の「紫の枠が出る部品」はページ上の印（範囲外、紫のまま）なので変えていない                                                                                                                                                           |
| 尺度にない値           | 4・8・12・20・32・52・84・136 だけ                         | アイコン 16（README のアイコンの決まり）、フォーカスと並び替えの線 2、G-pen の線の高さ 3、チェックの印 6×3（`bundle.css` のまま）、つまみ 12 と余白 3（同）、スライス線のつかみ幅 20 の中心 10、ページの形から決まる 76・96・40・24・64 | 線の太さや部品の内側の形は、尺度の「大きさ」とは別に README・`bundle.css` が決めている値                                                                                                                                                                                                           |

### Studio 系を旧スタイルのままにした理由

`panel.css` は浮かぶエディターだけでなく、Studio の作業台（`studio/workbench.ts`：Studio のウィンドウ・サイドパネル・ページ内 Studio・ページのツールバー）の土台にもなっていた。書き直した `panel.css` をそのまま共有すると、ページ内 Studio で `.editor-body` の新しい背景がキャンバスを覆い、YouTube が見えなくなった（`docs/screenshots/ui0a/` には直したあとの画像だけを置いた）。Studio は UI0-a の範囲外なので、作業台では変更前のスタイル（`src/studio/editor-base.css`・`editor-skin-base.css`）を使い、変更前と同じ見た目であることをページ内 Studio のスクリーンショットで確かめた。

## スクリーンショット（本物の YouTube、1366×900）

ダーク（Payne's grey）とライト（Gesso）。ライトは Chromium の `colorScheme: 'light'`。

| 場面                                                  | 変更前                                                                  | 変更後                                                                |
| ----------------------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 開いた直後・ダーク                                    | [before-dark](screenshots/ui0a/before-dark.png)                         | [after-dark](screenshots/ui0a/after-dark.png)                         |
| 開いた直後・ライト                                    | [before-light](screenshots/ui0a/before-light.png)                       | [after-light](screenshots/ui0a/after-light.png)                       |
| 画像 2 枚・レイヤー・ダーク                           | [before-dark-layers](screenshots/ui0a/before-dark-layers.png)           | [after-dark-layers](screenshots/ui0a/after-dark-layers.png)           |
| 画像 2 枚・レイヤー・ライト                           | [before-light-layers](screenshots/ui0a/before-light-layers.png)         | [after-light-layers](screenshots/ui0a/after-light-layers.png)         |
| プロパティ・ダーク                                    | [before-dark-properties](screenshots/ui0a/before-dark-properties.png)   | [after-dark-properties](screenshots/ui0a/after-dark-properties.png)   |
| プロパティ・ライト                                    | [before-light-properties](screenshots/ui0a/before-light-properties.png) | [after-light-properties](screenshots/ui0a/after-light-properties.png) |
| UI の着せ替え・ダーク                                 | [before-dark-skin](screenshots/ui0a/before-dark-skin.png)               | [after-dark-skin](screenshots/ui0a/after-dark-skin.png)               |
| UI の着せ替え・ライト                                 | [before-light-skin](screenshots/ui0a/before-light-skin.png)             | [after-light-skin](screenshots/ui0a/after-light-skin.png)             |
| 1100×760（e2e と同じ大きさ）・レイヤー                | [before](screenshots/ui0a/before-dark-layers-1100x760.png)              | [after](screenshots/ui0a/after-dark-layers-1100x760.png)              |
| ページ内 Studio（範囲外・変わらないことの確認）ダーク | [before](screenshots/ui0a/studio-inpage-before-dark.png)                | [after](screenshots/ui0a/studio-inpage-after-dark.png)                |
| ページ内 Studio ライト                                | [before](screenshots/ui0a/studio-inpage-before-light.png)               | [after](screenshots/ui0a/studio-inpage-after-light.png)               |

ページ上の選択の枠（紫）は `controller.ts` の印で、範囲外のため変わっていない。撮影に使ったスクリプトはリポジトリに入れていない（`.work/ui0a/capture.mjs`）。

## コントラスト

エディターの中の、見えていて有効な文字（見出し・ボタン・ラベル・ヒント・タブ・状態・保存のチップなど）の文字色と背景色の比。開いた直後・画像 2 枚・プロパティ・着せ替えの 4 場面で測った。

| テーマ | 最小   | どこ                                                                           | 変更前の最小                    |
| ------ | ------ | ------------------------------------------------------------------------------ | ------------------------------- |
| ダーク | 6.22:1 | `ink-muted`（WORLD CREATOR、ヒント、dense ボタン）                             | 7.07:1（ただし 9〜11px の文字） |
| ライト | 5.13:1 | `ink-muted` の「×」（ガイドを閉じる、`surface-sunk` の上）と選ばれていないタブ | 7.07:1                          |

主ボタン（`on-cobalt` on `cobalt`）はダーク 7.35:1、ライト 7.07:1。すべて 4.5:1 以上。変更前より比は下がったが、文字は 9〜11px から 12〜13px に上がった。

## 計測

交互計測はしていない。ページの上で動く処理（content script の動き・`src/sites/`・`src/world/`・`src/host/`・描画）を変えていないため。変えたのはエディターの Shadow DOM の中の CSS と、どの CSS を入れるかの分岐だけ。content script のファイルは CSS の文字列が増えて 3,044,345 → 3,078,896 バイト（+34.5KB、+1.1%）。

## テスト

| 種類        | 件数                                                                                                                                          | 結果                                                                                                                                                                    |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| unit        | 400                                                                                                                                           | 全件成功                                                                                                                                                                |
| e2e（途中） | `creator-editor`・`editor-ux`・`editor-entry`・`layer-editor`・`skin-editor`・`side-panel` の 42 件                                           | 最初は 4 件失敗。直したあと失敗した 2 ファイル（18 件）を回し直して全件成功（下の「途中で見つけた不具合」）                                                             |
| e2e（全件） | 307 件（262 実行、45 件は `WW_LIVE_*` 未指定でスキップ）。17.7 分                                                                             | 262 件成功、失敗 0。そのあと使われていなかった `@font-face` を消して再ビルドし、`creator-editor`・`editor-ux`・`skin-editor` の 17 件と unit 400 件を回し直して全件成功 |
| 実サイト    | `WW_LIVE_*` の spec は回していない。本物の YouTube でのスクリーンショット撮影（ダーク・ライト×4 場面、1100×760、ページ内 Studio）を手で行った | 崩れなし                                                                                                                                                                |
| lint        | `npm run lint`                                                                                                                                | 成功                                                                                                                                                                    |
| CI          | —                                                                                                                                             | コミット・push していないため未実行                                                                                                                                     |

### 途中で見つけた不具合

- 文字を 12〜13px・行の高さ 20 に上げ、ボタンを 32 にしたことで、1100×760 でレイヤー一覧の高さが 0 になり、行がフッターの下に隠れて押せなくなった（e2e 4 件の失敗。操作が破綻する種類）。ヘッダーを 2 行にまとめ、保存のチップをヘッダーへ移してツールバーを 1 行にし、帯の余白を 12 → 8 に詰め、レイヤー行の上下の余白をなくした。一覧の高さは 65px（変更前 68px）、行の高さは 42px（変更前 48px）で、変更前と同じく 1.5 行ほど見える。
- 押されたツールにマウスが乗っていると、hover の色が cobalt を上書きしていた。押された状態を優先するようにした。
- 左に寄せたときの位置の e2e は、14 → 20 を README に合わせた変更として期待値を直した。

## 未確認の点・気になっている点

- Studio のウィンドウとサイドパネルは撮影していない。旧スタイルの複製を使うので変わらないはずで、ページ内 Studio は変更前後で同じことを画像で確かめた。
- 狭い画面（幅 740 以下）と低い画面（高さ 630 以下）の見た目は撮っていない（e2e の 430×650 の確認は通っている）。
- `prefers-reduced-motion` で動かないことは CSS で止めているだけで、実機で確かめていない。
- 1100×760 ではレイヤー一覧が 1.5 行分しかない（変更前と同程度）。13/20 の文字のままさらに広げるには、ガイドや選択の帯の構成を変える必要がある（UI0-b）。
- 着せ替えのスライス画面（絵を取り込んだあと）は撮っていない。`skin-editor` の e2e（線のドラッグ）は通っている。
- ライトは OS・ブラウザの設定に従う。YouTube をダークで見ていても、OS がライトならエディターはライトになる。

## 次の段階に回す部品（UI0-b 以降）

- `ww-rail` の G-pen の円（押されたツール）、`ww-construct`（開くときの描き込み）、`ww-empty`（空の状態の作図と方眼）
- ページの上の印：`ww-mark`・`ww-tag`・`ww-unsupported`・`ww-protect`（`controller.ts` の紫の点線 #695089 の置き換え）
- `ww-scrub`（数値欄の軸の文字。いまは「X」「Y」が UI の書体）、`ww-segs`、`ww-notice`・`ww-chip--limited`（制限中）
- 「−」「×」の文字の記号をアイコンにする。アイコンを 14px の作図の決まりで描き直す
- DOM に `ww-*` のクラスを付けて、部品として共有する（いまは既存のクラスに決まりを当てただけ）
- パネルの幅 340（`workspace.ts` の幅の操作）
- Studio の作業台（ウィンドウ・サイドパネル・ページ内 Studio）を移し、`src/studio/editor-base.css`・`editor-skin-base.css` を消す
- エラーの意味の割り当て（保存失敗を何色・何の形で出すか）、YouTube のテーマとの連動

## 次の担当への引き継ぎ

- `panel.css` は浮かぶエディター専用になった。Studio の見た目を直すときは `src/studio/editor-base.css` か `workbench.css` を見る。`panel.ts` の `workbench` の分岐を忘れると、片方だけ直したつもりになる。
- 保存のチップ（`.dirty`）は `.toolbar` の中にあるが、`main` を基準に `top: 32px` でヘッダーの 2 行目へ置いている。ヘッダーの 1 行目の高さ（32）を変えるときは一緒に直す。
- 縦の余白は 1100×760 でレイヤー一覧が押せるぎりぎり。行や帯を足すときは `editor-ux.spec.ts` の「group reasons …」を回す（一覧が狭いと最初に落ちる）。
