# G1.3 独立検証の再実行

検証対象は `66c2719`、比較元は `4d3f39b`。それぞれ detached worktree に固定し、lockfile と同じ依存関係を用意する。計測ビルドは `node scripts/ui1/build.mjs . .work/g13-probe` で各 worktree の `.work` に作る。通常の dist は使わない。

各コマンドの出力は `../logs.json` にファイル名をキーとした文字列として保存した。文字列を取り出せば元の改行と空白を含めて読める。

`g13-pixels.spec.ts` と `g13-geometry.spec.ts` は対象 worktree の `tests/` にコピーし、`npm run test:e2e -- tests/g13-pixels.spec.ts` のように実行する。`AROUND_TEST_EXTENSION_PATH` に対象の通常ビルドを指定する。同じテストを変更前と後にかける。pixels は変更前成功、変更後失敗を期待する。`G13_WITNESS=subtree` は追加の参考条件。画像は CDP で撮る。Playwright の通常のスクリーンショットでは撮影用の一時的な DOM 変更がガードを動かすため、短い区間の再現を変えてしまう。

`g13-operation-controls-diagnostic.spec.ts` は同様に `tests/` にコピーする。元の `operation-controls.spec.ts` の対象テストをコピーし、入力を capture で記録し、失敗時に Studio と模擬ページの状態を trace に添付する。`--grep 'Studio exposes protection overlays' --repeat-each=5` を使い、前後を `before, after, after, before, before, after, after, before` の順に5回ずつ実行した。操作や待ちの条件は変えていない。

`g13-signal-trace.spec.ts` は `tests/` にコピーし、`AROUND_LIVE_SIGNAL_TIMELINE=1`、`AROUND_GUARD_TRACE=1` で別途作った記録用ビルドを `AROUND_TEST_EXTENSION_PATH` に指定する。通常テストの判定はそのままで、ホイール中の全フレームと geometry ログを追加保存する。通常ビルドでの3回は元の `tests/signal-timeline-live.spec.ts` をそのまま使う。各回の `.work/verification/signal-live.json` は上書きされるので実行後すぐ別名で保存する。

`verify-*.ts` は対象 worktree の `scripts/g13/` にコピーする。`verify-config.ts` と `verify-perf.spec.ts` は正式な場面を維持し、各フレーム間隔、動画統計、各起動前1秒の PC 全体の CPU 使用率を追加記録する。`G13_CALIBRATE` に通常と `UI1_PROBE_BUSY_MS=2` の計測ビルドを指定して感度を確認し、`G13_PERF=1`、`G13_BUILDS=before=<path>,after=<path>`、`G13_PAIRS=6`、`G13_OUT=.work/g13-final` で本計測する。実行は `npm run test:e2e -- --config=scripts/g13/verify-config.ts`。

`verify-playing-config.ts` と `verify-playing.spec.ts` は同じ作品を使い、動画をミュートして `play()` 後に再生中と時刻の進行を確認する。`verify-no-extension-config.ts` と `verify-no-extension.spec.ts` は拡張なしの参照。いずれも生のフレーム時刻と動画の前後値を残す。CPU の合否は動画を停止していた6組で判定し、再生中の比較は別の結果として扱う。

すべて未ログインの新規プロファイルを使う。Windows のローカル実行では `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` に実行時と同じ Chromium を指定できる。Chrome の窓は headless または `AROUND_TEST_WINDOW_OFFSCREEN=1` の画面外に置く。ブラウザーテストは1件ずつ実行する。
