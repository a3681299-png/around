// Temporary rollback path from 1d23ec0; remove after live-site validation.
import type { PlacementFrame } from '../../world/geometry';
import type { LayerState } from '../../design/types';
import { createSignalSources } from '../../host/signals';
import type { PlaybackSource } from '../../signals/types';
import { evaluateMask, fadeValue, retargetFade, type Fade } from '../../world/masks';
import { maskGradient } from './mask';

interface EffectTarget {
  layer: LayerState;
  element: HTMLElement;
  frame: PlacementFrame | undefined;
  renderable: boolean;
  /** Targets arrive parent-first; the same stage composes groups and media. */
  parentId?: string;
  /** Media clocks can sleep when the effect reveals nothing. */
  visibility(value: boolean): void;
}

/** Shared composition stage, independent of assets, editor history and site DOM. */
export function createLegacyEffectController(doc: Document, playback?: PlaybackSource) {
  const view = doc.defaultView!,
    reduced = view.matchMedia('(prefers-reduced-motion: reduce)');
  let targets: readonly EffectTarget[] = [];
  let raf: number | undefined,
    listening = false;
  const fades = new Map<string, Fade>();
  const visibility = new Map<string, boolean>();
  let subscribed = { pointer: false, video: false };
  const sources = createSignalSources(doc, playback, (source) => {
    // Keep the latest pointer sample, but do not redraw fully faded-out artwork.
    if (
      source === 'pointer.position' &&
      !targets.some((target) => {
        const mask = maskOf(target),
          fade = fades.get(target.layer.id);
        return (
          active(target) &&
          mask?.bindings.some((binding) => binding.source === 'pointer.position') &&
          (!mask.bindings.some((binding) => binding.source === 'video.playing') ||
            sources.snapshot.playing ||
            (fade && fadeValue(fade, view.performance.now()) > 0))
        );
      })
    )
      return;
    schedule();
  });
  const maskOf = (target: EffectTarget) =>
    target.layer.effects?.find((effect) => effect.kind === 'mask' && effect.enabled);
  const parentVisible = (target: EffectTarget) =>
    !target.parentId ||
    (visibility.get(target.parentId) ??
      targets.find((parent) => parent.layer.id === target.parentId)?.renderable ??
      false);
  const active = (target: EffectTarget) =>
    target.renderable &&
    parentVisible(target) &&
    target.frame &&
    target.layer.opacity > 0 &&
    (maskOf(target)?.intensity ?? 0) > 0;
  const cancel = () => {
    if (raf !== undefined) view.cancelAnimationFrame(raf);
    raf = undefined;
  };
  const clear = (element: HTMLElement) => {
    element.style.removeProperty('mask-image');
    element.removeAttribute('data-mask-intensity');
  };
  const publish = (target: EffectTarget, value: boolean) => {
    visibility.set(target.layer.id, value);
    target.visibility(value);
  };
  const syncSources = (refresh = false) => {
    const running = doc.hidden ? [] : targets.filter(active);
    const needed = {
      pointer: running.some((target) =>
        maskOf(target)!.bindings.some((binding) => binding.source === 'pointer.position'),
      ),
      video: running.some((target) => maskOf(target)!.bindings.some((binding) => binding.source === 'video.playing')),
    };
    if (refresh || needed.pointer !== subscribed.pointer || needed.video !== subscribed.video) {
      subscribed = needed;
      sources.configure(needed);
    }
  };

  const paint = (time: number) => {
    let moving = false;
    for (const target of targets) {
      const { layer, element, frame } = target,
        mask = maskOf(target);
      if (!mask) {
        clear(element);
        fades.delete(layer.id);
        publish(target, target.renderable && parentVisible(target));
        continue;
      }
      if (!frame || !active(target)) {
        fades.delete(layer.id);
        // Hidden/offscreen layers do not subscribe or keep a transition alive.
        element.style.maskImage = maskGradient(
          mask,
          { x: layer.placement.widthPx / 2, y: layer.placement.heightPx / 2 },
          0,
        );
        element.dataset.maskIntensity = '0';
        publish(target, false);
        continue;
      }
      const value = evaluateMask(mask, layer.placement, frame, sources.snapshot);
      const fade = retargetFade(
        fades.get(layer.id),
        value.gate,
        time,
        doc.hidden || reduced.matches ? 0 : value.fadeMs,
      );
      fades.set(layer.id, fade);
      const gate = fadeValue(fade, time);
      element.style.maskImage = maskGradient(mask, value.center, gate);
      element.dataset.maskIntensity = String(mask.intensity * gate);
      publish(target, target.renderable && mask.intensity * gate > 0);
      moving ||= fade.from !== fade.to && time < fade.start + fade.duration;
    }
    syncSources();
    if (moving) schedule();
  };
  function schedule() {
    if (!doc.hidden && raf === undefined && targets.some(active))
      raf = view.requestAnimationFrame((time) => {
        raf = undefined;
        paint(time);
      });
  }
  const reconcile = () => {
    const enabled = targets.filter(
      (target) => target.renderable && target.frame && target.layer.opacity > 0 && (maskOf(target)?.intensity ?? 0) > 0,
    );
    syncSources(true);
    if (listening !== Boolean(enabled.length)) {
      listening = Boolean(enabled.length);
      if (listening) {
        doc.addEventListener('visibilitychange', lifecycle);
        reduced.addEventListener('change', lifecycle);
      } else {
        doc.removeEventListener('visibilitychange', lifecycle);
        reduced.removeEventListener('change', lifecycle);
      }
    }
    if (!enabled.length || doc.hidden) cancel();
    paint(view.performance.now());
  };
  function lifecycle() {
    // Do not replay transitions elapsed in a background tab.
    cancel();
    fades.clear();
    visibility.clear();
    reconcile();
  }
  return {
    update(next: readonly EffectTarget[]) {
      const ids = new Set(next.map((target) => target.layer.id));
      for (const old of targets)
        if (!ids.has(old.layer.id)) {
          clear(old.element);
          fades.delete(old.layer.id);
          visibility.delete(old.layer.id);
        }
      targets = next;
      reconcile();
    },
    destroy() {
      cancel();
      sources.destroy();
      doc.removeEventListener('visibilitychange', lifecycle);
      reduced.removeEventListener('change', lifecycle);
      listening = false;
      targets.forEach((target) => clear(target.element));
      targets = [];
      fades.clear();
      visibility.clear();
      subscribed = { pointer: false, video: false };
    },
  };
}
