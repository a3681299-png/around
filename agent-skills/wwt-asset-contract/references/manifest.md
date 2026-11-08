# 素材の一覧（manifest）

## 置き場所

- 元のファイル（.blend・作るスクリプト・CC0 の元・素体・つむ・規約の写し）：wwt-private-assets（`C:\wwt-private\`）の `city-assets/` の下（つむは今の `tsumu/` のまま）。作るスクリプトは `city-assets/tools/`、途中の物は `city-assets/work/`（追跡しない）
- 公開に載せる GLB と一覧（2026-11-08 に決めた）：web-world-themes の **`src/playground/city-assets/`**。一覧は `src/playground/city-assets/manifest.json`、骨の対応表は `src/playground/city-assets/humanoid.json`、GLB は `src/playground/city-assets/<kind>/<id>.glb`
  - 理由：Playground の公開ビルド（`scripts/build-playground.mjs`）の元はすべて `src/playground/` にあり、出力の検査（`scripts/playground/check-output.mjs`）は、ビルドが書いた模型だけを許す。世界の側は、一覧の行ごとに GLB を `content/asset-<sha256>.glb` へ写し（つむと同じ形）、その名前を入れた一覧を出力に書く
  - つむは例外：GLB を公開のリポジトリに置かない。今の世界の作りどおり、`C:\wwt-private\tsumu\work\tsumu-city.glb` をビルドのときに読み、`scripts/playground/tsumu-asset.json` のハッシュと照らす。一覧の行は `file` を `null`、`privateFile` に private 側の場所を書く
- 作るスクリプトは何度でも同じ GLB を作れるようにする（手作業の手順を残さない）
- 検査：`node scripts/city-assets/check.mjs`（一覧と全部の GLB）。並べるページ：`scripts/city-assets/lineup/`（開発用。製品と公開のビルドには入らない）

## 一覧の形

```json
{
  "version": 1,
  "assets": [
    {
      "id": "resident-dockworker-a",
      "kind": "resident",
      "file": "residents/dockworker-a.glb",
      "status": "draft",
      "heightM": 1.05,
      "tris": 2480,
      "slots": ["slot_skin", "slot_hair", "slot_top", "slot_bottom", "slot_shoes", "slot_accent"],
      "attach": ["attach_head", "attach_hand_l", "attach_hand_r", "attach_back"],
      "roles": ["dockworker"],
      "cultures": [],
      "source": {
        "type": "booth-base-modified",
        "author": "シロタカブ（readme.txt の表記。依頼文の「おなかにやさしい」との違いは翔太が確認する）",
        "url": "https://booth.pm/ja/items/8801178",
        "license": "BOOTH 規約（改変して作品に使用。素体のままの配布は禁止）",
        "record": "wwt-private-assets/city-assets/base-body/LICENSE-notes.md"
      }
    }
  ]
}
```

- `kind`：resident・hero・prop・ship・harbor・street・culture
- `status`：placeholder（世界の仮の形のまま）・draft（入れてよいが直す予定）・final
- `roles`：住人の役割（dockworker・shopkeeper・walker・lamplighter・musician・listener・stargazer・gardener・vendor・fisher など）。小物にも、使う役割を書く
- `cultures`：文化の形（music・sky・nature・food・sea）。空なら全部の星で使える
- `source.type`：own（自作）・cc0・booth-base-modified・booth-hero（つむ）・tripo（Tripo で生成して直した物。`source` にプラン・生成日・タスク ID・指示の要約を書く）

世界は `id` と `kind`・`roles`・`cultures` だけを見て選ぶ。ファイルを差し替えても `id` は変えない。
