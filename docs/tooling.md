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

## .work の整理（2026-11-03）

`.work` は計測・テストの出力の置き場で、2026-11-03 には約 54GB（3,385 個）まで育っていた。`scripts/clean-work.mjs` が、次の規則で古いものを消す。

### 残す規則（上から順に当てはめる）

| 規則                                   | 中身                                                                                                                                                                                                                                                                                                                    | 理由                                                                                                                                                                                        |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| worktree（最初に判断する）             | 使用中（追跡しているファイルに変更がある・lock されている・このチェックアウト自身）か、比較の基準（`KEEP_WORKTREES`：`g13-g12head`＝4d3f39b・`g13-before`＝557b978）なら残す。それ以外は、docs が名前を出していても・最近書かれていても、手で実行したときだけ `git worktree remove` で外し、最後に `git worktree prune` | docs が名前を出すのは結果の出どころとしてで、その版はコミットで分かる。フォルダを直接消すと git の記録が残る。`node_modules` のジャンクションは、外す前にリンクだけを消す（中をたどらない） |
| ブラウザー                             | `.work/browsers`（Playwright の Chromium）                                                                                                                                                                                                                                                                              | テストと計測が使う                                                                                                                                                                          |
| 内部                                   | `.` で始まるもの、`CLAUDE.md`                                                                                                                                                                                                                                                                                           | 整理の記録（`.clean-work-stamp`）など                                                                                                                                                       |
| パッチ                                 | `*.patch`                                                                                                                                                                                                                                                                                                               | 手で作った差分で、作り直せない                                                                                                                                                              |
| docs・スクリプトが名前を出しているもの | `docs/`・`scripts/`・`tests/`・`agent-skills/`・`AGENTS.md`・`playwright.config.ts` に `.work/<名前>` と書かれているもの                                                                                                                                                                                                | 報告が参照する生データと、道具の決まった出力先                                                                                                                                              |
| 最近書かれたもの                       | 中のどれかのファイルが 12 時間以内に書かれたもの                                                                                                                                                                                                                                                                        | Codex の検証や別の作業が、同じ PC で動いているかもしれない                                                                                                                                  |
| 計測・テストの出力                     | 名前の最初の `-`・`_`・`.` までを仲間（例：`g13r0-trace` → `g13r0`）とし、仲間ごとに新しい **3 回分**を残す。上の規則で残したものは数えない                                                                                                                                                                             | 比べ直しに要るのは直近の数回                                                                                                                                                                |
| プロファイルの入れ物                   | `*-profiles` の中の `run-*` も、同じ規則（新しい3回分）で整理する                                                                                                                                                                                                                                                       | 入れ物の名前はスクリプトが使うので残し、中だけ減らす                                                                                                                                        |

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

### 2026-11-04 の dry-run（まだ消していない）

worktree は比べる基準の2つ（`g13-g12head`＝`4d3f39b`・`g13-before`＝`557b978`）だけを残す規則にしてから取り直した。結果は `.work/g13fix-evidence/clean-dry-run.txt`・`.work/clean-work-plan.txt`。

| 項目          | 数                                                                                                                                        | 大きさ       |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| 今の `.work`  |                                                                                                                                           | 54.39 GB     |
| 消す          | 3,369 個                                                                                                                                  | 44.68 GB     |
| 外す worktree | 9 個（`g12-557`・`g12-before`・`g13r0-head`・`ui0c-base`・`ui0dv-base`・`ui1-base`・`ui1-verify-target`・`ui11-target`・`ui12-base-src`） | 1.17 GB      |
| 残す          | 432 個                                                                                                                                    | 8.55 GB      |
| 空く          |                                                                                                                                           | **45.85 GB** |

残すものの内訳：docs などが名前を出しているもの 93 個・4.39GB、各仲間の新しい3回分 278 個・1.84GB、最近書かれたもの 46 個・0.49GB、比べる基準の worktree 2 個・0.34GB。`main-base`（0.81GB）と `ui0d3-base`（0.19GB）は、テストのファイルに未コミットの変更があるので「使用中」として残る（消すと変更が失われる。扱いは翔太が決める）。
