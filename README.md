# Web World Themes

既存サイトを別の世界観に着せ替えるChrome拡張機能です。最初のMVPはデスクトップ版YouTubeだけに対応します。Manifest V3とTypeScriptで構築し、Windows 95/98の構造と2000〜2005年の電子的な遊び心を合わせた`retro`テーマを用意しました。

コンセプトは **「機能美の時代に、遊び心を取り戻す」**。明るいシルバーと青灰色のパネル、青いガラス調の選択状態、小さな黒い液晶風のバーで、YouTubeの使い方を保ちながら平成初期のPC／個人サイトの空気を足します。

## はじめ方

Node.js 22以上を使います。このプロジェクトはNode.js 24で検証しています。

```powershell
cd C:\Users\sm787\GitHub-Projects\web-world-themes
npm ci --registry=https://registry.npmjs.org
npm run build
```

Chromeで`chrome://extensions`を開き、右上の「デベロッパーモード」をONにします。「パッケージ化されていない拡張機能を読み込む」を押し、このプロジェクトの`dist`フォルダーを選んでください。ソースのルートフォルダーではなく、ビルド後の`dist`を読み込みます。

拡張機能をツールバーに固定し、YouTubeを開くか再読み込みします。Popupで`Theme ON / OFF`をONにすると、retroテーマが適用されます。初期値はOFF、`Effect Strength`は60%です。スライダーは0〜100%で、0%では元の見た目に戻ります。雰囲気をはっきり確認したい場合は100%へ動かしてください。

上部に黒い液晶風の`YouTube.exe`バーと、ホーム・登録チャンネル・履歴へのシルバーのメニューを追加します。細い水色の光、点状のインジケーター、控えめな顔文字は拡張機能の飾りだけに使います。検索欄は凹んだ枠、ボタンは薄い立体枠、選択項目は青いガラス風にします。動画の画像・映像そのものは加工しません。本文と動画タイトルは読みやすさを優先し、OSのロゴやアイコン素材は使用していません。

YouTubeのダーク表示に従う場合は、明るさを落とした青紺のパレットへ切り替わります。独立したナイトモード機能はありません。`Window chrome`をOFFにすると追加バーとその高さだけを撤去し、基本テーマは残ります。追加機能の設定はテーマをOFFにしても保持されます。

動画プレイヤー右下のアイコン列にも、左端に仮のスライダー型アイコンを追加します。押すと動画の上に設定パネルが開き、同じON/OFFと強さを編集できます。テーマがOFFでも使えます。×ボタン、アイコンの再クリック、Esc、パネルの外をクリックすると閉じます。全画面でもプレイヤー内に表示します。

開いているYouTubeタブすべてに同じ設定を適用します。変更は自動保存され、Popupを閉じても、Chromeを再起動しても維持されます。テーマをOFFにしても、強さの設定は残ります。

## 開発

```powershell
npm run dev
```

TypeScriptとCSSの変更を監視して`dist`を更新します。変更後は`chrome://extensions`の再読み込みボタンを押し、YouTubeも再読み込みしてください。設定操作の反映には再読み込みは不要です。監視の終了は`Ctrl+C`です。

```powershell
npm run lint
npm run typecheck
npm run build
npm run test:setup
npm test
```

`test:setup`はPlaywright公式のChromiumを`.work/browsers`へダウンロードします。テストは独立したブラウザープロファイルを使い、ユーザーのChromeプロファイルは変更しません。

## ファイル構成

```text
manifest.json                 Manifest V3 / YouTube対象範囲 / storage権限
scripts/
  build.mjs                   esbuild / dist生成 / 変更監視
  test.mjs                    検証用ブラウザーの保存先と起動
src/
  content/index.ts            設定監視とテーマ適用の起点
  sites/
    types.ts                  SiteAdapter / 共通surface定義
    index.ts                  URLに応じたAdapter選択
    youtube.ts                YouTubeセレクタ / SPA / DOM監視
    youtube-player.ts         設定アイコンの配置 / プレイヤー交換時の付け直し
    youtube-chrome.ts         独立したwindow-chrome機能 / サイト固有ナビゲーション
    youtube.css               色の接続 / 追加ヘッダー分の配置調整
  themes/
    types.ts                  テーマ定義の共通型
    index.ts                  テーマ登録（現在retroだけ）
    controller.ts             CSSと強さの適用 / OFF時の撤去
    retro/
      index.ts                retro定義
      tokens.css              シルバー・青ガラス・液晶 / 立体枠 / フォント / 強さ / ダーク配色
      surfaces.css            カード / 検索欄 / ボタン / サイドバー
      chrome.css              タイトルバー / メニューバー
      editor.css              Popupとプレイヤー設定の共通デザイン
  features/                   追加機能の登録 / 個別ON・OFF / mount・refresh・destroy
  storage/settings.ts         chrome.storage.local / 値の検証 / 機能別キー / 変更通知
  popup/
    index.html                Popupの外枠
    index.ts                  共通フォームをPopupへ接続
    popup.css                 Popupの幅と配置
  settings/
    form.ts                   Popupとプレイヤー設定の共通保存処理
    markup.ts                 両設定画面の共通テンプレート
    panel.ts                  サイトに依存しない設定パネル / 仮アイコン
    panel.css                 パネルの配置とホストCSSの保護
tests/
  fixtures/youtube.html       YouTube相当の検証用DOM
  fixtures.ts                 実拡張機能を読み込むChromium
  extension.spec.ts           設定反映 / SPA / OFF / 保存などの検証
dist/                         Chromeへ読み込む生成物（Git管理対象外）
```

## 設計

Popupまたはプレイヤー設定パネル → `chrome.storage.local` → `storage.onChanged` → content → ThemeController → SiteAdapter / theme、という流れです。content scriptをYouTubeへ静的に登録するため、バックグラウンドService Workerは必要ありません。権限は`storage`だけで、適用先は`https://www.youtube.com/*`に限定しています。埋め込みプレイヤーとライブチャット専用ページは除外します。YouTube Music、モバイル版、Twitch、Xは対象外です。

ON/OFFと強さは別々のキーに保存します。複数のPopupから異なる設定を変更しても、もう一方の値を上書きしません。初期読込中に届いた変更は読込結果へ合流させ、古い設定への巻き戻りを防ぎます。スライダー操作のたびに保存を始め、Popupを閉じると失われる遅延タイマーは使いません。

YouTube用Adapterが対象要素に`data-ww-surface`を付けます。テーマはYouTubeのセレクタやDOM操作を持たず、この共通属性とCSS変数を使います。

| 共通surface | 役割 |
| --- | --- |
| `page` | ページの背景 |
| `panel` | ヘッダーや説明欄などの背景 |
| `frame` | レイアウト寸法を変えない内側の枠線 |
| `rounded` | サムネイルなどの角丸 |
| `window` / `titlebar` / `menubar` | ウィンドウの外枠と追加バー |
| `input` / `button` | 凹んだ入力欄と立体ボタン |
| `card` / `section` / `sidebar` | 動画カードや一覧、サイドバーのボックス |
| `navigation` / `selected` | ナビゲーションと選択された項目 |
| `text` | 説明欄の文字とリンクの色 |

テーマの色は`--ww-native-page`などのAdapterが提供する元の色と混ぜます。ライト/ダークの判定もAdapterが担当します。ON時だけテーマ用のCSSとDOM監視を有効にし、OFFまたは0%でテーマのCSS、付与属性、CSS変数、Observerとイベント監視を撤去します。動画や画像自体の加工、元の要素の移動はしません。

ウィンドウ装飾のDOMとリンク先はAdapterが用意し、見た目は`themes/retro/chrome.css`で指定します。ネイティブのツールバーの高さを読んで、追加した2行分だけページとサイドバーの位置を調整します。追加バーが取り除かれた場合は付け直し、OFFまたは0%ではバーと配置変更も撤去します。

Popupとプレイヤー内設定は`settings/markup.ts`と`settings/form.ts`を共有します。テーマ定義の`editorStylesheets`が両方の見た目を指定し、設定画面の配色はサイトのON/OFFや強さにかかわらず読みやすいシルバーに固定します。装飾を変えるときは`themes/retro`、項目を変えるときは共通テンプレートを編集します。

設定アイコンはテーマと別のライフサイクルで配置します。`sites/youtube-player.ts`だけがプレイヤーと右側の操作欄のセレクタを持ち、`settings/panel.ts`はサイトのDOM構造を知りません。プレイヤーが遅れて生成された場合やSPAで交換された場合に配置を確認し、右側の操作欄の先頭へ1つだけ置きます。設定パネルはShadow DOMでスタイルを分け、スライダーのキー入力が動画のシークに伝わるのを防ぎます。通常のデータ更新ではパネルを維持し、ページ遷移やプレイヤー交換では閉じます。

YouTubeの`yt-navigate-finish`と`yt-page-data-updated`で再確認し、追加DOMやID・選択状態の変更は`MutationObserver`で検出します。通常の変更では追加された部分だけを調べ、更新を描画フレーム単位でまとめます。カスタム要素とIDを優先し、一部の新しい部品には名前付きクラスを使います。セレクタはAdapter内に集約しています。

## 追加機能の設計

`features/index.ts`の`FEATURE_REGISTRY`が機能ID、表示名、説明、初期値とライフサイクルをまとめます。現時点の登録は`window-chrome`だけです。各機能は`mount()`でインスタンスを返し、`refresh()`でSPA更新へ追従、`destroy()`で追加DOM・イベント・属性を撤去します。サイト固有の実装はAdapterの`features`に置きます。対応していないサイトでは安全にスキップします。

保存先は`webWorldThemes.features.<id>`という機能別キーです。既存の`enabled`と`strength`キーを変更せず、保存値がまだない場合は機能の初期値を使います。異なる設定画面から同時に操作しても、他の機能の値をまとめて上書きしません。共有フォームのトグルは登録情報から生成します。全体OFFまたは0%では全機能を逆順に解除し、選択した設定自体は保持します。

新機能を追加するときは、機能定義と必要なAdapter capabilityを追加して登録します。YouTubeセレクタをテーマや共通機能へ持ち込まないでください。キリ番・アクセスカウンター・ナイトモード・BBSコメントは今回実装していません。

## 検証と現在の範囲

`npm run check`はCSS構文／テーマ境界のlint、TypeScriptの型チェック、ビルド、Playwrightテストを実行します。`tests/features.spec.ts`はブラウザー不要の設定・機能ライフサイクル検証です。ブラウザーテストはMV3拡張機能とChrome Storageの実物を使いますが、YouTubeのページはローカルの検証用DOMへ差し替えます。

対応するChromiumがシステムにある場合は`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`で選べます。既定では`npm run test:setup`で導入したPlaywrightのChromiumを使います。テスト専用プロファイルを作り、ユーザーのプロファイルは変更しません。

ブラウザー起動・実サイト・スクリーンショットの実施状況と制限は`docs/verification.md`を参照してください。過去バージョンのPASSは今回の変更の実測結果を意味しません。デザインの意図は`docs/heisei-design.md`にまとめています。

Chromeの仕様は[Content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)と[Storage API](https://developer.chrome.com/docs/extensions/reference/api/storage)、拡張機能の検証方法は[Playwright公式ドキュメント](https://playwright.dev/docs/chrome-extensions)を参照しています。

