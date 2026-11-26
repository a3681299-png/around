import type { EditorView } from '../editor-core/types';
import { glyph } from '../editor/icons';

/** Source thumbnails reuse pixels already painted by the Host, never another player. */
export function createAssetLibrary(
  doc: Document,
  root: HTMLElement,
  select: (id: string) => void,
  thumbnail: (id: string) => Promise<string | undefined>,
) {
  let view: EditorView | undefined,
    key = '',
    alive = true,
    busy = false,
    timer: ReturnType<typeof setTimeout> | undefined;
  const cache = new Map<string, string>(),
    attempts = new Map<string, number>();
  async function previews() {
    if (!alive || busy || doc.hidden) return;
    const layer = view?.images.find((item) => !cache.has(item.assetId) && (attempts.get(item.assetId) ?? 0) < 20);
    if (!layer) return;
    busy = true;
    attempts.set(layer.assetId, (attempts.get(layer.assetId) ?? 0) + 1);
    try {
      const url = await thumbnail(layer.id);
      if (alive && url) {
        cache.set(layer.assetId, url);
        key = '';
        if (view) render(view);
      }
    } catch {
      /* Missing or disconnected media keeps a format icon. */
    } finally {
      busy = false;
      if (alive)
        timer = setTimeout(() => {
          void previews();
        }, 200);
    }
  }
  function render(next: EditorView) {
    view = next;
    const assets = [...new Map(next.images.map((item) => [item.assetId, item])).values()];
    const ids = new Set(assets.map((item) => item.assetId));
    for (const id of cache.keys()) if (!ids.has(id)) cache.delete(id);
    for (const id of attempts.keys()) if (!ids.has(id)) attempts.delete(id);
    const nextKey = JSON.stringify(assets.map((item) => [item.id, item.assetId, item.name]));
    if (key !== nextKey) {
      key = nextKey;
      root.replaceChildren();
      if (!assets.length) {
        const hint = doc.createElement('p');
        hint.className = 'library-empty';
        hint.textContent = '＋から素材を追加\nファイルのドロップも使えます';
        root.append(hint);
      }
      assets.forEach((item) => {
        const button = doc.createElement('button');
        button.type = 'button';
        button.className = 'library-asset';
        button.dataset.layer = item.id;
        button.title = item.name;
        button.setAttribute('aria-label', `素材：${item.name}`);
        const preview = doc.createElement('span');
        preview.className = 'thumbnail';
        const url = cache.get(item.assetId);
        if (url) {
          const img = doc.createElement('img');
          img.src = url;
          img.alt = '';
          preview.append(img);
        } else
          preview.innerHTML = glyph(
            item.kind === 'model3d' ? 'model3d' : item.kind === 'animation' ? 'animation' : 'image',
          );
        const name = doc.createElement('span');
        name.className = 'asset-name';
        name.textContent = item.name;
        const kind = doc.createElement('small');
        kind.textContent =
          item.kind === 'animation'
            ? item.format.toUpperCase()
            : item.kind === 'model3d'
              ? `3D · ${item.source.format.toUpperCase()}`
              : '画像';
        button.append(preview, name, kind);
        button.addEventListener('click', () => select(item.id));
        root.append(button);
      });
    }
    root.querySelectorAll<HTMLButtonElement>('[data-layer]').forEach((button) => {
      button.disabled = next.saving;
      button.toggleAttribute('data-selected', next.selectedIds.includes(button.dataset.layer!));
    });
    if (!busy) {
      clearTimeout(timer);
      timer = setTimeout(() => {
        void previews();
      }, 0);
    }
  }
  const visibility = () => {
    if (!doc.hidden) void previews();
  };
  doc.addEventListener('visibilitychange', visibility);
  return {
    render,
    destroy() {
      alive = false;
      clearTimeout(timer);
      cache.clear();
      doc.removeEventListener('visibilitychange', visibility);
    },
  };
}
