# Chrome Side Panel Studio

## 方針と原因の切り分け

起点は 5d544fe。専用 worktree のみで作業する。作品は DesignDocument v7 のまま、作品形式とWorld Runtimeは維持し、Editor Coreは回帰で見つかった選択タイミングだけを最小修正する。IndexedDBの形式は変更しない。

現行インページ Studio は ytd-app を CSS で縮めるが innerWidth は変わらない。YouTube のプレイヤーや関連欄はブラウザー幅を基に計算するため一致しない。動画だけを枠へ合わせる補正では親カラムとの重なりを保証できなかった。

2026-10-18、隔離プロファイルの headed Chromium 153、実 YouTube（ログアウト、指定された動画。YouTube 自身が mix の URL を正規化）で最小パネルを試した。画面倍率を 1 に固定した。

| 外枠幅 | 表示 | innerWidth | player右端 / 関連欄左端 | resize |
| --- | --- | --- | --- | --- |
| 1920 | 通常 | 1904 | 1342 / 1358 | 幅変更時のみ |
| 1920 | retro | 1904 | 1342 / 1358 | テーマ切替では増えない |
| 1920 | 従来Studio | 1904 | 1049 / 1034 | Studio開始では増えない |
| 1920 | 公式パネル | 1518 | 1062 / 1078 | 開閉・幅変更で発火 |
| 1366 | 公式パネル | 964 | YouTubeが一列へ切替 | 同上 |

数値は CSS px、丸めあり。再生・設定・シアター・全画面の中心点で elementFromPoint を検査。公式パネルでは全て対象ボタンに命中した。retro 単独の横方向の重なりは今回再現せず、retro CSS は推測で書き換えない。ログイン時のプレイリストと YouTube の全 A/B レイアウトは未保証。

生データとスクリーンショットは .work/verification/sidepanel-pilot.* に保存。最初の試行では OS の画面倍率と非同期 setOptions による user gesture 消失を検出し、倍率固定・クリック前設定で再測定した。最終 pilot.json のみを採用する。

## 構成

- Chrome Adapter: タブごとに sidePanel.setOptions。ページ読み込み時に準備し、明示的なクリック直後のハンドラーで open。sidePanel だけを権限に追加する。Chrome 120 を維持し、新しい close/onClosed API は必須にしない。
- Studio UI: 既存 Workbench の sidePanel レイアウトを追加。プロパティとレイヤーを上下に同時表示。素材追加・マスク・シグナルは同じフォームとアクション。
- ページ: 同じ Workbench からコンパクトなツールバーだけ表示。ytd-app の幅、動画、関連欄にサイドパネル用の補正 CSS を入れない。直接操作は既存 renderer。
- Communication: 認証済み extension Port と revision 検証を再利用。サイドパネルは URL にある一つのタブへ固定。独立ウィンドウとの切替は編集セッションを引き継ぎ、旧クライアントを解除。同種の二重 Studio は既存の競合防止を維持。
- Recovery: session storage とアセット lease を再利用。side panel の SIDE_PANEL context と URL を照合し（sender.documentId が省略される場合にも対応）、対象タブが生きている間だけ履歴内アセットを保持。保存済み JSON と区別する。

## 順序と検証

1. 最小ネイティブパネルの実サイト比較（完了）。
2. Chrome Adapter と共通 UI の接続。旧インページ・独立 Studio を維持。
3. 切替・接続断・Undo/Redo・保存・全撤去の回帰テスト。
4. 1366 / 1920 / 狭幅、ネイティブパネルリサイズ、シアター・全画面・SPA を実サイトで確認。自動 fixture と実サイトを分けて報告。

ネイティブパネルの幅は Chrome が管理する。アートの座標は実際の viewport / アンカー矩形を使う。サイドパネル幅を作品データに混ぜない。全画面ではページ内ツール・ハンドルを退避して動画操作を優先する。終了・OFF・強さ0%では編集用 DOM/CSS/イベントを解除する。

## 実装された境界

| モジュール | 責務 |
| --- | --- |
| src/browser/side-panel.ts | タブ単位の公式 API 起動・終了、ユーザー操作制約 |
| src/browser/studio-page.ts / studio-client.ts / studio-host.ts | 同じ Studio ページの構成、認証済み Port、切替・再接続 |
| src/studio/workbench.ts / workbench.css | 共通フォームをウィンドウ・インページ・サイドパネル・ツールバーへ配置 |
| src/editor/controller.ts | 一つの Core を維持した表示切替と直接編集 |
| src/sites/youtube-studio.ts | 既存インページ用予約と、動画操作部に重なる小型ツールバーの退避 |
| src/background/index.ts | IndexedDB の既存 lease 管理。パネルの context を確認して復旧素材を保持 |

World Runtime、作品 JSON、asset ID は変更していない。Editor Coreの素材検証中の選択公開タイミングだけを修正した。今回追加した権限は許可された sidePanel のみ。storage と従来の CSP を維持する。Chrome の実装仕様は [公式 Side Panel API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel) を確認した。

## 操作

1. この worktree の dist を拡張として読み込み、拡張と YouTube を再読み込みする。
2. テーマを ON にして Popup の「Studioを開く（Chromeサイドパネル）」を押す。
3. サイドパネル上の素材アイコン／ドロップから追加。一覧のチェックで複数選択し、下のグループ化でまとめる。
4. プロパティの「光とマスク」「振る舞い」で設定し、保存する。
5. V は選択・変形、H はサイト操作。右上の切替アイコンから従来インページ／独立 Studio へ移れる。未保存作品と履歴は同じ Core に残る。

ネイティブパネルの × はパネルを隠す操作。ページ内の小型ツールバーから再表示でき、編集セッションは残る。「編集を終了」は従来の Core の終了処理。動画の全画面ではページのツール・ハンドルを隠す。背の低い画面では小型ツールバーが native controls に重なる間だけ退避し、パネル側のツールを利用できる。

## 回帰中に修正した同期

従来の Host は確定履歴も 25ms 間引いていたため、直接移動直後の Undo が stale revision で拒否される場合があった。一つの操作内の複数 render をマイクロタスクでまとめ、履歴変更・編集終了は最終 snapshot を即時 publish し、通常の座標通知は 25ms のままにした。古い revision や別 owner からのコマンド拒否は維持する。

異なる表示面（独立／サイドパネル）への接続は同一セッションを引き継いで旧クライアントへ handoff を通知する。同じ表示面の二重接続は引き続き拒否する。サイドパネルは対象タブへ固定し、下部にタブ ID を表示する。作品の保存は全タブ共通、未保存 draft はタブ別という既存仕様を保つ。

素材追加では、検証が終わってdraftへ追加するまで新しい選択IDを公開しない。検証中のgeometry snapshotが未確定IDを除去する問題を、遅延validateを使った純粋なCoreテストで再現し、修正前FAIL・修正後PASSを確認した。
