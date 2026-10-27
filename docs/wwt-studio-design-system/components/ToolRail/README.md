The column (Studio) or row (side panel, in-page editor) of tools; one tool is active at a time.

- Provide `ww-icon-btn` children with `aria-pressed`; group them with `<hr>`.
- The active tool is `cobalt` and gets a G-pen circle around it (an open ring, thin where it starts and ends), drawn round in 4 frames when the tool is chosen.
- Order: pointer tools first (選択, 移動), then content tools (素材, 着せ替え, 光, タイムシート).
- Width (or height) is `bar` (52) on `surface-sunk`, buttons `control` (32) with `space-8` between them.

Do not: put text labels in the rail; put save, undo or close in the rail (they live in the header); mark the active tool with a filled pill.
