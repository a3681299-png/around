# Playground の適用前の準備とデプロイ計測

設計書 rev 116 に合わせ、適用前の準備と計測の手順を `codex/playground-startup` に分けた。デスクトップの途中版は `codex/playground-desktop` の `52fa121` にある。この枝では、街の作品データを受け取るまで、起動の確認に従来の動画サイトと仮の部屋を使う。作品データの版は v17。

## 適用までの動き

最初に約 2 kB の `app.js` で動画サイトの操作をつなぎ、最初の描画を待ってから作品の処理を読み込む。3D では部屋、キャラ、着座クリップを検証して読み込み、座った姿勢を一度評価する。外したキャンバスの小さな描画で、背景用の描画先と画面用の描画先の両方のシェーダーを準備する。先に押した場合はボタンを「準備中…」にし、動画サイトの操作を受け付けたまま、準備ができた時点で適用する。

基本版は検証済みの素材のバイト列を先に用意し、適用後に共通の描画器で姿勢を作る。クリップを再取得した場合も、姿勢を評価して最初の絵を描くまで、キャラのキャンバスは非表示。カメラの寄り方とレンズシフトは、仮の部屋で初めの着座を画面に収めるための Playground 側の値。

## デプロイナウで測る手順

1. `codex/playground-startup` で `npm ci` と `npm run build:playground:probe` を実行する。公開計測の出力は `.work/playground-deploy-probe`。マネキンと自作の仮の部屋を使う。ローカル素材を指定した場合や、テスト用フックを有効にした場合はビルドを止める。出力検査は既存の素材名とハッシュの検証を使う。
2. `.work/playground-deploy-probe` の中身だけを、リポジトリの外に作った空のフォルダーへコピーする。`index.html` がコピー先の直下にあることと、下表のファイルと合計を確認する。前回、Git の無視対象のディレクトリを直接指定すると CLI が空と判定した。 [前回の配信確認](playground-plan.md#置いて確かめた結果2026-11-05claude-code)
3. 翔太と一緒に、試験専用プロジェクトへのログインと公開を行う。コピー先で `npx -y lolipop login`。初回は `npx -y lolipop deploy --name <試験プロジェクト名> --framework static`、同じ試験先への2回目以降は `npx -y lolipop deploy --project <試験プロジェクトID>`。ダッシュボードで READY を確認してから、HTTPS のルート URL を開く。Free プランのアップロード上限は 100 MB。 [静的サイト](https://deploy.lolipop.jp/docs/frameworks/static) · [CLI](https://deploy.lolipop.jp/docs/cli) · [プラン](https://deploy.lolipop.jp/docs/plans)
4. リポジトリへ戻って `node scripts/playground/measure-start.mjs <HTTPSのルートURL> 5` を実行し、JSON を保存する。デスクトップの同じブラウザーで、新しいコンテキストとキャッシュ無効化を使う。最初の表示（FCP）、動画の初フレーム、準備完了、適用から部屋とキャラの初フレームまで、適用前と適用後の転送量を記録する。CDN のキャッシュは別扱いとし、公開 URL と測定日を一緒に記録する。
5. DevTools の Network で JavaScript モジュールの MIME、`Content-Encoding`、`Cache-Control` を確認する。`content/video-a.webm` に `Range: bytes=0-1023` を送るときのステータスと `Content-Range` を控える。ページ上で再生、シーク、音量、検索、適用と解除を試し、コンソールの CSP エラーを確認する。

配信するファイルは下表の18件。バイト数は圧縮前。ハッシュ付きのファイル名はビルドで変わる。

| ファイル                             |      バイト数 |
| ------------------------------------ | ------------: |
| `index.html`                         |         4,057 |
| `style.css`                          |         3,977 |
| `app.js`                             |         1,918 |
| `chunks/theme-*.js`                  |     1,137,607 |
| `chunks/lottie-light-*.js`           |       168,579 |
| `chunks/chunk-*.js`                  |           111 |
| `content/manifest.json`              |         1,546 |
| `content/design.json`                |         9,163 |
| `content/video-a.webm`               |        39,988 |
| `content/video-b.webm`               |       160,788 |
| `content/asset-24d2e8….vrm`          |        42,640 |
| `content/asset-6e0021….png`          |        15,209 |
| `content/asset-a7fd60….vrma`         |         2,836 |
| `content/asset-efad62….vrma`         |         3,956 |
| `THIRD_PARTY_NOTICES.md`             |         1,710 |
| `assets/licenses/lottie-web-MIT.txt` |         1,075 |
| `assets/licenses/three-MIT.txt`      |         1,081 |
| `assets/licenses/three-vrm-MIT.txt`  |         1,072 |
| **合計**                             | **1,597,313** |

## 手元で確かめた結果

Windows 11、Ryzen 5 5600X、Radeon RX 6800、165 Hz。1280×800、倍率100%の画面外ウィンドウ。ループバック配信で各5回、新しいコンテキストと HTTP キャッシュ無効化で測った。時間は ms の中央値／p95。転送量は適用前の中央値。

| 条件                                                    | 最初の表示 |   準備完了 | 適用→部屋 | 適用→着座 | 転送バイト |
| ------------------------------------------------------- | ---------: | ---------: | --------: | --------: | ---------: |
| 公開計測用の束、Chrome 157.0.8103.38                    |    88／156 |   254／411 |    14／22 |  192／192 |  1,251,099 |
| 手元の昼の部屋とミルド、Chrome 157.0.8103.38            |    92／164 | 520／1,197 |    18／23 |  192／192 |  9,199,790 |
| 手元の昼の部屋とミルド、Chromium 153.0.8010.12 の CSS3D |    80／164 | 515／1,206 |      8／8 |  192／193 |  9,199,790 |

Chrome 157 で着座クリップを遅らせ、準備中も再生できることと、最初のキャラのコマが着座していることを撮影した。記録は元のチェックアウトの `.work/review-playground-startup/` にあり、`apply-first-pose.webm`、`apply-pending.png`、`first-posed.png` を参照できる。`tests/playground.spec.ts` の15件で、基本版、CSS3D、HTML-in-Canvas の操作と、クリップを適用後に再取得する場合の描画を確認した。型と lint は通過。unit は625通過、2スキップ。

公開先での転送量と初回表示は、試験公開のときに測る。上のローカル計測は圧縮とキャッシュなしの静的サーバーで行った。

## CI

`Theme checks` の自動実行は Ubuntu の型、lint、unit。Linux の e2e が必要なときは Actions の手動実行で `browser_suite` を選ぶ。Windows のローカル検証は `npm run test:e2e` を使う。
