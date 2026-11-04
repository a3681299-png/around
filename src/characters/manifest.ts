import { CHARACTER_LIMITS, MOTION_ROLES, type CharacterMotion, type MotionRole } from './settings';
import { oneOf } from '../validation';

/**
 * A motion folder's manifest.json is an authoring aid only: it names and sorts the files.
 * Durations, hips travel and loops-in-place are always re-measured from the .vrma itself.
 * Unknown or malformed entries are skipped, never trusted, and nothing here is stored as-is.
 */
export interface MotionLabel {
  name: string;
  role: MotionRole;
  loop: boolean;
}
export const MANIFEST_LIMITS = Object.freeze({ chars: 256 * 1024, clips: 256 });

const basename = (path: string) => path.split(/[\\/]/).pop()!.toLowerCase();
/** Keys are lower-case file names (either the character's own file or the any-model file). */
export function parseMotionManifest(text: string): Map<string, MotionLabel> {
  const labels = new Map<string, MotionLabel>();
  if (text.length > MANIFEST_LIMITS.chars) throw new Error('manifest.json が大きすぎます。');
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('manifest.json を読めません。');
  }
  const clips = (data as { clips?: unknown } | null)?.clips;
  if (!Array.isArray(clips)) throw new Error('manifest.json に動作の一覧（clips）がありません。');
  for (const clip of clips.slice(0, MANIFEST_LIMITS.clips)) {
    if (!clip || typeof clip !== 'object') continue;
    const c = clip as Record<string, unknown>;
    if (typeof c['name'] !== 'string' || !oneOf(c['category'], MOTION_ROLES)) continue;
    const label = { name: c['name'].slice(0, 64), role: c['category'] as MotionRole, loop: c['loop'] !== false };
    for (const key of ['file', 'file_any_model'])
      if (typeof c[key] === 'string' && (c[key] as string).length <= 256) labels.set(basename(c[key] as string), label);
  }
  return labels;
}

/** Labels as they cross from the Studio page to the YouTube tab: rebuilt, never trusted. */
export function parseMotionLabels(value: unknown): Map<string, MotionLabel> {
  if (!Array.isArray(value) || value.length > MANIFEST_LIMITS.clips) throw new Error('動作の名前の一覧が不正です。');
  const labels = new Map<string, MotionLabel>();
  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length !== 2) throw new Error('動作の名前の一覧が不正です。');
    const [file, label] = entry as [unknown, Record<string, unknown> | null];
    if (
      typeof file !== 'string' ||
      file.length > 256 ||
      !label ||
      typeof label !== 'object' ||
      Object.keys(label).some((k) => !['name', 'role', 'loop'].includes(k)) ||
      typeof label['name'] !== 'string' ||
      label['name'].length > 64 ||
      !oneOf(label['role'], MOTION_ROLES) ||
      typeof label['loop'] !== 'boolean'
    )
      throw new Error('動作の名前の一覧が不正です。');
    labels.set(basename(file), { name: label['name'], role: label['role'] as MotionRole, loop: label['loop'] });
  }
  return labels;
}

/** An engine ID from an author's name: lower-case letters, digits and hyphens, unique. */
export function motionId(name: string, taken: ReadonlySet<string>): string {
  const base =
    name
      .toLowerCase()
      .replace(/\.vrma$/, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/^(?=[0-9])/, 'm-')
      .slice(0, 56) || 'motion';
  let id = base,
    n = 2;
  while (taken.has(id)) id = `${base}-${n++}`;
  return id;
}

/** New motions for imported .vrma assets, labelled by the manifest when it names the file. */
export function draftMotions(
  existing: readonly CharacterMotion[],
  assets: readonly { id: string; name: string; vrmAnimation: CharacterMotion['source'] }[],
  labels: ReadonlyMap<string, MotionLabel>,
  origin: CharacterMotion['origin'],
): CharacterMotion[] {
  if (existing.length + assets.length > CHARACTER_LIMITS.motions)
    throw new Error(`キャラの動作は${CHARACTER_LIMITS.motions}個までです。`);
  const taken = new Set(existing.map((m) => m.id));
  return assets.map((asset) => {
    const label = labels.get(basename(asset.name));
    const id = motionId(label?.name ?? asset.name, taken);
    taken.add(id);
    // Without a manifest a one-frame file is a pose to sit or stand in; anything else idles.
    const role: MotionRole = label?.role ?? (asset.vrmAnimation.duration === 0 ? 'sit' : 'idle');
    return { id, assetId: asset.id, role, origin, loop: label?.loop ?? true, source: asset.vrmAnimation };
  });
}
