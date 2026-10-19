import { parseWorldInput, parseWorldState } from './recording';
import { evaluateWorld } from './evaluate';
import { WORLD_RUNTIME_VERSION, type WorldInput, type WorldScene, type WorldState } from './types';
import { clampUnit } from './keyframes';

export const TAKE_LIMITS = Object.freeze({ samples: 3600, chars: 4 * 1024 * 1024, durationMs: 180_000, intervalMs: 50, storedCount: 8, storedChars: 16 * 1024 * 1024, ghosts: 4096 });
/** Inputs only: rules and asset references belong to the artwork, never the take. */
export interface SignalTake {
  format: 'ww-signal-take'; formatVersion: 1; runtimeVersion: typeof WORLD_RUNTIME_VERSION;
  id: string; name: string; siteId: string;
  initialState: WorldState; inputs: WorldInput[];
}
export function parseSignalTake(value: unknown): SignalTake {
  if (typeof value === 'string') { if (value.length > TAKE_LIMITS.chars) throw new Error('テイクは4MBまでです。'); value = JSON.parse(value); }
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !['format', 'formatVersion', 'runtimeVersion', 'id', 'name', 'siteId', 'initialState', 'inputs'].includes(key))) throw new Error('テイクの形式が不正です。');
  const data = value as Record<string, unknown>;
  const id = (value: unknown): value is string => typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value);
  if (data['format'] !== 'ww-signal-take' || data['formatVersion'] !== 1 || data['runtimeVersion'] !== WORLD_RUNTIME_VERSION || !id(data['id']) || !id(data['siteId']) || typeof data['name'] !== 'string' || !data['name'].length || data['name'].length > 80 || /[\u0000-\u001f]/.test(data['name'])) throw new Error('未対応または不正なテイクです。');
  if (!Array.isArray(data['inputs']) || !data['inputs'].length || data['inputs'].length > TAKE_LIMITS.samples) throw new Error('テイクは1〜3600サンプルで指定してください。');
  const initialState = parseWorldState(data['initialState']), inputs = data['inputs'].map(parseWorldInput);
  let previous = initialState.timeMs ?? 0;
  for (const input of inputs) { if (input.timeMs < previous || input.timeMs - inputs[0]!.timeMs > TAKE_LIMITS.durationMs) throw new Error('テイクの時刻が不正です。'); previous = input.timeMs; }
  const take: SignalTake = { format: 'ww-signal-take', formatVersion: 1, runtimeVersion: WORLD_RUNTIME_VERSION, id: data['id'], name: data['name'], siteId: data['siteId'], initialState, inputs };
  if (JSON.stringify(take).length > TAKE_LIMITS.chars) throw new Error('テイクは4MBまでです。'); return take;
}
export const takeDuration = (take: SignalTake) => Math.max(0, take.inputs.at(-1)!.timeMs - take.inputs[0]!.timeMs);
/** Continuous values interpolate; state, events and geometry keep their recorded order. */
function between(left: WorldInput, right: WorldInput | undefined, timeMs: number, previousTime: number | null): WorldInput {
  const amount = right && right.timeMs > left.timeMs ? clampUnit((timeMs - left.timeMs) / (right.timeMs - left.timeMs)) : 0;
  const mix = (a: number, b: number) => a + (b - a) * amount;
  const a = left.signals.scroll, b = right?.signals.scroll, p = left.signals.pointer, q = right?.signals.pointer;
  return { ...left, timeMs, deltaMs: previousTime === null ? 0 : Math.max(0, timeMs - previousTime), events: [], signals: { ...left.signals,
    ...(p && q ? { pointer: { x: mix(p.x, q.x), y: mix(p.y, q.y) } } : {}),
    ...(a && b ? { scroll: { x: mix(a.x, b.x), y: mix(a.y, b.y), maxX: mix(a.maxX, b.maxX), maxY: mix(a.maxY, b.maxY) } } : {}) } };
}
/** Sparse state checkpoints bound reverse/seek work; cached states never include frames. */
export function createTakeSampler(scene: WorldScene, source: SignalTake) {
  const take = parseSignalTake(source), checkpoints = new Map<number, WorldState>([[0, take.initialState]]);
  return {
    at(positionMs: number) {
      const timeMs = take.inputs[0]!.timeMs + Math.max(0, Math.min(takeDuration(take), Number.isFinite(positionMs) ? positionMs : 0));
      let end = 0; while (end < take.inputs.length && take.inputs[end]!.timeMs <= timeMs) end++;
      let start = Math.floor(Math.max(0, end - 1) / 32) * 32; while (!checkpoints.has(start)) start -= 32;
      let state = checkpoints.get(start)!, result: ReturnType<typeof evaluateWorld> | undefined;
      for (let index = start; index < end; index++) { result = evaluateWorld(scene, state, take.inputs[index]!); state = result.state; if ((index + 1) % 32 === 0) checkpoints.set(index + 1, state); }
      const last = take.inputs[Math.max(0, end - 1)]!, input = between(last, take.inputs[end], timeMs, state.timeMs);
      // A sample at its exact timestamp must retain that sample's event occurrence.
      if (last.timeMs === timeMs && result) return { ...result, input: last };
      const evaluated = evaluateWorld(scene, state, input); return { ...evaluated, input };
    },
    get checkpoints() { return checkpoints.size; },
  };
}
