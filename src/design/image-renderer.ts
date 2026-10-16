import { loadAsset } from '../assets/client';
import { centre, groupBounds, moveGroup, resizePlacement, rotatePlacement, type PlacementChange, type PlacementSample, type Point } from './geometry';
import { editableSamples, placementFrame, snapTargets } from './frames';
import { snapMove, type Guide } from './layout';
import type { DesignTarget, ImageDecoration } from './types';

export interface ImageEditing {
  selectedIds: readonly string[];
  locked: boolean;
  epoch: number;
  snapping: boolean;
  select(id: string, additive: boolean, preserve: boolean): void;
  begin(): void;
  change(changes: readonly PlacementChange[]): void;
  end(cancel?: boolean): void;
  error(message: string): void;
}

const CSS = `
:host { all:initial !important; position:fixed !important; inset:0 !important; width:100vw !important; height:100vh !important; margin:0 !important; padding:0 !important; border:0 !important; background:transparent !important; overflow:hidden !important; pointer-events:none !important; z-index:2147482000 !important; }
* { box-sizing:border-box; }
.image, .selection-frame { position:absolute; transform-origin:center; pointer-events:none; touch-action:none; }
[hidden] { display:none !important; }
.image[data-editable] { pointer-events:auto; cursor:move; }
.selection-frame { z-index:1000; border:2px solid #6350ca; box-shadow:0 0 0 1px white, inset 0 0 0 1px white; }
.selection-frame[data-locked] { border-color:#966000; border-style:dashed; }
.group-frame { position:absolute; border:1px dashed #6350ca; box-shadow:0 0 0 1px white; pointer-events:none; z-index:1001; }
.guide { position:absolute; background:#ce267e; box-shadow:0 0 0 1px #ffffffbb; pointer-events:none; z-index:1002; }
img { display:block; width:100%; height:100%; border:0; user-select:none; pointer-events:none; }
.handle { display:none; position:absolute; width:14px; height:14px; padding:0; border:2px solid #6350ca; box-shadow:0 0 0 1px white; border-radius:2px; background:white; touch-action:none; }
.selection-frame[data-transformable] .handle { display:block; pointer-events:auto; }
[data-handle="nw"] { left:-7px; top:-7px; cursor:nwse-resize; }
[data-handle="ne"] { right:-7px; top:-7px; cursor:nesw-resize; }
[data-handle="sw"] { left:-7px; bottom:-7px; cursor:nesw-resize; }
[data-handle="se"] { right:-7px; bottom:-7px; cursor:nwse-resize; }
[data-handle="rotate"] { left:calc(50% - 7px); top:-32px; border-radius:50%; cursor:grab; }
`;

/** Image rendering owns DOM and object URLs. Editing state and storage stay outside. */
export function createImageRenderer(doc: Document, anchors: readonly DesignTarget[]) {
  const view = doc.defaultView!;
  let host: HTMLElement | undefined;
  let shadow: ShadowRoot | undefined;
  let editing: ImageEditing | undefined;
  let images: readonly ImageDecoration[] = [];
  let frame: number | undefined;
  let observer: ResizeObserver | undefined;
  let observed = new Set<Element>();
  let generation = 0;
  let groupFrame: HTMLDivElement | undefined;
  let imageLayer: HTMLDivElement | undefined;
  let guideNodes: HTMLDivElement[] = [];
  const nodes = new Map<string, { node: HTMLDivElement; controls: HTMLDivElement; image: HTMLImageElement; assetId: string }>();
  const urls = new Map<string, Promise<string>>();
  let gesture: { pointerId: number; mode: string; samples: PlacementSample[]; point: Point } | undefined;

  const drawGuides = (guides: readonly Guide[]) => guideNodes.forEach((node, index) => {
    const guide = guides[index]; node.hidden = !guide;
    if (guide) {
      node.dataset.snapGuide = guide.axis;
      Object.assign(node.style, guide.axis === 'x' ? { left: `${guide.position}px`, top: `${guide.from}px`, width: '1px', height: `${guide.to - guide.from}px` }
        : { left: `${guide.from}px`, top: `${guide.position}px`, width: `${guide.to - guide.from}px`, height: '1px' });
    }
  });

  const getUrl = (id: string): Promise<string> => {
    let pending = urls.get(id);
    if (!pending) {
      const epoch = generation;
      pending = loadAsset(id).then(({ blob }) => {
        const url = URL.createObjectURL(blob);
        if (epoch !== generation) { URL.revokeObjectURL(url); throw new Error('表示を終了しました。'); }
        return url;
      });
      urls.set(id, pending);
    }
    return pending;
  };

  const draw = () => {
    if (!host) return;
    const parent = doc.fullscreenElement ?? doc.body ?? doc.documentElement;
    if (host.parentElement !== parent) parent.append(host);
    const nextObserved = new Set<Element>();
    for (const item of images) {
      const entry = nodes.get(item.id);
      if (!entry) continue;
      const rect = placementFrame(doc, anchors, item.placement);
      entry.node.hidden = !item.visible || !rect;
      const selected = Boolean(editing?.selectedIds.includes(item.id));
      entry.controls.hidden = !selected || !item.visible || !rect;
      entry.node.toggleAttribute('data-selected', selected);
      entry.node.toggleAttribute('data-editable', Boolean(editing && !editing.locked && !item.locked));
      entry.node.tabIndex = editing && !item.locked ? 0 : -1;
      if (item.placement.anchor.kind === 'surface') {
        const id = item.placement.anchor.target;
        const target = anchors.find((candidate) => candidate.id === id);
        const element = target && doc.querySelector(`[data-ww-surface~="${target.surface}"]`);
        if (element) nextObserved.add(element);
      }
      if (!rect) continue;
      const point = centre(item.placement, rect);
      Object.assign(entry.node.style, {
        left: `${point.x}px`, top: `${point.y}px`, width: `${item.placement.widthPx}px`, height: `${item.placement.heightPx}px`,
        transform: `translate(-50%, -50%) rotate(${item.placement.rotationDeg}deg)`, zIndex: String(item.zIndex + 100),
      });
      Object.assign(entry.controls.style, { left: `${point.x}px`, top: `${point.y}px`, width: `${item.placement.widthPx}px`, height: `${item.placement.heightPx}px`, transform: entry.node.style.transform });
      entry.image.style.opacity = String(item.opacity);
      entry.controls.toggleAttribute('data-locked', item.locked);
      entry.controls.toggleAttribute('data-transformable', Boolean(editing && !editing.locked && !item.locked && editing.selectedIds.length === 1));
    }
    const samples = editing ? editableSamples(doc, anchors, images, editing.selectedIds) : [];
    const bounds = samples.length > 1 ? groupBounds(samples) : undefined;
    if (groupFrame) {
      groupFrame.hidden = !bounds;
      if (bounds) Object.assign(groupFrame.style, { left: `${bounds.left}px`, top: `${bounds.top}px`, width: `${bounds.right - bounds.left}px`, height: `${bounds.bottom - bounds.top}px` });
    }
    if (observed.size !== nextObserved.size || [...nextObserved].some((element) => !observed.has(element))) {
      observer?.disconnect();
      nextObserved.forEach((element) => observer?.observe(element));
      observed = nextObserved;
    }
  };
  const refresh = () => { if (host && frame === undefined) frame = view.requestAnimationFrame(() => { frame = undefined; draw(); }); };

  const onPointerDown = (event: PointerEvent) => {
    if (!editing || editing.locked || event.button !== 0) return;
    const target = event.target instanceof Element ? event.target : undefined;
    const wrapper = target?.closest<HTMLDivElement>('[data-image-id], [data-frame-id]');
    const id = wrapper?.dataset.imageId ?? wrapper?.dataset.frameId;
    const item = images.find((image) => image.id === id), node = id ? nodes.get(id)?.node : undefined;
    if (!node || !item || item.locked) return;
    event.preventDefault(); event.stopPropagation();
    const mode = target?.getAttribute('data-handle') ?? 'move';
    if (mode === 'move') editing.select(item.id, event.ctrlKey || event.metaKey || event.shiftKey, true);
    if (!editing.selectedIds.includes(item.id)) return;
    const samples = editableSamples(doc, anchors, images, editing.selectedIds);
    if (!samples.length || (mode !== 'move' && samples.length !== 1)) return;
    node.focus({ preventScroll: true });
    editing.begin();
    gesture = { pointerId: event.pointerId, mode, samples, point: { x: event.clientX, y: event.clientY } };
    node.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent) => {
    if (!gesture || !editing || editing.locked || event.pointerId !== gesture.pointerId) return;
    event.preventDefault(); event.stopPropagation();
    const { mode, samples, point } = gesture;
    if (samples.some((sample) => {
      const rect = placementFrame(doc, anchors, sample.placement);
      return !rect || (['left', 'top', 'width', 'height'] as const).some((key) => Math.abs(rect[key] - sample.frame[key]) > .000001);
    })) { finish(true); return; }
    const current = { x: event.clientX, y: event.clientY };
    const delta = { x: current.x - point.x, y: current.y - point.y };
    const first = samples[0]!;
    if (mode === 'move') {
      const result = editing.snapping && !event.altKey ? snapMove(samples, delta, snapTargets(doc, anchors, images, editing.selectedIds)) : { changes: moveGroup(samples, delta), guides: [] };
      drawGuides(result.guides); editing.change(result.changes); return;
    }
    editing.change([{ id: first.id, placement: mode === 'rotate'
      ? rotatePlacement(first.placement, first.frame, point, current)
      : resizePlacement(first.placement, first.frame, delta, mode.endsWith('e') ? 1 : -1, mode.startsWith('s') ? 1 : -1) }]);
  };
  const finish = (cancel = false) => { drawGuides([]); if (gesture) { gesture = undefined; editing?.end(cancel); } };
  const onPointerUp = (event: PointerEvent) => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    event.stopPropagation();
    finish(event.type !== 'pointerup');
  };
  const onBlur = () => finish(true);
  const onViewChange = () => { finish(true); refresh(); };

  const mount = () => {
    host = doc.createElement('div');
    host.id = 'web-world-themes-decorations';
    shadow = host.attachShadow({ mode: 'open' });
    const style = doc.createElement('style');
    style.textContent = CSS;
    shadow.append(style);
    imageLayer = doc.createElement('div'); imageLayer.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:0'; shadow.append(imageLayer);
    groupFrame = doc.createElement('div'); groupFrame.className = 'group-frame'; groupFrame.hidden = true; shadow.append(groupFrame);
    guideNodes = Array.from({ length: 2 }, () => { const node = doc.createElement('div'); node.className = 'guide'; node.hidden = true; shadow!.append(node); return node; });
    shadow.addEventListener('pointerdown', onPointerDown as EventListener);
    shadow.addEventListener('pointermove', onPointerMove as EventListener);
    shadow.addEventListener('pointerup', onPointerUp as EventListener);
    shadow.addEventListener('pointercancel', onPointerUp as EventListener);
    shadow.addEventListener('lostpointercapture', () => finish(true));
    shadow.addEventListener('click', (event) => { if (editing) { event.preventDefault(); event.stopPropagation(); } });
    observer = new ResizeObserver(refresh);
    view.addEventListener('resize', onViewChange);
    view.addEventListener('blur', onBlur);
    doc.addEventListener('scroll', onViewChange, true);
    doc.addEventListener('fullscreenchange', onViewChange);
  };
  const destroy = () => {
    if (!host && nodes.size === 0 && urls.size === 0) { images = []; return; }
    generation++;
    gesture = undefined;
    if (frame !== undefined) view.cancelAnimationFrame(frame);
    frame = undefined;
    observer?.disconnect(); observer = undefined; observed.clear();
    view.removeEventListener('resize', onViewChange);
    view.removeEventListener('blur', onBlur);
    doc.removeEventListener('scroll', onViewChange, true);
    doc.removeEventListener('fullscreenchange', onViewChange);
    host?.remove(); host = undefined; shadow = undefined; groupFrame = undefined; imageLayer = undefined; guideNodes = [];
    nodes.clear();
    urls.forEach((pending) => { void pending.then((url) => URL.revokeObjectURL(url), () => undefined); });
    urls.clear();
    images = [];
  };
  return {
    update(next: readonly ImageDecoration[]) {
      if (!next.length) { destroy(); return; }
      images = next;
      if (!host) mount();
      const wanted = new Set(next.map((item) => item.id));
      for (const [id, entry] of nodes) if (!wanted.has(id)) { entry.node.remove(); entry.controls.remove(); nodes.delete(id); }
      for (const [index, item] of next.entries()) {
        let entry = nodes.get(item.id);
        if (!entry) {
          const node = doc.createElement('div');
          node.className = 'image'; node.dataset.imageId = item.id;
          node.setAttribute('role', 'img'); node.setAttribute('aria-label', item.name);
          const image = doc.createElement('img'); image.alt = ''; image.draggable = false; image.style.visibility = 'hidden';
          node.append(image);
          const controls = doc.createElement('div'); controls.className = 'selection-frame'; controls.dataset.frameId = item.id;
          for (const [mode, label] of [['nw', '左上でサイズ変更'], ['ne', '右上でサイズ変更'], ['sw', '左下でサイズ変更'], ['se', '右下でサイズ変更'], ['rotate', '画像を回転']]) {
            const handle = doc.createElement('button'); handle.type = 'button'; handle.className = 'handle';
            handle.dataset.handle = mode; handle.setAttribute('aria-label', label!); controls.append(handle);
          }
          entry = { node, controls, image, assetId: '' }; nodes.set(item.id, entry); imageLayer!.append(node); shadow!.append(controls);
        }
        // Restore document tie order after undo recreates a removed node.
        if (imageLayer!.children[index] !== entry.node) imageLayer!.insertBefore(entry.node, imageLayer!.children[index] ?? null);
        entry.node.setAttribute('aria-label', item.name);
        if (entry.assetId !== item.assetId) {
          entry.assetId = item.assetId;
          const element = entry.image, epoch = generation;
          element.style.visibility = 'hidden';
          void getUrl(item.assetId).then((url) => {
            if (epoch !== generation || !element.isConnected) return;
            element.onload = () => { element.style.visibility = 'visible'; };
            element.onerror = () => editing?.error('画像を表示できませんでした。ページを再読み込みしてください。');
            element.src = url;
          }).catch((error: unknown) => { if (epoch === generation) editing?.error(error instanceof Error ? error.message : '画像を読み込めませんでした。'); });
        }
      }
      const assets = new Set(next.map((item) => item.assetId));
      for (const [id, pending] of urls) if (!assets.has(id)) { urls.delete(id); void pending.then((url) => URL.revokeObjectURL(url), () => undefined); }
      draw();
    },
    edit(value: ImageEditing | undefined) {
      if (!value || value.locked || value.epoch !== editing?.epoch) { gesture = undefined; drawGuides([]); }
      editing = value; draw();
    },
    refresh,
    destroy,
  };
}
