# ノート PC とデスクトップ PC の運用（2026-11-11）

`feat/living-onboarding` の作業を、ノート PC からデスクトップ PC へ引き継いだ記録と、今後どちらの PC でも同じ形で進めるための決まり。

## 運用の決まり

- **作業開始時**：`git fetch --all --prune` で GitHub の最新を確認する。`git status` で未コミットの変更がないこと、作業ブランチが `origin` と同じか進んでいるだけ（fast-forward）であることを見てから始める。別 PC の作業が先にあれば `git pull --ff-only` で取り込む
- **作業終了時**：重要な変更と引き継ぎ（このファイル、または段階の docs）を更新して、コミット・push する。**LFS の物は `git lfs push origin <ブランチ>`（または push 時の hook）で実体まで届いたことを確かめる**（下の「既知の問題」）
- **禁止**：`git push --force`、`git reset --hard` や `git checkout --` による未確認のローカル変更の破棄、別 PC の作業を上書きする操作
- 私用素材（`wwt-private-assets`）は WWT 本体に入れない。`C:\wwt-private` を使い、Felis など `.gitignore` の物（`Felis_v0.8.1/`）はそのまま残す

## デスクトップの構成（2026-11-11 確認）

| 項目                 | 内容                                                                                                                  |
| -------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 本体のチェックアウト | `C:\Users\kuros\GitHub-Projects\web-world-themes`（`codex/creator-editor-spike`、clean）                              |
| 作業用 worktree      | `.work\living-onboarding`（`feat/living-onboarding`、`origin` を追跡）。既存の worktree には触らない                  |
| 素材リポジトリ       | `C:\wwt-private`（`a3681299-png/wwt-private-assets`、`main`）。`git lfs fsck` OK、LFS 145 件すべて実体あり            |
| Felis                | `C:\wwt-private\Felis_v0.8.1\FBX\Felis.fbx`・`Felis_Android.fbx`（未追跡のまま。リポジトリに入れない）                |
| Node.js / npm        | 24.11.1 / 11.6.2。worktree で `npm ci`                                                                                |
| Git LFS              | 3.8.1。`gh` は `a3681299-png` でログイン済み                                                                          |
| Blender              | 5.2.2 LTS（`C:\Program Files\Blender Foundation\Blender 5.2\blender.exe`）                                            |
| 環境変数             | `WW_VRM_FILE`・`WW_CHARACTER_VRM`・`WW_VRMA_DIR`・`WW_CHARACTER_MOTIONS` は `C:\wwt-private\mirdo\...` を指す設定済み |
| Blender MCP          | **未設定**（Claude Code の MCP 一覧が空、`uvx` もない、Blender のユーザーアドオンもなし）。必要になったら別途入れる   |

## worktree の作り方（LFS の実体が GitHub にない間）

LFS の実体が取れないと `git worktree add` の checkout が失敗する。実体を後から取るため、ポインターのまま展開する。

```bash
GIT_LFS_SKIP_SMUDGE=1 git worktree add .work/living-onboarding feat/living-onboarding
# 実体が push されたあと、worktree の中で：
git lfs pull
```

## 確認結果（`d9ac881`）

| 確認                | 結果                                                                                                                                                |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck` | 成功                                                                                                                                                |
| `npm run lint`      | 成功（prettier・独自 lint・eslint）                                                                                                                 |
| `npm run test:unit` | 644 件通過、2 件スキップ                                                                                                                            |
| Blender             | ヘッドレスで起動し、`C:\wwt-private\room\source\room.blend`（別の古い部屋）を開けた（37 オブジェクト）。`Felis.fbx` も読み込めた（12 オブジェクト） |
| 完成済みの部屋      | **未確認**（下の「既知の問題」）                                                                                                                    |

## 既知の問題

**更新（2026-11-11、ノート PC）**：1 と 2 は解決した。1 は `git lfs push --object-id` で実体を送り、新しい clone で `git lfs pull` が通って SHA-256 が合うことまで確かめた（原因と再発防止は [living-onboarding-handoff.md](living-onboarding-handoff.md) の 9 節）。2 は同じ文書を作った。3 は残っている。以下は報告時点の記録。

1. **`art/living-room/web/room.glb` と `art/living-room/living-room.blend` の LFS 実体が GitHub にない**（404）。`feat/living-onboarding` の `0cd4079` はこの2つを LFS ポインターとして持つが、実体（`room.glb` sha256 `8f8a3f20…`・14.7MB、`living-room.blend` sha256 `e3625b29…`・11.6MB）がノート PC から push されていない。デスクトップの `C:\wwt-private` にあるのは別の古い部屋（`room-packed-*.glb`）で、代わりにならない。`lightmap.png` は LFS ではなく通常のファイルとして入っていて取得済み
   - **ノート PC でやること**：`git lfs push origin feat/living-onboarding`（失敗するなら `git lfs push --all origin`）。そのあと `git lfs ls-files` で2つが `*` になっていることと、デスクトップで `git lfs pull` が通ることを確かめる。実体の場所は `.gitattributes` の LFS 指定（`origin` の `.gitattributes` を確認）
   - 実体が届いたら、デスクトップで「部屋を再生成せず、取得した GLB・ライトマップでブラウザー表示」と「`living-room.blend` を開く」を確認する
2. 指定された `docs/living-onboarding-handoff.md` は、`feat/living-onboarding`（`d9ac881`）にも他の remote ブランチにも存在しない。ノート PC で未コミットか未 push の可能性がある。代わりに `docs/living-room.md`・`docs/living-room-art.md`・`docs/tooling.md` を読んだ
3. `feat/living-onboarding` は `codex/creator-editor-spike` の子孫ではなく、`codex/living-room`（`eca7c0a`）から伸びている。作業ブランチへの取り込み時に別途整理が要る
