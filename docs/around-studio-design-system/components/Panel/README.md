A titled container for one job (layers, properties, parts); docked in Studio and the side panel, floating on the page.

- Provide a header (`around-panel__header`, height `control`) with an optional mono eyebrow, one title, the save status chip and dense icon buttons; then a body of `around-section`s (padding `space-12` `space-20` `space-20`, ruled apart by `line`).
- Docked panels: ruled 1px edges, no radius, no shadow.
- Floating (`around-panel--float`): `radius-float` (8) on `surface-raised` with `space-4` padding, `shadow-float`; the body inside is `radius-control` (8 − 4 = 4).
- When a panel opens, add `around-construct` once: its ruled edges are drawn in 4 frames, then the content appears in 3.
- The save status lives only in the header chip.

Do not: nest panels; round a docked panel; put paragraphs of instructions in the body (use the empty state or a hover hint).
