import type { ModelDecoration } from '../design/types';
import type { WorldInput, WorldLayout } from './types';
import type { MotionState } from './motion';
import { object, numeric } from '../models/types';

export interface ModelState {
  clip: number | null; timeMs: number; previousClip: number | null; previousTimeMs: number; fadeElapsedMs: number; fadeDurationMs: number;
  yawDeg: number; lookYaw: number; lookPitch: number; suspended: boolean; phase: 'manual' | 'idle' | 'walk' | 'run';
}
export interface ModelEvaluation extends ModelState { id: string; blend: number; speedPx: number }
export function parseModelStates(value: unknown, ids?: ReadonlySet<string>): Record<string, ModelState> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 8) throw new Error('Invalid model state.');
  return Object.fromEntries(Object.entries(value).map(([id, item]) => {
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(id) || ids && !ids.has(id)) throw new Error('Invalid model state ID.');
    const v = object(item, ['clip', 'timeMs', 'previousClip', 'previousTimeMs', 'fadeElapsedMs', 'fadeDurationMs', 'yawDeg', 'lookYaw', 'lookPitch', 'suspended', 'phase']);
    const clip = (n: unknown) => { if (n === null) return null; const result = numeric(n, 0, 63); if (!Number.isInteger(result)) throw new Error('Invalid clip state.'); return result; };
    if (typeof v['suspended'] !== 'boolean') throw new Error('Invalid model suspension state.');
    const phase = v['phase']; if (!['manual', 'idle', 'walk', 'run'].includes(String(phase))) throw new Error('Invalid locomotion state.');
    return [id, { clip: clip(v['clip']), timeMs: numeric(v['timeMs'], 0, 86400000), previousClip: clip(v['previousClip']), previousTimeMs: numeric(v['previousTimeMs'], 0, 86400000),
      fadeElapsedMs: numeric(v['fadeElapsedMs'], 0, 5000), fadeDurationMs: numeric(v['fadeDurationMs'], 0, 5000), yawDeg: numeric(v['yawDeg'], -180, 180),
      lookYaw: numeric(v['lookYaw'], -90, 90), lookPitch: numeric(v['lookPitch'], -80, 80), suspended: v['suspended'], phase: phase as ModelState['phase'] }];
  }));
}
const wrap = (angle: number) => ((angle + 180) % 360 + 360) % 360 - 180;
function advance(layer: ModelDecoration, clip: number | null, time: number, delta: number) {
  const duration = clip === null ? 0 : (layer.source.clips[clip]?.duration ?? 0) * 1000;
  return duration <= 0 ? 0 : layer.model.loop ? (time + delta) % duration : Math.min(duration, time + delta);
}
/** Explicit clock/state only. Renderer never owns clip time or transitions. */
export function evaluateModels(layout: WorldLayout, previous: Readonly<Record<string, ModelState>> | undefined, input: WorldInput, visible?: ReadonlySet<string>, motion?: MotionState) {
  const state: Record<string, ModelState> = {}, evaluations: ModelEvaluation[] = []; let needsFrame = false;
  for (const entry of layout.layers) {
    if (entry.layer.kind !== 'model3d') continue;
    const layer = entry.layer, model = layer.model, before = previous?.[layer.id];
    const running = entry.renderable && (!visible || visible.has(layer.id)) && !input.environment.hidden && !input.environment.reducedMotion;
    const dt = running && before && !before.suspended ? input.deltaMs : 0, delta = model.playing ? dt * model.speed : 0;
    const body = motion?.bodies[layer.id] ?? (entry.parentId ? motion?.bodies[entry.parentId] : undefined);
    const speedPx = body ? Math.hypot(body.velocity.x, body.velocity.y) : 0, l = model.locomotion;
    const phase: ModelState['phase'] = !l.enabled ? 'manual' : speedPx >= l.runSpeed || before?.phase === 'run' && speedPx >= l.runSpeed * .9 ? 'run'
      : speedPx >= l.walkSpeed || before?.phase === 'walk' && speedPx >= l.walkSpeed * .8 ? 'walk' : 'idle';
    const clip = phase === 'manual' ? model.clip : phase === 'idle' ? l.idle ?? model.clip : phase === 'run' ? l.run ?? l.walk ?? model.clip : l.walk ?? model.clip;
    let next: ModelState = before ? { ...before } : { clip, timeMs: 0, previousClip: null, previousTimeMs: 0, fadeElapsedMs: model.crossFadeMs, fadeDurationMs: model.crossFadeMs, yawDeg: 0, lookYaw: 0, lookPitch: 0, suspended: !running, phase: 'manual' };
    if (clip !== next.clip) next = { ...next, clip, timeMs: 0, previousClip: next.clip, previousTimeMs: advance(layer, next.clip, next.timeMs, delta), fadeElapsedMs: 0, fadeDurationMs: model.playing ? model.crossFadeMs : 0 };
    else {
      next.timeMs = advance(layer, clip, next.timeMs, delta);
      next.previousTimeMs = advance(layer, next.previousClip, next.previousTimeMs, delta);
      next.fadeElapsedMs = Math.min(next.fadeDurationMs, next.fadeElapsedMs + (model.playing ? dt : 0));
    }
    const blend = next.fadeDurationMs === 0 ? 1 : Math.min(1, next.fadeElapsedMs / next.fadeDurationMs);
    if (blend >= 1) { next.previousClip = null; next.previousTimeMs = 0; }
    const facing = layer.motion?.enabled && layer.motion.orientToMovement && l.faceMovement;
    const targetYaw = facing && body ? speedPx > .001 || before?.yawDeg ? wrap(90 - body.heading) : next.yawDeg : 0;
    const turn = wrap(targetYaw - next.yawDeg);
    if (facing && running) next.yawDeg = wrap(next.yawDeg + turn * (1 - Math.exp(-dt / 120))); else if (!facing) next.yawDeg = 0;
    needsFrame ||= running && Boolean(facing) && Math.abs(turn) > .01;
    const look = model.look, pointer = input.signals.pointer;
    let lookYaw = 0, lookPitch = 0;
    if (look.enabled && look.bone !== null && pointer && entry.position) {
      const p = layer.placement, angle = p.rotationDeg * Math.PI / 180, dx = pointer.x - entry.position.x, dy = pointer.y - entry.position.y;
      let x = (dx * Math.cos(angle) + dy * Math.sin(angle)) * 1.5 / p.heightPx, y = (dx * Math.sin(angle) - dy * Math.cos(angle)) * 1.5 / p.heightPx, z = 1.5;
      // Inverse XYZ model orientation, then local yaw/pitch about the author's bone.
      const rx = -model.rotationX * Math.PI / 180, ry = -(model.rotationY + next.yawDeg + (l.faceMovement ? l.forwardDeg : 0)) * Math.PI / 180, rz = -model.rotationZ * Math.PI / 180;
      [y, z] = [y * Math.cos(rx) - z * Math.sin(rx), y * Math.sin(rx) + z * Math.cos(rx)];
      [x, z] = [x * Math.cos(ry) + z * Math.sin(ry), -x * Math.sin(ry) + z * Math.cos(ry)];
      [x, y] = [x * Math.cos(rz) - y * Math.sin(rz), x * Math.sin(rz) + y * Math.cos(rz)];
      lookYaw = Math.max(-look.yawLimit, Math.min(look.yawLimit, Math.atan2(x, z) * 180 / Math.PI));
      lookPitch = Math.max(-look.pitchLimit, Math.min(look.pitchLimit, -Math.atan2(y, Math.hypot(x, z)) * 180 / Math.PI));
    }
    if (!look.enabled || look.bone === null) { next.lookYaw = next.lookPitch = 0; }
    else if (running) {
      const amount = look.lagMs === 0 ? 1 : 1 - Math.exp(-dt / look.lagMs);
      next.lookYaw += (lookYaw - next.lookYaw) * amount; next.lookPitch += (lookPitch - next.lookPitch) * amount;
      needsFrame ||= Math.abs(lookYaw - next.lookYaw) + Math.abs(lookPitch - next.lookPitch) > .01;
    }
    next.phase = phase; next.suspended = !running; state[layer.id] = next; evaluations.push({ ...next, id: layer.id, blend, speedPx });
    const duration = clip === null ? 0 : (layer.source.clips[clip]?.duration ?? 0) * 1000;
    needsFrame ||= running && model.playing && (blend < 1 || duration > 0 && (model.loop || next.timeMs < duration));
  }
  return { state, evaluations, needsFrame };
}
