import type { DesignTarget } from '../design/types';
import type { PlaybackSource } from '../signals/types';
import type { StudioHostLayout, StudioLayoutAdapter } from '../studio/layout-types';

/** The theme sees semantic surfaces; the adapter owns selectors and page lifecycle. */
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

/** A mounted capability owns everything it adds, including listeners and observers. */
export interface SiteFeatureInstance {
  refresh?(): void;
  destroy(): void;
}

export interface SiteFeatureCapability {
  mount(): SiteFeatureInstance;
}

/** The adapter classifies page work; themes do not inspect site-specific DOM. */
export type SitePageChange = 'content' | 'structure' | 'navigation' | 'mode' | 'fullscreen';

export interface SiteAdapter {
  readonly id: string;
  readonly stylesheet: string;
  readonly designTargets?: readonly DesignTarget[];
  readonly decorationAnchors?: readonly DesignTarget[];
  /** Site-specific native controls the skin picker labels as 未対応 when no part covers them. */
  readonly skinControls?: string;
  /** Native media discovery belongs to the site; consumers only receive signals. */
  readonly signals?: { readonly videoPlayback?: PlaybackSource };
  readonly operationSurfaces?: () => import('../host/operation-source').OperationSource;
  /** Optional site-owned implementations; unsupported features are safely skipped. */
  readonly features?: Readonly<Record<string, SiteFeatureCapability>>;
  /** `marked` lists elements whose semantic surfaces changed in this batch, so consumers
   * never need a whole-document query to find new parts. */
  connect(onPageChange: (change?: SitePageChange, marked?: readonly Element[]) => void): () => void;
  /** Design-target parts the page needs marked: those the artwork uses, or all of them while
   * the editor picks parts. Unused parts cost nothing during scans. */
  setDesignParts?(ids: ReadonlySet<string>): void;
  mountSettings(entry: SettingsEntry): () => void;
  protectStudioToolbar?(toolbar: HTMLElement): () => void;
  mountStudio?(changed: (state: StudioHostLayout) => void): StudioLayoutAdapter;
}
