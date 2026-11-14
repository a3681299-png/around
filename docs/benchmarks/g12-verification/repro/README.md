# G1.2 独立検証プローブの控え

実行元はリポジトリの `.work/g12v-probes/`。ここにあるファイルは、実際に動かしたプローブの控えで、製品と既存テストを修正するものではない。相対 import と出力先を保つため、このディレクトリーから直接実行せず `.work/g12v-probes/` にコピーする。

## 準備

1. 対象 `67ad03d` の checkout を使い、依存をインストールする。
2. `.work/g12-557/` に `557b978` の独立 checkout と依存を用意する。
3. `.work/g12v-preindex/` に `2acc2b5` を取り出す（unit の全件走査側）。
4. このディレクトリーの `.ts`・`.mjs` を `.work/g12v-probes/` にコピーし、`.work/g12v-evidence/` を作る。
5. trace build は `AROUND_GUARD_TRACE=1`・`AROUND_BUILD_OUT=.work/g12v-trace` で対象の `npm run build` を実行する。通常の dist を上書きしない。

## 実行

```powershell
npm run test:unit -- --config=.work/g12v-probes/config.ts
$env:AROUND_TEST_EXTENSION_PATH=(Join-Path $PWD '.work/g12v-trace')
npm run test:e2e -- --config=.work/g12v-probes/config.ts --grep 'same-frame' --trace=off
$env:AROUND_LIVE_SIGNAL_TIMELINE='1'
npm run test:e2e -- tests/signal-timeline-live.spec.ts --trace=off
```

既存の live test は3回別々に実行し、毎回上書きされる `.work/verification/signal-live*.json` を退避した。

独立の目視は `G12V_VISUAL=1`・`G12V_LABEL=current` で `--grep 'real YouTube visual'`。変更前は `AROUND_TEST_EXTENSION_PATH` を変更前のビルドへ、label を `before-557b978` へ変える。テスト内の assertion は比較の判定ではなく、撮影の前提と記録の完了を確かめるもの。近い/遠い層の最終判定は画像と JSON を読んで行う。

性能は、各 checkout の `scripts/ui1/build.mjs` で `.work/g12v-perf/` を作る。+2ms校正版は対象で `UI1_PROBE_BUSY_MS=2`、出力 `.work/g12v-perf-busy/`。環境変数を戻して `G12V_PERF=1`、`--grep 'independent four alternating'` を実行する。新旧の入力・作品・URLは `perf.spec.ts` にある。`G12V_PROFILE=1`・`--grep 'one profiled'` は別回の profile 用。これらは既存の閾値判定付きテストではなく計測プローブで、取得成功を性能合格と数えない。

`analyze.mjs` は保存済みの JSON を要約する。`artifacts.mjs` は保存済み画像の HTML 一覧を headless Chromium で撮影する。後者を単独で使うときは `PLAYWRIGHT_BROWSERS_PATH=.work/browsers` を指定する。初期の性能条件と、最終の条件は報告で区別している。初期のプローブは最終版で上書きしたが、その生データは `performance-initial.json` に残している。
