import { captureGeometry } from '../../host/anchors';
import { LAYERING, WORLD_MODE } from '../../host/world-options';
import { evaluateLayout } from '../../world/layout';
import { legacyLayout } from './legacy-evaluation';
import { assertWorldParity } from './parity';
import { createModelRenderer } from '../three/models';
import { createMediaController } from '../../media/controller';
import type { AssetPort } from '../../assets/port';
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
import { renderModeOf, type DesignTarget, type Decoration, type GroupLayer } from '../../design/types';
import type { SignalRule } from '../../signals/keyframes';
import type { TimelineHost } from '../../host/timeline';
import type { WorldLayout } from '../../world/types';
import type { OperationGuardHost } from '../../host/operation-guard';
import type { OperationSource } from '../../host/operation-source';
import { ATMOSPHERE_ALPHA_CAP, pagePaintRegions, protectionClip } from '../../world/operations';

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

// Editing marks are ruled (docs/wwt-studio-design-system): 1px cobalt with a white edge, square
// handles. They use Gesso's values whatever the colour scheme, since they sit over any picture.
// Handles keep a 14px hit area around their 12px square; rotation is a square with its glyph,
// because a circle means 保存済み.
/**
 * A beneath paint needs no hold for a pending read when no control that is not proven to paint
 * over it is near (docs/layering-plan.md, chunk 4): within 40 px, the distance at which the G1.2
 * approach takes a control as near. Unknown places hold every paint, as before.
 */
const BENEATH_NEAR_PX = 40;
function beneathSettled(
  unproven: readonly { left: number; top: number; width: number; height: number }[] | 'everywhere',
  bounds: { left: number; top: number; right: number; bottom: number } | undefined,
) {
  if (unproven === 'everywhere' || !bounds) return false;
  return !unproven.some(
    (r) =>
      r.left < bounds.right + BENEATH_NEAR_PX &&
      r.left + r.width > bounds.left - BENEATH_NEAR_PX &&
      r.top < bounds.bottom + BENEATH_NEAR_PX &&
      r.top + r.height > bounds.top - BENEATH_NEAR_PX,
  );
}

const CSS = `
:host { --cobalt:#2b51b8; --ink-muted:#53575f; --edge:rgba(255,255,255,.85); --rotate:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 6 6'%3E%3Cpath d='M5 3A2 2 0 1 1 3 1' fill='none' stroke='black' stroke-width='1' stroke-linecap='round'/%3E%3Cpath d='M2.6 0L4.2 1L2.6 2Z'/%3E%3C/svg%3E"); }
:host { all:initial !important; position:fixed !important; inset:0 !important; width:100vw !important; height:100vh !important; margin:0 !important; padding:0 !important; border:0 !important; background:transparent !important; overflow:hidden !important; pointer-events:none !important; z-index:var(--ww-decoration-z,2147482000) !important; clip-path:var(--ww-decoration-clip,none) !important; }
* { box-sizing:border-box; }
.image, .selection-frame { position:absolute; transform-origin:center; pointer-events:none; touch-action:none; }
.composition { position:absolute; pointer-events:none; }
.group-content { position:absolute; inset:0; pointer-events:none; isolation:isolate; }
.selection-frame[data-group] { border-style:dashed; box-shadow:none; outline:1px dashed var(--edge); }
.group-edge { display:none; position:absolute; }
.selection-frame[data-group-movable] .group-edge { display:block; pointer-events:auto; cursor:move; }
[data-group-edge="top"], [data-group-edge="bottom"] { left:0; right:0; height:8px; }
[data-group-edge="top"] { top:-4px; } [data-group-edge="bottom"] { bottom:-4px; }
[data-group-edge="left"], [data-group-edge="right"] { top:0; bottom:0; width:8px; }
[data-group-edge="left"] { left:-4px; } [data-group-edge="right"] { right:-4px; }
[hidden] { display:none !important; }
.image[data-editable] { pointer-events:auto; cursor:move; }
.selection-frame { z-index:1000; border:1px solid var(--cobalt); box-shadow:0 0 0 1px var(--edge), inset 0 0 0 1px var(--edge); }
.selection-frame[data-locked] { border-color:var(--ink-muted); border-style:dashed; box-shadow:none; outline:1px dashed var(--edge); }
.group-frame { position:absolute; border:1px dashed var(--cobalt); box-shadow:0 0 0 1px var(--edge); pointer-events:none; z-index:1001; }
.guide { position:absolute; background:var(--cobalt); box-shadow:0 0 0 1px var(--edge); pointer-events:none; z-index:1002; }
.media, img, canvas, svg, video { display:block; width:100%; height:100%; border:0; user-select:none; pointer-events:none; }
.handle { display:none; position:absolute; width:14px; height:14px; padding:0; border:0; background:transparent; touch-action:none; }
.handle::before { content:''; position:absolute; inset:1px; box-sizing:border-box; border:1px solid var(--cobalt); background:white; box-shadow:0 0 0 1px var(--edge); }
[data-handle="rotate"]::after { content:''; position:absolute; inset:3px; background:var(--cobalt); -webkit-mask:var(--rotate) center / 100% 100% no-repeat; mask:var(--rotate) center / 100% 100% no-repeat; }
.selection-frame[data-transformable] .handle { display:block; pointer-events:auto; }
[data-handle="nw"] { left:-7px; top:-7px; cursor:nwse-resize; }
[data-handle="ne"] { right:-7px; top:-7px; cursor:nesw-resize; }
[data-handle="sw"] { left:-7px; bottom:-7px; cursor:nesw-resize; }
[data-handle="se"] { right:-7px; bottom:-7px; cursor:nwse-resize; }
[data-handle="rotate"] { left:calc(50% - 7px); top:-32px; cursor:grab; }
`;

// Plane hosts reuse the screen CSS; later !important rules in the same sheet win.
const PAGE_CSS =
  CSS +
  ':host{position:absolute!important;inset:auto!important;left:var(--ww-page-left,0)!important;top:var(--ww-page-top,0)!important;width:1px!important;height:1px!important;overflow:visible!important}';
// One opacity on the whole plane bounds the composite of any number of atmosphere layers.
const ATMOSPHERE_CSS =
  CSS +
  `:host{opacity:${ATMOSPHERE_ALPHA_CAP}!important;clip-path:none!important;filter:none!important}*{filter:none!important;backdrop-filter:none!important;box-shadow:none!important;text-shadow:none!important}.image,.image[data-editable],.composition{pointer-events:none!important}`;
// Under the content (an adapter's underlay slot), atmosphere covers nothing, so it needs neither
// the opacity cap nor the clip; it still takes no input and keeps the effect restrictions.
const UNDERLAY_CSS =
  CSS +
  `:host{clip-path:none!important;filter:none!important}*{filter:none!important;backdrop-filter:none!important;box-shadow:none!important;text-shadow:none!important}.image,.image[data-editable],.composition{pointer-events:none!important}`;
type Plane = { host: HTMLElement; content: HTMLElement; shadow: ShadowRoot; under?: boolean };
const ATMOSPHERE = 0,
  PAGE = 1,
  SCREEN = 2;

/** Shared layer layout/gestures; media decoding and playback live in media/. */
export function createImageRenderer(
  doc: Document,
  assets: AssetPort,
  anchors: readonly DesignTarget[],
  playback?: PlaybackSource,
  timeline?: TimelineHost,
  safety?: OperationGuardHost,
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
  let videoSlot:
    | {
        host: HTMLElement;
        content: HTMLElement;
        shadow: ShadowRoot;
        /** the selector written into its rule */ barsHidden?: string;
        /** the overlay cut-outs last written on its content */ contentClip?: string;
      }
    | undefined;
  let pagePlane: Plane | undefined, atmospherePlane: Plane | undefined;
  const createPlane = (id: string, css: string, gestures: boolean): Plane => {
    const planeHost = doc.createElement('div');
    planeHost.id = id;
    const planeShadow = planeHost.attachShadow({ mode: 'open' }),
      style = doc.createElement('style'),
      content = doc.createElement('div');
    style.textContent = css;
    content.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:0';
    planeShadow.append(style, content);
    if (gestures) wireGestures(planeShadow);
    return { host: planeHost, content, shadow: planeShadow };
  };
  // Document-origin offset of the page plane, corrected from its measured position.
  let pageOffset = { left: 0, top: 0 };
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

  // The last values written to the host; identical frames skip the attribute writes.
  let writtenClip = '',
    writtenSafety = '';
  let recordedIssues: unknown, recordedStopped: string | undefined;
  // Set when the effect session applies its final layout (and protection) inside a draw.
  let effectLayoutApplied = false;
  const applyLayout = (
    layout: WorldLayout,
    overlaySlot: ReturnType<OperationSource['overlaySlot']>,
    protect = true,
  ) => {
    lastLayout = layout;
    // Positions are collected first and written once at the end, after the plane adjustments
    // below, and only where they differ from what the element has: an unchanged frame writes
    // nothing, and no read in between sees half-written geometry (G1.3, c1).
    const staged = new Map<HTMLElement, Record<string, string>>();
    const stage = (element: HTMLElement, values: Record<string, string>) => {
      const current = staged.get(element);
      if (current) Object.assign(current, values);
      else staged.set(element, { ...values });
    };
    const stagedPx = (element: HTMLElement, key: 'left' | 'top') =>
      parseFloat(staged.get(element)?.[key] ?? element.style[key]);
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
      stage(entry.node, geometry);
      // A hidden handle (not selected for editing) is placed by the draw that shows it.
      if (!entry.controls.hidden) stage(entry.controls, geometry);
    }
    for (const layer of layout.layers) {
      const entry = nodes.get(layer.layer.id);
      if (!entry || !layer.frame || !layer.position || !layer.localPosition) continue;
      const p = layer.layer.placement,
        local = layer.localPosition,
        point = layer.position;
      const parentAngle = layer.parentId ? (parents.get(layer.parentId)?.layer.placement.rotationDeg ?? 0) : 0;
      const size = { width: `${p.widthPx}px`, height: `${p.heightPx}px` };
      stage(entry.node, {
        ...size,
        left: `${local.x}px`,
        top: `${local.y}px`,
        transform: `translate(-50%, -50%) rotate(${rotation(p.rotationDeg - parentAngle)}deg)`,
      });
      if (!entry.controls.hidden)
        stage(entry.controls, {
          ...size,
          left: `${point.x}px`,
          top: `${point.y}px`,
          transform: `translate(-50%, -50%) rotate(${p.rotationDeg}deg)`,
        });
    }
    if (safety && protect) {
      const roots = new Map([...layout.groups, ...layout.layers].map((entry) => [entry.layer.id, entry]));
      const needsVideoSlot =
        Boolean(doc.fullscreenElement) ||
        layout.roots.some((id) => {
          const anchor = roots.get(id)!.layer.placement.anchor;
          return anchor.kind === 'surface' && anchor.target === 'video-player';
        });
      // Chunk 4 prototype (LAYERING, docs/layering-plan.md): outside editing, the player's plane goes
      // under its controls by stacking order instead of over them with the bands cut out.
      // Locked editing takes no input on the artwork, so it is drawn as outside editing.
      const beneath =
        LAYERING && needsVideoSlot && !(editing && !editing.locked) ? safety.source.beneathSlot?.() : undefined;
      const slot = beneath
        ? { parent: beneath.parent, rect: beneath.rect, top: 0, bottom: 0, zIndex: beneath.zIndex }
        : needsVideoSlot
          ? safety.source.videoSlot()
          : undefined;
      // Which way each protected draw took, on the document (the trace build only).
      WW_GUARD_TRACE: if (LAYERING && needsVideoSlot) {
        const way = `${beneath ? 'beneath' : slot ? 'cutout' : 'none'}${editing ? (editing.locked ? '/locked' : '/editing') : ''}`;
        const seen = (doc.documentElement.dataset['wwLayeringWays'] ?? '').split('|').filter(Boolean);
        if (seen[seen.length - 1] !== way) doc.documentElement.dataset['wwLayeringWays'] = [...seen, way].join('|');
      }
      // Explicit editing only: the verified video centre (no menu, error or advert over it), where
      // screen- and page-plane handles may take input over the video. The bands and any native
      // control in the centre stay native: they are cut from the clip and refused at input time.
      const editorRegion = editing && !editing.locked ? safety.source.editorCentre() : undefined;
      // The screen overlay excludes complete scroll paths. This clip cannot
      // expose a moving native control during asynchronous compositor scroll; the editing
      // centre is the exception, and every gesture there is claimed after a fresh read.
      const { regions, path } = protectionClip(safety.source.capture(), Boolean(editing), editorRegion);
      const clip = path ? `path('${path}')` : 'inset(100%)';
      if (clip !== writtenClip || host!.style.getPropertyValue('--ww-decoration-clip') !== clip) {
        host!.style.setProperty('--ww-decoration-clip', clip);
        writtenClip = clip;
      }
      // Read once at the start of this draw, before this renderer's own writes.
      const overlaySupported = Boolean(overlaySlot);
      const videoAnchored = (id: string) => {
        const anchor = roots.get(id)!.layer.placement.anchor;
        return anchor.kind === 'surface' && anchor.target === 'video-player';
      };
      // Fullscreen has one native plane: every root stays local, atmosphere included.
      const fullscreenPlane = Boolean(slot && slot.parent === doc.fullscreenElement);
      const atmosphereRoot = (id: string) => renderModeOf(roots.get(id)!.layer) === 'atmosphere';
      // Any root anchored to page content scrolls with the page; the player alone has its own
      // local plane first. Viewport-anchored roots are screen-fixed by definition.
      const pageAnchored = (id: string) => roots.get(id)!.layer.placement.anchor.kind === 'surface';
      const pageSlot =
        overlaySlot &&
        !doc.fullscreenElement &&
        layout.roots.some((id) => pageAnchored(id) && !atmosphereRoot(id) && !(slot && videoAnchored(id)))
          ? safety.source.pageSlot()
          : undefined;
      const rootBounds = (id: string) =>
        layout.layers
          .filter((l) => (l.parentId ?? l.layer.id) === id && l.bounds)
          .map((l) => l.bounds!)
          .reduce<{ left: number; top: number; right: number; bottom: number } | undefined>(
            (u, b) =>
              u
                ? {
                    left: Math.min(u.left, b.left),
                    top: Math.min(u.top, b.top),
                    right: Math.max(u.right, b.right),
                    bottom: Math.max(u.bottom, b.bottom),
                  }
                : { ...b },
            undefined,
          );
      const localRoots = new Set(
        slot
          ? // The player-local plane keeps its native-underlay order; only when it is unavailable
            // does a player-anchored root follow the page instead of the screen plane.
            layout.roots.filter((id) => fullscreenPlane || (videoAnchored(id) && !atmosphereRoot(id)))
          : [],
      );
      // Planes stack atmosphere < page < screen. A root never moves below an earlier root:
      // one that would is drawn on the screen plane as normal, clipped artwork.
      const planes = new Map<string, number>();
      let floor = ATMOSPHERE;
      for (const id of layout.roots) {
        if (localRoots.has(id)) continue;
        let plane = atmosphereRoot(id) && overlaySlot ? ATMOSPHERE : pageAnchored(id) && pageSlot ? PAGE : SCREEN;
        if (plane < floor) plane = SCREEN;
        floor = plane;
        planes.set(id, plane);
      }
      const inPlane = (id: string, plane: number) => planes.get(id) === plane;
      const used = new Set(planes.values());
      // Fullscreen keeps every root in the player's own plane; the underlay is the page's.
      const underlay = used.has(ATMOSPHERE) && !doc.fullscreenElement ? safety.source.underlaySlot() : undefined;
      if (atmospherePlane && Boolean(atmospherePlane.under) !== Boolean(underlay)) {
        // The two places use different CSS (the cap); rebuild rather than restyle in place.
        atmospherePlane.host.remove();
        atmospherePlane = undefined;
      }
      if (used.has(ATMOSPHERE) && !atmospherePlane) {
        atmospherePlane = createPlane(
          'web-world-themes-atmosphere-decorations',
          underlay ? UNDERLAY_CSS : ATMOSPHERE_CSS,
          false,
        );
        atmospherePlane.under = Boolean(underlay);
      }
      if (used.has(PAGE)) pagePlane ??= createPlane('web-world-themes-page-decorations', PAGE_CSS, true);
      const parent = host!.parentElement;
      // DOM order in the shared overlay parent is the paint order: atmosphere, page, screen.
      for (const [plane, value] of [
        [pagePlane, PAGE],
        [atmospherePlane, ATMOSPHERE],
      ] as const) {
        if (!plane) continue;
        if (!used.has(value) || !parent) {
          plane.host.remove();
          continue;
        }
        if (value === ATMOSPHERE && underlay) {
          // First in its parent: painted before (under) every sibling of the same stacking level.
          if (plane.host.parentElement !== underlay.parent || plane.host !== underlay.parent.firstChild)
            underlay.parent.insertBefore(plane.host, underlay.parent.firstChild);
          plane.host.style.setProperty('--ww-decoration-z', String(underlay.zIndex));
          continue;
        }
        const before = value === PAGE ? host! : (used.has(PAGE) && pagePlane?.host) || host!;
        if (plane.host.parentElement !== parent || plane.host.nextSibling !== before)
          parent.insertBefore(plane.host, before);
        if (overlaySlot) plane.host.style.setProperty('--ww-decoration-z', String(overlaySlot.zIndex));
      }
      if (!used.has(PAGE)) pagePlane = undefined;
      if (!used.has(ATMOSPHERE)) atmospherePlane = undefined;
      // Reading scroll offsets forces layout after this draw's writes; only the page plane needs them.
      const scroll = pagePlane ? { x: view.scrollX, y: view.scrollY } : { x: 0, y: 0 };
      let pageRegions: ReturnType<typeof pagePaintRegions> = [];
      if (pagePlane) {
        // Place the plane's origin at the document origin, whatever its containing block.
        const r = pagePlane.host.getBoundingClientRect(),
          dx = -scroll.x - r.left,
          dy = -scroll.y - r.top;
        if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) {
          pageOffset = { left: pageOffset.left + dx, top: pageOffset.top + dy };
          pagePlane.host.style.setProperty('--ww-page-left', `${pageOffset.left}px`);
          pagePlane.host.style.setProperty('--ww-page-top', `${pageOffset.top}px`);
        }
        const bounds = layout.roots
          .filter((id) => inPlane(id, PAGE))
          .map(rootBounds)
          .filter((b) => b !== undefined);
        const area = bounds.length
          ? {
              left: Math.min(...bounds.map((b) => b.left)) - 1,
              top: Math.min(...bounds.map((b) => b.top)) - 1,
              width: Math.max(...bounds.map((b) => b.right)) - Math.min(...bounds.map((b) => b.left)) + 2,
              height: Math.max(...bounds.map((b) => b.bottom)) - Math.min(...bounds.map((b) => b.top)) + 2,
            }
          : { left: 0, top: 0, width: 0, height: 0 };
        pageRegions = pagePaintRegions(safety.source.capture(), Boolean(editing), area, editorRegion);
        const pagePath = pageRegions
          .map((r) => `M${r.left + scroll.x} ${r.top + scroll.y}h${r.width}v${r.height}h${-r.width}Z`)
          .join('');
        const pageClip = pagePath ? `path('${pagePath}')` : 'inset(100%)';
        if (pagePlane.host.style.getPropertyValue('--ww-decoration-clip') !== pageClip)
          pagePlane.host.style.setProperty('--ww-decoration-clip', pageClip);
      }
      if (localRoots.size && !videoSlot) {
        const localHost = doc.createElement('div');
        localHost.id = 'web-world-themes-video-decorations';
        const localShadow = localHost.attachShadow({ mode: 'open' }),
          style = doc.createElement('style'),
          content = doc.createElement('div');
        style.textContent =
          CSS +
          ':host{position:absolute!important;inset:0!important;width:100%!important;height:100%!important;z-index:var(--ww-local-z,1)!important}.image{pointer-events:none!important}.image[data-editable]{pointer-events:auto!important}';
        content.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:0';
        localShadow.append(style, content);
        wireGestures(localShadow);
        videoSlot = { host: localHost, content, shadow: localShadow };
      }
      if (slot && videoSlot) {
        if (beneath) {
          // Directly after the media, at its level: the proofs (paintsAbove) are made against the
          // media and hold for this plane only while nothing of the player's sits in between.
          // A rebuilt player or a moved media is followed here, from this draw's own read.
          if (
            videoSlot.host.parentElement !== beneath.parent ||
            videoSlot.host.previousElementSibling !== beneath.after
          )
            beneath.parent.insertBefore(videoSlot.host, beneath.after.nextSibling);
        } else if (videoSlot.host.parentElement !== slot.parent) slot.parent.append(videoSlot.host);
        videoSlot.host.style.setProperty('--ww-decoration-clip', `inset(${slot.top}px 0 ${slot.bottom}px 0)`);
        videoSlot.host.style.setProperty('--ww-local-z', String(slot.zIndex));
        // What can be pressed over the picture (end screen cards, the "next" card, the cards
        // teaser, products, an advert's links) is normally above this plane by stacking order.
        // So it stays clear even where an overlay's own z-index were lower: the plane's content
        // is clipped around every visible pressable overlay too (an intersection with the band
        // clip on the host, which keeps the bars' class switch exact). The player's own bars and
        // its whole-player gesture surface are the bands' business, not holes here.
        const holes = safety.source
          .capture()
          .surfaces.filter(
            (surface) =>
              surface.id.startsWith('player.overlay.') &&
              !(beneath && surface.aboveBeneath) &&
              surface.availability.visible &&
              surface.shape.width > 0 &&
              surface.shape.height > 0,
          )
          .map((surface) => {
            const s = surface.protectedEnvelope;
            const x = Math.round(s.left - slot.rect.left),
              y = Math.round(s.top - slot.rect.top);
            return `M${x} ${y}h${Math.round(s.width)}v${Math.round(s.height)}h${-Math.round(s.width)}Z`;
          });
        const w = Math.ceil(slot.rect.width),
          h = Math.ceil(slot.rect.height);
        const contentClip = holes.length ? `path(evenodd, "M0 0H${w}V${h}H0Z${holes.join('')}")` : '';
        // Compared with what was written (the browser normalises the style's own text).
        if (videoSlot.contentClip !== contentClip) {
          videoSlot.contentClip = contentClip;
          videoSlot.content.style.clipPath = contentClip;
        }
        // G1, the control bands only while the bars are shown (chunk 3, docs/autonomy-plan.md):
        // the band clip above stays the default. Only while the player carries the adapter's
        // "bars hidden" class does the plane drop it, and that is decided by the browser's own
        // style recalculation, not by this draw: when the class goes, the clip is back for the
        // very frame the bars start to appear, whatever the timing of our rAF or observers.
        // Class names only (the adapter's, checked here): never a selector of anyone else's. Under
        // any "kept" class (an advert showing its own parts in the bands) the clip stays.
        const name = /^[A-Za-z][\w-]*$/;
        const hidden = slot.barsHiddenClass && name.test(slot.barsHiddenClass) ? slot.barsHiddenClass : '';
        const kept = (slot.barsKeptClasses ?? []).filter((c) => name.test(c));
        const selector = hidden ? `.${hidden}${kept.map((c) => `:not(.${c})`).join('')}` : '';
        if (videoSlot.barsHidden !== selector) {
          videoSlot.barsHidden = selector;
          let rule = videoSlot.shadow.querySelector<HTMLStyleElement>('style[data-bars]');
          if (!rule) {
            rule = doc.createElement('style');
            rule.dataset['bars'] = '';
            videoSlot.shadow.append(rule);
          }
          rule.textContent = selector ? `:host-context(${selector}){clip-path:none!important}` : '';
        }
      }
      // One presentation container preserves scoped z-index/tie ordering and
      // keeps a group's masks/opacity on the original, un-cloned subtree.
      let localIndex = 0,
        globalIndex = 0;
      let pageIndex = 0,
        atmosphereIndex = 0;
      for (const id of layout.roots) {
        const node = nodes.get(id)?.node ?? compositions.get(id)!.node;
        const local = localRoots.has(id),
          page = inPlane(id, PAGE),
          atmosphere = inPlane(id, ATMOSPHERE),
          container = local
            ? videoSlot!.content
            : page
              ? pagePlane!.content
              : atmosphere
                ? atmospherePlane!.content
                : imageLayer!,
          index = local ? localIndex++ : page ? pageIndex++ : atmosphere ? atmosphereIndex++ : globalIndex++;
        if (container.children[index] !== node) container.insertBefore(node, container.children[index] ?? null);
        if (local && slot)
          stage(node, {
            left: stagedPx(node, 'left') - slot.rect.left + 'px',
            top: stagedPx(node, 'top') - slot.rect.top + 'px',
          });
        if (page)
          stage(node, {
            left: stagedPx(node, 'left') + scroll.x + 'px',
            top: stagedPx(node, 'top') + scroll.y + 'px',
          });
      }
      // Editor handles own only their visible authored bounds, inside the same
      // native clip. Drag/volume bands never become editor-owned.
      // One lookup table per layout, not a search of every layer per handle (c2).
      const parentIds = new Map(layout.layers.map((l) => [l.layer.id, l.parentId]));
      // The maps are keyed by the handle's frame id (data-frame-id), which a DOM read would repeat.
      for (const [id, entry] of [...nodes, ...compositions]) {
        const parentId = parentIds.get(id);
        const local = localRoots.has(parentId ?? id),
          page = inPlane(parentId ?? id, PAGE),
          root = local ? videoSlot!.shadow : page ? pagePlane!.shadow : shadow!;
        if (entry.controls.parentNode !== root) root.append(entry.controls);
        if (entry.controls.hidden) continue;
        if (local && slot)
          stage(entry.controls, {
            left: stagedPx(entry.controls, 'left') - slot.rect.left + 'px',
            top: stagedPx(entry.controls, 'top') - slot.rect.top + 'px',
          });
        if (page)
          stage(entry.controls, {
            left: stagedPx(entry.controls, 'left') + scroll.x + 'px',
            top: stagedPx(entry.controls, 'top') + scroll.y + 'px',
          });
      }
      if (!localRoots.size) {
        videoSlot?.host.remove();
        videoSlot = undefined;
      }
      const localIds = new Set<string>();
      for (const layer of layout.layers) {
        const entry = nodes.get(layer.layer.id);
        if (!entry) continue;
        if (localRoots.has(layer.parentId ?? layer.layer.id)) {
          localIds.add(layer.layer.id);
        }
      }
      const blocked = safety.commit(
        layout.layers
          .filter((l) => l.layer.visible && (!l.frame || l.visible))
          .map((layer) => {
            const root = layer.parentId ?? layer.layer.id,
              local = localIds.has(layer.layer.id),
              atmosphere = inPlane(root, ATMOSPHERE),
              page = inPlane(root, PAGE);
            const verified =
              Boolean(layer.frame) &&
              overlaySupported &&
              (local || atmosphere || (page ? pageRegions.length > 0 : regions.length > 0));
            return {
              id: layer.layer.id,
              root,
              ...(layer.layer.name ? { name: layer.layer.name } : {}),
              bounds: layer.bounds ?? { left: 0, top: 0, right: 0, bottom: 0 },
              opacity: layer.effectiveOpacity,
              // The atmosphere plane takes no input; its handles stay on the clipped screen plane.
              pointerEvents: !atmosphere && Boolean(editing && !editing.locked && !layer.locked),
              editorOwned:
                Boolean(editing && !editing.locked && !layer.locked) &&
                (local || (!atmosphere && editorRegion !== undefined)),
              ...(editorRegion && !local && !atmosphere ? { editorRegion } : {}),
              outset: 0,
              composition: !verified
                ? ('unsupported' as const)
                : local
                  ? beneath
                    ? ('native-beneath' as const)
                    : ('native-underlay' as const)
                  : atmosphere
                    ? ('atmosphere' as const)
                    : page
                      ? ('page' as const)
                      : ('overlay' as const),
              dynamic: Boolean(
                layer.layer.motion?.enabled ||
                (layer.parentId && parents.get(layer.parentId)?.layer.motion?.enabled) ||
                signalRules.some(
                  (r) => r.enabled && (r.target.layerId === layer.layer.id || r.target.layerId === layer.parentId),
                ) ||
                (layer.layer.kind === 'model3d' && (layer.layer.model.playing || layer.layer.model.look.enabled)),
              ),
              animated:
                layer.layer.kind === 'animation' ||
                Boolean(layer.layer.effects?.some((e) => e.enabled && e.bindings.length)),
              ...(localIds.has(layer.layer.id) && beneath
                ? { settled: beneathSettled(beneath.unproven, layer.bounds) }
                : {}),
              ...(localIds.has(layer.layer.id) && slot
                ? {
                    clip: {
                      left: slot.rect.left,
                      top: slot.rect.top + slot.top,
                      width: slot.rect.width,
                      height: slot.rect.height - slot.top - slot.bottom,
                    },
                  }
                : {}),
            };
          }),
      );
      // The guard keeps the same issues array while nothing changed: serialise only on a change (c3).
      const status = safety.snapshot();
      if (
        status.issues !== recordedIssues ||
        status.stopped !== recordedStopped ||
        host!.dataset.wwSafety !== writtenSafety
      ) {
        const record = JSON.stringify({ stopped: status.stopped, issues: status.issues });
        recordedIssues = status.issues;
        recordedStopped = status.stopped;
        if (record !== writtenSafety || host!.dataset.wwSafety !== record) {
          host!.dataset.wwSafety = record;
          writtenSafety = record;
        }
      }
      for (const layer of layout.layers) {
        const entry = nodes.get(layer.layer.id);
        if (!entry) continue;
        // The native-owned clip is the final paint boundary, including any
        // future blur/shadow spill. No page-sized stale rectangular hole mask.
        const stopped = blocked.has(layer.layer.id),
          wasStopped = entry.node.hasAttribute('data-safety-limited');
        if (entry.node.style.visibility !== (stopped ? 'hidden' : ''))
          entry.node.style.visibility = stopped ? 'hidden' : '';
        if (entry.node.hasAttribute('data-safety-limited') !== stopped)
          entry.node.toggleAttribute('data-safety-limited', stopped);
        if (entry.node.style.pointerEvents !== (stopped ? 'none' : ''))
          entry.node.style.pointerEvents = stopped ? 'none' : '';
        if (stopped) entry.controls.hidden = true;
        // Media is paused once when a stop begins and restarted once when it ends, even if no
        // effect frame follows; held frames in between do no media work.
        if (stopped && !wasStopped) entry.media.update(layer.layer, false);
        else if (!stopped && wasStopped) entry.media.update(layer.layer, layer.visible);
      }
    }
    // Reading an inline value is a declaration lookup, not a style or layout read.
    for (const [element, values] of staged)
      for (const key in values)
        if (element.style.getPropertyValue(key) !== values[key]) element.style.setProperty(key, values[key]!);
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
    safety?.sample(view.performance.now());
    const overlaySlot = safety?.source.overlaySlot();
    const parent = overlaySlot?.parent ?? doc.fullscreenElement ?? doc.body ?? doc.documentElement;
    if (overlaySlot) host.style.setProperty('--ww-decoration-z', String(overlaySlot.zIndex));
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
          // A layer stopped by protection stays paused; the protection pass resumes it.
          if (value && entry.node.hasAttribute('data-safety-limited')) return;
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
    // Protection is decided once per draw, on the last layout applied before paint: the effect
    // session's when it applies synchronously, otherwise this draw's own (always, even on error).
    applyLayout(layout, overlaySlot, false);
    effectLayoutApplied = false;
    try {
      effects?.update(effectTargets, {
        scene,
        geometry,
        layout,
        ...(safety ? { safety } : {}),
        ...(gesture ? { holdTransforms: true } : {}),
      });
    } finally {
      if (!effectLayoutApplied) applyLayout(layout, overlaySlot);
    }
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
    // A handle can lag behind native geometry (an asynchronous scroll moves the page under the
    // screen plane). A fresh read must find no protected control under the point; otherwise the
    // guard hides the artwork and the next press reaches the native control.
    if (safety && !safety.claim({ x: event.clientX, y: event.clientY })) return;
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

  const wireGestures = (root: ShadowRoot) => {
    root.addEventListener('pointerdown', onPointerDown as EventListener);
    root.addEventListener('pointermove', onPointerMove as EventListener);
    root.addEventListener('pointerup', onPointerUp as EventListener);
    root.addEventListener('pointercancel', onPointerUp as EventListener);
    root.addEventListener('lostpointercapture', () => finish(true));
    root.addEventListener('click', (event) => {
      if (editing) {
        event.preventDefault();
        event.stopPropagation();
      }
    });
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
      assets.load,
      (message) => editing?.error(message),
      (stats) => {
        if (host) host.dataset.wwMediaStats = JSON.stringify(stats);
      },
    );
    models = createModelRenderer(
      doc,
      (message) => {
        editing?.error(message);
        if (message.includes('コンテキスト')) safety?.pause(message);
      },
      (stats) => {
        if (host) host.dataset.wwModelStats = JSON.stringify(stats);
      },
      shadow,
      assets.load,
      undefined,
      () =>
        safety?.pause(
          'ブラウザーが3Dの描画を打ち切ったため、3Dモデルの表示を止めました。',
          true,
          images.filter((i) => i.kind === 'model3d').map((i) => i.id),
          [],
          'しばらくすると、自動で描き直します。',
        ),
    );
    effects = createEffectController(
      doc,
      playback,
      timeline,
      // Effect frames run outside draw(), so they read the composition slot themselves.
      (layout) => {
        effectLayoutApplied = true;
        applyLayout(layout, safety?.source.overlaySlot());
      },
      (frame) => models?.evaluate(frame),
      // The slot reads computed styles of the overlay's ancestors; read before this frame's style
      // writes, the read needs no style recalculation, and the layout below reuses it (same task).
      () => safety?.source.overlaySlot(),
    );
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
    wireGestures(shadow);
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
    assets.clear();
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
    videoSlot?.host.remove();
    videoSlot = undefined;
    pagePlane?.host.remove();
    atmospherePlane?.host.remove();
    pagePlane = atmospherePlane = undefined;
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
      // Roots drawn on another plane stay there: moving a node out and back (as draw() would)
      // drops its pointer capture and cancels an editor gesture in progress.
      const planeContents = new Set([videoSlot?.content, pagePlane?.content, atmospherePlane?.content]);
      place(
        imageLayer!,
        rootLayers(images, groups)
          .map((layer) => layer.id)
          .filter(
            (id) => !planeContents.has((nodes.get(id)?.node ?? compositions.get(id)!.node).parentElement ?? undefined),
          ),
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
    holdSafety(layerIds?: readonly string[]) {
      nodes.forEach((entry, id) => {
        if (layerIds && !layerIds.includes(id)) return;
        entry.node.style.visibility = 'hidden';
        entry.controls.hidden = true;
      });
      compositions.forEach((entry) => {
        entry.controls.hidden = true;
      });
      if (groupFrame) groupFrame.hidden = true;
    },
    destroy,
  };
}
