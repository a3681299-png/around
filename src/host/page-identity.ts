/** A site adapter's page identity: the same string for addresses that show the same page. */
export type PageIdentity = (url: URL) => string;

/**
 * Tells, for each frame's document address, whether a new page began since the last one (an SPA
 * move changes the address without a new document). The page is the adapter's identity when it
 * has one (YouTube: the video, not `t=`), otherwise the address without its fragment. The first
 * address is not a new page: there is nothing to forget. Per frame, one string comparison; the
 * identity is asked only when the address changes.
 */
export function createPageTracker(identity?: PageIdentity): (address: string) => boolean {
  let address: string | undefined, page: string | undefined;
  const pageOf = (href: string) => {
    if (identity && href) {
      try {
        return identity(new URL(href));
      } catch {
        // An address the URL parser refuses falls back to the address itself.
      }
    }
    return href.split('#')[0]!;
  };
  return (href) => {
    if (href === address) return false;
    address = href;
    const next = pageOf(href),
      changed = page !== undefined && next !== page;
    page = next;
    return changed;
  };
}
