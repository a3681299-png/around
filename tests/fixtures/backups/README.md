# 履歴から取ったバックアップ

2026-11-14 の Around への名称変更で、ここのバックアップ（と `docs/benchmarks/r31-verification/` の2つ）を新しい形式に書き換えた。先頭の識別子を `AROUND-BACKUP-0001` にし、中の JSON に同じ名称変更を当てて、JSON の SHA-256 を計算し直した。素材の本体（とその SHA-256 の ID）は変えていない。以下の説明の「同じバイト列」は、書き換える前の記録。

`legacy-v13-vrm.aroundbackup` は、R3-1 の変更前 `8e63f0d` の拡張で自作の `tests/helpers/vrm-fixture.ts` を読み、保存後に製品のバックアップ画面から書き出したファイル。独立検証 `ff02129` の `docs/benchmarks/r31-verification/legacy-v13-vrm.aroundbackup` と同じバイト列であり、現在のコードで旧形式を推測して作り直していない。作品の版は13で `source.vrm.body` はない。外部のモデル・動作・画像は含まない。

`tests/backup.spec.ts` が、現在の拡張での復元・再出力・再復元と、body を改ざんしてチェックサムを作り直した場合の拒否を確認する。
