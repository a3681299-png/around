import { createYouTubeAdapter, supportsYouTube } from './youtube';
import type { SiteAdapter } from './types';

export function getSiteAdapter(doc: Document, view: Window): SiteAdapter | undefined {
  return supportsYouTube(new URL(view.location.href)) ? createYouTubeAdapter(doc, view) : undefined;
}
