import styles from './workbench.css';
import type { PanelActions, PanelOptions, PanelState } from '../editor/panel';
import { createWorkspace } from '../editor/workspace';
import { buttonIcon } from '../editor/icons';
import { createAssetLibrary } from './asset-library';
import { transientPreferences } from './preferences';
import type { StudioHostLayout } from './layout-types';

/** Arrange shared forms/tree/actions, with an empty center for the actual Host. */
export function createStudioWorkbench(doc: Document, host: HTMLElement, main: HTMLElement, tree: { setActive(active: boolean): void }, actions: PanelActions, options: PanelOptions) {
  const base = createWorkspace(doc, host, main, tree, actions.clearSelection, actions.selectAll, options.preferences ? { preferences: options.preferences } : {});
  const sheet = doc.createElement('style'); sheet.textContent = styles; host.shadowRoot!.append(sheet);
  host.setAttribute('data-workbench', ''); host.toggleAttribute('data-inpage', Boolean(options.inPage)); host.removeAttribute('data-split'); host.toggleAttribute('data-sidepanel', Boolean(options.sidePanel)); host.toggleAttribute('data-page-toolbar', Boolean(options.toolbarOnly));
  const get = <T extends HTMLElement>(selector: string) => main.querySelector<T>(selector)!;
  const body = get('.editor-body'), oldHeader = get('header'), toolbar = get('.toolbar'), footer = get('footer');
  const layers = get('.layers-pane'), inspector = get('.inspector-pane'), help = get('.help-pane'), selection = get('.selection-bar');
  const storage = options.preferences ?? transientPreferences, preferenceKey = options.sidePanel ? 'webWorldThemes.studio.sidepanel.v1' : 'webWorldThemes.studio.workbench.v2';
  let leftWidth = 176, rightWidth = 320, ratio = .56, leftClosed: boolean | undefined, rightClosed: boolean | undefined, allClosed = false, alive = true, touched = false, preferencesReady = false;
  let state: PanelState | undefined, timer: ReturnType<typeof setTimeout> | undefined, layoutKey = '';
  const persist = () => { timer = undefined; void storage.write(preferenceKey, { leftWidth, rightWidth, ratio, leftClosed, rightClosed, dock: host.dataset.wwDock ?? 'right', folds: [...inspector.querySelectorAll<HTMLDetailsElement>('details')].map((item) => [item.className, item.open]) }).catch(() => undefined); };
  const remember = () => { if (!alive) return; touched = true; clearTimeout(timer); timer = setTimeout(persist, 100); };
  const make = (label: string, name: string, action: () => void, key = '') => { const button = doc.createElement('button'); button.type = 'button'; buttonIcon(button, name, label, key); button.addEventListener('click', action); return button; };
  const invoke = (selector: string) => { const button = get<HTMLButtonElement>(selector); if (!button.disabled) button.click(); };

  const menu = doc.createElement('nav'); menu.className = 'studio-menu'; menu.setAttribute('aria-label', 'Studioメニュー');
  const brand = doc.createElement('span'); brand.className = 'studio-brand'; brand.textContent = 'Studio'; menu.append(brand);
  const legacyControls = doc.createElement('div'); legacyControls.className = 'legacy-workspace'; legacyControls.hidden = true; main.append(legacyControls);
  legacyControls.append(oldHeader, get('.workspace-nav'), get('.panel-resize'));
  const helpDialog = doc.createElement('dialog'); helpDialog.className = 'studio-help'; helpDialog.setAttribute('aria-label', 'Studioの使い方'); main.append(helpDialog);
  const closeHelp = make('ヘルプを閉じる', 'close', () => helpDialog.close());
  helpDialog.append(closeHelp, help, get('.quick-guide'));
  const openHelp = () => { help.hidden = false; if (!helpDialog.open) helpDialog.showModal(); };
  const menus: [string, [string, () => void][]][] = [
    ['ファイル', [['画像を追加', () => invoke('.add-image')], ['アニメーションを追加', () => invoke('.add-animation')], ['保存', () => invoke('.save')], ['変更を破棄', () => invoke('.discard')], ['編集を終了', () => invoke('.close')]]],
    ['編集', [['元に戻す', () => invoke('.undo')], ['やり直す', () => invoke('.redo')], ['複製', () => invoke('.duplicate-image')], ['削除', () => invoke('.delete-image')]]],
    ['レイヤー', [['選択をグループ化', () => invoke('.group-layers')], ['グループを解除', () => invoke('.ungroup-layers')], ['すべて選択', actions.selectAll], ['選択解除', actions.clearSelection], ['マスクと振る舞い', () => invoke('.mask-shortcut')]]],
    ['表示', [['素材パネルを開閉', () => toggle('left')], ['プロパティとレイヤーを開閉', () => toggle('right')], ['パネルをまとめて開閉', () => { allClosed = !allClosed; layout(); }], ['左右を入れ替える', () => invoke('.dock')], ['配置をリセット', () => { leftWidth = 176; rightWidth = 320; ratio = .56; leftClosed = rightClosed = undefined; allClosed = false; host.dataset.wwDock = 'right'; layout(); remember(); }]]],
    ['ヘルプ', [['使い方とショートカット', openHelp]]],
  ];
  const menuSources: Record<string, string> = { '画像を追加': 'add-image', 'アニメーションを追加': 'add-animation', '保存': 'save', '変更を破棄': 'discard', '編集を終了': 'close', '元に戻す': 'undo', 'やり直す': 'redo', '複製': 'duplicate-image', '削除': 'delete-image', '選択をグループ化': 'group-layers', 'グループを解除': 'ungroup-layers', 'すべて選択': 'select-all', '選択解除': 'clear-selection', 'マスクと振る舞い': 'mask-shortcut' };
  for (const [title, items] of menus) {
    const details = doc.createElement('details'); details.className = 'studio-menu-item'; const summary = doc.createElement('summary'); summary.textContent = title;
    const popup = doc.createElement('div'); popup.className = 'menu-popup'; popup.setAttribute('role', 'menu');
    for (const [label, action] of items) { const button = doc.createElement('button'); button.type = 'button'; button.textContent = label; button.setAttribute('role', 'menuitem'); if (menuSources[label]) button.dataset.source = menuSources[label]; button.addEventListener('click', () => { details.open = false; action(); }); popup.append(button); }
    details.append(summary, popup); menu.append(details);
    details.addEventListener('toggle', () => { if (details.open) menu.querySelectorAll<HTMLDetailsElement>('details').forEach((item) => { if (item !== details) item.open = false; }); });
  }
  const menuEnd = doc.createElement('div'); menuEnd.className = 'menu-end';
  const dock = get<HTMLButtonElement>('.dock'), close = get<HTMLButtonElement>('.close');
  buttonIcon(dock, 'dock', '左右を入れ替える'); buttonIcon(close, 'close', '編集を終了'); menuEnd.append(dock, make('使い方', 'help', openHelp), close); menu.append(menuEnd);
  const commands: [string, string, string][] = [['undo', 'undo', 'Ctrl+Z'], ['redo', 'redo', 'Ctrl+Shift+Z / Ctrl+Y'], ['save', 'save', ''], ['discard', 'discard', ''], ['add-image', 'image', ''], ['add-animation', 'animation', ''], ['group-layers', 'group', ''], ['ungroup-layers', 'ungroup', ''], ['duplicate-image', 'duplicate', 'Ctrl+D'], ['delete-image', 'delete', 'Delete'], ['select-all', 'select', ''], ['clear-selection', 'close', 'Esc'], ['mask-shortcut', 'mask', '']];
  commands.forEach(([selector, name, shortcut]) => buttonIcon(get<HTMLButtonElement>(`.${selector}`), name, undefined, shortcut, selector === 'group-layers' ? 'グループ化' : selector === 'ungroup-layers' ? '解除' : ''));
  const tools = get('.interaction-tools');
  const undo = get('.undo'), redo = get('.redo'), dirty = get('.dirty'), save = get('.save'), discard = get('.discard');
  const connection = doc.createElement('slot'); connection.name = 'connection'; connection.className = 'studio-connection';
  const target = doc.createElement('span'); target.className = 'canvas-target'; target.textContent = (options.hostLabel ?? 'Webサイト') + (options.inPage ? ' / ライブ' : ' / 対象');
  const toggleLeft = make('素材パネルを開閉', 'image', () => toggle('left')), toggleRight = make('プロパティとレイヤーを開閉', 'dock', () => toggle('right'));
  const minimize = get<HTMLButtonElement>('.minimize'); buttonIcon(minimize, 'collapse', 'パネルをまとめて開閉'); minimize.hidden = true;
  const hideAll = make('パネルをまとめて開閉', 'collapse', () => { allClosed = !allClosed; layout(); });
  toolbar.replaceChildren(undo, redo, save, discard, target, connection, toggleLeft, toggleRight, hideAll);

  const left = doc.createElement('aside'); left.className = 'studio-library'; left.setAttribute('aria-label', 'ツールと素材');
  tools.append(get('.mask-shortcut'));
  const library = doc.createElement('section'); library.className = 'library-pane';
  const libraryHeader = doc.createElement('div'); libraryHeader.className = 'pane-heading'; libraryHeader.innerHTML = '<strong>素材</strong>';
  libraryHeader.append(get('.add-image'), get('.add-animation'));
  const assetList = doc.createElement('div'); assetList.className = 'asset-library'; library.append(libraryHeader, get('.file'), get('.animation-file'), assetList);
  left.append(tools, library); get('.assets').remove();
  const libraryView = createAssetLibrary(doc, assetList, (id) => actions.imageSelect(id), actions.thumbnail);
  const right = doc.createElement('aside'); right.className = 'studio-inspectors'; right.setAttribute('aria-label', 'プロパティとレイヤー');
  const propertyHeader = doc.createElement('div'); propertyHeader.className = 'pane-heading inspector-heading'; propertyHeader.innerHTML = '<strong>プロパティ</strong><span class="object-type">未選択</span>';
  inspector.setAttribute('role', 'region'); inspector.removeAttribute('aria-labelledby'); inspector.setAttribute('aria-label', 'プロパティ');
  layers.setAttribute('role', 'region'); layers.removeAttribute('aria-labelledby'); layers.setAttribute('aria-label', 'レイヤー');
  help.removeAttribute('role'); help.removeAttribute('aria-labelledby');
  inspector.prepend(propertyHeader);
  const layerHeader = doc.createElement('div'); layerHeader.className = 'pane-heading layer-heading'; layerHeader.innerHTML = '<strong>レイヤー</strong>';
  layerHeader.append(get('.layer-count'), get('.selected-count'), get('.select-all'), get('.clear-selection'));
  const layerCommands = get('.selection-actions'); layerCommands.setAttribute('aria-label', 'レイヤーの操作');
  layers.prepend(layerHeader); layers.append(layerCommands, get('.grouping-help'), get('.ungroup-help'));
  const sourceSelection = get('.selection'); sourceSelection.hidden = true; selection.hidden = true; legacyControls.append(selection);
  get('.inspect').hidden = true;
  const divider = doc.createElement('div'); divider.className = 'inspector-divider'; divider.tabIndex = 0; divider.setAttribute('role', 'separator'); divider.setAttribute('aria-label', 'プロパティとレイヤーの高さ'); divider.setAttribute('aria-orientation', 'horizontal');
  right.append(inspector, divider, layers);
  const canvas = doc.createElement('section'); canvas.className = 'canvas-slot'; canvas.setAttribute('aria-label', 'ライブキャンバス');
  const leftResize = resize('素材パネルの幅', 'left'), rightResize = resize('パネルの幅', 'right');
  body.replaceChildren(left, leftResize, canvas, rightResize, right);
  const status = get('.status'), connectionStatus = doc.createElement('slot'); connectionStatus.name = 'connection-status';
  const localConnection = doc.createElement('span'); localConnection.className = 'local-connection'; if (options.inPage) connectionStatus.append(localConnection);
  const dimensions = doc.createElement('span'); dimensions.className = 'canvas-dimensions';
  footer.replaceChildren(connectionStatus, dirty, status, dimensions);
  const contextMenu = get('.context-menu'); main.replaceChildren(menu, toolbar, body, footer, contextMenu, helpDialog, legacyControls);
  // Long explanations live in Help; the selected object keeps its actual controls.
  inspector.querySelectorAll<HTMLElement>('.hint:not(.playback-help)').forEach((node) => { node.hidden = true; });
  get('.inspector-empty').textContent = '未選択';
  function enforce() {
    layers.hidden = inspector.hidden = false; get('.inspect').hidden = true; selection.hidden = true; sourceSelection.hidden = true;
    get('.layers-section').hidden = false; get('.mask-shortcut').hidden = false; get<HTMLButtonElement>('.mask-shortcut').disabled ||= !state?.image;
    get('.group-layers').hidden = state?.image?.kind === 'group'; get('.grouping-help').hidden = !(state && state.selectedIds.length > 1 && state.groupingReason);
    get('.ungroup-help').hidden = !(state?.image?.kind === 'group' && (state.image.locked || state.image.opacity !== 1));
    menu.querySelectorAll<HTMLButtonElement>('[data-source]').forEach((button) => { const source = get<HTMLButtonElement>('.' + button.dataset.source); button.disabled = source.disabled || Boolean(source.hidden); });
    help.hidden = !helpDialog.open; get('.inspector-empty').hidden = true;
    tree.setActive(!options.toolbarOnly && !host.hasAttribute('data-right-closed') && !allClosed && !host.hasAttribute('data-fullscreen'));
  }
  function toggle(side: 'left' | 'right') { allClosed = false; if (side === 'left') leftClosed = !host.hasAttribute('data-left-closed'); else rightClosed = !host.hasAttribute('data-right-closed'); layout(); remember(); }
  function layout() {
    if (!alive) return;
    const width = doc.defaultView!.innerWidth, flip = host.dataset.wwDock === 'left' && width >= 860;
    const fallback = host.hasAttribute('data-layout-fallback');
    const lc = options.sidePanel ? false : fallback || allClosed || (leftClosed ?? width < 1100), rc = options.sidePanel ? false : fallback || allClosed || (rightClosed ?? width < 860);
    const l = lc ? 36 : leftWidth, r = rc ? 0 : rightWidth, overlay = !options.sidePanel && width - l - r < 480;
    host.toggleAttribute('data-left-closed', lc); host.toggleAttribute('data-right-closed', rc); host.toggleAttribute('data-overlay-right', overlay);
    host.toggleAttribute('data-dock-flip', flip);
    host.style.setProperty('--right-divider-width', r && !overlay ? '4px' : '0px');
    host.style.setProperty('--library-width', `${l}px`); host.style.setProperty('--inspector-width', `${r}px`); host.style.setProperty('--panel-width', `${rightWidth}px`); host.style.setProperty('--inspector-ratio', `${Math.round(ratio * 10000) / 100}%`);
    leftResize.setAttribute('aria-valuenow', String(leftWidth)); rightResize.setAttribute('aria-valuenow', String(rightWidth)); divider.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
    toggleLeft.setAttribute('aria-pressed', String(!lc)); toggleRight.setAttribute('aria-pressed', String(!rc)); hideAll.setAttribute('aria-pressed', String(allClosed));
    const reservedRight = overlay || !r ? 0 : r + 4, insets = { left: flip ? reservedRight : l + 4, right: flip ? l + 4 : reservedRight, top: 56, bottom: 24 };
    const next = JSON.stringify(insets); if (next !== layoutKey) { layoutKey = next; options.onLayout?.(insets); }
    enforce();
  }
  function resize(label: string, side: 'left' | 'right') {
    const element = doc.createElement('div'); element.className = `studio-resize resize-${side}`; element.tabIndex = 0; element.setAttribute('role', 'separator'); element.setAttribute('aria-label', label); element.setAttribute('aria-orientation', 'vertical'); element.setAttribute('aria-valuemin', side === 'left' ? '120' : '280'); element.setAttribute('aria-valuemax', side === 'left' ? '260' : '440');
    let gesture: { x: number; start: number; pointer: number } | undefined;
    const change = (value: number) => { if (side === 'left') leftWidth = Math.max(120, Math.min(260, value)); else rightWidth = Math.max(280, Math.min(440, value)); layout(); };
    element.addEventListener('pointerdown', (event) => { if (event.button !== 0) return; gesture = { x: event.clientX, start: side === 'left' ? leftWidth : rightWidth, pointer: event.pointerId }; element.setPointerCapture(event.pointerId); event.preventDefault(); });
    element.addEventListener('pointermove', (event) => { if (gesture) change(gesture.start + (side === 'left' ? 1 : -1) * (host.dataset.wwDock === 'left' ? -1 : 1) * (event.clientX - gesture.x)); });
    const end = () => { if (gesture) remember(); gesture = undefined; }; element.addEventListener('pointerup', end); element.addEventListener('pointercancel', end); element.addEventListener('lostpointercapture', end);
    element.addEventListener('keydown', (event) => { if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { change((side === 'left' ? leftWidth : rightWidth) + (event.key === 'ArrowRight' ? 20 : -20)); remember(); event.preventDefault(); event.stopPropagation(); } }); return element;
  }
  const surfaces = doc.createElement('div'); surfaces.className = 'surface-actions';
  for (const [surface, label, icon] of [['sidepanel', 'Chromeサイドパネルを開く', 'dock'], ['inpage', '従来のインページStudioへ切替', 'external'], ['window', '独立Studioへ切替', 'external']] as const) {
    if (surface === 'sidepanel' && options.sidePanel || surface === 'inpage' && options.inPage || !options.onSurface) continue;
    surfaces.append(make(label, icon, () => options.onSurface?.(surface)));
  }
  menuEnd.prepend(surfaces);
  if (options.sidePanel || options.toolbarOnly) {
    toolbar.replaceChildren(undo, redo, save, discard, get('.add-image'), get('.add-animation'));
    if (options.sidePanel) toolbar.append(tools);
    dock.hidden = true; toggleLeft.hidden = toggleRight.hidden = hideAll.hidden = true;
    if (options.toolbarOnly) {
      toolbar.append(tools, surfaces, dirty, close); menu.hidden = true; footer.hidden = true;
    }
  }
  let heightGesture: { y: number; ratio: number } | undefined;
  divider.addEventListener('pointerdown', (event) => { if (event.button !== 0) return; heightGesture = { y: event.clientY, ratio }; divider.setPointerCapture(event.pointerId); event.preventDefault(); });
  divider.addEventListener('pointermove', (event) => { if (heightGesture) { ratio = Math.max(.25, Math.min(.75, heightGesture.ratio + (event.clientY - heightGesture.y) / Math.max(1, right.clientHeight))); layout(); } });
  const endHeight = () => { if (heightGesture) remember(); heightGesture = undefined; }; divider.addEventListener('pointerup', endHeight); divider.addEventListener('pointercancel', endHeight);
  divider.addEventListener('keydown', (event) => { if (['ArrowUp', 'ArrowDown'].includes(event.key)) { ratio = Math.max(.25, Math.min(.75, ratio + (event.key === 'ArrowDown' ? .05 : -.05))); layout(); remember(); event.preventDefault(); event.stopPropagation(); } });
  main.addEventListener('click', () => queueMicrotask(() => { if (alive) enforce(); }));
  function closeMenus(event: Event) { menu.querySelectorAll<HTMLDetailsElement>('details[open]').forEach((item) => { if (!event.composedPath().includes(item)) item.open = false; }); }
  function menuKeys(event: KeyboardEvent) {
    const opened = menu.querySelector<HTMLDetailsElement>('details[open]');
    if (opened && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) && event.composedPath().includes(menu)) {
      const items = [...opened.querySelectorAll<HTMLButtonElement>('.menu-popup button:not(:disabled)')], current = items.indexOf(host.shadowRoot?.activeElement as HTMLButtonElement);
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[index]?.focus(); event.preventDefault(); event.stopImmediatePropagation();
    }
    if (opened && event.key === 'Escape') { opened.open = false; opened.querySelector('summary')!.focus(); event.preventDefault(); event.stopImmediatePropagation(); }
  }
  doc.addEventListener('pointerdown', closeMenus, true); doc.addEventListener('keydown', menuKeys, true); doc.defaultView!.addEventListener('resize', layout);
  layout();
  inspector.querySelectorAll('details').forEach((item) => item.addEventListener('toggle', () => { if (preferencesReady) remember(); }));
  void storage.read(preferenceKey).then((raw) => {
    if (!alive || touched || !raw || typeof raw !== 'object') return;
    const value = raw as Record<string, unknown>;
    if (typeof value.leftWidth === 'number' && Number.isFinite(value.leftWidth)) leftWidth = Math.max(120, Math.min(260, value.leftWidth));
    if (typeof value.rightWidth === 'number' && Number.isFinite(value.rightWidth)) rightWidth = Math.max(280, Math.min(440, value.rightWidth));
    if (typeof value.ratio === 'number' && Number.isFinite(value.ratio)) ratio = Math.max(.25, Math.min(.75, value.ratio));
    if (typeof value.leftClosed === 'boolean') leftClosed = value.leftClosed; if (typeof value.rightClosed === 'boolean') rightClosed = value.rightClosed;
    if (value.dock === 'left' || value.dock === 'right') host.dataset.wwDock = value.dock;
    if (Array.isArray(value.folds)) for (const entry of value.folds) {
      if (!Array.isArray(entry) || typeof entry[0] !== 'string' || typeof entry[1] !== 'boolean') continue;
      [...inspector.querySelectorAll<HTMLDetailsElement>('details')].find((item) => item.className === entry[0])?.toggleAttribute('open', entry[1]);
    }
    layout();
  }, () => undefined).finally(() => { preferencesReady = true; });
  return {
    layoutChanged() { buttonIcon(dock, 'dock', '左右を入れ替える'); layout(); remember(); },
    inspect() { base.inspect(); enforce(); }, context: base.context,
    render(next: PanelState) {
      state = next; base.render(next); enforce(); if (!options.sidePanel && !options.toolbarOnly) libraryView.render(next);
      get('.object-type').textContent = next.image ? next.image.kind === 'group' ? 'グループ' : next.image.kind === 'animation' ? next.image.format.toUpperCase() : '画像' : next.selected ? '動画カード' : next.selectedIds.length > 1 ? `${next.selectedIds.length}個選択` : '未選択';
      get('.status').title = next.status;
      inspector.querySelector<HTMLElement>('[aria-label="マスクと振る舞い"]')!.hidden = !next.image;
      inspector.querySelector<HTMLElement>('.multi-help')!.hidden = next.selectedIds.length < 2;
    },
    setHostLayout(value: StudioHostLayout) {
      if (value.mode === 'fullscreen') { if (helpDialog.open) helpDialog.close(); menu.querySelectorAll<HTMLDetailsElement>('details').forEach((item) => { item.open = false; }); contextMenu.hidden = true; }
      host.toggleAttribute('data-fullscreen', value.mode === 'fullscreen'); host.toggleAttribute('data-layout-fallback', value.mode === 'unavailable'); layout(); localConnection.textContent = (options.hostLabel ?? 'Webサイト') + (value.mode === 'reserved' ? ' · 接続中' : value.mode === 'fullscreen' ? ' · 全画面' : ' · レイアウト待機'); dimensions.textContent = `${Math.round(value.canvas.width)} × ${Math.round(value.canvas.height)}`; dimensions.title = value.mode === 'fullscreen' ? '全画面は動画操作を優先します' : 'ライブキャンバスの作業範囲'; enforce(); },
    destroy() { alive = false; clearTimeout(timer); if (timer !== undefined) persist(); base.destroy(); libraryView.destroy(); if (helpDialog.open) helpDialog.close(); doc.removeEventListener('pointerdown', closeMenus, true); doc.removeEventListener('keydown', menuKeys, true); doc.defaultView!.removeEventListener('resize', layout); sheet.remove(); },
  };
}
