# 履歴から取ったバックアップ

`legacy-v13-vrm.wwbackup` は、R3-1 の変更前 `8e63f0d` の拡張で自作の `tests/helpers/vrm-fixture.ts` を読み、保存後に製品のバックアップ画面から書き出したファイル。独立検証 `ff02129` の `docs/benchmarks/r31-verification/legacy-v13-vrm.wwbackup` と同じバイト列であり、現在のコードで旧形式を推測して作り直していない。作品の版は13で `source.vrm.body` はない。外部のモデル・動作・画像は含まない。

`tests/backup.spec.ts` が、現在の拡張での復元・再出力・再復元と、body を改ざんしてチェックサムを作り直した場合の拒否を確認する。
