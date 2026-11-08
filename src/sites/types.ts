import type { DesignTarget } from '../design/types';
import type { PlaybackSource } from '../signals/types';
import type { PageIdentity } from '../host/page-identity';

/** Consumers see semantic surfaces; the adapter owns selectors and page lifecycle. */
export type Surface =
  | 'page'
  | 'panel'
  | 'frame'
  | 'rounded'
  | 'window'
  | 'input'
  | 'button'
  | 'card'
  | 'video-card'
  | 'section'
  | 'sidebar'
  | 'toolbar'
  | 'titlebar'
  | 'menubar'
  | 'navigation'
  | 'selected'
  | 'text'
  | 'heading'
  | 'metadata'
  | 'chip'
  | 'comments'
  | 'primary-heading'
  | 'comment-text'
  | 'comment-vote'
  | 'reading-panel'
  | 'label'
  | 'player-window'
  | 'playlist-window'
  | 'playlist-row'
  | 'duration'
  | 'wordmark'
  | 'icon'
  | 'subscribe-button'
  | 'like-button'
  | 'dislike-button'
  | 'action-button'
  | 'search-box'
  | 'filter-chip'
  | 'description-panel'
  | 'comment-input';

/** A site places this entry; its settings UI never needs site-specific selectors. */
export interface SettingsEntry {
  readonly button: HTMLButtonElement;
  readonly panel: HTMLElement;
  close(restoreFocus?: boolean): void;
  setAvoidRect?(get: () => { left: number; top: number; width: number; height: number } | undefined): void;
  reposition?(): void;
}

/** The adapter classifies page work; the artwork's renderers do not inspect site-specific DOM. */
export type SitePageChange = 'content' | 'structure' | 'navigation' | 'mode' | 'fullscreen';

export interface SiteAdapter {
  readonly id: string;
  readonly designTargets?: readonly DesignTarget[];
  readonly decorationAnchors?: readonly DesignTarget[];
  /** Site-specific native controls the skin picker labels as 未対応 when no part covers them. */
  readonly skinControls?: string;
  /** When `node` is inside a layer the site draws over its parts (YouTube's inline preview over a
   * video card, outside the card), the element at (x, y) beneath that layer; otherwise undefined.
   * A hit test at one point, never a document query: callers find the part with `closest`. */
  beneathOverlay?(node: Element, x: number, y: number): Element | undefined;
  /** Native media discovery belongs to the site; consumers only receive signals. `page` is the
   * site's page identity (the same string for addresses showing the same page; YouTube: the video,
   * not `t=`): a new page starts each character's autonomy again. Without it, the address
   * without its fragment is the page. */
  readonly signals?: { readonly videoPlayback?: PlaybackSource; readonly page?: PageIdentity };
  readonly operationSurfaces?: () => import('../host/operation-source').OperationSource;
  /** `marked` lists elements whose semantic surfaces changed in this batch, so consumers
   * never need a whole-document query to find new parts. */
  connect(onPageChange: (change?: SitePageChange, marked?: readonly Element[]) => void): () => void;
  /** Design-target parts the page needs marked: those the artwork uses, or all of them while
   * the editor picks parts. Unused parts cost nothing during scans. */
  setDesignParts?(ids: ReadonlySet<string>): void;
  mountSettings(entry: SettingsEntry): () => void;
  /** The depth foundation (docs/depth-foundation.md): where the room goes and what is in front of it. */
  readonly backdrop?: SiteBackdrop;
}

/**
 * The page's side of the room behind the UI. The adapter owns which of its own backgrounds turn
 * transparent (never the parts' looks) and which containers are read, operated or free; the
 * engine only receives the rectangles.
 */
export interface SiteBackdrop {
  /** Gives the place for the room under the content (a fixed child at a negative level). `show`
   * makes the page's own background transparent once the room is there to be seen (the page keeps
   * its looks while the room loads); `close` puts the page back as it was. */
  open(): { parent: HTMLElement; zIndex: number; show(): void; close(): void };
  /**
   * The UI regions now, with their importance: the G1 operation list widened to containers
   * (docs/product-design-snapshot.md, UI の領域情報). A handful of known containers, found once
   * and kept while connected; reading them is a few box reads, never a document-wide query.
   */
  regions(): readonly import('../world/space').UiRegion[];
  /** The page changed (the adapter's own page-change notice): parts may be looked for again. */
  refresh?(): void;
  scheme(): import('../world/space').ColorScheme;
  /** The page's main video, whose colour lights the room; kept while connected. */
  video(): HTMLVideoElement | undefined;
  /** The page shows its video wide (YouTube's theater): the room opens on both sides. A known
   * part's attribute, kept while connected; never a document-wide query. */
  theater?(): boolean;
}
