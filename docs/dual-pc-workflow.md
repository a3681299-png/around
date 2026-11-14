# ノート PC とデスクトップ PC の運用（2026-11-11）

`feat/living-onboarding` の作業を、ノート PC からデスクトップ PC へ引き継いだ記録と、今後どちらの PC でも同じ形で進めるための決まり。

## 運用の決まり

- **作業開始時**：`git fetch --all --prune` で GitHub の最新を確認する。`git status` で未コミットの変更がないこと、作業ブランチが `origin` と同じか進んでいるだけ（fast-forward）であることを見てから始める。別 PC の作業が先にあれば `git pull --ff-only` で取り込む
- **作業終了時**：重要な変更と引き継ぎ（このファイル、または段階の docs）を更新して、コミット・push する。**LFS の物は `git lfs push origin <ブランチ>`（または push 時の hook）で実体まで届いたことを確かめる**（下の「既知の問題」）
- **禁止**：`git push --force`、`git reset --hard` や `git checkout --` による未確認のローカル変更の破棄、別 PC の作業を上書きする操作
- 私用素材（`wwt-private-assets`）は Around 本体に入れない。`C:\wwt-private` を使い、Felis など `.gitignore` の物（`Felis_v0.8.1/`）はそのまま残す

## 部屋をすぐ開く固定 URL（2026-11-12）

どちらの PC でも、部屋は **http://127.0.0.1:4180/** で開く（ブックマーク 1 つで両方に使える。最後に見た動画など、ブラウザーに残る物もこのアドレスに付く）。

```bash
npm run living
```

`.workliving-onboarding` で実行すると、その PC の私用素材（`AROUND_PRIVATE`、なければ `C:around-private`）からフェリス入りで作り直し、上の URL で出して、ブラウザーで開く。止めるときは Ctrl+C。ブラウザーを開かずに出すときは `npm run living -- --no-open`。

- **この PC の中だけで受ける**（127.0.0.1 のみ、ほかの機器からは開けない）。フェリスは規約が未確認なので、外のサーバーや公開の URL には載せない
- 私用素材がない・まだ LFS の実体がないときは、フェリスなしで開き、理由を表示する。デスクトップで初めて使う前に：

  ```bash
  cd C:around-private && git pull --ff-only && git lfs pull
  ```

- 開くたびにそのチェックアウトから作り直す（`.workliving-room-live`）。作り直しに失敗したら、前に作った物を出す
- 開発用のプレビュー（4181〜4183、テスト用の入口あり）とは別。こちらにはテスト用の入口を入れない

## デスクトップの構成（2026-11-11 確認）

| 項目                 | 内容                                                                                                                                                                                           |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 本体のチェックアウト | `C:\Users\kuros\GitHub-Projects\web-world-themes`（`codex/creator-editor-spike`、clean）                                                                                                       |
| 作業用 worktree      | `.work\living-onboarding`（`feat/living-onboarding`、`origin` を追跡）。既存の worktree には触らない                                                                                           |
| 素材リポジトリ       | `C:\wwt-private`（`a3681299-png/wwt-private-assets`、`main`）。`git lfs fsck` OK、LFS 145 件すべて実体あり                                                                                     |
| Felis                | `C:\wwt-private\Felis_v0.8.1\FBX\Felis.fbx`・`Felis_Android.fbx`（未追跡のまま。リポジトリに入れない）                                                                                         |
| Node.js / npm        | 24.11.1 / 11.6.2。worktree で `npm ci`                                                                                                                                                         |
| Git LFS              | 3.8.1。`gh` は `a3681299-png` でログイン済み                                                                                                                                                   |
| Blender              | 5.2.2 LTS（`C:\Program Files\Blender Foundation\Blender 5.2\blender.exe`）                                                                                                                     |
| 環境変数             | `AROUND_VRM_FILE`・`AROUND_CHARACTER_VRM`・`AROUND_VRMA_DIR`・`AROUND_CHARACTER_MOTIONS` は `C:\wwt-private\mirdo\...` を指す設定済み                                                          |
| Blender MCP          | 使える（2026-11-11、アドオン 1.8）。`read_factory_settings` を MCP から呼ぶとアドオンが止まり、Blender で「Start MCP Server」を押し直すことになる。まとまった処理はヘッドレスの Blender で行う |
| VRM Add-on           | 2026-11-11 に Blender の公式リポジトリから入れた（`blender --online-mode --command extension install vrm --enable`）。`fbx_to_vrm.py`・`retarget_vrma.py` に要る                               |

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

## 引き継ぎ後の確認（`a159c3e`、2026-11-11）

ノート PC が LFS の実体を送ったあと、デスクトップで `git pull --ff-only` と `git lfs pull` が通った。

| 確認                           | 結果                                                                                                                                  |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| LFS の SHA-256                 | `room.glb` 8f8a3f20…、`living-room.blend` e3625b29…（ノート PC の記録と一致）                                                         |
| 完成済みの部屋のブラウザー表示 | 再生成せず、取得した GLB・ライトマップで表示できた（`build-living-room.mjs` → `capture.mjs`、目印 12 か所・床 42 三角形、到達不能 0） |
| `living-room.blend`            | Blender 5.2.2 のヘッドレスで開けた（496 オブジェクト、カメラ `camera_main`）                                                          |
| 撮影時の 404                   | 1 件（`capture.mjs` の errors）。部屋の表示と目印には影響なし。原因は未調査（favicon の可能性）                                       |

## 既知の問題

1. 指定されていた引き継ぎ文書は `docs/living-onboarding-handoff.md` として届いた
2. `feat/living-onboarding` は `codex/creator-editor-spike` の子孫ではなく、`codex/living-room`（`eca7c0a`）から伸びている。作業ブランチへの取り込み時に別途整理が要る
3. フェリスの素材（取り出したテクスチャ・変換した VRM・当てた動作・録画）は各 PC の `C:\wwt-private\Felis_v0.8.1\` にだけあり、同期されない。もう一方の PC では [living-body.md](living-body.md) 5 節の手順で作り直す
