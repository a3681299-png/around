How WWT marks a part of the real page: a G-pen frame whose sides run past the corners, with a name tag.

- Place `ww-mark` absolutely over the part's box grown by `overshoot` (4px) on every side. Its four sides are G-pen strokes (thin at both ends, fullest just before the middle) that cross at the corners and run 4px past them. It is drawn in once, in 4 frames, when the part is hovered or selected, and then stays still.
- Other instances of the same part get `ww-mark--sibling` (50%, no draw-in) so the creator sees everything that will change.
- The tag (`ww-tag`, `cobalt` with `on-cobalt` text) sits just below the frame's bottom-left and says the part's name and how many are on the page. Parts that cannot be dressed get `ww-unsupported` (a ruled dashed edge in `ink-faint`) and a `ww-tag--off` reading 未対応.
- Outlines and tags never take pointer events; the real part stays clickable.

Do not: boil, glow or animate the frame while it is shown; draw it as a uniform border; use red (red is for protection).
