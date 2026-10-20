# Asset Runtime v1

起点: `bd29d00`。既存Renderer、DesignDocument、Chrome権限を維持する。
実測値、採用判断、制約は [asset-runtime-results.md](asset-runtime-results.md) にまとめる。

## 実装する範囲

1. **Stage 1 / 既存経路**: 読み取りと変更のキューを分離。変更は直列のまま、読み取りは上限付きで実行する。lease/pruneは変更のある行だけ更新する。同じ原本の並行取得を統合し、Blobの短期キャッシュに容量・寿命・キャンセルを設ける。検証結果は変更できないBlobまたはSHA-256で確認した原本に結び付ける。
2. **Stage 2 / 検証限定**: 拡張オリジンの透明iframeがIndexedDBから取得する。全画面や再生成では新しい認証、世代番号、全状態スナップショットで再接続する。通常ビルドへ移行しない。
3. **Stage 3 / 検証限定**: 拡張iframeからContent Scriptへ実原本をMessageChannelで転送する。Chrome runtimeのJSONメッセージと混同しない。取得完了と描画完了を別に測る。
4. **Stage 4 / 最小キャッシュ**: Source / Prepared / Shared / Instanceを分け、参照カウントと未使用時の退避を検証する。VRMの可変状態を共有しない。
5. **Stage 5 / 評価**: コンパイラの効果を転送・解析・テクスチャ準備・コンパイル・描画に分けて判断する。独自永続形式は導入しない。

## データと所有権

| 種類 | 識別・寿命 | 共有するもの |
| --- | --- | --- |
| Source | 既存 `asset-SHA256(原本)` / IndexedDB。作品・Undo・回復用leaseで保持 | 変更不能な原本Blob |
| Prepared | `source hash + validator/compiler version + options`。版変更時は原本から再生成 | メタデータ、将来のサムネイル。GPUオブジェクトは永続化しない |
| Shared Resource | Renderer世代内のsource IDと準備条件。参照数0は予算/LRUに従い解放 | 変更しないgeometry / texture。materialは可変パラメーターを分離できた場合のみ |
| Instance State | layer ID / Runtime時刻・編集状態 | bone、skeleton、morph、expression、LookAt、SpringBone、mixer、MToonの可変uniformは個別 |

今回の準備状態は `loading → ready / error` とキャンセル。将来の仮表示・低品質は `representation` として追加し、未生成のプレビューを完成済みと報告しない。

キャッシュは永続保存の正当性を代替しない。削除済みの素材をキャッシュだけで作品へ保存しない。失敗はキャッシュせず、利用者1人の中断が他の利用者の取得を中断しない。全利用者の中断では次の断片取得を停止する。

## Resident接続

ページのpostMessageを権限の根拠にしない。Workerが明示的に選択されたasset IDと対象tabに短命grantを発行し、iframeのsender/frame/documentを確認する。ロードのたびに新しいgrantを取得する。接続ごとにgenerationとrequest IDを付け、古い結果を破棄する。再起動後は原本ID・レイヤー・Runtime評価のsnapshotを送り直し、ACK後に差分を送る。実原本は認証済みMessagePort以外へ出さない。

iframe1面で描く方式ではDOM2Dとの任意の交互順序や祖先CSSマスクをそのまま表現できない。原本取得の改善とRendererの移設を別判断にする。

## 計測

同じ54.5MiB原本を使い、変更前後各5回以上。最初のプロセスとウォーム試行を区別する。OS/ドライバーのキャッシュは消去しない。各コンテキスト内の単調時計の差を使い、異なるperformance.nowを直接差し引かない。

素材取得・準備・最初の描画を分離し、中央値・最大・nearest-rank p95を報告する。5件のp95は最大値と同じであり、分布の保証ではない。GPUメモリは推測で実測扱いにしない。`compileAsync`と`initTexture`はAPIのCPU側所要時間であり、物理GPUでの純粋なコンパイル・転送時間ではない。

実YouTubeの動画品質は、再生中の`getVideoPlaybackQuality()`の区間差と同程度の無負荷区間で比較する。20回の追加・削除はJS heap、ArrayBuffer backing storage、Rendererの参照数を確認する。自作fixtureの複合シーンと実アバターの性能は別に報告する。

## 回帰ゲート

型チェック、lint、通常・計測ビルド、既存全体テスト。Stageごとに取得/解放・作品保存・Undo/Redo・VRM/GLB・2Dを検証しコミットする。通常ビルドに実験用のWARや診断APIを公開しない。main、両worktreeの既存dist、モデル原本は変更しない。
