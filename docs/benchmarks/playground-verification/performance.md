| 場面                 | CPU中央値 前→後 ms | CPU p95 前→後 ms | 差 中央値 / p95 ms | CPU予算 | 全体p95 前→後 ms |
| -------------------- | ------------------ | ---------------- | ------------------ | ------- | ---------------- |
| no-character:startup | 0.000 → 0.000      | 4.400 → 6.900    | 0.000 / 2.500      | 超過    | 51.698 → 64.227  |
| no-character:steady  | 0.000 → 0.000      | 0.000 → 0.000    | 0.000 / 0.000      | 範囲内  | 7.570 → 7.487    |
| no-character:spa     | 0.000 → 0.000      | 2.200 → 1.700    | 0.000 / -0.500     | 範囲内  | 26.107 → 25.990  |
| character:startup    | 1.300 → 1.100      | 8.700 → 8.700    | -0.200 / 0.000     | 範囲内  | 58.308 → 66.588  |
| character:steady     | 1.000 → 1.000      | 2.000 → 2.100    | 0.000 / 0.100      | 範囲内  | 12.472 → 12.533  |
| character:spa        | 0.000 → 0.000      | 3.200 → 1.700    | 0.000 / -1.500     | 範囲内  | 24.300 → 25.660  |

| 組               | 場面                 | CPU中央値 前→後 ms | CPU p95 前→後 ms |
| ---------------- | -------------------- | ------------------ | ---------------- |
| 1 (before→after) | no-character:startup | 0.200 → 0.000      | 3.500 → 5.400    |
| 1 (before→after) | no-character:steady  | 0.000 → 0.000      | 0.000 → 0.000    |
| 1 (before→after) | no-character:spa     | 0.000 → 0.000      | 1.300 → 2.100    |
| 1 (before→after) | character:startup    | 1.100 → 1.100      | 5.900 → 5.900    |
| 1 (before→after) | character:steady     | 1.000 → 1.000      | 2.100 → 2.100    |
| 1 (before→after) | character:spa        | 0.000 → 0.000      | 1.100 → 1.700    |
| 2 (after→before) | no-character:startup | 0.000 → 0.000      | 2.800 → 6.200    |
| 2 (after→before) | no-character:steady  | 0.000 → 0.000      | 0.000 → 0.000    |
| 2 (after→before) | no-character:spa     | 0.000 → 0.000      | 2.000 → 1.400    |
| 2 (after→before) | character:startup    | 1.100 → 1.300      | 3.800 → 11.900   |
| 2 (after→before) | character:steady     | 1.000 → 1.100      | 1.900 → 2.100    |
| 2 (after→before) | character:spa        | 0.000 → 0.000      | 2.000 → 1.100    |
| 4 (after→before) | no-character:startup | 0.000 → 0.000      | 4.900 → 7.600    |
| 4 (after→before) | no-character:steady  | 0.000 → 0.000      | 0.000 → 0.000    |
| 4 (after→before) | no-character:spa     | 0.000 → 0.000      | 2.100 → 1.600    |
| 4 (after→before) | character:startup    | 1.500 → 1.100      | 10.500 → 7.000   |
| 4 (after→before) | character:steady     | 1.100 → 1.200      | 2.000 → 2.300    |
| 4 (after→before) | character:spa        | 0.000 → 0.000      | 4.200 → 1.500    |
| 5 (before→after) | no-character:startup | 0.000 → 0.000      | 6.900 → 9.200    |
| 5 (before→after) | no-character:steady  | 0.000 → 0.000      | 0.000 → 0.000    |
| 5 (before→after) | no-character:spa     | 0.000 → 0.000      | 3.400 → 1.700    |
| 5 (before→after) | character:startup    | 1.600 → 1.100      | 16.400 → 10.300  |
| 5 (before→after) | character:steady     | 0.900 → 0.800      | 1.900 → 1.400    |
| 5 (before→after) | character:spa        | 0.000 → 0.000      | 3.900 → 1.900    |
