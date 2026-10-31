import {
  editorClaims,
  guardPaint,
  initialProximity,
  stepProximity,
  type OperationSnapshot,
  type PaintFootprint,
  type SafetyIssue,
} from '../world/operations';
import type { OperationSource } from './operation-source';
import type { Point } from '../world/geometry';

export interface SafetyStatus {
  issues: readonly SafetyIssue[];
  surfaces: OperationSnapshot;
  approaching: boolean;
  stopped: string;
  overlay: boolean;
}
export interface OperationGuardHost {
  setActive(value: boolean): void;
  sample(time: number): { approaching: boolean; idleSeconds: number };
  commit(paints: readonly PaintFootprint[]): ReadonlySet<string>;
  readonly source: OperationSource;
  snapshot(): SafetyStatus;
  subscribe(listener: (value: SafetyStatus) => void): () => void;
  overlay(value: boolean): void;
  pause(reason: string, repeatedFailure?: boolean, layerIds?: readonly string[]): void;
  /** Input-time check for an editor gesture: false (and drawing paused) when a fresh read finds
   * a protected surface under the point. */
  claim(point: Point): boolean;
  destroy(): void;
}
/** Inspection observes the whole page; it runs only while authored paint can exist. */
export function guardWanted(state: {
  suspended: boolean;
  enabled: boolean;
  strength: number;
  layers: number;
  editing: boolean;
}): boolean {
  return !state.suspended && state.enabled && state.strength > 0 && (state.layers > 0 || state.editing);
}
export function createOperationGuardHost(
  doc: Document,
  source: OperationSource,
  invalidate: (stopImmediately?: boolean | readonly string[]) => void,
): OperationGuardHost {
  const view = doc.defaultView!,
    reduced = view.matchMedia('(prefers-reduced-motion: reduce)');
  let enabled = true;
  let stoppedIds: ReadonlySet<string> | undefined;
  const layerFailures = new Map<string, number>(),
    latchedLayers = new Map<string, string>();
  let surfaces = source.capture(),
    proximity = { ...initialProximity(), safe: false },
    point: Point | undefined,
    before: Point | undefined;
  const boundaryKey = (snapshot: OperationSnapshot) =>
    JSON.stringify([
      snapshot.supported,
      snapshot.viewport,
      snapshot.surfaces
        .filter((s) => s.availability.visible)
        .map((s) => [
          s.id,
          s.compositionCapability,
          s.policy,
          s.protectedEnvelope.left,
          s.protectedEnvelope.width,
          ...(s.scrolls ? [] : [s.protectedEnvelope.top, s.protectedEnvelope.height]),
          s.scrollBox ? [s.scrollBox.left, s.scrollBox.top, s.scrollBox.width, s.scrollBox.height] : null,
        ]),
    ]);
  let boundary = boundaryKey(surfaces);
  let lastActivity = view.performance.now(),
    interacting = false,
    stopped = '',
    stableAt = 0,
    failures = 0,
    lastGeneration = surfaces.generation.geometry;
  let issues: readonly SafetyIssue[] = [],
    paints: readonly PaintFootprint[] = [],
    overlay = false,
    active = true;
  const listeners = new Set<(value: SafetyStatus) => void>();
  let overlayHost: HTMLElement | undefined,
    lastStatus = '',
    timer: number | undefined,
    holdTimer: number | undefined;
  const HOLD = '操作面が変化している間は、まとめて確認するまで描画を停止しています。';
  const snapshot = (): SafetyStatus => ({ issues, surfaces, approaching: proximity.safe, stopped, overlay });
  // Same objects and flags as the last publish cannot change the signature below.
  let published: readonly unknown[] = [];
  const publish = () => {
    const inputs = [issues, stopped, overlay, proximity.safe, overlay ? surfaces : null, overlayHost];
    if (inputs.length === published.length && inputs.every((value, i) => value === published[i])) return;
    published = inputs;
    const signature = JSON.stringify([issues, stopped, overlay, proximity.safe, overlay ? surfaces : null]);
    if (signature === lastStatus) return;
    lastStatus = signature;
    if (overlayHost) {
      const shadow = overlayHost.shadowRoot!;
      shadow.replaceChildren();
      const style = doc.createElement('style');
      // ww-protect: the 45° vermilion hatch (the one diagonal, and the one red, in the system), a ruled
      // edge, and the part's ID in mono on the first line, kept off the hatch by its own ground.
      // Gesso's values: the marks sit over any picture. YouTube has dozens of overlapping envelopes,
      // so the hatch is fixed to the window (overlaps share the same lines) and there is no wash,
      // which would build up into an opaque block.
      style.textContent =
        ':host{all:initial!important;position:fixed!important;inset:0!important;pointer-events:none!important;z-index:2147481999!important}' +
        "div{position:absolute;box-sizing:border-box;padding:4px;border:1px solid #bf3f1d;background:repeating-linear-gradient(45deg,#bf3f1d 0 1.2px,transparent 1.2px 6px) fixed;box-shadow:inset 0 0 0 1px rgba(255,255,255,.5);font:500 12px/20px 'IBM Plex Mono',ui-monospace,'SFMono-Regular','Cascadia Mono',Consolas,'BIZ UDPGothic','Yu Gothic UI','Meiryo UI',monospace;font-variant-numeric:tabular-nums;color:#bf3f1d;white-space:nowrap;pointer-events:none}" +
        "div::first-line{background:#fbfaf8}div::before,div::after{content:'\\a0'}";
      shadow.append(style);
      for (const surface of surfaces.surfaces.filter((s) => s.availability.visible)) {
        const box = doc.createElement('div'),
          r =
            surface.scrolls && surface.policy.occlusion === 'forbid' && surface.compositionCapability !== 'native-above'
              ? { ...surface.protectedEnvelope, top: 0, height: surfaces.viewport.height }
              : surface.protectedEnvelope;
        box.textContent =
          surface.id +
          (surface.compositionCapability === 'native-above'
            ? '（サイトの操作面が前）'
            : surface.scrolls && surface.policy.occlusion === 'forbid'
              ? '（スクロール範囲）'
              : '');
        Object.assign(box.style, {
          left: r.left + 'px',
          top: r.top + 'px',
          width: r.width + 'px',
          height: r.height + 'px',
        });
        shadow.append(box);
      }
      (doc.fullscreenElement ?? doc.body).append(overlayHost);
    }
    listeners.forEach((listener) => listener(snapshot()));
  };
  function pause(reason: string, repeatedFailure = false, layerIds?: readonly string[]) {
    stopped = reason;
    stoppedIds = layerIds ? new Set(layerIds) : undefined;
    if (repeatedFailure && layerIds)
      for (const id of layerIds) {
        const count = (layerFailures.get(id) ?? 0) + 1;
        layerFailures.set(id, count);
        if (count >= 3) latchedLayers.set(id, reason);
      }
    else if (repeatedFailure) failures++;
    stableAt = view.performance.now();
    issues = paints
      .filter((p) => !stoppedIds || stoppedIds.has(p.id))
      .map((p) => ({
        layerId: p.id,
        surfaceId: 'host',
        severity: 'enforced',
        reason,
        remedy:
          failures >= 3
            ? '破綻が繰り返されたため自動復帰を止めました。対象を確認してページを再読み込みしてください。'
            : '操作を終え、配置基準が安定すると復帰します。',
      }));
    invalidate(layerIds ?? true);
    publish();
    if (failures < 3 && timer === undefined)
      timer = view.setTimeout(() => {
        timer = undefined;
        if (active) invalidate();
      }, 400);
  }
  const activity = (event: Event) => {
    if (event.type === 'visibilitychange' || event.type === 'blur') {
      lastActivity = view.performance.now();
      before = point = undefined;
      interacting = false;
      return;
    }
    lastActivity = view.performance.now();
    const owned = event
      .composedPath()
      .some((node) => node instanceof Element && node.id.startsWith('web-world-themes'));
    if (owned) {
      // Authoring UI owns its input region. Native hit/paint protection remains
      // enforced, while Timeline/numeric previews can show their authored values.
      before = point = undefined;
      interacting = false;
      proximity = { safe: false, clearSince: null };
      return;
    }
    if (event instanceof PointerEvent) {
      before = point;
      point = { x: event.clientX, y: event.clientY };
    }
    if (event.type === 'pointerdown' || event.type === 'keydown') interacting = true;
    if (
      event.type === 'pointerup' ||
      event.type === 'pointercancel' ||
      event.type === 'keyup' ||
      event.type === 'blur'
    ) {
      interacting = false;
    }
    if (!owned && (event.type === 'keydown' || event.type === 'pointerdown' || event.type === 'focusin')) {
      // validate() reads the page synchronously; the snapshot it leaves behind is the current
      // one, so a geometry change is never mistaken for a repeated failure.
      const valid = source.validate(surfaces, event);
      const geometryChanged = source.capture().generation.geometry !== surfaces.generation.geometry;
      if (!valid) pause('入力直前に操作面の世代またはクリック先が変わりました。', !geometryChanged);
    }
    // Pointer paths are tested immediately, including movement across a control.
    const next = stepProximity(proximity, source.capture(), {
      timeMs: lastActivity,
      ...(point ? { point } : {}),
      ...(before ? { previousPoint: before } : {}),
      interacting,
    });
    const changed = next.safe !== proximity.safe;
    proximity = next;
    // Consume this path once. A following frame can then test the stationary
    // endpoint and start its clear hysteresis without another pointer event.
    before = point;
    if (next.safe && next.clearSince !== null && timer === undefined && paints.some((p) => p.dynamic))
      timer = view.setTimeout(() => {
        timer = undefined;
        if (active) invalidate();
      }, 360);
    if ((changed || (next.safe && event instanceof PointerEvent)) && paints.some((p) => p.dynamic)) invalidate();
    else publish();
  };
  const events = [
    'pointermove',
    'pointerdown',
    'pointerup',
    'pointercancel',
    'keydown',
    'keyup',
    'focusin',
    'focusout',
    'wheel',
    'visibilitychange',
  ] as const;
  events.forEach((type) => doc.addEventListener(type, activity, { capture: true, passive: true }));
  let boundaryDirty = false;
  const changed = () => invalidate();
  const unsubscribeSource = source.subscribe(() => {
    boundaryDirty = true;
    // Hide before paint without forcing native layout in every observer
    // microtask. Input validation still performs a fresh synchronous read.
    invalidate(true);
  });
  doc.addEventListener('scroll', changed, { capture: true, passive: true });
  view.addEventListener('resize', changed);
  view.addEventListener('blur', activity);
  reduced.addEventListener('change', changed);
  return {
    setActive(value) {
      if (value === enabled) return;
      enabled = value;
      events.forEach((type) => doc.removeEventListener(type, activity, true));
      doc.removeEventListener('scroll', changed, true);
      view.removeEventListener('resize', changed);
      view.removeEventListener('blur', activity);
      source.active(value);
      reduced.removeEventListener('change', changed);
      if (timer !== undefined) view.clearTimeout(timer);
      if (holdTimer !== undefined) view.clearTimeout(holdTimer);
      holdTimer = undefined;
      timer = undefined;
      if (value) {
        events.forEach((type) => doc.addEventListener(type, activity, { capture: true, passive: true }));
        doc.addEventListener('scroll', changed, { capture: true, passive: true });
        view.addEventListener('resize', changed);
        view.addEventListener('blur', activity);
        reduced.addEventListener('change', changed);
        lastActivity = view.performance.now();
        before = point = undefined;
        interacting = false;
        proximity = { safe: false, clearSince: null };
      } else {
        overlay = false;
        overlayHost?.remove();
        overlayHost = undefined;
      }
      publish();
    },
    source,
    sample(time) {
      surfaces = source.capture({ coalesce: true });
      const wait = source.deferredFor();
      if (wait > 0) {
        // Native changes are still arriving and this snapshot is not current: hold all
        // drawing, keep the boundary comparison pending and come back when the window ends.
        if (!stopped) {
          stopped = HOLD;
          stoppedIds = undefined;
        }
        if (holdTimer === undefined)
          holdTimer = view.setTimeout(() => {
            holdTimer = undefined;
            if (active) invalidate();
          }, Math.ceil(wait));
      } else {
        if (stopped === HOLD) {
          stopped = '';
          issues = [];
        }
        if (boundaryDirty) {
          boundaryDirty = false;
          const nextBoundary = boundaryKey(surfaces);
          if (nextBoundary !== boundary) {
            boundary = nextBoundary;
            pause('操作面の保護範囲が変わったため、安定するまで描画を停止しています。');
          }
        }
      }
      const generation = surfaces.generation.geometry;
      if (generation !== lastGeneration) {
        lastGeneration = generation;
        stableAt = time;
      }
      const nativeEditing = surfaces.surfaces.some(
        (s) => s.availability.editing || s.availability.dragging || s.availability.captured,
      );
      if (stopped && stopped !== HOLD && failures < 3 && !interacting && !nativeEditing && time - stableAt >= 350) {
        stopped = '';
        issues = [];
      }
      proximity = stepProximity(proximity, surfaces, {
        timeMs: time,
        ...(point ? { point } : {}),
        ...(before ? { previousPoint: before } : {}),
        interacting,
      });
      before = point;
      publish();
      if (stopped && failures < 3 && timer === undefined)
        timer = view.setTimeout(() => {
          timer = undefined;
          if (active) invalidate();
        }, 360);
      if (proximity.safe && proximity.clearSince !== null && timer === undefined && paints.some((p) => p.dynamic))
        timer = view.setTimeout(() => {
          timer = undefined;
          if (active) invalidate();
        }, 360);
      return {
        approaching: proximity.safe,
        idleSeconds: doc.hidden ? 0 : Math.max(0, Math.min(1e9, (time - lastActivity) / 1000)),
      };
    },
    claim(point) {
      if (editorClaims(source.capture({ fresh: true }), point)) return true;
      pause('入力直前の照合で、編集ハンドルの下に本物の操作面がありました。');
      return false;
    },
    commit(next) {
      paints = next;
      if (!source.validate(surfaces)) pause('反映前に操作面の幾何世代が変わりました。');
      const pausedIssues: SafetyIssue[] = stopped
        ? next
            .filter((p) => !stoppedIds || stoppedIds.has(p.id))
            .map((p) => ({
              layerId: p.id,
              surfaceId: 'host',
              severity: 'enforced',
              action: 'stop',
              reason: stopped,
              remedy:
                failures >= 3
                  ? '破綻が繰り返されたためページの再読み込みが必要です。'
                  : '操作を終え、配置基準が安定すると復帰します。',
            }))
        : [];
      for (const id of latchedLayers.keys())
        if (!next.some((p) => p.id === id)) {
          latchedLayers.delete(id);
          layerFailures.delete(id);
        }
      {
        issues = guardPaint(surfaces, next);
        issues = [
          ...issues,
          ...pausedIssues,
          ...next
            .filter((p) => latchedLayers.has(p.id))
            .map((p): SafetyIssue => ({
              layerId: p.id,
              surfaceId: 'host',
              severity: 'enforced',
              action: 'stop',
              reason: latchedLayers.get(p.id)!,
              remedy: '同じレイヤーの破綻が繰り返されたため、確認後にページを再読み込みしてください。',
            })),
        ];
        if (reduced.matches || proximity.safe)
          issues = [
            ...issues,
            ...next
              .filter((p) => p.dynamic || (reduced.matches && p.animated))
              .map((p): SafetyIssue => ({
                layerId: p.id,
                surfaceId: reduced.matches ? 'environment.reduced-motion' : 'native.approach',
                severity: 'enforced',
                action: 'flatten',
                reason: reduced.matches
                  ? '動きを減らす環境設定に従い、動きや追従を基本状態へ戻しています。'
                  : '本物の操作面への接近・操作中は動きや追従を基本状態へ戻しています。',
                remedy: reduced.matches
                  ? '作者は解除できません。基本の配置や絵でも成立するよう調整してください。'
                  : '操作を終え、マウスを操作面から離すと安定後に復帰します。',
              })),
          ];
      }
      publish();
      return new Set(
        issues.filter((i) => i.severity === 'enforced' && (!i.action || i.action === 'stop')).map((i) => i.layerId),
      );
    },
    snapshot,
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot());
      return () => {
        listeners.delete(listener);
      };
    },
    overlay(value) {
      value = value && enabled;
      overlay = value;
      overlayHost?.remove();
      overlayHost = undefined;
      if (value) {
        overlayHost = doc.createElement('div');
        overlayHost.id = 'web-world-themes-operation-check';
        overlayHost.attachShadow({ mode: 'open' });
      }
      lastStatus = '';
      published = [];
      publish();
    },
    pause,
    destroy() {
      unsubscribeSource();
      active = false;
      if (timer !== undefined) view.clearTimeout(timer);
      if (holdTimer !== undefined) view.clearTimeout(holdTimer);
      holdTimer = undefined;
      events.forEach((type) => doc.removeEventListener(type, activity, true));
      doc.removeEventListener('scroll', changed, true);
      view.removeEventListener('resize', changed);
      view.removeEventListener('blur', activity);
      reduced.removeEventListener('change', changed);
      source.destroy();
      overlayHost?.remove();
      listeners.clear();
    },
  };
}
