import { ANIMATION_LIMITS } from '../assets/motion-types';
import { childrenOf, effectivelyLocked, frontToBack, groupMovable, parentGroup, rootLayers } from '../design/hierarchy';
import { GROUP_LIMITS, IMAGE_LIMITS, type Decoration, type GroupLayer, type ImagePatch, type LayerNode } from '../design/types';

interface TreeState { images: readonly Decoration[]; groups: readonly GroupLayer[]; selectedIds: readonly string[]; saving: boolean }
interface TreeActions {
  select(id: string, additive?: boolean): void;
  change(id: string, patch: ImagePatch): void;
  duplicate(id: string): void;
  remove(id: string): void;
  reorder(id: string, targetId: string, after: boolean): void;
}

/** Hierarchy display and folding only. Document operations live in the controller. */
export function createLayerTree(doc: Document, container: HTMLElement, actions: TreeActions) {
  let current: TreeState | undefined, key = '', lastSelection = '', draggedId: string | undefined;
  const collapsed = new Set<string>();
  const find = (id: string) => [...current?.images ?? [], ...current?.groups ?? []].find((layer) => layer.id === id);
  container.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button') : undefined;
    const id = button?.closest<HTMLElement>('[data-layer-id]')?.dataset.layerId, layer = id ? find(id) : undefined;
    if (!id || !layer || !current || current.saving || button?.disabled) return;
    switch (button?.dataset.action) {
      case 'select': actions.select(id, event.ctrlKey || event.metaKey || event.shiftKey); break;
      case 'visible': actions.change(id, { visible: !layer.visible }); break;
      case 'lock': actions.change(id, { locked: !layer.locked }); break;
      case 'duplicate': actions.duplicate(id); break;
      case 'delete': actions.remove(id); break;
      case 'collapse':
        if (layer.kind !== 'group') return;
        if (collapsed.has(id)) collapsed.delete(id);
        else { collapsed.add(id); if (layer.children.some((child) => current!.selectedIds.includes(child))) actions.select(id); }
        render(current); break;
    }
  });
  const clearDrop = () => container.querySelectorAll<HTMLElement>('[data-drop]').forEach((row) => row.removeAttribute('data-drop'));
  container.addEventListener('dragstart', (event) => {
    const grip = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-reorder]') : undefined;
    draggedId = grip?.closest<HTMLElement>('[data-layer-id]')?.dataset.layerId;
    if (!draggedId || !current || current.saving || grip?.disabled || parentGroup(current.groups, draggedId)?.locked) { event.preventDefault(); draggedId = undefined; return; }
    event.dataTransfer?.setData('application/x-ww-layer', draggedId); if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  });
  container.addEventListener('dragover', (event) => {
    if (!draggedId || !current) return;
    event.preventDefault(); event.stopPropagation(); clearDrop();
    const row = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-layer-id]') : undefined;
    if (row && row.dataset.layerId !== draggedId && parentGroup(current.groups, row.dataset.layerId!)?.id === parentGroup(current.groups, draggedId)?.id) row.dataset.drop = event.clientY > row.getBoundingClientRect().top + row.clientHeight / 2 ? 'after' : 'before';
  });
  container.addEventListener('drop', (event) => {
    if (!draggedId) return;
    event.preventDefault(); event.stopPropagation();
    const row = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-layer-id]') : undefined;
    if (row?.dataset.layerId) actions.reorder(draggedId, row.dataset.layerId, row.dataset.drop === 'after');
    draggedId = undefined; clearDrop();
  });
  container.addEventListener('dragend', () => { draggedId = undefined; clearDrop(); });

  function render(state: TreeState) {
    current = state;
    const selection = state.selectedIds.join(',');
    if (selection !== lastSelection) { state.selectedIds.forEach((id) => { const parent = parentGroup(state.groups, id); if (parent) collapsed.delete(parent.id); }); lastSelection = selection; }
    const nodes = [...state.images, ...state.groups];
    const nextKey = JSON.stringify([nodes.map((layer) => ({ id: layer.id, name: layer.name, kind: layer.kind, zIndex: layer.zIndex, visible: layer.visible, locked: layer.locked,
      ...(layer.kind === 'group' ? { children: layer.children } : {}) })), [...collapsed]]);
    if (key !== nextKey) {
      key = nextKey; container.replaceChildren();
      const append = (layer: LayerNode, parent?: GroupLayer) => {
        const row = doc.createElement('div'); row.className = 'layer'; row.dataset.layerId = layer.id; row.dataset.kind = layer.kind;
        if (parent) row.dataset.parentId = parent.id;
        const add = (action: string, text: string, label: string) => {
          const button = doc.createElement('button'); button.type = 'button'; button.dataset.action = action; button.textContent = text;
          button.setAttribute('aria-label', label); button.title = label; row.append(button); return button;
        };
        if (layer.kind === 'group') { const toggle = add('collapse', collapsed.has(layer.id) ? '▸' : '▾', collapsed.has(layer.id) ? 'グループを展開' : 'グループを折りたたむ'); toggle.setAttribute('aria-expanded', String(!collapsed.has(layer.id))); }
        add('select', `${layer.kind === 'group' ? '▣ ' : layer.kind === 'animation' ? '▶ ' : ''}${layer.name}`, layer.name).className = 'layer-select';
        const grip = add('reorder', '↕', 'レイヤーを並び替え'); grip.draggable = true; grip.dataset.reorder = '';
        const visible = add('visible', layer.visible ? '表示' : '隠す', layer.visible ? '非表示にする' : '表示する'); visible.setAttribute('aria-pressed', String(layer.visible));
        add('lock', effectivelyLocked(layer, state.groups) ? '固定' : '自由', parent?.locked ? '親グループでロック中' : layer.locked ? 'ロック解除' : 'ロック');
        add('duplicate', '⧉', '複製'); add('delete', '×', '削除');
        row.dataset.locked = String(effectivelyLocked(layer, state.groups)); row.dataset.visible = String(layer.visible && parent?.visible !== false);
        if (parent?.visible === false) row.title = '親グループが非表示です。';
        container.append(row);
        if (layer.kind === 'group' && !collapsed.has(layer.id)) frontToBack(childrenOf(layer, state.images)).forEach((child) => append(child, layer));
      };
      frontToBack(rootLayers(state.images, state.groups)).forEach((layer) => append(layer));
    }
    const animations = state.images.filter((image) => image.kind === 'animation').length;
    container.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
      const id = button.closest<HTMLElement>('[data-layer-id]')!.dataset.layerId!, layer = nodes.find((layer) => layer.id === id)!;
      const inherited = Boolean(parentGroup(state.groups, id)?.locked), source = layer.kind === 'group' ? childrenOf(layer, state.images) : [layer];
      const protectedLayer = layer.kind === 'group' ? !groupMovable(layer, state.images) : effectivelyLocked(layer, state.groups);
      const full = state.images.length + source.length > IMAGE_LIMITS.count || animations + source.filter((image) => image.kind === 'animation').length > ANIMATION_LIMITS.count || layer.kind === 'group' && state.groups.length >= GROUP_LIMITS.count;
      if (button.dataset.action === 'select') button.setAttribute('aria-pressed', String(state.selectedIds.includes(id)));
      button.disabled = state.saving || inherited && button.dataset.action !== 'select'
        || ['delete', 'duplicate'].includes(button.dataset.action!) && protectedLayer || button.dataset.action === 'duplicate' && full;
    });
    container.querySelectorAll<HTMLElement>('[data-layer-id]').forEach((row) => row.toggleAttribute('data-selected', state.selectedIds.includes(row.dataset.layerId!)));
  }
  return { render };
}
