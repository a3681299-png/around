import { isDesignId } from '../design/schema';

// Where an artwork is kept, per site. The extension's storage of it is src/browser/design-store.ts.
export function designKey(siteId: string): string {
  if (!isDesignId(siteId)) throw new Error('サイトの識別子が不正です。');
  return `around.design.${siteId}`;
}
