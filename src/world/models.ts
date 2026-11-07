import type { ModelDecoration } from '../design/types';
import { yields, type WorldInput, type WorldLayout, type WorldState } from './types';
import type { MotionState } from './motion';
import { object, numeric } from '../models/types';
import { oneOf } from '../validation';
import { DEFAULT_CHARACTER_PERSONALITY, modelClips, motionUsable } from '../characters/settings';
import { evaluateBodyMotion, layerSeed, parseBodyState, type BodyMotionState, type BodyPose } from './body-motion';
import { AUTONOMY, type Behaviour } from './autonomy';
import { gaitSpeedPx, matchGait, standingIdle } from './gait';

export interface ModelState {
  clip: number | null;
  timeMs: number;
  previousClip: number | null;
  previousTimeMs: number;
  fadeElapsedMs: number;
  fadeDurationMs: number;
  yawDeg: number;
  lookYaw: number;
  lookPitch: number;
  suspended: boolean;
  phase: 'manual' | 'idle' | 'walk' | 'run';
  /** A character's computed motion (R3-2). Absent for layers without a character, and in takes
   * recorded before it existed. */
  body?: BodyMotionState;
  /** Sitting down or standing up with a motion for it: that motion plays once from `sinceMs`,
   * then the behaviour's motion `to`. Absent otherwise. */
  transition?: { clip: number; to: number; sinceMs: number };
}
export interface ModelEvaluation extends ModelState {
  resetDynamics?: boolean;
  id: string;
  blend: number;
  speedPx: number;
  /** The computed motion to add on top of the clip pose (characters only). */
  pose?: BodyPose;
}
export function parseModelStates(value: unknown, ids?: ReadonlySet<string>): Record<string, ModelState> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 8)
    throw new Error('Invalid model state.');
  return Object.fromEntries(
    Object.entries(value).map(([id, item]) => {
      if (!/^[a-z][a-z0-9-]{0,63}$/.test(id) || (ids && !ids.has(id))) throw new Error('Invalid model state ID.');
      const v = object(item, [
        'clip',
        'timeMs',
        'previousClip',
        'previousTimeMs',
        'fadeElapsedMs',
        'fadeDurationMs',
        'yawDeg',
        'lookYaw',
        'lookPitch',
        'suspended',
        'phase',
        'body',
        'transition',
      ]);
      const clip = (n: unknown) => {
        if (n === null) return null;
        const result = numeric(n, 0, 63);
        if (!Number.isInteger(result)) throw new Error('Invalid clip state.');
        return result;
      };
      if (typeof v['suspended'] !== 'boolean') throw new Error('Invalid model suspension state.');
      const phase = v['phase'];
      if (!oneOf(phase, ['manual', 'idle', 'walk', 'run'])) throw new Error('Invalid locomotion state.');
      return [
        id,
        {
          clip: clip(v['clip']),
          timeMs: numeric(v['timeMs'], 0, 86400000),
          previousClip: clip(v['previousClip']),
          previousTimeMs: numeric(v['previousTimeMs'], 0, 86400000),
          fadeElapsedMs: numeric(v['fadeElapsedMs'], 0, 5000),
          fadeDurationMs: numeric(v['fadeDurationMs'], 0, 5000),
          yawDeg: numeric(v['yawDeg'], -180, 180),
          lookYaw: numeric(v['lookYaw'], -90, 90),
          lookPitch: numeric(v['lookPitch'], -80, 80),
          suspended: v['suspended'],
          phase: phase as ModelState['phase'],
          ...(v['body'] === undefined ? {} : { body: parseBodyState(v['body']) }),
          ...(v['transition'] === undefined
            ? {}
            : (() => {
                const t = object(v['transition'], ['clip', 'to', 'sinceMs']);
                const from = clip(t['clip']),
                  to = clip(t['to']);
                if (from === null || to === null) throw new Error('Invalid clip state.');
                return { transition: { clip: from, to, sinceMs: numeric(t['sinceMs'], 0, 86400000 * 7) } };
              })()),
        },
      ];
    }),
  );
}
const wrap = (angle: number) => ((((angle + 180) % 360) + 360) % 360) - 180;
function advance(layer: ModelDecoration, clip: number | null, time: number, delta: number) {
  const duration = clip === null ? 0 : (modelClips(layer)[clip]?.duration ?? 0) * 1000;
  return duration <= 0 ? 0 : layer.model.loop ? (time + delta) % duration : Math.min(duration, time + delta);
}
/**
 * A new page (the Host saw the document's address change, e.g. an SPA move): every character's
 * autonomy starts again, at home. Its memory is for one page (autonomy.ts), and where it fled on
 * the last page means nothing on the next one. Without this a character that fled before a move
 * walked home across the page change, and every frame of that walk re-read a page that was being
 * rebuilt (chunk 3 follow-up: the search SPA's extension CPU, docs/chunk3-verification.md). The
 * clip, the body's own timing and models without an autonomy are kept as they are.
 */
export function startPage(state: WorldState): WorldState {
  const models = state.models;
  if (!models || !Object.values(models).some((model) => model.body?.autonomy)) return state;
  const next: Record<string, ModelState> = {};
  for (const [id, model] of Object.entries(models)) {
    if (!model.body?.autonomy) {
      next[id] = model;
      continue;
    }
    const { autonomy: _forgotten, ...body } = model.body;
    next[id] = { ...model, body };
  }
  return { ...state, models: next };
}

/** Explicit clock/state only. Renderer never owns clip time or transitions. */
export function evaluateModels(
  layout: WorldLayout,
  previous: Readonly<Record<string, ModelState>> | undefined,
  input: WorldInput,
  visible?: ReadonlySet<string>,
  motion?: MotionState,
) {
  const state: Record<string, ModelState> = {},
    evaluations: ModelEvaluation[] = [];
  let needsFrame = false;
  for (const entry of layout.layers) {
    if (entry.layer.kind !== 'model3d') continue;
    const layer = entry.layer,
      model = layer.model,
      before = previous?.[layer.id];
    // Reduced motion and the whole-page rule (old takes) start again from rest. A root held
    // over an approached control pauses where it is, like a hidden page, and resumes from there.
    const restart = input.environment.reducedMotion || Boolean(input.environment.safeInteraction),
      paused = !restart && yields(input.environment, layer.id, entry.parentId);
    const running =
      entry.renderable && (!visible || visible.has(layer.id)) && !input.environment.hidden && !restart && !paused;
    const dt = running && before && !before.suspended ? input.deltaMs : 0,
      delta = model.playing ? dt * model.speed : 0;
    const body = motion?.bodies[layer.id] ?? (entry.parentId ? motion?.bodies[entry.parentId] : undefined);
    const speedPx = body ? Math.hypot(body.velocity.x, body.velocity.y) : 0,
      l = model.locomotion;
    // A paused body has no velocity; keep its gait and clip instead of fading to idle.
    const phase: ModelState['phase'] =
      paused && before
        ? before.phase
        : !l.enabled
          ? 'manual'
          : speedPx >= l.runSpeed || (before?.phase === 'run' && speedPx >= l.runSpeed * 0.9)
            ? 'run'
            : speedPx >= l.walkSpeed || (before?.phase === 'walk' && speedPx >= l.walkSpeed * 0.8)
              ? 'walk'
              : 'idle';
    const chosen =
      paused && before
        ? before.clip
        : phase === 'manual'
          ? model.clip
          : phase === 'idle'
            ? (l.idle ?? model.clip)
            : phase === 'run'
              ? (l.run ?? l.walk ?? model.clip)
              : (l.walk ?? model.clip);
    // A standard motion the body measure (or the user) rules out holds the rest pose instead;
    // the character's own motions always play (docs/r3-plan.md, R3-1b).
    const authorClip =
      chosen !== null && layer.character && !motionUsable(layer.character, chosen, layer.source.vrm?.body)
        ? null
        : chosen;
    // The author's own motion (a path, a timed clip that is not a held pose) comes first; it is
    // judged on the author's clip, never on a behaviour's motion chosen below.
    const authorRole = authorClip === null ? undefined : layer.character?.motions[authorClip]?.role,
      authorSeconds = authorClip === null ? 0 : (modelClips(layer)[authorClip]?.duration ?? 0);
    const authorActive =
      Boolean(layer.motion?.enabled) ||
      (model.playing && authorSeconds > 0 && authorRole !== 'idle' && authorRole !== 'sit');
    // v15: while the autonomy drives, the behaviour it picked (last frame's, in the state) plays
    // its assigned motion: a part of it, looped from when the behaviour began, at its speed.
    const autonomyState = restart ? undefined : before?.body?.autonomy;
    // Gaits (src/world/gait.ts): a behaviour that moves with a walk or a run goes at the speed the
    // motion's feet keep, and the motion plays at the rate that matches the character's speed.
    const gaits: Partial<Record<Behaviour, { rate: number; speedPx: number }>> = {};
    if (layer.character?.autonomy)
      for (const [name, requested] of [
        ['flee', AUTONOMY.fleeSpeed],
        ['approach', AUTONOMY.approachSpeed],
        ['return', AUTONOMY.returnSpeed],
      ] as const) {
        const entry = layer.character.behaviourMotions?.[name],
          natural = gaitSpeedPx(
            layer.character.motions.find((m) => m.id === entry?.motion),
            layer.source.vrm?.body,
            layer.placement.heightPx,
          );
        if (natural) gaits[name] = matchGait(requested * (entry?.speed ?? 1), natural * (entry?.speed ?? 1));
      }
    // Seats: the edges of its part the adapter reports, in page px. Only for a character that
    // sits at rest (a standing idle on an edge line would hang its feet in the air).
    const anchorId = layer.placement.anchor.kind === 'surface' ? layer.placement.anchor.target : undefined,
      room = anchorId ? input.anchors[anchorId] : undefined,
      restMotion = layer.character?.behaviourMotions?.rest?.motion,
      sitsAtRest = layer.character?.motions.find((m) => m.id === restMotion)?.role === 'sit';
    const seats =
      room && sitsAtRest && anchorId && layer.character?.autonomy
        ? (input.seats?.[anchorId] ?? []).map((edge) => ({
            edge,
            y: edge === 'top' ? room.top : room.top + room.height,
          }))
        : [];
    const doing = autonomyState?.behaviour ?? 'rest';
    // Arrived while still fleeing (or going home): a walk would tread on the spot. It stands as at rest.
    const arrived =
      gaits[doing] !== undefined &&
      autonomyState !== undefined &&
      Math.hypot(autonomyState.target.x - autonomyState.offset.x, autonomyState.target.y - autonomyState.offset.y) <= 1;
    // It sits only on an edge: off every edge, a rest (or an arrival) stands in the character's
    // own idle loop (its motion of that role), never a sitting pose in the air.
    const offSeat =
      seats.length > 0 &&
      (!autonomyState ||
        !entry.position ||
        !seats.some((q) => Math.abs(entry.position!.y + autonomyState.offset.y - q.y) < 1));
    const standIndex =
      offSeat && (arrived || doing === 'rest' || doing === 'doze') && layer.character
        ? standingIdle(layer.character, layer.source.vrm?.body)
        : -1;
    const standing =
      standIndex >= 0
        ? {
            motion: layer.character!.motions[standIndex]!.id,
            from: 0,
            to: Math.floor(layer.character!.motions[standIndex]!.source.duration * 100 + 1e-6) / 100,
            speed: 1,
          }
        : undefined;
    const assigned =
      layer.character?.autonomy &&
      layer.character.computedMotion !== false &&
      !authorActive &&
      !paused &&
      !input.environment.reducedMotion
        ? (standing ?? layer.character.behaviourMotions?.[arrived ? 'rest' : doing])
        : undefined;
    const assignedIndex = assigned ? layer.character!.motions.findIndex((m) => m.id === assigned.motion) : -1;
    const behaviourClip =
      assigned && assignedIndex >= 0 && motionUsable(layer.character!, assignedIndex, layer.source.vrm?.body)
        ? {
            index: assignedIndex,
            entry: assigned,
            since: autonomyState?.since ?? 0,
            rate: arrived ? 1 : (gaits[doing]?.rate ?? 1),
          }
        : undefined;
    // Sitting down and standing up (the autonomy's motions only): between a standing motion and a
    // sitting one, a sitting motion that plays once and lowers the hips (or raises them) plays
    // first, once. Told apart by what the files measure (role, loop, the hips' rise), not names.
    // Without one, the seat's weight lowers or raises the hips (body-motion.ts).
    let transition: ModelState['transition'];
    if (behaviourClip && layer.character) {
      const motions = layer.character.motions,
        sits = (i: number | null | undefined) => i !== null && i !== undefined && motions[i]?.role === 'sit';
      const goingTo = behaviourClip.index,
        was = before?.transition ? before.transition.to : before?.clip;
      const ongoing =
        before?.transition &&
        before.transition.to === goingTo &&
        input.timeMs - before.transition.sinceMs < (motions[before.transition.clip]?.source.duration ?? 0) * 1000;
      if (ongoing) transition = before!.transition;
      else if (
        !restart &&
        // A fright is at once: it springs up and away, no getting up first.
        doing !== 'flee' &&
        was !== undefined &&
        was !== null &&
        was !== goingTo &&
        sits(was) !== sits(goingTo)
      ) {
        const down = sits(goingTo);
        const found = motions.findIndex(
          (m, i) =>
            m.role === 'sit' &&
            !m.loop &&
            m.source.duration > 0 &&
            (down ? -1 : 1) * m.source.hipsTravel[1] > 0.1 * m.source.restHipsHeight &&
            motionUsable(layer.character!, i, layer.source.vrm?.body),
        );
        if (found >= 0) transition = { clip: found, to: goingTo, sinceMs: input.timeMs };
      }
    }
    const clip = transition ? transition.clip : behaviourClip ? behaviourClip.index : authorClip;
    let next: ModelState =
      before && !restart
        ? { ...before }
        : {
            clip,
            timeMs: 0,
            previousClip: null,
            previousTimeMs: 0,
            fadeElapsedMs: model.crossFadeMs,
            fadeDurationMs: model.crossFadeMs,
            yawDeg: 0,
            lookYaw: 0,
            lookPitch: 0,
            suspended: !running,
            phase: 'manual',
          };
    if (clip !== next.clip)
      next = {
        ...next,
        clip,
        timeMs: 0,
        previousClip: next.clip,
        previousTimeMs: advance(layer, next.clip, next.timeMs, delta),
        fadeElapsedMs: 0,
        fadeDurationMs: model.playing ? model.crossFadeMs : 0,
      };
    else {
      next.timeMs = advance(layer, clip, next.timeMs, delta);
      next.previousTimeMs = advance(layer, next.previousClip, next.previousTimeMs, delta);
      next.fadeElapsedMs = Math.min(next.fadeDurationMs, next.fadeElapsedMs + (model.playing ? dt : 0));
    }
    if (transition) {
      // Once through, from its start.
      next.timeMs = Math.max(0, input.timeMs - transition.sinceMs);
      next.transition = transition;
    } else {
      delete next.transition;
    }
    if (behaviourClip && !transition) {
      // Its own clock: the part's start plus the time since the behaviour began, at its speed,
      // looped within the part. The same inputs give the same time (no accumulated drift).
      const { from, to, speed } = behaviourClip.entry,
        length = (to - from) * 1000,
        elapsed = Math.max(0, input.timeMs - behaviourClip.since) * speed * behaviourClip.rate;
      next.timeMs = from * 1000 + (length > 0 ? elapsed % length : 0);
    }
    const blend = next.fadeDurationMs === 0 ? 1 : Math.min(1, next.fadeElapsedMs / next.fadeDurationMs);
    if (blend >= 1) {
      next.previousClip = null;
      next.previousTimeMs = 0;
    }
    const authorFacing = layer.motion?.enabled && layer.motion.orientToMovement && l.faceMovement;
    // Walking or running with the autonomy, it turns the way it goes (a walk facing the viewer
    // while it moves sideways would slide whatever its speed), and back to the viewer after.
    const walking =
      !authorFacing && autonomyState && gaits[doing] !== undefined && !arrived
        ? Math.atan2(autonomyState.target.y - autonomyState.offset.y, autonomyState.target.x - autonomyState.offset.x) *
          (180 / Math.PI)
        : undefined;
    const facing = Boolean(authorFacing) || walking !== undefined;
    const easesHome = !facing && Boolean(layer.character?.autonomy) && next.yawDeg !== 0;
    const targetYaw =
      walking !== undefined
        ? wrap(90 - walking)
        : authorFacing && body
          ? speedPx > 0.001 || before?.yawDeg
            ? wrap(90 - body.heading)
            : next.yawDeg
          : 0;
    const turn = wrap(targetYaw - next.yawDeg);
    if ((facing || easesHome) && running) {
      next.yawDeg = wrap(next.yawDeg + turn * (1 - Math.exp(-dt / 120)));
      if (easesHome && Math.abs(next.yawDeg) < 0.5) next.yawDeg = 0;
    } else if (!facing) next.yawDeg = 0;
    needsFrame ||= running && (facing || easesHome) && Math.abs(turn) > 0.01;
    const look = model.look,
      pointer = input.signals.pointer;
    let lookYaw = 0,
      lookPitch = 0;
    if (look.enabled && look.bone !== null && pointer && entry.position) {
      const p = layer.placement,
        angle = (p.rotationDeg * Math.PI) / 180,
        dx = pointer.x - entry.position.x,
        dy = pointer.y - entry.position.y;
      let x = ((dx * Math.cos(angle) + dy * Math.sin(angle)) * 1.5) / p.heightPx,
        y = ((dx * Math.sin(angle) - dy * Math.cos(angle)) * 1.5) / p.heightPx,
        z = 1.5;
      // Inverse XYZ model orientation, then local yaw/pitch about the author's bone.
      const rx = (-model.rotationX * Math.PI) / 180,
        ry = (-(model.rotationY + next.yawDeg + (l.faceMovement ? l.forwardDeg : 0)) * Math.PI) / 180,
        rz = (-model.rotationZ * Math.PI) / 180;
      [y, z] = [y * Math.cos(rx) - z * Math.sin(rx), y * Math.sin(rx) + z * Math.cos(rx)];
      [x, z] = [x * Math.cos(ry) + z * Math.sin(ry), -x * Math.sin(ry) + z * Math.cos(ry)];
      [x, y] = [x * Math.cos(rz) - y * Math.sin(rz), x * Math.sin(rz) + y * Math.cos(rz)];
      lookYaw = Math.max(-look.yawLimit, Math.min(look.yawLimit, (Math.atan2(x, z) * 180) / Math.PI));
      lookPitch = Math.max(
        -look.pitchLimit,
        Math.min(look.pitchLimit, (-Math.atan2(y, Math.hypot(x, z)) * 180) / Math.PI),
      );
    }
    if (!look.enabled || look.bone === null) {
      next.lookYaw = next.lookPitch = 0;
    } else if (running) {
      const amount = look.lagMs === 0 ? 1 : 1 - Math.exp(-dt / look.lagMs);
      next.lookYaw += (lookYaw - next.lookYaw) * amount;
      next.lookPitch += (lookPitch - next.lookPitch) * amount;
      needsFrame ||= Math.abs(lookYaw - next.lookYaw) + Math.abs(lookPitch - next.lookPitch) > 0.01;
    }
    next.phase = phase;
    next.suspended = !running;
    // A character's computed motion on top of its clip (R3-2). Layers without a character, and
    // every artwork made before characters existed, are evaluated exactly as before.
    let pose: BodyPose | undefined;
    // v15: the author may stop the computed motion altogether (absent: on, as in v14).
    if (layer.character && layer.source.vrm && layer.character.computedMotion !== false) {
      const motionRole = (index: number | null) => (index === null ? undefined : layer.character!.motions[index]?.role);
      const role = motionRole(clip);
      const idle = input.signals.samples?.['user.idle.duration'];
      const body = evaluateBodyMotion(restart ? undefined : before?.body, {
        timeMs: input.timeMs,
        deltaMs: input.deltaMs,
        seed: layerSeed(layer.id, input.seed),
        // Getting up is standing already (the seat lets go while the motion raises the hips);
        // sitting down is sitting.
        posture: (transition ? motionRole(transition.to) : role) === 'sit' ? 'sit' : 'stand',
        authorActive,
        running,
        reducedMotion: input.environment.reducedMotion,
        position: entry.position,
        heightPx: layer.placement.heightPx,
        widthPx: layer.placement.widthPx,
        pointer: input.signals.pointer,
        idleSeconds: typeof idle === 'number' ? idle : undefined,
        scrollY: input.signals.scroll?.y,
        events: input.events,
        // v15: the autonomy only when the author turned it on (absent: off, older artwork).
        ...(layer.character.autonomy
          ? { personality: layer.character.personality ?? DEFAULT_CHARACTER_PERSONALITY }
          : {}),
        ...(seats.length ? { seats } : {}),
        ...(Object.keys(gaits).length
          ? {
              gaits: Object.fromEntries(Object.entries(gaits).map(([b, g]) => [b, g!.speedPx])) as Partial<
                Record<Behaviour, number>
              >,
            }
          : {}),
        // The part it lives on (its anchor): a flight or an approach stays inside it.
        ...(layer.placement.anchor.kind === 'surface' && input.anchors[layer.placement.anchor.target]
          ? { room: input.anchors[layer.placement.anchor.target] }
          : {}),
        // G1.2 holds a root over an approached control: a move away from the pointer continues.
        ...(paused ? { yielding: true } : {}),
      });
      next.body = body.state;
      pose = body.pose;
      // Breathing never stops while the character is shown; a held move finishes its way.
      needsFrame ||= running || (paused && Boolean(body.state.autonomy));
    }
    state[layer.id] = next;
    evaluations.push({
      ...next,
      id: layer.id,
      blend,
      speedPx,
      ...(restart || paused ? { resetDynamics: true } : {}),
      ...(pose ? { pose } : {}),
    });
    const duration = clip === null ? 0 : (modelClips(layer)[clip]?.duration ?? 0) * 1000;
    needsFrame ||=
      running &&
      model.playing &&
      (Boolean(layer.source.vrm) || blend < 1 || (duration > 0 && (model.loop || next.timeMs < duration)));
  }
  return { state, evaluations, needsFrame };
}
