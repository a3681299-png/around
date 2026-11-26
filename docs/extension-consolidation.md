# 拡張の読み込み先をまとめる手順

2026-10-22の依頼G。**今回は統合・削除・mainへのマージを実行していない。** 以下の削除操作は、マージと復元確認の後に利用者が行う。

## 調査した現状

基準ディレクトリは `C:\Users\sm787\GitHub-Projects\web-world-themes`。

| worktree             | ブランチ / 調査開始時のHEAD          | 用途                                |
| -------------------- | ------------------------------------ | ----------------------------------- |
| 基準ディレクトリ     | main / 022a576                       | 通常版。distを含め今回は変更しない  |
| .work/creator-editor | codex/creator-editor-spike / 91e894a | 制作機能の開発・検証。依頼Gの実装先 |
| .work/heisei-preview | detached / 0ff3806                   | 旧平成UIの確認用。distが残る        |
| .work/shell-preview  | detached / 89eea92                   | 旧シェルUIの確認用。distが残る      |

通常版は基準ディレクトリの dist。実験worktree直下の dist は調査時には存在しない。一方、Chrome DefaultのSecure Preferencesには `C:\Users\sm787\GitHub-Projects\web-world-themes\.work\creator-editor\dist` を読み込んだ登録があり、IDは aiknffgfafmhbjfcemhkbemonddapmao だった。これは設定ファイルの登録であり、その時点のChromeウィンドウで実際に有効かは確認していない。通常版IDは今回読めた設定・READMEからは確認できなかった。

直近Fの検証済み出力は .work/creator-editor/.work/f-verified。Gの最終出力は同worktreeの .work/g-verified。**新しいパスへ読み込むと、元の登録の保存先を引き継げるとは限らない。** Chrome上のIDと読み込み元を先に確認する。

F以前にmanifestと成果物が残っていた実験出力は次のとおり。すべて .work/creator-editor/.work/ の子で、今回は削除していない。

| 用途                 | 出力フォルダー                                                                                       |
| -------------------- | ---------------------------------------------------------------------------------------------------- |
| 診断・計測           | asset-profile-dist                                                                                   |
| 整形・CI・MIME検証   | pre-b-dist, final-formatted-dist, ci-fix-dist, vrm-mime-dist, fade-endpoints                         |
| Studio取り込み比較   | studio-import-before, studio-import-after, studio-import-transfer, studio-c2-before, studio-c2-after |
| 素材読み込み・3D比較 | c3-final, c3-read, c4-final                                                                          |
| Editor Core・履歴    | d-editor, d-review-final, d-validated-final, d-wire-final                                            |
| 登録表・スキーマ     | e-final, e2-final                                                                                    |
| ページ描画分離       | f-final, f-final-fixed, f-verified                                                                   |

ほかに計測結果、trace、ブラウザー本体、テスト用Chromeプロファイル、拡張のコピーが .work にある。g-* は今回の検証出力とコピー。worktreeルートのmanifestはソースであり、そのディレクトリ自体は読み込み用ビルドではない。

## 保存先と拡張ID

通常版・実験版のmanifestは共に name=Around、version=0.1.0。固定ID用のkeyはない。名前では識別できないので、chrome://extensions のデベロッパーモードでIDと読み込み元を記録する。テストでも同じビルドを異なる絶対パスへ置いて異なるIDになることを確認する。

| 保存先                                                                        | 内容                                       | IDとの関係                                                   |
| ----------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------ |
| chrome.storage.local: around.enabled / strength / noiseStrength / creatorMode | 表示設定・制作モード（制作モードはGから）  | 拡張IDとChromeプロファイルに固有                             |
| 同: around.features.\<id\> / palette.hue,saturation,brightness                | 表示オプション・配色                       | 同上                                                         |
| 同: around.design.\<siteId\>                                                  | 保存作品。現在は1サイト1作品               | 同上                                                         |
| 同: around.creator.guideDismissed                                             | 制作ガイド                                 | 同上                                                         |
| 同: around.studio.workspace.v1 / workbench.v2 / sidepanel.v1 / timeline.v1    | 制作画面の配置・開閉・タイムライン         | 同上                                                         |
| 同: around.settings.position.v1                                               | 設定ウィンドウ位置（Gから）                | 同上                                                         |
| chrome.storage.session: around.studio.session.\<targetTab\>                   | 下書き・履歴の接続復旧checkpoint。6MiB上限 | 拡張ID・ブラウザーセッション・対象タブに依存。移行しない     |
| IndexedDB around-assets v1 / assets                                           | 原本Blob・SHA-256由来ID・メタデータ・lease | chrome-extension://\<拡張ID\> のオリジン・プロファイルに固有 |
| IndexedDB around-signal-takes v1 / takes                                      | id, chars, updatedAt, take                 | 同上                                                         |
| Worker / Content内のMap・ArrayBuffer・GPU資源                                 | 転送許可、検証済みの印、原本キャッシュ等   | メモリのみ。再承認・再検証で作り直す                         |
| Chrome側のsidePanel設定・ショートカット                                       | 対象タブ・パネル、キー割り当て             | Chrome管理。バックアップ外                                   |

chrome.storage.sync、独自localStorage、外部サーバー保存は使っていない。通常版mainは設定だけを持つ古い実装。実験版の素材・作品・テイクを別IDから自動では読めない。Chrome Local Storageは拡張の削除で消えるため、先に書き出す。[Chrome Storage API](https://developer.chrome.com/docs/extensions/reference/api/storage)、[Storage and cookies](https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies)。

## 統合先の案

**通常版の既存パス `C:\Users\sm787\GitHub-Projects\web-world-themes\dist` を統合先として維持する。** マージ後はここだけを常用向けに更新する。フォルダーを移さず、通常版のIDと設定を保てる可能性を優先する。実際のIDは再読み込み前後に確認する。

実験worktreeと既存出力は、復元と数日間の利用確認が終わるまで残す。開発継続時も同worktreeを残し、検証は .work/test-dist 等の固定出力と隔離プロファイルで行う。常用Chromeへ毎回違う計測ビルドを追加しない。統合確認後は実験版を先に無効化し、問題がなければ削除する。worktree整理は最後にする。

## マージ後の操作順

### 1. 元の状態を確保

1. chrome://extensions で各登録のID、読み込み元、有効/無効を記録する。Chromeプロファイルも記録する。f-verified等を実際に読み込んでいれば、そのIDも別物として扱う。
2. 作品とテイクを保存する。未保存の編集・Undo履歴・タブ復旧情報はバックアップ対象外。未保存のまま移行しない。
3. **旧ビルドには新しい書き出し機能がない。** 更新前の保険が必要なら、Chromeを完全終了し、プロフィールフォルダーを安全な場所へコピーする。場所は chrome://version の「プロフィール パス」で確認する。元を移動・削除しない。コピーには閲覧情報等も含まれるので共有しない。
4. 現在の読み込み元のビルドフォルダーも別名へコピーする。元のフォルダーを改名しない。

戻すとき: 元の登録・パス・プロフィールをそのまま使う。この段階では何も削除していない。

### 2. 同じIDのまま書き出し機能を使う

1. mainへのマージを完了し、READMEに readme-after-merge.md の下書きを反映する。依頼Gではマージしない。
2. 通常版は**今の絶対パスのdistへ**ビルドする。Chromeでは既存カードの「再読み込み」を使う。別パスを「パッケージ化されていない拡張機能を読み込む」で追加しない。IDが同じことを確認する。
3. 実験版も**現在登録されている同じ絶対パスへ**、マージ済みソースをビルドする。登録元が .work/creator-editor/dist ならそのworktreeで AROUND_BUILD_OUT=dist。登録元が同worktreeの .work/f-verified なら AROUND_BUILD_OUT=.work/f-verified。旧ビルドは先にコピーしておく。
4. 各カードとYouTubeを再読み込みする。テーマの重複を避け、書き出す対象だけ有効にして順に操作する。各拡張の「作品と設定のバックアップ」から別々のファイルへ保存する。通常版の設定もバックアップする。
5. 専用ページのIDが記録と一致し、ファイルが保存済みであることを確認する。隔離プロファイルへ同じビルドを読み込み、ファイルの確認・復元まで試す。

マージ後のPowerShell実行例:

```powershell
Set-Location -LiteralPath 'C:\Users\sm787\GitHub-Projects\web-world-themes'
$env:AROUND_BUILD_OUT = 'dist'
npm run build
# 実験版も登録元の絶対パスを確認してから、そのworktreeで出力先を指定する。
```

戻すとき: 旧ビルドのコピーを**元の読み込み先**へ戻し、同じカードを再読み込みする。今回DBバージョン・作品保存形式は変えていない。退避プロフィールは最後の復旧手段として残す。

### 3. 通常版へ読み込む

1. 通常版を有効、実験版を無効にする。編集タブとStudioを閉じる。実験版はまだ削除しない。
2. 通常版の専用ページで実験版のファイルを選ぶ。設定を移すならチェックを付けたまま、通常版の設定を残すなら外す。
3. 「内容と衝突を確認する」で件数と日時を確認し、「確認したバックアップを読み込む」を押す。エラーを削除で解消しようとせず、メッセージと元ファイルを残す。
4. 同サイトの異なる保存作品は衝突する。1サイト1作品なので自動合成はしない。両方のファイルと旧プロフィールを保管し、通常版に既存作品があれば先に隔離プロファイルへ実験版を復元して採用先を決める。バックアップ機能は既存作品を上書きしない。
5. YouTubeとStudioを再読み込みし、通常表示、各素材、マスク、Signal Timeline、保存テイクを確認する。読み込み後の新しい編集についてUndo/Redoと保存・破棄を確認する。旧IDのUndo履歴は持ち込まない。
6. 制作モードON/OFFと表示設定への行き来を確認する。chrome://extensions/shortcuts で「エディターを直接開く」を確認する。Alt+Shift+Eは提案キー。衝突時はここで変更する。

戻すとき: 通常版を無効、元の実験版を有効にする。元のIDに保存済みデータが残っている。移行先を消してやり直す必要はない。再試験には別プロファイルを使える。

### 4. 利用確認後に整理

1. 数日間、統合先だけで使う。通常版から新しいバックアップも書き出す。旧ファイル・プロフィール・ビルドのコピーを保管する。
2. 旧実験版・旧プレビューのIDを照合し、不要な登録だけChromeで削除する。**削除したIDの保存データが消える可能性がある。** 統合先のカードを取り違えない。
3. worktree一覧と変更を確認する。必要なら実験worktreeを残す。不要ならバックアップと未コミット作業がないことを確認して git worktree remove を使う。エクスプローラーで先に消さない。Gitが拒否した場合は強制削除しない。
4. 旧プレビュー、過去の出力・trace・テストプロフィールも、Chrome登録元でないことを確認し、利用者が個別に整理する。今回は自動削除スクリプトを作っていない。

削除後に戻すとき: 元の絶対パスでソースをビルド・読み込み直し、バックアップを復元する。**同じIDに戻っても削除前のデータが復活する保証はない。** 検証済みファイルと退避プロフィールを使う。

検証・衝突・I/O障害時の制約は [extension-backup.md](extension-backup.md) を参照する。
