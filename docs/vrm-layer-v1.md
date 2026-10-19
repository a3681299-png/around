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

## 外部モーションの境界

既存の任意クリップ、速度別Idle/Walk/Run割り当てとHumanoidの正規化ボーンを保持する。将来のVRMAはRenderer側で正規化Humanoid向けクリップへ変換し、同じクリップ評価へ接続する。今回はVRMA読み込みやモーション生成を実装しない。

## 検証上の注意

提供された`PochibyKT_Pochi_VRM_1.0.0.vrm`は、内部に`VRM`拡張 / `specVersion: 0.0`を持つVRM 0.x。約54.5MiB、39モーフ、PNG内蔵。VRM 1.0は自作fixtureと分けて検証する。モデルのメタデータは個別許諾・商用禁止・独自ライセンスを示し、配布許諾は未確認。モデル本体・モデル入り画像はコミットしない。

World Runtimeの位置・クリップ・視線角は記録再生可能。Three.js側のSpringBoneの物理状態とMToonの累積UV時間はRuntimeの決定性保証に含めない。シーク・時計の巻き戻し時は揺れ物をリセットする。非表示・OFF時は更新を停止する。

参考: [three-vrm公式](https://github.com/pixiv/three-vrm)、[VRM 1.0仕様](https://github.com/vrm-c/vrm-specification/tree/master/specification/VRMC_vrm-1.0)。CDNや外部モデルURLは実行時に利用しない。
