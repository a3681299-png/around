import { test, expect } from '@playwright/test';
import { defaultScrollOpacityRule, type SignalRule } from '../src/signals/keyframes';
import { sameSignalRule } from '../src/signals/equality';

// Required mapped keys make even a new optional field a typecheck failure until
// this test supplies it. Array descriptors cover each element's fields.
type EqualityFields<T> = T extends readonly (infer Item)[]
  ? EqualityFields<Item>
  : T extends object
    ? { [Key in keyof T]-?: EqualityFields<NonNullable<T[Key]>> }
    : true;
const fields = {
  id: true,
  enabled: true,
  source: { signal: true, axis: true, space: true, inputRange: true },
  target: { layerId: true, property: true },
  keyframes: { id: true, input: true, value: true, easing: true },
  evaluation: { mode: true, smoothing: { kind: true } },
  blend: { mode: true, priority: true },
} satisfies EqualityFields<SignalRule>;

test('the equality field descriptor covers the type and changing every populated leaf breaks equality', () => {
  const rule = defaultScrollOpacityRule('image-a');
  const visit = (descriptor: any, value: any, path: (string | number)[]) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(descriptor, item, [...path, index]));
    } else if (descriptor === true) {
      expect(['number', 'boolean', 'string']).toContain(typeof value);
      const changed = structuredClone(rule);
      let parent: any = changed;
      for (const key of path.slice(0, -1)) parent = parent[key];
      parent[path.at(-1)!] =
        typeof value === 'number' ? value + 0.125 : typeof value === 'boolean' ? !value : value + '-changed';
      expect(sameSignalRule(rule, changed), path.join('.')).toBe(false);
    } else {
      expect(Object.keys(value).sort()).toEqual(Object.keys(descriptor).sort());
      for (const key of Object.keys(descriptor)) visit(descriptor[key], value[key], [...path, key]);
    }
  };
  visit(fields, rule, []);
});

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
