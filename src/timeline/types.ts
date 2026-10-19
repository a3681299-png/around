import type { SignalTake } from '../world/takes';

export interface TakeSummary { id: string; name: string; siteId: string; durationMs: number; samples: number }
export interface TimelineStatus {
  available: boolean; mode: 'live' | 'recording' | 'playing' | 'paused'; source: 'live' | 'take' | 'signal';
  timeMs: number; durationMs: number; samples: number; progress: number; rate: number;
  saved: boolean; message: string; error: boolean;
}
export interface TimelineUpdate { status: TimelineStatus; take?: SignalTake | null; library?: TakeSummary[] }
export type TimelineCommand = { type: 'record' | 'stop' | 'pause' | 'live' | 'store' | 'list' | 'clear' }
  | { type: 'play'; rate: number } | { type: 'seek'; timeMs: number } | { type: 'preview'; progress: number }
  | { type: 'load' | 'delete'; id: string } | { type: 'observe'; value: boolean };
export interface TimelinePort {
  snapshot(): TimelineUpdate;
  subscribe(listener: (update: TimelineUpdate) => void): () => void;
  dispatch(command: TimelineCommand): Promise<void>;
}
export interface TakeStorage { list(): Promise<TakeSummary[]>; get(id: string): Promise<SignalTake>; put(take: SignalTake): Promise<void>; remove(id: string): Promise<void> }
export function parseTimelineCommand(value: unknown): TimelineCommand {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('タイムライン操作が不正です。');
  const data = value as Record<string, unknown>, fields: Record<string, readonly string[]> = { record: [], stop: [], pause: [], live: [], store: [], list: [], clear: [], play: ['rate'], seek: ['timeMs'], preview: ['progress'], load: ['id'], delete: ['id'], observe: ['value'] };
  if (typeof data['type'] !== 'string' || !Object.hasOwn(fields, data['type']) || Object.keys(data).some((key) => key !== 'type' && !fields[data['type'] as string]!.includes(key))) throw new Error('未対応のタイムライン操作です。');
  if (['load', 'delete'].includes(data['type']) && (typeof data['id'] !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(data['id']))) throw new Error('テイクの識別子が不正です。');
  if (data['type'] === 'observe' && typeof data['value'] !== 'boolean') throw new Error('表示状態が不正です。');
  for (const [type, key, min, max] of [['play', 'rate', -2, 2], ['seek', 'timeMs', 0, 180000], ['preview', 'progress', 0, 1]] as const) if (data['type'] === type && (typeof data[key] !== 'number' || !Number.isFinite(data[key]) || data[key] < min || data[key] > max || type === 'play' && Math.abs(data[key]) < .25)) throw new Error('タイムラインの数値が範囲外です。');
  return { ...data } as TimelineCommand;
}
