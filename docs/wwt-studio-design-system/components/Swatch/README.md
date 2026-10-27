A colour choice (the colour-only fallback when a part is too small, a theme colour, a light's tint).

- `ww-swatch` is a 52 × 32 rectangle (≈ φ) with a ruled `line-control` edge and `radius-control`; set the colour with `--swatch`. Put the hex in mono beside or under it when the value matters.
- Group in `ww-swatches` (gap `space-8`). The chosen one has `aria-pressed="true"`: a 2px `cobalt` ring 2px outside.
- The swatch is the colour exactly, flat. It is never textured or painted.

Do not: use circles for swatches (the circle means a save state); show a colour without a way to read its value.
