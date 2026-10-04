/** One extension-local font face, shared by page chrome and the shadow-root editor. */
export function mountPixelFont(doc: Document): () => void {
  const asset = 'assets/fonts/PixelMplus12-Regular.woff2';
  const url = globalThis.chrome?.runtime?.getURL?.(asset) ?? new URL(asset, doc.baseURI).href;
  const face = new FontFace('Web World Pixel', `url("${url}") format("woff2")`, {
    style: 'normal', weight: '400', display: 'swap',
  });
  doc.fonts.add(face);
  // A missing/blocked font must never prevent playback or the settings from working.
  void face.load().catch(() => undefined);
  return () => { doc.fonts.delete(face); };
}
