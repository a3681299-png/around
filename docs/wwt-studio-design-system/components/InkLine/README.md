The two lines of the system: the ruler (uniform, for frames and guides) and the G-pen (入り抜き, for what is drawn and marked).

- Ruler: a 1px border, or an SVG stroke with `ww-rule` (`ink-faint`) for construction guides. Add `ww-draw` and `pathLength="1"` to rule it in on 12fps steps.
- G-pen: a filled outline from `WWTStudio.penOutline(points, {width, tip, bias})`: `tip` 0.2px at both ends, `width` at its fullest a little before the middle (`bias` 0.45). Use `pen` (2.4) for marks and `pen-large` (3.4) for the main lines of drawings 136px or taller.
- Draw a G-pen line in with `WWTStudio.drawPen(svg, points, {width, color, delay, frames})`: a mask centreline is revealed along the path, so the ink appears to leave the nib. 4 frames for a mark, up to 12 for a spiral.
- In CSS, the `--ww-pen-h`, `--ww-pen-v` and `--ww-pen-ring` masks give the same shapes to `ww-tab`, `ww-mark`, the rail's active circle and `ww-penline`.

Do not: imitate the taper with a stroked path, a gradient or a border; wobble, displace or texture either line.
