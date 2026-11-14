# G1.3 ②の再実行

対象は `20ffdc3`、機能の比較元は `af4fd0b`。それぞれ `git worktree add --detach` で別のフォルダへ固定する。依存は各lockfileの `npm ci --ignore-scripts` で用意する。製品コードと通常のdistは変更しない。

## ビルドとブラウザー

各ルートで次を実行する。

```powershell
$env:AROUND_BUILD_OUT='.work/bound2-build'
npm run build
$env:AROUND_TEST_EXTENSION_PATH='.work/bound2-build'
```

既存のブラウザーを共有するなら `PLAYWRIGHT_BROWSERS_PATH` にその格納先を指定する。今回の実行は153.0.8010.12、headless、新規プロファイル。実装者の保存した性能2組は143.0.7499.4だった。

## 前回の上限とG1

対象に入っている `tests/g13-fix-bound.spec.ts` が時計制御と実時間の両方を実行する。比較元では同じファイルを `tests/` にコピーする。前2失敗、後2成功。

G1は以下を順番に実行した。全e2eは回し直さない。

```powershell
npm run test:e2e -- tests/g13-fix-bound.spec.ts tests/g13-sparse-visual.spec.ts tests/operation-safety.spec.ts tests/g13-look-regression.spec.ts tests/operation-controls.spec.ts tests/operation-editing-input.spec.ts tests/page-marks.spec.ts
npm run test:unit -- tests/answer-check.spec.ts
```

## 独立した追加条件

このフォルダの4つの `g13-bound2-*.spec.ts` を対象の `tests/` にコピーして実行する。

- `g13-bound2-independent.spec.ts`：DOM上のsourceを、組の時刻表を参照しない別の判定で調べる。部品数を1→5→6→7→31→120→240→3に変え、96条件・2,304回、不規則に読む。同じsourceで候補が増減する。後は違反0、前は18回違反。
- `g13-bound2-background.spec.ts`：実際の非表示タブと復帰。使い捨てのheadless Chromeを自分で起動し、Playwrightの公開 `noDefaults: true` で接続する。通常fixtureの実行ファイル指定を尊重し、拡張と同じ模擬ページを使う。最後に自分のChromeだけを終了する。通常のPlaywright接続はフォーカスを模擬して非表示にならないため、そのままではこの確認にならない。
- `g13-bound2-visual-pixels.spec.ts`：元の実描画に、部品全体の画素比較を足したもの。最後に作者の層だけを隠した参照画像と照合する。これは全フレームの記録が終わったあとに行い、元の再現の途中を変えない。前失敗、後は差0/2,800画素で成功。
- `g13-bound2-idle-visual.spec.ts`：**後も失敗する残件**。元の520/620msの入力を1,400/1,500msへ遅らせ、1,000msで画像を保存する。動いた部品が次の入力まで絵に隠れる。入力前2,800/2,800画素が参照と違い、入力後は差0。前でも失敗する。

```powershell
npm run test:e2e -- tests/g13-bound2-independent.spec.ts tests/g13-bound2-background.spec.ts tests/g13-bound2-visual-pixels.spec.ts tests/g13-bound2-idle-visual.spec.ts
```

残件の原因を記録するときだけ `AROUND_GUARD_TRACE=1` と `AROUND_BUILD_OUT=.work/bound2-trace` で別ビルドを作り、`AROUND_TEST_EXTENSION_PATH` に指定する。テストはソースの文字列を置き換えない。`idle-geometry.json` の `origin` と `geometry[].at` から再現区間の時刻を読める。記録用属性を除いた通常ビルドでも2回失敗しており、記録自体で作った隠れではない。

## 性能

正式な比較元は `4d3f39b`。固定した前後のツリーで各自の `node scripts/ui1/build.mjs . .work/<名前>` を使い、計測ビルドを作る。感度確認用の2ms版だけ `UI1_PROBE_BUSY_MS=2` を設定する。

`verify-perf.spec.ts` / `verify-config.ts` を対象の `scripts/g13/` にコピーする。

```powershell
$env:G13_CALIBRATE='<通常の計測ビルド>,<2msの計測ビルド>'
$env:G13_PERF='1'
$env:G13_BUILDS='before=<4d3f39bの計測ビルド>,after=<20ffdc3の計測ビルド>'
$env:G13_PAIRS='2'
$env:G13_OUT='.work/bound2-perf-run'
npm run test:e2e -- --config=scripts/g13/verify-config.ts
```

今回の2組は前→後、後→前。開始前のCPUを1秒×10回、各起動前も1秒記録した。途中で負荷が上がったことも含め、組は追加・除外していない。動画は停止中だった。

`fix-visual.spec.ts` / `fix-visual-config.ts` は実YouTubeの見た目用で、同じく `scripts/g13/` にコピーする。`G13_POINTER=near` / `G13_LABEL=bound2-near` を使った。CDP画像と全フレームの記録を保存する。

## 保存した根拠

- `../focused.json`：各実行の件数、失敗、添付データ。`g1`、`independent-after`、`background-matching-browser`、`pixels-after`、`idle-visual-confirmed` / `idle-visual-trace` が本文の主な根拠。`background-*` の準備失敗も残した。
- `../environment.json`：対象・比較元・CI・OS・Node・実際のブラウザー。
- `../performance.json` / `../calibration.json`：独立した2組と感度確認。`rawKey` が全コールバックの保存キー。
- `*-raw.json.gz`：全てのフレーム時刻と拡張コールバックの時刻・所要時間。要約の `rawArtifact.sha256` は圧縮ファイルのSHA-256。
- `../claude-performance.json`：監査した実装者の2組。
- `../cpu-before.json`：今回の開始前の負荷。各起動前の値はperformanceの `hostCpuBefore`。
- `../youtube-visual.json`：実サイトの全フレームの表示記録。
- `validate-artifacts.mjs`：ブラウザーを起動せず、生データのSHA、CPU22場面の再集計、96条件の上限、実際のvisibility、長い待ちの全画素差を照合する。

元の全CIログと失敗のPlaywright traceは検証worktreeの `.work/evidence` / `.work/extra-results` に保持した。CIは指定の [41761659925](https://github.com/a3681299-png/around/actions/runs/41761659925)。製品・tests・scriptsが対象と一致することも確認した。
