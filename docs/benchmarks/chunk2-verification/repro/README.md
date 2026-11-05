# 塊1修正・塊2の再現手順

ルートで3つの検証用 worktree を作る。通常のブランチと `dist` は使わない。

```powershell
git worktree add --detach .work/verify-chunk2-base 447b2bf
git worktree add --detach .work/verify-chunk2-fix 7688942
git worktree add --detach .work/verify-chunk2-head 842e42f
```

各 worktree で `npm ci` と `npm run test:setup` を行う。同じ lockfile の依存関係と Chromium を共用してもよい。各ツリーで次を実行する。

```powershell
$env:WW_BUILD_OUT = '.work/extension'
npm run build
node scripts/ui1/build.mjs . .work/perf
```

以下は対象側の `.work/verify-chunk2-head` がカレントディレクトリ。ここにある `repro` のファイルは、対象側の `.work/verify/` へコピーする。`run.ps1` はテストを1件ずつ実行し、JSON とログを `.work/verify-evidence` に保存する。Chromium を共用する場合は `PLAYWRIGHT_BROWSERS_PATH` をその場所に設定する。

```powershell
$env:WW_TEST_WINDOW_OFFSCREEN = '1'
$env:WW_PLAYGROUND_OUT = '.work/playground'
npm run build:playground
node scripts/g11/build.mjs
node .work/verify/faults.mjs
node .work/verify/static.mjs

$env:WW_TEST_EXTENSION_PATH = (Resolve-Path .work/extension).Path
$env:PLAYWRIGHT_JSON_OUTPUT_NAME = Join-Path (Get-Location) '.work/windows-all.json'
npm run test:e2e -- --reporter=list,json
npm run test:unit -- --config=.work/verify/config.ts author.spec.ts
$env:CHUNK2_FAULT = 'author'
npm run test:unit -- --config=.work/verify/config.ts author.spec.ts
Remove-Item Env:CHUNK2_FAULT
```

最後の author 試験は2件とも失敗するのが期待値。開発版は esbuild の依存差し替えで `authorActive` を `false` にし、作者のクリップと経路の両方を試す。`visual` の背景と切り抜きの故障版、`live` の古い音量座標もそれぞれ失敗を確認する。他のブラウザーテストや計測と並行させない。Windows 全件にはネイティブ操作が含まれるため、実行前にフォーカスを取ることを伝える。

```powershell
& .work/verify/run.ps1 calibrate
& .work/verify/run.ps1 AA
& .work/verify/run.ps1 AB
& .work/verify/run.ps1 visual
& .work/verify/run.ps1 sample
& .work/verify/run.ps1 live
& .work/verify/run.ps1 live-retry
```

`AA` は `447b2bf` 同士、`AB` は `447b2bf` と `7688942`。`AA` で有効8組がそろった後に `AB` を実行する。画像1層を本物の Studio から保存し、実 YouTube の遷移先の時計で `[0, 6000)` ms を測る。フレーム境界は文書開始の rAF、拡張の処理時間は ui1 isolated world プローブ。除外条件と全試行を JSON に残す。`calibrate` では g11 の rAF 計測と ui1 の Promise 継続を、2ms の負荷で別々に検証する。

塊2の比較は `7688942` と `842e42f`。マネキンは対象が生成した自作 fixture、トルーシェは手元のファイルを環境変数で参照する。実素材はリポジトリのファイルとして用意しない。

```powershell
$assetRoot = Join-Path ([Environment]::GetFolderPath('Desktop')) 'ローポリモデル用\out'
$env:WW_VRM_FILE = Join-Path $assetRoot 'trusie.vrm'
$env:WW_VRMA_DIR = Join-Path $assetRoot 'anim\trusie'
& .work/verify/run.ps1 B
```

`B` は場面ごとに新しいプロファイルを使い、トルーシェ1体、マネキン1体、キャラなしの順で起動・8秒待ち後の定常・検索 SPA を各6秒採る。各場面で前後を4組交互に回す。`WW_VRMA_DIR` の `idle.vrma` のみを使う。素材の読込は製品の Studio を使い、プロファイルは Windows の一時ディレクトリに分離する。GPU は `EXT_disjoint_timer_query_webgl2` の直近の値。SPA の動画カウンターは動画が変わった区間を無効とする。`aggregate.mjs` で集計し、設定した出力先に組別の表と圧縮 JSON を作る。CI は `gh run view` の対象 SHA とログの件数で照合する。
