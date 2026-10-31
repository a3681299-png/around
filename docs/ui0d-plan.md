# UI0-d の計画：エディターをサイドパネルと別ウィンドウの 2 つにする

この段（0 段目）では、コードは変えずに調べて計画を出した。対象のコミットは `4b18642`。

エディターの形は今 4 つある。

| 形                    | 開き方                                                                                                                                                                                    | 作り                                                                                                                                                                                                           | 印  |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| 浮かぶエディター      | ポップアップ「デザインを編集（実験）」（`#creator-editor-open`）→ `OPEN_CREATOR_EDITOR`                                                                                                   | content script の `controller.ts` が `open('quick')` で `createCreatorPanel` を YouTube の中に置く。`workspace.ts`（340px・タブ）＋ `panel.css`（デザインシステム）                                            | F   |
| ページの中の Studio   | ポップアップ「従来のインページStudio（切り戻し）」（`#creator-studio-inpage`）、作業台の「従来のインページStudioへ切替」→ `OPEN_INPAGE_STUDIO`                                            | `open('inpage')`。`createStudioWorkbench`（`inPage`）を YouTube の中に置き、`site.mountStudio`（`youtube-studio.ts`）が YouTube を縮めて作業台の場所を空ける                                                   | I   |
| サイドパネル          | 拡張のアイコン（制作モード ON のとき）、Alt+Shift+E、ポップアップ「エディターを開く」（`#creator-editor-direct`）・「Studioを開く（Chromeサイドパネル）」、表示設定の「エディターを開く」 | 拡張のページ `studio/index.html?surface=sidepanel&target=<tab>` の `mountStudio`（`app.ts`、`fullPage`＋`sidePanel`）。ページの側には `open('sidepanel')` で「道具の帯」（`toolbarOnly`）が YouTube の中に出る | S   |
| 別ウィンドウの Studio | ポップアップ「Studioを開く（別ウィンドウ）」、作業台の「独立Studioへ切替」、サイドパネルを開けないときのアイコン                                                                          | `studio/index.html?target=<tab>` を `chrome.windows.create`（popup）。`mountStudio`（`fullPage`）                                                                                                              | W   |

S と W は `StudioRequest`（`src/studio/protocol.ts`）でページの `controller.ts` を動かす。F と I は同じ `controller.ts` を直接呼ぶ。編集の本体（`editor-core` の履歴・保存・検証）は 4 つで同じ。

## 1. F と I にしかない機能

`panel.ts`・`controller.ts`・`workspace.ts`・`workbench.ts`・`app.ts`・`skin-panel.ts`・`layer-tree.ts` の `inPage` / `fullPage` / `sidePanel` / `toolbarOnly` / `skin` / `floating` / `persistWorkspace` の分岐と、`controller.ts` の `panelMode`（`quick` / `inpage` / `sidepanel`）を全部たどった。

### 機能（作品や操作に効くもの）

| #   | 機能                                                                                                      | ある形                                               | S・W に無い理由                                                                                                                                                                                                                                                        |
| --- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | UI の着せ替えの道具（「UIを着せ替え」、`U` キー）                                                         | F・I                                                 | `controller.ts` が `options.skin` を `mode !== 'sidepanel'` のときだけ渡す。`app.ts` は渡していない。道具の一覧（`panel.ts:201`）に出ない                                                                                                                              |
| 1a  | 着せ替えの部品の一覧と、ページの上の個数・大きさ・文字までの余白・絵の状態・文字色の判定（`setSkinPage`） | F・I                                                 | `scheduleSkinInfo` が `panel` のある（ページの中にパネルがある）ときだけ動く。protocol に載っていない                                                                                                                                                                  |
| 1b  | 着せ替えの絵の取り込み（枠ごとの差し込み口、`core.importSkin(files, slot)`）                              | F・I                                                 | protocol の `import-assets` は画像レイヤーの取り込み（`core.import`）だけ。差し込み口（`slot`）を運べない                                                                                                                                                              |
| 1c  | 着せ替えの絵のプレビュー（パネルの中の 9 スライスの図）                                                   | F・I                                                 | `skinAssets.url` がページの側の blob URL を返す。拡張のページからは読めない                                                                                                                                                                                            |
| 1d  | パネルの差し込み口へのドロップ                                                                            | F・I                                                 | パネルがページの中にあるときだけ、`onDrop` が `data-skin-slot` を見つける                                                                                                                                                                                              |
| 2   | 動画カードを「どの道具でも」クリックで選べる                                                              | F（と、パネルを開かずに W だけがつながっているとき） | `pickTarget` は `panelMode === 'quick'` のとき、`browse` 以外のどの道具でも選ぶ。S（`panelMode === 'sidepanel'`）は「動画カードを編集」の道具のときだけ。W だけがつながっているときは `panelMode` が既定の `quick` のままなので F と同じ動き（たまたまそうなっている） |
| 3   | YouTube を縮めて作業台の場所を空ける（`mountYouTubeStudio`）                                              | I                                                    | ページの中にしか作業台がない                                                                                                                                                                                                                                           |
| 4   | 表示設定をページの中の設定パネル（settings.exe）で開く                                                    | F                                                    | S・W はポップアップの窓を開く（`studio-page.ts` の `openSettings`）                                                                                                                                                                                                    |

### 見せ方（作品には効かないが、F にしかないもの）

| #   | 見せ方                                                                                                                                                   | ある形 | 備考                                                                                                              |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------- |
| 5   | WWT Studio デザインシステム（UI0-a・b）：トークン、16px の線のアイコン（`glyph`）、G-pen の道具の印、保存のチップ 1 か所、空の状態の作図、`ww-construct` | F だけ | S・W・I は UI0-a より前の `studio/editor-base.css`・`editor-skin-base.css`（UI0-a で作った複製）と 24px の `icon` |
| 6   | 「はじめての制作」ガイドと、低い窓（800px 以下）で見出しだけにたたむ                                                                                     | F      | 作業台は「使い方」のダイアログ                                                                                    |
| 7   | パネルを折りたたむ・左右に寄せる・幅を変える                                                                                                             | F      | 作業台は左右のペインの開閉と仕切り                                                                                |

### 逆に、S・W にしかないもの（1 本化で F の利用者にも届く）

Signal Timeline（`toolbarOnly` 以外）、素材ライブラリ（W）、緊急OFF・保護範囲の表示・停止キーの操作（`mountSafety`）、編集対象のタブの選択と再接続、接続復旧用の保持（`studio-recovery`）。

### ページの側に残るもの（形によらず動く。移さなくてよい）

`controller.ts` の次の処理は、パネルがどこにあっても `editing()`（`state.active && (panel || remoteOwner)`）で動く。S・W でもそのまま使える。

- ページの上の印（UI0-c）、カードと部品のクリックでの選択、ページへのファイルのドロップ（ドロップした点に置く）、ページにフォーカスがあるときのキー操作（Ctrl+Z など）、着せ替えの道具のときの部品の印と強制プレビュー（`picker`）、レイヤーのドラッグ（`editImages`）
- 「Studioで編集中」の札：パネルがページの中に無く、S・W がつながっているときに出る

## 2. 移し方

すべて、今ある 2 本の道（`StudioRequest` の port と、素材の転送 `studio-transfer`）に足すだけでできる。**Chrome の権限は増やさない**（今の `storage`・`sidePanel` のまま）。

| #    | 移し方                                                                                                                                                                   | どこに何を足すか                                                                                                                                                                                                                                                                                  | 権限 |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| 1    | `app.ts` で `createCreatorPanel` に `skin`（`targets`・`assetUrl`・`import`）を渡す。`targets` は `StudioTarget.targets`（もう送っている）から `skin` の付いたものを選ぶ | `app.ts`                                                                                                                                                                                                                                                                                          | 不要 |
| 1a   | ページの側で、パネルの有無ではなく「着せ替えの道具を使っているか」で `pageInfo` を作る（250ms の間引きはそのまま）。結果を state の通知に載せる                          | `controller.ts` の `scheduleSkinInfo` の `panel` の条件を外す。`EditorSnapshot` か `StudioStatePayload` に `skinPage?: SkinPageInfo[]` を足し、`state-sync.ts` の差分に入れる。`studio-client` から `panel.setSkinPage` を呼ぶ                                                                    | 不要 |
| 1b   | 絵は今の `import-assets` と同じく、拡張のページから背景へ転送して素材 ID にし、ID と差し込み口を送る                                                                     | `protocol.ts` に `{ type: 'import-skin'; session; revision; asset: string; slot: SkinSlot }` を足す（または `import-assets` に `slot?` を足す）。`studio-host.ts` で `editor.importSkin(...)`。`CreatorEditor` に `importSkin` を出す。検証は `validation.spec`・`message-validation.spec` に足す | 不要 |
| 1c   | プレビューは、拡張のページが素材の保管庫から直接読む（`assets/client` の `loadAsset` は拡張のページでも使える。`skinAssetPort.load` を拡張のページで作る）               | `app.ts` の `assetUrl` に、拡張のページ側の `skinAssetPort.load` を渡す                                                                                                                                                                                                                           | 不要 |
| 1d   | 差し込み口へのドロップは、パネルのある拡張のページの中のドロップになる。`app.ts` の `drop` で `data-skin-slot` を見て 1b を呼ぶ                                          | `app.ts`                                                                                                                                                                                                                                                                                          | 不要 |
| 2    | カードの選び方を 1 つに決める（下の「決めてほしいこと」2）                                                                                                               | `controller.ts` の `pickTarget` と `refresh` の `data-ww-editor-card-picking`                                                                                                                                                                                                                     | 不要 |
| 3    | やめる。S は Chrome が YouTube の幅を縮める。W は別の窓                                                                                                                  | —                                                                                                                                                                                                                                                                                                 | —    |
| 4    | S・W の「表示設定」は今のまま（ポップアップの窓）。ページの中の設定パネル（settings.exe）は表示設定として残す                                                            | —                                                                                                                                                                                                                                                                                                 | —    |
| 5〜7 | 作業台にデザインシステムを入れる（下の「決めてほしいこと」1）                                                                                                            | `workbench.ts`・`workbench.css`・`panel.ts`                                                                                                                                                                                                                                                       | 不要 |

## 3. 入り口

| 入り口                                                                  | 今開くもの          | 1 本化のあと                         |
| ----------------------------------------------------------------------- | ------------------- | ------------------------------------ |
| 拡張のアイコン（制作モード ON）                                         | S（開けなければ W） | 変えない                             |
| 拡張のアイコン（制作モード OFF）                                        | ポップアップ        | 変えない                             |
| Alt+Shift+E（`open-editor`）                                            | S（開けなければ W） | 変えない                             |
| Alt+Shift+Q（`emergency-off`）                                          | 緊急OFF             | 変えない                             |
| ポップアップ「エディターを開く」（`#creator-editor-direct`）            | S                   | 変えない（主の入り口）               |
| ポップアップ「Studioを開く（Chromeサイドパネル）」                      | S                   | 「エディターを開く」と同じなので消す |
| ポップアップ「Studioを開く（別ウィンドウ）」                            | W                   | 「別ウィンドウで開く」として残す     |
| ポップアップ「従来のインページStudio（切り戻し）」                      | I                   | 消す                                 |
| ポップアップ「デザインを編集（実験）」（`#creator-editor-open`）        | F                   | 消す                                 |
| 表示設定（ページの中）の「エディターを開く」                            | S                   | 変えない                             |
| 作業台の「Chromeサイドパネルを開く」「独立Studioへ切替」                | S・W                | 残す（S ⇄ W の行き来）               |
| 作業台の「従来のインページStudioへ切替」、W の「YouTubeでStudioを開く」 | I                   | 消す                                 |

## 4. テストの移し替え

### 数

`tests/` の各テストが、入り口の印にたどり着くか（直接、またはファイルの中と `tests/helpers/` の関数を通して）で数えた（`.work/ui0d-count.mjs`。関数を通した数え方なので、少し多めに出る）。

| 開く形                                           | spec | テスト | うち実サイト（`WW_LIVE_*`） |
| ------------------------------------------------ | ---- | ------ | --------------------------- |
| F（`#creator-editor-open`）                      | 35   | 127    | 11                          |
| I（`#creator-studio-inpage`）                    | 15   | 30     | 6                           |
| W（`studio/index.html`、`#creator-studio-open`） | 15   | 25     | 6                           |
| S（`surface=sidepanel`）                         | 11   | 22     | 5                           |

F は、レイヤー・グループ・画像・アニメーション・3D・効果・着せ替え・G1（`operation-safety` の 10 件）・バックアップ・ページの印の、ほぼすべての機能の e2e の入り口になっている。

### Studio の窓を headless のタブで動かせるか（確かめた）

使い捨ての spec（コミットしていない）で、模擬の YouTube と同じ拡張の中で確かめた。

| 開き方                                                                           | 結果                                                                                                                                                                                                                                               |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W：`studio/index.html?target=<tab>` を、ふつうのタブ（headless、幅 400px）で開く | **動く**。接続、画像の取り込み（素材の転送）、元に戻す、YouTube の側でのカードのクリックでの選択、までできた。`studio.spec.ts`（9 件）と `operation-controls.spec.ts` も、もとから W を headless で開いて操作している                              |
| S：`studio/index.html?surface=sidepanel&target=<tab>` をふつうのタブで開く       | **素材の取り込みが通らない**。背景（`background/index.ts` の `owner`）が `chrome.runtime.getContexts({ contextTypes: [SIDE_PANEL] })` で「本当のサイドパネルか」を確かめ、「サイドパネルが見つかりません」で断る。安全のための確認なので、弱めない |

幅 400px の W は、左右のペインが閉じた「ステージ」の並び方になり、S の並び方（1 列）にはならない。S と W の並び方は、今は `?surface=sidepanel`（＝安全の確認と同じ値）で切り替えている。

### 書き直しの案

- 共通の入り口を 1 つ作る：`tests/helpers/editor.ts` の `openEditor(context, popup, youtube, { width })` が、W をタブで開いて `getByRole('dialog', { name: 'デザインエディター' })` を返す。今の F のテストは、パネルの探し方（`youtube.getByRole('dialog', …)`）を、この戻り値に替えるだけで多くがそのまま動く（同じ `createCreatorPanel` の DOM で、ラベルとボタン名が同じため）
- 並び方を「窓の幅」で切り替えるようにする（下の「決めてほしいこと」3）。そうすれば、幅 400px の W のタブで S の並び方を headless で確かめられ、ネイティブの窓が要るテストを増やさずに済む
- 本当のサイドパネルでしか確かめられないもの（開き方・閉じ方・タブの切り替え・素材の保持先の確認）は、今の `side-panel.spec.ts`（headed・画面の外）にだけ残す。件数は増やさない
- 書き換えが要るもの：
  - `withCanvas`・`clickCanvas`（パネルを折りたたんでからページを触る）。パネルがページの上に無くなるので要らなくなる。消すと G1 の「パネルを折りたたむとページの配置が変わる」待ち（`protectionSettled`）も要らなくなる
  - `editor-ux.spec.ts`（8 件）：F の並び方・低い窓・折りたたみを確かめている。S の並び方の e2e として作り直す
  - キー操作：今は `youtube.keyboard` で押している。ページにフォーカスがあるときの操作（ページの `controller.ts` が受ける）と、パネルにフォーカスがあるときの操作（`app.ts` が受ける）の両方を、1 件ずつ確かめる形にする
  - `page-marks.spec.ts`・`skin-editor.spec.ts`：パネルは W のタブ、印と部品は YouTube のタブ、と分けて書く

## 5. 消せるもの

行数は `4b18642` の時点。「（概算）」は分岐が他の行と混ざっている箇所。

| 消すもの                                                                                                                                                                                                                   | 行数           | 消せる条件                                                                                              |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------- |
| I：`src/sites/youtube-studio.ts`（`mountYouTubeStudio` 122・`protectYouTubeStudioToolbar` 49）                                                                                                                             | 183            | I をやめる。道具の帯（`toolbarOnly`）もやめるなら全部                                                   |
| I：`src/sites/youtube-studio.css`                                                                                                                                                                                          | 136            | 同上                                                                                                    |
| I：`src/studio/layout-types.ts`、`SiteAdapter.mountStudio`・`protectStudioToolbar`                                                                                                                                         | 17＋数行       | 同上                                                                                                    |
| I・道具の帯：`controller.ts` の `open('inpage' / 'sidepanel')`・`layout`・`unprotectToolbar`・`panelMode`                                                                                                                  | 約 80（概算）  | 同上                                                                                                    |
| I・道具の帯：`workbench.ts` の `inPage`・`toolbarOnly` の分岐、`app.ts` の「YouTubeでStudioを開く」、`studio-client.ts` の `openWorkspace('inpage')`、`messages.ts` の `OPEN_INPAGE_STUDIO`・`OPEN_SIDE_PANEL_TOOLS`       | 約 60（概算）  | 同上                                                                                                    |
| F・I の入り口：`launcher.ts` の 2 つのボタンと処理、`content/index.ts` の `OPEN_CREATOR_EDITOR`                                                                                                                            | 約 40（概算）  | 入り口を変えたあと                                                                                      |
| F：`src/editor/workspace.ts`                                                                                                                                                                                               | 564            | 3 回目（決定 1 が A のため消す）                                                                        |
| F：`src/editor/panel.css`                                                                                                                                                                                                  | 1091           | 同上（中身は 2 回目で作業台へ移してから）                                                               |
| F：`src/editor/skin-panel.css`（`SKIN_PANEL_STYLES`）                                                                                                                                                                      | 443            | 着せ替えを作業台へ移し、作業台の着せ替えの見た目を 1 つにしたあと                                       |
| F の分岐：`floating`（`panel.ts` 17 か所・`workspace.ts` 9・`skin-panel.ts` 5・`layer-tree.ts` 1）                                                                                                                         | 約 150（概算） | 作業台にデザインシステムを入れたあと                                                                    |
| 複製：`src/studio/editor-base.css`・`editor-skin-base.css`（UI0-a で作った、変更前の `panel.css`・`skin-panel.css` の複製）                                                                                                | 924＋425       | 作業台にデザインシステムを入れたあと                                                                    |
| 古いアイコン：`icons.ts` の 24px の `icon`・`buttonIcon`（`glyph` の 16px に替える）                                                                                                                                       | 約 95          | 同上。`asset-library.ts`・`app.ts`・`workbench.ts` も `glyph` に替える                                  |
| 使われていないコード（knip 6.44.0 を、製品の入り口＋`tests/`・`scripts/` を入り口にして実行）：`src/effects/controller.ts`（ファイルごと）、`design/frames.ts` の `editableSamples`、`world/signals.ts` の `signalContext` | 1＋14＋4       | いつでも                                                                                                |
| 外へ出す必要のない `export`（knip が 23 個＋型 18 個を挙げた）：ファイルの中でだけ使っているもの。コード自体は消さず、`export` を外すだけ                                                                                  | —              | いつでも。`migrations.ts` の `migrateV1ToV2`〜`migrateV12ToV13` は指示どおり残す（`export` もそのまま） |

knip が挙げなかった、依存の未使用・リストにない依存は 0 件だった。knip はリポジトリに入れず、`npx knip@6.44.0 --config .work/knip/knip.json` で動かした（設定は `.work` の下で、コミットしていない）。

## 作業の順番

前半で、機能を作業台（S・W）へ移し、4 つの形がすべて動くことを確かめる。後半で消す。

### 1 回目：機能を作業台へ移す（4 つの形が並んで動く）

- 着せ替え（上の 1・1a〜1d）を S・W へ。protocol に `import-skin` と `skinPage` を足す
- カードの選び方（2）を決めたとおりにそろえる
- テストの共通の入り口（W をタブで開く `openEditor`）を作る。着せ替えの e2e を W のタブでも 1 本通す
- 回すテスト：unit 全件、e2e 全件（`src/content/`・`src/browser/`・protocol に触るため）。`skin-*`・`studio*`・`side-panel*`・`validation`・`message-validation` を先に回す。実サイト：`WW_LIVE_SKIN`（着せ替え）を S と W で 1 回ずつ
- 性能：ページの側の `scheduleSkinInfo` の条件を変えるので、着せ替えの道具を開いているときを短く 2 組（UI0-c の `scripts/ui0c/marks.mjs` を広げる）

### 2 回目：作業台をデザインシステムにして、入り口と e2e を移す

- 作業台（`workbench.ts`）を土台のまま、デザインシステムを入れる（決定 1 の A）：`panel.css` の中身・`glyph`・保存のチップ・空の状態の作図を作業台へ移し、S の並び方は F と同じ「タブ・1 列」に寄せる。並び方を窓の幅で切り替える（3）
- 入り口を変える（上の 3 の表）。F・I はコードに残すが、ポップアップからは開けなくする
- F・I を入り口にしていた e2e（F 116 件・I 24 件、実サイトを除く）を、W のタブ（幅 400px と 1440px）に移す。`editor-ux` を S の並び方の e2e に作り直す
- 回すテスト：unit 全件、e2e 全件。実サイト：S（幅 400px 前後のノート PC の大きさ）と W で、UI0-b・UI0-c と同じ組み合わせのスクリーンショット（白・ダーク、明るい動画・暗い動画）

### 3 回目：消す

- 上の「消せるもの」をすべて消す（F・I・道具の帯・複製の CSS・24px のアイコン・knip の 3 つと不要な `export`）
- 回すテスト：unit 全件、e2e 全件。実サイト：S と W で、レイヤー・着せ替え・G1 の確認を 1 回ずつ
- 性能：エディターを閉じているときの足跡（UI0-c の `page-marks.spec.ts` の比較）と、S を開いて編集しているあいだのページの側の短い計測を 2 組

## 危ないところ

| どこ     | 何が起きうるか                                                                                                                                                                                                                                                                                                                               | 確かめ方                                                                                                                                                |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1       | I の `mountYouTubeStudio` と、S の道具の帯（`protectYouTubeStudioToolbar`）は、YouTube の配置と G1 の操作面の計算に入り込んでいる。消すと、操作面の数え方・保護の範囲が変わる。S を開くと Chrome が YouTube の幅を縮めるので、そのたびに操作面を読み直すはず（パネルを折りたたんだときと同じ「描画を一時止める」が起きると見ている。未確認） | `operation-safety`（30 件）・`operation-controls` を、F ではなく S・W から操作する形で通す。実サイトの G1（`WW_LIVE_OPERATION*`）を S を開いた幅で 1 回 |
| 保存     | S・W の保存は port 越しのコマンド。今の保存のチップ（UI0-b）は F にしかない。port が切れたとき（タブの再読み込み・SPA・サイドパネルを閉じる）の「保存していない変更」の扱いは `studio-recovery` の保持に頼っている                                                                                                                           | 保存の失敗・接続の切断・再接続の e2e（`studio.spec`・`side-panel.spec` にある）を、着せ替えを含めて通す                                                 |
| Undo     | キー操作が 2 か所（ページの `controller.ts` と拡張のページの `app.ts`）で受けられる。両方にフォーカスが行き来するので、同じ Ctrl+Z が二重に効く・どちらにも効かない、が起きうる。着せ替えの絵の取り込みは今、ページの中でしか Undo を確かめていない                                                                                          | ページ・パネルそれぞれにフォーカスがある状態で、Ctrl+Z を 1 回押して 1 段だけ戻ることを e2e で確かめる                                                  |
| SPA 遷移 | S は YouTube の SPA 遷移をまたいで開いたまま。ページの `controller.ts` の選択（`selectedElement`）と着せ替えの部品の情報（1a）は遷移で消える。今は F が遷移で閉じない前提の処理（`refreshSelection`）で動いている                                                                                                                            | 着せ替えの道具を開いたまま SPA 遷移する e2e（`skin-refresh`・`skin-lifecycle` を S・W で）                                                              |
| 緊急OFF  | UI0-c で、緊急OFFでページの印を消すようにした。S を開いたままの緊急OFFで、作業台の表示（保護範囲の表示を含む）とページの印がそろって止まり、再開で戻ること。I の `layout`（YouTube を縮めたまま）は緊急OFFでも戻らない今の動きがある                                                                                                         | `page-marks.spec` の緊急OFFを、W のタブから操作する形でも通す                                                                                           |

## 決めてほしいこと（翔太・レビュー役）

1. **1 本化した作業台の土台をどちらにするか** — **決定：A（翔太、2026-10-31）**
   - A：今の作業台（`workbench.ts`）を土台にして、デザインシステムの見た目（`panel.css` の中身、`glyph`、保存のチップ、空の状態）を移す。`workspace.ts`・`panel.css` は消す。Timeline・ライブラリ・接続の帯はそのまま
   - B：F の中身（`workspace.ts`＋`panel.css`。340px・1 列・タブ。デザインシステム済み）を S の土台にし、W は同じ部品を広く並べる。作業台の古い見た目（`editor-base.css`・`workbench.css` の大半）を消す。Timeline・ライブラリ・接続の帯・緊急OFFは B に移す
   - 僕の案：**A**。README の「サイドパネル（320〜480px）＝ヘッダー・タブ・1 列」は B に近いが、S・W だけにある機能（Timeline・ライブラリ・接続・保護の表示）が多く、移す量は A の方が少ない。A でも、S の並び方は F と同じ「タブ・1 列」に寄せる
2. **カードをクリックで選ぶ条件**：F のように「サイト操作以外のどの道具でも」か、S のように「動画カードを編集の道具のときだけ」か。僕の案：S の方（意図しないクリックでの選択を防ぐ。YouTube を見ながら作業するとき、ページのクリックが YouTube に届く）
3. **S と W の並び方を、窓の幅で切り替えるか**（今は `?surface=sidepanel` で切り替え）。僕の案：幅で切り替える。安全の確認（`surface=sidepanel` の背景の確認）は今のまま残し、並び方とは分ける。これで、S の並び方を headless の e2e で確かめられる
4. **S のときにページに出る「道具の帯」（`toolbarOnly`）を残すか**。僕の案：消す。道具はサイドパネルにあり、帯は G1 の保護の対象を 1 つ増やしているだけ
5. **「Studioで編集中」の札**：S を開いているときにも出すか。今は帯があるので出ていない。僕の案：S のときは出さず、W のときだけ出す（S はパネルが横に見えている）
6. **ポップアップ**：「デザインを編集（実験）」と「従来のインページStudio」を消し、「エディターを開く」（S）と「別ウィンドウで開く」（W）の 2 つにしてよいか
7. **F・I を消す時期**：3 回目で消す前に、F・I を隠したまま 1 回分（数日）使ってから消すか、2 回目と 3 回目を続けて行うか
