import type { DesignDocument } from '../design/types';
import type { ImageEditing } from '../design/image-renderer';
import { editableSceneSamples, placementFrame } from '../design/frames';
import type { SiteAdapter } from '../sites/types';
import { createCreatorPanel } from './panel';
import { CLOSE_SIDE_PANEL, OPEN_SIDE_PANEL, OPEN_STUDIO_WINDOW } from './messages';
import { requestStudioSurface } from '../browser/side-panel';
import type { OpenEditorResponse } from './messages';
import { captureLayerThumbnail } from '../renderers/dom/thumbnail';
import { createEditorSession } from '../editor-core/session';
import type { EditCommand, EditorCheckpoint, EditorSnapshot } from '../editor-core/types';
import { shortcutCommand } from '../editor-core/shortcuts';
import { createBrowserEditorStorage, type BrowserImportSource } from '../browser/storage-adapter';
import { browserStudioPreferences } from '../browser/preferences';
import { studioActions } from '../studio/ui-actions';
import type { StudioLayoutAdapter } from '../studio/layout-types';
import type { TimelineHost } from '../host/timeline';
import type { TimelineCommand, TimelineUpdate } from '../timeline/types';

export interface CreatorEditor {
  open(): OpenEditorResponse; openStudio(): OpenEditorResponse; openSidePanel(): OpenEditorResponse; setEnabled(enabled: boolean): void; refreshSelection(): void; reload(): void; destroy(): void;
  snapshot(): EditorSnapshot; checkpoint(): EditorCheckpoint; readonly historyVersion: number;
  subscribe(listener: (state: EditorSnapshot) => void): () => void;
  attachStudio(owner: string, resume?: EditorCheckpoint, handoff?: boolean): Promise<EditorSnapshot>;
  detachStudio(owner: string): void;
  setSidePanelVisible(owner: string, visible: boolean): void;
  timelineSnapshot(): TimelineUpdate | undefined;
  subscribeTimeline(listener: (update: TimelineUpdate) => void): () => void;
  timelineCommand(owner: string, session: string, command: TimelineCommand): Promise<void>;
  command(owner: string, session: string, revision: number, command: EditCommand): Promise<EditorSnapshot>;
  import(owner: string, session: string, revision: number, files: BrowserImportSource): Promise<EditorSnapshot>;
  thumbnail(id: string): Promise<string | undefined>;
}
const PICK_EVENTS = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'auxclick', 'dblclick'] as const;
const SELECTION_CSS = `html[data-ww-editor-card-picking] [data-ww-surface~="video-card"] { cursor:crosshair !important; }
html[data-ww-editing] [data-ww-editor-selected] { outline:2px dashed #695089 !important; outline-offset:3px !important; }`;

/** Browser Host. Core owns documents/history; this adapter owns DOM and rendering. */
export function createCreatorEditor(doc: Document, site: SiteAdapter, baseThemeId: string,
  apply: (design: DesignDocument | undefined) => void, editImages: (editing: ImageEditing | undefined) => void,
  validate: (design: DesignDocument | undefined) => void, timeline?: TimelineHost): CreatorEditor {
  let panel: ReturnType<typeof createCreatorPanel> | undefined, selectionStyle: HTMLStyleElement | undefined, selectedElement: Element | undefined;
  let remoteOwner: string | undefined, badge: HTMLElement | undefined, installed = false, destroyed = false;
  let unprotectToolbar: (() => void) | undefined, sidePanelVisible = false;
  let layout: StudioLayoutAdapter | undefined, panelMode: 'quick' | 'inpage' | 'sidepanel' = 'quick';
  const consumedKeys = new Set<string>();
  let lastDesign = '', geometryKey = '';
  const core = createEditorSession({ siteId: site.id, baseThemeId, targets: site.designTargets ?? [], storage: createBrowserEditorStorage(site.id), validate,
    makeId: (kind) => `${kind}-${crypto.randomUUID()}`,
    geometry: {
      frameFor: (placement) => placementFrame(doc, site.decorationAnchors ?? [], placement),
      samples: (design, ids) => editableSceneSamples(doc, site.decorationAnchors ?? [], design.decorations, design.groups ?? [], ids),
      importFrame(point) {
        const width = doc.defaultView!.innerWidth, height = doc.defaultView!.innerHeight;
        const canvas = layout?.state().canvas, origin = point ?? (canvas ? { x: canvas.left + canvas.width * .5, y: canvas.top + canvas.height * .48 } : { x: width * .45, y: height * .45 });
        const bounds = panel?.host.getBoundingClientRect();
        if (!layout && !point && bounds && origin.x >= bounds.left && origin.x <= bounds.right && origin.y >= bounds.top && origin.y <= bounds.bottom) {
          origin.x = bounds.left >= width - bounds.right ? bounds.left / 2 : bounds.right + (width - bounds.right) / 2;
        }
        return { width, height, origin };
      },
    },
  });
  let state = core.snapshot();
  const editing = () => state.active && Boolean(panel || remoteOwner);
  const fullscreen = () => Boolean(doc.fullscreenElement || layout?.state().mode === 'fullscreen');
  const dispatch = (command: EditCommand) => { void core.execute(command).catch((error: unknown) => {
    if (!destroyed && state.active) core.fail(error instanceof Error ? error.message : '編集操作を実行できませんでした。');
  }); };
  const removeSelection = () => { selectedElement?.removeAttribute('data-ww-editor-selected'); selectedElement = undefined; };
  function bind(active: boolean) {
    if (installed === active) return; installed = active;
    if (active) {
      selectionStyle = doc.createElement('style'); selectionStyle.id = 'web-world-themes-selection-style'; selectionStyle.textContent = SELECTION_CSS;
      (doc.head ?? doc.documentElement).append(selectionStyle); doc.documentElement.setAttribute('data-ww-editing', '');
      PICK_EVENTS.forEach((name) => doc.addEventListener(name, onPick, true));
      doc.addEventListener('keydown', onKeyDown, true); doc.addEventListener('keyup', onKeyUp, true);
      doc.addEventListener('dragover', onDragOver, true); doc.addEventListener('drop', onDrop, true);
      doc.addEventListener('fullscreenchange', onFullscreen);
    } else {
      PICK_EVENTS.forEach((name) => doc.removeEventListener(name, onPick, true));
      doc.removeEventListener('keydown', onKeyDown, true); doc.removeEventListener('keyup', onKeyUp, true);
      doc.removeEventListener('dragover', onDragOver, true); doc.removeEventListener('drop', onDrop, true);
      doc.removeEventListener('fullscreenchange', onFullscreen);
      consumedKeys.clear(); removeSelection(); selectionStyle?.remove(); selectionStyle = undefined; doc.documentElement.removeAttribute('data-ww-editing'); doc.documentElement.removeAttribute('data-ww-editor-tool'); doc.documentElement.removeAttribute('data-ww-editor-card-picking');
    }
  }
  function refresh(next = core.snapshot()) {
    state = next;
    if (!state.active) { if (panelMode === 'sidepanel' && panel) void chrome.runtime.sendMessage({ type: CLOSE_SIDE_PANEL }).catch(() => undefined); if (remoteOwner) timeline?.release(remoteOwner); if (installed) timeline?.resumeLive(); unprotectToolbar?.(); unprotectToolbar = undefined; panel?.destroy(); panel = undefined; layout?.destroy(); layout = undefined; remoteOwner = undefined; sidePanelVisible = false; }
    if (!state.selectedTarget) removeSelection();
    const active = editing(); bind(active);
    if (active) { doc.documentElement.setAttribute('data-ww-editor-tool', state.view.tool ?? 'select'); doc.documentElement.toggleAttribute('data-ww-editor-card-picking', state.view.tool !== 'browse' && (panelMode === 'quick' || state.view.tool === 'card')); }
    if (remoteOwner && state.active && !panel && !badge) {
      badge = doc.createElement('div'); badge.id = 'web-world-themes-studio-link'; badge.setAttribute('data-ww-signal-control', '');
      badge.style.cssText = 'position:fixed;bottom:12px;left:12px;z-index:2147483001;background:#242331;color:white;padding:8px;border:1px solid #baa0f8;border-radius:8px;font:12px system-ui;';
      const label = doc.createElement('span'); label.textContent = 'Studioで編集中 '; const quick = doc.createElement('button'); quick.textContent = 'クイック編集を表示';
      quick.addEventListener('click', () => open()); const stop = doc.createElement('button'); stop.textContent = '編集を終了'; stop.addEventListener('click', () => dispatch({ type: 'close' }));
      badge.append(label, quick, stop); (doc.body ?? doc.documentElement).append(badge);
    } else if (!remoteOwner || !state.active || panel) { badge?.remove(); badge = undefined; }
    const design = active && state.view.dirty ? state.document : state.saved, key = JSON.stringify(design) ?? 'empty';
    if (key !== lastDesign) { lastDesign = key; apply(design); }
    if (panelMode === 'sidepanel') { panel?.host.toggleAttribute('data-fullscreen', fullscreen()); panel?.host.toggleAttribute('data-sidepanel-visible', sidePanelVisible); }
    panel?.render(state.view);
    editImages(active && !fullscreen() && state.view.tool !== 'browse' && state.view.tool !== 'card' ? { selectedIds: state.view.selectedIds, locked: state.view.saving, epoch: core.interactionEpoch, snapping: state.view.snapping,
      select: (id, additive, preserve) => dispatch({ type: 'select', id, additive, preserve }), begin: () => dispatch({ type: 'begin' }),
      change: (changes) => dispatch({ type: 'placements', changes }), end: (cancel = false) => { if (!state.view.saving) dispatch({ type: 'end', cancel }); }, error: (message) => core.fail(message),
    } : undefined);
  }
  const unsubscribe = core.subscribe(refresh);
  function onFullscreen() { refresh(); }
  function open(mode: 'quick' | 'inpage' | 'sidepanel' = 'quick'): OpenEditorResponse {
    if (!site.designTargets?.length) return { ok: false, error: 'このサイトには編集できる対象がありません。' };
    const result = core.open(); if (!result.ok) return result;
    if (panel && mode !== panelMode) { if (panelMode === 'sidepanel') void chrome.runtime.sendMessage({ type: CLOSE_SIDE_PANEL }).catch(() => undefined); unprotectToolbar?.(); unprotectToolbar = undefined; panel.destroy(); panel = undefined; layout?.destroy(); layout = undefined; }
    if (!panel) {
      panelMode = mode;
      if (mode === 'inpage') {
        layout = site.mountStudio?.((value) => { if (panel) { panel.setHostLayout(value); core.refreshGeometry(); } });
        if (!layout) return { ok: false, error: 'このサイトにはStudioの表示領域を確保するAdapterがありません。' };
      }
      panel = createCreatorPanel(doc, studioActions(dispatch, (files) => { void core.import(files); }, (id) => captureLayerThumbnail(doc, id)), site.decorationAnchors,
        { preferences: browserStudioPreferences, timeline: timeline?.port('inline'), hostLabel: site.id === 'youtube' ? 'YouTube' : site.id, inPage: mode === 'inpage', toolbarOnly: mode === 'sidepanel', persistWorkspace: mode === 'inpage', onSurface: (surface) => { if (surface === 'inpage') open('inpage'); else void requestStudioSurface(surface === 'sidepanel' ? OPEN_SIDE_PANEL : OPEN_STUDIO_WINDOW).catch((error: unknown) => core.fail(error instanceof Error ? error.message : 'Studioを開けませんでした。')); }, onLayout: (value) => layout?.update(value) });
      (doc.body ?? doc.documentElement).append(panel.host);
      if (mode === 'sidepanel') unprotectToolbar = site.protectStudioToolbar?.(panel.host);
      if (layout) panel.setHostLayout(layout.state());
    }
    refresh(); panel.focus(); return { ok: true };
  }
  function pickTarget(event: Event) {
    if (!editing() || fullscreen() || state.view.tool === 'browse' || panelMode !== 'quick' && state.view.tool !== 'card'
      || event.composedPath().some((node) => node instanceof Element && node.hasAttribute('data-ww-signal-control'))) return;
    const node = event.target instanceof Element ? event.target : undefined;
    for (const target of site.designTargets ?? []) { const element = node?.closest(`[data-ww-surface~="${target.surface}"]`); if (element) return { element, target }; }
  }
  function onPick(event: Event) {
    const target = pickTarget(event); if (!target || 'button' in event && event.button === 2) return;
    event.preventDefault(); event.stopImmediatePropagation(); if (state.view.saving || !['click', 'auxclick'].includes(event.type)) return;
    removeSelection(); dispatch({ type: 'select-target', target: target.target.id }); selectedElement = target.element; selectedElement.setAttribute('data-ww-editor-selected', '');
  }
  function onKeyDown(event: KeyboardEvent) {
    if (!editing() || fullscreen() || panel?.host.hasAttribute('data-ww-scrubbing') || event.isComposing || event.composedPath().some((node) => node instanceof HTMLElement && (node.hasAttribute('data-ww-timeline-control') || node.matches('input,textarea,select,summary,dialog,[role="tab"],[role="separator"],[role="menuitem"]') || node.isContentEditable))) return;
    if (state.view.tool === 'browse' && !(panel && event.composedPath().includes(panel.host)) && !['v', 'h'].includes(event.key.toLowerCase())) return;
    const command = shortcutCommand(event, state.view, true);
    if (command) dispatch(command);
    else if ((event.key === 'Enter' || event.key === ' ') && pickTarget(event)) {
      const target = pickTarget(event)!; removeSelection(); dispatch({ type: 'select-target', target: target.target.id }); selectedElement = target.element; selectedElement.setAttribute('data-ww-editor-selected', '');
    } else return;
    consumedKeys.add(event.code || event.key); event.preventDefault(); event.stopImmediatePropagation();
  }
  function onKeyUp(event: KeyboardEvent) { if (consumedKeys.delete(event.code || event.key)) { event.preventDefault(); event.stopImmediatePropagation(); } }
  function onDragOver(event: DragEvent) { if (editing() && event.dataTransfer?.types.includes('Files')) { event.preventDefault(); event.stopImmediatePropagation(); event.dataTransfer.dropEffect = 'copy'; } }
  function onDrop(event: DragEvent) {
    if (!editing() || !event.dataTransfer?.files.length) return;
    event.preventDefault(); event.stopImmediatePropagation(); void core.import([...event.dataTransfer.files], panel && event.composedPath().includes(panel.host) ? undefined : { x: event.clientX, y: event.clientY });
  }
  const authorize = (owner: string, session: string, revision: number) => {
    if (owner !== remoteOwner || session !== state.sessionId || revision !== state.revision || !state.active) throw new Error('編集状態が変わりました。最新の状態を同期して、もう一度操作してください。');
  };
  return {
    open: () => open(), openStudio: () => open('inpage'), openSidePanel: () => open('sidepanel'), snapshot: core.snapshot, checkpoint: core.checkpoint, subscribe: core.subscribe, get historyVersion() { return core.historyVersion; },
    setEnabled: core.setEnabled,
    refreshSelection() { if (selectedElement && (!selectedElement.isConnected || !site.designTargets?.some((target) => target.id === state.selectedTarget && selectedElement!.matches(`[data-ww-surface~="${target.surface}"]`)))) {
      removeSelection(); if (state.active) dispatch({ type: 'select-target' });
    }
      if (state.active) {
        const next = JSON.stringify([doc.defaultView!.innerWidth, doc.defaultView!.innerHeight, ...(site.decorationAnchors ?? []).map((target) => {
          const rect = doc.querySelector(`[data-ww-surface~="${target.surface}"]`)?.getBoundingClientRect(); return rect ? [rect.x, rect.y, rect.width, rect.height] : null;
        })]);
        if (next !== geometryKey) { geometryKey = next; core.refreshGeometry(); }
      }
    },
    reload: core.reload,
    async attachStudio(owner, resume, handoff = false) {
      if (remoteOwner && remoteOwner !== owner && !handoff) throw new Error('このYouTubeは別のStudioで編集中です。そちらの接続を解除してください。');
      if (handoff && state.view.saving) throw new Error('保存処理の完了後に切り替えてください。');
      if (handoff && core.gestureActive) await core.execute({ type: 'end', cancel: true });
      const existed = state.active, opened = core.open(); if (!opened.ok) throw new Error(opened.error);
      remoteOwner = owner; sidePanelVisible = false;
      try { if (!existed && resume) await core.restore(resume); refresh(); return core.snapshot(); }
      catch (error) { remoteOwner = undefined; refresh(); throw error; }
    },
    detachStudio(owner) { timeline?.release(owner); if (owner !== remoteOwner) return; timeline?.resumeLive(); remoteOwner = undefined; sidePanelVisible = false; if (core.gestureActive) dispatch({ type: 'end', cancel: true }); refresh(); },
    setSidePanelVisible(owner, visible) { if (owner !== remoteOwner) return; sidePanelVisible = visible; if (panelMode === 'sidepanel') panel?.host.toggleAttribute('data-sidepanel-visible', visible); },
    timelineSnapshot: () => timeline?.snapshot(), subscribeTimeline: (listener) => timeline?.subscribe(listener) ?? (() => undefined),
    async timelineCommand(owner, session, command) { if (owner !== remoteOwner || !state.active || session !== state.sessionId) throw new Error('編集セッションへ再接続してください。'); if (!timeline) throw new Error('このHostは録画に対応していません。'); await timeline.command(owner, command); },
    async command(owner, session, revision, command) { authorize(owner, session, revision); await core.execute(command); return core.snapshot(); },
    async import(owner, session, revision, files) { authorize(owner, session, revision); await core.import(files); return core.snapshot(); },
    thumbnail: (id) => captureLayerThumbnail(doc, id),
    destroy() { destroyed = true; core.destroy(); unsubscribe(); bind(false); unprotectToolbar?.(); panel?.destroy(); layout?.destroy(); badge?.remove(); },
  };
}
