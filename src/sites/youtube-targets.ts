import type { DesignTarget } from '../design/types';
import type { Surface } from './types';

/**
 * Parts an author can dress. IDs are fixed meanings saved in artwork; selectors and state
 * conditions are YouTube knowledge and never leave this adapter. `&` is the part itself.
 */
interface YouTubeTarget extends DesignTarget {
  readonly surface: Surface;
  /** Elements that receive the part's surface; null keeps an existing marking (video cards). */
  readonly selector: string | null;
}

const BUTTON_DISABLED = '&:is([disabled], [aria-disabled="true"])';
const button = {
  hover: '&:hover',
  focus: '&:focus-visible',
  pressed: '&:active',
  disabled: BUTTON_DISABLED,
} as const;

const targets: readonly YouTubeTarget[] = [
  {
    id: 'video-card',
    surface: 'video-card',
    label: '動画カード',
    selector: null,
    skin: {
      states: { hover: '&:hover', focus: '&:focus-within', pressed: '&:active' },
      where: 'トップページ・検索結果・関連動画',
      sample: { width: 360, height: 300 },
    },
  },
  {
    id: 'subscribe-button',
    surface: 'subscribe-button',
    label: 'チャンネル登録ボタン',
    selector: 'ytd-subscribe-button-renderer button, yt-subscribe-button-view-model button',
    skin: {
      states: {
        ...button,
        selected:
          ':is(ytd-subscribe-button-renderer[subscribed], yt-subscribe-button-view-model[subscribed], #notification-preference-button) &',
      },
      labels: { selected: '登録済み' },
      where: '動画ページ・チャンネルページ',
      sample: { width: 130, height: 36 },
    },
  },
  {
    id: 'like-button',
    surface: 'like-button',
    label: '高評価ボタン',
    selector: 'ytd-watch-metadata like-button-view-model button, ytd-watch-metadata #segmented-like-button button',
    skin: {
      states: { ...button, selected: '&[aria-pressed="true"]' },
      labels: { selected: '高評価済み' },
      where: '動画ページ',
      sample: { width: 96, height: 36 },
    },
  },
  {
    id: 'dislike-button',
    surface: 'dislike-button',
    label: '低評価ボタン',
    selector:
      'ytd-watch-metadata dislike-button-view-model button, ytd-watch-metadata #segmented-dislike-button button',
    skin: {
      states: { ...button, selected: '&[aria-pressed="true"]' },
      labels: { selected: '低評価済み' },
      where: '動画ページ',
      sample: { width: 52, height: 36 },
    },
  },
  {
    id: 'action-button',
    surface: 'action-button',
    label: '共有などのアクションボタン',
    // Like/dislike have their own parts; everything else in the action row shares one look.
    selector:
      'ytd-watch-metadata #top-level-buttons-computed > :not(segmented-like-dislike-button-view-model, ytd-segmented-like-dislike-button-renderer) button, ytd-watch-metadata #flexible-item-buttons button, ytd-watch-metadata ytd-menu-renderer > yt-button-shape > button',
    skin: {
      states: { ...button, selected: '&[aria-pressed="true"]' },
      where: '動画ページ',
      sample: { width: 88, height: 36 },
    },
  },
  {
    id: 'search-box',
    surface: 'search-box',
    label: '検索欄',
    selector: 'yt-searchbox .ytSearchboxComponentInputBox, ytd-searchbox #container',
    skin: {
      states: { hover: '&:hover', focus: '&:focus-within' },
      where: 'ページ上部（すべてのページ）',
      sample: { width: 480, height: 40 },
    },
  },
  {
    id: 'filter-chip',
    surface: 'filter-chip',
    label: '絞り込みチップ',
    selector:
      'yt-chip-cloud-chip-renderer .ytChipShapeChip, yt-chip-cloud-chip-renderer button:not(:has(.ytChipShapeChip)), yt-chip-cloud-chip-renderer:not(:has(button))',
    skin: {
      states: {
        hover: '&:hover',
        focus: ':focus-visible > &',
        selected: '&:is(.ytChipShapeActive, [aria-selected="true"] > *, yt-chip-cloud-chip-renderer[selected] *)',
        pressed: '&:active',
      },
      labels: { selected: '選択中のカテゴリ' },
      where: 'トップページ上部・関連動画の上',
      sample: { width: 72, height: 32 },
    },
  },
  {
    id: 'description-panel',
    surface: 'description-panel',
    label: '説明欄の枠',
    selector: 'ytd-watch-metadata #description',
    skin: {
      states: { hover: '&:hover', selected: 'ytd-watch-metadata:not([description-collapsed]) &' },
      labels: { selected: '展開中' },
      where: '動画ページ',
      sample: { width: 560, height: 104 },
    },
  },
  {
    id: 'comment-input',
    surface: 'comment-input',
    label: 'コメントの入力欄',
    selector: 'ytd-comment-simplebox-renderer #placeholder-area, ytd-commentbox #creation-box',
    skin: {
      states: { hover: '&:hover', focus: '&:focus-within' },
      where: '動画ページのコメント欄（スクロールして読み込み後）',
      sample: { width: 520, height: 40 },
    },
  },
];

export const YOUTUBE_DESIGN_TARGETS: readonly DesignTarget[] = Object.freeze(
  targets.map(({ selector: _selector, ...target }) => Object.freeze(target)),
);
/** Native controls without a part: the editor names them 未対応 instead of staying silent. */
export const YOUTUBE_SKIN_CONTROLS =
  'yt-icon, ytd-thumbnail, yt-thumbnail-view-model, yt-button-shape, yt-chip-cloud-chip-renderer';
/** Marking entries for the adapter's surface scan. */
export const YOUTUBE_SKIN_MARKS: ReadonlyArray<{ selector: string; surfaces: readonly Surface[] }> = targets.flatMap(
  (target) => (target.selector ? [{ selector: target.selector, surfaces: [target.surface] }] : []),
);
