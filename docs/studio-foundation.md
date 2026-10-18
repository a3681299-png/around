# Studioの独立化

起点は `36ecf34`。現状の `editor/controller.ts` は編集文書、履歴、保存、素材保持とDOMイベントを所有し、`workspace.ts` はChrome Storageを直接参照する。World Runtimeと画像・グループの純粋な計算はすでに分離されている。

## 今回の境界

- **Editor Core**: 選択、宣言的コマンド、文書変更、履歴、編集セッション、保存・破棄と競合判定。DOMやChrome APIを参照しない。幾何情報、ID生成、Storageは引数のポートから受け取る。
- **Studio UI**: 既存のレイヤー／プロパティ／エフェクトを共用する。UI設定の保存も注入する。Studioは全画面の一覧、素材棚、プロパティを使う。
- **Browser Host**: SiteAdapter、DOM選択、ポインター操作、アンカー矩形、Renderer、ライフサイクル。純粋な変形計算は既存Worldモジュールを共用する。
- **Storage Adapter**: 既存のIndexedDB／Chrome Storageとアセットleaseを接続する。DesignDocument v7を変更しない。
- **Communication**: バージョン付きPortメッセージ、対象tab ID、session ID、revision、直列化したコマンドと状態通知。ウェブページへのwindow.postMessage経路や任意コード実行を設けない。

実行中の正本は対象タブのEditor Core一つだけ。StudioとクイックUIは同じコマンドを送る。独立Studioの操作は全機能を別実装せず、既存の編集処理に接続する。Studioの旧リビジョンによる編集は状態を同期して拒否する。同じタブを操作する独立Studioは一つに制限し、クイックUIは共存できる。

## 表示と復旧

Studioを独立した拡張ページ／ウィンドウで開き、実YouTubeをキャンバスとして使う。iframeやページのスクリーンキャプチャは使わない。中央は素材管理と対象の接続情報で、実サイトのライブ映像と誤認させる代替画面を描かない。

Studioは最新の編集文書と履歴を復旧用に保持し、再読み込み時に再接続する。再接続用データは保存済み作品と別のセッションストレージに置く。Undo中の素材も別leaseで保持する。保存済み作品が他から変わった場合は黙って上書きせず、プレビューと最新保存値を区別する。接続を離れたYouTubeでは直接編集を止め、通常操作を戻す。

権限は既存の `storage` のまま。タブIDを列挙し、既存content scriptが応答する対象だけを表示する。ページのURLや閲覧履歴を一括取得しない。[Tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs)と[Portのメッセージ](https://developer.chrome.com/docs/extensions/develop/concepts/messaging)を利用する。

## 段階

1. 純粋なCore・履歴checkpoint・共通ショートカットと境界テスト。
2. Browser Host／Storage Adapterへ既存controllerを接続し、直接編集を回帰確認してコミット。
3. Portと独立Studio、対象管理、双方向編集、復旧、競合、ワークスペース保存。
4. 全体回帰、実YouTube、スクリーンショット、結果と制約を記録してコミット。

Desktop版は今回実装しない。後からStorage、アンカー／ポインター／RendererのHostポート、通信、ウィンドウとファイル選択の実装を追加する。UI、文書コマンド、履歴、World Runtimeを再利用する。OS操作、Electron／Tauri、ペイント、タイムラインは今回の範囲に含めない。
