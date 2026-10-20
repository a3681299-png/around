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
  | 'icon';

/** A site places this entry; its settings UI never needs site-specific selectors. */
export interface SettingsEntry {
  readonly button: HTMLButtonElement;
  readonly panel: HTMLElement;
  close(restoreFocus?: boolean): void;
}

/** A mounted capability owns everything it adds, including listeners and observers. */
export interface SiteFeatureInstance {
  refresh?(): void;
  destroy(): void;
}

export interface SiteFeatureCapability {
  mount(): SiteFeatureInstance;
}

export interface SiteAdapter {
  readonly id: string;
  readonly stylesheet: string;
  readonly designTargets?: readonly DesignTarget[];
  readonly decorationAnchors?: readonly DesignTarget[];
  /** Native media discovery belongs to the site; consumers only receive signals. */
  readonly signals?: { readonly videoPlayback?: PlaybackSource };
  /** Optional site-owned implementations; unsupported features are safely skipped. */
  readonly features?: Readonly<Record<string, SiteFeatureCapability>>;
  connect(onPageChange: () => void): () => void;
  mountSettings(entry: SettingsEntry): () => void;
  protectStudioToolbar?(toolbar: HTMLElement): () => void;
  mountStudio?(changed: (state: StudioHostLayout) => void): StudioLayoutAdapter;
}
