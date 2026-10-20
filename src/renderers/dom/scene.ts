import { captureGeometry } from '../../host/anchors';
import { WORLD_MODE } from '../../host/world-options';
import { evaluateLayout } from '../../world/layout';
import { legacyLayout } from './legacy-evaluation';
import { assertWorldParity } from './parity';
import { createModelRenderer } from '../three/models';
import { createMediaController } from '../../media/controller';
import { clearAssetSources } from '../../assets/client';
import { createEffectController, type EffectTarget } from './effects';
import type { PlaybackSource } from '../../signals/types';
import {
  centre,
  rotation,
  groupBounds,
  moveGroup,
  resizePlacement,
  rotatePlacement,
  type PlacementChange,
  type PlacementSample,
  type Point,
} from '../../world/geometry';
import { editableSceneSamples, placementFrame, snapTargets } from '../../design/frames';
import { effectivelyLocked, groupMovable, parentGroup, rootLayers } from '../../world/hierarchy';
import { snapMove, type Guide } from '../../design/layout';
import type { DesignTarget, Decoration, GroupLayer } from '../../design/types';
import type { SignalRule } from '../../signals/keyframes';
import type { TimelineHost } from '../../host/timeline';
import type { WorldLayout } from '../../world/types';

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
.composition { position:absolute; pointer-events:none; }
.group-content { position:absolute; inset:0; pointer-events:none; isolation:isolate; }
.selection-frame[data-group] { border-style:dashed; border-color:#196f95; }
.group-edge { display:none; position:absolute; }
.selection-frame[data-group-movable] .group-edge { display:block; pointer-events:auto; cursor:move; }
[data-group-edge="top"], [data-group-edge="bottom"] { left:0; right:0; height:8px; }
[data-group-edge="top"] { top:-4px; } [data-group-edge="bottom"] { bottom:-4px; }
[data-group-edge="left"], [data-group-edge="right"] { top:0; bottom:0; width:8px; }
[data-group-edge="left"] { left:-4px; } [data-group-edge="right"] { right:-4px; }
[hidden] { display:none !important; }
.image[data-editable] { pointer-events:auto; cursor:move; }
.selection-frame { z-index:1000; border:2px solid #6350ca; box-shadow:0 0 0 1px white, inset 0 0 0 1px white; }
.selection-frame[data-locked] { border-color:#966000; border-style:dashed; }
.group-frame { position:absolute; border:1px dashed #6350ca; box-shadow:0 0 0 1px white; pointer-events:none; z-index:1001; }
.guide { position:absolute; background:#ce267e; box-shadow:0 0 0 1px #ffffffbb; pointer-events:none; z-index:1002; }
.media, img, canvas, svg, video { display:block; width:100%; height:100%; border:0; user-select:none; pointer-events:none; }
.handle { display:none; position:absolute; width:14px; height:14px; padding:0; border:2px solid #6350ca; box-shadow:0 0 0 1px white; border-radius:2px; background:white; touch-action:none; }
.selection-frame[data-transformable] .handle { display:block; pointer-events:auto; }
[data-handle="nw"] { left:-7px; top:-7px; cursor:nwse-resize; }
[data-handle="ne"] { right:-7px; top:-7px; cursor:nesw-resize; }
[data-handle="sw"] { left:-7px; bottom:-7px; cursor:nesw-resize; }
[data-handle="se"] { right:-7px; bottom:-7px; cursor:nwse-resize; }
[data-handle="rotate"] { left:calc(50% - 7px); top:-32px; border-radius:50%; cursor:grab; }
`;

/** Shared layer layout/gestures; media decoding and playback live in media/. */
export function createImageRenderer(
  doc: Document,
  anchors: readonly DesignTarget[],
  playback?: PlaybackSource,
  timeline?: TimelineHost,
) {
  const view = doc.defaultView!;
  let host: HTMLElement | undefined;
  let shadow: ShadowRoot | undefined;
  let editing: ImageEditing | undefined;
  let images: readonly Decoration[] = [];
  let groups: readonly GroupLayer[] = [];
  let signalRules: readonly SignalRule[] = [];
  let frame: number | undefined;
  let observer: ResizeObserver | undefined;
  let observed = new Set<Element>();
  let media: ReturnType<typeof createMediaController> | undefined;
  let models: ReturnType<typeof createModelRenderer> | undefined;
  let effects: ReturnType<typeof createEffectController> | undefined;
  let groupFrame: HTMLDivElement | undefined;
  let imageLayer: HTMLDivElement | undefined;
  let guideNodes: HTMLDivElement[] = [];
  const nodes = new Map<
    string,
    {
      node: HTMLDivElement;
      controls: HTMLDivElement;
      media: ReturnType<ReturnType<typeof createMediaController>['attach']>;
    }
  >();
  const compositions = new Map<string, { node: HTMLDivElement; content: HTMLDivElement; controls: HTMLDivElement }>();
  let lastLayout: WorldLayout | undefined;
  let gesture:
    | {
        pointerId: number;
        mode: string;
        samples: PlacementSample[];
        authored: PlacementSample[];
        parentAngles: Map<string, number>;
        point: Point;
      }
    | undefined;

  const applyLayout = (layout: WorldLayout) => {
    lastLayout = layout;
    const parents = new Map(layout.groups.map((group) => [group.layer.id, group]));
    for (const group of layout.groups) {
      const entry = compositions.get(group.layer.id);
      if (!entry || !group.frame) continue;
      const p = group.layer.placement,
        point = centre(p, group.frame);
      const geometry = {
        left: `${point.x - p.widthPx / 2}px`,
        top: `${point.y - p.heightPx / 2}px`,
        width: `${p.widthPx}px`,
        height: `${p.heightPx}px`,
        transform: `rotate(${p.rotationDeg}deg)`,
      };
      Object.assign(entry.node.style, geometry);
      Object.assign(entry.controls.style, geometry);
    }
    for (const layer of layout.layers) {
      const entry = nodes.get(layer.layer.id);
      if (!entry || !layer.frame || !layer.position || !layer.localPosition) continue;
      const p = layer.layer.placement,
        local = layer.localPosition,
        point = layer.position;
      const parentAngle = layer.parentId ? (parents.get(layer.parentId)?.layer.placement.rotationDeg ?? 0) : 0;
      const size = { width: `${p.widthPx}px`, height: `${p.heightPx}px` };
      Object.assign(entry.node.style, size, {
        left: `${local.x}px`,
        top: `${local.y}px`,
        transform: `translate(-50%, -50%) rotate(${rotation(p.rotationDeg - parentAngle)}deg)`,
      });
      Object.assign(entry.controls.style, size, {
        left: `${point.x}px`,
        top: `${point.y}px`,
        transform: `translate(-50%, -50%) rotate(${p.rotationDeg}deg)`,
      });
    }
    const selected =
      editing && editing.selectedIds.length > 1
        ? [...layout.groups, ...layout.layers].filter(
            (entry) => editing!.selectedIds.includes(entry.layer.id) && entry.visible && entry.frame,
          )
        : [];
    const bounds =
      selected.length > 1
        ? groupBounds(
            selected.map((entry) => ({ id: entry.layer.id, placement: entry.layer.placement, frame: entry.frame! })),
          )
        : undefined;
    if (groupFrame) {
      groupFrame.hidden = !bounds;
      if (bounds)
        Object.assign(groupFrame.style, {
          left: `${bounds.left}px`,
          top: `${bounds.top}px`,
          width: `${bounds.right - bounds.left}px`,
          height: `${bounds.bottom - bounds.top}px`,
        });
    }
  };

  const drawGuides = (guides: readonly Guide[]) =>
    guideNodes.forEach((node, index) => {
      const guide = guides[index];
      node.hidden = !guide;
      if (guide) {
        node.dataset.snapGuide = guide.axis;
        Object.assign(
          node.style,
          guide.axis === 'x'
            ? {
                left: `${guide.position}px`,
                top: `${guide.from}px`,
                width: '1px',
                height: `${guide.to - guide.from}px`,
              }
            : {
                left: `${guide.from}px`,
                top: `${guide.position}px`,
                width: `${guide.to - guide.from}px`,
                height: '1px',
              },
        );
      }
    });

  const draw = () => {
    if (!host) return;
    const parent = doc.fullscreenElement ?? doc.body ?? doc.documentElement;
    if (host.parentElement !== parent) parent.append(host);
    const nextObserved = new Set<Element>();
    const effectTargets: EffectTarget[] = [];
    const geometry = captureGeometry(doc, anchors),
      scene = { decorations: images, groups, ...(signalRules.length ? { signalRules } : {}) };
    const layout = WORLD_MODE === 'legacy' ? legacyLayout(scene, geometry) : evaluateLayout(scene, geometry);
    if (WORLD_MODE === 'compare') assertWorldParity(layout, legacyLayout(scene, geometry), 'layout');
    const layouts = new Map(layout.groups.map((group) => [group.layer.id, group]));
    const layerLayouts = new Map(layout.layers.map((layer) => [layer.layer.id, layer]));
    // Composite parents are evaluated first; descendants share the same effect stage.
    for (const group of groups) {
      const entry = compositions.get(group.id)!,
        { layer, frame: rect, bounds } = layouts.get(group.id)!;
      entry.node.hidden = !group.visible || !rect;
      entry.node.tabIndex = editing && !group.locked ? 0 : -1;
      entry.node.toggleAttribute('data-selected', Boolean(editing?.selectedIds.includes(group.id)));
      entry.controls.hidden = !editing?.selectedIds.includes(group.id) || !group.visible || !rect;
      entry.controls.toggleAttribute('data-locked', !groupMovable(group, images));
      entry.controls.toggleAttribute(
        'data-group-movable',
        Boolean(editing && !editing.locked && groupMovable(group, images)),
      );
      entry.content.style.opacity = String(group.opacity);
      entry.node.style.zIndex = String(group.zIndex + 100);
      if (bounds) {
        Object.assign(entry.node.style, {
          left: `${bounds.left}px`,
          top: `${bounds.top}px`,
          width: `${bounds.right - bounds.left}px`,
          height: `${bounds.bottom - bounds.top}px`,
        });
        Object.assign(entry.controls.style, {
          left: `${bounds.left}px`,
          top: `${bounds.top}px`,
          width: `${bounds.right - bounds.left}px`,
          height: `${bounds.bottom - bounds.top}px`,
        });
      }
      const renderable = layouts.get(group.id)!.renderable;
      effectTargets.push({ layer, element: entry.content, frame: rect, renderable, visibility() {} });
    }
    for (const item of images) {
      const entry = nodes.get(item.id);
      if (!entry) continue;
      const evaluated = layerLayouts.get(item.id)!,
        rect = evaluated.frame;
      const parent = parentGroup(groups, item.id);
      const visible = evaluated.visible,
        locked = evaluated.locked;
      entry.node.hidden = !visible || !rect;
      const selected = Boolean(editing?.selectedIds.includes(item.id));
      entry.controls.hidden = !selected || !visible || !rect;
      entry.node.toggleAttribute('data-selected', selected);
      entry.node.toggleAttribute('data-editable', Boolean(editing && !editing.locked && !locked));
      entry.node.tabIndex = editing && !locked ? 0 : -1;
      if (item.placement.anchor.kind === 'surface') {
        const id = item.placement.anchor.target;
        const target = anchors.find((candidate) => candidate.id === id);
        const element = target && doc.querySelector(`[data-ww-surface~="${target.surface}"]`);
        if (element) nextObserved.add(element);
      }
      if (!rect) {
        entry.media.update(item, false);
        continue;
      }
      const point = evaluated.position!,
        local = evaluated.localPosition!;
      Object.assign(entry.node.style, {
        left: `${local.x}px`,
        top: `${local.y}px`,
        width: `${item.placement.widthPx}px`,
        height: `${item.placement.heightPx}px`,
        transform: `translate(-50%, -50%) rotate(${item.placement.rotationDeg}deg)`,
        zIndex: String(item.zIndex + 100),
      });
      Object.assign(entry.controls.style, {
        left: `${point.x}px`,
        top: `${point.y}px`,
        width: `${item.placement.widthPx}px`,
        height: `${item.placement.heightPx}px`,
        transform: entry.node.style.transform,
      });
      entry.media.element.style.opacity = String(item.opacity);
      const renderable = evaluated.renderable;
      let previousVisibility: boolean | undefined;
      effectTargets.push({
        layer: item,
        element: entry.media.element,
        frame: rect,
        renderable,
        ...(parent ? { parentId: parent.id } : {}),
        visibility(value) {
          if (previousVisibility !== value) {
            previousVisibility = value;
            entry.media.update(item, value);
          }
        },
      });
      entry.controls.toggleAttribute('data-locked', locked);
      entry.controls.toggleAttribute(
        'data-transformable',
        Boolean(editing && !editing.locked && !locked && editing.selectedIds.length === 1),
      );
    }
    applyLayout(layout);
    effects?.update(effectTargets, { scene, geometry, layout, ...(gesture ? { holdTransforms: true } : {}) });
    if (observed.size !== nextObserved.size || [...nextObserved].some((element) => !observed.has(element))) {
      observer?.disconnect();
      nextObserved.forEach((element) => observer?.observe(element));
      observed = nextObserved;
    }
  };
  const refresh = () => {
    if (host && frame === undefined)
      frame = view.requestAnimationFrame(() => {
        frame = undefined;
        draw();
      });
  };

  const onPointerDown = (event: PointerEvent) => {
    if (!editing || editing.locked || event.button !== 0) return;
    const target = event.target instanceof Element ? event.target : undefined;
    const wrapper = target?.closest<HTMLDivElement>('[data-image-id], [data-frame-id]');
    const originalId = wrapper?.dataset.imageId ?? wrapper?.dataset.frameId;
    const parent = originalId && parentGroup(groups, originalId),
      additive = event.ctrlKey || event.metaKey || event.shiftKey;
    const id = parent && !additive && editing.selectedIds.includes(parent.id) ? parent.id : originalId;
    const group = groups.find((group) => group.id === id),
      item = group ?? images.find((image) => image.id === id);
    const node = id ? (compositions.get(id)?.node ?? nodes.get(id)?.node) : undefined;
    if (!node || !item || (group ? !groupMovable(group, images) : effectivelyLocked(item, groups))) return;
    event.preventDefault();
    event.stopPropagation();
    const mode = target?.getAttribute('data-handle') ?? 'move';
    if (group && mode !== 'move') return;
    if (mode === 'move') editing.select(item.id, additive, true);
    if (!editing.selectedIds.includes(item.id)) return;
    const authored = editableSceneSamples(doc, anchors, images, groups, editing.selectedIds);
    const samples = authored.map((sample) => {
      const entry = lastLayout?.layers.find((layer) => layer.layer.id === sample.id);
      return entry?.frame ? { ...sample, placement: { ...entry.layer.placement }, frame: entry.frame } : sample;
    });
    if (!samples.length || (mode !== 'move' && samples.length !== 1)) return;
    node.focus({ preventScroll: true });
    editing.begin();
    const parentAngles = new Map(
      samples.map((sample) => {
        const parent = parentGroup(groups, sample.id);
        return [
          sample.id,
          lastLayout?.groups.find((group) => group.layer.id === parent?.id)?.layer.placement.rotationDeg ?? 0,
        ];
      }),
    );
    gesture = {
      pointerId: event.pointerId,
      mode,
      samples,
      authored,
      parentAngles,
      point: { x: event.clientX, y: event.clientY },
    };
    draw();
    node.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent) => {
    if (!gesture || !editing || editing.locked || event.pointerId !== gesture.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const { mode, samples, point } = gesture;
    if (framesChanged(samples)) {
      finish(true);
      return;
    }
    const current = { x: event.clientX, y: event.clientY };
    const delta = { x: current.x - point.x, y: current.y - point.y };
    const first = samples[0]!;
    const change = (changes: readonly PlacementChange[]) =>
      editing!.change(
        changes.map((change) => {
          const start = samples.find((sample) => sample.id === change.id)!,
            base = gesture!.authored.find((sample) => sample.id === change.id)!,
            p = change.placement;
          const dx = (p.x - start.placement.x) * start.frame.width,
            dy = (p.y - start.placement.y) * start.frame.height,
            angle = ((gesture!.parentAngles.get(change.id) ?? 0) * Math.PI) / 180;
          return {
            id: change.id,
            placement: {
              ...base.placement,
              x: Math.max(
                0,
                Math.min(1, base.placement.x + (dx * Math.cos(angle) + dy * Math.sin(angle)) / base.frame.width),
              ),
              y: Math.max(
                0,
                Math.min(1, base.placement.y + (-dx * Math.sin(angle) + dy * Math.cos(angle)) / base.frame.height),
              ),
              widthPx: p.widthPx,
              heightPx: p.heightPx,
              rotationDeg: rotation(base.placement.rotationDeg + rotation(p.rotationDeg - start.placement.rotationDeg)),
            },
          };
        }),
      );
    if (mode === 'move') {
      const result =
        editing.snapping && !event.altKey
          ? snapMove(
              samples,
              delta,
              snapTargets(
                doc,
                anchors,
                lastLayout?.layers.map((entry) => entry.layer) ?? images,
                samples.map((sample) => sample.id),
                groups,
              ),
            )
          : { changes: moveGroup(samples, delta), guides: [] };
      drawGuides(result.guides);
      change(result.changes);
      return;
    }
    change([
      {
        id: first.id,
        placement:
          mode === 'rotate'
            ? rotatePlacement(first.placement, first.frame, point, current)
            : resizePlacement(
                first.placement,
                first.frame,
                delta,
                mode.endsWith('e') ? 1 : -1,
                mode.startsWith('s') ? 1 : -1,
              ),
      },
    ]);
  };
  const framesChanged = (samples: readonly PlacementSample[]) =>
    samples.some((sample) => {
      const rect = placementFrame(doc, anchors, sample.placement);
      return (
        !rect ||
        (['left', 'top', 'width', 'height'] as const).some((key) => Math.abs(rect[key] - sample.frame[key]) > 0.000001)
      );
    });
  const finish = (cancel = false) => {
    drawGuides([]);
    if (gesture) {
      gesture = undefined;
      editing?.end(cancel);
      draw();
    }
  };
  const onPointerUp = (event: PointerEvent) => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    event.stopPropagation();
    // Resize/SPA notifications can arrive after pointerup. Check the frame here too.
    finish(event.type !== 'pointerup' || framesChanged(gesture.samples));
  };
  const onBlur = () => finish(true);
  const onViewChange = () => {
    finish(true);
    refresh();
  };

  const mount = () => {
    host = doc.createElement('div');
    host.id = 'web-world-themes-decorations';
    shadow = host.attachShadow({ mode: 'open' });
    const style = doc.createElement('style');
    style.textContent = CSS;
    shadow.append(style);
    media = createMediaController(
      doc,
      (message) => editing?.error(message),
      (stats) => {
        if (host) host.dataset.wwMediaStats = JSON.stringify(stats);
      },
    );
    models = createModelRenderer(
      doc,
      (message) => editing?.error(message),
      (stats) => {
        if (host) host.dataset.wwModelStats = JSON.stringify(stats);
      },
      shadow,
    );
    effects = createEffectController(doc, playback, timeline, applyLayout, (frame) => models?.evaluate(frame));
    imageLayer = doc.createElement('div');
    imageLayer.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:0';
    shadow.append(imageLayer);
    groupFrame = doc.createElement('div');
    groupFrame.className = 'group-frame';
    groupFrame.hidden = true;
    shadow.append(groupFrame);
    guideNodes = Array.from({ length: 2 }, () => {
      const node = doc.createElement('div');
      node.className = 'guide';
      node.hidden = true;
      shadow!.append(node);
      return node;
    });
    shadow.addEventListener('pointerdown', onPointerDown as EventListener);
    shadow.addEventListener('pointermove', onPointerMove as EventListener);
    shadow.addEventListener('pointerup', onPointerUp as EventListener);
    shadow.addEventListener('pointercancel', onPointerUp as EventListener);
    shadow.addEventListener('lostpointercapture', () => finish(true));
    shadow.addEventListener('click', (event) => {
      if (editing) {
        event.preventDefault();
        event.stopPropagation();
      }
    });
    observer = new ResizeObserver(refresh);
    view.addEventListener('resize', onViewChange);
    view.addEventListener('blur', onBlur);
    doc.addEventListener('scroll', onViewChange, true);
    doc.addEventListener('fullscreenchange', onViewChange);
  };
  const destroy = () => {
    if (!host && nodes.size === 0) {
      images = [];
      groups = [];
      return;
    }
    effects?.destroy();
    effects = undefined;
    nodes.forEach((entry) => entry.media.destroy());
    models?.destroy();
    models = undefined;
    media?.destroy();
    media = undefined;
    clearAssetSources();
    gesture = undefined;
    if (frame !== undefined) view.cancelAnimationFrame(frame);
    frame = undefined;
    observer?.disconnect();
    observer = undefined;
    observed.clear();
    view.removeEventListener('resize', onViewChange);
    view.removeEventListener('blur', onBlur);
    doc.removeEventListener('scroll', onViewChange, true);
    doc.removeEventListener('fullscreenchange', onViewChange);
    host?.remove();
    host = undefined;
    shadow = undefined;
    groupFrame = undefined;
    imageLayer = undefined;
    guideNodes = [];
    nodes.clear();
    compositions.clear();
    images = [];
    groups = [];
    lastLayout = undefined;
  };
  return {
    update(next: readonly Decoration[], nextGroups: readonly GroupLayer[] = [], nextRules: readonly SignalRule[] = []) {
      if (!next.length) {
        destroy();
        return;
      }
      images = next;
      groups = nextGroups;
      signalRules = nextRules;
      if (!host) mount();
      const wanted = new Set(next.map((item) => item.id));
      for (const [id, entry] of nodes)
        if (!wanted.has(id)) {
          entry.media.destroy();
          entry.node.remove();
          entry.controls.remove();
          nodes.delete(id);
        }
      const wantedGroups = new Set(groups.map((group) => group.id));
      for (const [id, entry] of compositions)
        if (!wantedGroups.has(id)) {
          entry.node.remove();
          entry.controls.remove();
          compositions.delete(id);
        }
      for (const group of groups) {
        let entry = compositions.get(group.id);
        if (!entry) {
          const node = doc.createElement('div');
          node.className = 'composition';
          node.dataset.groupId = group.id;
          node.setAttribute('role', 'img');
          const content = doc.createElement('div');
          content.className = 'group-content';
          node.append(content);
          const controls = doc.createElement('div');
          controls.className = 'selection-frame';
          controls.dataset.frameId = group.id;
          controls.dataset.group = '';
          for (const side of ['top', 'right', 'bottom', 'left']) {
            const edge = doc.createElement('div');
            edge.className = 'group-edge';
            edge.dataset.groupEdge = side;
            controls.append(edge);
          }
          entry = { node, content, controls };
          compositions.set(group.id, entry);
          shadow!.append(controls);
        }
        entry.node.setAttribute('aria-label', group.name);
      }
      for (const item of next) {
        let entry = nodes.get(item.id);
        if (!entry) {
          const node = doc.createElement('div');
          node.className = 'image';
          node.dataset.imageId = item.id;
          node.setAttribute('role', 'img');
          node.setAttribute('aria-label', item.name);
          const content = item.kind === 'model3d' ? models!.attach(node) : media!.attach(node);
          const controls = doc.createElement('div');
          controls.className = 'selection-frame';
          controls.dataset.frameId = item.id;
          for (const [mode, label] of [
            ['nw', '左上でサイズ変更'],
            ['ne', '右上でサイズ変更'],
            ['sw', '左下でサイズ変更'],
            ['se', '右下でサイズ変更'],
            ['rotate', '画像を回転'],
          ]) {
            const handle = doc.createElement('button');
            handle.type = 'button';
            handle.className = 'handle';
            handle.dataset.handle = mode;
            handle.setAttribute('aria-label', label!);
            controls.append(handle);
          }
          entry = { node, controls, media: content };
          nodes.set(item.id, entry);
          imageLayer!.append(node);
          shadow!.append(controls);
        }
        entry.node.setAttribute('aria-label', item.name);
      }
      // Keep media nodes/decoders while parenting changes, and preserve scoped tie order.
      const place = (container: HTMLElement, ids: readonly string[]) =>
        ids.forEach((id, index) => {
          const node = nodes.get(id)?.node ?? compositions.get(id)!.node;
          if (container.children[index] !== node) container.insertBefore(node, container.children[index] ?? null);
        });
      groups.forEach((group) => place(compositions.get(group.id)!.content, group.children));
      place(
        imageLayer!,
        rootLayers(images, groups).map((layer) => layer.id),
      );
      draw();
    },
    edit(value: ImageEditing | undefined) {
      if (!value || value.locked || value.epoch !== editing?.epoch) {
        gesture = undefined;
        drawGuides([]);
      }
      editing = value;
      draw();
    },
    refresh,
    destroy,
  };
}
