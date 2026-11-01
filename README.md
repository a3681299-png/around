# Web World Themes

既存サイトの上に、作者が自分で作った世界を表示するChrome拡張機能です。最初の対象はデスクトップ版YouTubeです。エディターで、YouTubeの部品（動画カード・検索欄・ボタンなど）の着せ替え、画像・アニメーション・3Dモデルの配置、マウスや再生状態への反応を作り、そのままページの上に表示します。Manifest V3とTypeScriptで構築しています。

YouTubeそのものの見た目は変えません。作品がないときは、拡張機能は何も描きません。どの作品でも、本物の操作部品（再生ボタン・検索欄など）が押せなくなったり、隠れたりしないように、エンジンが保護します（[操作性の保護](docs/operation-safety.md)）。

以前あった`retro`テーマ（`YouTube.exe`の窓の飾り・自動配色・表面の質感・ピクセル書体など）は撤去しました。コードはgitのタグ`retro-theme-final`に残しています。経緯と、古い設定・バックアップの扱いは[撤去の記録](docs/theme-removal.md)を参照してください。

## はじめ方

Node.js 22.13以降の22系、または24以上を使います。ESLint 10の要件に合わせています。このプロジェクトはNode.js 24で検証しています。

```powershell
cd C:\Users\sm787\GitHub-Projects\web-world-themes
npm ci --registry=https://registry.npmjs.org
npm run build
```

Chromeで`chrome://extensions`を開き、右上の「デベロッパーモード」をONにします。「パッケージ化されていない拡張機能を読み込む」を押し、通常版の既存パス `C:\Users\sm787\GitHub-Projects\web-world-themes\dist` を選んでください。既に登録済みなら同じカードを再読み込みします。ソースのルートフォルダーではなく、ビルド後の`dist`を読み込みます。

実験版など別の読み込み先から移す場合は、作品とテイクを保存し、「作品と設定のバックアップ」から1ファイルへ書き出してください。読み込み先を変えると拡張IDが変わる場合があり、保存データは自動では引き継がれません。[移行手順と戻し方](docs/extension-consolidation.md)に従い、復元を確認するまで旧拡張とフォルダーを残します。

拡張機能をツールバーに固定し、YouTubeを開くか再読み込みします。拡張アイコンを押すと「設定」が開きます。

## 設定

設定は、拡張アイコンのPopupと、動画プレイヤー右下のアイコン列の左端にある設定アイコンから開けます。どちらも同じ内容です。

- **エディターを開く／別ウィンドウで開く**：制作画面（Chromeのサイドパネル、または別ウィンドウ）を開きます
- **制作モード**：ONのとき、拡張アイコンと動画の中のアイコンから直接エディターを開きます（初期値はOFF）
- **作品を表示する**：OFFのとき、ページには作品を描きません。保存した作品は消えません（初期値はON）
- **緊急OFF／描画を再開・停止キーと操作チェック**：描画をすぐに止めます。作品・未保存の編集・Undoは保持し、「描画を再開」を押すまで自動では戻りません
- **作品と設定のバックアップ**：作品・原本素材・保存テイク・設定を1つのファイルへ書き出し、別の拡張IDへ読み込めます

開いているYouTubeタブすべてに同じ設定を適用します。変更は自動保存され、Popupを閉じても、Chromeを再起動しても維持されます。

撤去前に「エフェクトの強さ」を0%にして表示を止めていた場合は、更新後に最初に設定を読み込んだとき、「作品を表示する」をOFFとして1回だけ保存します。

## エディターをすぐ開く

設定の先頭にある「エディターを開く」から制作画面を開けます。「制作モード」をONにすると、拡張アイコンから直接エディターを開きます。設定は、エディター内の「設定」から開けます。設定ウィンドウのタイトルバーをドラッグすると位置を覚えます。

Alt+Shift+Eで、制作モードに関係なくエディターを開けます。このキーは提案値です。競合した場合や変更したい場合は chrome://extensions/shortcuts で「エディターを直接開く」を設定してください。追加権限や常時表示の起動ボタンは使いません。

Alt+Shift+Q、または設定・Studioの「緊急OFF」で描画を停止できます。停止キーも chrome://extensions/shortcuts で変更できます。Studioの「停止キーと操作チェック」では、実際のキーの割当、操作面の保護範囲、レイヤーが制限された理由を確認できます。エディターのショートカットはYouTube以外のタブでは何もしません。

保存先を移す場合は[バックアップ](docs/extension-backup.md)と[読み込み先の移行手順](docs/extension-consolidation.md)を先に確認してください。

## 制作

動画カードやYouTubeの部品の着せ替え、PNG・WebP素材の移動・サイズ変更・回転、レイヤー一覧、ロック、複製、複数選択と一括移動、Undo／Redo、任意のスナップ、整列・等間隔配置に対応します。GIF・アニメーションWebP・Lottie JSONは、編集画面で再生を確認し、停止・ループ・Lottieの速度を設定できます。

Signal Timeline v2では「モーション → マウスを追いかける」で、遅延・最高速度・加減速・停止距離・移動方向への回転を設定できます。Timelineの「対象」「入力」からマウス位置・距離・角度・速度を位置／回転／不透明度へ接続します。操作テイクの録画・再生・シーク、別保存にも対応します。操作・構造は [signal-timeline-v2.md](docs/signal-timeline-v2.md)、検証結果と制約は [signal-timeline-v2-verification.md](docs/signal-timeline-v2-verification.md) を参照してください。

円形マスクで画像の一部を照らし、マウスに追従させたり動画の一時停止でフェードアウトさせたりできます。構造と操作は [effects-and-signals.md](docs/effects-and-signals.md) を参照してください。

複数素材をグループ化し、階層表示と全体移動・不透明度・共通マスクを設定できます。使い方と制約は [group-layers.md](docs/group-layers.md) にまとめています。素材は拡張専用IndexedDB、作品はバージョン付きJSONで保存します。使い方は [creator-editor.md](docs/creator-editor.md)、アニメーションの制限は [animations.md](docs/animations.md) を参照してください。

主要な制作画面は、Chromeのサイドパネルです。プロパティ／レイヤー／マスク／振る舞いを公式パネルに置き、YouTubeはChromeが変更したビューポートで自然にレイアウトします。ページ内には共通の小型ツールバーと編集ハンドルを表示します。Vは選択・変形、Hはサイト操作、Cは動画カード編集です。[公式パネルの設計・操作](docs/side-panel-studio.md)、[比較画像・検証結果](docs/side-panel-studio-verification.md)を参照してください。

## 開発

開発と自動テストは専用worktree・`.work/test-dist`・隔離Chromeプロファイルを使い、常用の読み込み先と分けます。

```powershell
npm run dev
```

TypeScriptとCSSの変更を監視して`dist`を更新します。変更後は`chrome://extensions`の再読み込みボタンを押し、YouTubeも再読み込みしてください。設定操作の反映には再読み込みは不要です。監視の終了は`Ctrl+C`です。

```powershell
npm run lint
npm run typecheck
npm run test:unit
$env:WW_BUILD_OUT = '.work/test-dist'
$env:WW_TEST_EXTENSION_PATH = '.work/test-dist'
npm run build
npm run test:setup
npm run test:e2e
```

`test:unit`はビルドやブラウザーのインストールなしで動き、4ワーカーで並列実行します。Chrome Storageなどの単体テスト用スタブは各ワーカー内で作成・復元します。ブラウザーを使うテストは`test:e2e`で1件ずつ実行し、`npm test`は両方のprojectを実行します。分類は`playwright.config.ts`の`unitSpecs`で管理し、それ以外のspecはe2eに入ります。

`test:setup`はe2e用のPlaywright公式Chromiumを`.work/browsers`へダウンロードします。e2eは独立したブラウザープロファイルを使い、ユーザーのChromeプロファイルは変更しません。CIはunitとe2eを別jobで実行します。実サイト・非公開素材・診断ビルドを使うオプトイン検証は、必要な環境変数を指定した場合に実行します。

VRMの通常テストは小さな自作データで描画を確認します。33MiBのVRMは、実GPU環境で`WW_REAL_GPU_VRM=1`を指定した場合にだけ実行します。SwiftShaderなどのソフトウェア描画では実行できません。整形・lintの使い方は[tooling.md](docs/tooling.md)を参照してください。作業の決まりは[AGENTS.md](AGENTS.md)にあります。

## ファイル構成

```text
manifest.json                 Manifest V3 / YouTube対象範囲 / storage・sidePanel権限
scripts/
  build.mjs                   esbuild / dist生成 / 変更監視
  test.mjs                    検証用ブラウザーの保存先と起動
src/
  content/index.ts            設定監視とページの制御の起点
  host/
    page-controller.ts        作品の描画・画像とモデル・操作性の保護・タイムラインのまとめ役
    operation-guard.ts        操作性の保護（G1）
  sites/
    types.ts                  SiteAdapter / 共通surface定義
    index.ts                  URLに応じたAdapter選択
    youtube.ts                YouTubeセレクタ / SPA / DOM監視
    youtube-player.ts         設定アイコンの配置 / プレイヤー交換時の付け直し
  design/                     作品（DesignDocument）の形式・移行・着せ替えのCSS
  storage/settings.ts         chrome.storage.local / 作品を表示する・制作モード / 撤去前の設定の移行
  backup/                     バックアップの形式・書き出し・読み込み
  popup/                      Popupの外枠
  settings/
    form.ts                   Popupとプレイヤー設定の共通保存処理
    markup.ts                 両設定画面の共通テンプレート
    panel.ts                  サイトに依存しない設定パネル / 設定アイコン
    safety-controls.ts        緊急OFF・停止キーと操作チェック
tests/
  fixtures/youtube.html       YouTube相当の検証用DOM
  fixtures/backups/           撤去前の実物のバックアップと設定（履歴。作り直さない）
  fixtures.ts                 実拡張機能を読み込むChromium
dist/                         Chromeへ読み込む生成物（Git管理対象外）
```

## 設計

Popupまたはプレイヤー設定パネル → `chrome.storage.local` → `storage.onChanged` → content → PageController → SiteAdapter / 作品の描画、という流れです。content scriptをYouTubeへ静的に登録します。エディターのService Workerは、拡張専用IndexedDBへの素材保存と、素材参照を検証した作品の保存を担当します。権限は`storage`と`sidePanel`で、適用先は`https://www.youtube.com/*`に限定しています。埋め込みプレイヤーとライブチャット専用ページは除外します。

「作品を表示する」と「制作モード」は別々のキーに保存します。複数のPopupから異なる設定を変更しても、もう一方の値を上書きしません。初期読込中に届いた変更は読込結果へ合流させ、古い設定への巻き戻りを防ぎます。

YouTube用Adapterが対象要素に`data-ww-surface`を付けます。作品の着せ替えはYouTubeのセレクタやDOM操作を持たず、この共通属性を使います。作品が使う部品だけを探し、ページの変化では新しく付いた部分だけを調べます（[AGENTS.md](AGENTS.md)の「繰り返さない設計」）。

設定アイコンは作品の表示と別のライフサイクルで配置します。`sites/youtube-player.ts`だけがプレイヤーと右側の操作欄のセレクタを持ち、`settings/panel.ts`はサイトのDOM構造を知りません。プレイヤーが遅れて生成された場合やSPAで交換された場合に配置を確認し、右側の操作欄の先頭へ1つだけ置きます。設定パネルはShadow DOMでスタイルを分け、キー入力が動画のシークに伝わるのを防ぎます。

## 検証

`npm run check`はCSS構文／サイトのセレクタの境界のlint、TypeScriptの型チェック、ビルド、Playwrightテストを実行します。ブラウザーテストはMV3拡張機能とChrome Storageの実物を使いますが、YouTubeのページはローカルの検証用DOMへ差し替えます。

対応するChromiumがシステムにある場合は`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`で選べます。既定では`npm run test:setup`で導入したPlaywrightのChromiumを使います。テスト専用プロファイルを作り、ユーザーのプロファイルは変更しません。

ブラウザー起動・実サイト・スクリーンショットの実施状況と制限は`docs/verification.md`を参照してください。過去バージョンのPASSは今回の変更の実測結果を意味しません。

Chromeの仕様は[Content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)と[Storage API](https://developer.chrome.com/docs/extensions/reference/api/storage)、拡張機能の検証方法は[Playwright公式ドキュメント](https://playwright.dev/docs/chrome-extensions)を参照しています。
