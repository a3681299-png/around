A labelled value; numbers are edited with the scrub (drag the axis letter, or type), choices with segments.

- Provide a label (`ww-field__label`, Japanese, 12px `ink-muted`) and one control: `ww-input` for words, `ww-scrub` for numbers, `ww-segs` of `ww-seg` buttons for 2–4 choices (コマ打ち 1/2/3).
- `ww-scrub` shows a mono axis letter (X, Y, R, α, K) that is the drag handle, the value right-aligned in `number` style, and the unit in `ink-muted`. While dragging or focused, add `ww-scrub--active`.
- Pair X/Y and 幅/高さ in `ww-pair` (gap `space-12`).
- Inputs sit on `surface-sunk` with a ruled `line-control` edge. Nothing is drawn under or behind a field.

Do not: use spinner arrows; show units inside the value text; set numbers in the UI face.
