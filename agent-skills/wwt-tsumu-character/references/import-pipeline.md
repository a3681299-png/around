# つむの取り込み

## 元の情報（BOOTH の商品ページより）

- 配布：FBX・unitypackage・テクスチャ PNG（VRM は入っていない）
- 置き場所：wwt-private-assets の `tsumu/source/`（ノート PC・デスクトップとも `C:\wwt-private\tsumu\source\`）。`fbx/tsumu.fbx`・`Texture/tsumu_Base_color.png`・`tsumu_v1.1.unitypackage`・`License/`（利用規約の PDF）。出どころ・版・取得日は wwt-private-assets の README
- 約 1,766 ポリゴン、材質1つ、lilToon
- 表情のシェイプキーは6つ（目と眉）。口の形はない
- 髪は揺れもの（PhysBone）あり

## 変換（おすすめ：Blender で GLB）

1. Blender で FBX を読み込む。大きさ（cm → m）と向きを直し、変形を適用する
2. 骨の名前を確かめ、人型の骨の対応表を作る（hips・spine・chest・neck・head・左右の upperArm・lowerArm・hand・upperLeg・lowerLeg・foot など）。WWT が今持つ人型の対応の仕組みに渡す
3. シェイプキーを残したまま GLB で書き出す（テクスチャは1枚、大きさは 1024〜2048px）
4. 書き出しはスクリプト（Blender の Python）にして、同じ手順をくり返せるようにする。置き場所は wwt-private-assets の tsumu/tools/

Unity と UniVRM で VRM にする方法もあるが、Unity の準備が要るので、GLB で足りるならそちらを優先する。

## 材質

- lilToon の見た目は three.js では出ない。テクスチャを色の面として使い、街と同じ陰の段（`wwt-toon-look`）と輪郭線で描き直す
- 顔は陰を弱くする（顔に暗い帯が出ないように）。必要なら顔だけ陰の向きを固定する

## 揺れもの

- 名前に Hair などを含む骨に、簡単なばね（前の位置に引っ張られる減衰）を付ける。強さは見て決める
- 曲げ（惑星）の間も、揺れは平らな座標で計算する

## 表情

- 6つのシェイプキーを、まばたき・喜び・驚き・眠い・困る などに対応付ける。対応表を作る
- まばたきは自動で、ときどき

## 動作

- Quaternius の CC0（Universal Animation Library）を、今の「当てて・直して・試す」の仕組みで当てる。体型（頭身）に合わない動作は、自動の測定で外す
- 最低限：待つ・歩く・小走り・座る・覗き込む・見上げる・振り向く・眠い
- 足りない動作は、計算の動き（呼吸・視線・揺れ）で埋める
