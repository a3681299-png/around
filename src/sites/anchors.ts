import type { DesignTarget } from '../design/types';

/**
 * Anchors shared by every site adapter. Artwork names a part's kind, never a site's part: a layer
 * placed on `video-player` sits on whatever the adapter reports as the main video's window.
 * Adapters reuse these objects so the same artwork moves between sites unchanged.
 */
export const SHARED_DECORATION_ANCHORS: readonly DesignTarget[] = Object.freeze([
  // A character on the player sits on the video's frame: its lower edge (behind the bars when
  // they show) or its upper edge, where the page leaves room above the player.
  Object.freeze({
    id: 'video-player',
    surface: 'player-window',
    label: '動画プレイヤー',
    seats: Object.freeze(['bottom', 'top'] as const),
  }),
]);

/**
 * The same anchors where the page has no room above its player (a fixed header right on top of
 * it, as on YouTube's watch page): a character sitting on the upper edge would be hidden under the
 * header and the player both, so that edge is no seat there. Same IDs: artwork moves unchanged.
 */
export const LOWER_SEAT_ANCHORS: readonly DesignTarget[] = Object.freeze(
  SHARED_DECORATION_ANCHORS.map((anchor) =>
    anchor.seats ? Object.freeze({ ...anchor, seats: Object.freeze(['bottom'] as const) }) : anchor,
  ),
);
