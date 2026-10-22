# Web World Themes

既存サイトを別の世界観に着せ替えるChrome拡張機能です。最初のMVPはデスクトップ版YouTubeだけに対応します。Manifest V3とTypeScriptで構築し、Windows 95/98の構造と2000〜2005年の電子的な遊び心を合わせた`retro`テーマを用意しました。

コンセプトは **「機能美の時代に、遊び心を取り戻す」**。明るいシルバーの筐体、上半分に反射のあるタイトルバー、四角い小窓と小さな液晶表示で、YouTubeの使い方を保ちながら平成初期のPC／個人サイトの空気を足します。

## はじめ方

Node.js 22.13以降の22系、または24以上を使います。ESLint 10の要件に合わせています。このプロジェクトはNode.js 24で検証しています。

```powershell
cd C:\Users\sm787\GitHub-Projects\web-world-themes
npm ci --registry=https://registry.npmjs.org
npm run build
```

Chromeで`chrome://extensions`を開き、右上の「デベロッパーモード」をONにします。「パッケージ化されていない拡張機能を読み込む」を押し、このプロジェクトの`dist`フォルダーを選んでください。ソースのルートフォルダーではなく、ビルド後の`dist`を読み込みます。

拡張機能をツールバーに固定し、YouTubeを開くか再読み込みします。Popupで`Theme ON / OFF`をONにすると、retroテーマが適用されます。初期値はOFF、`Effect Strength`は60%です。スライダーは0〜100%で、0%では元の見た目に戻ります。雰囲気をはっきり確認したい場合は100%へ動かしてください。

上部の光沢のある`YouTube.exe`バーとシルバーのメニュー、下部の薄いステータスバーでページを1つのソフトウェアとして囲みます。動画には現在の動画名を表示する小さなタイトルバーと細い立体枠、再生リストにはタイトルバーと紺地・白文字の選択行を追加します。検索欄は凹んだ枠、ボタンは浮き上がる枠です。サムネイルを含むUIの角はすべて直角にします。動画・画像のピクセル、縦横比、再生操作は変更しません。

YouTubeがダーク表示でも、強さが1%以上なら選んだUI配色を使います（初期値はシルバー）。 動画の外側へ色をにじませるアンビエント背景はテーマ中だけ隠し、映像そのものは変更しません。現在のYouTubeが使う色変数の名前に依存せず、動画周囲・標準アイコン・ロゴの文字部分へ直接色を接続します。強さはUIの明暗や立体感を調整し、0%と全体OFFでは元のYouTubeへ戻します。夜版は未実装です。`Window chrome`をOFFにすると追加したヘッダー、動画／再生リストのタイトルバー、下部バーと時計を撤去し、基本テーマは残します。時計は端末のローカル時刻をHH:MMで表示し、非表示タブではタイマーを停止します。機能設定はテーマOFF後も保持します。

タイトルバー・メニュー・ラベル・時間表示には、同梱したPixelMplus12を本来の12px・通常ウェイトで使います。外部フォントサービスへの通信はありません。動画タイトルは通常のゴシック体14px（再生ページは16px）、コメント本文は13px・通常ウェイトで読みやすくします。フォントの元ライセンスと出典は[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)に同梱しています。OSのロゴやアイコン素材は使いません。

動画プレイヤー右下のアイコン列にも、左端に仮のスライダー型アイコンを追加します。押すと動画の上に設定パネルが開き、同じON/OFFと強さを編集できます。テーマがOFFでも使えます。×ボタン、アイコンの再クリック、Esc、パネルの外をクリックすると閉じます。全画面でもプレイヤー内に表示します。

開いているYouTubeタブすべてに同じ設定を適用します。変更は自動保存され、Popupを閉じても、Chromeを再起動しても維持されます。テーマをOFFにしても、強さの設定は残ります。

## 配色と個人サイト風の表示

設定パネル／Popupの `UI palette` に Silver・Lavender・Mint・Pink と、色相・彩度・明るさのスライダーがあります。標準のSilverは低彩度の淡いグレーです。スライダーの端でもUIの明暗差を確保し、映像や画像にはfilterをかけません。旧バージョンのON/OFF・強さ・Window chromeの値はそのまま保持します。

表示オプションはそれぞれ個別に切り替えて保存できます。

- `Palette colors`: 調整色を使う。OFFでも色の値は保持
- `Glossy titlebars`: 上半分の反射。OFFはフラットな色
- `Active window color`: 実際にフォーカス／クリックした小窓の表示。別タブや別ウィンドウへ移ると解除（初期OFF）
- `Daily tiny details`: 日替わりの小さな顔文字。ヘッダーの安全な余白のみ
- `Faint surface grain`: 背景と装飾のごく薄いディザ（初期OFF）。Noise Strengthで調整。映像の上には重ねない
- `BBS comments`: コメントを罫線と表示順の番号で整理。本文・返信・高評価・日時リンクは元のまま
- `Transparent background`: ページの地色のみ透明化（初期OFF）。本文やカードは読みやすい紙色を維持
- `LCD duration badges`: 再生リストとおすすめ動画の時間を同じ液晶風表示に。ライブ／新着の意味は変更しない
- `Readable comment votes`: コメント高評価数のコントラストを上げる

BBSの番号は現在読み込まれたコメントと返信の表示順で、投稿の永続IDではありません。並び替えや返信の展開で振り直します。信頼できる完全な投稿時刻がDOMにある場合のみ `YYYY/MM/DD(日) HH:mm` を元の日時リンクの隣へ表示し、元データのタイムゾーンを保ちます。一般のYouTubeコメントに正確な時刻がない場合は「4年前」などの元の表示をそのまま残します。相対日時から年月日や時刻を推測しません。

下のステータスバーは実際の高さをレイアウトへ予約します。スクロールや小さいウィンドウで操作部分と重なる場合は、操作を隠さないようバーを一時的に退避します。全画面では外側の装飾を隠します。

ホームのカテゴリバーは、最上部で通常配置へ戻るYouTube本来の動きを保ち、固定時だけ追加ヘッダー分の位置を調整します。Window chromeがONの間は、固定ヘッダーの表示とスクロール時の背景レイヤーを揃え、検索欄やメニューボタンを守ります。OFF／0%ではYouTube本来の自動非表示と背景へ戻ります。

最上部で止めたときだけ検索欄や左メニューが薄くなる透明ヘッダー用CSSに対し、テーマ中の検索枠・文字・アイコンの配色を保護します。他拡張のスクロール判定や背景キャンバスは変更しません。公開ソース由来の再現用CSSと、停止後の待機を含むテストで確認します。これは他拡張全体の互換性や、ログイン済みの個別環境を保証するものではありません。

透明背景は他の背景／ぼかし拡張との併用を考慮した限定的なオプションです。背景画像の一括消去や他拡張のDOM変更はしませんが、任意の拡張との互換性は保証しません。UI配色は `--ww-retro-*`、地色の透明度は `--ww-background-surface-opacity`（0〜1、既定0）から調整できます。この外部指定の変数はテーマOFFでも消去しません。

全体OFF／強さ0%では追加したDOM、属性、CSS変数、監視・タイマーを撤去します。設定値だけは保持し、次にONにしたとき同じ組み合わせで戻ります。

## 開発

クリエイター向け編集の実験は `codex/creator-editor-spike` と専用worktreeで進めます。Popupの「Studioを開く（このタブ）」で、実際のYouTubeを中央にした制作画面を開けます。「デザインを編集（実験）」のクイック編集も維持しています。動画カードの装飾を編集したり、PNG・WebP素材を読み込んで移動・サイズ変更・回転したりできます。レイヤー一覧、ロック、複製、複数選択と一括移動、Undo／Redo、任意のスナップ、整列・等間隔配置にも対応します。GIF・アニメーションWebP・Lottie JSONは、編集画面で再生を確認し、停止・ループ・Lottieの速度を設定できます。

Signal Timeline v2では「モーション → マウスを追いかける」で、遅延・最高速度・加減速・停止距離・移動方向への回転を設定できます。Timelineの「対象」「入力」からマウス位置・距離・角度・速度を位置／回転／不透明度へ接続します。基本配置は保持し、位置と回転にはオフセットを加えます。操作テイクの録画・再生・シーク、別保存にも対応します。操作・構造は [signal-timeline-v2.md](docs/signal-timeline-v2.md)、検証結果と制約は [signal-timeline-v2-verification.md](docs/signal-timeline-v2-verification.md) を参照してください。

円形マスクで画像の一部を照らし、マウスに追従させたり動画の一時停止でフェードアウトさせたりできます。設定は既存の保存・履歴と共通です。構造と操作は [effects-and-signals.md](docs/effects-and-signals.md) を参照してください。

複数素材をグループ化し、階層表示と全体移動・不透明度・共通マスクを設定できます。使い方と制約は [group-layers.md](docs/group-layers.md) にまとめています。素材は拡張専用IndexedDB、デザインはバージョン付きJSONで保存します。使い方は [creator-editor.md](docs/creator-editor.md)、アニメーションの制限は [animations.md](docs/animations.md) を参照してください。実験用worktreeの `dist` は、別のChromeプロファイルへ読み込みます。

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

`test:setup`はe2e用のPlaywright公式Chromiumを`.work/browsers`へダウンロードします。上の例ではテスト用拡張を`.work/test-dist`へ出力します。e2eは独立したブラウザープロファイルを使い、ユーザーのChromeプロファイルは変更しません。CIもunitとe2eを別jobで実行し、タイムアウトはそれぞれ8分と25分です。実サイト・非公開素材・診断ビルドを使う既存のオプトイン検証は、必要な環境変数を指定した場合に実行します。

VRMの通常テストは小さな自作データで描画を確認します。33MiBのVRMは、実GPU環境で`WW_REAL_GPU_VRM=1`を指定した場合にだけ実行します。SwiftShaderなどのソフトウェア描画では実行できません。整形・lintの使い方は[tooling.md](docs/tooling.md)を参照してください。

## エディターをすぐ開く

設定画面の先頭にある「エディターを開く」から制作画面を開けます。「制作モード」をONにすると、拡張アイコンから直接エディターを開きます（初期値はOFF）。表示テーマのON/OFF・強さは、エディター内の「表示設定」から開けます。設定ウィンドウのタイトルバーをドラッグすると位置を覚えます。

Alt+Shift+Eで、制作モードに関係なくエディターを開けます。このキーは提案値です。競合した場合や変更したい場合は chrome://extensions/shortcuts で「エディターを直接開く」を設定してください。追加権限や常時表示の起動ボタンは使いません。

保存先を移す場合は[バックアップ](docs/extension-backup.md)と[マージ後の移行手順](docs/extension-consolidation.md)を先に確認してください。読み込み先案内の統合用下書きは[readme-after-merge.md](docs/readme-after-merge.md)に置いてあります。

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
      tokens.css              既定シルバー・配色トークン・液晶 / 立体枠 / 12pxフォント / 強さ
      surfaces.css            カード / 検索欄 / ボタン / サイドバー
      chrome.css              タイトルバー / メニューバー / ステータスバー・時計
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

Popupまたはプレイヤー設定パネル → `chrome.storage.local` → `storage.onChanged` → content → ThemeController → SiteAdapter / theme、という流れです。content scriptをYouTubeへ静的に登録します。実験エディターのService Workerは、拡張専用IndexedDBへの画像保存と、素材参照を検証したデザイン保存を担当します。権限は`storage`だけで、適用先は`https://www.youtube.com/*`に限定しています。埋め込みプレイヤーとライブチャット専用ページは除外します。YouTube Music、モバイル版、Twitch、Xは対象外です。

ON/OFFと強さは別々のキーに保存します。複数のPopupから異なる設定を変更しても、もう一方の値を上書きしません。初期読込中に届いた変更は読込結果へ合流させ、古い設定への巻き戻りを防ぎます。スライダー操作のたびに保存を始め、Popupを閉じると失われる遅延タイマーは使いません。

YouTube用Adapterが対象要素に`data-ww-surface`を付けます。テーマはYouTubeのセレクタやDOM操作を持たず、この共通属性とCSS変数を使います。

| 共通surface                       | 役割                                   |
| --------------------------------- | -------------------------------------- |
| `page`                            | ページの背景                           |
| `panel`                           | ヘッダーや説明欄などの背景             |
| `frame`                           | レイアウト寸法を変えない内側の枠線     |
| `rounded`                         | サムネイルなどの角丸                   |
| `window` / `titlebar` / `menubar` | ウィンドウの外枠と追加バー             |
| `input` / `button`                | 凹んだ入力欄と立体ボタン               |
| `card` / `section` / `sidebar`    | 動画カードや一覧、サイドバーのボックス |
| `navigation` / `selected`         | ナビゲーションと選択された項目         |
| `text`                            | 説明欄の文字とリンクの色               |

AdapterはYouTubeのライト／ダーク状態を記録しますが、retroはどちらでも同じ選択中のUIパレットを使います。色・影・寸法はCSS変数へ集約しています。ON時だけテーマ用のCSSとDOM監視を有効にし、OFFまたは0%でテーマのCSS、付与属性、CSS変数、Observer、時計タイマーとイベント監視を撤去します。設定UI用のローカルフォントだけはOFFでも必要なため独立して保持します。動画や画像自体の加工、元の要素の移動はしません。

ウィンドウ装飾のDOMとリンク先はAdapterが用意し、見た目は`themes/retro/chrome.css`で指定します。ネイティブのツールバーの高さを読んで、追加した2行分だけページとサイドバーの位置を調整し、画面下部にはステータスバー用の余白を確保します。動画タイトルは文字ノードの変更にも追従し、再生リストの選択状態は元の属性に従います。追加バーが取り除かれた場合は付け直し、OFFまたは0%ではバーと配置変更も撤去します。

Popupとプレイヤー内設定は`settings/markup.ts`と`settings/form.ts`を共有します。テーマ定義の`editorStylesheets`が両方の見た目を指定し、設定画面の配色はサイトのON/OFFや強さにかかわらず読みやすいシルバーに固定します。装飾を変えるときは`themes/retro`、項目を変えるときは共通テンプレートを編集します。

設定アイコンはテーマと別のライフサイクルで配置します。`sites/youtube-player.ts`だけがプレイヤーと右側の操作欄のセレクタを持ち、`settings/panel.ts`はサイトのDOM構造を知りません。プレイヤーが遅れて生成された場合やSPAで交換された場合に配置を確認し、右側の操作欄の先頭へ1つだけ置きます。設定パネルはShadow DOMでスタイルを分け、スライダーのキー入力が動画のシークに伝わるのを防ぎます。通常のデータ更新ではパネルを維持し、ページ遷移やプレイヤー交換では閉じます。

YouTubeの`yt-navigate-finish`と`yt-page-data-updated`で再確認し、追加DOMやID・選択状態の変更は`MutationObserver`で検出します。通常の変更では追加された部分だけを調べ、更新を描画フレーム単位でまとめます。カスタム要素とIDを優先し、一部の新しい部品には名前付きクラスを使います。セレクタはAdapter内に集約しています。

## 追加機能の設計

`features/index.ts`の`FEATURE_REGISTRY`が機能ID、表示名、説明、初期値とライフサイクルをまとめます。`window-chrome`と各配色・表示オプションを登録しています。動画／再生リストの小窓と時計もこの機能のライフサイクルに含みます。各機能は`mount()`でインスタンスを返し、`refresh()`でSPA更新へ追従、`destroy()`で追加DOM・イベント・属性を撤去します。サイト固有の実装はAdapterの`features`に置きます。対応していないサイトでは安全にスキップします。

保存先は`webWorldThemes.features.<id>`という機能別キーです。既存の`enabled`と`strength`キーを変更せず、保存値がまだない場合は機能の初期値を使います。異なる設定画面から同時に操作しても、他の機能の値をまとめて上書きしません。共有フォームのトグルは登録情報から生成します。全体OFFまたは0%では全機能を逆順に解除し、選択した設定自体は保持します。

新機能を追加するときは、機能定義と必要なAdapter capabilityを追加して登録します。YouTubeセレクタをテーマや共通機能へ持ち込まないでください。キリ番・アクセスカウンター・ナイトモードは実装していません。BBSコメントは独立したAdapter capabilityです。

## 検証と現在の範囲

`npm run check`はCSS構文／テーマ境界のlint、TypeScriptの型チェック、ビルド、Playwrightテストを実行します。`tests/features.spec.ts`はブラウザー不要の設定・機能ライフサイクル検証です。ブラウザーテストはMV3拡張機能とChrome Storageの実物を使いますが、YouTubeのページはローカルの検証用DOMへ差し替えます。

対応するChromiumがシステムにある場合は`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`で選べます。既定では`npm run test:setup`で導入したPlaywrightのChromiumを使います。テスト専用プロファイルを作り、ユーザーのプロファイルは変更しません。

ブラウザー起動・実サイト・スクリーンショットの実施状況と制限は`docs/verification.md`を参照してください。過去バージョンのPASSは今回の変更の実測結果を意味しません。デザインの意図は`docs/heisei-design.md`にまとめています。

実験用クリエイターエディターのアニメーション素材コアは[設計](docs/animation-core.md)と[形式・制限・検証記録](docs/animation-core-verification.md)を参照してください。読み込む拡張はこのworktreeの`dist/`です。

クリエイターUIの[再設計](docs/editor-ux.md)と[操作・検証結果](docs/editor-ux-verification.md)をまとめています。一覧のチェックから、キーを使わず複数選択してグループ化できます。

独立StudioはPopupの「Studioを開く（別ウィンドウ）」から起動します。編集対象のYouTubeを選び、Studioで設定しながら実サイトで直接選択・移動できます。サイト内の「デザインを編集」も同じCoreとUIを使います。[構造とDesktop Hostへの境界](docs/studio-foundation.md)、[操作と検証結果](docs/studio-verification.md)を参照してください。実験版は `.work/creator-editor/dist` をChromeへ読み込みます。通常版の `dist` は更新しません。

Chromeの仕様は[Content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)と[Storage API](https://developer.chrome.com/docs/extensions/reference/api/storage)、拡張機能の検証方法は[Playwright公式ドキュメント](https://playwright.dev/docs/chrome-extensions)を参照しています。

主要な制作画面は、Popupの **「Studioを開く（Chromeサイドパネル）」** です。プロパティ／レイヤー／マスク／振る舞いを公式パネルに置き、YouTubeはChromeが変更したビューポートで自然にレイアウトします。ページ内には共通の小型ツールバーと編集ハンドルを表示します。Vは選択・変形、Hはサイト操作、Cは動画カード編集です。

一覧のチェック → グループ化 → プロパティの光とマスク／振る舞い → 保存、の順に制作できます。独立Studio・「従来のインページStudio（切り戻し）」・クイック編集も同じCoreを使います。切替は未保存作品とUndo履歴を維持します。旧インページ方式はブラウザー幅とCSSの予約幅が一致しない制約があるため、通常は公式パネルを使ってください。

[公式パネルの設計・操作](docs/side-panel-studio.md)、[比較画像・検証結果](docs/side-panel-studio-verification.md)を参照してください。拡張を更新後、専用worktreeの `.work/creator-editor/dist` を再読み込みします。今回の追加権限は許可された `sidePanel` のみです。通常版のdistとmainは更新しません。

Signal Timeline v1は、レイヤーを選んで下端の **Signal Timeline → スクロールに接続** から使えます。0%・50%・100%のキーで不透明度を編集し、実スクロールへ追従させられます。明示録画した操作をテイクとして別保存し、再生・逆再生・シーク、波形とルールの投影を確認できます。キーを触った後のPREVIEWからはライブアイコンでLIVEへ戻ります。[設計・操作・制限](docs/signal-timeline-v1.md)、[実サイト・自動テスト・性能の記録](docs/signal-timeline-verification.md)を参照してください。作品はv8へ移行し、旧v1〜v7の読み込みを維持します。
