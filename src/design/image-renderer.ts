import { loadAsset } from '../assets/client';
import { centre, movePlacement, resizePlacement, rotatePlacement, type PlacementFrame, type Point } from './geometry';
import type { DesignTarget, ImageDecoration, ImagePlacement } from './types';

export interface ImageEditing {
  selectedId: string | undefined;
  locked: boolean;
  select(id: string): void;
  change(id: string, placement: ImagePlacement): void;
  error(message: string): void;
}

const CSS = `
:host { all:initial !important; position:fixed !important; inset:0 !important; width:100vw !important; height:100vh !important; margin:0 !important; padding:0 !important; border:0 !important; background:transparent !important; overflow:hidden !important; pointer-events:none !important; z-index:2147482000 !important; }
* { box-sizing:border-box; }
.image { position:absolute; transform-origin:center; pointer-events:none; touch-action:none; }
.image[hidden] { display:none; }
.image[data-editable] { pointer-events:auto; cursor:move; }
.image[data-selected] { outline:2px solid #695089; }
img { display:block; width:100%; height:100%; border:0; user-select:none; pointer-events:none; }
.handle { display:none; position:absolute; width:14px; height:14px; padding:0; border:2px solid #695089; border-radius:2px; background:white; touch-action:none; }
.image[data-selected] .handle { display:block; }
[data-handle="nw"] { left:-7px; top:-7px; cursor:nwse-resize; }
[data-handle="ne"] { right:-7px; top:-7px; cursor:nesw-resize; }
[data-handle="sw"] { left:-7px; bottom:-7px; cursor:nesw-resize; }
[data-handle="se"] { right:-7px; bottom:-7px; cursor:nwse-resize; }
[data-handle="rotate"] { left:calc(50% - 7px); top:-32px; border-radius:50%; cursor:grab; }
`;

export function placementFrame(doc: Document, anchors: readonly DesignTarget[], placement: ImagePlacement): PlacementFrame | undefined {
  if (placement.anchor.kind === 'viewport') return { left: 0, top: 0, width: doc.defaultView!.innerWidth, height: doc.defaultView!.innerHeight };
  const id = placement.anchor.target;
  const anchor = anchors.find((entry) => entry.id === id);
  const element = anchor && doc.querySelector(`[data-ww-surface~="${anchor.surface}"]`);
  const rect = element?.getBoundingClientRect();
  return rect && rect.width > 0 && rect.height > 0 ? rect : undefined;
}

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
  const nodes = new Map<string, { node: HTMLDivElement; image: HTMLImageElement; assetId: string }>();
  const urls = new Map<string, Promise<string>>();
  let gesture: { id: string; pointerId: number; mode: string; start: ImagePlacement; point: Point; frame: PlacementFrame } | undefined;

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
      entry.image.style.opacity = String(item.opacity);
      entry.node.toggleAttribute('data-editable', Boolean(editing && !editing.locked));
      entry.node.toggleAttribute('data-selected', Boolean(editing && editing.selectedId === item.id));
      entry.node.tabIndex = editing ? 0 : -1;
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
    const node = target?.closest<HTMLDivElement>('[data-image-id]');
    const item = images.find((image) => image.id === node?.dataset.imageId);
    const rect = item && placementFrame(doc, anchors, item.placement);
    if (!node || !item || !rect) return;
    event.preventDefault(); event.stopPropagation();
    editing.select(item.id);
    node.focus({ preventScroll: true });
    gesture = { id: item.id, pointerId: event.pointerId, mode: target?.getAttribute('data-handle') ?? 'move',
      start: { ...item.placement }, point: { x: event.clientX, y: event.clientY }, frame: rect };
    node.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent) => {
    if (!gesture || !editing || editing.locked || event.pointerId !== gesture.pointerId) return;
    event.preventDefault(); event.stopPropagation();
    const { id, mode, start, frame: rect, point } = gesture;
    const current = { x: event.clientX, y: event.clientY };
    const delta = { x: current.x - point.x, y: current.y - point.y };
    const placement = mode === 'rotate' ? rotatePlacement(start, rect, point, current)
      : mode === 'move' ? movePlacement(start, rect, delta)
      : resizePlacement(start, rect, delta, mode.endsWith('e') ? 1 : -1, mode.startsWith('s') ? 1 : -1);
    editing.change(id, placement);
  };
  const onPointerUp = (event: PointerEvent) => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    event.stopPropagation();
    gesture = undefined;
  };

  const mount = () => {
    host = doc.createElement('div');
    host.id = 'web-world-themes-decorations';
    shadow = host.attachShadow({ mode: 'open' });
    const style = doc.createElement('style');
    style.textContent = CSS;
    shadow.append(style);
    shadow.addEventListener('pointerdown', onPointerDown as EventListener);
    shadow.addEventListener('pointermove', onPointerMove as EventListener);
    shadow.addEventListener('pointerup', onPointerUp as EventListener);
    shadow.addEventListener('pointercancel', onPointerUp as EventListener);
    shadow.addEventListener('lostpointercapture', () => { gesture = undefined; });
    shadow.addEventListener('click', (event) => { if (editing) { event.preventDefault(); event.stopPropagation(); } });
    observer = new ResizeObserver(refresh);
    view.addEventListener('resize', refresh);
    doc.addEventListener('scroll', refresh, true);
    doc.addEventListener('fullscreenchange', refresh);
  };
  const destroy = () => {
    if (!host && nodes.size === 0 && urls.size === 0) { images = []; return; }
    generation++;
    gesture = undefined;
    if (frame !== undefined) view.cancelAnimationFrame(frame);
    frame = undefined;
    observer?.disconnect(); observer = undefined; observed.clear();
    view.removeEventListener('resize', refresh);
    doc.removeEventListener('scroll', refresh, true);
    doc.removeEventListener('fullscreenchange', refresh);
    host?.remove(); host = undefined; shadow = undefined;
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
      for (const [id, entry] of nodes) if (!wanted.has(id)) { entry.node.remove(); nodes.delete(id); }
      for (const item of next) {
        let entry = nodes.get(item.id);
        if (!entry) {
          const node = doc.createElement('div');
          node.className = 'image'; node.dataset.imageId = item.id;
          node.setAttribute('role', 'img'); node.setAttribute('aria-label', item.name);
          const image = doc.createElement('img'); image.alt = ''; image.draggable = false; image.style.visibility = 'hidden';
          node.append(image);
          for (const [mode, label] of [['nw', '左上でサイズ変更'], ['ne', '右上でサイズ変更'], ['sw', '左下でサイズ変更'], ['se', '右下でサイズ変更'], ['rotate', '画像を回転']]) {
            const handle = doc.createElement('button'); handle.type = 'button'; handle.className = 'handle';
            handle.dataset.handle = mode; handle.setAttribute('aria-label', label!); node.append(handle);
          }
          entry = { node, image, assetId: '' }; nodes.set(item.id, entry); shadow!.append(node);
        }
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
    edit(value: ImageEditing | undefined) { editing = value; if (!editing || editing.locked) gesture = undefined; draw(); },
    refresh,
    destroy,
  };
}
