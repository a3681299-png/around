# R3-1 修正の交互計測

8e63f0d と 447b2bf。完全な組：1, 2, 3, 4。単位はms/フレーム。各欄は中央値 / p95。段階の判断はClaude Codeが行う。

| 場面                 | 変更前      | 修正後      | 差           |
| -------------------- | ----------- | ----------- | ------------ |
| no-character:startup | 0.10 / 4.90 | 0.20 / 4.90 | 0.10 / 0.00  |
| no-character:steady  | 0.00 / 0.00 | 0.00 / 0.00 | 0.00 / 0.00  |
| no-character:spa     | 0.00 / 1.50 | 0.00 / 1.30 | 0.00 / -0.20 |
| character:startup    | 1.10 / 7.70 | 1.10 / 5.60 | 0.00 / -2.10 |
| character:steady     | 0.80 / 1.80 | 0.80 / 1.90 | 0.00 / 0.10  |
| character:spa        | 0.00 / 1.60 | 0.00 / 1.60 | 0.00 / 0.00  |

| 組  | 場面                 | 変更前      | 修正後      |
| --- | -------------------- | ----------- | ----------- |
| 1   | no-character:startup | 0.00 / 5.60 | 0.30 / 8.40 |
| 1   | no-character:steady  | 0.00 / 0.00 | 0.00 / 0.00 |
| 1   | no-character:spa     | 0.00 / 1.80 | 0.00 / 0.90 |
| 1   | character:startup    | 1.30 / 7.70 | 1.10 / 5.20 |
| 1   | character:steady     | 0.80 / 2.00 | 0.80 / 1.90 |
| 1   | character:spa        | 0.00 / 1.30 | 0.00 / 1.60 |
| 2   | no-character:startup | 0.20 / 6.40 | 0.00 / 4.50 |
| 2   | no-character:steady  | 0.00 / 0.00 | 0.00 / 0.00 |
| 2   | no-character:spa     | 0.00 / 1.20 | 0.00 / 1.30 |
| 2   | character:startup    | 1.20 / 8.40 | 1.10 / 6.10 |
| 2   | character:steady     | 0.80 / 1.90 | 0.80 / 1.90 |
| 2   | character:spa        | 0.00 / 1.30 | 0.00 / 2.00 |
| 3   | no-character:startup | 0.10 / 4.30 | 0.30 / 5.30 |
| 3   | no-character:steady  | 0.00 / 0.00 | 0.00 / 0.00 |
| 3   | no-character:spa     | 0.00 / 0.80 | 0.00 / 1.70 |
| 3   | character:startup    | 1.10 / 5.70 | 1.20 / 7.60 |
| 3   | character:steady     | 0.70 / 1.60 | 0.70 / 1.80 |
| 3   | character:spa        | 0.00 / 1.70 | 0.00 / 1.60 |
| 4   | no-character:startup | 0.00 / 3.30 | 0.30 / 2.20 |
| 4   | no-character:steady  | 0.00 / 0.00 | 0.00 / 0.00 |
| 4   | no-character:spa     | 0.00 / 2.10 | 0.00 / 0.80 |
| 4   | character:startup    | 1.10 / 7.90 | 1.00 / 4.60 |
| 4   | character:steady     | 0.70 / 1.60 | 0.80 / 2.00 |
| 4   | character:spa        | 0.00 / 2.00 | 0.00 / 1.10 |

除外理由・背景負荷・GPUの直近値・動画の区間差は performance.json、全試行の数値は performance-raw.json.gz。私用モデルを含む画像・元traceはコミットしない。

背景CPUはユーザーの指示で5%の足切りから参考値へ変更した。旧条件でそろったのは1・2組目。変更後の条件では、広告・可視性・採取窓・実GPUを確かめた完全な組のうち、時系列順で最初の1〜4組を使う。CPUの値による選別はしていない。5・6組目の追加データもrawへ残し、途中の7組目は使わない。旧基準の収集器は条件変更に伴い途中終了した。capture-control.json と capture-strict.spec.ts に記録した。
