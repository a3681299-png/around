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
  dynamic?: boolean;
  animated?: boolean;
  clip?: PlacementFrame;
  id: string;
  bounds: Bounds;
  opacity: number;
  pointerEvents: boolean;
  /** Includes filter/blur/shadow spread. Unknown spread is unsupported. */
  outset: number;
  composition: 'overlay' | 'native-underlay' | 'unsupported';
}
export const intersects = (a: Bounds, b: PlacementFrame) =>
  a.right > b.left && a.left < b.left + b.width && a.bottom > b.top && a.top < b.top + b.height;
export function guardPaint(snapshot: OperationSnapshot, paints: readonly PaintFootprint[]): SafetyIssue[] {
  const issues: SafetyIssue[] = [];
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
    for (const surface of snapshot.surfaces) {
      if (!surface.availability.visible) continue;
      const envelope =
        surface.scrolls && paint.composition !== 'native-underlay' && surface.compositionCapability !== 'native-above'
          ? { ...surface.protectedEnvelope, top: 0, height: snapshot.viewport.height }
          : surface.protectedEnvelope;
      if (!intersects(bounds, envelope)) continue;
      // The stacking proof is relative to the screen overlay. A player-local
      // subtree must still check every native control in that player's plane.
      if (surface.compositionCapability === 'native-above' && paint.composition === 'overlay') {
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
        paint.editorOwned && paint.composition === 'native-underlay' && surface.policy.occlusion === 'allow';
      if ((paint.pointerEvents && !ownsVideoInput) || surface.policy.occlusion === 'forbid') {
        issues.push({
          layerId: paint.id,
          surfaceId: surface.id,
          severity: 'enforced',
          action: paint.composition === 'overlay' ? 'clip' : 'stop',
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

/** Disjoint safe rectangles, including the entire swept scroll envelope.
 * The compositor clips the final output (filters included), not sampled pixels.
 */
export function safePaintRegions(snapshot: OperationSnapshot, editing: boolean): PlacementFrame[] {
  if (!snapshot.supported) return [];
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
        surface.availability.focused ||
        surface.availability.dragging ||
        surface.availability.captured ||
        (surface.availability.visible &&
          input.point &&
          segmentHits(input.previousPoint ?? input.point, input.point, surface.shape, margin)),
    );
  if (near) return { safe: true, clearSince: null };
  const clearSince = previous.clearSince ?? input.timeMs;
  return { safe: previous.safe && input.timeMs - clearSince < 350, clearSince };
}
