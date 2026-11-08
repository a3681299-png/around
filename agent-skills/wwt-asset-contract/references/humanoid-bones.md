# 人型の骨の対応表（2026-11-08 に決めた）

鍵は VRM の人型の名前。`scripts/characters/rigs/tsumu.json`・`rigs/ual.json` と同じ形で、世界の側の動作の焼き込み（`retarget_vrma.py --target-map`）にそのまま渡せる。機械が読む物は `src/playground/city-assets/humanoid.json`（`{ "tsumu": {...}, "resident": {...} }`）。

| 人型の名前                                                                 | つむ（`tsumu-city.glb`） | 住人（素体 A・B から作る物すべて）          |
| -------------------------------------------------------------------------- | ------------------------ | ------------------------------------------- |
| hips                                                                       | Hips                     | Hips                                        |
| spine                                                                      | Spine                    | Spine                                       |
| chest                                                                      | Chest                    | Chest                                       |
| neck                                                                       | Neck                     | Neck                                        |
| head                                                                       | Head                     | Head                                        |
| leftShoulder / rightShoulder                                               | Shoulder.L / .R          | Shoulder.L / .R                             |
| leftUpperArm / rightUpperArm                                               | Upper_arm.L / .R         | UpperArm.L / .R                             |
| leftLowerArm / rightLowerArm                                               | Lower_arm.L / .R         | LowerArm.L / .R                             |
| leftHand / rightHand                                                       | Hand.L / .R              | Hand.L / .R                                 |
| leftUpperLeg / rightUpperLeg                                               | Upper_leg.L / .R         | UpperLeg.L / .R                             |
| leftLowerLeg / rightLowerLeg                                               | Lower_leg.L / .R         | LowerLeg.L / .R                             |
| leftFoot / rightFoot                                                       | Foot.L / .R              | Foot.L / .R                                 |
| leftToes / rightToes                                                       | Toes.L / .R              | Toes.L / .R                                 |
| 指（Thumb・Index・Middle・Ring・Little の Proximal・Intermediate・Distal） | なし                     | `<名前><段>.L / .R`（例 `IndexProximal.L`） |

- 骨の名前は付け替えない。素体の名前のまま書き出す（素体の約束「骨の名前と構造は変えない」）
- 住人の目・まつ毛・眉・歯の形は消す（顔を作らない）。`Eye.L`・`Eye.R` の骨は残る（重みはない）
- 住人の休みの姿勢は T 字（素体のまま）。つむも T 字
- 付ける所：`attach_head`（Head の子、頭の上）・`attach_hand_l` / `attach_hand_r`（Hand の子、手のひらの中心。小物の原点＝握る所を合わせる）・`attach_back`（Chest の子、背中）。住人にだけ付ける。つむの GLB は世界が使っている物を変えないため、付ける所は世界が Head・Hand の骨から作る
