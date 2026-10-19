import { isDesignId, parseDesign } from '../design/schema';
import { evaluateWorld } from './evaluate';
import type { Fade } from './masks';
import { WORLD_RUNTIME_VERSION, type WorldEvent, type WorldInput, type WorldScene, type WorldState, type WorldFrame } from './types';

export const RECORDING_LIMITS = Object.freeze({ frames: 3600, chars: 8 * 1024 * 1024, durationMs: 600_000, anchors: 32, events: 64 });
export interface WorldRecording {
  format: 'ww-world-inputs';
  formatVersion: 3;
  runtimeVersion: typeof WORLD_RUNTIME_VERSION;
  scene: WorldScene;
  initialState: WorldState;
  inputs: WorldInput[];
}
type StopReason = 'manual' | 'capacity' | 'scene-changed' | 'destroyed' | 'invalid-input';
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !keys.includes(key))) throw new Error('Invalid World recording fields.');
  return value as Record<string, unknown>;
}
function number(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error('Invalid World recording number.'); return value;
}
function boolean(value: unknown): boolean { if (typeof value !== 'boolean') throw new Error('Invalid World recording boolean.'); return value; }
function point(value: unknown) { const data = record(value, ['x', 'y']); return { x: number(data['x'], -1e7, 1e7), y: number(data['y'], -1e7, 1e7) }; }
function events(value: unknown): WorldEvent[] {
  if (!Array.isArray(value) || value.length > RECORDING_LIMITS.events) throw new Error('Invalid World recording events.');
  return value.map((item) => {
    const data = record(item, ['type', 'point']);
    if (data['type'] === 'pointer.click') return { type: 'pointer.click', point: point(data['point']) };
    if (!['video.play', 'video.pause', 'video.ended', 'host.lifecycle'].includes(data['type'] as string) || Object.hasOwn(data, 'point')) throw new Error('Unknown World event.');
    return { type: data['type'] as 'video.play' | 'video.pause' | 'video.ended' | 'host.lifecycle' };
  });
}
export function parseWorldInput(value: unknown): WorldInput {
  const data = record(value, ['timeMs', 'deltaMs', 'viewport', 'anchors', 'signals', 'events', 'environment', 'seed']);
  const viewport = record(data['viewport'], ['width', 'height']), signals = record(data['signals'], ['pointer', 'playing', 'scroll']);
  const environment = record(data['environment'], ['hidden', 'reducedMotion']);
  const anchors = data['anchors'];
  if (!anchors || typeof anchors !== 'object' || Array.isArray(anchors) || Object.keys(anchors).length > RECORDING_LIMITS.anchors) throw new Error('Invalid recording anchors.');
  const frames = Object.fromEntries(Object.entries(anchors).map(([id, value]) => {
    if (!isDesignId(id)) throw new Error('Invalid semantic anchor ID.');
    const frame = record(value, ['left', 'top', 'width', 'height']);
    return [id, { left: number(frame['left'], -1e7, 1e7), top: number(frame['top'], -1e7, 1e7), width: number(frame['width'], .001, 1e6), height: number(frame['height'], .001, 1e6) }];
  }));
  const seed = data['seed'] === undefined ? undefined : number(data['seed'], 0, 0xffffffff);
  if (seed !== undefined && !Number.isInteger(seed)) throw new Error('Invalid World seed.');
  const scroll = signals['scroll'] === undefined ? undefined : record(signals['scroll'], ['x', 'y', 'maxX', 'maxY']);
  return { timeMs: number(data['timeMs']), deltaMs: number(data['deltaMs']), viewport: { width: number(viewport['width'], .001, 1e6), height: number(viewport['height'], .001, 1e6) },
    anchors: frames, signals: { pointer: signals['pointer'] === undefined ? undefined : point(signals['pointer']), playing: boolean(signals['playing']), ...(scroll ? { scroll: { x: number(scroll['x'], -1e7, 1e9), y: number(scroll['y'], -1e7, 1e9), maxX: number(scroll['maxX'], 0, 1e9), maxY: number(scroll['maxY'], 0, 1e9) } } : {}) },
    events: events(data['events']), environment: { hidden: boolean(environment['hidden']), reducedMotion: boolean(environment['reducedMotion']) }, ...(seed === undefined ? {} : { seed }) };
}
export function parseWorldScene(value: unknown, legacy = false): WorldScene {
  const scene = record(value, ['decorations', 'groups', ...(!legacy ? ['signalRules'] : [])]);
  const design = parseDesign({ schemaVersion: legacy ? 6 : 8, id: 'runtime-recording', siteId: 'runtime-host', baseThemeId: null, rules: [], ...scene });
  return { decorations: design.decorations, ...(design.groups ? { groups: design.groups } : {}), ...(design.signalRules ? { signalRules: design.signalRules } : {}) };
}
export function parseWorldState(value: unknown, scene?: WorldScene): WorldState {
  const data = record(value, ['runtimeVersion', 'timeMs', 'effects', 'machine']);
  if (data['runtimeVersion'] !== WORLD_RUNTIME_VERSION && data['runtimeVersion'] !== '1.0.0') throw new Error('Unsupported World Runtime version.');
  const input = record(data['effects'], ['fades', 'visibility']), machine = record(data['machine'], ['video', 'events']);
  const ids = scene && new Set([...scene.decorations, ...scene.groups ?? []].map((layer) => layer.id));
  const entries = (value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 48 || Object.keys(value).some((id) => !isDesignId(id) || ids && !ids.has(id))) throw new Error('Invalid World state IDs.');
    return Object.entries(value);
  };
  const fades: Record<string, Fade> = Object.fromEntries(entries(input['fades']).map(([id, value]) => {
    const fade = record(value, ['from', 'to', 'start', 'duration']);
    return [id, { from: number(fade['from'], 0, 1), to: number(fade['to'], 0, 1), start: number(fade['start']), duration: number(fade['duration'], 0, 5000) }];
  }));
  if (machine['video'] !== 'playing' && machine['video'] !== 'paused') throw new Error('Invalid World machine state.');
  return { runtimeVersion: WORLD_RUNTIME_VERSION, timeMs: data['timeMs'] === null ? null : number(data['timeMs']), effects: { fades,
    visibility: Object.fromEntries(entries(input['visibility']).map(([id, value]) => [id, boolean(value)])) }, machine: { video: machine['video'], events: events(machine['events']) } };
}
export function parseWorldRecording(value: unknown): WorldRecording {
  if (typeof value === 'string') { if (value.length > RECORDING_LIMITS.chars) throw new Error('World recording is too large.'); value = JSON.parse(value); }
  const data = record(value, ['format', 'formatVersion', 'runtimeVersion', 'scene', 'initialState', 'inputs']);
  if (data['format'] !== 'ww-world-inputs' || ![1, 2, 3].includes(data['formatVersion'] as number) || data['runtimeVersion'] !== WORLD_RUNTIME_VERSION && data['runtimeVersion'] !== '1.0.0') throw new Error('Unsupported World recording version.');
  if (!Array.isArray(data['inputs']) || data['inputs'].length > RECORDING_LIMITS.frames) throw new Error('Too many World inputs.');
  const scene = parseWorldScene(data['scene'], data['formatVersion'] === 1), initialState = parseWorldState(data['initialState'], scene);
  const inputs = data['inputs'].map(parseWorldInput);
  let time = initialState.timeMs ?? 0;
  for (const input of inputs) {
    if (input.timeMs < time || input.timeMs - inputs[0]!.timeMs > RECORDING_LIMITS.durationMs) throw new Error('Invalid World input timeline.'); time = input.timeMs;
  }
  const result: WorldRecording = { format: 'ww-world-inputs', formatVersion: 3, runtimeVersion: WORLD_RUNTIME_VERSION, scene, initialState, inputs };
  if (JSON.stringify(result).length > RECORDING_LIMITS.chars) throw new Error('World recording is too large.'); return result;
}

/** Opt-in and bounded. No persistence, subscriptions or host information collection. */
export function createWorldRecorder(maxInputs: number = RECORDING_LIMITS.frames) {
  if (!Number.isInteger(maxInputs) || maxInputs < 1 || maxInputs > RECORDING_LIMITS.frames) throw new Error('Invalid recording capacity.');
  let current: WorldRecording | undefined, active = false, reason: StopReason | undefined, signature = '', chars = 0;
  const stop = (nextReason: StopReason = 'manual') => { if (active) { active = false; reason = nextReason; } return current && parseWorldRecording(current); };
  return {
    get active() { return active; },
    status() { return { active, frames: current?.inputs.length ?? 0, reason }; },
    start(scene: WorldScene, state: WorldState) {
      const parsed = parseWorldScene(scene);
      current = { format: 'ww-world-inputs', formatVersion: 3, runtimeVersion: WORLD_RUNTIME_VERSION, scene: parsed, initialState: parseWorldState(state, parsed), inputs: [] };
      signature = JSON.stringify(parsed); chars = JSON.stringify(current).length; active = true; reason = undefined;
    },
    capture(scene: WorldScene, value: WorldInput): boolean {
      if (!active || !current) return false;
      if (JSON.stringify(parseWorldScene(scene)) !== signature) { stop('scene-changed'); return false; }
      const input = parseWorldInput(value), last = current.inputs.at(-1);
      if (input.timeMs < (last?.timeMs ?? current.initialState.timeMs ?? 0)) throw new Error('World input time moved backwards.');
      const size = JSON.stringify(input).length + 1;
      if (chars + size > RECORDING_LIMITS.chars || input.timeMs - (current.inputs[0]?.timeMs ?? input.timeMs) > RECORDING_LIMITS.durationMs) { stop('capacity'); return false; }
      current.inputs.push(input); chars += size;
      if (current.inputs.length >= maxInputs) { active = false; reason = 'capacity'; } return true;
    },
    stop,
    clear() { current = undefined; active = false; reason = undefined; signature = ''; chars = 0; },
  };
}
/** Replay only numeric World evaluation. It does not navigate or manipulate a site. */
export function replayWorld(value: unknown): { state: WorldState; frames: WorldFrame[] } {
  const recording = parseWorldRecording(value);
  let state = recording.initialState;
  const frames = recording.inputs.map((input) => { const result = evaluateWorld(recording.scene, state, input); state = result.state; return result.frame; });
  return { state, frames };
}
