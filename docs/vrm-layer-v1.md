# VRM Layer v1

起点: `872b89e` / `codex/creator-editor-spike`。main・通常版dist・権限を変更しない。

## 構成

- Editor Core / World Runtime: 既存のmodel3dレイヤー、配置、履歴、追従、数値の視線評価を共用する。
- Asset boundary: GLB検査にVRM 1.0とVRM 0.x互換検査を追加。外部URI、未知の拡張、不正参照を拒否する。原本はIndexedDBに一度だけ保存する。
- Renderer: Three.js + 固定バージョンの`@pixiv/three-vrm`。VRMごとに独立したHumanoid / Expression / LookAt / SpringBoneを構築し、GLBのSkeletonUtils複製は変更しない。ページのWebGLコンテキストは共用。
- Studio: 共通3DパネルにVRMの視線、揺れ物、表情を追加。マウス入力の取得・遅延・角度制限は既存World Runtimeを使う。
- DesignDocument v11: v1〜v10を純粋に読み込み、VRMの検査済み能力情報と設定だけを追加する。モデル、テクスチャ、ライセンスの原本は作品JSONへ埋め込まない。

## 段階

1. 検査、容量予算、分割転送、データ移行と回帰テスト。
2. VRM描画、表情、揺れ物、視線、共通Studio UIと自動テスト。
3. 提供アバターによる実YouTube検証、全体回帰、性能計測、報告。

## 容量と安全

通常素材32MiBは維持し、GLB/VRMのみ64MiBまで許可。Chromeメッセージは小分けにし、受信順序・所有セッション・総容量を検査する。3D資源のページ予算256MiB、VRM単体192MiBを上限とする。VRMは描画前に未使用頂点を除き、実際に使用される頂点数からモーフ予算を見積もる。制限を超えた複製はエラーを表示する。

転送は4MiB単位、作業中の転送全体は128MiB・最大4件・60秒の無通信で失効。Studioで検査・保存した大容量素材はasset IDでHostに渡し、Editor Coreでleaseと原本メタデータを照合する。原本をYouTubeへ渡して再アップロードする往復を避ける。古いChromeではBase64の通常実装へ戻る。

GLBは既存のgeometry / material / textureを共有する。VRMはモデル単位のコンポーネント参照を保つため、今はインスタンスごとにパースする。原本asset IDは共通だが、複製時の描画予算は別に確保する。

## 外部モーションの境界

既存の任意クリップ、速度別Idle/Walk/Run割り当てとHumanoidの正規化ボーンを保持する。将来のVRMAはRenderer側で正規化Humanoid向けクリップへ変換し、同じクリップ評価へ接続する。今回はVRMA読み込みやモーション生成を実装しない。

内蔵クリップの`ModelInfo`は原本から得た不変の情報。外部モーションは将来、別のasset IDを持つ参照リストとして追加し、内蔵クリップの配列番号を書き換えない。Rendererのモーション解決処理が正規化Humanoidへリターゲットし、評価側にはクリップの識別子と時間だけを渡す。現在のGLB内蔵クリップはraw bone向けなので`autoUpdateHumanBones=false`。VRMA向けに正規化ポーズの転送を有効にする段階を明示的に分ける。

## 操作

実験用の`dist`をChromeで再読み込みし、YouTubeのStudioを開く。立方体の「3Dモデルを追加」から`.vrm`を選ぶかドロップする。既存のハンドルと位置・サイズ・3D回転で配置する。

VRMはHumanoidの頭を自動選択し、視線追従を初期状態で有効にする。「頭・首の視線」で角度と遅延、「VRM」で眼球・頭・揺れ物を切り替える。表情名と強さを編集でき、複数の表情の値を保持する。保存・破棄・Undo/Redoは既存の編集セッションを使う。

「3Dアニメーションを再生」をOFFにするとクリップ・揺れ物・UVの進行を止める。視線は独立して使える。静止した肖像として使う場合は、この再生をOFFにすると継続描画を抑えられる。

## 検証上の注意

提供された`PochibyKT_Pochi_VRM_1.0.0.vrm`は、内部に`VRM`拡張 / `specVersion: 0.0`を持つVRM 0.x。約54.5MiB、39モーフ、PNG内蔵。VRM 1.0は自作fixtureと分けて検証する。モデルのメタデータは個別許諾・商用禁止・独自ライセンスを示し、配布許諾は未確認。モデル本体・モデル入り画像はコミットしない。

World Runtimeの位置・クリップ・視線角は記録再生可能。Three.js側のSpringBoneの物理状態とMToonの累積UV時間はRuntimeの決定性保証に含めない。シーク・時計の巻き戻し時は揺れ物をリセットする。非表示・OFF時は更新を停止する。

参考: [three-vrm公式](https://github.com/pixiv/three-vrm)、[VRM 1.0仕様](https://github.com/vrm-c/vrm-specification/tree/master/specification/VRMC_vrm-1.0)。CDNや外部モデルURLは実行時に利用しない。
