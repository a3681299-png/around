import { test, expect } from '@playwright/test';
import { defaultScrollOpacityRule, type SignalRule } from '../src/signals/keyframes';
import { sameSignalRule } from '../src/signals/equality';

test('SignalRule equality ignores key order at every object level without mutating either rule', () => {
  const rule = defaultScrollOpacityRule('image-a');
  const reorder = (value: unknown): any =>
    Array.isArray(value)
      ? value.map(reorder)
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.entries(value)
              .reverse()
              .map(([key, item]) => [key, reorder(item)]),
          )
        : value;
  const reordered = reorder(rule) as SignalRule,
    before = [JSON.stringify(rule), JSON.stringify(reordered)];
  expect(before[0]).not.toBe(before[1]);
  expect(sameSignalRule(rule, reordered)).toBe(true);
  expect(sameSignalRule(reordered, rule)).toBe(true);
  expect(sameSignalRule(rule, rule)).toBe(true);
  expect([JSON.stringify(rule), JSON.stringify(reordered)]).toEqual(before);
  expect(sameSignalRule(undefined, undefined)).toBe(true);
  expect(sameSignalRule(rule, undefined)).toBe(false);
  expect(sameSignalRule(undefined, rule)).toBe(false);
});

test('SignalRule equality detects every serialized field and preserves keyframe sequence', () => {
  const rule = defaultScrollOpacityRule('image-a');
  const changes: ((value: any) => void)[] = [
    (r) => {
      r.id = 'other';
    },
    (r) => {
      r.enabled = false;
    },
    (r) => {
      r.source.signal = 'pointer.position';
    },
    (r) => {
      r.source.axis = 'x';
    },
    (r) => {
      r.source.space = 'layer';
    },
    (r) => {
      r.source.inputRange[0] = -1;
    },
    (r) => {
      r.source.inputRange[1] = 2;
    },
    (r) => {
      r.target.layerId = 'image-b';
    },
    (r) => {
      r.target.property = 'rotation';
    },
    (r) => {
      r.evaluation.mode = 'other';
    },
    (r) => {
      r.evaluation.smoothing.kind = 'other';
    },
    (r) => {
      r.blend.mode = 'add';
    },
    (r) => {
      r.blend.priority = 1;
    },
    (r) => {
      r.keyframes[0].id = 'other';
    },
    (r) => {
      r.keyframes[0].input = 0.1;
    },
    (r) => {
      r.keyframes[0].value = 0.1;
    },
    (r) => {
      r.keyframes[0].easing = 'ease-in';
    },
    (r) => {
      r.keyframes.pop();
    },
    (r) => {
      r.keyframes.reverse();
    },
  ];
  for (const change of changes) {
    const changed = structuredClone(rule);
    change(changed);
    expect(sameSignalRule(rule, changed)).toBe(false);
    expect(sameSignalRule(changed, rule)).toBe(false);
  }
});
