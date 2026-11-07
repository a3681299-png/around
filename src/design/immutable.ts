import { parseSpace } from './space';
import {
  checkGroupDepth,
  checkGroupRenderMode,
  checkStyleRules,
  isDesignId,
  parseDecoration,
  parseDesign,
  parseGroupLayer,
  parseStyleRule,
} from './schema';
import { GROUP_LIMITS, IMAGE_LIMITS, type Decoration, type DesignDocument } from './types';
import { MODEL_LIMITS } from '../models/types';
import { ANIMATION_LIMITS } from '../assets/motion-types';
import { ASSET_MESSAGES } from '../assets/limits';
import { SIGNAL_RULE_LIMITS } from '../signals/keyframes';
import { parseSignalRules } from '../signals/keyframe-schema';
import { sameAnchor } from './hierarchy';

const documents = new WeakSet<object>(),
  frozen = new WeakSet<object>();
// Validation belongs to a schema role, independently of recursive immutability.
const validated = {
  rules: new WeakSet<DesignDocument['rules'][number]>(),
  decorations: new WeakSet<DesignDocument['decorations'][number]>(),
  groups: new WeakSet<NonNullable<DesignDocument['groups']>[number]>(),
  signalRules: new WeakSet<NonNullable<DesignDocument['signalRules']>[number]>(),
};

/** Freeze any tree, including display data, without granting schema trust. */
export function freezeTree<T>(value: T): T {
  if (value && typeof value === 'object' && !frozen.has(value)) {
    Object.values(value).forEach(freezeTree);
    Object.freeze(value);
    frozen.add(value);
  }
  return value;
}

/** Private: only schema results or structural sharing of validated revisions reach here. */
function adoptValidatedDesign(value: DesignDocument): DesignDocument {
  if (documents.has(value)) return value;
  freezeTree(value);
  value.rules.forEach((rule) => validated.rules.add(rule));
  value.decorations.forEach((layer) => validated.decorations.add(layer));
  value.groups?.forEach((group) => validated.groups.add(group));
  value.signalRules?.forEach((rule) => validated.signalRules.add(rule));
  documents.add(value);
  return value;
}

/** External data always crosses the full versioned schema before it becomes trusted. */
export function readDesign(value: unknown): DesignDocument {
  if (value && typeof value === 'object' && documents.has(value)) return value as DesignDocument;
  return adoptValidatedDesign(parseDesign(value));
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
  const identity = (item: unknown): unknown =>
    item && typeof item === 'object'
      ? 'id' in item
        ? item.id
        : 'target' in item && typeof item.target === 'string'
          ? item.target
          : undefined
      : undefined;
  const byId = Array.isArray(before)
    ? new Map(before.filter((item) => identity(item) !== undefined).map((item) => [identity(item), item]))
    : undefined;
  let same = Object.keys(a).length === keys.length;
  let unchangedNext = true;
  for (const key of keys) {
    result[key] = share(byId?.get(identity(b[key])) ?? a[key], b[key]);
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
    input.schemaVersion !== 17 ||
    !isDesignId(input.id) ||
    !isDesignId(input.siteId) ||
    (input.baseThemeId !== null && !isDesignId(input.baseThemeId))
  )
    throw new Error('デザインの識別子が不正です。');
  if (input.rules.length > 16) throw new Error('デザインのルールが不正です。');
  const rules = input.rules.map((rule) => (validated.rules.has(rule) ? rule : parseStyleRule(rule)));
  checkStyleRules(rules);
  if (input.decorations.length > IMAGE_LIMITS.count) throw new Error(ASSET_MESSAGES.layerCount);
  const decorations = input.decorations.map((layer) =>
    validated.decorations.has(layer) ? layer : parseDecoration(layer),
  );
  if (decorations.filter((layer) => layer.kind === 'model3d').length > MODEL_LIMITS.count)
    throw new Error(ASSET_MESSAGES.modelCount);
  if (decorations.filter((layer) => layer.kind === 'animation').length > ANIMATION_LIMITS.count)
    throw new Error(ASSET_MESSAGES.layerCount);
  if ((input.groups?.length ?? 0) > GROUP_LIMITS.count) throw new Error('グループは16個までです。');
  const groups = (input.groups ?? []).map((layer) => (validated.groups.has(layer) ? layer : parseGroupLayer(layer)));
  const ids = new Set([...decorations, ...groups].map((layer) => layer.id));
  if (ids.size !== decorations.length + groups.length) throw new Error('レイヤーのIDが重複しています。');
  const assigned = new Set<string>();
  for (const group of groups) {
    const children = group.children.map((id) => decorations.find((layer) => layer.id === id));
    if (children.some((child) => !child || assigned.has(child.id))) throw new Error('グループの参照が不正です。');
    if (children.some((child) => !sameAnchor(child!.placement.anchor, children[0]!.placement.anchor)))
      throw new Error('同じ配置基準のレイヤーだけをグループ化できます。');
    checkGroupRenderMode(group, children as Decoration[]);
    checkGroupDepth(group, children as Decoration[]);
    group.children.forEach((id) => assigned.add(id));
  }
  if ((input.signalRules?.length ?? 0) > SIGNAL_RULE_LIMITS.rules) throw new Error('シグナルルールが多すぎます。');
  const ruleIds = new Set<string>(),
    targets = new Set<string>();
  const signalRules = (input.signalRules ?? []).map((value) => {
    const rule = validated.signalRules.has(value) ? value : parseSignalRules([value], ids)[0]!;
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
    ...(input.space ? { space: parseSpace(input.space) } : {}),
  };
  if (!groups.length) delete next.groups;
  if (!signalRules.length) delete next.signalRules;
  if (!input.space) delete next.space;
  return adoptValidatedDesign(previous ? share(previous, next) : next);
}

/** Canonicalize an already validated revision against the saved reference too. */
export function shareDesign(before: DesignDocument, next: DesignDocument): DesignDocument {
  return adoptValidatedDesign(share(readDesign(before), readDesign(next)));
}
