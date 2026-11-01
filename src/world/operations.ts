import type { Bounds, PlacementFrame, Point } from './geometry';

/** Host-owned numbers. Artwork cannot supply or relax this contract. */
export interface OperationSurface {
  id: string;
  owner: 'native' | 'engine' | 'editor';
  generation: { documentId: number; geometry: number };
  kind: 'click' | 'text-input' | 'drag' | 'gesture' | 'native-menu';
  shape: PlacementFrame;
  protectedEnvelope: PlacementFrame;
  availability: {
    present: boolean;
    visible: boolean;
    disabled: boolean;
    focused: boolean;
    editing: boolean;
    dragging: boolean;
    captured: boolean;
  };
  policy: { transform: 'fixed-plane'; occlusion: 'forbid' | 'allow'; input: 'native-only' };
  compositionCapability: 'exclusion' | 'native-underlay' | 'native-above' | 'unsupported';
  /** Full possible vertical scroll path for a screen-fixed overlay. */
  scrolls: boolean;
  /** Clip box of an inner scroll container between this surface and the page. The surface
   * can move anywhere inside it without the page moving, so a page-following plane
   * excludes the whole box instead of the current rectangle. */
  scrollBox?: PlacementFrame;
}
export interface OperationSnapshot {
  generation: { documentId: number; geometry: number };
  viewport: { width: number; height: number };
  surfaces: readonly OperationSurface[];
  supported: boolean;
}
export interface SafetyIssue {
  action?: 'clip' | 'stop' | 'flatten';
  layerId: string;
  surfaceId: string;
  severity: 'enforced' | 'advice';
  reason: string;
  remedy: string;
}
export interface PaintFootprint {
  /** Issued only by the renderer during explicit editor ownership, never artwork. */
  editorOwned?: boolean;
  /** Renderer-issued, explicit editing only: the verified video centre (the player minus its
   * control bands) where an editor-owned screen-plane paint may take input over the video. */
  editorRegion?: PlacementFrame;
  dynamic?: boolean;
  animated?: boolean;
  clip?: PlacementFrame;
  id: string;
  /** The layer's name as the creator sees it, for stop messages only (shown as text). */
  name?: string;
  bounds: Bounds;
  opacity: number;
  pointerEvents: boolean;
  /** Includes filter/blur/shadow spread. Unknown spread is unsupported. */
  outset: number;
  /** overlay: screen-fixed plane. page: plane that scrolls with the document. atmosphere:
   * translucent plane under ATMOSPHERE_ALPHA_CAP. native-underlay: player-local plane. */
  composition: 'overlay' | 'page' | 'atmosphere' | 'native-underlay' | 'unsupported';
}
/** Engine-held, never stored in artwork. Worst-case uniform tint at this alpha keeps
 * YouTube primary text at >= 4.5:1 and secondary text at >= 3:1 in light and dark themes. */
export const ATMOSPHERE_ALPHA_CAP = 0.33;
const UNBOUNDED = 1e7;
/** Where a surface can be, as seen from a plane, during asynchronous scroll. */
function pageEnvelope(surface: OperationSurface): PlacementFrame {
  if (!surface.scrolls)
    return {
      left: surface.protectedEnvelope.left,
      width: surface.protectedEnvelope.width,
      top: -UNBOUNDED,
      height: 2 * UNBOUNDED,
    };
  return surface.scrollBox ?? surface.protectedEnvelope;
}
export const intersects = (a: Bounds, b: PlacementFrame) =>
  a.right > b.left && a.left < b.left + b.width && a.bottom > b.top && a.top < b.top + b.height;
/** Visible surfaces with both possible envelopes. Snapshots are immutable, so one read
 * serves every paint and every frame until the source issues a new snapshot. */
const visibleEnvelopes = new WeakMap<
  OperationSnapshot,
  readonly { surface: OperationSurface; envelope: PlacementFrame; swept: PlacementFrame; page: PlacementFrame }[]
>();
function envelopesOf(snapshot: OperationSnapshot) {
  let rows = visibleEnvelopes.get(snapshot);
  if (!rows) {
    rows = snapshot.surfaces
      .filter((surface) => surface.availability.visible)
      .map((surface) => ({
        surface,
        envelope: surface.protectedEnvelope,
        swept: surface.scrolls
          ? { ...surface.protectedEnvelope, top: 0, height: snapshot.viewport.height }
          : surface.protectedEnvelope,
        page: pageEnvelope(surface),
      }));
    visibleEnvelopes.set(snapshot, rows);
  }
  return rows;
}
export function guardPaint(snapshot: OperationSnapshot, paints: readonly PaintFootprint[]): SafetyIssue[] {
  const issues: SafetyIssue[] = [];
  const visible = envelopesOf(snapshot);
  for (const paint of paints) {
    if (paint.opacity <= 0 && !paint.pointerEvents) continue;
    if (
      !snapshot.supported ||
      paint.composition === 'unsupported' ||
      !Number.isFinite(paint.opacity) ||
      !Number.isFinite(paint.outset) ||
      paint.outset < 0 ||
      !Object.values(paint.bounds).every(Number.isFinite)
    ) {
      issues.push({
        layerId: paint.id,
        surfaceId: 'unknown',
        severity: 'enforced',
        reason: '操作面・配置基準・合成方法のいずれかを確認できません。',
        remedy: '対応する配置基準へ移すか、ページが安定するまで待ってください。',
      });
      continue;
    }
    if (paint.composition === 'atmosphere') {
      // The plane caps the composite alpha of all its layers, has no filters and takes no
      // input; it may cross protected surfaces, so only input capture is a violation.
      if (paint.pointerEvents)
        issues.push({
          layerId: paint.id,
          surfaceId: 'atmosphere',
          severity: 'enforced',
          action: 'stop',
          reason: '雰囲気レイヤーは入力を受け取れません。',
          remedy: '操作を受け取る必要がある素材は通常の描画モードにしてください。',
        });
      continue;
    }
    const bounds = {
      left: paint.bounds.left - paint.outset,
      top: paint.bounds.top - paint.outset,
      right: paint.bounds.right + paint.outset,
      bottom: paint.bounds.bottom + paint.outset,
    };
    if (paint.composition === 'native-underlay') {
      if (!paint.clip || !Object.values(paint.clip).every(Number.isFinite)) {
        issues.push({
          layerId: paint.id,
          surfaceId: 'player',
          severity: 'enforced',
          action: 'stop',
          reason: '映像上の描画にはネイティブと一緒に動くクリップが必要です。',
          remedy: 'プレイヤー基準の単独レイヤーへ戻してください。',
        });
        continue;
      }
      const clip = paint.clip;
      if (
        bounds.left < clip.left ||
        bounds.top < clip.top ||
        bounds.right > clip.left + clip.width ||
        bounds.bottom > clip.top + clip.height
      )
        issues.push({
          layerId: paint.id,
          surfaceId: 'player.controls',
          severity: 'enforced',
          action: 'clip',
          reason: 'プレイヤーの操作部にかかる部分をクリップしています。',
          remedy: '映像の中央寄りへ動かすか、大きさを小さくしてください。',
        });
      bounds.left = Math.max(bounds.left, clip.left);
      bounds.right = Math.min(bounds.right, clip.left + clip.width);
      bounds.top = Math.max(bounds.top, clip.top);
      bounds.bottom = Math.min(bounds.bottom, clip.top + clip.height);
      if (bounds.left >= bounds.right || bounds.top >= bounds.bottom) continue;
    }
    const planeCovers = paint.composition === 'overlay' || paint.composition === 'page';
    // An editor-owned screen- or page-plane paint wholly inside the verified video centre: there
    // the clip cuts current rectangles, and input is claimed only after a fresh read (editorClaims).
    const centre =
      paint.editorOwned && planeCovers && paint.editorRegion !== undefined && contains(paint.editorRegion, bounds);
    for (const { surface, envelope: fixed, swept, page } of visible) {
      const envelope =
        !planeCovers || surface.compositionCapability === 'native-above'
          ? fixed
          : paint.composition === 'page'
            ? page
            : centre
              ? fixed
              : swept;
      if (!intersects(bounds, envelope)) continue;
      // The stacking proof is relative to the screen overlay. A player-local
      // subtree must still check every native control in that player's plane.
      if (surface.compositionCapability === 'native-above' && planeCovers) {
        issues.push({
          layerId: paint.id,
          surfaceId: surface.id,
          severity: 'enforced',
          action: 'clip',
          reason: '操作面が前に残る合成順のため、重なる装飾やハンドルは背後に置いています。',
          remedy: '保護範囲の外へ位置・大きさを変えてください。',
        });
        break;
      }
      const ownsVideoInput =
        paint.editorOwned &&
        (paint.composition === 'native-underlay' || centre) &&
        surface.policy.occlusion === 'allow';
      if ((paint.pointerEvents && !ownsVideoInput) || surface.policy.occlusion === 'forbid') {
        issues.push({
          layerId: paint.id,
          surfaceId: surface.id,
          severity: 'enforced',
          action: planeCovers ? 'clip' : 'stop',
          reason: paint.pointerEvents
            ? '制作ハンドルが本物の操作を奪う位置です。'
            : '操作面の前面を覆う部分をクリップしました。影・ぼかしの範囲も含みます。',
          remedy: '保護範囲の外へ位置・大きさを変えてください。映像上の非操作描画にはプレイヤー基準を使えます。',
        });
        break;
      }
    }
  }
  return issues;
}

const contains = (frame: PlacementFrame, b: Bounds) =>
  b.left >= frame.left &&
  b.top >= frame.top &&
  b.right <= frame.left + frame.width &&
  b.bottom <= frame.top + frame.height;
/** Disjoint safe rectangles, including the entire swept scroll envelope.
 * The compositor clips the final output (filters included), not sampled pixels.
 * editorRegion (explicit editing only): the verified video centre is reopened, cut only by the
 * current rectangles of protected surfaces. A screen-plane handle there can lag behind an
 * asynchronous scroll, so every gesture on it is claimed after a fresh read (editorClaims).
 */
export function safePaintRegions(
  snapshot: OperationSnapshot,
  editing: boolean,
  editorRegion?: PlacementFrame,
): PlacementFrame[] {
  if (!snapshot.supported) return [];
  const regions = sweptRegions(snapshot, editing);
  if (!editing || !editorRegion || !regions.length) return regions;
  let centre = [editorRegion];
  for (const surface of snapshot.surfaces) {
    if (
      !surface.availability.visible ||
      surface.compositionCapability === 'native-above' ||
      surface.policy.occlusion === 'allow'
    )
      continue;
    centre = cutRegions(centre, surface.protectedEnvelope);
    if (centre.length > 1024) return regions;
  }
  const merged = [...cutRegions(regions, editorRegion), ...centre];
  return merged.length > 1024 ? regions : merged;
}
/** True when a fresh snapshot shows no protected surface under an editor gesture's point. */
export function editorClaims(snapshot: OperationSnapshot, point: Point): boolean {
  return (
    snapshot.supported &&
    !snapshot.surfaces.some(
      (surface) =>
        surface.availability.visible &&
        surface.policy.occlusion !== 'allow' &&
        point.x >= surface.protectedEnvelope.left &&
        point.x <= surface.protectedEnvelope.left + surface.protectedEnvelope.width &&
        point.y >= surface.protectedEnvelope.top &&
        point.y <= surface.protectedEnvelope.top + surface.protectedEnvelope.height,
    )
  );
}
function sweptRegions(snapshot: OperationSnapshot, editing: boolean): PlacementFrame[] {
  let regions: PlacementFrame[] = [{ left: 0, top: 0, ...snapshot.viewport }];
  for (const surface of snapshot.surfaces) {
    if (
      !surface.availability.visible ||
      surface.compositionCapability === 'native-above' ||
      (!editing && surface.policy.occlusion === 'allow')
    )
      continue;
    const cut = surface.scrolls
      ? { ...surface.protectedEnvelope, top: 0, height: snapshot.viewport.height }
      : surface.protectedEnvelope;
    regions = regions.flatMap((r) => {
      const a = Math.max(r.left, cut.left),
        b = Math.min(r.left + r.width, cut.left + cut.width),
        c = Math.max(r.top, cut.top),
        d = Math.min(r.top + r.height, cut.top + cut.height);
      if (a >= b || c >= d) return [r];
      return [
        { left: r.left, top: r.top, width: r.width, height: c - r.top },
        { left: r.left, top: d, width: r.width, height: r.top + r.height - d },
        { left: r.left, top: c, width: a - r.left, height: d - c },
        { left: b, top: c, width: r.left + r.width - b, height: d - c },
      ].filter((part) => part.width > 0 && part.height > 0);
    });
    if (regions.length > 1024) return [];
  }
  return regions;
}
/** Disjoint safe rectangles for the plane that scrolls with the document, in viewport
 * coordinates at the moment of the snapshot. Surfaces that scroll with the page are cut at
 * their current envelope, inner scroll containers at their whole box, and screen-fixed
 * surfaces along their entire vertical path. Only `area` (the plane's paint bounds) is
 * partitioned, which keeps the clip small; too many pieces return none (no paint). */
export function pagePaintRegions(
  snapshot: OperationSnapshot,
  editing: boolean,
  area: PlacementFrame,
  editorRegion?: PlacementFrame,
): PlacementFrame[] {
  if (!snapshot.supported || !(area.width > 0 && area.height > 0)) return [];
  const regions = pageRegions(snapshot, editing, area);
  if (!editing || !editorRegion) return regions;
  // The editing video centre, as for the screen plane (see safePaintRegions); this plane moves
  // with the page, so every protected surface is cut at its page envelope.
  let centre = [editorRegion].flatMap((r) => {
    const left = Math.max(r.left, area.left),
      top = Math.max(r.top, area.top),
      right = Math.min(r.left + r.width, area.left + area.width),
      bottom = Math.min(r.top + r.height, area.top + area.height);
    return right > left && bottom > top ? [{ left, top, width: right - left, height: bottom - top }] : [];
  });
  for (const surface of snapshot.surfaces) {
    if (
      !surface.availability.visible ||
      surface.compositionCapability === 'native-above' ||
      surface.policy.occlusion === 'allow'
    )
      continue;
    centre = cutRegions(centre, pageEnvelope(surface));
    if (centre.length > 1024) return regions;
  }
  const merged = [...cutRegions(regions, editorRegion), ...centre];
  return merged.length > 1024 ? regions : merged;
}
function pageRegions(snapshot: OperationSnapshot, editing: boolean, area: PlacementFrame): PlacementFrame[] {
  let regions: PlacementFrame[] = [area];
  for (const surface of snapshot.surfaces) {
    if (
      !surface.availability.visible ||
      surface.compositionCapability === 'native-above' ||
      (!editing && surface.policy.occlusion === 'allow')
    )
      continue;
    regions = cutRegions(regions, pageEnvelope(surface));
    if (regions.length > 1024) return [];
  }
  return regions;
}
function cutRegions(regions: PlacementFrame[], cut: PlacementFrame): PlacementFrame[] {
  return regions.flatMap((r) => {
    const a = Math.max(r.left, cut.left),
      b = Math.min(r.left + r.width, cut.left + cut.width),
      c = Math.max(r.top, cut.top),
      d = Math.min(r.top + r.height, cut.top + cut.height);
    if (a >= b || c >= d) return [r];
    return [
      { left: r.left, top: r.top, width: r.width, height: c - r.top },
      { left: r.left, top: d, width: r.width, height: r.top + r.height - d },
      { left: r.left, top: c, width: a - r.left, height: d - c },
      { left: b, top: c, width: r.left + r.width - b, height: d - c },
    ].filter((part) => part.width > 0 && part.height > 0);
  });
}
/** The compositor clip for one immutable snapshot, reused until the snapshot changes. */
const clips = new WeakMap<OperationSnapshot, Map<string, { regions: PlacementFrame[]; path: string }>>();
export function protectionClip(snapshot: OperationSnapshot, editing: boolean, editorRegion?: PlacementFrame) {
  let entry = clips.get(snapshot);
  if (!entry) clips.set(snapshot, (entry = new Map()));
  const key = !editing
    ? 'view'
    : editorRegion
      ? `edit ${editorRegion.left} ${editorRegion.top} ${editorRegion.width} ${editorRegion.height}`
      : 'edit';
  let clip = entry.get(key);
  if (!clip) {
    const regions = safePaintRegions(snapshot, editing, editorRegion);
    clip = { regions, path: regions.map((r) => `M${r.left} ${r.top}h${r.width}v${r.height}h${-r.width}Z`).join('') };
    entry.set(key, clip);
  }
  return clip;
}
export interface ProximityState {
  safe: boolean;
  clearSince: number | null;
}
export const initialProximity = (): ProximityState => ({ safe: true, clearSince: null });
function segmentHits(a: Point, b: Point, rect: PlacementFrame, margin: number) {
  let low = 0,
    high = 1;
  for (const [start, delta, min, max] of [
    [a.x, b.x - a.x, rect.left - margin, rect.left + rect.width + margin],
    [a.y, b.y - a.y, rect.top - margin, rect.top + rect.height + margin],
  ]) {
    if (delta === 0) {
      if (start! < min! || start! > max!) return false;
    } else {
      const x = (min! - start!) / delta!,
        y = (max! - start!) / delta!;
      low = Math.max(low, Math.min(x, y));
      high = Math.min(high, Math.max(x, y));
      if (low > high) return false;
    }
  }
  return true;
}
/** Where a pointer approaches a control: its shape, narrowed to its protected envelope. A
 * band reserved on a large element (the player's control bars) is not the whole element. */
function approachRect(surface: OperationSurface): PlacementFrame | undefined {
  const a = surface.shape,
    b = surface.protectedEnvelope;
  const left = Math.max(a.left, b.left),
    top = Math.max(a.top, b.top),
    right = Math.min(a.left + a.width, b.left + b.width),
    bottom = Math.min(a.top + a.height, b.top + b.height);
  return right > left && bottom > top ? { left, top, width: right - left, height: bottom - top } : undefined;
}
export function stepProximity(
  previous: ProximityState,
  snapshot: OperationSnapshot,
  input: { timeMs: number; point?: Point; previousPoint?: Point; interacting: boolean },
): ProximityState {
  const margin = previous.safe ? 72 : 40;
  const near =
    input.interacting ||
    snapshot.surfaces.some(
      (surface) =>
        // Focus on an area that may be covered (the video itself) is not an approach to a control.
        (surface.availability.focused && surface.policy.occlusion !== 'allow') ||
        surface.availability.dragging ||
        surface.availability.captured ||
        (surface.availability.visible &&
          surface.policy.occlusion !== 'allow' &&
          input.point &&
          approachRect(surface) !== undefined &&
          segmentHits(input.previousPoint ?? input.point, input.point, approachRect(surface)!, margin)),
    );
  if (near) return { safe: true, clearSince: null };
  const clearSince = previous.clearSince ?? input.timeMs;
  return { safe: previous.safe && input.timeMs - clearSince < 350, clearSince };
}
