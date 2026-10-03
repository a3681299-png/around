# Web World Themes

既存サイトを別の世界観に着せ替えるChrome拡張機能です。最初のMVPはデスクトップ版YouTubeだけに対応します。Manifest V3とTypeScriptで構築し、仮の`retro`テーマを用意しました。

## はじめ方

Node.js 22以上を使います。このプロジェクトはNode.js 24で検証しています。

```powershell
cd C:\Users\sm787\GitHub-Projects\web-world-themes
npm ci --registry=https://registry.npmjs.org
npm run build
```

Chromeで`chrome://extensions`を開き、右上の「デベロッパーモード」をONにします。「パッケージ化されていない拡張機能を読み込む」を押し、このプロジェクトの`dist`フォルダーを選んでください。ソースのルートフォルダーではなく、ビルド後の`dist`を読み込みます。

拡張機能をツールバーに固定し、YouTubeを開くか再読み込みします。Popupで`Theme ON / OFF`をONにすると、仮のretroテーマが適用されます。初期値はOFF、`Effect Strength`は60%です。スライダーは0〜100%で、0%では元の見た目に戻ります。

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
    youtube.css               YouTubeの色を共通トークンへ接続
  themes/
    types.ts                  テーマ定義の共通型
    index.ts                  テーマ登録（現在retroだけ）
    controller.ts             CSSと強さの適用 / OFF時の撤去
    retro/
      index.ts                retro定義
      tokens.css              仮の配色 / 角丸 / 強さ
      surfaces.css            共通surfaceへのCSS
  storage/settings.ts         chrome.storage.local / 値の検証 / 変更通知
  popup/
    index.html                ON/OFFとスライダー
    index.ts                  共通フォームをPopupへ接続
    popup.css                 Popupの見た目
  settings/
    form.ts                   Popupとプレイヤー設定の共通保存処理
    form.css                  ON/OFFとスライダーの共通スタイル
    panel.ts                  サイトに依存しない設定パネル / 仮アイコン
    panel.css                 パネルの見た目（Shadow DOMで分離）
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

テーマの色は`--ww-native-page`などのAdapterが提供する元の色と混ぜます。ライト/ダークの判定もAdapterが担当します。ON時だけテーマ用のCSSとDOM監視を有効にし、OFFまたは0%でテーマのCSS、付与属性、CSS変数、Observerとイベント監視を撤去します。動画や画像自体の加工、元の要素の移動はしません。

設定アイコンはテーマと別のライフサイクルで配置します。`sites/youtube-player.ts`だけがプレイヤーと右側の操作欄のセレクタを持ち、`settings/panel.ts`はサイトのDOM構造を知りません。プレイヤーが遅れて生成された場合やSPAで交換された場合に配置を確認し、右側の操作欄の先頭へ1つだけ置きます。設定パネルはShadow DOMでスタイルを分け、スライダーのキー入力が動画のシークに伝わるのを防ぎます。通常のデータ更新ではパネルを維持し、ページ遷移やプレイヤー交換では閉じます。

YouTubeの`yt-navigate-finish`と`yt-page-data-updated`で再確認し、追加DOMやID変更は`MutationObserver`で検出します。通常の変更では追加された部分だけを調べ、更新を描画フレーム単位でまとめます。生成クラス名や要素の並び順に依存せず、YouTubeのカスタム要素とIDをAdapterに集約しています。

## 現在の範囲と次の作業

現在のretroは、背景を少し変え、角丸を小さくし、一部の内枠を付ける仮デザインです。世界観の作り込みはこれからです。

次はYouTubeのホーム、検索、動画ページごとに装飾する箇所を決め、`themes/retro/tokens.css`の配色と`surfaces.css`の装飾を作り込みます。追加の適用対象は`sites/youtube.ts`で調整します。テーマを増やすときは新しいテーマ定義を`themes`へ登録し、テーマIDの設定保存とPopupの選択UIを追加します。別サイトへの対応は新しいAdapterを作る段階で行います。

自動テストは実際のMV3拡張機能とChrome Storageを使いますが、YouTubeのHTMLは検証用DOMへ差し替えます。SPAでの要素置換、遅延追加、スタイル要素の削除からの復旧、ダークモード、0%、別ドメインへの非適用、保存失敗、ブラウザー再起動後の保持を確認します。実サイト全画面の互換性を保証するテストではありません。実サイトでの確認結果は`docs/verification.md`に記録します。

Chromeの仕様は[Content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)と[Storage API](https://developer.chrome.com/docs/extensions/reference/api/storage)、拡張機能の検証方法は[Playwright公式ドキュメント](https://playwright.dev/docs/chrome-extensions)を参照しています。
