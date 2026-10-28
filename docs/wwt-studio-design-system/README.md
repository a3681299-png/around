The tool UI of Web World Themes: Studio, the side panel, the floating in-page editor, the popup and the display settings. Build every one of them from this system so that a creator who moves between them never feels a change of product.

**The idea in one line: shapes by ruler and compass, lines by G-pen.** Every size, split and angle is derived from one ratio, φ, and drawn on a 4px grid. Lines come in exactly two kinds, the way a manga page is made: frames and guides are ruled, uniform and quiet; what is drawn and what is marked is inked with a G-pen, thin at the start and the end and fullest just before the middle. Nothing wobbles. The character comes from the construction itself: guides you can see, sides that run past their corners, and drawings that are put down stroke by stroke on 12fps steps.

**The tool stays one step behind the creator's art.** Working surfaces (text, numbers, fields, lists, button shapes) are flat and exact. Construction and ink appear only where nothing is being operated (opening a panel, an empty state, first run) and as the few marks that say "this is selected". Ink never sits under text a person must read, and never changes where something can be clicked.

## The rules

1. **Sizes come from the scale.** `space-4`, `space-8`, `space-12`, `space-20`, `space-32`, `space-52`, `space-84`, `space-136`: the Fibonacci numbers × 4px, so every step sits on the 4px grid and neighbouring steps approach φ. Do not use a size that is not on the scale (16, 24, 40, 48 are not).
2. **Large splits are 1 : φ, rounded to 4px.** Studio at 1440px: rail 52 | layers 212 | canvas 836 | properties 340. Canvas side 888 : panel side 552 ≈ φ, properties 340 : layers 212 ≈ φ. The timesheet is 136 (84 + 52).
3. **Type size = line height ÷ φ.** Line heights are on the scale: `body` and `strong` 13/20, `heading` 20/32, `title` 32/52, `display` 52/84. Labels, numbers and frames are 12/20 in mono. Nothing below 12px.
4. **Angles are 0°, 45° and 90° only, and 45° means protection.** The only diagonal shapes are the 制限中 diamond and the vermilion hatch over protected controls. When a person sees a diagonal, the engine is protecting something.
5. **Radii nest by subtraction.** Inner radius = outer radius − the padding between them. The floating editor is `radius-float` (8) with `space-4` padding, so everything inside is `radius-control` (4). Docked panels have no radius.
6. **One shape, one meaning.** Filled circle 保存済み, dashed circle 未保存, diamond 制限中, triangle 助言, square a key on the timesheet. Every state is a word plus its shape, never colour alone.
7. **Two lines: ruler and G-pen.** See below.

## Lines

| Line  | Token                                                 | Where                                                                                                                                                          | How                                                                                  |
| ----- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Ruler | `rule` (1px), `line`, `line-control`, `ink-faint`     | Panel borders, row separators, input edges, the timesheet grid, construction guides in drawings                                                                | A uniform border or `ww-rule` stroke. Never tapered, never drawn in.                 |
| G-pen | `pen` (2.4px), `pen-large` (3.4px), `pen-tip` (0.2px) | The active tool (`ww-rail`), the selected tab (`ww-tab`), the frame around a part on the page (`ww-mark`), the main lines and spiral of a construction drawing | A filled outline (`WWTStudio.penOutline`) or the `--ww-pen-*` masks in `bundle.css`. |

- A G-pen line is drawn **in** when it appears: it grows from its start along its own path, in 4 frames for marks and up to 12 for a long spiral (`ww-draw` on the mask centreline; `WWTStudio.drawPen` does both). It never animates while it stays on screen.
- The frame around a part on the page is four G-pen sides that each run `overshoot` (4px) past the corners. It does not boil or flicker; the overshoot is what tells it apart from the page's own borders and from the creator's art.
- Construction drawings draw the guides first (ruler, `ink-faint`), then the main lines (G-pen, `ink` and `pen-bone`), then the accent (G-pen, `cobalt`).

## Colour

Two themes from one set of tokens: **Payne's grey** (dark, the default) and **Gesso** (light).

- **Cobalt is the only accent.** Selection, focus, the primary button, the playhead and every G-pen mark. Fills behind a selection are `cobalt-wash`. Never introduce a second brand hue.
- `ink` on `ground`, `surface`, `surface-raised`, `surface-sunk` for primary text; `ink-muted` for labels and secondary text. Both hold 4.5:1 in both themes.
- `ink-faint` is for construction guides, disabled text and placeholders. It is below 4.5:1 on purpose and never carries information a person needs.
- Control edges use `line-control` (3:1 on `surface` and `surface-raised`). `line` is for ruler lines between panels, rows and sections only.
- Text in `cobalt`, `vermilion`, `lamp-amber` or `ok-green` sits on `surface` or `surface-raised`. In Gesso they fall under 4.5:1 on `surface-sunk`: keep coloured text out of headers.
- `pen-bone` is ink for drawings only (the compass arc, secondary main lines). Never text, never an edge.
- Focus ring: 2px solid `cobalt`, 1px offset, on every focusable control.

## Motion: 12fps steps (コマ打ち)

One frame is `--ww-frame` (83ms). Every transition is a whole number of frames played with `steps(n)`: 2 for hover fills, 3 for toggles and for content appearing, 4 for a G-pen mark being drawn and for a panel's edges being ruled. Nothing in the tool eases smoothly at 60fps. This is the same コマ打ち creators set on their own characters, so the tool moves like the medium. Under `prefers-reduced-motion`, everything is shown in its final state at once.

- **Opening a panel** (`ww-construct`): its ruled edges are drawn in 4 frames, then its content appears in 3.
- **Empty states** (`ww-empty`): a construction is drawn on graph paper (guides → main lines → accent), then the words and actions appear. Each section has its own drawing: the golden rectangle and spiral for layers, a square with its inscribed circles for properties, a nine-slice frame for UIの着せ替え, a ruler and playhead for the timesheet.
- **Graph paper** (20px pitch, 5% `ink`) is the only texture in the system, and only behind empty states and the canvas surround.

## States and their meaning

| State                      | Token                         | Shape                              | Words                                        |
| -------------------------- | ----------------------------- | ---------------------------------- | -------------------------------------------- |
| Saved                      | `ok-green`                    | filled circle                      | 保存済み                                     |
| Unsaved                    | `ink-muted`                   | dashed circle                      | 未保存                                       |
| Limited by the engine (G1) | `vermilion`, `vermilion-wash` | diamond; 45° hatch on the page     | 制限中 + what it protected and how to fix it |
| Advice, not enforced       | `lamp-amber`                  | triangle                           | 読みにくいかもしれません 等                  |
| Atmosphere layer           | `lamp-amber`                  | ruled edge                         | 雰囲気 33%                                   |
| Not available              | `ink-faint`                   | small dot; dashed edge on the page | 未対応                                       |
| Timesheet key              | `pen-bone`, selected `cobalt` | square                             | —                                            |

Protected areas on the page are drawn with `ww-protect`: the 45° vermilion hatch with a mono label naming the part (`player.controls.bottom`). Red always means "the engine is protecting a real control here".

## Type

- Interface text is `BIZ UDPGothic` (`ui` family). Numbers, frame counts, protection labels and English eyebrows are `IBM Plex Mono` (`mono` family), with tabular figures.
- Uppercase is for short English eyebrows only (`LAYERS`, `PROPERTIES`). Japanese labels are never set in the mono face.

## Surfaces

Each surface uses the same components; only the arrangement changes.

- **Studio (separate window, 1440px reference).** Top bar `bar` (52) on `surface-sunk`. `ww-rail` on the left (52), layers `panel-layers` (212), the live page on `ground` with `space-32` around it, properties `panel-properties` (340), `ww-sheet` along the bottom (`sheet`, 136) aligned under the layers panel.
- **Side panel (320–480px).** Header `bar` (52) with the status chip, `ww-tabs` (レイヤー / 属性 / 着せ替え / タイムライン), one column.
- **In-page editor (floating, 340px).** The side panel's content inside `ww-panel--float`, docked `space-20` in from the left or right edge of the page. It moves out of the way of the player and remembers where it was put.
- **Popup and display settings.** One `ww-panel` with the primary action 「エディターを開く」 first, then the display controls. The popup is not a place for editing.
- **The retro "settings.exe" window belongs to the retro theme, not to the tool.** The editor and Studio always wear this system.

## Copy

- Write in plain Japanese from the creator's side: name parts the way they see them on the page (チャンネル登録ボタン, 動画カード), not by internal IDs. Internal IDs appear only in mono labels on protection overlays and diagnostics.
- Buttons say what happens: 保存, 元に戻す, エディターを開く, 着せ替えを外す.
- When the engine limits something, say what it protected and how to fix it in one sentence each: 「シークバーの上にかかる部分を隠しています。」「映像の中央へ動かすか、小さくしてください。」
- No emoji anywhere in the tool. No exclamation marks in system messages.

## Iconography

- 16px line icons, 1.5px ruler stroke, round caps and joins, `currentColor`. Inactive `ink-muted`; active `cobalt`.
- Every icon is drawn on the same construction: a 14px square, its circumscribed circle (r 7), the circle r 7/φ (4.33), and the φ split lines at 9.65. Icons are ruled, never inked: the G-pen is for marks, not glyphs.
- One icon per meaning across all surfaces. No filled icons, no emoji, no brand logos inside the tool.

## Using it in code

- Load `tokens.css`, then `components/bundle.css`, then `components/bundle.js` (it defines `window.WWTStudio`). In the extension, scope everything inside the editor's Shadow DOM or window so no tool colour or mark leaks onto the real page; the only things drawn on the page are `ww-mark`, `ww-tag`, `ww-unsupported` and `ww-protect`.
- `WWTStudio.penOutline(points, {width, tip, bias})` is the reference for the G-pen shape. Port it as is; do not approximate it with a stroked path or a CSS border.
- `WWTStudio.drawPen(svg, points, {width, color, delay, frames})` draws a G-pen line into an SVG and reveals it along its path on 12fps steps. `WWTStudio.goldenSpiral(x, y, [136, 84, 52, 32, 20, 12])` gives the centreline of the spiral used in empty states.

## Do not

- Do not use a size, radius or angle that is not in the rules above.
- Do not wobble, boil or texture a line. Do not use brush, crayon or paint marks: they were the previous direction and are gone.
- Do not use purple, gradients, glass blur, glowing borders or drop shadows on docked panels.
- Do not use more than one primary button in a panel.
- Do not show a count as "-個": show nothing until the count is known.
- Do not put two save indicators on one screen. The status chip in the header is the one place.
