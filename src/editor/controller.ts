import { emptyDesign, parseDesign, sameDesign } from '../design/schema';
import { IMAGE_LIMITS, type DesignDocument, type DesignTarget, type SurfaceStyle, type ImagePatch } from '../design/types';
import type { ImageEditing } from '../design/image-renderer';
import { editableSamples, placementFrame } from '../design/frames';
import { moveGroup, movePlacement, reanchorPlacement, type PlacementChange } from '../design/geometry';
import { alignSamples, distributeSamples, type Alignment, type Distribution } from '../design/layout';
import { commitDesign, importAssets, releaseAssets, retainAssets } from '../assets/client';
import type { SiteAdapter } from '../sites/types';
import { readDesign, watchDesign } from '../storage/designs';
import { createCreatorPanel } from './panel';
import type { OpenEditorResponse } from './messages';
import { createHistory } from './history';
import { deleteLayers, duplicateLayers, reorderLayers, selectLayer } from './layers';

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
  editImages: (editing: ImageEditing | undefined) => void,
  validate: (design: DesignDocument | undefined) => void,
): CreatorEditor {
  let saved: DesignDocument | undefined;
  let draft = emptyDesign(site.id, baseThemeId);
  let pendingSave: DesignDocument | undefined;
  let panel: ReturnType<typeof createCreatorPanel> | undefined;
  let selectionStyle: HTMLStyleElement | undefined;
  let selected: { element: Element; target: DesignTarget } | undefined;
  let selectedImageIds: string[] = [];
  let interactionEpoch = 0;
  let snapping = false;
  const history = createHistory<DesignDocument>(parseDesign, sameDesign);
  let assetSession: string | undefined;
  let leased = '';
  let importEpoch = 0;
  let importing = false;
  let leaseQueue: Promise<void> = Promise.resolve();
  const deferredReleases = new Set<string>();
  let enabled = false;
  let loaded = false;
  let dirty = false;
  let saving = false;
  let alive = true;
  let storageEpoch = 0;
  let loadError: string | undefined;
  let status = '';
  let error = false;
  const consumedKeys = new Set<string>();
  const initial = () => saved ? parseDesign(saved) : emptyDesign(site.id, baseThemeId);
  const applyCurrent = () => apply(panel && dirty ? draft : saved);
  const render = () => {
    selectedImageIds = selectedImageIds.filter((id) => draft.decorations.some((image) => image.id === id));
    panel?.render({
      selected: Boolean(selected),
      style: draft.rules.find((rule) => rule.target === selected?.target.id)?.style ?? {},
      dirty, saving: saving || importing, status, error, images: draft.decorations,
      selectedIds: selectedImageIds,
      image: selectedImageIds.length === 1 ? draft.decorations.find((image) => image.id === selectedImageIds[0]) : undefined,
      canUndo: history.canUndo, canRedo: history.canRedo, snapping,
    });
    editImages(panel ? { selectedIds: selectedImageIds, locked: saving || importing, epoch: interactionEpoch, snapping, select: selectImage,
      begin: () => history.begin(draft), change: changePlacements, end: finishGesture,
      error: (message) => { status = message; error = true; render(); },
    } : undefined);
  };
  const clearSelection = () => { selected?.element.removeAttribute('data-ww-editor-selected'); selected = undefined; };
  const syncAssets = (): Promise<void> => {
    const session = assetSession;
    if (!session) return Promise.resolve();
    const ids = [...new Set([draft, ...history.values()].flatMap((value) => value.decorations.map((image) => image.assetId)))];
    const key = ids.sort().join(',');
    leaseQueue = leaseQueue.catch(() => undefined).then(async () => {
      if (session !== assetSession || leased === key) return;
      await retainAssets(session, ids);
      if (session === assetSession) leased = key;
    });
    return leaseQueue;
  };
  const settleAssets = () => { void syncAssets().catch((reason: unknown) => {
    if (!panel) return;
    status = reason instanceof Error ? reason.message : '素材を保持できませんでした。'; error = true; render();
  }); };
  const updateDraft = (next: DesignDocument, record = true) => {
    const parsed = parseDesign(next);
    if (record) history.record(draft, parsed);
    draft = parsed;
    dirty = !sameDesign(draft, initial());
    status = dirty ? 'このタブでプレビュー中です。保存すると各タブに反映します。' : '保存済みの見た目です。';
    error = false;
    applyCurrent(); render();
  };
  function selectImage(id: string, additive = false, preserve = false) {
    if (!panel || saving || importing || !draft.decorations.some((image) => image.id === id)) return;
    clearSelection(); selectedImageIds = selectLayer(selectedImageIds, id, additive, preserve);
    status = 'Ctrl／Shiftで複数選択。矢印で微調整、Ctrl＋Dで複製できます。'; error = false; render();
  }
  function changeImage(id: string, patch: ImagePatch) {
    if (!panel || saving || importing) return;
    const current = draft.decorations.find((image) => image.id === id);
    if (!current || (current.locked && Object.keys(patch).some((key) => !['locked', 'visible', 'name'].includes(key)))) return;
    if (patch.placement?.anchor) {
      const from = placementFrame(doc, site.decorationAnchors ?? [], current.placement);
      const to = placementFrame(doc, site.decorationAnchors ?? [], { ...current.placement, anchor: patch.placement.anchor });
      if (!from || !to) { status = '配置基準が画面に見つかりません。'; error = true; render(); return; }
      patch = { ...patch, placement: reanchorPlacement(current.placement, from, to, patch.placement.anchor) };
    }
    const next = parseDesign(draft);
    next.decorations = next.decorations.map((image) => image.id === id ? { ...image, ...patch, placement: { ...image.placement, ...patch.placement } } : image);
    updateDraft(next);
  }
  function changePlacements(changes: readonly PlacementChange[]) {
    if (!panel || saving || importing) return;
    const next = parseDesign(draft);
    const placements = new Map(changes.map((change) => [change.id, change.placement]));
    next.decorations = next.decorations.map((image) => !image.locked && placements.has(image.id) ? { ...image, placement: placements.get(image.id)! } : image);
    updateDraft(next);
  }
  function finishGesture(cancel = false) {
    if (!history.active) return;
    interactionEpoch++;
    if (cancel) { const before = history.cancel(); if (before) updateDraft(before, false); }
    else { history.commit(draft); render(); }
    settleAssets();
  }
  const undoRedo = (redo: boolean) => {
    if (saving || importing) return;
    if (history.active) { finishGesture(true); return; }
    const next = redo ? history.redo(draft) : history.undo(draft);
    if (next) { interactionEpoch++; updateDraft(next, false); settleAssets(); }
  };
  const deleteImage = (id?: string) => {
    if (saving || importing) return;
    finishGesture();
    const next = parseDesign(draft);
    next.decorations = deleteLayers(next.decorations, id ? [id] : selectedImageIds);
    updateDraft(next); settleAssets();
  };
  const duplicate = (id?: string) => {
    if (saving || importing) return;
    finishGesture();
    try {
      const next = parseDesign(draft);
      const result = duplicateLayers(next.decorations, id ? [id] : selectedImageIds, () => `image-${crypto.randomUUID()}`, (layer) => {
        const frame = placementFrame(doc, site.decorationAnchors ?? [], layer.placement);
        return frame ? movePlacement(layer.placement, frame, { x: 16, y: 16 }) : { ...layer.placement };
      });
      if (!result.ids.length) return;
      next.decorations = result.layers; selectedImageIds = result.ids;
      clearSelection(); updateDraft(next); settleAssets();
    } catch (reason) { status = reason instanceof Error ? reason.message : '複製できませんでした。'; error = true; render(); }
  };
  const layoutSelection = (mode: Alignment | Distribution) => {
    if (saving || importing) return;
    finishGesture();
    const samples = editableSamples(doc, site.decorationAnchors ?? [], draft.decorations, selectedImageIds);
    const distribution = mode === 'horizontal' || mode === 'vertical';
    if (samples.length < (distribution ? 3 : 2)) { status = '表示中でロックされていないレイヤーを選択してください。'; error = true; render(); return; }
    try { changePlacements(distribution ? distributeSamples(samples, mode) : alignSamples(samples, mode)); }
    catch (reason) { status = reason instanceof Error ? reason.message : '整列できませんでした。'; error = true; render(); }
  };
  const addImages = async (files: readonly File[], point?: { x: number; y: number }) => {
    if (!panel || !assetSession || saving || importing || !files.length) return;
    if (draft.decorations.length + files.length > IMAGE_LIMITS.count) { status = '画像は32枚まで配置できます。'; error = true; render(); return; }
    const epoch = importEpoch;
    const importSession = `session-${crypto.randomUUID()}`;
    let before: DesignDocument | undefined;
    const previousSelection = [...selectedImageIds];
    importing = true; status = '画像を読み込んでいます…'; error = false; render();
    try {
      const assets = await importAssets(files, importSession);
      if (epoch !== importEpoch || !panel) return;
      before = parseDesign(draft);
      const next = parseDesign(draft);
      const view = doc.defaultView!;
      assets.forEach((asset, index) => {
        const scale = Math.max(IMAGE_LIMITS.minSize / Math.min(asset.width, asset.height), Math.min(260 / asset.width, 200 / asset.height, view.innerWidth * .28 / asset.width, view.innerHeight * .3 / asset.height));
        const id = `image-${crypto.randomUUID()}`;
        next.decorations.push({ kind: 'image', id, assetId: asset.id, name: asset.name,
          placement: { anchor: { kind: 'viewport' }, x: Math.min(.95, Math.max(.05, (point?.x ?? view.innerWidth * .45) / view.innerWidth + index * 24 / view.innerWidth)),
            y: Math.min(.95, Math.max(.05, (point?.y ?? view.innerHeight * .45) / view.innerHeight + index * 24 / view.innerHeight)),
            widthPx: Math.round(asset.width * scale * 10) / 10, heightPx: Math.round(asset.height * scale * 10) / 10, rotationDeg: 0 },
          opacity: 1, zIndex: Math.min(100, next.decorations.length), visible: true, locked: false });
        selectedImageIds = [id];
      });
      clearSelection(); updateDraft(next, false);
      leased = ''; await syncAssets();
      if (epoch !== importEpoch || !panel) return;
      history.record(before, draft); settleAssets();
    } catch (reason) {
      if (epoch !== importEpoch || !panel) return;
      if (before) { selectedImageIds = previousSelection; updateDraft(before, false); }
      status = reason instanceof Error ? reason.message : '画像を読み込めませんでした。'; error = true;
      leased = ''; settleAssets();
    } finally {
      void releaseAssets(importSession).catch(() => undefined);
      if (epoch === importEpoch) { importing = false; render(); }
    }
  };

  const close = () => {
    importEpoch++;
    importing = false;
    if (assetSession) {
      if (saving) deferredReleases.add(assetSession);
      else void releaseAssets(assetSession).catch(() => undefined);
      assetSession = undefined;
    }
    leased = ''; selectedImageIds = []; interactionEpoch++; history.reset();
    PICK_EVENTS.forEach((event) => doc.removeEventListener(event, onPick, true));
    doc.removeEventListener('keydown', onKeyDown, true);
    doc.removeEventListener('keyup', onKeyUp, true);
    consumedKeys.clear();
    doc.removeEventListener('dragover', onDragOver, true);
    doc.removeEventListener('drop', onDrop, true);
    clearSelection();
    panel?.destroy();
    panel = undefined;
    selectionStyle?.remove();
    selectionStyle = undefined;
    doc.documentElement.removeAttribute('data-ww-editing');
    draft = initial();
    dirty = false;
    applyCurrent();
    editImages(undefined);
  };
  const discard = () => {
    history.reset(); interactionEpoch++;
    draft = initial();
    dirty = false;
    status = '変更を破棄しました。';
    error = false;
    applyCurrent();
    render();
    settleAssets();
  };
  const change = (style: SurfaceStyle) => {
    if (!selected || saving || importing) return;
    const next = parseDesign(draft);
    next.rules = next.rules.filter((rule) => rule.target !== selected!.target.id);
    if (Object.keys(style).length > 0) next.rules.push({ kind: 'surface-style', target: selected.target.id, style });
    updateDraft(next);
  };

  const accept = (incoming: DesignDocument | undefined) => {
    // Validate support before changing session state; unsupported data stays on disk.
    const previous = saved;
    validate(incoming);
    saved = incoming;
    storageEpoch++;
    loaded = true;
    loadError = undefined;
    if (pendingSave && sameDesign(incoming, pendingSave)) {
      draft = initial();
      dirty = false;
    } else if (!dirty) {
      if (!sameDesign(previous, incoming)) { history.reset(); interactionEpoch++; }
      draft = initial();
      if (panel) { status = '保存済みのデザインを読み込みました。'; error = false; }
    } else if (!sameDesign(previous, incoming)) {
      status = '別のタブで保存されました。プレビューは保持しています。保存すると上書きし、破棄すると最新の保存値に戻ります。';
      error = true;
    }
    applyCurrent();
    render();
    if (panel) settleAssets();
  };
  const onStorageError = (reason: unknown) => {
    loaded = true;
    loadError = reason instanceof Error ? reason.message : 'デザインを読み込めませんでした。';
    saved = undefined;
    close();
  };
  const save = async () => {
    finishGesture();
    if (!dirty || saving || importing || !assetSession) return;
    const saveSession = assetSession;
    const snapshot = parseDesign(draft);
    pendingSave = snapshot;
    saving = true;
    status = '保存しています…';
    error = false;
    render();
    try {
      // Renew the session's complete draft/history lease before crossing the save boundary.
      leased = '';
      await syncAssets();
      await commitDesign(snapshot, saveSession);
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
      deferredReleases.forEach((session) => { void releaseAssets(session).catch(() => undefined); });
      deferredReleases.clear();
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
    if (saving || importing) return;
    if (event.type !== 'click' && event.type !== 'auxclick') return;
    clearSelection();
    selectedImageIds = [];
    selected = target;
    target.element.setAttribute('data-ww-editor-selected', '');
    status = dirty ? 'この種類のカードを編集中です。' : 'プロパティを変更すると、このタブでプレビューします。';
    error = false;
    render();
  }
  function onKeyDown(event: KeyboardEvent) {
    if (!panel || event.isComposing || event.composedPath().some((node) => node instanceof HTMLElement
      && (node.matches('input, textarea, select') || node.isContentEditable))) return;
    const command = (event.ctrlKey || event.metaKey) && !event.altKey;
    const key = event.key.toLowerCase();
    let handled = true;
    if (command && (key === 'z' || key === 'y')) undoRedo(key === 'y' || event.shiftKey);
    else if (command && key === 'd' && selectedImageIds.length) duplicate();
    else if (event.key === 'Delete' && selectedImageIds.length) deleteImage();
    else if (event.key === 'Escape' && !saving && !importing) {
      finishGesture(true); clearSelection(); selectedImageIds = []; render();
    } else if (event.key.startsWith('Arrow') && !command && !event.altKey && selectedImageIds.length) {
      if (!saving && !importing && !history.active) {
        const amount = event.shiftKey ? 10 : 1;
        const delta = { x: event.key === 'ArrowRight' ? amount : event.key === 'ArrowLeft' ? -amount : 0,
          y: event.key === 'ArrowDown' ? amount : event.key === 'ArrowUp' ? -amount : 0 };
        changePlacements(moveGroup(editableSamples(doc, site.decorationAnchors ?? [], draft.decorations, selectedImageIds), delta));
      }
    } else if ((event.key === 'Enter' || event.key === ' ') && pickTarget(event)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const target = pickTarget(event)!;
      clearSelection();
      selectedImageIds = [];
      selected = target;
      target.element.setAttribute('data-ww-editor-selected', '');
      render();
    } else handled = false;
    if (handled) { consumedKeys.add(event.code || event.key); event.preventDefault(); event.stopImmediatePropagation(); }
  }
  function onKeyUp(event: KeyboardEvent) {
    if (!consumedKeys.delete(event.code || event.key)) return;
    event.preventDefault(); event.stopImmediatePropagation();
  }

  function onDragOver(event: DragEvent) {
    if (!panel || !event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault(); event.stopImmediatePropagation(); event.dataTransfer.dropEffect = 'copy';
  }
  function onDrop(event: DragEvent) {
    if (!panel || !event.dataTransfer?.files.length) return;
    event.preventDefault(); event.stopImmediatePropagation();
    void addImages([...event.dataTransfer.files], { x: event.clientX, y: event.clientY });
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
      history.reset(); interactionEpoch++; selectedImageIds = [];
      dirty = false;
      assetSession = `session-${crypto.randomUUID()}`; leased = ''; importEpoch++;
      status = 'カードを選ぶか、画像を追加してください。';
      error = false;
      panel = createCreatorPanel(doc, {
        change, save: () => { void save(); }, discard, reset: () => change({}), close,
        imageImport: (files) => { void addImages(files); }, imageSelect: selectImage,
        imageChange: (patch) => { if (selectedImageIds.length === 1) changeImage(selectedImageIds[0]!, patch); },
        layerChange: changeImage, imageDelete: deleteImage, duplicate,
        reorder: (id, targetId, after) => {
          if (saving || importing) return;
          const next = parseDesign(draft); next.decorations = reorderLayers(next.decorations, id, targetId, after); updateDraft(next);
        },
        undo: () => undoRedo(false), redo: () => undoRedo(true),
        snap: (value) => { snapping = value; render(); }, layout: layoutSelection,
      }, site.decorationAnchors);
      selectionStyle = doc.createElement('style');
      selectionStyle.id = 'web-world-themes-selection-style';
      selectionStyle.textContent = SELECTION_CSS;
      (doc.head ?? doc.documentElement).append(selectionStyle);
      (doc.body ?? doc.documentElement).append(panel.host);
      doc.documentElement.setAttribute('data-ww-editing', '');
      PICK_EVENTS.forEach((event) => doc.addEventListener(event, onPick, true));
      doc.addEventListener('keydown', onKeyDown, true);
      doc.addEventListener('keyup', onKeyUp, true);
      doc.addEventListener('dragover', onDragOver, true);
      doc.addEventListener('drop', onDrop, true);
      render();
      settleAssets();
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
