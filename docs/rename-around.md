# Around への名称変更（2026-11-14）

Web World Themes（WWT）を Around に改めた。既存の利用者の作品・設定はないため、旧名称の互換コードと移行処理は作っていない。

## 済んだこと

| 対象                                                                                 | 変更                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| コードと文書（ブランチ `rename/around`、`feat/living-onboarding` の `475d540` から） | 製品名・UI の文言・識別子・保存のキー・IndexedDB 名・DOM の id と属性・環境変数・テスト用の入口・バックアップ形式・npm パッケージ名・スキル・docs をすべて Around に統一。584 ファイル、48 のパスを移動                                                                                                |
| 名前の対応                                                                           | `Web World Themes`／`WWT` → `Around`、`webWorldThemes` → `around`、`web-world-themes-*` → `around-*`、`data-ww-*` → `data-around-*`、`WW_*` → `AROUND_*`、`__ww*` → `__around*`、`ww*`（識別子）→ `around*`、`.wwbackup`・`WWT-BACKUP` → `.aroundbackup`・`AROUND-BACKUP`、スキル `wwt-*` → `around-*` |
| バックアップの fixture                                                               | `tests/fixtures/backups/` と `docs/benchmarks/r31-verification/` の4ファイルを新しい形式に書き換えた（中の JSON に同じ名称変更、JSON の SHA-256 を再計算、素材の本体は同じ）                                                                                                                           |
| GitHub                                                                               | リポジトリを `a3681299-png/web-world-themes` から `a3681299-png/around` に改名。ノート PC の `origin` を新しい URL に変えた（全 worktree で共有）                                                                                                                                                      |
| 企画資料                                                                             | `deliverables/wwt_proposal/` → `deliverables/around_proposal/`、`WWT_企画書*` → `Around_企画書*`。図版と企画書を作り直した（git の外）                                                                                                                                                                 |

## 変えていない名前（このリポジトリの外にある物）

- 私用の素材のリポジトリとフォルダ：`wwt-private-assets`、`C:\wwt-private`、`C:/wwt_room_work` など
- 公開した確認用のサイト：`wwt-deploy-probe.lolipop-now.app`
- MCP サーバーの名前：`chrome-devtools-wwt`（各 PC の設定）
- PC のフォルダのパス：`C:\Users\…\GitHub-Projects\web-world-themes`（下の手順で後から変える）。docs の中の過去の記録のパスも、そのときの事実なので残す

## 残っていること

### 1. このブランチを他の作業に取り込む

ほかのブランチ（`main`・`codex/creator-editor-spike`・各 `codex/*`）は旧名称のまま。取り込むと名前の違いで大きく衝突するので、続ける作業はこのブランチの上に載せ直す。旧名称のブランチの変更を持ってくるときは、同じ名称変更を当ててから取り込む。

### 2. PC のフォルダ名を変える（各 PC で1回）

フォルダを動かすと、`.work` の worktree の登録・ジャンクション（`node_modules`・`.work/browsers`）・Claude Code の記憶の保存場所（フォルダのパスから決まる）が切れる。手順：

1. 作業中の変更をすべてコミットし、開いているエディター・ターミナル・Chrome（テスト用）を閉じる
2. `node scripts/clean-work.mjs` で要らない worktree を外す（ブランチを checkout している worktree は残る）
3. フォルダを `GitHub-Projects\around` に移す
4. 新しい場所で `git worktree repair` を実行し、残した worktree の登録を直す
5. `.work` の中のジャンクションを `clean-work` で外してから作り直す（手で消さない。リンク先が消える）
6. Claude Code の記憶（`~/.claude/projects/C--Users-…-web-world-themes/memory/`）を新しいパスのフォルダへコピーする
7. デスクトップ PC でも同じ手順。`origin` の URL は GitHub がリダイレクトするが、`git remote set-url origin https://github.com/a3681299-png/around.git` で直しておく

### 3. スキルを入れ直す

スキル名が `around-*` に変わった。`node scripts/install-skills.mjs` で入れ直し、古い `wwt-*` のスキルを各 PC のユーザー用フォルダから外す。

## 確かめたこと

型チェック・lint（Prettier を含む）・ビルドが通過。unit 725 件通過（3件スキップ）。e2e は、バックアップ・ページの印・エディター・拡張の基本の 33 件が通過（全件は Codex の検証で回す）。旧名称の残りは、上の「変えていない名前」だけ。
