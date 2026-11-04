# R3-1 修正の記録を取り直す

製品コードは `447b2bf`、交互計測の比較相手は `8e63f0d`。修正前の回帰再現と Windows の追加失敗の対照は `8003738` を使った。主な結果と確認してほしい点は `docs/r3-plan.md` の「R3-1 の修正（Codex）」にある。段階の独立確認は Claude Code が担当する。

## 回帰テストと全件

通常の dist を変更しないよう、作業ブランチの worktree で次を実行する。

```powershell
$env:WW_BUILD_OUT = '.work/r31-fix'
npm run build
$env:WW_TEST_EXTENSION_PATH = (Resolve-Path .work/r31-fix).Path
npm run lint
npm run test:unit
npm run test:e2e -- tests/backup.spec.ts tests/character-editor.spec.ts tests/creator-editor.spec.ts tests/effect-editor.spec.ts tests/group-editor.spec.ts tests/media2-editor.spec.ts tests/motion-editor.spec.ts tests/vrma-import.spec.ts --grep 'historical v13|existing legacy VRM|same historical VRM|pick a card, preview all properties locally|effect edits survive|three images group|1080p alpha WebM plays|import, paint actual frames|Studio refuses invalid motion'
npm run test:e2e
```

Chromium の共通配置を使う場合は `PLAYWRIGHT_BROWSERS_PATH` を指定する。e2e は workers=1 のまま。`scripts/test.mjs` が表示ありの窓を画面外に出す。ネイティブ操作を含む全件では、実行前にフォーカスを取ることを伝える。

`tests/fixtures/backups/legacy-v13-vrm.wwbackup` は、変更前の拡張が実際に出力した自作素材だけのバックアップ。現在の形式から body を削って生成したものではない。由来は同じフォルダの README に記載した。

Windows 全件で失敗した2件の反復は、同じテストコードで読み込む拡張だけを `8003738` と修正後で替えて、各々次を実行した。

```powershell
npm run test:e2e -- tests/side-panel.spec.ts tests/signal-motion-editor.spec.ts --grep 'the official panel dresses UI parts|shared motion UI pursues' --repeat-each=10
```

最終版の全件で失敗した別の2件も、同じ方法で各10回ずつ反復した。

```powershell
npm run test:e2e -- tests/operation-safety.spec.ts tests/studio-transfer.spec.ts --grep 'G1.2 ①②④|a binary message arriving after release' --repeat-each=10
```

全件の失敗を反復の成功で置き換えない。`checks.json` に両方の実行結果を残している。

## 実 YouTube の画像

```powershell
$env:WW_VRM_FILE = 'C:\Users\sm787\Desktop\ローポリモデル用\out\trusie.vrm'
$env:WW_VRMA_DIR = 'C:\Users\sm787\Desktop\ローポリモデル用\out\anim'
$env:WW_LIVE_CHARACTER = '1'
npm run test:e2e -- tests/character-live.spec.ts
```

`WW_VRMA_DIR` は manifest.json と trusie サブフォルダを含む親フォルダ。専用動作はその下の `trusie/idle.vrma` などを読む。撮影後に `.work/verification/character-idle.png` を開いて、キャラが実際に見えることを確かめる。VRM・VRMA 原本と、それらを含む画像・trace・プロファイルはコミットしない。

## 交互計測

このフォルダのコード一式を、作業 worktree の `.work/r31-fix-tools/` へコピーして使う。相対 import はその場所を基準とする。

リポジトリの最上位から `git worktree add --detach .work/r31-before 8e63f0d` で比較側を固定する。以下の実行位置では、作業 worktree の隣が `../r31-before` であること。両方で `npm ci` を済ませ、**各ツリーの自分のビルドスクリプト**で計測版を作る。

```powershell
# 比較側の worktree で
node scripts/ui1/build.mjs . .work/r31-perf

# 修正側の worktree で
node scripts/ui1/build.mjs . .work/r31-perf
$env:UI1_PROBE_BUSY_MS = '2'
$env:UI1_PROBE_AFTER_AWAIT = '1'
node scripts/ui1/build.mjs . .work/r31-perf-busy
Remove-Item Env:UI1_PROBE_BUSY_MS
Remove-Item Env:UI1_PROBE_AFTER_AWAIT
```

校正と本計測は、他のテストやビルドが止まっているときに実行する。背景CPUは記録するが、今回のユーザーの指示により5%を足切りには使わない。

```powershell
$env:R31_PERF = '1'
$env:UI1_HOST_AUDIT = '1'
$env:R31_CALIBRATION = '1'
$env:R31_PERF_WORK = '.work/r31-fix-evidence/calibration'
npm run test:e2e -- --config=.work/r31-fix-tools/config.ts perf.spec.ts
$env:R31_CALIBRATION = '0'
$env:R31_PERF_WORK = '.work/r31-fix-evidence/performance'
npm run test:e2e -- --config=.work/r31-fix-tools/config.ts perf.spec.ts
node .work/r31-fix-tools/review.mjs
```

- 新しい未ログインのプロファイル、同じ Chromium、同じ動画、viewport 1920×1080・倍率1、表示あり・画面外。実 GPU の backend を記録し、SwiftShader は採用しない。
- 起動は遷移先の文書の時計が6秒になるまで。前回の短い窓を再利用しない。定常は8秒待った後の6秒、SPA は実際の検索から6秒。
- 拡張の CPU は isolated world の callback と await の継続をフレームごとに合算。校正では await 後の2msを検出する。
- AB / BA を交互にし、全6場面と前後の負荷記録がそろった4組を集める。最大8試行組・test全体1時間。文書の窓が5.8〜6.5秒、広告・裏タブなし、十分なフレーム数が必要。除外理由と全試行を残し、CPU値を理由に取り直さない。
- 背景負荷は前後の参考値として残す。最初は全論理CPU平均5%以下を採否に使っていたが、ユーザーの「Braveを開くだけで超えるので、そこまで厳しくしなくてよい」との指示で変更した。広告・裏タブ・採取窓・実GPUの条件と、拡張CPU時間の予算は変更していない。
- 比較側は外部 .vrma に未対応なので、トルーシェは基本姿勢＋視線・揺れもの。修正側は専用 idle＋視線・揺れもの。同じ動作を両側で再生する比較ではない。
- GPU は250msごとの直近値。全描画の p95 ではない。SPA後にモデルが消えた場合の残った値は除く。動画は区間差で記録する。作品OFFの参考区間も8秒待ってから6秒取り、拡張を入れていない状態とは区別する。

実際の収集は `capture-strict.spec.ts`（変更前の5%条件）で始めた。条件の変更時には6組の採取が終わっていたので、収集器を7組目の途中で止め、`review.mjs --interrupted` で個々の保存ファイルから一覧を作った。旧条件なら1・2組目、新条件では全6場面がそろう最初の1〜4組を集計に使う。5・6組目もrawに残す。途中の7組目は使わない。収集器を正常終了したテストとは扱っていない。今後の取り直しは、上記の `perf.spec.ts` が変更後の条件で4組を取る。

`pack.mjs` は今回の SHA・CI・4組の成立を検査してから公開用の記録を出す。raw の数値は保持し、私用モデルの pose と trace の args を除く。元の trace はローカルに残し、定常の前後1組だけ args を除いたものを添付する。計測版の最初の前後画像もローカル保存のみ。資料を出した後は Prettier と lint を実行する。

今回の校正と通常版の実画像は `70cea3a` で取った。その後の `447b2bf` はバックアップ側の補修で、通常版・計測版・2ms版の content bundle が同じバイト列であることをハッシュで確認している。`source-proof.json` に校正時のSHAと各ハッシュを残す。取り直す場合は上のとおり最終版で校正してよい。

履歴 fixture と内蔵クリップの前後比較は、比較側の worktree を用意してから `node .work/r31-fix-tools/data-check.mjs` で取り直す。以前の独立試験から出力先だけを替え、16件のJSON・CSS・各100フレームの評価、内蔵クリップの180フレームの姿勢などを比較する。今回の出力は `independent-data.json`（44件）と `compat-before-captured.json`。
