# WWT Playground「Web ページが街になる」用スキル（下書き）

コンテスト用 Playground を Codex が自分でループしながら作るためのスキル集。
構成と書き方は、MIT ライセンスの既存スキル集を参考にした（文章は写していない）。

- majidmanzarpour/threejs-game-skills（入口のスキルが専門スキルへ振り分ける形、References の表、採点表、Report の書き方）
- OpenAEC-Foundation/Three.js-Claude-Skill-Package（ALWAYS / NEVER の断定的な決まり、references の分け方）

## スキル

| スキル                | 役割                                                                                                             |
| --------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `wwt-city-director`   | 入口。範囲・ループの回し方・止めて聞く条件・報告。ほかのスキルへ振り分ける                                       |
| `wwt-world-bend`      | 平らな街を頂点で曲げて惑星に見せる。平行投影に近い真上の姿から街への遷移、選び（クリック判定）、カメラ操作、錯視 |
| `wwt-toon-look`       | トゥーン・輪郭線・色・空・ローポリの絵の決まりと採点表                                                           |
| `wwt-page-to-city`    | ページの部品から街を作る規則、屋根にカードを貼る、UI と 3D の連動と G1                                           |
| `wwt-tsumu-character` | つむの取り込み（FBX → GLB）、材質の描き直し、揺れもの・表情・動作、街での自律                                    |
| `wwt-visual-loop`     | 視点の見本ごとの静止画、採点、弱い所3つを直すループ、重さの予算                                                  |

## 素材の側のスキル（Claude Code 向け、2026-11-08 追加）

| スキル                  | 役割                                                                                                           |
| ----------------------- | -------------------------------------------------------------------------------------------------------------- |
| `wwt-asset-director`    | 素材の側の入口。作る物の一覧と優先度、自分でループする進め方、止めて聞く条件                                   |
| `wwt-asset-contract`    | 素材と世界の約束（単位・向き・原点・材質の名前・骨・付ける所・上限・書き出し）、素材の一覧、検査               |
| `wwt-blender-modeling`  | Blender のスクリプトで住人（素体から）・小物・船・港・街・文化の建物を作る                                     |
| `wwt-asset-review-loop` | 素材を世界と同じ絵で遠・中・近に並べて撮り、採点して直す                                                       |
| Tripo と Blender MCP    | 素材の側は自分の判断で使ってよい（2026-11-08）。決まりは `wwt-blender-modeling` の references/tripo-and-mcp.md |

世界の側（Codex）は `wwt-asset-contract` を読めば、素材の受け取り方が分かる。

## 入れ方

1. このフォルダの各スキルを、リポジトリのスキルの置き場所（install-skills が読む所）に置く
2. `install-skills` で Claude Code と Codex に入れ直す。`install-skills --check` が通ることを確かめる
3. Codex 向けの表示名と起動文は各スキルの `agents/openai.yaml`

## 一緒に使ってよい外部スキル（任意）

中身とライセンスを読んでから使う。WWT の決まり（設計書・AGENTS.md・このスキル集）が優先する。

- OpenAEC-Foundation/Three.js-Claude-Skill-Package（MIT）の `threejs-syntax-shaders`・`threejs-impl-webgpu`・`threejs-impl-animation`・`threejs-core-raycaster`・`threejs-errors-performance`：three.js の書き方の確かめ
- majidmanzarpour/threejs-game-skills（MIT）の `threejs-aaa-graphics-builder` の採点表の考え方：見た目の採点の参考。外部の生成 API（Tripo・Gemini・ElevenLabs）を呼ぶ部分は使わない
- dotslashsimran/simcraft の `perspective-illusion`：ドリーズーム・レンズシフト・平らな間の入れ替えの参考。設計書「決めること」の手順どおり、LICENSE と中身を確かめてから
