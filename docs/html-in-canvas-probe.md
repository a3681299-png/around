# HTML-in-Canvas の傾いた操作面を確認

2026-11-07。デスクトップの Radeon RX 6800 で、ページ内の見出し、本文、ボタン、入力欄を HTML-in-Canvas から WebGL2 のテクスチャへ送り、three.js r186 の平面を傾けて描く小さなローカルページを作った。Playwright 同梱の Chromium とインストール済みの Chrome 安定版を、画面外の一時プロファイルで比較した。試作はリポジトリの外に置いた。

## API の変遷

| 時期                                          | HTML と描画                                                                                                           | 入力位置の同期                                                               |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 初期の origin trial（Chrome 148〜150 の案内） | canvas の `layoutsubtree`、2D の `drawElementImage()`、WebGL の `texElementImage2D()`                                 | 描画から求めた変換を DOM 側へ反映。2D の `drawElementImage()` は変換を返した |
| Chrome 150                                    | `texElementImage2D()` の WebGL 引数を整理                                                                             | 従来の変換の取り扱い                                                         |
| Chrome 155 の変更から安定版 157 へ            | canvas の `content="drawable"` と対象要素の `drawable`。WebGL は格納領域を先に確保し、`texElementSubImage2D()` で更新 | 2D は標準で自動更新。WebGL は 3D 側の投影を `updateElementGeometry()` へ渡す |

[初回の origin trial 案内](https://developer.chrome.com/blog/html-in-canvas-origin-trial) · [Chrome 150／155 の変更](https://developer.chrome.com/blog/html-in-canvas-ot-changes) · [Chrome 157 安定版の案内](https://developer.chrome.com/blog/html-in-canvas) · [WICG の現行提案](https://github.com/WICG/html-in-canvas) · [WebGL の手順](https://developer.chrome.com/docs/web-platform/html-in-canvas/webgl)

## この PC での結果

| ブラウザーと起動設定                                  | 描画・操作                                                           | テクスチャ更新 中央値 / p95 (ms) | 更新＋three.js 描画呼び出し 中央値 / p95 (ms) |
| ----------------------------------------------------- | -------------------------------------------------------------------- | -------------------------------: | --------------------------------------------: |
| Playwright Chromium 153.0.8010.12、既定               | API が公開されず、描画できない                                       |                                — |                                             — |
| 同 153、`--enable-blink-features=CanvasDrawElement`   | 旧 API で描画・操作できた                                            |                      0.20 / 0.40 |                                   0.40 / 0.80 |
| 同 153、`--enable-experimental-web-platform-features` | 旧 API で描画・操作できた                                            |                      0.20 / 0.40 |                                   0.40 / 0.80 |
| 同 153、上記の両フラグ                                | 旧 API で描画・操作できた                                            |                      0.20 / 0.30 |                                   0.40 / 0.80 |
| Chrome 安定版 157.0.8103.38、既定                     | 新 API で描画・操作できた。単体 HTML を `file://` で開いても描画した |                      0.10 / 0.20 |                                   0.30 / 0.60 |

- いずれも origin trial のトークンを設定していない。153 ではどちらか一方のフラグで十分で、157 ではフラグもトークンも不要だった。153 の既定設定でトークンを登録する経路は未検証。
- 平面の四隅を three.js のカメラで投影し、その座標から求めた射影変換でブラウザー側の操作位置を同期した。153 では `getElementTransform()` が返す変換を CSS に反映し、157 では `updateElementGeometry()` を使った。板に表示されたボタンの中心をクリックすると1回の `click` が届き、入力欄の中心をクリックして `Canvas 157` と入力すると、10回の `keydown` と `input` が対象の入力欄に届いた。Tab でもボタンから入力欄へ移り、入力できた。同期を無効にすると、同じ2点のヒットテストはどちらも対象要素を返さなかった。
- 両ブラウザーの画像で、傾けた板の日本語と英数字、ボタンラベル、青いフォーカス枠と入力済みの文字を目で確認した。小さい本文の輪郭はやや柔らかいが、試した角度・大きさでは読めた。
- 各行の描画時間は同じ要素を連続90回更新したときの CPU 呼び出し時間。更新後の1秒には `paint` が2回発生した。GPU の実行時間、多数の板、高頻度で内容が変わるページは未計測。
