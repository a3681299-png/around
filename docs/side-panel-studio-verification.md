# 公式サイドパネル Studio 検証

2026-10-18。起点 5d544fe、専用 worktree / codex/creator-editor-spike。設計と操作は [side-panel-studio.md](side-panel-studio.md)。

## 原因と改善

通常の YouTube / retro のみ / 旧インページ / 最小公式パネルを、隔離した headed Chrome for Testing 153 で比較した。旧インページは CSS で app 幅を縮めても innerWidth が変わらず、1920px 外枠では player 右端 1049px が関連欄左端 1034px を超えていた。通常と retro 単独では約16pxの間隔があった。retro 単独では問題を再現せず、そのCSSは今回変更していない。

公式パネルでは Chrome 自身が viewport を縮小する。制作 UI の移行後も通常の YouTube の幅計算を利用できることを確認した。動画／関連欄を押し込む新しい補正 CSS は追加していない。小型ツールバーと編集ハンドルは既存 UI / renderer を利用する。

## 実 YouTube

指定された MV の公開 URL を使用、ログアウト環境。mix パラメーターは YouTube 自身が正規化した。OS の画面倍率とは分け、ブラウザーの device scale を1にして実ウィンドウ外枠を1366・1920・1000pxへ変更した。page.setViewportSize や合成 resize イベントで代用していない。

| 外枠幅 / モード | innerWidth | resize累計 | player右端 | 関連欄左端 | 中心点のhit test |
| --------------- | ---------- | ---------- | ---------- | ---------- | ---------------- |
| 1366            | 964        | 1          | 949        | 一列へ切替 | 4ボタンとも命中  |
| 1920            | 1518       | 2          | 1062       | 1078       | 4ボタンとも命中  |
| 1000            | 598        | 3          | 583        | 一列へ切替 | 4ボタンとも命中  |
| theater         | 1518       | 4          | 1503       | 1078       | 4ボタンとも命中  |

シアターでは関連欄がプレイヤー下へ移るので左右端を比較しない。境界には1.1pxの丸め許容を設け、操作部の命中を別に検査する。シアターの操作ボタン下端は関連欄上端より上にあり、操作部を覆わない。

実サイトで確認できた項目:

- 公式 sidePanel.open による表示、YouTubeのビューポート縮小・resize、主要4ボタンの矩形と elementFromPoint。
- 3枚の素材を読み込み、同一プレイヤーアンカーへ変更、グループ化、円形マスク、マウス追従。
- YouTubeの再生／一時停止ボタンを実クリックし、動画再生状態に応じたマスクのフェード。
- 設定・シアター・全画面ボタンの実クリック。全画面中はページ内ツールバーと編集ハンドルを退避し、終了後に復帰。
- スクロール時のプレイヤーアンカー追従、検索SPA・戻る操作。
- 保存後のYouTube再読み込み、3素材とグループ／マスクの復元。
- 強さ0%で装飾・編集用DOM・イベント／レイアウト予約の撤去。

実サイトテストは明示的に WW_LIVE_SIDE_PANEL=1 として実行し、成功した最終 run の completed=true と各チェックを .work/verification/sidepanel-live.json に残した。最終のアセット保護修正を含む実サイト＋fixture 4件は42.7秒でPASS。初期に見つかった不具合と失敗試行は成功扱いしていない。

サイドパネル内のフォーム／コマンドは本物のネイティブ WebContents に CDP で接続し、DOMイベントで検証する。YouTube側のボタンは Playwright のマウス操作と hit test で確認している。ネイティブパネルを通常のタブへ置き換えたfixtureではない。

## fixtureと全体回帰

- 新規4件（最終状態）: 同じ draft、直接移動とUndo/Redo、グループマスク、保存／再読み込み、独立Studioへの引き継ぎ、旧インページへの切替、2タブの分離、OFFと0%、小型ツールバーの操作部退避、実際のaction Popupからの起動。
- 遅れて届く空の復旧leaseを明示的に再現し、ページ側leaseだけでも原本素材が保持されることを検査。これは隔離fixtureだけの操作。
- 既存独立Studioと合わせた10件は33.9秒、新規の追加保護を含む3件は14.0秒でPASS。
- 最初の全体254件は246 PASS・8件のopt-in SKIP（9.5分）。最終Core修正後の全256件は248 PASS・8件のopt-in SKIP（9.4分）。失敗なし。実YouTubeの最終再検証は16.8秒でPASS。型チェック（アプリ／World Runtime／Editor Core）、lint、ビルドはPASS。

Coreの取り込み検証中にsnapshotが走ると選択IDが消える問題も修正。旧コードで確実にFAILする遅延validateの単体テストを追加し、修正後はCore9件＋公式パネル4件が17.7秒でPASSした。検証前の新レイヤーIDを公開しなくなったため、リサイズ／geometry snapshotが割り込んでも取り込み後の選択が維持される。

ヘッド付きChromeを使うため、Linux CIには[Playwright公式の方式](https://playwright.dev/docs/ci)に沿ってXvfbを追加した。実際のLinux CIジョブはこのWindows環境では未実行。action.openPopupはChrome127以降のテスト用APIとしてのみ使用し、製品のminimum_chrome_versionは120のまま。

## 残る確認

- Chromeネイティブの境界線をマウスでドラッグする検証。Computer Useで検証用ウィンドウを取得すると「window id ... no longer belongs to Chrome; current owner is Chrome」となり、list_windowsから一度再取得しても失敗した。ドラッグを実施したとは扱わない。
- ログイン中のプレイリスト、YouTubeの全A/Bレイアウト、他のDPI／Chromeバージョン。添付画像と同じログイン状態での再現は未確認。
- ブラウザー再起動をまたぐ未保存draftの復旧は従来のsession storageの範囲外。保存済み作品は既存ストレージで保持する。
- 従来インページ方式は切り戻し用で、CSS予約幅の制約を残す。

Chromeが管理するパネル幅の変更は viewport / player の既存観測経路で再評価される。今回実測したのはネイティブパネルの開閉と、パネルを開いたままの実ウィンドウ幅変更。手動ドラッグの確認とは区別する。

復旧データとUndoに必要なアセットは既存lease管理で保持する。追加の強制削除案は採用せず、モード切替で有効な保持を外さない構成にした。

## 画面の比較

いずれも実YouTube、同じ1920px外枠。キャプチャはWebContents単位のため、改善後はYouTubeと公式パネルを別画像で示す。疑似キャンバス／iframeではない。

| 変更前: 旧インページ                                                | 変更後: YouTube                                                                  |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| [旧インページ](screenshots/sidepanel-studio/before-inpage-1920.png) | [公式パネル利用時のYouTube](screenshots/sidepanel-studio/after-youtube-1920.png) |

[改善後のプロパティ／レイヤー](screenshots/sidepanel-studio/after-panel-1920.png) · [狭いウィンドウ](screenshots/sidepanel-studio/after-youtube-narrow.png)

## 分離確認とコミット

- main = 022a576e5fb486b5c2fe5632feee66fcb018c953、クリーン。
- 通常版distは作業前後12ファイルのSHA-256が一致。ビルド出力は専用worktreeのdistのみ。
- 権限はstorage + 許可されたsidePanel。追加host permission、外部スクリプト、バックエンド、生成AIはない。
- 7fb0b8d: 最小パネルの実測と設計。
- f43417e: 共通UI、ネイティブパネル、切替、同期、操作テスト。
- c93afaa: 復旧処理から有効なページ側アセットleaseを保護する修正と回帰テスト。

- fdab92f: 素材検証中の選択を確定後に公開し、一操作の最終snapshotを同期する修正。
