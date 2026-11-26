import type { LayerPlacement } from '../design/types';

/**
 * Where a character lives when nobody placed it: the player's bottom-right corner, under its bars
 * (Shota's decision, chunk 3; the default for a fresh import since 2026-11-07). The anchor is a part
 * kind ('video-player'), not a site's element, so the same home works on any adapter that reports
 * a player. A model on the screen plane over the video is cut out where the player's bars are while
 * watching, so the old default (the middle of the viewport) left a fresh import invisible.
 */
export const CHARACTER_HOME: LayerPlacement = Object.freeze({
  anchor: Object.freeze({ kind: 'surface', target: 'video-player' }),
  x: 0.9,
  // Low enough to sit in the corner, high enough that the box stays inside the player.
  y: 0.74,
  widthPx: 150,
  heightPx: 190,
  rotationDeg: 0,
}) as LayerPlacement;
