# 再実行

対象 `d9fce76`、比較元 `6b54087` を `git worktree add --detach` で別のフォルダへ固定する。依存は各 lockfile の `npm ci --ignore-scripts` で用意する。以下は対象のルートで実行する。製品コードと通常の dist は変更しない。

## 通常ビルドと前回の再現

各 worktree で次を実行する。

```powershell
$env:AROUND_BUILD_OUT='.work/fix-build'
npm run build
$env:AROUND_TEST_EXTENSION_PATH='.work/fix-build'
```

ブラウザーの格納先を共有する場合は `PLAYWRIGHT_BROWSERS_PATH` にその絶対パスを指定する。今回の Chromium は143.0.7499.4。Chromeは全てheadlessで、プロファイルは毎回新しいもの。

前回保存した `docs/benchmarks/g13-verification/repro/g13-pixels.spec.ts` と `g13-geometry.spec.ts` を `tests/g13-fix-pixels.spec.ts` / `tests/g13-fix-geometry.spec.ts` にコピーする。元の操作と判定は変更しない。

```powershell
npm run test:e2e -- tests/g13-fix-pixels.spec.ts
$env:G13_WITNESS='subtree'
npm run test:e2e -- tests/g13-fix-pixels.spec.ts
Remove-Item Env:G13_WITNESS
npm run test:e2e -- tests/g13-fix-geometry.spec.ts
```

lookの比較元は失敗、対象は成功。subtreeは両方成功。geometryは観測の保存用なので、テストの成功だけで矩形が新しいとは判断しない。

## 古い位置の上限

このフォルダの `g13-fix-bound.spec.ts` を `tests/` にコピーする。

```powershell
$env:G13_REALTIME='1'
npm run test:e2e -- tests/g13-fix-bound.spec.ts --repeat-each=2
```

最終版でも2回失敗する。全体を読む→最初の組を読む→その部品をWAAPIで移動→残りの組だけcatch-up→200ms以内に再読する。最後にその部品を読んだ実際の時刻、次の読み取りがその部品を読んだか、snapshotと実際のleft、mutationを添付する。記録用ラベルをdropし、記録自体の属性書き込みを除いた。`G13_REALTIME` を外すと、同じ経路を制御した `performance.now` で確認できる。

この試しはsourceの契約の再現で、描画の画素が隠れることの再現ではない。

## 操作チェックと④

既存の `tests/operation-controls.spec.ts` を変更せず、次を前後で各4ブロック実行する。

```powershell
npm run test:e2e -- tests/operation-controls.spec.ts --grep 'Studio exposes protection overlays' --repeat-each=5
```

順序は `前,後,後,前,前,後,後,前`。リトライなし。今回の待ち切れは前8/20、後0/20。

`g13-fix-editing-history.spec.ts` を前後の `tests/` にコピーし、`--grep 'a covered control'` で実行すると、実際のtabsポートの安全通知と、描画ホストの属性の記録を添付する。操作チェックを開き直して保護範囲をONにし、折りたたんだあともONを保ち、同じ覆いで再停止することも確かめる。

`g13-fix-safety-ui.spec.ts` は対象の `tests/` にコピーして実行する。専用の `.work/fix-build/popup/verification-safety.js` に検証用のバンドルを置く。成功後の閉じる動きとフォーカス、再表示と状態通知、再開失敗を接続のstubで確かめる。

## 性能と見た目

正式比較の変更前は `4d3f39b`。両方の固定したツリーの `scripts/ui1/build.mjs` で `.work/` の計測ビルドを作る。感度確認用だけ `UI1_PROBE_BUSY_MS=2` を指定する。通常のビルドには混ぜない。

このフォルダの `verify-perf.spec.ts` / `verify-config.ts` を対象の `scripts/g13/` にコピーする。前回のプローブにコールバックとフレームのraw保存を足したもの。ソースの置換はしない。

```powershell
$env:G13_CALIBRATE='<通常の計測ビルド>,<2msの計測ビルド>'
$env:G13_PERF='1'
$env:G13_BUILDS='before=<4d3f39bの計測ビルド>,after=<d9fce76の計測ビルド>'
$env:G13_PAIRS='2'
$env:G13_OUT='.work/fix-perf-run'
npm run test:e2e -- --config=scripts/g13/verify-config.ts
```

`fix-visual.spec.ts` / `fix-visual-config.ts` も `scripts/g13/` にコピーして実行できる。前回の2層の実サイトプローブに、DOMを変えないCDP撮影を加えた。`G13_POINTER=near` / `G13_LABEL=fix-near-cdp` を使った。可視性の全記録は `../visual.json`。

## 記録

`node docs/benchmarks/g13-fix-verification/repro/validate-artifacts.mjs` で、圧縮した生記録のSHA-256、22場面のCPU集計、前後各20回の件数、最終の上限違反2件をブラウザーを起動せずに確認できる。

- `../focused.json`：主確認と補助試行のPlaywrightの結果、geometry・画素・上限・UI・受信通知の添付。`safety-ui-after` は道具のCSP失敗、`safety-ui-corrected` が修正後。`resume-tabs-*` と `sparse-bound-no-trace` が最終の再現。
- `../performance.json` / `../calibration.json`：独立計測の要約、各ビルドのコミットとdirty状態、CPU・動画・表示率・参考のrAF間隔。
- `*-raw.json.gz`：省略していないコールバック時刻・時間とフレーム時刻。要約内の `rawArtifact.sha256` は圧縮ファイルのSHA-256、各場面の `rawKey` が展開後のキー。Nodeの `gunzipSync` などでUTF-8のJSONに戻せる。
- `../claude-performance.json`：監査した元の2組。afterはdirty状態で、最終コミットと一致する証拠には使わない。
- `run-focused.mjs` / `run-additional.mjs`：今回の順次実行の手順。対象を `.work/g13-fix-verify`、比較元を `.work/g13-fix-before` に置き、`.work/` にコピーして使う。途中の補助試行も保存したため、最終結果のラベルは本文を参照する。

CIの件数は対象コミットの [run 41748709512](https://github.com/a3681299-png/around/actions/runs/41748709512) から確認した。中間版の失敗は [run 41746176761](https://github.com/a3681299-png/around/actions/runs/41746176761)。全CIログと失敗traceは今回のworktreeの `.work/fix-evidence` / `.work/fix-results` にも保持した。
