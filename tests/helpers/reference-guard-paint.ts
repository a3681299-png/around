import { intersects, type OperationSnapshot, type PaintFootprint, type SafetyIssue } from '../../src/world/operations';

/** Frozen copy of guardPaint before per-snapshot envelope reuse; the equivalence oracle. */
export function referenceGuardPaint(snapshot: OperationSnapshot, paints: readonly PaintFootprint[]): SafetyIssue[] {
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
