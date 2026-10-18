# World Runtime Phase 2 検証記録

2026-10-18。起点は`245c21e`、作業は`codex/creator-editor-spike`の`.work/creator-editor`。設計は[animation-core.md](animation-core.md)。

## モジュール

| 場所 | 責務 |
| --- | --- |
| `world/media-time.ts` | 純粋な時刻評価、累積時刻の二分探索。DOMや時計を参照しない |
| `host/media-clock.ts` | 共通RAF、可視性、reduced-motion、順番を回した描画要求 |
| `media/controller.ts` | レイヤー固有の時刻・表示・世代管理。必要に応じて再生方式を切替 |
| `media/native-image.ts`, `native-video.ts` | ブラウザー要素の再生。能力情報と非同期サンプルのfallbackを返す |
| `media/sampler.ts`, `raster-sampler.ts` | フレーム要求、latest-only、先読み、lease、縮小と解放 |
| `media/resources.ts`, `budget.ts` | 原本・URL・decoderの共有、LRU、メモリ見積もり、同時処理と描画予算 |
| `assets/apng.ts`, `webm.ts`, `animated-raster.ts`, `decode.ts` | コンテナー検査、先頭フレーム検証、中断 |
| `design/schema.ts`, `world/recording.ts` | v1〜v6→v7と入力記録v1→v2の純粋な読み込み移行 |

## 操作と形式

GIF・APNG・アニメーションWebPは通常imgを使う。停止、ループ無効、速度変更、時刻制御の選択、非表示からの時刻保持などではImageDecoderとcanvasへ切り替わる。標準imgのサンプルはdefault-frameのfallbackであり、画面で再生中の正確なフレームを取得できるという意味ではない。切替位相は概算。

WebMはmuted/playsInline video。再生・停止・ループ・0.25〜3倍速と、currentTimeによる非同期seekに対応。サンプルは実時刻付きfallback、フレーム番号null。フレーム単位のseekと逆再生は提供しない。VP8/VP9のコンテナーを受け付け、今回透過画素を実測したのはVP9。

個別フレームをGPUテクスチャへ合成する新しいレンダラーは導入していない。ImageDecoderの結果を共有ImageBitmapに変換して既存canvasへ描く。Lottieは既存の安全なSVG経路を維持。

制御再生は共通RAFの経過時間で進め、遅い要求を待って再生時刻を遅らせず最新要求へ追従する。非表示の間は時刻も停止し、再表示は保持時刻から再開する。videoは実currentTimeを使う。複数native素材の厳密なフレーム同期と、ネイティブ再生画素の決定的な録画再現は保証範囲外。

## 残す安全上限

- 1ファイル32MiB、一括8素材・合計32MiB。保存原本合計256MiB、128アセット。実際のIndexedDB quota不足は失敗として処理し、保存を部分更新しない。
- ラスタ/動画は1辺4096px、1フレーム16M画素。ラスタは10万フレーム、走査30万要素まで。旧1024px・240フレーム・30秒・全フレーム総画素8Mはラスタから外した。
- 作品は既存の32レイヤー上限。原本見積もり96MiB、表示面・フレーム128MiB、フレームキャッシュ32MiB、最大4フレーム/サンプラー。アプリの転送/デコード同時2件、描画要求の同期CPU見積もり8ms。
- 制御再生は最大2048pxに縮小。Chrome 153のAPNGではdesiredWidth/Heightが無視されることを実測したため、原本サイズのフレームも予算へ計上し、createImageBitmapで明示的に縮小する。原本を上書きしない。
- 標準img/videoやImageDecoder内部のキャッシュ・GPUメモリは上記の厳密な管理対象にできない。予算はアプリが保持する原本・返却フレーム・表示面と作業領域の見積もり。過負荷時は待機/保持し、画面外・非表示・親マスク0・OFF/0%で処理を止める。
- WebMの未確定長ライブ形式、未知長Cluster、暗号化、VP8/VP9以外は非対応。音声は再生しない。Lottieの1024px/30秒と複雑さ制限は維持。ImageDecoder非対応環境では時刻制御を提供できない。

検証は構造と先頭フレームまで。後続フレームの破損は再生時に処理する。外部URLや任意JavaScriptを作品から実行しない。優先順位/品質方針の型は拡張の入口であり、作者が指定するUIは未実装。

## 実YouTube

未ログイン・使い捨てChrome、実ネットワークのwatchページ1件で、次の10項目を確認。fixtureへの差し替えは使っていない。

1. GIF/APNG/WebMを取り込み、プレイヤー基準のグループとして保存。
2. YouTube本来の再生/停止ボタンとグループマスクのフェード。
3. マウス追従。
4. マスク再開後のGIF/APNGフレーム更新と1080p WebMの時刻進行。
5. スクロール追従。
6. シアターモード。
7. 全画面開始/終了とoverlayの移動。
8. Home/戻るでperformance.timeOriginが変わらないSPA遷移。
9. 再読み込み後のグループ・再生復元。
10. OFF撤去。

ログは`.work/verification/media2-live-final.log`と`media2-live.json`。テストプロセスの成功だけでは個別確認の成功と扱わず、最終JSONの10項目がすべてpassedであることを確認した。ログイン状態、広告、Shorts、他サイト、実YouTube上での大量素材負荷は未検証。

検証用Windows Chromiumの終了待ちが不安定だったため、tests/fixtures.tsに終了待ちの上限を設けた。通常のcloseを10秒待ち、応答がなければheadlessフラグ・完全一致の検証プロファイル・実験用拡張パス・終了要求より前の作成日時を確認して、そのプロセスツリーだけを終了する。後始末のプロセスが完了するまでcloseから戻らず、同じプロファイルの再起動を巻き込まない。拡張本体へこの処理は含めない。

## 次の段階

長時間・複数PCで計測を増やし、主役/背景の優先度と品質低下の方針を作者が選べるようにする。正確な複数素材同期や録画出力には制御サンプラーを使い、将来のGPUレンダラーへFrameLeaseの所有権を引き継ぐ。原本のエクスポートはDesignDocumentとasset IDで結び、現行IndexedDB管理と分離したパッケージ形式を設計する。

## 自動テストとビルド

型チェック（DOMを含まないRuntime用設定を含む）、lint、実験用ビルドが成功。最終全体実行は216ケース中212成功・1失敗・3任意実サイトskip（media2-final-verified.log）。1失敗は検証用Chromeの終了処理が再起動と競合して新しいプロセスを終了したものだった。終了要求時刻と後始末の待機を追加して修正後、GIF/APNG/WebP/Lottie/透過WebMの保存・ブラウザー再起動を全5形式で再実行し、すべて成功した。共有Bitmapへの最終補正後にも、透過・グループ・マスク・全形式の保存/再起動・サンプラー等35ケースを再実行して全件成功（media2-bitmap-final-regression.log）。対象カバレッジは213成功・3任意skip。単一の全体実行が無失敗だったとは扱わない。

途中の全関連71ケースも全件成功（media2-final-related.log、4K APNGを含む）。並列2 workerはChrome終了タイムアウトで中断し、既定の1 workerへ戻した。カード編集、保存/破棄/Undo/Redo、IDBの履歴lease、32レイヤー、グループ/マスク/シグナル、v1〜v6読み込み、入力記録/再生、legacy切替を確認。素材追加テストは先の取り込み完了を待って次のファイルを渡す。

前段の実サイト実行では10項目すべてpassed（media2-live-confirmed.json、元記録12:08 JST）。最終の再確認は120秒でタイムアウトし完了しなかった（media2-final-restarts-gpu-live.log）。したがって、最後のBlob URL解放・共有Bitmap補正を含む実サイト全体の確認は未完了。前段の実測と最終のfixture検証を区別する。

## 負荷計測

Windows、Chromium 153.0.8010.12、ANGLE Intel UHD Graphics / D3D11、viewport 1100×760、各約1.8秒。GIFは512×512、WebMは1080p透過3本または45秒の64×48を3本。スクロールはRAFごとにプレイヤー基準の矩形を動かすfixture負荷。値は短時間の観測で、性能保証や異なるPCの比較基準ではない。

| ケース | JS ms | main task ms | CDP列挙プロセスCPU ms | GPUプロセスCPU ms | JS heap MiB | 表示面/フレーム推定 MiB | RAF間隔p95 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 10 GIF / native | 7.02 | 46.99 | 1264.63 | 129.13 | 12.43 | 30.00 | 13.7 |
| 10 GIF / controlled | 23.94 | 128.65 | 635.67 | 203.31 | 10.76 | 16.00 | 7.3 |
| 3 alpha WebM / 1080p | 3.96 | 32.51 | 686.61 | 176.47 | 3.54 | 71.19 | 14 |
| 45s WebM / scrolling player anchor | 59.45 | 201.37 | 598.49 | 229.28 | 5.94 | 0.11 | 14.1 |
| 10 GIF / native / scrolling player anchor | 184.19 | 470.07 | 2489.87 | 538.84 | 10.28 | 30.00 | 7.2 |

CPU時間はコア数で正規化した利用率ではない。GPUプロセスCPUはGPU実行時間ではない。実GPU時間・物理VRAMの正確な常駐量・ブラウザー内部キャッシュ量は未測定。GPU使用率とメモリのOSカウンターは別の明示実行で取得した（下記）。すべて25ms超のRAF間隔は0、アプリの保持フレーム/表示面の推定ピークは128MiB以内、キャッシュは32MiB以内。標準再生はJS時間を減らしたが、総プロセスCPUが必ず減るとは確認していない。

同一実行の32メディア/16グループのWorld評価とCSS反映コールバックは、旧平均0.354ms・p95 0.8ms、新平均0.304ms・p95 0.5ms。中央値は旧0.3ms、新0.3ms。pointer/videoのみの変化では準備済み配置を再利用。非同期paint、GPU、デコード、入力配送、RAF待ちは測定外。

元データは.work/verification/media2-performance.jsonとworld-browser-benchmark.json。fixtureと生成スクリプト、原本のSHA-256はtests/fixtures/motion/phase2-source.jsonに含めた。FFmpegはfixture生成時だけ使用し、拡張や依存パッケージへ追加していない。

## Windows GPU・プロセスメモリ

WW_GPU_METRICS=1を明示して、同じfixtureの5負荷を計測した。各3サンプル、下表は観測最大。CDP列挙プロセスの正のPIDだけをOSメモリの対象として集計した。ブラウザー親プロセスはCDPでPID 0として報告されるためOSメモリ合計に含まない。

| ケース | OS採取期間 ms | 最大エンジン使用率 % | 対象プロセスprivate commit合計 MiB | GPUプロセス別メモリカウンター合計 MiB |
| --- | ---: | ---: | ---: | ---: |
| 10 GIF / native | 7042 | 0 | 512.15 | 75.22 |
| 10 GIF / controlled | 3398 | 4 | 662.82 | 226.56 |
| 3 alpha WebM / 1080p | 2118 | 7 | 830.71 | 190.11 |
| 45s WebM / scrolling player anchor | 2031 | 6 | 549.1 | 101.24 |
| 10 GIF / native / scrolling player anchor | 3044 | 14 | 653.66 | 120.88 |

GPUメモリはDedicatedUsageとSharedUsageのプロセス別カウンターを合算した値で、共有資源の重複計上を含み得る。物理VRAMの実使用量とは扱わない。使用率は短い整数サンプルで、0%も無負荷の保証にはしない。定義は[MicrosoftのGPU計測説明](https://devblogs.microsoft.com/directx/gpus-in-the-task-manager/)を参照。GPU採取を含む実行はCPU計測窓が延びるため、上の約1.8秒CPU表とは分けた。生データはmedia2-performance-gpu-run.json。最後のスクロールケースは起動直後の編集準備待ちを修正して単独で再計測した（media2-gpu-scroll-final.log）。

制御再生でVideoFrameを各canvasへ直接渡すとメモリ保持が大きかったため、共有ImageBitmapへ変換しVideoFrameを早期解放した。GIF10枚の単発比較でprivate commitは1212.38→662.82MiB、GPUメモリカウンター合計は758.78→226.56MiBだった（採取窓とブラウザー内部状態が異なるため、常にこの削減率になるという保証ではない）。CPU表の制御再生も最終実装で再計測（media2-bitmap-cpu-final.log）。

128MiBの予算はアプリが管理する表示面/フレーム等の見積もりであり、Chromeプロセスのprivate commitやGPUメモリ全体の上限ではない。原本を保持しつつアプリ側の全フレーム展開を避ける基盤を実装した。ブラウザー内部の保持量を含む厳密な上限や長時間の安定性は次の計測課題。

## コミットと保護範囲

1. 4f99a8c: 実サイト回帰と配置再評価の削減。
2. dee24b3: 非同期サンプラーと共通予算。
3. 71418b2: APNG・標準画像再生・v7移行。
4. be84089: WebM・グループ連動・予算待機。
5. 4b9f2d7: 取り込み中断・遅延フレーム解放・旧decoder整理。
6. この記録と同じコミット: 4K縮小の補正、負荷/実サイト検証と最終記録。

mainは022a576e5fb486b5c2fe5632feee66fcb018c953のまま。通常版distの12ファイルは開始時のSHA-256と一致。manifest、Chrome権限、依存パッケージは変更していない。バックエンド・生成AI・外部JavaScript実行を追加していない。
