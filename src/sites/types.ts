/** The theme sees semantic surfaces; the adapter owns selectors and page lifecycle. */
export type Surface = 'page' | 'panel' | 'frame' | 'rounded';

export interface SiteAdapter {
  readonly id: string;
  readonly stylesheet: string;
  connect(onPageChange: () => void): () => void;
}
