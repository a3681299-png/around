# Web World Themes

既存サイトを別の世界観に着せ替えるChrome拡張機能です。最初のMVPはデスクトップ版YouTubeだけに対応します。Manifest V3とTypeScriptで構築し、Windows 95/98風の`retro`テーマを用意しました。

## はじめ方

Node.js 22以上を使います。このプロジェクトはNode.js 24で検証しています。

```powershell
cd C:\Users\sm787\GitHub-Projects\web-world-themes
npm ci --registry=https://registry.npmjs.org
npm run build
```

Chromeで`chrome://extensions`を開き、右上の「デベロッパーモード」をONにします。「パッケージ化されていない拡張機能を読み込む」を押し、このプロジェクトの`dist`フォルダーを選んでください。ソースのルートフォルダーではなく、ビルド後の`dist`を読み込みます。

拡張機能をツールバーに固定し、YouTubeを開くか再読み込みします。Popupで`Theme ON / OFF`をONにすると、retroテーマが適用されます。初期値はOFF、`Effect Strength`は60%です。スライダーは0〜100%で、0%では元の見た目に戻ります。雰囲気をはっきり確認したい場合は100%へ動かしてください。

上部に紺色の`YouTube.exe`タイトルバーと、ホーム・登録チャンネル・履歴へのメニューバーを追加します。検索欄は凹んだ枠、ボタンは立体枠、動画カードとサイドバーはグレーと白のボックスにします。タイトルバー右端の窓の記号は装飾です。YouTubeがダーク表示の場合は、立体枠を残した暗い配色になります。

動画プレイヤー右下のアイコン列にも、左端に仮のスライダー型アイコンを追加します。押すと動画の上に設定パネルが開き、同じON/OFFと強さを編集できます。テーマがOFFでも使えます。×ボタン、アイコンの再クリック、Esc、パネルの外をクリックすると閉じます。全画面でもプレイヤー内に表示します。

開いているYouTubeタブすべてに同じ設定を適用します。変更は自動保存され、Popupを閉じても、Chromeを再起動しても維持されます。テーマをOFFにしても、強さの設定は残ります。

## 開発

```powershell
npm run dev
```

TypeScriptとCSSの変更を監視して`dist`を更新します。変更後は`chrome://extensions`の再読み込みボタンを押し、YouTubeも再読み込みしてください。設定操作の反映には再読み込みは不要です。監視の終了は`Ctrl+C`です。

```powershell
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
    youtube-chrome.ts         YouTube.exe / サイト固有のナビゲーション
    youtube.css               色の接続 / 追加ヘッダー分の配置調整
  themes/
    types.ts                  テーマ定義の共通型
    index.ts                  テーマ登録（現在retroだけ）
    controller.ts             CSSと強さの適用 / OFF時の撤去
    retro/
      index.ts                retro定義
      tokens.css              配色 / 立体枠 / フォント / 強さ / ダーク配色
      surfaces.css            カード / 検索欄 / ボタン / サイドバー
      chrome.css              タイトルバー / メニューバー
      editor.css              Popupとプレイヤー設定の共通デザイン
  storage/settings.ts         chrome.storage.local / 値の検証 / 変更通知
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

Popupとプレイヤー内設定は`settings/markup.ts`と`settings/form.ts`を共有します。テーマ定義の`editorStylesheets`が両方の見た目を指定し、設定画面の配色はサイトのON/OFFや強さにかかわらず固定します。装飾を変えるときは`themes/retro`、項目を変えるときは共通テンプレートを編集します。

設定アイコンはテーマと別のライフサイクルで配置します。`sites/youtube-player.ts`だけがプレイヤーと右側の操作欄のセレクタを持ち、`settings/panel.ts`はサイトのDOM構造を知りません。プレイヤーが遅れて生成された場合やSPAで交換された場合に配置を確認し、右側の操作欄の先頭へ1つだけ置きます。設定パネルはShadow DOMでスタイルを分け、スライダーのキー入力が動画のシークに伝わるのを防ぎます。通常のデータ更新ではパネルを維持し、ページ遷移やプレイヤー交換では閉じます。

YouTubeの`yt-navigate-finish`と`yt-page-data-updated`で再確認し、追加DOMやID・選択状態の変更は`MutationObserver`で検出します。通常の変更では追加された部分だけを調べ、更新を描画フレーム単位でまとめます。カスタム要素とIDを優先し、一部の新しい部品には名前付きクラスを使います。セレクタはAdapter内に集約しています。

## 現在の範囲と次の作業

現在のretroは、紺のタイトルバーとメニューバー、グレーのパネル、白黒の立体枠で全体の雰囲気を揃えています。古いWindowsの完全再現は目指さず、YouTubeの検索や再生、設定操作を使える状態にしています。

次はカード内の余白と文字の大きさ、カテゴリの選択状態、ホバーとフォーカス、チャンネル見出しなどの細部を揃えます。配色は`themes/retro/tokens.css`、装飾は`surfaces.css`と`chrome.css`、設定画面は`editor.css`で調整します。追加の対象は`sites/youtube.ts`で指定します。テーマを増やすときは新しい定義を登録し、テーマIDの保存と選択UIを追加します。別サイトへの対応は新しいAdapterを作る段階で行います。

自動テストは実際のMV3拡張機能とChrome Storageを使いますが、YouTubeのHTMLは検証用DOMへ差し替えます。SPAでの要素置換、遅延追加、スタイル要素の削除からの復旧、ダークモード、0%、別ドメインへの非適用、保存失敗、ブラウザー再起動後の保持を確認します。実サイト全画面の互換性を保証するテストではありません。実サイトでの確認結果は`docs/verification.md`に記録します。

Chromeの仕様は[Content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)と[Storage API](https://developer.chrome.com/docs/extensions/reference/api/storage)、拡張機能の検証方法は[Playwright公式ドキュメント](https://playwright.dev/docs/chrome-extensions)を参照しています。
