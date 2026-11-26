# G1.4 検証の再現

対象は `ed03b29c75e7997fa13d1d781350e84751131c1a`、比較元は `20ffdc360df7d6a013cbfde595aa62cc138ca413`。映像上の絵の比較だけ `4d3f39b8707db63de81466d7cba4f833dde979d9` も使う。製品コードと通常の dist を変更しない。

## 準備

リポジトリの下へ `git worktree add --detach .work/g14-verify ed03b29`、同様に `.work/g14-before` と `.work/g14-g12-before` を作る。各ツリーで `npm ci --ignore-scripts --no-audit --no-fund`。ブラウザーは `PLAYWRIGHT_BROWSERS_PATH` に共通の Chromium の保存先を指定する。今回の版は `153.0.8010.12`。

各ツリーで `$env:AROUND_BUILD_OUT='.work/g14-normal'; node scripts/build.mjs`。以下は検証ツリーを作業ディレクトリにする。`repro/g14-extra`、`repro/g14-live`、`repro/g14-perf` をそれぞれ `.work/` へコピーする。ビルド用の `build-faults.mjs` と `build-record.mjs` も `.work/` へコピーする。`.work/<名前>/` に置いたときだけ、テスト内の相対 import が検証ツリーの helpers を指す。

## Windows 全件・長い待ち

```powershell
$env:AROUND_TEST_EXTENSION_PATH='.work/g14-normal'
$env:PLAYWRIGHT_JSON_OUTPUT_NAME='.work/evidence/windows-all.json'
npm run test:e2e -- --reporter=list,json --output=.work/windows-all
$env:PLAYWRIGHT_JSON_OUTPUT_NAME='.work/evidence/timing20-complete.json'
npm run test:e2e -- tests/g14-idle-recheck.spec.ts --grep 'silent move stays' --repeat-each=20 --reporter=list,json --output=.work/timing20-complete
```

全件には画面外の native Chrome の試験がある。実行前に、1〜2分キーボードのフォーカスを取ることを利用者へ伝える。各回の `sparse-visual.json` と `native-pixel-comparison.json` は JSON reporter の attachments に入る。`analyze.mjs timing <report.json>` で取り出せる。途中で落ちた回を消して成功率を作らない。

同じ実描画テストに `AROUND_TEST_EXTENSION_PATH='../g14-before/.work/g14-normal'` を渡すと、G1.3 の長い待ちを再現できる。2件目はテスト自身が source をビルドするため、この指定だけでは旧版にならない。

## 守りを止める

```powershell
$env:AROUND_BUILD_OUT='.work/g14-no-idle'; $env:AROUND_NO_IDLE_RECHECK='1'
node scripts/build.mjs
$env:AROUND_TEST_EXTENSION_PATH='.work/g14-no-idle'
npm run test:e2e -- tests/g14-idle-recheck.spec.ts
$env:AROUND_NO_IDLE_RECHECK='0'
node .work/build-faults.mjs
```

`AROUND_NO_IDLE_RECHECK=1` はテスト内の probe にも同じラベルを落とす。ほかの fault は esbuild のモジュール差し替えで公開関数を包む。ソースの文字列置換をしない。

| ビルド                  | 実行する spec / grep                                                             | 止める範囲                                      |
| ----------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------- |
| `.work/g14-no-clip`     | `g14-idle-recheck` / `silent move stays`                                         | `protectionClip` の最後の screen plane 切り抜き |
| `.work/g14-no-input`    | `operation-editing-input` / `a covered control`                                  | event がある `validate` の照合だけ              |
| `.work/g14-no-approach` | `operation-safety` / `G1.2 ①\|G1.2 ③`                                            | `stepApproach`                                  |
| `.work/g14-no-hold`     | `g13-look-regression` と `g14-idle-recheck` / `resized group\|silent move stays` | `source.deferredFor()` を0にする                |

HOLD の2件は止めても通った。全 HOLD 試験を検出不能と結論したものではない。上の選択範囲に検出の穴が残る。

## 実タブ・実サイト

`npm run test:e2e -- --config=.work/g14-extra/config.ts background.spec.ts`。専用の headless Chrome と `connectOverCDP(..., {noDefaults:true})` を使い、本当の同一ウィンドウ内タブ切替を行う。`document.hidden` を置き換えない。`viewport.spec.ts` は計測準備の寸法診断用。

`npm run test:e2e -- --config=.work/g14-live/config.ts` は新しい未ログインのプロファイルで、画像を Studio から追加する。`G14_LABEL` は after/before/g12、`AROUND_TEST_EXTENSION_PATH` と `G14_SOURCE_ROOT` は各比較ツリーのビルド・ソースをそろえる。初期読み込みの安全停止が終わってから撮る。

`node .work/build-record.mjs` の後は `AROUND_TEST_EXTENSION_PATH='.work/g14-record'`、`G14_LABEL='record'`、`G14_IDLE_MS='6000'`。公開 source の capture を包み、呼び出し元の stack に `recheck` があるときだけ記録する。動作を上書きしない。記録ビルドの時間を正式性能に使わない。

## 実 YouTube の性能

前後それぞれのツリーで、そのツリーの `node scripts/ui1/build.mjs . .work/g14-perf-build` を使う。検証ツリーでは `UI1_PROBE_BUSY_MS=2` の `.work/g14-perf-busy` も作る。`G13_CALIBRATE='.work/g14-perf-build,.work/g14-perf-busy'`、`G13_OUT='.work/g14-perf'` で config の calibration だけを1回実行する。

交互計測の共通指定は次のとおり。

```powershell
$env:G13_PERF='1'
$env:G13_BUILDS='before=../g14-before/.work/g14-perf-build,after=.work/g14-perf-build'
$env:G13_PAIRS='4'
npm run test:e2e -- --config=.work/g14-perf/config.ts --grep 'alternating pairs'
```

| セット             | G13_OUT                          | G14_USUAL_ONLY | G14_STATIC_SMOKE | G14_STARTUP_ONLY |
| ------------------ | -------------------------------- | -------------- | ---------------- | ---------------- |
| 従来の場面         | `.work/g14-perf-usual`           | 1              | 0                | 0                |
| 起動0〜6秒         | `.work/g14-perf-startup-focused` | 0              | 0                | 1                |
| 静止した不透明な絵 | `.work/g14-perf-static-gap`      | 0              | 1                | 0                |

セットは順番に回す。起動の集計には startup-focused セットを使う。タブを明示的に表へ出し、document_start の主世界でフレームを採り、拡張 isolated world の実コールバック時間だけを0〜6,000msへ割り当てる。プローブが入る前のフレームも含める。注入時刻を `startupWindow.contentProbeStarted` に残す。最初の組では前後とも注入が6秒より後だったため、0msを起動処理自体の軽さと解釈しない。従来セット内の起動値も生データに残すが、採取区間が異なるので正式表には使わない。

静止画セットは `SMOKE` という既存の検証用フラグ名を使い、4組の採取を指定する。64×64px の不透明 PNG を公開 UI から追加し、動画を止め、Studio が変えた headless 窓を1920×1080へ戻す。プレーヤーと右欄の隙間へ8×64pxで表示し、全512画素が `[0,223,255,255]` であることを確認してから6秒何も入力しない。計測終了時の可視性・不透明度・停止状態も確かめる。通常場面の SPA 履歴は引き継がない。今回この条件で完了したのは1組で、次の回の画素が白になり中断した。静止画性能を合格とは判定していない。

## 保存済みの証拠の検算

```powershell
node docs/benchmarks/g14-verification/repro/validate-artifacts.mjs
```

gzip の SHA-256、raw のコールバックからの CPU 再計算、20回の画素比較、fault、実 visibility、CI の切り抜き更新を検算する。`pack-evidence.mjs` は今回の `.work` に採取したファイルをまとめるためのもの。再現試験そのものではない。失敗した準備・中断ログも保存した。
