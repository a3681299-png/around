/** Development-only calls. The normal build removes their labelled statements and this module. */
declare const __WW_PAGE_CHANGE_LEGACY__: boolean;
type Counts = { compiles: number; featureRefreshes: number };
export function countPageChange(field: keyof Counts): void {
  const counts = (globalThis as typeof globalThis & { __pageChanges?: Counts }).__pageChanges;
  if (counts) counts[field]++;
}
export function legacyPageChange(): boolean {
  return typeof __WW_PAGE_CHANGE_LEGACY__ !== 'undefined' && __WW_PAGE_CHANGE_LEGACY__;
}
