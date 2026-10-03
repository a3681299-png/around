/** The theme sees semantic surfaces; the adapter owns selectors and page lifecycle. */
export type Surface = 'page' | 'panel' | 'frame' | 'rounded' | 'window'
  | 'input' | 'button' | 'card' | 'section' | 'sidebar' | 'toolbar' | 'titlebar' | 'menubar'
  | 'navigation' | 'selected' | 'text';

/** A site places this entry; its settings UI never needs site-specific selectors. */
export interface SettingsEntry {
  readonly button: HTMLButtonElement;
  readonly panel: HTMLElement;
  close(restoreFocus?: boolean): void;
}

export interface SiteAdapter {
  readonly id: string;
  readonly stylesheet: string;
  connect(onPageChange: () => void): () => void;
  mountSettings(entry: SettingsEntry): () => void;
}
