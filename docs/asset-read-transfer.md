# 素材取得のバイナリ転送と初回描画

## 計測条件

2026-10-21、起点deae995。Windows、Chrome for Testing 153.0.8010.12、実GPU、
1920×1080の専用Chromeウィンドウ、実YouTubeの同じwatchページで計測する。
通常版distと普段のChromeプロファイルは使わない。

原本は57,185,776bytes（54.5366MiB）のVRM 0.x。原本とアバター画像はコミットしない。
画像は30,000,000bytesのPNG、3000×2499 RGBA、固定疑似乱数のRGBと不透明alpha。
画素データを非圧縮DEFLATEで格納し、残る小さな差をancillary chunkで埋める。
小さな画像を30MBまで水増しした条件ではない。

`tests/asset-read-benchmark.spec.ts`は実YouTube・実GPU・非公開原本を指定した場合だけ実行する。
診断ビルドの計測機能を使い、保存済み作品を通常のDOM/Three Rendererで表示する。
各素材を5回再読み込みし、それぞれ同じタブで削除・再追加する。
小さな固定画像を残してSceneを維持し、再追加では通常の96MiB原本キャッシュを使える条件にする。
各試行のJSONは`.work/verification/asset-read-<label>.json`に記録する。

取得の終点は、従来のinspectAssetと検証済みBlobの印まで完了した時点。
表示は、モデルの描画・canvasコピー・2 RAF後、画像はdecode・2 RAF後。
物理ディスプレイへの提示時刻ではない。同じcontentコンテキスト内の時計を使う。
再読み込みは取得開始から、同じタブの再表示は再追加指示から数える。
YouTube自体のネットワーク読み込み時間と素材の保存時間は含めない。
再読み込みは毎回新しい文書だが、OS・GPUドライバーのキャッシュは消去していない。

## 変更前

各5回、中央値／最大、単位ms。

| 素材・条件            |                    取得 |              表示 |
| --------------------- | ----------------------: | ----------------: |
| VRM・再読み込み       |       4,767.5 / 5,040.5 | 5,944.4 / 7,635.8 |
| VRM・同じタブで再表示 | 0 / 0（原本キャッシュ） | 1,024.4 / 1,334.3 |
| PNG・再読み込み       |       2,262.0 / 2,422.8 | 3,516.5 / 3,607.5 |
| PNG・同じタブで再表示 | 0 / 0（原本キャッシュ） |     541.9 / 653.2 |

Asset Runtime v1とはページ・画面寸法・計測境界が異なるため、その過去の数値との改善率は出さない。
以後はこのfixtureと同じコマンド・描画完了条件で前後比較する。

## 正式な取得経路

`src/browser/asset-read-host.ts`がcontent scriptの文書内でHostを持ち、
`src/assets/read-adapter.ts`を通して既存の原本キャッシュとRendererへ供給する。
診断用Host・broker・Resident Rendererには依存しない。
拡張機能オリジンの`assets/read-frame.html`はIDBから原本を読むだけで、描画しない。
iframeは非表示でdocumentElement直下に固定し、全画面・SPAの都合で移動しない。
WARへの追加はYouTube向けのこのHTMLだけ。JSは公開しない。権限とIDBの版は変更しない。

content scriptがMessageChannelを作り、拡張機能の正確なオリジンへポートを渡す。
windowメッセージを使うのは、秘密を含まないポート受け渡し1回だけ。
素材ID・許可token・返信・原本はwindowメッセージに載せず、MessagePort内で扱う。
ページが偽のポートを渡しても、Runtimeでの文書照合と承認なしでは原本を得られない。

1. iframeがRuntime経由で短命challengeを取得する。WorkerはnativeなtabId・frameId・documentIdを記録する。
2. content scriptだけが、そのprivate portで受け取ったchallengeと取得するIDをRuntimeへ送る。
3. WorkerはYouTubeのtop frame・文書・同じtabを照合する。素材は保存済み作品に含まれるもの、
   またはそのtab・文書の既存leaseで保持中のものだけを承認する。未知のIDは承認しない。
4. 10秒以内・1読み取りだけのtokenを発行する。iframeがtokenを消費してからIDBを読む。
5. 転送直前にも現在の承認範囲を照合し、`tabs.sendMessage`のdocumentId指定で、
   元のcontent scriptが同じID・tokenを待っていることを確認する。許可を消してからbufferを転送する。

取り消し・期限切れ・文書終了・tab終了で許可を破棄する。期限整理のタイマーは許可が残る間だけ動く。
Worker世代が変われば古い許可は使えず、新しいchallengeから再承認する。試行は最大2回。
拒否された許可や不正な素材を予備経路で回避しない。通信機能を使えない場合だけ従来の取得へ戻す。
受信した原本は経路に関係なく同じinspectAsset・Blob作成・rememberVerifiedSourceを通す。
取得だけのための追加leaseは作らない。

診断ビルドの`download.transport.array-buffer`／`download.transport.chunks`で実経路が分かる。
`download.validated-source`は検査を含む取得全体、`download.reauthorize`は再承認を表す。
原本キャッシュに命中した再表示では転送を行わない。

Chromeのnative文書IDと宛先指定については
[runtime.MessageSender](https://developer.chrome.com/docs/extensions/reference/api/runtime#type-MessageSender)と
[tabs.sendMessage](https://developer.chrome.com/docs/extensions/reference/api/tabs#method-sendMessage)を確認した。

## バイナリ化後

同じ20試行。各5回の中央値／最大、単位ms。

| 素材・条件            |                    取得 |              表示 |
| --------------------- | ----------------------: | ----------------: |
| VRM・再読み込み       |           725.1 / 814.5 | 2,291.9 / 3,923.3 |
| VRM・同じタブで再表示 | 0 / 0（原本キャッシュ） | 1,598.0 / 3,181.6 |
| PNG・再読み込み       |           318.5 / 397.0 |   880.3 / 1,063.1 |
| PNG・同じタブで再表示 | 0 / 0（原本キャッシュ） |     662.9 / 758.1 |

取得中央値はVRMで約85%、PNGで約86%短縮した。表示までのVRM中央値は目標1.5秒に届かなかった。
再表示は両方とも転送なしだが、後の試行ほど常に速いわけではない。解析・Blob再読み取り・
初回WebGL描画が残る。キャッシュ命中時にも高速化したとは報告しない。

全40試行とシェーダー調査10試行は[計測JSON](benchmarks/asset-read-2026-10-21.json)に残した。
原本名・パス・素材・画像・許可tokenは含めない。プログラム内容はcacheKeyのSHA-256で記録する。

VRMの取得後に残る区間の中央値。これらの中央値は同じ試行とは限らず、足し算で全体時間にはならない。

| 区間                              | 再読み込み 前→後 ms | 同じタブの再表示 前→後 ms |
| --------------------------------- | ------------------: | ------------------------: |
| RendererのBlob→ArrayBuffer        |         209.6→350.6 |               107.4→353.6 |
| GLTF解析（画像デコードを含む）    |         255.8→238.6 |               225.8→263.8 |
| VRM後処理                         |         146.2→153.9 |               133.9→128.2 |
| bounds                            |           45.6→42.2 |                 45.0→40.8 |
| 初回WebGL描画                     |         409.4→295.2 |               316.4→314.5 |
| 初回描画〜2 RAF（上の描画を含む） |         507.9→381.1 |               372.2→397.4 |

再表示の初回WebGL描画は、変更後の最初の2件で1,679.2／1,503.0msと大きく、残る3件は276.4〜314.5msだった。
同時にBlob再読み取りにもばらつきがある。今回の標本だけではこの差を転送方式の因果効果や
ドライバーキャッシュだけの影響と断定できない。二重のBlob読み取りを除くRenderer変更や独自形式化は実施していない。

## シェーダー調査

同じ原本・実GPU（ANGLE / Intel UHD Graphics / D3D11）を既存Rendererで直接表示し、
各試行でWebGL contextを作り直した。作成前と初回ポーズ後のcompileAsyncを、ラウンドごとに順序を交互にして各5回測った。
OS・ドライバーキャッシュは消去していない。`checkShaderErrors=true`を全試行で確認した。
通常ビルドには準備位置の変更を入れず、診断ビルドの比較オプションと記録だけを追加した。

事前コンパイル直後、初回ポーズ適用後の描画直前、初回描画直後の`renderer.info.programs`を採取した。
**全10試行で6→6プログラム、同じID・同じcacheKeyで、追加プログラムは0**だった。
初回描画内のcompileShader・linkProgram呼び出しも0。今回の原本では、準備と実描画のシェーダーが
違うという仮説を支持する結果にはならなかった。実VRM 1.0や全ドライバーへの一般化はしない。

各5回の中央値／最大、ms。初回のドライバーキャッシュ差を含むので、最大値の差を位置変更の効果とは扱わない。

| 条件             |        表示全体 | compileAsync API | 初回render内のgetProgramInfoLog |
| ---------------- | --------------: | ---------------: | ------------------------------: |
| プレイヤー作成前 | 600.6 / 1,120.5 |      17.5 / 93.8 |                    49.0 / 264.8 |
| 初回ポーズ後     |   603.0 / 827.5 |      15.9 / 18.4 |                     29.3 / 71.3 |

初回調査の別の5回ずつでも全体中央値は530.3→534.3msだった。
準備位置を変えて全体が速くなる効果を確認できなかったため、本番のコンパイル処理は変更していない。
getProgramInfoLogは両条件とも初回renderで6回呼ばれた。

導入版Three.js 0.186.1のコードでは、compileAsyncの完了確認と、最初にuniform/attributeを使う際の
エラー検査が別になっている。残る待ちは新しいプログラム生成とは分けて見る必要がある。
[WebGLRenderer](https://github.com/mrdoob/three.js/blob/r186/src/renderers/WebGLRenderer.js)と
[WebGLProgram](https://github.com/mrdoob/three.js/blob/r186/src/renderers/webgl/WebGLProgram.js)を確認した。
API呼び出し内のCPU待ちであり、純粋なGPUコンパイル時間と同一ではない。
`renderer.debug.checkShaderErrors`の無効化や、エラー検証の弱体化は実施していない。

診断用の旧`chunks`比較は、正式経路の既定変更でバイナリ化されたり承認で止まったりしないよう、
明示したチャンク取得へ固定した。この比較も正式経路と同じ最終検査を通る。
