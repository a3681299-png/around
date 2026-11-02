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
import { traceApproach } from './guard-trace';
import type { Point } from '../world/geometry';

export interface SafetyStatus {
  issues: readonly SafetyIssue[];
  surfaces: OperationSnapshot;
  approaching: boolean;
  /** What a stop protected, one sentence; empty while drawing. */
  stopped: string;
  /** How to fix it, one sentence. */
  remedy: string;
  /** Automatic recovery has ended; only 描画を再開 (resume) brings drawing back. */
  latched: boolean;
  overlay: boolean;
}
// Stops say what they protected and how to fix it, one sentence each, in the creator's words
// (docs/wwt-studio-design-system/README.md, Copy).
const COVERED = 'クリックがページの操作部品に届くよう、絵の表示を止めました。';
const MOVED = 'ページの操作部品が動いた直後の入力だったため、絵の表示を一時的に止めました。';
const SHIFTED = 'ページの操作部品の位置が変わったため、絵の表示を一時的に止めました。';
const HOLD = 'ページの操作部品が動いている間は、絵の表示を止めています。';
const CLAIMED = '編集の枠の下にページの操作部品があったため、その操作を止めました。';
const SETTLES = '動きが落ち着くと、自動で表示に戻ります。';
const RESUME = '操作チェックの「描画を再開」を押してください。';
const quote = (names: readonly string[]) => names.map((name) => `「${name}」`).join('と');
/** The remedy for a stop: the named layers to move, and 描画を再開 once recovery has ended. */
function remedyFor(latched: boolean, names: readonly string[], remedy: string) {
  if (latched)
    return names.length ? `${quote(names)}を操作部品から離してから、${RESUME}` : `絵の位置を確かめてから、${RESUME}`;
  return names.length ? `${quote(names)}を操作部品から離すか、小さくしてください。` : remedy;
}
export interface OperationGuardHost {
  setActive(value: boolean): void;
  sample(time: number): { approaching: boolean; idleSeconds: number };
  commit(paints: readonly PaintFootprint[]): ReadonlySet<string>;
  readonly source: OperationSource;
  snapshot(): SafetyStatus;
  subscribe(listener: (value: SafetyStatus) => void): () => void;
  overlay(value: boolean): void;
  /** `names`: layers the creator can move to fix it; `remedy`: how it recovers otherwise. */
  pause(
    reason: string,
    repeatedFailure?: boolean,
    layerIds?: readonly string[],
    names?: readonly string[],
    remedy?: string,
  ): void;
  /** 描画を再開 from the editor: ends a stop, including a latched one, and counts failures anew. */
  resume(): void;
  /** Input-time check for an editor gesture: false (and drawing paused) when a fresh read finds
   * a protected surface under the point. */
  claim(point: Point): boolean;
  destroy(): void;
}
/** Inspection observes the whole page; it runs only while authored paint can exist. */
export function guardWanted(state: {
  suspended: boolean;
  enabled: boolean;
  layers: number;
  editing: boolean;
}): boolean {
  return !state.suspended && state.enabled && (state.layers > 0 || state.editing);
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
    stoppedRemedy = '',
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
  const latched = () => failures >= 3 || latchedLayers.size > 0;
  const snapshot = (): SafetyStatus => ({
    issues,
    surfaces,
    approaching: proximity.safe,
    stopped,
    remedy: stopped ? stoppedRemedy : '',
    latched: latched(),
    overlay,
  });
  // Same objects and flags as the last publish cannot change the signature below.
  let published: readonly unknown[] = [];
  const publish = () => {
    const inputs = [
      issues,
      stopped,
      stoppedRemedy,
      latched(),
      overlay,
      proximity.safe,
      overlay ? surfaces : null,
      overlayHost,
    ];
    if (inputs.length === published.length && inputs.every((value, i) => value === published[i])) return;
    published = inputs;
    const signature = JSON.stringify([
      issues,
      stopped,
      stoppedRemedy,
      latched(),
      overlay,
      proximity.safe,
      overlay ? surfaces : null,
    ]);
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
  function pause(
    reason: string,
    repeatedFailure = false,
    layerIds?: readonly string[],
    names: readonly string[] = [],
    remedy = SETTLES,
  ) {
    stopped = reason;
    stoppedIds = layerIds ? new Set(layerIds) : undefined;
    if (repeatedFailure && layerIds)
      for (const id of layerIds) {
        const count = (layerFailures.get(id) ?? 0) + 1;
        layerFailures.set(id, count);
        if (count >= 3) latchedLayers.set(id, reason);
      }
    else if (repeatedFailure) failures++;
    stoppedRemedy = remedyFor(failures >= 3, names, remedy);
    stableAt = view.performance.now();
    issues = paints
      .filter((p) => !stoppedIds || stoppedIds.has(p.id))
      .map((p) => ({
        layerId: p.id,
        surfaceId: 'host',
        severity: 'enforced',
        reason,
        remedy: stoppedRemedy,
      }));
    invalidate(layerIds ?? true);
    publish();
    if (failures < 3 && timer === undefined)
      timer = view.setTimeout(() => {
        timer = undefined;
        if (active) invalidate();
      }, 400);
  }
  /** Names of the drawn layers at a covered click: the ones a creator can move away. */
  const layersAt = ({ clientX: x, clientY: y }: MouseEvent) => [
    ...new Set(
      paints
        .filter(
          (p) =>
            p.name &&
            x >= p.bounds.left - p.outset &&
            x <= p.bounds.right + p.outset &&
            y >= p.bounds.top - p.outset &&
            y <= p.bounds.bottom + p.outset,
        )
        .map((p) => p.name!),
    ),
  ];
  const activity = (event: Event) => {
    if (event.type === 'visibilitychange' || event.type === 'blur') {
      WW_GUARD_TRACE: traceApproach(doc, 'forget', { value: interacting, event });
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
      WW_GUARD_TRACE: if (interacting || point) traceApproach(doc, 'forget', { value: interacting, event });
      before = point = undefined;
      interacting = false;
      proximity = { safe: false, clearSince: null };
      return;
    }
    if (event instanceof PointerEvent) {
      before = point;
      point = { x: event.clientX, y: event.clientY };
    }
    if (event.type === 'pointerdown' || event.type === 'keydown') {
      WW_GUARD_TRACE: if (!interacting) traceApproach(doc, 'interacting', { value: true, event });
      interacting = true;
    }
    if (
      event.type === 'pointerup' ||
      event.type === 'pointercancel' ||
      event.type === 'keyup' ||
      event.type === 'blur'
    ) {
      WW_GUARD_TRACE: if (interacting) traceApproach(doc, 'interacting', { value: false, event });
      interacting = false;
    }
    if (!owned && (event.type === 'keydown' || event.type === 'pointerdown' || event.type === 'focusin')) {
      // validate() reads the page synchronously; the snapshot it leaves behind is the current
      // one, so a geometry change is never mistaken for a repeated failure.
      const valid = source.validate(surfaces, event);
      const geometryChanged = source.capture().generation.geometry !== surfaces.generation.geometry;
      if (!valid && geometryChanged) pause(MOVED);
      else if (!valid) pause(COVERED, true, undefined, event instanceof MouseEvent ? layersAt(event) : []);
    }
    // Pointer paths are tested immediately, including movement across a control.
    const next = stepProximity(proximity, source.capture(), {
      timeMs: lastActivity,
      ...(point ? { point } : {}),
      ...(before ? { previousPoint: before } : {}),
      interacting,
    });
    const changed = next.safe !== proximity.safe;
    WW_GUARD_TRACE: if (changed)
      traceApproach(doc, 'approach', {
        value: next.safe,
        event,
        ...(point ? { point } : {}),
        interacting,
        surfaces: source.capture().surfaces,
      });
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
          stoppedRemedy = remedyFor(false, [], SETTLES);
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
            pause(SHIFTED);
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
      const next = stepProximity(proximity, surfaces, {
        timeMs: time,
        ...(point ? { point } : {}),
        ...(before ? { previousPoint: before } : {}),
        interacting,
      });
      WW_GUARD_TRACE: if (next.safe !== proximity.safe)
        traceApproach(doc, 'approach', {
          value: next.safe,
          ...(point ? { point } : {}),
          interacting,
          surfaces: surfaces.surfaces,
        });
      proximity = next;
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
      pause(CLAIMED, false, undefined, [], '操作部品から離れた場所で、絵をつかんでください。');
      return false;
    },
    commit(next) {
      paints = next;
      if (!source.validate(surfaces)) pause(SHIFTED);
      const pausedIssues: SafetyIssue[] = stopped
        ? next
            .filter((p) => !stoppedIds || stoppedIds.has(p.id))
            .map((p) => ({
              layerId: p.id,
              surfaceId: 'host',
              severity: 'enforced',
              action: 'stop',
              reason: stopped,
              remedy: stoppedRemedy,
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
              remedy: `絵の状態を確かめてから、${RESUME}`,
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
    resume() {
      // Trusted editor UI only (never artwork): the same covered click stops drawing again, and
      // three in a row end automatic recovery again.
      failures = 0;
      layerFailures.clear();
      latchedLayers.clear();
      stopped = stoppedRemedy = '';
      stoppedIds = undefined;
      issues = [];
      stableAt = view.performance.now();
      published = [];
      invalidate();
      publish();
    },
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
