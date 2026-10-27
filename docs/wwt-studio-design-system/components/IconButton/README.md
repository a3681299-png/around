An icon-only action; always give it an `aria-label` and a tooltip with the same words.

- Provide one 16px line icon (1.5px ruled stroke, round caps, `currentColor`) as an inline SVG child, drawn on the icon construction (14px square, circles r 7 and r 4.33, φ lines at 9.65).
- Use `aria-pressed="true"` for toggles (表示, ロック): it turns `cobalt`. In `ww-rail` the pressed tool also gets the G-pen circle.
- Target is `control` (32). `ww-icon-btn--dense` (20) only inside rows.

Do not: use filled icons, emoji or text glyphs (× —) instead of the icon set; give an icon button a border; ink an icon with the G-pen.
