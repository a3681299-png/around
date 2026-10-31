How WWT marks a part of the real page: a G-pen frame whose sides run past the corners, with a name tag.

- Place `ww-mark` absolutely over the part's box grown by `overshoot` (4px) on every side. Its four sides are G-pen strokes (thin at both ends, fullest just before the middle) that cross at the corners and run 4px past them. It is drawn in once, in 4 frames, when the part is hovered or selected, and then stays still.
- Other instances of the same part get `ww-mark--sibling` so the creator sees everything that will change. It is ruled, not inked: a 1px solid `cobalt` line at 50%, never drawn in. On the page it is a CSS `outline` on each part (offset 4px, the overshoot), so the engine never has to follow twenty video cards as they scroll; only the hovered or selected part carries the G-pen frame.
- On the real page the marks keep Gesso's values (`cobalt` #2b51b8 with a white edge, the `on-cobalt` tag) whatever the colour scheme, because they sit over any picture: white or dark YouTube, bright or dark video. All of them live in one shadow root that takes no input.
- The tag (`ww-tag`, `cobalt` with `on-cobalt` text) sits just below the frame's bottom-left and says the part's name and how many are on the page. Parts that cannot be dressed get `ww-unsupported` (a ruled dashed edge in `ink-faint`) and a `ww-tag--off` reading 未対応.
- Outlines and tags never take pointer events; the real part stays clickable.

Do not: boil, glow or animate the frame while it is shown; draw it as a uniform border; use red (red is for protection).
