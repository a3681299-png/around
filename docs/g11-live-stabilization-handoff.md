# G1・G1.1 実サイトテストの安定化：引き継ぎ

最終更新：2026-10-26。**引継ぎ後の実装・実サイト検証は完了した。** 最終確認13件成功、CIは単体336件・E2E246件成功。結果・比較表・性能の限界は [完了報告](operation-safety-g11-completion.md) にまとめた。検証したソースは `b705f16`。

ユーザーの「mainへ反映して完了する」という明示的な承認後、`4402323`でmainへ統合し、通常版distも更新した。content bundleは検証済みビルドと一致する。**以下は初回引継ぎ時点の記録**であり、現状と性能の限界は完了報告を参照する。

経緯と結果の詳細は [operation-safety-g11-finish.md](operation-safety-g11-finish.md) の「4回目」、保護の仕様は [operation-safety.md](operation-safety.md)（「G1.1での拡張」を含む）にある。

2026年10月26日の再開後の確認と試験の開始条件の修正は、同じ記録の「5回目」「6回目」に追記している。

## 依頼（ユーザーの指示、この順番と基準）

1. 最優先：ドラッグ開始で作品がクリック対象にならない件（editor-ux・studio・studio-workspace）。押下時の照合を最初に疑い、原因を特定して製品側を直し、テストで示す。→ **対応済み**（原因は照合ではなかった。下の「直したこと」）。ただし studio-workspace（Studio作成）にまだ別の失敗が残る。
2. YouTube側が疑われる失敗
   - model のシアター属性：製品側（アダプター）が壊れていないか確認。→ **確認済み、製品は依存していない**。
   - vrm の右側の点：接近判定の距離より離れた点を動的に選ぶ（判定は緩めない）。→ **対応済み**（80px以上）。
   - live-youtube のコメント見出し、side-panel のブラウザー終了：分かる範囲で調べ、分からなければログを残す。→ **ログを残した**。side-panel の終了は、ドラッグ開始の確認（`editor-workspace.ts:78`）で起きていた同じ失敗だった。
3. マージの基準：main（6721ce4）も同じ条件で3〜4回流し、テストごとの成功回数を比べる。**「mainでは安定して通るのにブランチでだけ落ちる」失敗が0件になったら、G1・G1.1をmainへマージしてよい**。比べた表を記録に残す。→ 表は記録済み（8回ずつ）。**0件にはなっていない**。
4. 一時プロファイル（`%TEMP%\around-*`）を、失敗・タイムアウトを含めテストの終わりに必ず消す。→ **対応済み**（`tests/temporary-profiles.ts`、globalTeardown）。

## 守る制約（変えないこと）

- main と通常の `dist` は、マージの基準を満たすまで変えない。
- DesignDocument v1–v12 の互換を保つ。Chrome の権限を増やさない。
- **私用VRM（`PochibyKT_Pochi*`）は絶対にコミットしない・コピーしない。** ユーザーのPC上のファイルを `AROUND_VRM_FILE` で指定するだけ（パスはユーザーに確認）。`.gitignore` に `PochibyKT_Pochi*` がある。
- 作品からJSを実行しない。YouTube固有のDOMの扱いはアダプター（`src/sites/youtube-*.ts`）に閉じる。
- 保護を弱めない：画面固定層の縦方向の除外、入力時の再取得・世代確認・ヒット確認、接近判定、安定待ち。テストを今の挙動に合わせて判定を緩めない（待ち方・狙う点・前提を人と同じにするのは可）。
- コミットメッセージは英語で簡潔に。ユーザーへの報告は日本語で、全作業が終わってからまとめて1回。

## 直したこと（このラウンド）

製品側（各修正にテストあり）：

- 編集中の映像中央の所有を `OperationSource.editorCentre()`（メニュー・エラー・広告がないこと）で決め、中央に本物の部品（再生前の大きな再生ボタンなど）があっても中央を失わない。部品は現在の矩形で切り抜き、押下時の照合でも拒む。ページ追従層にも同じ中央。
- ページ追従層・雰囲気層の作品が `update()` のたびに画面固定層へ移されて戻り、ドラッグのポインターキャプチャが外れていた不具合。
- YouTube のミュート解除ボタン（`ytp-popup` クラス）を窓全体のメニューとして扱っていた不具合。

テスト側：画面上の座標の読み方、姿勢比較の再試行、テイク選択の待ち、狙う点の選び方（`clearestPoint`・`visiblePart`）、宣伝ダイアログ・広告への対処、画面外実行（`AROUND_TEST_WINDOW_OFFSCREEN=1`）、失敗時の状況の記録、一時プロファイルの後片付け。

コミット：4ee890b、ffb2d6e、53d8ac4、b2b5111、8f8970f、c057e4f（c057e4f は実サイトで未実行）。

## 残っている作業

1. **c057e4f で実サイト全件をブランチで4回流す**（広告待ちの効果確認）。結果を「4回目」の表に足す。
2. **studio-workspace（Studio作成）の失敗の原因を特定する**。症状：プレイヤー基準のグループが、中央の再生ボタンのため映像内の描画先を使えずページ追従層へ回り、ページ追従層のクリップが `inset(100%)`、保護の記録が `unknown`（`src/renderers/dom/scene.ts` の `verified` が偽＝`pageRegions` が空）。調べる場所：`src/world/operations.ts` の `pagePaintRegions`（`pageRegions` 内で1024片を超えると `[]`、`snapshot.supported`、`area`）と、scene の `area`（`rootBounds`）。失敗した瞬間に計測用ビルド（`node scripts/g11/build.mjs` → `.work/g11-measurement-dist`、`__g11Probe.controller.safety` が拡張の隔離ワールドから読める。`tests/helpers/world-host.ts` の `isolate(page, extensionId)`）で `source.capture()` と `pagePaintRegions` の値を読むのが早い。再現は単独では少なく、全件の連続実行で出やすい。
3. live-youtube（ダーク）：プレイリスト付き URL の新レイアウトでコメント欄の大きさが0。main でも起きうるかを回数を増やして比べるか、このレイアウトではコメントのパネルを開いてから確かめるようテストを直すか判断する。
4. 基準を満たしたら main へマージ（`--no-ff` 推奨）、push、記録の表を更新。満たさない場合はユーザーへ報告して判断を仰ぐ。

## 実行方法

前提（Windows、Git Bash）：

```bash
export PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="C:/Users/sm787/AppData/Local/ms-playwright/chromium-1200/chrome-win64/chrome.exe"
AROUND_BUILD_OUT=.work/g11-check-dist npm run build
export AROUND_TEST_EXTENSION_PATH=.work/g11-check-dist AROUND_TEST_WINDOW_OFFSCREEN=1
```

- フィクスチャー全件：`npm run lint && npm run typecheck && npm test`（約18分。直近は580件成功・28件スキップ）。
- 実サイト全件（13件）：上に加えて次を設定し、1ワーカーで流す。

```bash
export AROUND_LIVE_YOUTUBE=1 AROUND_LIVE_OPERATIONS=1 AROUND_LIVE_EDITOR_UX=1 AROUND_LIVE_MEDIA=1 AROUND_LIVE_3D=1 AROUND_LIVE_SIDE_PANEL=1 AROUND_LIVE_SIGNAL_MOTION=1 AROUND_LIVE_SIGNAL_TIMELINE=1 AROUND_LIVE_STUDIO=1 AROUND_LIVE_STUDIO_WORKSPACE=1 AROUND_LAYOUT_PILOT=1 AROUND_LIVE_VRM=1
export AROUND_VRM_FILE="<ユーザーの私用VRMのパス>"
npx playwright test $(ls tests/*live*.spec.ts) --project=e2e --workers=1 --reporter=list
```

1回あたり約9分。**Playwright の実行は同時に1つだけ**にする（結果フォルダ `.work/test-results` を共有しており、別の実行が消してしまう）。

- main との比較：`.work/main-base` に main（6721ce4）の作業ツリーがある（`git worktree`、detached、`node_modules` はジャンクション）。`tests/fixtures.ts` に画面外の起動オプションだけをコミットせずに当て、`.work/base-dist` にビルド済み。main 側の実サイトテストは12件（operation-live がない）。main 側は一時プロファイルを消さないので、実行後に `%TEMP%\around-*` を手で消す。比較が終わったら `git worktree remove --force .work/main-base`。
- 比較のログ：`.work/compare/{branch,main}-N.log`、`dark-*.log`（コミットしていない）。

## 注意

- ヘッドレスの実サイトテスト（editor-ux、studio、studio-workspace、operation-live など）は自動再生されず、動画が再生前（大きな再生ボタン）や広告で始まることがある。保護はそれらを本物の操作部品として守るので、テストは人と同じ対処（つかむ点を選ぶ、広告を待つ）をする。
- ディスク：以前、一時プロファイルが溜まって空きが約2GBまで減り、ENOSPC で失敗したことがある。
- ウィンドウを最小化すると Chrome がページを非表示とみなして描画・再生を止めるので、画面外に置く（`AROUND_TEST_WINDOW_OFFSCREEN=1`）。テストが `bringToFront` で一瞬フォーカスを取ることはある。
