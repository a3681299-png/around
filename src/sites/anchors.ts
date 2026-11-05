import type { DesignTarget } from '../design/types';

/**
 * Anchors shared by every site adapter. Artwork names a part's kind, never a site's part: a layer
 * placed on `video-player` sits on whatever the adapter reports as the main video's window.
 * Adapters reuse these objects so the same artwork moves between sites unchanged.
 */
export const SHARED_DECORATION_ANCHORS: readonly DesignTarget[] = Object.freeze([
  Object.freeze({ id: 'video-player', surface: 'player-window', label: '動画プレイヤー' }),
]);
