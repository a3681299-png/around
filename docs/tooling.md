# 整形と静的検査

`npm run format` で整形し、`npm run format:check` で確認します。Prettierを使い、`printWidth`は120です。TypeScript、CSS、HTML、JSONを同じツールで扱い、npmの既存手順に組み込めるため選びました。

`src/vendor`の固定版、`assets`、テスト用メディア・HTML fixture、ビルド成果物は整形しません。固定ファイルのハッシュと、fixtureの検証条件を維持するためです。HTMLの空白判定は`strict`にしています。

Signal Timelineの性能比較テストは、整形済みのJavaScriptを基準に計測処理を挿入します。履歴側の処理や計測箇所が一致しない場合のエラー、評価回数と出力の比較は維持します。

`npm run lint`は、Prettierの確認、既存の`scripts/lint.mjs`、型情報付きESLintを順番に実行します。YouTubeセレクターの境界と色トークンの検査はそのまま残しています。TypeScriptの検査対象は`src`、`tests`、`playwright.config.ts`です。有効なESLint規則は次の3つです。

- `@typescript-eslint/no-floating-promises`
- `@typescript-eslint/no-misused-promises`
- `@typescript-eslint/switch-exhaustiveness-check`

意図的に待たないPromiseは`void`で明示します。規則の無効化やファイル単位の例外は設けていません。

型チェックの`tsc`は既存のTypeScript 7.0.2を維持します。typescript-eslintが必要とする6系のAPIは、公式の[併用手順](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/#running-side-by-side-with-typescript-60)に沿ってnpm aliasで提供します。`@typescript/native`が7系の`tsc`を、`typescript`が6系のAPIを提供します。ESLint 10に合わせ、Node.jsは22.13以降の22系、または24以上を使います。

整形コミットは`.git-blame-ignore-revs`に登録しています。たとえば`git blame --ignore-revs-file .git-blame-ignore-revs -- src/editor/panel.ts`で除外できます。

## 開発の道具（Claude Code のスキル・プラグイン・MCP）

2026-11-03 に整えた。外部の道具はリポジトリにコミットしない。ユーザーのフォルダ（`~/.claude/`）か、プラグインとして入れる。WWT のスキルは `agent-skills/` にあり、`node scripts/install-skills.mjs` で Claude Code（`~/.claude/skills`）と Codex（`~/.agents/skills`）に入れる。

対象のPC：ノートPC（Intel i7-13650HX、Windows 11、Node 24.16、npm 11.13、Claude Code 2.1.316）。

### 入れたもの

| もの                                                                                                                                                                                 | 入れた場所                                                                                       | 版（コミット）                                                                                                | 理由                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `threejs-fundamentals`・`threejs-loaders`・`threejs-animation`・`threejs-materials`・`threejs-lighting`・`threejs-shaders`・`threejs-performance`（`CloudAI-X/threejs-skills`、MIT） | `~/.claude/skills/threejs-*`（`SKILL.md` と `LICENSE` をそのまま写した。Codex には入れていない） | `0e181866f095b5f06d005133876e926515390d95`（2026-10-19）。対象は three r186 で、WWT の `three@0.186.1` と合う | 3D の層・キャラ・光の作業で、今の版の API を引けるようにする                                                                                     |
| `typescript-lsp`（公式の `anthropics/claude-plugins-official`）                                                                                                                      | プラグイン（ユーザー）                                                                           | 1.0.0、`a7ba5b93db0c7c8d17f3f1d25853adca79598a1a`                                                             | 定義・参照・記号の検索（`LSP` ツール）。grep より確実に型の上の参照を追える                                                                      |
| `typescript-language-server` と `typescript`（言語サーバー）                                                                                                                         | npm のグローバル                                                                                 | 6.0.3 と **6.0.3 に固定**                                                                                     | `typescript` の最新（7.0.2）には `tsserver` がなく、言語サーバーが動かない。リポジトリの `@typescript/typescript6` にも `lib/tsserver.js` がない |
| `chrome-devtools-mcp`                                                                                                                                                                | npm のグローバル（1.12.0 に固定）、MCP は `chrome-devtools-wwt`（ユーザー）                      | 1.12.0（タグ `chrome-devtools-mcp-v1.12.0`、`af2834411a564d366f9cab63efb046d9084f4dba`）                      | 開いたページの DOM・コンソール・ネットワーク・拡張の service worker を、作業の中で見る。**合否の計測には使わない**（`scripts/g11` のまま）       |

#### 入れる前に読んだこと

- threejs-skills：7つとも `SKILL.md` が1つずつで、references のフォルダはない。先頭の説明・コード以外の文・コードの中を確かめた。外部への通信、破壊的なコマンド、エージェントへの「説明せずに実行」などの指示、宣伝はない。コードは javascript・glsl・html だけで、シェルのコマンドはない。気になる点：例に `cdn.jsdelivr.net` の import map で three を読む書き方があり、新しいシェーダーは WebGPU と TSL を勧めている。WWT は three を同梱し（拡張は外のコードを読めない）、`WebGLRenderer` を使い、作品データからシェーダーを受け取らない。この違いは `wwt-world-runtime` スキルに書いた
- typescript-lsp：プラグインの中身は、言語サーバーを起動する設定（`typescript-language-server --stdio`）と README だけ
- chrome-devtools-mcp：初期設定では、使用統計と、性能の記録の URL（CrUX）を Google に送る。どちらも止めた（下）

#### Chrome DevTools MCP の起動

`claude mcp` には、起動スクリプト `~/.claude/mcp/chrome-devtools-wwt.mjs` を登録した（`node` で起動）。スクリプトが付ける引数：

| 引数                                                                                                            | 理由                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--headless`・`--isolated`                                                                                      | 翔太の作業の前に窓を出さない（AGENTS.md）。プロファイルは使い捨て                                                                                      |
| `--no-usage-statistics`・`--no-performance-crux`（と環境変数 `CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS=1`）      | Google へ何も送らない                                                                                                                                  |
| `--executablePath=<Playwright の Chromium>`                                                                     | 市販の Chrome（このPCは 156）は、137 以降、コマンドラインから未公開の拡張を読み込まない。Playwright の Chromium は読み込める                           |
| `--categoryExtensions`・`--chromeArg=--disable-extensions-except=<dist>`・`--chromeArg=--load-extension=<dist>` | WWT の `dist` を読み込んだ状態で開く。`WWT_EXTENSION=0` で読み込まない。`WWT_CHECKOUT` で対象の作業ツリーを変えられる（既定は `.work/creator-editor`） |

確かめたこと：別のセッションから使い、`HeadlessChrome/143` で開き、WWT の拡張の service worker が一覧に出た。終わったあと、Chromium のプロセスは残らなかった。`list_extensions` は、この Chromium（143）に CDP の `Extensions` ドメインがなく使えない（ほかの道具は使える）。

**Playwright の Chromium の版が変わったとき**：Playwright は、`install` のたびに、どの Playwright からも使われなくなった版のフォルダを消す（`playwright-core` の `_validateInstallationCache`。`PLAYWRIGHT_SKIP_BROWSER_GC=1` で止まる）。そのため、`.work/browsers/chromium-1243` のようにパスを固定すると、`@playwright/test` を更新して `npm run test:setup` を回した時点で切れる。起動スクリプトは、起動のたびに `.work/browsers` の中で番号の一番大きい `chromium-*` を探すので、**版が変わっても自動で追う**。1つもないときは、`npm run test:setup` を回すよう出して止まる。

### 入れなかったもの

| もの                                                                                                                     | 理由                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `threejs-react-three-fiber` と、残りの threejs スキル（geometry・textures・postprocessing・interaction・asset-pipeline） | WWT は React Three Fiber を使わない。残りは今の段階で要らない（入れた7つの本文から参照されているが、読まれないだけで害はない） |
| `cesartevisual/threejs-skills`                                                                                           | 入れないと決めた（レビュー役の調べ）                                                                                           |
| `quangpl/browser-extension-skills`                                                                                       | 宣伝と「説明せずに実行」の指示がある                                                                                           |
| `webgl-animation-skills`・`vercel-labs/agent-skills`・`every-frame-is-code`・Context7                                    | 入れないと決めた（レビュー役の調べ）                                                                                           |
| Blender Web 3D                                                                                                           | 段階6で、部屋の素材を作る場所に入れる。起動の条件が広く、WWT の性能の作業で勝手に読まれるため                                  |

### 外したもの

| もの           | 理由                                                                     |
| -------------- | ------------------------------------------------------------------------ |
| MCP `postgres` | 接続先が雛形の文字（`postgresql://ユーザー名:パスワード@…`）のままだった |
| MCP `aws`      | 接続できない（`CONNECTION_CLOSED`）                                      |

プラグイン（claude-mem ほか 33 個）は、今回は触っていない。

### スキルが読まれる順の確認

`claude -p` の別のセッションで、Skill ツールだけを許して、最初に読まれたスキルを見た（2026-11-03）。12 個（threejs の7つと WWT の5つ。のちに `wwt-world-runtime` を足して 13 個）がすべて一覧に出た。

| 言い方                                                                       | 最初に読まれたスキル                                             |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 「YouTube でスクロールすると拡張が重い。原因を調べたい」                     | `wwt-perf`（`wwt-perf` を広げる前と後の両方）                    |
| 「SPA 遷移の直後に拡張の CPU 時間が増えた。どこが重いか調べて」              | `wwt-perf`                                                       |
| 「3D のキャラを置いたページで、スクロールがカクつく」                        | `wwt-perf`（広げる前と後の両方。`threejs-performance` ではない） |
| 「キャラの歩く速さを作品ごとに変えられるように、作品データに項目を足したい」 | `wwt-design-version`、続けて `wwt-world-runtime`                 |
| 「カメラの視点の切り替えを world と Host のどちらに作るか決めたい」          | `wwt-world-runtime`                                              |

### claude-mem が各フォルダに書く CLAUDE.md

- claude-mem（9.0.2）は、触ったファイルのフォルダごとに `CLAUDE.md`（`<claude-mem-context>` のメモ）を書く。Claude Code はフォルダの中の `CLAUDE.md` を指示として読むので、AGENTS.md と並ぶルールとして効いてしまい、Codex との前提もずれる
- claude-mem 9.0.2 には、これを止める設定がない。書き込みの処理（`worker-service.cjs`）が飛ばすのは、`.git` があるフォルダ（リポジトリの直下）だけ
- `.gitignore` に、直下以外の `CLAUDE.md` を足した（直下の `CLAUDE.md` は `@AGENTS.md` のまま追跡する）。G1.2 の1回目でうっかりコミットした `tests/fixtures/takes/CLAUDE.md` は、追跡だけ外した
- `scripts/install-skills.mjs` は、スキルのフォルダの `CLAUDE.md` を写さず、比べもしない（claude-mem が `agent-skills/wwt-perf/` にも書き、入れた先へ写っていた）
- `.gitignore` はコミットを防ぐだけで、Claude Code が読むのは止めない。そこで、Claude Code の設定 `claudeMdExcludes`（読まない `CLAUDE.md` の glob。絶対パスで照合）を、作業ツリーの `.claude/settings.local.json` に入れた（2026-11-03、翔太の決定）。値は `["**/web-world-themes/.work/creator-editor/*/**/CLAUDE.md"]`。直下の `CLAUDE.md`（`@AGENTS.md`）は外れない。このファイルはコミットしない（`.git/info/exclude` に足した。作業ツリーごとの設定なので、別の作業ツリーでは入れ直す）
- 確かめたこと：`src/zz-canary/CLAUDE.md`（目印の語を書いた一時のファイル）を置き、新しいセッション（`claude -p`）に `src/host/operation-guard.ts` と同じフォルダのファイルを読ませた。設定の前は目印の語が届いた。設定の後は、受け取ったのがグローバルの `CLAUDE.md`・作業ツリー直下の `CLAUDE.md`・`AGENTS.md` の3つだけで、`src/host/CLAUDE.md` と目印の語は届かなかった。目印のフォルダは消した
- 設定が効くのは、設定を入れた後に始めたセッションだけ。すでに動いているセッションは、フォルダの `CLAUDE.md` を読み続ける

### そのほか

- グローバルの `~/.claude/CLAUDE.md` の環境の行を、「Claude Code が動くのはノートPC（Intel i7-13650HX）。デスクトップは Ryzen 5 5600X だが Claude Code は使わない」に直した（リポジトリの外）
- コミットメッセージには、本文も含めて CI を飛ばす指示の文字を、説明のつもりでも書かない。GitHub は本文のどこかにあれば CI を飛ばす（2026-11-04、本文で前のコミットのことを説明しただけの空のコミットで CI が起動しなかった）
- worktree は必ず `scripts/clean-work.mjs` で外す。worktree の `node_modules` がこのチェックアウトの `node_modules` へのジャンクションのことがあり、手で `git worktree remove --force` を使うと中までたどって消す（2026-11-04、creator-editor の `node_modules` が空になり、`npm ci` で入れ直した）

## .work の整理（2026-11-03）

`.work` は計測・テストの出力の置き場で、2026-11-03 には約 54GB（3,385 個）まで育っていた。`scripts/clean-work.mjs` が、次の規則で古いものを消す。

### 残す規則（上から順に当てはめる）

| 規則                                   | 中身                                                                                                                                                                                                                                                                                                                                                                                                                                                      | 理由                                                                                                                                                                                        |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| worktree（最初に判断する）             | 使用中（追跡しているファイルに変更がある・lock されている・このチェックアウト自身）か、ブランチを checkout している（だれかの作業場所。メインから実行すると creator-editor は「このチェックアウト自身」に当たらない）か、比較の基準（`KEEP_WORKTREES`：`g13-g12head`＝4d3f39b・`g13-before`＝557b978）なら残す。それ以外は、docs が名前を出していても・最近書かれていても、手で実行したときだけ `git worktree remove` で外し、最後に `git worktree prune` | docs が名前を出すのは結果の出どころとしてで、その版はコミットで分かる。フォルダを直接消すと git の記録が残る。`node_modules` のジャンクションは、外す前にリンクだけを消す（中をたどらない） |
| ブラウザー                             | `.work/browsers`（Playwright の Chromium）                                                                                                                                                                                                                                                                                                                                                                                                                | テストと計測が使う                                                                                                                                                                          |
| 内部                                   | `.` で始まるもの、`CLAUDE.md`                                                                                                                                                                                                                                                                                                                                                                                                                             | 整理の記録（`.clean-work-stamp`）など                                                                                                                                                       |
| パッチ                                 | `*.patch`                                                                                                                                                                                                                                                                                                                                                                                                                                                 | 手で作った差分で、作り直せない                                                                                                                                                              |
| docs・スクリプトが名前を出しているもの | `docs/`・`scripts/`・`tests/`・`agent-skills/`・`AGENTS.md`・`playwright.config.ts` に `.work/<名前>` と書かれているもの                                                                                                                                                                                                                                                                                                                                  | 報告が参照する生データと、道具の決まった出力先                                                                                                                                              |
| 最近書かれたもの                       | 中のどれかのファイルが 12 時間以内に書かれたもの                                                                                                                                                                                                                                                                                                                                                                                                          | Codex の検証や別の作業が、同じ PC で動いているかもしれない                                                                                                                                  |
| 計測・テストの出力                     | 名前の最初の `-`・`_`・`.` までを仲間（例：`g13r0-trace` → `g13r0`）とし、仲間ごとに新しい **3 回分**を残す。上の規則で残したものは数えない                                                                                                                                                                                                                                                                                                               | 比べ直しに要るのは直近の数回                                                                                                                                                                |
| プロファイルの入れ物                   | `*-profiles` の中の `run-*` も、同じ規則（新しい3回分）で整理する                                                                                                                                                                                                                                                                                                                                                                                         | 入れ物の名前はスクリプトが使うので残し、中だけ減らす                                                                                                                                        |

消すときは、リンク（Windows のジャンクションを含む）をたどらずに、リンクだけを外す。

### 手で実行する

```bash
node scripts/clean-work.mjs --dry-run
```

消すもの・残すもの（理由ごと）・外す worktree・空く容量を表示し、全部の一覧を `.work/clean-work-plan.txt` に書く。消してよければ、`--dry-run` を付けずに実行する。

```bash
node scripts/clean-work.mjs
```

### 自動の整理

`scripts/test.mjs`（`npm run test:unit` / `npm run test:e2e`、`scripts/g13` の計測を含む）、`scripts/g11/run.mjs`、`scripts/ui1/measure.mjs` は、終わるときに `autoClean()` を呼ぶ。

- 1日に1回まで（`.work/.clean-work-stamp` の時刻で判断）
- `.work` が **20GB** を超えていたときだけ、同じ規則で消す
- worktree は外さない（手で実行したときだけ）
- CI と、`WW_CLEAN_WORK=0` を付けたときは動かない

### 2026-11-04 の整理（実行済み）

dry-run の一覧を翔太が確かめてから実行した。実行後の `.work` は 7.6GB（426 個）、worktree は比べる基準の2つだけ。実行の記録は `.work/g13fix-evidence/clean-run.txt`。

`main-base`（`6721ce4`）と `ui0d3-base`（`32609a4`）は、未コミットの変更をパッチに残してから外した（翔太の決定）。どちらのパッチも、元のコミットの上で `git apply --check` が通ることを確かめた。

- `.work/main-base-6721ce4-uncommitted.patch`：`tests/fixtures.ts`・`tests/live-youtube.spec.ts`・`tests/model-live.spec.ts`・`tests/signal-motion-live.spec.ts`・`tests/studio-workspace-live.spec.ts`・`tests/vrm-live.spec.ts` の変更と、未追跡だった `tests/helpers/youtube-live.ts`・`tests/helpers/youtube-theater.ts`
- `.work/ui0d3-base-32609a4-uncommitted.patch`：`tests/side-panel.spec.ts`・`tests/signal-timeline-live.spec.ts` の変更

### 2026-11-04 のメイン直下の `.work` の整理（実行済み）

メインのチェックアウトには `scripts/clean-work.mjs` がない（main は変えない）ので、creator-editor の同じ規則を、メインを対象にして使った。最初の dry-run では、作業場所の creator-editor（8.40GB）まで外す予定に入っていたので、「ブランチを checkout している worktree は外さない」規則を足した（`222162a`）。dry-run で creator-editor が「残す」（ブランチ）に入り、外すのが Codex の検証用（`g13-bound2-*`・`g13-fix-*`・`g13-independent-*`）と `heisei-preview`・`shell-preview` の8つだけと確かめてから実行した。8つとも、未コミットの変更・remote にないコミット（Codex の報告のコミットは remote のものと同じ変更）・ジャンクションがないことを先に確かめた。空いたのは 4.33GB（13.41GB → 9.2GB。残りはほとんど creator-editor）。記録は `.work/g13fix-evidence/main-clean-run.txt`（creator-editor の中）。

#### 実行前の dry-run

worktree は比べる基準の2つ（`g13-g12head`＝`4d3f39b`・`g13-before`＝`557b978`）だけを残す規則にしてから取り直した。結果は `.work/g13fix-evidence/clean-dry-run.txt`・`.work/clean-work-plan.txt`。

| 項目          | 数                                                                                                                                        | 大きさ       |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| 今の `.work`  |                                                                                                                                           | 54.39 GB     |
| 消す          | 3,369 個                                                                                                                                  | 44.68 GB     |
| 外す worktree | 9 個（`g12-557`・`g12-before`・`g13r0-head`・`ui0c-base`・`ui0dv-base`・`ui1-base`・`ui1-verify-target`・`ui11-target`・`ui12-base-src`） | 1.17 GB      |
| 残す          | 432 個                                                                                                                                    | 8.55 GB      |
| 空く          |                                                                                                                                           | **45.85 GB** |

残すものの内訳：docs などが名前を出しているもの 93 個・4.39GB、各仲間の新しい3回分 278 個・1.84GB、最近書かれたもの 46 個・0.49GB、比べる基準の worktree 2 個・0.34GB。`main-base`（0.81GB）と `ui0d3-base`（0.19GB）は、テストのファイルに未コミットの変更があるので「使用中」として残った（上のとおり、パッチに残してから手で外した）。

## 検証の PC（デスクトップ）

2026-11-07 にセットアップ。デスクトップの Codex が検証し、実装はノート PC の Claude Code が担当する。今回の確認対象は `codex/chunk4-layering` の `9432b7868239d9710524249f548c7fef81608d73`。指定された `layering.spec.ts` と `flicker-live.spec.ts` がある版を、detached worktree に展開した。

| 項目     | 構成                                                                       |
| -------- | -------------------------------------------------------------------------- |
| CPU      | AMD Ryzen 5 5600X（6 コア、12 スレッド）                                   |
| GPU      | AMD Radeon RX 6800、ドライバー 32.0.21045.16010                            |
| メモリ   | 64 GiB（4 枚）                                                             |
| OS       | Windows 11 Pro 25H2、ビルド 26200.9711                                     |
| 電源     | Windows の電源プラン「高パフォーマンス」                                   |
| 画面     | DELL SE2425HG と Pixio PXC243。各 1920×1080、横並び。GPU の報告値は 165 Hz |
| 開発環境 | Node.js 24.11.1、npm 11.6.2、Playwright Chromium 153.0.8010.12             |

### セットアップと運用

- `npm ci` と `npm run test:setup` を実行し、Chromium をデスクトップのチェックアウト直下の `.work/browsers` に用意した。検証用 worktree からは `PLAYWRIGHT_BROWSERS_PATH` にその絶対パスを指定する。検証ビルドは worktree 内の `WW_BUILD_OUT=.work/test-dist` に作り、テストには `WW_TEST_EXTENSION_PATH=.work/test-dist` を指定する。
- 作業ブランチの `a8a4b5d` から `node scripts/install-skills.mjs` を実行し、Codex の `~/.agents/skills` と Claude Code の `~/.claude/skills` に WWT の6スキルをインストールした。`node scripts/install-skills.mjs --check` は成功。
- FFmpeg 9.0.1 Essentials を WinGet の `Gyan.FFmpeg.Essentials` でユーザー単位に導入した。ユーザー PATH から `ffmpeg -version` が通り、短い合成映像を VP9/WebM でエンコードできた。[FFmpeg の配布案内](https://ffmpeg.org/download.html)
- 私用素材は `C:\wwt-private\` 配下の原本をユーザー環境変数で参照する。`WW_VRM_FILE` と `WW_CHARACTER_VRM` は専用モーションと同じキャラクターの VRM、`WW_VRMA_DIR` は `manifest.json` と専用モーションのサブフォルダを含む親ディレクトリ、`WW_CHARACTER_MOTIONS` はそのサブフォルダ。4件とも参照先を確認した。設定前から開いているターミナルでは、新しいターミナルを開くか、Windows のユーザー環境変数をプロセスに読み込んでから実行する。
- スクリーンショットと計測は headless を基本にする。表示が必要な Chrome は `WW_TEST_WINDOW_OFFSCREEN=1` で画面外に置く。e2e 全件を回す場合は、フォーカスを取る前に翔太に伝える。
- ネイティブのキー送信と画面の検出に頼る5件（`editor-entry.spec.ts` の3件・`skin-verification.spec.ts` の緊急 OFF・`ui0d-emergency.spec.ts`）は、デスクトップでは `c5cbb68` でも `c69d9bb` でも落ちる。ノート PC（1画面）では同じ版で5件とも通る（2026-11-07、Claude Code。1度だけフォーカスの取り合いでキー送信が失敗し、単独で回し直すと通った）。デスクトップの2画面・画面外の窓へのキー送信の環境の問題で、製品の不具合ではない。デスクトップで落ちても、ノート PC で通れば合格として扱い、報告にそう書く
- 私用素材の共有は、WWT とは別の非公開リポジトリ `a3681299-png/wwt-private-assets`（人は招待しない。大きいファイルは Git LFS）で行う。中身はミルド（元の unitypackage・取り出した中身・変換した VRM・ミルドに当てた .vrma と判定の結果）と Quaternius の Universal Animation Library。トルーシェ・pokke・LP_BaseBody・Mixamo 由来の物は入れていない。ノート PC の `C:\wwt-private\` がこのリポジトリそのもの。WWT 本体のリポジトリには、今までどおり素材を入れない（2026-11-07、翔太の決定）
- デスクトップでの取得（環境変数は今のパス `C:\wwt-private\...` のまま使える）：
  1. Git LFS を入れる（`git lfs version` が通れば済み。なければ `winget install GitHub.GitLFS`）。`gh auth status` で同じアカウントに入っていること
  2. 今の `C:\wwt-private\` を退避する（中身を手で置いた場合。例：`C:\wwt-private.old` へ名前を変える）
  3. `git lfs install` のあと `git clone https://github.com/a3681299-png/wwt-private-assets.git C:\wwt-private`
  4. `git -C C:\wwt-private lfs ls-files` で LFS のファイルが並び、`C:\wwt-private\mirdo\work\mirdo-1024.vrm` が数 MB あること（中身が130バイトほどの文字なら LFS が取れていない。`git -C C:\wwt-private lfs pull`）
  5. 退避したフォルダにしかない物（トルーシェなど）は、必要なら `C:\wwt-private\ローポリモデル用\` へ戻す（`.gitignore` で、このリポジトリには入らない）
  6. 新しい物を足したら、そのリポジトリで `git add`・`git commit`・`git push`（相手の PC では `git pull`）
- 検証対象コミットは detached worktree で開く。報告は `codex/verify-reports` に docs の変更だけをコミットして push する。Claude Code はそこから報告コミットを取り込む。検証が終わったら要約と報告で参照する画像を残し、検証用 worktree と生データを片付ける。

### 動作確認

| 確認       | 結果                                                                                                                                                                                                                                                                                                     |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 型チェック | `npm run typecheck` 成功                                                                                                                                                                                                                                                                                 |
| lint       | `npm run lint` 成功                                                                                                                                                                                                                                                                                      |
| unit 全件  | 572 件通過、1 件スキップ。比較用の素体を使う任意の `WW_VRM_COMPARE_FILE` テストが対象。指定したキャラクターと VRMA の unit テストは通過                                                                                                                                                                  |
| e2e        | `npm run test:e2e -- tests/layering.spec.ts` で 1 spec・9 件通過。1 ワーカー                                                                                                                                                                                                                             |
| 実サイト   | G11 の `smoke` 1 回成功。未ログインの headless Chromium で YouTube の視聴ページを撮影し、動画・操作バー・タイトルが表示されることと、操作保護が有効なことを確認。画像1枚はデスクトップの `.work/verify-desktop-20261107/watch-top.png`。私用素材を使う実サイトテストと `flicker-live` は今回の確認範囲外 |
| CI         | 対象 `9432b78` は `[skip ci]` の docs コミットで実行履歴なし。報告ブランチの基点 `a8a4b5d` のジョブは、請求または支出上限に関する GitHub 側の制約で開始前に失敗。[CI の実行結果](https://github.com/a3681299-png/web-world-themes/actions/runs/42245038538)                                              |

### G11 同一版の振れ幅

`scripts/g11/build.mjs` で作った同一の計測ビルドを、両条件で操作保護を有効にして使用した。未ログインの headless Chromium、1920×1080、DPR 1。[同じ YouTube 視聴ページ](https://www.youtube.com/watch?v=M7lc1UVf-VE)を区間ごとにリロードし、32 レイヤー・16 グループの G11 の作品を描画した。各区間は定常状態を 15 秒待ち、3 秒の強制描画の後に 6 秒採取。`steady` の `G11_PAIR_COUNT=4` は保護ありの4区間を意味する。測定順は A1 → B1 → B2 → A2 の2組。

標準実行は、manifest が読み込んだ計測コードを再注入した際の `Identifier '__probe' has already been declared` で最初の採取前に終了した。再実行では `G11_CONTENT_FILE` に `void 0;` だけの一時ファイルを指定し、毎回 manifest が読み込んだ同じ計測コードで採取した。4区間とも G11 の保護状態・動画再生・フレーム記録の検査と `scripts/g11/analyze.mjs` が通った。

| 組・実行順 | 拡張 rAF CPU/フレーム 中央値（ms） | 拡張 rAF CPU/フレーム p95（ms） | 参考：全体 p95（ms） |
| ---------- | ---------------------------------: | ------------------------------: | -------------------: |
| 1・A → B   |           1.80 → 2.20（B−A +0.40） |            2.40 → 3.20（+0.80） |      15.537 → 21.112 |
| 2・B → A   |           1.90 → 2.60（B−A −0.70） |            2.70 → 4.80（−2.10） |      15.489 → 20.076 |

同じ組の差の絶対値は、中央値で 0.40〜0.70 ms、p95 で 0.80〜2.10 ms。4区間の値の範囲はそれぞれ 1.80〜2.60 ms、2.40〜4.80 ms。2組の定常時サンプルであり、合否判定には使わない。起動直後・SPA 遷移直後は今回の採取範囲外。G11 が計る拡張 CPU は rAF コールバックの合計で、rAF 外の処理は含まない。試行全体でネットワークエラー48件を観測したが、採用した各区間は広告・停止・バッファ待ち・動画の差し替え・ドロップフレームなし。

計測条件と組ごとの要約は [desktop-g11-aa-2026-11-07.json](benchmarks/desktop-g11-aa-2026-11-07.json) に保存した。

### 塊4の再検証で使う同一版の振れ幅（60 Hz）

2026-11-07、デスクトップの Ryzen 5 5600X、Radeon RX 6800、Windows 11 Pro 26H2（26300.9711）、Playwright Chromium 153.0.8010.12。画面外のウィンドウ（座標 −4000, 0）は主画面の更新周期を使ったため、主画面を 165 Hz から一時的に 60 Hz にした。Chromium 上で約 16.7 ms の rAF 周期と ANGLE の Radeon RX 6800／D3D11 を確認した。ビューポートは 1920×1080 CSS px、DPR 1。

`c5cbb68` の同一計測ビルドで、g11 単独と g11＋CDP を別々に8組ずつ採った。奇数組は A → B、偶数組は B → A。両側とも、未ログインの種プロファイルを別々に複製し、自律オンの公開マネキンをプレーヤー右下に1体置いた。起動は動画へのナビゲーションから6秒、定常は6秒の待機後に毎秒カーソルをプレーヤーへ出し入れする6秒、検索 SPA は左から急接近してマネキンの逃走を確認し、検索語 `lofi` の Enter から6秒。起動前の同一オリジンの空ページは拡張の注入対象外で、実際の視聴ページはネットワークから読み込んだ。g11 の校正では、rAF に足した 2 ms を2窓とも中央値 2.00 ms として計測した。[視聴ページ](https://www.youtube.com/watch?v=LC1a-DwUhls)

g11 は拡張の rAF コールバックの経過時間で、同期 DOM 処理を含む。CDP は 500 μs 間隔の V8 サンプルから、計測対象拡張の URL が付いたスクリプトの自己時間を合計した。1フレームの集計は g11 が拡張コールバックのあるフレーム、CDP がページの rAF 間隔（拡張サンプルのないフレームは 0）。要約 JSON に g11 の全フレーム集計も併記した。長い処理はページの Long Tasks API で 50 ms 以上の件数を採り、拡張の内訳の参考として g11 の 50 ms 以上の rAF コールバック数と、CDP で拡張サンプルが重なった長い処理の件数を別々に記録した。後者は処理全体の時間を拡張に帰属させる指標ではない。

動画は `getVideoPlaybackQuality()` を同じ動画要素・ソースごとに差分集計した。検索では旧動画が外れるまでの時間とフレーム総数を分母とする。採取の成立、広告・表示状態、モデルの描画、実 GPU を確認し、無効な区間は同じ組の両側を再採取した。バックグラウンド CPU の数値は今回の要約にない。

各値は同一版8組の **B−A の最小〜最大**。1フレームの中央値・p95は各窓で求めてから組差にした。ページの長い処理とフレーム落ちは件数。動画の総フレーム数・割合・観測時間は各窓の要約にある。

| 場面     | 採取     | 拡張 CPU 6秒合計 (ms) | ページの長い処理 | 拡張側の長い処理の参考 | 動画の落ち | 1フレーム中央値 (ms) | 1フレーム p95 (ms) |
| -------- | -------- | --------------------: | ---------------: | ---------------------: | ---------: | -------------------: | -----------------: |
| 起動直後 | g11 単独 |         −130.7〜+25.7 |           −3〜+5 |                      0 |     −2〜+3 |         −0.40〜+0.70 |      −5.00〜+18.80 |
| 起動直後 | CDP      |         −76.3〜+198.4 |           −6〜+5 |                 −6〜+6 |     −3〜+2 |         −0.47〜+1.04 |      −11.70〜+7.61 |
| 定常     | g11 単独 |          −67.0〜+52.9 |                0 |                      0 |          0 |         −0.10〜+0.10 |       −0.40〜+0.70 |
| 定常     | CDP      |         −126.1〜+25.4 |                0 |                      0 |          0 |         −0.24〜+0.06 |       −0.95〜+0.66 |
| 検索 SPA | g11 単独 |         −59.1〜+112.9 |           −2〜+2 |                      0 |     −1〜+1 |         −0.60〜+0.60 |       −5.30〜+5.60 |
| 検索 SPA | CDP      |          −51.4〜+64.7 |           −6〜+4 |                 −5〜+3 |     −2〜+1 |                    0 |       −1.62〜+0.94 |

CDP 第1組の最初の起動窓は、終了の読み取りが遅れ、モデル描画も確認できなかったため、両側を再採取した。この組の定常・検索 SPA には最初の窓を使った。主画面は A/A の採取後に 165 Hz へ復元した。

塊4の再検証では、この PC の同じ条件で起動直後・検索 SPA の6秒合計を計測器ごとの幅と照合し、50 ms 以上の処理と動画のフレーム落ちも組ごとに確認する。定常は拡張 CPU／フレームの中央値の増分 +0.5 ms、p95 の増分 +1.0 ms を基準とする。

[組ごとの要約と除外理由](benchmarks/desktop-aa-c5cbb68-60hz-2026-11-07.json)

## 実装の PC（ノート PC）の Chromium（2026-11-07）

| 項目       | 構成                                                                                                             |
| ---------- | ---------------------------------------------------------------------------------------------------------------- |
| CPU・GPU   | Intel Core i7-13650HX、Intel UHD Graphics（画面の出力）と NVIDIA GeForce RTX 3050 6GB Laptop GPU                 |
| 画面       | 1920×1080、144 Hz                                                                                                |
| Playwright | 1.63.0（`package.json`）。Chromium は revision 1243 = **153.0.8010.12**。メインの `.work/browsers/chromium-1243` |

- `.work/browsers` は `package.json` の Playwright と合っていた（`npm run test:setup` は不要だった）。テスト（`scripts/test.mjs`）はここを使う。`.work` の worktree には自分の `.work/browsers` がないので、`PLAYWRIGHT_BROWSERS_PATH` にメインの `.work/browsers` の絶対パスを指定する
- これまでのノート PC の G11 の数値の「Chromium 143.0.7499.4」は、`scripts/g11` が `PLAYWRIGHT_BROWSERS_PATH` なしで動き、ユーザー全体のキャッシュ（`%LOCALAPPDATA%\ms-playwright\chromium-1200`、古い Playwright のもの）を使っていたため。`scripts/g11/environment.mjs` は、`G11_BROWSER_PATH` がなければ、`PLAYWRIGHT_BROWSERS_PATH`、なければメインの `.work/browsers` の、この Playwright の revision の Chromium を使うようにした（塊4のブランチ）。143 と 153 の数値は並べて比べない
