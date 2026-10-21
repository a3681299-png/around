import { isDesignId, parseDecoration, parseDesign, parseGroupLayer, parseSurfaceStyle } from './schema';
import { GROUP_LIMITS, IMAGE_LIMITS, type DesignDocument } from './types';
import { MODEL_LIMITS } from '../models/types';
import { ANIMATION_LIMITS } from '../assets/motion-types';
import { ASSET_MESSAGES } from '../assets/limits';
import { SIGNAL_RULE_LIMITS } from '../signals/keyframes';
import { parseSignalRules } from '../signals/keyframe-schema';
import { sameAnchor } from './hierarchy';

const documents = new WeakSet<object>(),
  frozen = new WeakSet<object>();

/** Only trees already owned by the editor may bypass recursive freezing. */
export function freezeTree<T>(value: T): T {
  if (value && typeof value === 'object' && !frozen.has(value)) {
    Object.values(value).forEach(freezeTree);
    Object.freeze(value);
    frozen.add(value);
  }
  return value;
}

/** External data always crosses the full versioned schema before it becomes trusted. */
export function readDesign(value: unknown): DesignDocument {
  if (value && typeof value === 'object' && documents.has(value)) return value as DesignDocument;
  const parsed = freezeTree(parseDesign(value));
  documents.add(parsed);
  return parsed;
}

function share<T>(before: T, next: T): T {
  if (
    before === next ||
    !before ||
    !next ||
    typeof before !== 'object' ||
    typeof next !== 'object' ||
    Array.isArray(before) !== Array.isArray(next)
  )
    return next;
  const a = before as Record<string, unknown>,
    b = next as Record<string, unknown>;
  const keys = Object.keys(b),
    result: Record<string, unknown> = Array.isArray(next) ? ([] as unknown as Record<string, unknown>) : {};
  let same = Object.keys(a).length === keys.length;
  let unchangedNext = true;
  for (const key of keys) {
    result[key] = share(a[key], b[key]);
    if (!Object.hasOwn(a, key) || result[key] !== a[key]) same = false;
    if (result[key] !== b[key]) unchangedNext = false;
  }
  return same ? before : unchangedNext ? next : (result as T);
}

/** Mutable containers for an operation; unchanged layers and nested data stay shared. */
export function editDesign(input: DesignDocument): DesignDocument {
  return {
    ...input,
    rules: [...input.rules],
    decorations: [...input.decorations],
    ...(input.groups ? { groups: [...input.groups] } : {}),
    ...(input.signalRules ? { signalRules: [...input.signalRules] } : {}),
  };
}

/** Validate changed nodes and cross-node invariants, never rebuild unchanged subtrees. */
export function commitDesign(input: DesignDocument, previous?: DesignDocument): DesignDocument {
  if (documents.has(input)) return input;
  if (previous) previous = readDesign(previous);
  if (
    input.schemaVersion !== 11 ||
    !isDesignId(input.id) ||
    !isDesignId(input.siteId) ||
    (input.baseThemeId !== null && !isDesignId(input.baseThemeId))
  )
    throw new Error('デザインの識別子が不正です。');
  if (input.rules.length > 16 || new Set(input.rules.map((rule) => rule.target)).size !== input.rules.length)
    throw new Error('デザインのルールが不正です。');
  const rules = input.rules.map((rule) => {
    if (frozen.has(rule)) return rule;
    if (rule.kind !== 'surface-style' || !isDesignId(rule.target)) throw new Error('編集対象が不正です。');
    return { kind: 'surface-style' as const, target: rule.target, style: parseSurfaceStyle(rule.style) };
  });
  if (input.decorations.length > IMAGE_LIMITS.count) throw new Error(ASSET_MESSAGES.layerCount);
  const decorations = input.decorations.map((layer) => (frozen.has(layer) ? layer : parseDecoration(layer)));
  if (decorations.filter((layer) => layer.kind === 'model3d').length > MODEL_LIMITS.count)
    throw new Error(ASSET_MESSAGES.modelCount);
  if (decorations.filter((layer) => layer.kind === 'animation').length > ANIMATION_LIMITS.count)
    throw new Error(ASSET_MESSAGES.layerCount);
  if ((input.groups?.length ?? 0) > GROUP_LIMITS.count) throw new Error('グループは16個までです。');
  const groups = (input.groups ?? []).map((layer) => (frozen.has(layer) ? layer : parseGroupLayer(layer)));
  const ids = new Set([...decorations, ...groups].map((layer) => layer.id));
  if (ids.size !== decorations.length + groups.length) throw new Error('レイヤーのIDが重複しています。');
  const assigned = new Set<string>();
  for (const group of groups) {
    const children = group.children.map((id) => decorations.find((layer) => layer.id === id));
    if (children.some((child) => !child || assigned.has(child.id))) throw new Error('グループの参照が不正です。');
    if (children.some((child) => !sameAnchor(child!.placement.anchor, children[0]!.placement.anchor)))
      throw new Error('同じ配置基準のレイヤーだけをグループ化できます。');
    group.children.forEach((id) => assigned.add(id));
  }
  if ((input.signalRules?.length ?? 0) > SIGNAL_RULE_LIMITS.rules) throw new Error('シグナルルールが多すぎます。');
  const ruleIds = new Set<string>(),
    targets = new Set<string>();
  const signalRules = (input.signalRules ?? []).map((value) => {
    const rule = frozen.has(value) ? value : parseSignalRules([value], ids)[0]!;
    const target = `${rule.target.layerId}:${rule.target.property}`;
    if (!ids.has(rule.target.layerId) || ruleIds.has(rule.id) || (rule.enabled && targets.has(target)))
      throw new Error('シグナルルールの対象が不正または重複しています。');
    ruleIds.add(rule.id);
    if (rule.enabled) targets.add(target);
    return rule;
  });
  const next = {
    ...input,
    rules,
    decorations,
    ...(groups.length ? { groups } : {}),
    ...(signalRules.length ? { signalRules } : {}),
  };
  if (!groups.length) delete next.groups;
  if (!signalRules.length) delete next.signalRules;
  const shared = previous ? share(previous, next) : next;
  freezeTree(shared);
  documents.add(shared);
  return shared;
}

/** Canonicalize an already validated revision against the saved reference too. */
export function shareDesign(before: DesignDocument, next: DesignDocument): DesignDocument {
  const shared = freezeTree(share(before, next));
  documents.add(shared);
  return shared;
}
