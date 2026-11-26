# R3-1 検証の再現

製品・既存テストを変更せず、固定した2つのツリーで実行する。再現用コードは、このフォルダ一式を対象worktreeの `.work/r31-tools/` へコピーして使う。相対importは、その場所を基準にしている。

## 準備

リポジトリのルートから：

```powershell
git worktree add --detach .work/r31-before 8e63f0d
git worktree add --detach .work/r31-verify 8003738
```

両ツリーで `npm ci` を実行し、`AROUND_BUILD_OUT=.work/r31-normal` を指定して `npm run build`。Chromiumは同じものを使い、`PLAYWRIGHT_BROWSERS_PATH` に共通の配置場所を指定する。各worktreeの通常のdistを出力先にしない。

以降の作業ディレクトリは `.work/r31-verify`。テストは `npm run test:unit` / `npm run test:e2e` を経由し、e2eはworkers=1のまま実行する。表示ありのChromeは、この入口と `launchExtension` により画面外へ出る。

## 独立したデータ比較

```powershell
node .work/r31-tools/data-check.mjs
node .work/r31-tools/history-v13.mjs
node .work/r31-tools/vrma-loader-check.mjs
```

- `data-check` は変更前のコードで16 fixtureを読み、その結果を `.work/evidence/compat-before-captured.json` に保存する。変更後のJSON・CSS・100フレームずつの評価と比較する。実GLTFLoaderによる内蔵クリップの姿勢比較も含む。
- この対象コミットでは、scene 2件と計算後の腰高さの検査が落ちるため、終了コード1になる。既存の期待値を書き換えない。
- `history-v13` は導入コミットのテストを実行し、fixtureが当時の受理入力と一致するかを確かめる。
- `vrma-loader-check` は、上流の検査と実ローダーの違いを記録する。

## UI・互換・G1

```powershell
$env:AROUND_TEST_EXTENSION_PATH = (Resolve-Path .work/r31-normal).Path
npm run test:e2e -- --config=.work/r31-tools/config.ts extra.spec.ts
```

`extra.spec.ts` は、実popupウィンドウへの36動作の取り込み、履歴・保存・破棄・再読込、別プロファイルへのバックアップ往復を試す。旧VRMの入力は、変更前で実際に作った作品・素材レコードである。古い未パック拡張のスクリプトキャッシュと混同しないよう、変更後の新しいプロファイルにその旧レコードを渡す。実ユーザーのプロファイルには触れない。

同じspecが変更前で作った旧バックアップを使うため、最初は全件を指定順に実行する。この対象では、旧VRMバックアップ・再取り込み後の測定・sceneの2件が失敗する。

```powershell
node .work/r31-tools/build-mutants.mjs
node .work/r31-tools/mutant-data.mjs
& .work/r31-tools/run-mutants.ps1
```

faultは `.work/r31-no-*` のみ。`build-mutants` は通常版をコピーし、esbuildで依存モジュールを差し替える。製品ソースのneedle置換をしない。通常版で拒否されることを確認した後、検査なし版で拒否のassertionが落ちることを調べる。HOLDだけは選んだ試験が通り、検出の穴として記録する。

## 実サイトと外部のキャラ

`AROUND_VRM_FILE` は依頼された `out/trusie.vrm`、`AROUND_VRMA_DIR` は **manifest.jsonとtrusieサブフォルダを含む `out/anim`** を指す。既存character-liveは、その下に `trusie/idle.vrma` 等がある形を要求する。

```powershell
$env:AROUND_LIVE_CHARACTER = '1'
npm run test:e2e -- tests/character-live.spec.ts
$env:AROUND_R31_LIVE = '1'
npm run test:e2e -- --config=.work/r31-tools/config.ts live-visual.spec.ts
```

通常版と計測版の画像は `.work/r31-private` に置く。モデル・動作の原本、これらを含む画像・Playwright trace・Chromeプロファイルはコピー先やコミット対象に含めない。公開可能なStudio画像とバックアップは、テスト内で作るOriginal.vrmとmotion-N.vrmaだけを使う。

## 性能

両ツリーで、それぞれのビルドスクリプトを使う。

```powershell
node scripts/ui1/build.mjs . .work/r31-perf
```

変更後だけ、`UI1_PROBE_BUSY_MS=2` を付けて `.work/r31-perf-busy` も作る。ビルド後はその環境変数を外す。

```powershell
$env:R31_PERF = '1'
$env:UI1_HOST_AUDIT = '1'
$env:R31_CALIBRATION = '1'
npm run test:e2e -- --config=.work/r31-tools/config.ts perf.spec.ts
$env:R31_CALIBRATION = '0'
$env:R31_PERF_WORK = '.work/evidence/r31-perf-final'
npm run test:e2e -- --config=.work/r31-tools/config.ts perf.spec.ts
```

- 実YouTube、同じURL、未ログインの新しいプロファイル。表示あり・画面外、viewport 1920×1080、deviceScaleFactor 1。Windowsがネイティブ窓の高さを制限するため、描画viewportは遷移より前に固定する。SwiftShaderの値を実GPUとして扱わない。
- 通常の作品1枚と、そこにトルーシェを加えた作品。変更前はVRMの静止姿勢と視線・揺れもの、変更後は専用idleと視線・揺れもの。旧版は外部.vrmaに対応しないので、同じidleを両方で再生する比較ではない。
- 起動は文書開始から6秒、定常は8秒待った後の6秒、SPAは本物の検索操作から6秒。文書開始のrAF時計とisolated-worldの拡張callbackを合算する。校正は2ms負荷の検出で確かめる。
- 広告・裏タブ・少なすぎるフレーム・ソフトウェアGPU・PCの高負荷がある記録は採用しない。広告と不足フレームだけを最大3回取り直し、全試行を残す。CPUの値が悪いことを理由に取り直さない。
- AB / BAを交互にし、前後の負荷が静かな完全な組を4組採用する。上限は8組・30分。test全体が上限に達した場合も、区間ごとの保存結果を `performance-preview.mjs` で確認できる。全6区間と前後の負荷がそろった組だけを採用し、4組に満たなければ性能合格にしない。ホストの基準は、全論理CPU平均の背景負荷5%以下、別コードセッションは1コアの5%以下。
- 今回は初回の保存結果を検査すると、短い起動窓とtest期限をまたいだSPAがあった。そのため `R31_RESUME=1`・出力先 `.work/evidence/r31-perf-complete` で元の記録を読み、該当する組を除外して最大2組を補完した。補完も全場面の4組には届かず、正式合格にはしていない。場面単位の有効区間の参考表と、完全な組の成立数を分けて読む。
- GPUは250msごとの直近値で、全描画のp95ではない。SPA後のモデル不在時に残るGPU値は集計しない。動画フレームは区間差。作品表示OFFの参考値は、拡張なしの測定ではない。

`run-remaining.ps1` はunit、版番号失敗の変更前対照、追加3失敗の前後各10回、通常版・計測版の実サイト画像、追加UI試験を順番に回す。正式計測と同時に起動しない。Windows全件のnative-key試験は一瞬キーボードフォーカスを取るため、全件を実行する前に利用者へ伝える。

`pack-evidence.mjs` は公開できる数値・自作素材だけを `docs/benchmarks/r31-verification` に集める。再現を最後まで実行してから使う。完全なChrome traceはローカルに保持し、共有用にはURL等のargsを除いた前後の定常traceを添える。
