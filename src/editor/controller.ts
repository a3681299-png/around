import { emptyDesign, parseDesign, sameDesign } from '../design/schema';
import type { DesignDocument, DesignTarget, SurfaceStyle } from '../design/types';
import type { SiteAdapter } from '../sites/types';
import { readDesign, saveDesign, watchDesign } from '../storage/designs';
import { createCreatorPanel } from './panel';
import type { OpenEditorResponse } from './messages';

export interface CreatorEditor {
  open(): OpenEditorResponse;
  setEnabled(enabled: boolean): void;
  refreshSelection(): void;
  reload(): void;
  destroy(): void;
}

const PICK_EVENTS = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'auxclick', 'dblclick'] as const;
const SELECTION_CSS = `
html[data-ww-editing] [data-ww-surface~="video-card"] { cursor: crosshair !important; }
html[data-ww-editing] [data-ww-editor-selected] { outline: 2px dashed #695089 !important; outline-offset: 3px !important; }`;

/** One tab owns its draft. Only explicit saves cross the storage boundary. */
export function createCreatorEditor(
  doc: Document,
  site: SiteAdapter,
  baseThemeId: string,
  apply: (design: DesignDocument | undefined) => void,
): CreatorEditor {
  let saved: DesignDocument | undefined;
  let draft = emptyDesign(site.id, baseThemeId);
  let pendingSave: DesignDocument | undefined;
  let panel: ReturnType<typeof createCreatorPanel> | undefined;
  let selectionStyle: HTMLStyleElement | undefined;
  let selected: { element: Element; target: DesignTarget } | undefined;
  let enabled = false;
  let loaded = false;
  let dirty = false;
  let saving = false;
  let alive = true;
  let storageEpoch = 0;
  let loadError: string | undefined;
  let status = '';
  let error = false;
  const initial = () => saved ? parseDesign(saved) : emptyDesign(site.id, baseThemeId);
  const applyCurrent = () => apply(panel && dirty ? draft : saved);
  const render = () => panel?.render({
    selected: Boolean(selected),
    style: draft.rules.find((rule) => rule.target === selected?.target.id)?.style ?? {},
    dirty, saving, status, error,
  });
  const clearSelection = () => { selected?.element.removeAttribute('data-ww-editor-selected'); selected = undefined; };

  const close = () => {
    PICK_EVENTS.forEach((event) => doc.removeEventListener(event, onPick, true));
    doc.removeEventListener('keydown', onKeyDown, true);
    clearSelection();
    panel?.destroy();
    panel = undefined;
    selectionStyle?.remove();
    selectionStyle = undefined;
    doc.documentElement.removeAttribute('data-ww-editing');
    draft = initial();
    dirty = false;
    applyCurrent();
  };
  const discard = () => {
    draft = initial();
    dirty = false;
    status = '変更を破棄しました。';
    error = false;
    applyCurrent();
    render();
  };
  const change = (style: SurfaceStyle) => {
    if (!selected || saving) return;
    const next = parseDesign(draft);
    next.rules = next.rules.filter((rule) => rule.target !== selected!.target.id);
    if (Object.keys(style).length > 0) next.rules.push({ kind: 'surface-style', target: selected.target.id, style });
    draft = parseDesign(next);
    dirty = !sameDesign(draft, initial());
    status = dirty ? 'このタブでプレビュー中です。保存すると各タブに反映します。' : '保存済みの見た目です。';
    error = false;
    applyCurrent();
    render();
  };

  const accept = (incoming: DesignDocument | undefined) => {
    // Validate support before changing session state; unsupported data stays on disk.
    const previous = saved;
    apply(incoming);
    saved = incoming;
    storageEpoch++;
    loaded = true;
    loadError = undefined;
    if (pendingSave && sameDesign(incoming, pendingSave)) {
      draft = initial();
      dirty = false;
    } else if (!dirty) {
      draft = initial();
      if (panel) { status = '保存済みのデザインを読み込みました。'; error = false; }
    } else if (!sameDesign(previous, incoming)) {
      status = '別のタブで保存されました。プレビューは保持しています。保存すると上書きし、破棄すると最新の保存値に戻ります。';
      error = true;
    }
    applyCurrent();
    render();
  };
  const onStorageError = (reason: unknown) => {
    loaded = true;
    loadError = reason instanceof Error ? reason.message : 'デザインを読み込めませんでした。';
    saved = undefined;
    close();
  };
  const save = async () => {
    if (!dirty || saving) return;
    const snapshot = parseDesign(draft);
    pendingSave = snapshot;
    saving = true;
    status = '保存しています…';
    error = false;
    render();
    try {
      await saveDesign(snapshot);
      const epoch = storageEpoch;
      const latest = await readDesign(site.id);
      if (!alive) return;
      // A newer notification beats a read that was already in flight.
      if (epoch === storageEpoch) accept(latest);
      status = sameDesign(saved, snapshot) ? '保存しました。' : '別のタブの新しい保存値を読み込みました。';
      error = false;
    } catch {
      if (!alive) return;
      status = '保存できませんでした。プレビューを保持しています。もう一度保存してください。';
      error = true;
    } finally {
      pendingSave = undefined;
      saving = false;
      if (alive) render();
    }
  };

  function pickTarget(event: Event): { element: Element; target: DesignTarget } | undefined {
    if (!panel || event.composedPath().includes(panel.host)) return undefined;
    const node = event.target instanceof Element ? event.target : undefined;
    for (const target of site.designTargets ?? []) {
      const element = node?.closest(`[data-ww-surface~="${target.surface}"]`);
      if (element) return { element, target };
    }
    return undefined;
  }
  function onPick(event: Event) {
    const target = pickTarget(event);
    if (!target || ('button' in event && event.button === 2)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.type !== 'click' && event.type !== 'auxclick') return;
    clearSelection();
    selected = target;
    target.element.setAttribute('data-ww-editor-selected', '');
    status = dirty ? 'この種類のカードを編集中です。' : 'プロパティを変更すると、このタブでプレビューします。';
    error = false;
    render();
  }
  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape' && !saving) {
      event.preventDefault();
      event.stopImmediatePropagation();
      close();
    } else if ((event.key === 'Enter' || event.key === ' ') && pickTarget(event)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const target = pickTarget(event)!;
      clearSelection();
      selected = target;
      target.element.setAttribute('data-ww-editor-selected', '');
      render();
    }
  }

  let unwatch = watchDesign(site.id, accept, onStorageError);
  return {
    open() {
      if (!enabled) return { ok: false, error: 'テーマをONにし、強さを1%以上にしてから編集してください。' };
      if (!loaded) return { ok: false, error: 'デザインを読み込み中です。少し待ってから開いてください。' };
      if (loadError) return { ok: false, error: loadError };
      if (!site.designTargets?.length) return { ok: false, error: 'このサイトには編集できる対象がありません。' };
      if (panel) { panel.focus(); return { ok: true }; }
      draft = initial();
      dirty = false;
      status = '動画カードをクリックして選択してください。';
      error = false;
      panel = createCreatorPanel(doc, {
        change, save: () => { void save(); }, discard, reset: () => change({}), close,
      });
      selectionStyle = doc.createElement('style');
      selectionStyle.id = 'web-world-themes-selection-style';
      selectionStyle.textContent = SELECTION_CSS;
      (doc.head ?? doc.documentElement).append(selectionStyle);
      (doc.body ?? doc.documentElement).append(panel.host);
      doc.documentElement.setAttribute('data-ww-editing', '');
      PICK_EVENTS.forEach((event) => doc.addEventListener(event, onPick, true));
      doc.addEventListener('keydown', onKeyDown, true);
      render();
      panel.focus();
      return { ok: true };
    },
    setEnabled(value) { enabled = value; if (!enabled && panel) close(); },
    refreshSelection() {
      if (selected && (!selected.element.isConnected
        || !selected.element.matches(`[data-ww-surface~="${selected.target.surface}"]`))) {
        clearSelection();
        status = 'ページが変わりました。カードを選び直してください。';
        render();
      }
    },
    reload() { unwatch(); loaded = false; unwatch = watchDesign(site.id, accept, onStorageError); },
    destroy() { alive = false; unwatch(); close(); },
  };
}
