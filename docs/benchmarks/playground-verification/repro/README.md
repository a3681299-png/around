# 塊1の独立検証の再現

対象は `063845318167ae3c37ccb9ed0e285870a95eefbe`、比較側は `447b2bf31e319051e327f9ada2b83954276b8ff8`。製品ソース・通常の dist を変更せずに実行する。

最上位のリポジトリで以下を実行する。

```powershell
git worktree add --detach .work/playground-v1-after 0638453
git worktree add --detach .work/playground-v1-before 447b2bf
```

各 worktree で `npm ci` と `npm run test:setup` を行う。既存の同一 lockfile の依存関係・Chromium を共用してもよい。この repro 一式を対象側の `.work/verify-tools/` へコピーする。相対 import はこの位置を前提にしている。

両側で自身のビルドスクリプトを使う。

```powershell
$env:WW_BUILD_OUT = '.work/extension'
npm run build
node scripts/ui1/build.mjs . .work/perf
```

対象側で Playground と故障ビルドを用意する。

```powershell
$env:WW_PLAYGROUND_OUT = '.work/playground'
node scripts/build-playground.mjs
node .work/verify-tools/build-faults.mjs
node .work/verify-tools/static.mjs
$env:UI1_PROBE_BUSY_MS = '2'
$env:UI1_PROBE_AFTER_AWAIT = '1'
node scripts/ui1/build.mjs . .work/perf-busy
Remove-Item Env:UI1_PROBE_BUSY_MS
Remove-Item Env:UI1_PROBE_AFTER_AWAIT
```

`static.mjs` は境界違反の一時ファイルを `src/host/` に作り、lint と unit が非ゼロ終了することを確かめ、finally で削除する。禁止素材の検査には名前と文字列だけの合成ファイルを使う。実物の私用素材は使わない。`build-faults.mjs` は esbuild の依存差替えだけを使い、製品ソースの文字列を置換しない。

Windows 全件は `WW_TEST_EXTENSION_PATH` を対象の `.work/extension` に向けて `npm run test:e2e`。workers=1 を維持し、他のブラウザーテストと同時に走らせない。ネイティブ操作を含む全件の前には、キーボードのフォーカスを取ることを伝える。

全件の終了後に `run-extra.ps1` を実行する。正常系、意図的な故障、前後の比較は別の JSON と log に残る。`pg-no-*` はテストが失敗することが期待値。`no-hysteresis` は 300ms の既存下限を保持したテストであり、成功を期待する試験ではない。`timing.spec.ts` は対象の `operation-safety.spec.ts` のコピーに経過時間の console 出力を1行だけ足したもの。

```powershell
npm run test:unit -- --config=.work/verify-tools/config.ts mixed-unit.spec.ts --grep 'verification mixed'
npm run test:unit -- --config=.work/verify-tools/config.ts before-unit.spec.ts --grep 'verification mixed'
& .work/verify-tools/run-extra.ps1
```

`mixed-unit` は体型のあるコピーとないコピーを混ぜた検査。比較版は「全コピーが計測済みなら次の層を足す」の箇所で失敗するのが期待値。

`live.spec.ts` は生成した Playground のキャラ・背景を正式なエディターから読み込んで保存する。共通の decoration データとカード装飾を使い、`siteId` だけを YouTube に変える。Playground 固有の `page` と `primary-heading` の着せ替えルールは除くため、配布 JSON 全体の無変更移植を試すものではない。最初は y=0 で縁の基準を比較し、別の可視性確認では y=0.45 に置く。緊急OFFは popup の正式なボタンを使う。headless のページ内キー送信では Chrome のネイティブな拡張コマンドを起動できないため。

`run-real.ps1` は既存の実サイト試験、`run-resume.ps1` は位置の最終比較と比較側の操作の反復を実行する。`run-take.ps1` は通常版の拡張で実 YouTube に開いた Studio からテイクを録画、保存、再読込する。書き出しファイルは新規プロファイルに拡張のバックアップ画面から復元し、保存された作品とテイクを照合する。どのスクリプトも他のブラウザー試験と並行させない。

性能は、他の検証用ビルド・テストを止めてから、以下を順に実行する。最終採取は `perf-config.ts` を使う。Playwright の自動 trace ZIP は作らず、収集器自身の CDP Tracing を使う。

```powershell
node .work/verify-tools/model-debug-build.mjs
& .work/verify-tools/run-perf.ps1
```

前回の `docs/benchmarks/r31-fix/repro/perf.spec.ts` を使い、比較する worktree とビルド名を変更し、両側に同じ自作の試験用 VRM を読み込む形にした。外部の動作は付けない。校正では await 後の2msの追加負荷を検出する。起動・定常・SPA を分け、AB/BA を交互に4組以上。広告・裏タブ・採取窓・実GPU条件を確認し、背景CPU負荷は参考値にだけ使う。全試行と除外理由を保存する。拡張なしは測らず、作品OFFの動画区間は別に記録する。

`model-debug-build.mjs` は、通常版・プローブ版・2ms版を前後それぞれ作る。追加するのは元からある renderer の error report を DOM の診断属性へ記録するコールバックだけで、描画の許可や停止の判断は変えない。正式採取のフラグは `R31_CAPTURE_MODEL_ERRORS=1`。`R31_MODEL_DIAG` は設定しない。

正式採取を中断した場合は、`resume-perf.ps1` で保存した有効な組を読み直し、未完の組を除いて続ける。再開後は、45秒のナビゲーション上限と各プロファイルの5分の上限を設けた。比較条件や区間の採否は同じ。

最初の採取のコードは `perf-first-attempt.spec.ts`。`performance-first-attempt/` は、対象の VRM 読込失敗を含む2組と途中の3組目で、有効な前後4組として使っていない。自動 trace ZIP を有効にした長い診断では、比較版のブラウザーを閉じるときに Playwright の ZIP 読込エラーも出た。エラー記録だけを追加した通常版／計測版の前後4条件は `model-debug.spec.ts`、元の計測の一巡は `R31_MODEL_DIAG=after` または `before` で採取した。これらの診断値を正式な4組に混ぜていない。

300ms の下限そのものを再確認するには `node .work/verify-tools/build-fast-release.mjs` で作った `.work/fault-fast-release` を `WW_TEST_EXTENSION_PATH` に指定し、`timing.spec.ts --grep 'G1.2 ①②④'` を実行する。製品の閾値を置換せず、依存差し替えで解除履歴の時刻を早め、同じ開発版の起床タイマーも短くしたもの。これは失敗することが期待値。

Chrome は headless または `launchExtension()` の画面外引数で開く。実サイトは未ログインの新しいプロファイルを使う。`PLAYWRIGHT_BROWSERS_PATH` を共用する場合は環境変数で指定する。すべてのテストは `npm run test:unit` / `npm run test:e2e` から実行する。
