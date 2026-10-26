# Claude Codeへの引継ぎ：G1.1の性能修正

2026年10月24日。今回の担当は、**起動直後の性能改善と実YouTubeの連続60秒計測**。ページ追従層と雰囲気レイヤーは後続タスクとする。最初に原因の調べ方、変更範囲、検証の順番を短く示してから実装する。

## 取得するブランチ

- リポジトリ：<https://github.com/a3681299-png/web-world-themes>
- 実装の保存先：`codex/creator-editor-spike`
- 性能修正の基点：`e2ac377ec5a6c3c0af1be44121de6ad30572388a`
- 修正前G1：`ded8815103e935460528a332762403f24d9f27b4`
- 基点の[GitHub Actions](https://github.com/a3681299-png/web-world-themes/actions/runs/39931836544)はunit・e2eとも成功を確認済み。この引継書とスクリプトを追加したcommitのCIとは区別する。

mainではなく上記ブランチを読む。変更はそのブランチ、またはそこから分けた専用ブランチで行う。修正前G1との比較には履歴が必要なので、浅いcloneでは対象commitを追加取得する。

## 制約

- mainと通常版`dist`を変更しない。ビルド先は`.work`配下へ明示する。
- DesignDocument v1〜v11の互換性と既存の安全検証を保つ。Chrome権限を追加しない。
- 私用VRM `PochibyKT_Pochi*`をコミットしない。作品データからJSを実行しない。
- YouTube固有のDOM探索はSiteAdapterに置く。画面固定層の縦方向の保護帯、入力直前の再取得と世代確認、実際のヒット先確認、接近判定、安定待ちを弱めない。
- 新しい作品データ項目や版が今回の性能修正に必要になった場合は、実装前に理由を報告して止まる。後続のv12では`renderMode`だけの追加を承認済み。G2の項目は含めない。

## 現状と今回の到達条件

同じ公開動画でのフレーム全体p95は以下。2026年10月23日、Windows・Chromium 153.0.8010.12、1920×1080、32画像・16グループの実測であり、別の環境の絶対値とは直接比較しない。

| 条件                       | 検査なし | 検査あり |              増分 |
| -------------------------- | -------: | -------: | ----------------: |
| G1・起動直後               |  19.27ms | 210.98ms |         +191.71ms |
| 中間修正後・起動直後       |  18.16ms |  25.33ms | **+7.18ms：未達** |
| 中間修正後・定常の短い区間 |   8.11ms |   8.31ms |           +0.20ms |

起動直後と定常を分け、同じ環境で検査ON/OFFを交互に測り、フレーム全体p95の増分を**+2ms以内**にする。実際の再生中の幾何再取得の回数、1回の中央値とp95、合計時間も報告する。

連続60秒の有効な結果はまだない。`LC1a-DwUhls`、`aqz-KE-bpKQ`、`M7lc1UVf-VE`は約40秒前後で再生エラーになった。拡張なしでも同様の失敗があり、拡張が原因とは断定していない。別の公開動画でよい。再読み込み、速度変更、ループ、失敗前の短い窓の外挿で60秒成功に置き換えない。

動画要素の同一性、時刻の進行、広告状態、readyState、`loadedmetadata`・`emptied`・`error`・`pause`などを確認し、無効な区間は不採用とする。実YouTubeを再生できる環境がなければ、実装済みと未検証の条件を分けて報告する。fixtureだけの数値で完了と判定しない。

## 実装済みの変更と調査箇所

`e2ac377`では、同じ祖先の固定位置・合成順の判定を1回の同期取得中だけ共有した。DOM更新をまたぐスタイルキャッシュは使っていない。Adapterで得た矩形と可視性を再利用し、不要なプレイヤー描画先の走査やレイヤーごとの合成先確認を減らした。

変更通知時は直ちに装飾と操作ハンドルを隠し、幾何取得を次の描画にまとめている。境界が変わった場合の安定待ちと、入力直前の同期検査は維持した。ここをさらに変える場合、JSを待たないスクロールと新しい操作面の出現の両方に保護が間に合うことを確認する。

同じ実DOMで392候補・可視137面を比べた際、可視操作面と保護領域は一致し、スタイル取得は15,158回から666回、再取得1回の中央値は44.95msから7.80msへ下がった。全候補の列挙と再取得の差分化はまだ調査対象。画面外の操作面を単に省くと、固定層の保護帯が不足する可能性がある。

読むファイル：

- `src/sites/youtube-operations.ts`：操作面の候補探索と配置先の判定
- `src/host/operation-composition.ts`：祖先の固定位置と合成順の判定
- `src/host/operation-source.ts`：Mutation/Resize監視、幾何取得、世代と入力直前の検査
- `src/host/operation-guard.ts`：即時非表示、再取得の集約、安定待ち
- `src/renderers/dom/scene.ts`：描画先、クリップ、レイヤーの反映
- `src/world/operations.ts`と`tests/operation-*.spec.ts`：保護契約と回帰テスト

## 再計測用スクリプト

前回のローカルハーネスを`scripts/g11/`へ移した。個人PCのブラウザーパスとプロファイルへの依存を外し、検査対象のHEADを結果へ記録する。製品コードと通常版distには計測フックや検査OFFスイッチを追加していない。

計測専用ビルドは`.work/g11-measurement-dist`、結果と新規未ログインプロファイルは`.work`配下へ出力する。素材は`petal.png`を正式な取り込みUIで検証してから、32画像・16グループの計測作品を作る。計測以外のテストは並行実行しない。

Node 24と`npm ci`が必要。以下はPOSIXシェルの例。Linuxでブラウザーの依存ライブラリや画面が必要な場合は、その実行環境を用意する。

```sh
export PLAYWRIGHT_BROWSERS_PATH=.work/browsers
npx playwright install chromium --no-shell
node scripts/g11/build.mjs

# 拡張と実サイトへの接続確認。性能目標の検証には数えない。
G11_WORK=.work/g11-smoke node scripts/g11/run.mjs smoke

# 起動時：6秒を目標にON/OFFをAB・BA・AB・BAで交互計測
G11_WORK=.work/g11-startup node scripts/g11/run.mjs startup
G11_WORK=.work/g11-startup node scripts/g11/analyze.mjs

# 定常：15秒待ち＋3秒の描画ウォームアップ後、6秒を目標に交互計測
G11_WORK=.work/g11-steady node scripts/g11/run.mjs steady
G11_WORK=.work/g11-steady node scripts/g11/analyze.mjs

# 連続60秒：計測開始前だけ再読み込みし、計測中は再読み込みしない
G11_VIDEO_URL='https://www.youtube.com/watch?v=再生可能な動画ID' \
  G11_WORK=.work/g11-minute node scripts/g11/run.mjs minute
G11_WORK=.work/g11-minute node scripts/g11/analyze.mjs

# 同じ実DOM上で履歴のG1と現在のSourceを交互に比較
G11_WORK=.work/g11-source node scripts/g11/compare-source.mjs
```

PowerShellでは、例えば`$env:PLAYWRIGHT_BROWSERS_PATH='.work/browsers'`、`$env:G11_WORK='.work/g11-startup'`を設定してから`node`コマンドを実行する。`G11_BROWSER_PATH`で実行ファイルを指定できる。`G11_HEADED=1`は通常描画を使うが、ウィンドウは画面外へ配置する。使う場合も個人の通常プロファイルを指定しない。

`G11_PAIR_COUNT`で組数、`G11_VIDEO_URL`で公開動画を変更できる。各実行では新しい結果ディレクトリを指定する。`G11_PROFILE`で再利用できるのは、このハーネスが作った所有マーカー付きプロファイルだけ。`G11_REUSE_SCENE=1`は、そのプロファイルへ計測作品を保存済みの場合に限る。

全体p95はChrome traceの`AnimationFrame`の同じflow idの開始(s)から終了(f)。`FireAnimationFrame`が最も多いprocess/threadを選び、条件別に全フレームをまとめたnearest-rank p95を求める。RAF間隔や拡張コールバックの時間だけを全体とは呼ばない。起動時にはControllerの入れ替え前の終了処理も両条件へ含む。トレース形式が変わって完全なflowを読めなくなった場合は計測失敗として扱い、0msで成功にしない。

今回の移植では各短い区間の動画要素とイベントの検証も追加し、60秒データのサンプル不足と、結果に失敗記録がある場合を明示的に拒否する。新しい環境で得た数値を前回の実測として扱わない。

引継ぎ準備では、構文検査、隔離ビルド、実YouTubeへの接続、同じDOM上での履歴比較、前回のトレースを使ったp95集計の一致、失敗した60秒データの拒否を確認した。これらはツールの移植確認で、性能目標の達成を意味しない。Linuxでの実行と、新しい環境での連続60秒は未検証。極端に低いFPSの区間も落とさず、得られた件数と時間をそのまま報告する。

## 検証と完了報告

前回のローカル検証は型チェック、lint、単体320件、操作面E2E11件が成功。CIも上記の実装commitについて成功している。変更後は必要な回帰テストとCIを新しいcommitに対して確認する。

```sh
npm run lint
npm run typecheck
npm run test:unit
WW_BUILD_OUT=.work/g11-check-dist npm run build
WW_TEST_EXTENSION_PATH=.work/g11-check-dist \
  npm run test:e2e -- tests/operation-safety.spec.ts tests/operation-controls.spec.ts
```

完了報告には、原因、変更内容、安全性を維持した根拠、起動直後と定常それぞれの全体p95・検査なしとの差、連続60秒の再取得回数と合計時間、1回の中央値とp95、テスト件数、CIのURLと結果を含める。未達の条件は未達と記す。

詳細な前回記録：

- [性能修正の中間記録](operation-safety-g11-performance-checkpoint.md)
- [計測JSON](benchmarks/operation-g11-performance-checkpoint-windows.json)
- [修正前の面積と性能](operation-safety-g11-baseline.md)
- [修正前の計測JSON](benchmarks/operation-g11-baseline-windows.json)

前回の生トレースや既存プロファイルはGitHubに含めていない。ローカルの`.work/g11-performance`や`.work/g11-measurement`が存在することを前提にしない。この引継ぎ用スクリプトから新しく採取する。

## 後続タスクの合意

性能を満たした後は、ページの内容に付けたレイヤーをページ追従の描画先へ置き、現在の操作面の矩形と余白だけを除外する。固定層は従来の縦帯を維持する。シアターの固定層が0%でも、ページ追従層と雰囲気レイヤーで描けるようにするという回答を受けている。

雰囲気レイヤー用のv12は`renderMode`だけ。既存作品は通常描画を初期値とし、履歴由来のfixtureで見た目の互換性を検証する。実効アルファ上限の初期案は40%で、作者が解除できず、ぼかし・フィルター・影とクリック受信を禁止する。上限はライト・ダーク両方の実YouTubeのスクリーンショットで確かめて決める。重なり順、グループの不透明度、マスクの保持と、5状態の面積再計測も後続で行う。
