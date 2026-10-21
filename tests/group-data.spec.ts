import { test, expect } from '@playwright/test';
import { emptyDesign, parseDesign, sameDesign } from '../src/design/schema';
import {
  childrenOf,
  frontToBack,
  groupView,
  movableMedia,
  normalizeSelection,
  rootLayers,
} from '../src/design/hierarchy';
import { moveGroup } from '../src/design/geometry';
import {
  deleteDocumentLayers,
  duplicateDocumentLayers,
  groupLayers,
  groupingReason,
  reorderDocument,
  ungroupLayers,
} from '../src/editor/groups';
import { createHistory } from '../src/editor/history';
import { defaultCircleMask } from '../src/effects/types';
import { snapTargets } from '../src/design/frames';
import type { DesignDocument, GroupLayer, ImageDecoration } from '../src/design/types';

const frame = { left: 0, top: 0, width: 1000, height: 800 };
const document = (): DesignDocument => ({
  ...emptyDesign('youtube', 'retro'),
  decorations: Array.from({ length: 3 }, (_, i): ImageDecoration => ({
    kind: 'image',
    id: `image-${i}`,
    name: `world-${i}.png`,
    assetId: `asset-${String(i).repeat(64)}`,
    placement: { anchor: { kind: 'viewport' }, x: 0.3 + i * 0.2, y: 0.4, widthPx: 100, heightPx: 80, rotationDeg: 0 },
    opacity: 1,
    visible: true,
    locked: false,
    zIndex: i,
  })),
});
const ids = ['image-0', 'image-1', 'image-2'];
const group = (): GroupLayer => ({
  kind: 'group',
  id: 'group-world',
  name: '世界',
  opacity: 1,
  visible: true,
  locked: false,
  zIndex: 0,
  children: ids,
});
const order = (doc: DesignDocument) =>
  frontToBack(rootLayers(doc.decorations, doc.groups ?? []))
    .reverse()
    .flatMap((layer) =>
      layer.kind === 'group'
        ? frontToBack(childrenOf(layer, doc.decorations))
            .reverse()
            .map((item) => item.id)
        : [layer.id],
    );

test('v1–v5 migrate without inventing groups; v6 references existing assets and preserves individual effects', () => {
  const input = document();
  input.decorations[0]!.effects = [defaultCircleMask()];
  expect(
    parseDesign({ schemaVersion: 1, id: 'legacy', siteId: 'youtube', baseThemeId: 'retro', rules: [] }).groups,
  ).toBeUndefined();
  for (const version of [2, 3, 4, 5]) {
    const legacy = JSON.parse(JSON.stringify({ ...input, schemaVersion: version }));
    if (version < 5) delete legacy.decorations[0].effects;
    if (version < 3) legacy.decorations.forEach((layer: Partial<ImageDecoration>) => delete layer.locked);
    const before = JSON.stringify(legacy),
      parsed = parseDesign(legacy);
    expect(parsed.schemaVersion).toBe(11);
    expect(parsed.groups).toBeUndefined();
    expect(JSON.stringify(legacy)).toBe(before);
    expect(parsed.decorations.map((item) => item.assetId)).toEqual(input.decorations.map((item) => item.assetId));
  }
  const grouped = structuredClone(groupLayers(input, ids, 'group-world'));
  grouped.groups![0]!.effects = [defaultCircleMask()];
  expect(parseDesign(JSON.parse(JSON.stringify(grouped)))).toEqual(grouped);
  expect(grouped.decorations).toEqual(input.decorations);
  expect(grouped.groups![0]).not.toHaveProperty('assetId');
});

test('grouping a contiguous block and ungrouping preserve placement and composite painting order', () => {
  const before = document();
  before.decorations.push({ ...before.decorations[0]!, id: 'image-top', zIndex: 8 });
  const grouped = structuredClone(groupLayers(before, ids, 'group-world'));
  expect(order(grouped)).toEqual(order(before));
  expect(grouped.decorations.map((item) => item.placement)).toEqual(before.decorations.map((item) => item.placement));
  const ungrouped = ungroupLayers(grouped, 'group-world');
  expect(order(ungrouped)).toEqual(order(before));
  expect(ungrouped.groups).toBeUndefined();
  expect(ungrouped.decorations.map((item) => item.placement)).toEqual(before.decorations.map((item) => item.placement));
  expect(before.groups).toBeUndefined();
});

test('unsafe hierarchy input rejects cycles, missing references, multi-parent membership and executable fields', () => {
  for (const groups of [
    [{ ...group(), children: ['missing'] }],
    [{ ...group(), children: ['group-world'] }],
    [{ ...group(), children: [] }],
    [{ ...group(), children: ['image-0', 'image-0'] }],
    [group(), { ...group(), id: 'group-other' }],
    [{ ...group(), id: 'image-0' }],
    [{ ...group(), script: 'alert(1)' }],
    [{ ...group(), placement: {} }],
    [{ ...group(), opacity: Infinity }],
    [{ ...group(), effects: [{ ...defaultCircleMask(), url: 'https://bad.example' }] }],
  ])
    expect(() => parseDesign({ ...document(), groups })).toThrow();
  expect(() => parseDesign({ ...document(), schemaVersion: 5, groups: [group()] })).toThrow();
  const mixed = document();
  mixed.decorations[1]!.placement.anchor = { kind: 'surface', target: 'video-player' };
  expect(() => parseDesign({ ...mixed, groups: [group()] })).toThrow(/配置基準/);
});

test('grouping rejects mixed anchors, protected media, nesting and interleaved painting order', () => {
  const input = document();
  expect(groupingReason(input, ids)).toBe('');
  expect(groupingReason(input, ['image-0', 'image-2'])).toMatch(/連続/);
  input.decorations[1]!.locked = true;
  expect(groupingReason(input, ids)).toMatch(/ロック/);
  input.decorations[1]!.locked = false;
  input.decorations[1]!.placement.anchor = { kind: 'surface', target: 'video-player' };
  expect(groupingReason(input, ids)).toMatch(/画面基準/);
  const grouped = structuredClone(groupLayers(document(), ['image-0', 'image-1'], 'group-world'));
  expect(groupingReason(grouped, ['group-world', 'image-2'])).toMatch(/ネスト/);
  expect(groupingReason(grouped, ['image-0', 'image-1'])).toMatch(/最上位/);
});

test('group motion includes hidden children, clamps one shared delta and refuses protected descendants', () => {
  const grouped = structuredClone(groupLayers(document(), ids, 'group-world'));
  grouped.decorations[1]!.visible = false;
  const media = movableMedia(['group-world', 'image-0'], grouped.decorations, grouped.groups!);
  expect(media.map((layer) => layer.id)).toEqual(ids);
  expect(normalizeSelection(['image-0', 'group-world'], grouped.decorations, grouped.groups!)).toEqual(['group-world']);
  const changes = moveGroup(
    media.map((layer) => ({ id: layer.id, placement: layer.placement, frame })),
    { x: 900, y: 20 },
  );
  expect(changes.map((change, i) => Math.round((change.placement.x - media[i]!.placement.x) * frame.width))).toEqual([
    300, 300, 300,
  ]);
  grouped.decorations[1]!.locked = true;
  expect(movableMedia(['group-world'], grouped.decorations, grouped.groups!)).toEqual([]);
  grouped.groups![0]!.locked = true;
  expect(movableMedia(['image-0'], grouped.decorations, grouped.groups!)).toEqual([]);
  grouped.groups![0]!.visible = false;
  const page = { defaultView: { innerWidth: 1000, innerHeight: 800 } } as unknown as Document;
  expect(snapTargets(page, [], grouped.decorations, [], grouped.groups!)).toHaveLength(1);
});

test('derived group geometry follows child edits, rotation and anchor resize without a saved pivot', () => {
  const grouped = structuredClone(groupLayers(document(), ids, 'group-world')),
    before = JSON.stringify(grouped);
  expect(groupView(grouped.groups![0]!, grouped.decorations, () => frame).placement).toEqual({
    anchor: { kind: 'viewport' },
    x: 0.5,
    y: 0.4,
    widthPx: 500,
    heightPx: 80,
    rotationDeg: 0,
  });
  const resized = groupView(grouped.groups![0]!, grouped.decorations, () => ({ ...frame, width: 1200 }));
  expect(resized.placement.widthPx).toBe(580);
  expect(resized.placement.x).toBe(0.5);
  expect(JSON.stringify(grouped)).toBe(before);
  grouped.decorations[2]!.placement.rotationDeg = 90;
  expect(groupView(grouped.groups![0]!, grouped.decorations, () => frame).placement.heightPx).toBe(100);
});

test('ungroup removes only group effects, keeps child effects/visibility, and refuses lossy opacity flattening', () => {
  const grouped = structuredClone(groupLayers(document(), ids, 'group-world'));
  grouped.groups![0]!.effects = [defaultCircleMask()];
  grouped.decorations[0]!.effects = [{ ...defaultCircleMask(), intensity: 0.5 }];
  grouped.groups![0]!.visible = false;
  const original = JSON.stringify(grouped),
    ungrouped = ungroupLayers(grouped, 'group-world');
  expect(ungrouped.decorations.every((item) => !item.visible)).toBe(true);
  expect(ungrouped.decorations[0]!.effects![0]!.intensity).toBe(0.5);
  expect(ungrouped.decorations.map((item) => item.placement)).toEqual(
    grouped.decorations.map((item) => item.placement),
  );
  expect(JSON.stringify(grouped)).toBe(original);
  grouped.groups![0]!.opacity = 0.5;
  expect(() => ungroupLayers(grouped, 'group-world')).toThrow(/100%/);
});

test('group and child ordering stay scoped; protected deletes and empty-container cleanup are atomic', () => {
  const grouped = structuredClone(groupLayers(document(), ['image-0', 'image-1'], 'group-world'));
  const reordered = reorderDocument(grouped, 'group-world', 'image-2', false);
  expect(order(reordered)).toEqual(['image-2', 'image-0', 'image-1']);
  const childOrder = reorderDocument(grouped, 'image-0', 'image-1', false);
  expect(order(childOrder)).toEqual(['image-1', 'image-0', 'image-2']);
  expect(() => reorderDocument(grouped, 'image-0', 'image-2', false)).toThrow(/同じ階層/);
  grouped.decorations[0]!.locked = true;
  expect(deleteDocumentLayers(grouped, ['group-world']).decorations).toHaveLength(3);
  grouped.decorations[0]!.locked = false;
  const oneChild = deleteDocumentLayers(grouped, ['image-0']);
  expect(oneChild.groups![0]!.children).toEqual(['image-1']);
  expect(deleteDocumentLayers(oneChild, ['image-1']).groups).toBeUndefined();
  expect(deleteDocumentLayers(grouped, ['group-world']).decorations.map((item) => item.id)).toEqual(['image-2']);
});

test('group copies share immutable asset IDs and history retains deleted group assets', () => {
  const input = structuredClone(groupLayers(document(), ids, 'group-world'));
  input.groups![0]!.effects = [defaultCircleMask()];
  let sequence = 0;
  const copy = duplicateDocumentLayers(
    input,
    ['group-world'],
    () => `copy-${sequence++}`,
    () => frame,
  );
  expect(copy.doc.groups).toHaveLength(2);
  expect(copy.doc.decorations).toHaveLength(6);
  expect(copy.doc.decorations.slice(3).map((item) => item.assetId)).toEqual(
    input.decorations.map((item) => item.assetId),
  );
  expect(new Set(copy.doc.groups!.flatMap((group) => group.children)).size).toBe(6);
  expect(() => {
    copy.doc.groups![1]!.effects![0]!.radiusPx = 30;
  }).toThrow(TypeError);
  expect(input.groups![0]!.effects![0]!.radiusPx).toBe(160);
  const childCopy = duplicateDocumentLayers(
    input,
    ['image-0'],
    () => `child-${sequence++}`,
    () => frame,
  );
  expect(childCopy.doc.groups![0]!.children).toContain(childCopy.ids[0]);
  expect(childCopy.doc.decorations).toHaveLength(4);
  expect(childCopy.doc.decorations[3]!.assetId).toBe(input.decorations[0]!.assetId);
  const history = createHistory(parseDesign, sameDesign),
    deleted = deleteDocumentLayers(input, ['group-world']);
  history.record(input, deleted);
  expect(deleted.decorations).toHaveLength(0);
  expect(history.values().flatMap((doc) => doc.decorations.map((item) => item.assetId))).toEqual(
    input.decorations.map((item) => item.assetId),
  );
  expect(history.undo(deleted)).toEqual(input);
  expect(history.redo(input)).toEqual(deleted);
});
