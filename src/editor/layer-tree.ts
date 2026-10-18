import { childrenOf, effectivelyLocked, frontToBack, parentGroup, rootLayers } from '../design/hierarchy';
import type { Decoration, GroupLayer, ImagePatch, LayerNode } from '../design/types';
import { icon } from './icons';

interface TreeState { images: readonly Decoration[]; groups: readonly GroupLayer[]; selectedIds: readonly string[]; saving: boolean }
interface TreeActions {
  select(id: string, additive?: boolean): void;
  change(id: string, patch: ImagePatch): void;
  reorder(id: string, targetId: string, after: boolean): void;
  context(id: string, x: number, y: number): void;
  thumbnail(id: string): Promise<string | undefined>;
}

/** Hierarchy and authoring UI only. Document operations stay in the controller. */
export function createLayerTree(doc: Document, container: HTMLElement, actions: TreeActions) {
  let current: TreeState | undefined, key = '', lastSelection = '', draggedId: string | undefined;
  let alive = true, active = true, timer: ReturnType<typeof setTimeout> | undefined, requesting = false;
  const collapsed = new Set<string>(), thumbnails = new Map<string, string>(), attempts = new Map<string, number>();
  const find = (id: string) => [...current?.images ?? [], ...current?.groups ?? []].find((layer) => layer.id === id);
  const rowFor = (event: Event) => event.target instanceof Element ? event.target.closest<HTMLElement>('[data-layer-id]') : undefined;
  container.addEventListener('change', (event) => {
    const input = event.target as HTMLInputElement, id = rowFor(event)?.dataset.layerId;
    if (id && input.matches('[data-multiselect]') && !current?.saving) actions.select(id, true);
  });
  container.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button') : undefined;
    const id = rowFor(event)?.dataset.layerId, layer = id ? find(id) : undefined;
    if (!id || !layer || !current || current.saving || button?.disabled) return;
    switch (button?.dataset.action) {
      case 'select': actions.select(id, event.ctrlKey || event.metaKey || event.shiftKey); break;
      case 'visible': actions.change(id, { visible: !layer.visible }); break;
      case 'lock': actions.change(id, { locked: !layer.locked }); break;
      case 'more': actions.context(id, event.clientX, event.clientY); break;
      case 'collapse':
        if (layer.kind !== 'group') return;
        if (collapsed.has(id)) collapsed.delete(id);
        else { collapsed.add(id); if (layer.children.some((child) => current!.selectedIds.includes(child))) actions.select(id); }
        render(current); break;
    }
  });
  container.addEventListener('dblclick', (event) => {
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-action="select"]') : undefined;
    const id = rowFor(event)?.dataset.layerId, layer = id ? find(id) : undefined;
    if (!button || !layer || current?.saving || effectivelyLocked(layer, current!.groups)) return;
    const input = doc.createElement('input'); input.className = 'inline-name'; input.value = layer.name; input.maxLength = 120;
    input.setAttribute('aria-label', '一覧でレイヤー名を変更'); button.hidden = true; button.after(input);
    let done = false;
    const finish = (commit: boolean) => {
      if (done) return; done = true;
      const value = input.value.trim(); input.remove(); button.hidden = false;
      if (commit && value && !/[\u0000-\u001f]/.test(value) && value !== layer.name) actions.change(layer.id, { name: value });
    };
    input.addEventListener('blur', () => finish(true), { once: true });
    input.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === 'Escape') { event.preventDefault(); finish(event.key === 'Enter'); } });
    input.focus(); input.select();
  });
  container.addEventListener('contextmenu', (event) => {
    const id = rowFor(event)?.dataset.layerId;
    if (!id || current?.saving || (event.target as Element).closest('input')) return;
    event.preventDefault(); actions.context(id, event.clientX, event.clientY);
  });
  const clearDrop = () => container.querySelectorAll<HTMLElement>('[data-drop]').forEach((row) => row.removeAttribute('data-drop'));
  container.addEventListener('dragstart', (event) => {
    const grip = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-reorder]') : undefined;
    draggedId = grip?.closest<HTMLElement>('[data-layer-id]')?.dataset.layerId;
    if (!draggedId || !current || current.saving || grip?.disabled) { event.preventDefault(); draggedId = undefined; return; }
    event.dataTransfer?.setData('application/x-ww-layer', draggedId); if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  });
  container.addEventListener('dragover', (event) => {
    if (!draggedId || !current) return;
    event.preventDefault(); event.stopPropagation(); clearDrop();
    const row = rowFor(event);
    if (row && row.dataset.layerId !== draggedId && parentGroup(current.groups, row.dataset.layerId!)?.id === parentGroup(current.groups, draggedId)?.id) row.dataset.drop = event.clientY > row.getBoundingClientRect().top + row.clientHeight / 2 ? 'after' : 'before';
  });
  container.addEventListener('drop', (event) => {
    if (!draggedId) return;
    event.preventDefault(); event.stopPropagation();
    const row = rowFor(event);
    if (row?.dataset.layerId && current && parentGroup(current.groups, row.dataset.layerId)?.id === parentGroup(current.groups, draggedId)?.id) {
      actions.reorder(draggedId, row.dataset.layerId, event.clientY > row.getBoundingClientRect().top + row.clientHeight / 2);
    }
    draggedId = undefined; clearDrop();
  });
  container.addEventListener('dragend', () => { draggedId = undefined; clearDrop(); });

  async function refreshThumbnails() {
    if (!alive || !active || requesting || doc.hidden) return;
    clearTimeout(timer); requesting = true;
    // One snapshot at a time; duplicates share a small static preview by asset ID.
    const pending = current?.images.find((layer) => !thumbnails.has(layer.assetId) && (attempts.get(layer.assetId) ?? 0) < 20
      && [...container.querySelectorAll<HTMLElement>('[data-thumbnail]')].some((node) => node.dataset.thumbnail === layer.assetId));
    if (pending) {
      attempts.set(pending.assetId, (attempts.get(pending.assetId) ?? 0) + 1);
      try {
        const data = await actions.thumbnail(pending.id);
        if (alive && current?.images.some((layer) => layer.assetId === pending.assetId) && data) {
          thumbnails.set(pending.assetId, data); paintThumbnails();
        }
      } catch { /* Missing/hidden media keeps its format icon. */ }
    }
    requesting = false;
    if (alive && active && pending) timer = setTimeout(() => { void refreshThumbnails(); }, thumbnails.has(pending.assetId) ? 0 : 400);
  }
  function paintThumbnails() {
    container.querySelectorAll<HTMLElement>('[data-thumbnail]').forEach((node) => {
      const data = thumbnails.get(node.dataset.thumbnail!); if (!data || node.querySelector('img')) return;
      const image = doc.createElement('img'); image.alt = ''; image.src = data; node.replaceChildren(image);
    });
  }
  function render(state: TreeState) {
    current = state;
    const selection = state.selectedIds.join(',');
    if (selection !== lastSelection) { state.selectedIds.forEach((id) => { const parent = parentGroup(state.groups, id); if (parent) collapsed.delete(parent.id); }); lastSelection = selection; }
    const nodes = [...state.images, ...state.groups], assets = new Set(state.images.map((layer) => layer.assetId));
    for (const id of thumbnails.keys()) if (!assets.has(id)) { thumbnails.delete(id); attempts.delete(id); }
    for (const id of attempts.keys()) if (!assets.has(id)) attempts.delete(id);
    const nextKey = JSON.stringify([nodes.map((layer) => ({ id: layer.id, name: layer.name, kind: layer.kind, zIndex: layer.zIndex, visible: layer.visible, locked: layer.locked,
      masked: layer.effects?.some((effect) => effect.enabled) ?? false,
      ...(layer.kind === 'group' ? { children: layer.children } : { asset: layer.assetId }) })), [...collapsed]]);
    if (key !== nextKey) {
      const focused = container.getRootNode() instanceof ShadowRoot ? (container.getRootNode() as ShadowRoot).activeElement : doc.activeElement;
      const focusId = focused?.closest<HTMLElement>('[data-layer-id]')?.dataset.layerId, action = (focused as HTMLElement | null)?.dataset.action;
      key = nextKey; container.replaceChildren();
      const append = (layer: LayerNode, parent?: GroupLayer) => {
        const row = doc.createElement('div'); row.className = 'layer'; row.dataset.layerId = layer.id; row.dataset.kind = layer.kind;
        row.title = layer.name; if (parent) row.dataset.parentId = parent.id;
        const check = doc.createElement('input'); check.type = 'checkbox'; check.dataset.multiselect = ''; check.setAttribute('aria-label', `${layer.name}を複数選択`); row.append(check);
        const add = (action: string, content: string, label: string, svg = false) => {
          const button = doc.createElement('button'); button.type = 'button'; button.dataset.action = action;
          if (svg) button.innerHTML = icon(content); else button.textContent = content;
          button.setAttribute('aria-label', label); button.title = label; row.append(button); return button;
        };
        const toggle = add('collapse', layer.kind === 'group' ? collapsed.has(layer.id) ? '▸' : '▾' : '', layer.kind === 'group' ? collapsed.has(layer.id) ? 'グループを展開' : 'グループを折りたたむ' : '');
        if (layer.kind !== 'group') { toggle.hidden = true; const spacer = doc.createElement('span'); spacer.className = 'fold-spacer'; row.append(spacer); }
        else toggle.setAttribute('aria-expanded', String(!collapsed.has(layer.id)));
        const select = add('select', '', layer.name); select.className = 'layer-select';
        const preview = doc.createElement('span'); preview.className = 'thumbnail'; preview.innerHTML = icon(layer.kind);
        if (layer.kind !== 'group') preview.dataset.thumbnail = layer.assetId;
        const text = doc.createElement('span'); text.className = 'layer-text';
        const name = doc.createElement('span'); name.className = 'layer-title'; name.textContent = layer.name;
        const kind = doc.createElement('span'); kind.className = 'layer-type'; kind.textContent = (layer.kind === 'group' ? `グループ · ${layer.children.length}素材` : layer.kind === 'animation' ? `▶ ${layer.format.toUpperCase()}` : '画像') + (layer.effects?.some((effect) => effect.enabled) ? ' · マスク' : '');
        kind.title = kind.textContent;
        text.append(name, kind); select.append(preview, text);
        const grip = add('reorder', 'grip', 'レイヤーを並び替え', true); grip.draggable = true; grip.dataset.reorder = '';
        const visible = add('visible', layer.visible ? 'visible' : 'hidden', layer.visible ? '非表示にする' : '表示する', true); visible.setAttribute('aria-pressed', String(layer.visible));
        add('lock', effectivelyLocked(layer, state.groups) ? 'lock' : 'unlock', parent?.locked ? '親グループでロック中' : layer.locked ? 'ロック解除' : 'ロック', true);
        add('more', 'more', 'レイヤーの操作', true);
        row.dataset.locked = String(effectivelyLocked(layer, state.groups)); row.dataset.visible = String(layer.visible && parent?.visible !== false);
        if (parent?.visible === false) row.title += '（親グループが非表示）';
        container.append(row);
        if (layer.kind === 'group' && !collapsed.has(layer.id)) frontToBack(childrenOf(layer, state.images)).forEach((child) => append(child, layer));
      };
      frontToBack(rootLayers(state.images, state.groups)).forEach((layer) => append(layer)); paintThumbnails();
      if (focusId && action) [...container.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.dataset.action === action && button.closest<HTMLElement>('[data-layer-id]')?.dataset.layerId === focusId)?.focus({ preventScroll: true });
    }
    container.querySelectorAll<HTMLElement>('[data-layer-id]').forEach((row) => {
      const id = row.dataset.layerId!, selected = state.selectedIds.includes(id), inherited = Boolean(parentGroup(state.groups, id)?.locked);
      row.toggleAttribute('data-selected', selected);
      const check = row.querySelector<HTMLInputElement>('[data-multiselect]')!; check.checked = selected; check.disabled = state.saving;
      row.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
        if (button.dataset.action === 'select') button.setAttribute('aria-pressed', String(selected));
        button.disabled = state.saving || inherited && !['select', 'more'].includes(button.dataset.action!);
      });
    });
    void refreshThumbnails();
  }
  const visibility = () => { if (doc.hidden) clearTimeout(timer); else void refreshThumbnails(); };
  doc.addEventListener('visibilitychange', visibility);
  return { render, setActive(value: boolean) { active = value; if (!value) clearTimeout(timer); else void refreshThumbnails(); },
    destroy() { alive = false; clearTimeout(timer); thumbnails.clear(); attempts.clear(); doc.removeEventListener('visibilitychange', visibility); } };
}
