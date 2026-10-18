# Chrome Side Panel Studio

## 方針と原因の切り分け

起点は 5d544fe。専用 worktree のみで作業する。作品は DesignDocument v7 のまま、Editor Core / World Runtime / IndexedDB は変更しない。

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
- Recovery: session storage とアセット lease を再利用。side panel の documentId を検証し、対象タブが生きている間だけ履歴内アセットを保持。保存済み JSON と区別する。

## 順序と検証

1. 最小ネイティブパネルの実サイト比較（完了）。
2. Chrome Adapter と共通 UI の接続。旧インページ・独立 Studio を維持。
3. 切替・接続断・Undo/Redo・保存・全撤去の回帰テスト。
4. 1366 / 1920 / 狭幅、ネイティブパネルリサイズ、シアター・全画面・SPA を実サイトで確認。自動 fixture と実サイトを分けて報告。

ネイティブパネルの幅は Chrome が管理する。アートの座標は実際の viewport / アンカー矩形を使う。サイドパネル幅を作品データに混ぜない。全画面ではページ内ツール・ハンドルを退避して動画操作を優先する。終了・OFF・強さ0%では編集用 DOM/CSS/イベントを解除する。
