import { createWorldSession, type WorldHostContext } from '../../host/world-session';
import { WORLD_MODE } from '../../host/world-options';
import type { PlaybackSource } from '../../signals/types';
import type { WorldEffectTarget } from '../../world/effects';
import { maskGradient } from './mask';
import { createLegacyEffectController } from './legacy-effects';
import { legacyWorld } from './legacy-evaluation';
import { assertWorldParity } from './parity';
import type { TimelineHost } from '../../host/timeline';
import type { WorldFrame, WorldLayout } from '../../world/types';

export interface EffectTarget extends WorldEffectTarget {
  element: HTMLElement;
  visibility(value: boolean): void;
}
export function createEffectController(
  doc: Document,
  playback?: PlaybackSource,
  timeline?: TimelineHost,
  applyLayout?: (layout: WorldLayout) => void,
  applyModels?: (frame: WorldFrame) => void,
) {
  if (WORLD_MODE === 'legacy') {
    const legacy = createLegacyEffectController(doc, playback);
    return {
      update(next: readonly EffectTarget[], _context: WorldHostContext) {
        legacy.update(next);
      },
      destroy: legacy.destroy,
    };
  }
  let targets: readonly EffectTarget[] = [];
  const clear = (element: HTMLElement) => {
    element.style.removeProperty('mask-image');
    element.removeAttribute('data-mask-intensity');
  };
  const session = createWorldSession(
    doc,
    playback,
    (frame) => {
      const byId = new Map(frame.effects.map((effect) => [effect.id, effect]));
      const evaluatedLayers = new Map(
        [...frame.layout.groups, ...frame.layout.layers].map((value) => [value.layer.id, value.layer]),
      );
      for (const target of targets) {
        const value = byId.get(target.layer.id)!;
        target.element.style.opacity = String(evaluatedLayers.get(target.layer.id)?.opacity ?? target.layer.opacity);
        if (value.mask) {
          target.element.style.maskImage = maskGradient(
            { ...value.mask, intensity: 1 },
            value.mask.center,
            value.mask.intensity,
          );
          target.element.dataset.maskIntensity = String(value.mask.intensity);
        } else clear(target.element);
        target.visibility(value.visible);
      }
      applyLayout?.(frame.layout);
      applyModels?.(frame);
    },
    WORLD_MODE === 'compare'
      ? (scene, previous, input, result) => assertWorldParity(result, legacyWorld(scene, previous, input), 'world')
      : undefined,
    timeline,
  );
  return {
    update(next: readonly EffectTarget[], context: WorldHostContext) {
      const ids = new Set(next.map((target) => target.layer.id));
      for (const old of targets) if (!ids.has(old.layer.id)) clear(old.element);
      targets = next;
      session.update(
        next.map(({ layer, frame, renderable, parentId }) => ({
          layer,
          frame,
          renderable,
          ...(parentId ? { parentId } : {}),
        })),
        context,
      );
    },
    destroy() {
      session.destroy();
      targets.forEach((target) => clear(target.element));
      targets = [];
    },
  };
}
