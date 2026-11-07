import { SIGNAL_REGISTRY } from '../signals/registry';
import { takeSignalSeries, projectNumericGhosts } from './take-signals';
import { parseWorldInput, parseWorldState } from './recording';
import { evaluateWorld, evaluatePreparedWorld } from './evaluate';
import { evaluateLayout } from './layout';
import { WORLD_RUNTIME_VERSION, type WorldApproach, type WorldInput, type WorldScene, type WorldState } from './types';
import { clampUnit, scrollProgress } from './keyframes';
import type { SignalRule } from '../signals/keyframes';
import { TAKE_LIMITS, TAKE_MESSAGES } from '../assets/limits';
export { TAKE_LIMITS } from '../assets/limits';

/** Inputs only: rules and asset references belong to the artwork, never the take. */
export interface SignalTake {
  format: 'ww-signal-take';
  formatVersion: 1;
  runtimeVersion: typeof WORLD_RUNTIME_VERSION;
  id: string;
  name: string;
  siteId: string;
  initialState: WorldState;
  inputs: WorldInput[];
}
export function parseSignalTake(value: unknown): SignalTake {
  if (typeof value === 'string') {
    if (value.length > TAKE_LIMITS.chars) throw new Error(TAKE_MESSAGES.size);
    value = JSON.parse(value);
  }
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some(
      (key) =>
        !['format', 'formatVersion', 'runtimeVersion', 'id', 'name', 'siteId', 'initialState', 'inputs'].includes(key),
    )
  )
    throw new Error('テイクの形式が不正です。');
  const data = value as Record<string, unknown>;
  const id = (value: unknown): value is string => typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value);
  if (
    data['format'] !== 'ww-signal-take' ||
    data['formatVersion'] !== 1 ||
    ![WORLD_RUNTIME_VERSION, '1.2.0', '1.1.0'].includes(data['runtimeVersion'] as string) ||
    !id(data['id']) ||
    !id(data['siteId']) ||
    typeof data['name'] !== 'string' ||
    !data['name'].length ||
    data['name'].length > 80 ||
    /[\u0000-\u001f]/.test(data['name'])
  )
    throw new Error('未対応または不正なテイクです。');
  if (!Array.isArray(data['inputs']) || !data['inputs'].length || data['inputs'].length > TAKE_LIMITS.samples)
    throw new Error(TAKE_MESSAGES.samples);
  const initialState = parseWorldState(data['initialState']),
    inputs = data['inputs'].map((value) => parseWorldInput(value));
  let previous = initialState.timeMs ?? 0;
  for (const input of inputs) {
    if (input.timeMs < previous || input.timeMs - inputs[0]!.timeMs > TAKE_LIMITS.durationMs)
      throw new Error('テイクの時刻が不正です。');
    previous = input.timeMs;
  }
  const take: SignalTake = {
    format: 'ww-signal-take',
    formatVersion: 1,
    runtimeVersion: WORLD_RUNTIME_VERSION,
    id: data['id'],
    name: data['name'],
    siteId: data['siteId'],
    initialState,
    inputs,
  };
  if (JSON.stringify(take).length > TAKE_LIMITS.chars) throw new Error(TAKE_MESSAGES.size);
  return take;
}
export const takeDuration = (take: SignalTake) => Math.max(0, take.inputs.at(-1)!.timeMs - take.inputs[0]!.timeMs);
/** Continuous values interpolate; state, events and geometry keep their recorded order. */
function between(
  left: WorldInput,
  right: WorldInput | undefined,
  timeMs: number,
  previousTime: number | null,
): WorldInput {
  const amount =
    right && right.timeMs > left.timeMs ? clampUnit((timeMs - left.timeMs) / (right.timeMs - left.timeMs)) : 0;
  const mix = (a: number, b: number) => a + (b - a) * amount;
  const a = left.signals.scroll,
    b = right?.signals.scroll,
    p = left.signals.pointer,
    q = right?.signals.pointer;
  return {
    ...left,
    timeMs,
    deltaMs: previousTime === null ? 0 : Math.max(0, timeMs - previousTime),
    events: [],
    signals: {
      ...left.signals,
      ...(left.signals.pointerTimeMs !== undefined && right?.signals.pointerTimeMs !== undefined
        ? { pointerTimeMs: mix(left.signals.pointerTimeMs, right.signals.pointerTimeMs) }
        : {}),
      ...(p && q ? { pointer: { x: mix(p.x, q.x), y: mix(p.y, q.y) } } : {}),
      ...(a && b
        ? { scroll: { x: mix(a.x, b.x), y: mix(a.y, b.y), maxX: mix(a.maxX, b.maxX), maxY: mix(a.maxY, b.maxY) } }
        : {}),
    },
  };
}
/** What a take keeps of a live input: the creator's signals, without the Host restrictions
 * (the whole-page rule or the roots held over a control). Playback applies the live ones. */
export function takeInput(input: WorldInput): WorldInput {
  const { safeInteraction, approach, ...environment } = input.environment;
  // A part's reduced form and its seats are not part of a take (artwork data; its format is
  // unchanged). Both are the adapter's facts about the page, given again on playback.
  const { reducedParts, seats, ...recorded } = input;
  if (safeInteraction === undefined && approach === undefined)
    return reducedParts === undefined && seats === undefined ? input : recorded;
  return { ...recorded, environment };
}
/** Upper bound keeps simultaneous events in their original recorded order. */
function inputEnd(take: SignalTake, timeMs: number): number {
  let low = 0,
    high = take.inputs.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (take.inputs[middle]!.timeMs <= timeMs) low = middle + 1;
    else high = middle;
  }
  return low;
}
/** Stateless signal projection, without evaluating the scene or allocating frames. */
export function sampleTakeInput(take: SignalTake, positionMs: number): WorldInput {
  const timeMs =
    take.inputs[0]!.timeMs + Math.max(0, Math.min(takeDuration(take), Number.isFinite(positionMs) ? positionMs : 0));
  const end = inputEnd(take, timeMs),
    left = take.inputs[Math.max(0, end - 1)]!;
  return left.timeMs === timeMs ? left : between(left, take.inputs[end], timeMs, left.timeMs);
}

export interface GhostKeyframe {
  keyId: string;
  timeMs: number;
  input: number;
}
/** Derived crossings only. Changing a take never creates independent artwork keys. */
export function projectGhosts(take: SignalTake, rule: SignalRule, scene?: WorldScene): GhostKeyframe[] {
  if (!rule.enabled) return [];
  const definition = SIGNAL_REGISTRY.definition(rule.source.signal);
  if (definition?.valueType !== 'number' || definition.projection !== 'scroll-ratio')
    return projectNumericGhosts(takeSignalSeries(take, rule, scene), rule, TAKE_LIMITS.ghosts);
  const ghosts: GhostKeyframe[] = [],
    seen = new Set<string>(),
    start = take.inputs[0]!.timeMs;
  const add = (keyId: string, input: number, timeMs: number) => {
    const signature = `${keyId}:${timeMs.toFixed(3)}`;
    if (ghosts.length < TAKE_LIMITS.ghosts && !seen.has(signature)) {
      seen.add(signature);
      ghosts.push({ keyId, input, timeMs });
    }
  };
  for (const key of rule.keyframes) {
    const progress = rule.source.inputRange[0] + key.input * (rule.source.inputRange[1] - rule.source.inputRange[0]);
    if (Math.abs(scrollProgress(take.inputs[0]!.signals) - progress) < 1e-9) add(key.id, key.input, 0);
    for (let index = 1; index < take.inputs.length && ghosts.length < TAKE_LIMITS.ghosts; index++) {
      const left = take.inputs[index - 1]!,
        right = take.inputs[index]!,
        a = left.signals.scroll,
        b = right.signals.scroll;
      if (!a || !b || right.timeMs <= left.timeMs) continue;
      const before = scrollProgress(left.signals),
        after = scrollProgress(right.signals);
      if (
        Math.abs(after - before) < 1e-9 ||
        progress < Math.min(before, after) - 1e-9 ||
        progress > Math.max(before, after) + 1e-9
      )
        continue;
      // Interpolated raw y/range is rational when the page height changes.
      const divisor = b.y - a.y - progress * (b.maxY - a.maxY);
      if (Math.abs(divisor) < 1e-12) continue;
      const amount = (progress * a.maxY - a.y) / divisor;
      if (amount < -1e-9 || amount > 1 + 1e-9 || a.maxY + (b.maxY - a.maxY) * amount <= 0) continue;
      add(key.id, key.input, left.timeMs - start + clampUnit(amount) * (right.timeMs - left.timeMs));
    }
  }
  return ghosts.sort((a, b) => a.timeMs - b.timeMs);
}
/** One scene revision per sampler. Sparse state caches never include frames. */
export function createTakeSampler(scene: WorldScene, source: SignalTake) {
  const take = parseSignalTake(source),
    checkpoints = new Map<number, WorldState>([[0, take.initialState]]);
  let prepared: ReturnType<typeof evaluateLayout> | undefined,
    geometry = '';
  const step = (state: WorldState, input: WorldInput) => {
    const signature = JSON.stringify([input.viewport, input.anchors]);
    if (!prepared || signature !== geometry) {
      prepared = evaluateLayout(scene, input);
      geometry = signature;
    }
    return evaluatePreparedWorld(prepared, state, input, scene.signalRules);
  };
  /** The live Host restriction joins the returned frame only, never the recorded history. */
  const restricted = (input: WorldInput, approach?: WorldApproach) =>
    approach ? { ...input, environment: { ...input.environment, approach } } : input;
  return {
    at(positionMs: number, approach?: WorldApproach) {
      const timeMs =
        take.inputs[0]!.timeMs +
        Math.max(0, Math.min(takeDuration(take), Number.isFinite(positionMs) ? positionMs : 0));
      const end = inputEnd(take, timeMs);
      let start = Math.floor(Math.max(0, end - 1) / 32) * 32;
      while (!checkpoints.has(start)) start -= 32;
      let state = checkpoints.get(start)!,
        prior = state,
        result: ReturnType<typeof evaluateWorld> | undefined;
      for (let index = start; index < end; index++) {
        prior = state;
        result = step(state, take.inputs[index]!);
        state = result.state;
        if ((index + 1) % 32 === 0) checkpoints.set(index + 1, state);
      }
      const last = take.inputs[Math.max(0, end - 1)]!,
        input = between(last, take.inputs[end], timeMs, state.timeMs);
      // A sample at its exact timestamp must retain that sample's event occurrence.
      if (last.timeMs === timeMs && result)
        return { ...(approach ? step(prior, restricted(last, approach)) : result), input: last };
      const evaluated = step(state, restricted(input, approach));
      return { ...evaluated, input };
    },
    get checkpoints() {
      return checkpoints.size;
    },
  };
}
