# Studio素材のArrayBuffer転送

2026-10-21、依頼C2の実装・検証記録。[依頼Cの実験](studio-import-route.md)を正式なStudio取り込みに採用した。

## 保存・送信元の検証

Studioは元のFileを読み、既存の`readImportFile`で構造・メディアの事前検証を行う。
Chrome Runtimeで転送許可を受けた後、`navigator.serviceWorker.getRegistration().active.postMessage`で
ArrayBufferと返信用MessagePortの所有権をWorkerへ移す。保存後、YouTube Hostには従来どおり`import-assets`で素材IDだけを渡す。

Workerは転送されたバイト列を既存の`importBatch`へ渡す。ハッシュ、`inspectAsset`、モデルのテクスチャ検証、
画像のデコード確認、容量・件数・保存上限、lease付与とIndexedDBトランザクションは同じ実装を使う。
Worker内の検証済みハッシュreceiptとMIME条件も既存どおりで、転送要求から検証済みと指定することはできない。

送信元は次の順に確認する。

1. Runtimeの送信元拡張ID、Studioの正確なURL、トップフレーム、実ドキュメントを確認し、既存の`owner()`で保持先を検証する。
2. ネイティブmessageの送信元ClientがトップフレームのStudioであることを確認し、`clients.get()`のURLを許可元と照合する。
3. 転送された専用ポートにランダムなchallengeを返信する。同じRuntimeドキュメントがchallengeを返し、
   もう一度`owner()`を通った場合だけ、既存の変更キューに保存処理を積む。

ChromeではネイティブのClient IDとRuntimeのdocumentIdは異なる。
また、実サイドパネルのRuntime送信元にはframeId・documentIdが付かないことがある。
その場合に限り、`chrome.runtime.getContexts(SIDE_PANEL)`からURL・トップフレームが一致する一意の実ドキュメントを取得し、
そのdocumentIdで`owner()`を実行する。パネルの再作成でドキュメントが変わると、元の許可は使えない。
ポップアップ、別拡張、子フレーム、別ドキュメント、存在しない保持先は受け付けない。

許可は60秒、未完了の転送は30秒で期限切れにする。許可は最大4件、同時に保持する転送バッファは最大4件・128MiB。
変更キューで実行を待つ間に解放された要求は保存を始めない。

## 再送・中断・予備経路

Fileは保存完了の返信まで保持する。転送済みArrayBufferはdetachされるため、再利用しない。
Worker起動ごとの識別値を1秒間隔のRuntime確認で照合し、返信前にWorkerが再起動したらFileから読み直す。
初回を含めて最大3回とし、繰り返し停止した場合はエラーを表示して終了する。
同じ内容は同じハッシュIDとなり、既存の保存処理がleaseを統合するため、保存後に返信が失われても素材は重複しない。

切断・対象変更時は依頼CのAbortControllerと一時`studio-upload-*` leaseの即時解放を使う。
解放時に未完了の転送許可も取り消し、遅れて届いた転送でleaseが復活することを防ぐ。
保存が先に始まっていた場合も、同じ変更キューの解放処理と既存の`finally`で一時leaseを解放する。

Service Worker API・MessageChannel・転送が使えない場合は、既存の`importAssets`へ戻る。
32MiB以下のJSONと大容量モデルのチャンク経路を残した。予備経路へ切り替える前にバイナリ転送の許可を解放する。
構造・MIME・容量・送信元の検証エラーを予備経路や再送で回避することはない。

既存の`WW_ASSET_PROFILE=1`計測ビルドでは、次のspanで経路と試行回数を確認できる。

- `studio.upload.array-buffer`: 転送バイト数、成功した試行番号。
- `studio.upload.retry`: Worker再起動により再送する試行番号。
- `studio.upload.json-fallback` / `studio.upload.chunk-fallback`: 予備経路。

通常ビルドでは既存どおりプロファイラーは無効。前後計測は通常ビルドを使い、受動的なテスト用観測で
実際の経路、File読取回数、detach、Runtimeアクション、Hostへのメッセージ種別をJSONに記録した。
原本バイト列、転送許可、セッションIDは計測ログに含めない。

## 取り込み開始から反映まで

- 変更前: `7062293`の専用ビルド。変更後: `ff828a1`の専用ビルド。
- Windows、Chromium 153.0.8010.12、Intel UHD Graphics / ANGLE D3D11の実GPU。
- 独立した拡張Studio 1440×1000、YouTube 1100×760。実Chrome拡張APIを使い、YouTubeの文書をローカルfixtureに差し替えた。
- 各素材・各版で新しいChromeプロファイルとプロセスを5回起動。Studioの再読み込みはしない。
  両版に同じ受動的な経路観測を初回ナビゲーション前から設定した。型チェック・e2eと並行実行していない。
- 画像は依頼Cと同じ自作RGBA PNG。1MBは1,000,000 bytes。VRMは同じ原本57,185,776 bytes、54.5366MiB。
  OSのファイルキャッシュ・GPUドライバーのキャッシュは消去していない。
- Nodeの単一の単調時計で、`setInputFiles`開始から、YouTubeの画像ロード完了またはThree rendererの初回表示、
  Studioのレイヤー1件・追加ボタン有効化を確認するまで。Playwrightの操作・確認往復を含む。
- 未丸めの全40試行・SHA-256・実際の使用経路は[計測JSON](measurements/studio-array-buffer-transfer.json)に保存した。
  確認用にStudioを再読み込みした途中の計測は採用せず、依頼Cと条件をそろえた各5回をすべて採用した。

単位はms。

| 素材           | 変更前・中央値 | 変更前・最大 | 変更後・中央値 | 変更後・最大 |
| -------------- | -------------: | -----------: | -------------: | -----------: |
| 1MB PNG        |          139.9 |        165.4 |          113.1 |        154.3 |
| 10MB PNG       |          548.0 |        565.5 |          331.4 |        340.1 |
| 30MB PNG       |        1,304.9 |      1,403.0 |          829.3 |        847.0 |
| 54.5366MiB VRM |        5,860.8 |      6,071.2 |        3,704.6 |      3,790.4 |

変更前の画像は全15回が`legacy-json`、VRMは全5回が`legacy-chunks`。
変更後は全20回が`array-buffer`で、いずれもFile読取1回・転送1回・送信元バッファのdetachを確認した。
Hostへは前後とも素材IDの`import-assets`だけが送られた。
各5回の単一端末での結果であり、実サイト通信・他端末・SwiftShaderでの所要時間は示していない。

依頼Cの実験の約1,040msは、File読取後の転送から検証・保存・返信までの値で、描画を含まない。
ここでは約5,650msだった描画反映までの経路と同じ終点で前後を比較する。
WorkerからYouTubeへの描画用原本取得・初回描画は既存の経路を使い、全体時間に含まれる。

## 回帰確認と範囲

- 型チェック3構成、lint、unit 208件が成功。unit単独の所要時間は4.6秒。
- 手元の関連e2e 32件が成功。実GPUの33MiB VRMオプトインも有効にして確認した。
- 転送先のWorkerが壊れたGLB、PNGのモデルMIME偽装、上限超過、デコードできないPNG・モデルテクスチャを拒否する。
- Studio以外の許可要求・盗用した許可、保持先の偽装、不正な容量・件数を拒否する。
- 実Workerを保存前、および保存後・返信前に停止し、File読取2回・detach済み転送2回・同じハッシュの保存1件を確認する。
- 切断・対象変更・解放後に届く転送で、一時leaseが残留・復活しないことを確認する。
- 独立Studioと実Chromeサイドパネルの両方で転送を確認。保存・Undo/Redo・復旧・タブ別の編集は既存テストが通る。
- APIを無効にした小さな画像と33MiB超VRMで、JSON・チャンクの予備経路を確認する。
  大容量の予備経路テストは保存後の返信で止め、SwiftShaderに大容量VRMの描画を要求しない。

`src/browser/storage-adapter.ts`の素材参照数上限は`ASSET_LIMITS.batchCount`へ置き換え、独立したコミットにした。
ページ内編集画面の転送経路、作品スキーマ、通常版dist、mainは変更していない。
実サイトの通信を含む計測と、既存の明示オプトインである実サイト・専用計測ビルドのテストは今回実行していない。
