# 部屋をいつでも URL で開く（Cloudflare、R2 + Worker）

サーバーを起動せずに、`https://living-room.<自分のドメイン>` で部屋（デスクトップとライブモードを含む）を開く。**フェリスは入らない**（規約が未確認なので、公開用ビルドには入れない決まり）。フェリス入りは今までどおり手元の `npm run living`。

## 今の状態（2026-11-13、翔太の決定）

- **認証なし**：Access を使わず、ドメインを知っていれば誰でも開ける（Worker は `noindex` で検索には出さない）。部屋の家具の Tripo のモデルも、誰でも取れる
- **フェリス入り**：翔太が「規約上問題ない」と決めたので、フェリスの VRM と動作を載せた。**アドレスを知っている人は、フェリスのモデルと動作のファイルを取れる**（`content/character/`）。権利の判断は翔太のもの。取り込み方を変える（Access をかける、載せるのをやめる）ときは、下の手順
- アップロードの道具は、**フェリスを載せるときだけ**、明示の印（`--allow-character`）と `.work` の下のビルド（`--from`）を求める。印がなければ、今までどおり拒否する

```bash
# フェリス入りで載せる（`npm run living` と同じ素材を使い、テスト用の入口を付けずに作る）
AROUND_LIVING_OUT=.work/living-room-felis AROUND_LIVING_TEST=   AROUND_LIVING_CHARACTER=C:/wwt-private/Felis_v0.8.1/work/felis-1024.vrm   AROUND_LIVING_MOTIONS=C:/wwt-private/Felis_v0.8.1/motions node scripts/build-living-room.mjs
node scripts/living-room/host/upload.mjs --from .work/living-room-felis --allow-character
# キャラなしに戻す（フェリスのファイルを消して、公開用ビルドで上書き）
node scripts/living-room/host/upload.mjs --remove-character
node scripts/build-living-room.mjs && node scripts/living-room/host/upload.mjs
```

> 上の「守っていること」の「`character/`… が混ざっていたら止まる」は、印なしの公開用ビルドの話。

## 構成

| 部分           | 内容                                                                                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 置き場所       | R2（Cloudflare の保存場所）。無料枠は保存 10 GB。1 ファイルの上限が実質ないので、`room.glb`（23.6 MiB）が育っても困らない（Pages は 1 ファイル 25 MiB まで） |
| 配信           | Worker（`scripts/living-room/host/worker.mjs`、約 70 行）。読むだけ。`workers.dev` の公開アドレスは作らない                                                  |
| 入れる人の制限 | Cloudflare Access（Zero Trust、無料、50 人まで）。自分のメールにワンタイムコードが届く                                                                       |
| 手元の容量     | 増えない（ビルドは `.gitignore` 済み）                                                                                                                       |

アドレスのサブドメインは `living-room`（ホスト名に `_` は使えないので、`living_room` ではなくハイフン）。

## 手順（最初の 1 回）

Cloudflare への最初のログインと、画面の設定は、本人の操作。Access は**先に**作る（ドメインを足した瞬間に誰でも開ける時間をなくすため）。

```bash
# 1. ログイン（ブラウザーが開く）と、保存場所の作成
npx wrangler@4 login
npx wrangler@4 r2 bucket create living-room

# 2. 公開用ビルド（フェリスなし）と、アップロード
node scripts/build-living-room.mjs
node scripts/living-room/host/upload.mjs --dry-run   # 先に、何が行くかを見る
node scripts/living-room/host/upload.mjs

# 3. Worker を置く
cd scripts/living-room/host && npx wrangler@4 deploy
```

4. **Access を先に作る**（ダッシュボード → Zero Trust → Access → Applications → Add an application → Self-hosted）
   - Application domain：`living-room` ・ ドメイン：自分のドメイン
   - Policy：Action は Allow、Include は「Emails」で自分のメールアドレス
   - （初めて Zero Trust を開くときは、チーム名を決める。無料プランでも支払い方法の登録を求められることがある）
5. **ドメインを足す**（Workers & Pages → living-room → Settings → Domains & Routes → Add → Custom domain）：`living-room.<自分のドメイン>`
6. **確かめる**：シークレットウィンドウで開く → メールの入力画面が出る（部屋が出たら、Access が効いていない。ドメインを外して 4 をやり直す）。自分のメールでコードを受けて入ると部屋が出る。

R2 の「公開アクセス」と `r2.dev` のアドレスは**有効にしない**（Worker を通らず、Access も効かなくなる）。

## 部屋を直したあと

```bash
node scripts/build-living-room.mjs
node scripts/living-room/host/upload.mjs
```

Worker は変えなくてよい。開き直せば新しい版になる（配信は毎回「変わったか」を確かめる設定）。

## 守っていること

- アップロードの道具は `dist-living-room/` だけを送り、`character/`・`motions/`・`.vrm`・`.vrma`・`.fbx`・`.psd`・`.blend` などが混ざっていたら、1 つも送らずに止まる（わざと混ぜて確かめた）
- Worker は GET と HEAD だけ。`..`・`\`・空の区切り・null を含む道は 404。どの答えにも `noindex`（検索に出さない）と `nosniff` が付く
- Worker の設定ファイルにアカウントの情報は入れていない（ドメインは画面で足す）

## 未確認・気になる所

- **実際にアップロードして開くところまでは、していない**（Cloudflare のアカウントが要るため）。Worker の配信ロジックは unit で確かめた（`tests/living-room-host.spec.ts`、4 件）が、R2 に本物のファイルを置いた状態での動作、Range の応答、Access の画面は未確認
- ライブモードは https で動くはずだが（タブの取り込みは安全な接続が要る）、置いたあとに本物の YouTube で確かめる
- `wrangler` のコマンドの細かい引数（`r2 object put --remote` など）は版で変わりうる。`wrangler@4` に固定してある
- 無料枠の数字（R2 保存 10 GB、Workers 1 日 10 万リクエスト、Access 50 人）は記憶による。ダッシュボードで確かめる
- 公開物に Tripo のモデルが入る（部屋の家具）。ネットへの公開は、翔太が「自分だけ」に限る前提で進めている。**「誰でも」にするなら、モデルの扱いを先に確かめる**
