/** A data-only controller; asset formats and render backends are irrelevant. */
export interface FollowMotion {
  kind: 'pointer-follow'; enabled: boolean; mode: 'direct' | 'smooth' | 'pursuit';
  lagMs: number; maxSpeed: number; acceleration: number; deceleration: number;
  stopRadius: number; orientToMovement: boolean; rotationOffsetDeg: number;
}
export const defaultFollowMotion = (): FollowMotion => ({ kind: 'pointer-follow', enabled: true, mode: 'pursuit', lagMs: 180, maxSpeed: 400, acceleration: 1200, deceleration: 1600, stopRadius: 48, orientToMovement: true, rotationOffsetDeg: 0 });
export function parseMotion(value: unknown): FollowMotion {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('モーション設定が不正です。');
  const data = value as Record<string, unknown>;
  if (Object.keys(data).some((key) => !['kind', 'enabled', 'mode', 'lagMs', 'maxSpeed', 'acceleration', 'deceleration', 'stopRadius', 'orientToMovement', 'rotationOffsetDeg'].includes(key)) || data['kind'] !== 'pointer-follow' || !['direct', 'smooth', 'pursuit'].includes(String(data['mode'])) || typeof data['enabled'] !== 'boolean' || typeof data['orientToMovement'] !== 'boolean') throw new Error('未対応のモーション設定です。');
  const number = (key: string, min: number, max: number) => { const n = data[key]; if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max) throw new Error(`${key} が範囲外です。`); return n; };
  return { kind: 'pointer-follow', enabled: data['enabled'], mode: data['mode'] as FollowMotion['mode'], lagMs: number('lagMs', 0, 5000), maxSpeed: number('maxSpeed', 1, 10000), acceleration: number('acceleration', 1, 50000), deceleration: number('deceleration', 1, 50000), stopRadius: number('stopRadius', 0, 4096), orientToMovement: data['orientToMovement'], rotationOffsetDeg: number('rotationOffsetDeg', -180, 180) };
}
