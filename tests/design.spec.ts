import { test, expect } from '@playwright/test';
import { compileDesign } from '../src/design/renderer';
import { emptyDesign, parseDesign } from '../src/design/schema';
import type { DesignDocument } from '../src/design/types';
import { designKey, readDesign, saveDesign, watchDesign } from '../src/storage/designs';

const targets = [{ id: 'video-card', surface: 'video-card', label: '動画カード' }];
function sample(): DesignDocument {
  return {
    ...emptyDesign('youtube', 'retro'),
    rules: [
      {
        kind: 'surface-style',
        target: 'video-card',
        style: {
          backgroundColor: '#ABCDEF',
          border: { color: '#443366', widthPx: 4 },
          borderRadiusPx: 12,
        },
      },
    ],
  };
}

test('versioned data is sparse, canonical, independent of retro, and copied without mutation', () => {
  const input = sample();
  const parsed = parseDesign(input);
  expect(parsed.rules[0]?.style.backgroundColor).toBe('#abcdef');
  expect(input.rules[0]?.style.backgroundColor).toBe('#ABCDEF');
  expect(parseDesign({ ...input, baseThemeId: null }).baseThemeId).toBeNull();
  expect(parseDesign(emptyDesign('youtube', 'another-theme')).baseThemeId).toBe('another-theme');
  expect(parseDesign(emptyDesign('youtube', null)).rules).toEqual([]);
});

test('unsupported versions, executable fields, arbitrary CSS and invalid dimensions are rejected', () => {
  const input = sample();
  for (const value of [
    { ...input, schemaVersion: 13 },
    { ...input, script: 'alert(1)' },
    { ...input, rules: [{ kind: 'javascript', target: 'video-card', style: {} }] },
    { ...input, rules: [{ kind: 'surface-style', target: 'video-card', selector: '*', style: {} }] },
    {
      ...input,
      rules: [{ kind: 'surface-style', target: 'video-card', style: { backgroundColor: 'url(https://example.com)' } }],
    },
    { ...input, rules: [{ kind: 'surface-style', target: 'video-card', style: { borderRadiusPx: 49 } }] },
    { ...input, rules: [{ kind: 'surface-style', target: 'video-card', style: { borderRadiusPx: -1 } }] },
    { ...input, rules: [{ kind: 'surface-style', target: 'video-card', style: { borderRadiusPx: 1.5 } }] },
    {
      ...input,
      rules: [
        { kind: 'surface-style', target: 'video-card', style: { border: { color: '#000000', widthPx: Infinity } } },
      ],
    },
    { ...input, rules: [...input.rules, ...input.rules] },
  ])
    expect(() => parseDesign(value)).toThrow();
});

test('renderer uses registered semantic targets, replaces gradients and hover bevels, and never changes geometry', () => {
  const design = { ...sample(), baseThemeId: null };
  const css = compileDesign(design, targets);
  expect(css).toContain('[data-ww-surface~="video-card"]');
  expect(css).toContain(':hover');
  expect(css).toContain('background:#abcdef !important');
  expect(css).toContain('box-shadow:inset 0 0 0 4px #443366');
  expect(css).toContain('border-radius:12px');
  expect(css).not.toMatch(/retro|padding|overflow|transform|position|filter/);
  design.rules[0]!.style.border = { color: '#000000', widthPx: 0 };
  expect(compileDesign(design, targets)).toContain('box-shadow:none');
  expect(() => compileDesign(design, [])).toThrow();
  expect(() => compileDesign(design, [{ ...targets[0]!, surface: 'bad"] *' }])).toThrow();
});

const originalChrome = globalThis.chrome;
type Change = Record<string, chrome.storage.StorageChange>;
function fakeStorage(initial: Record<string, unknown> = {}) {
  const stored = { ...initial };
  const listeners = new Set<(changes: Change, area: string) => void>();
  const emit = (changes: Change, area = 'local') => listeners.forEach((listener) => listener(changes, area));
  const local = {
    get: async (key: string): Promise<Record<string, unknown>> => ({ [key]: stored[key] }),
    set: async (values: Record<string, unknown>) => {
      const changes = Object.fromEntries(
        Object.entries(values).map(([key, value]) => [key, { oldValue: stored[key], newValue: value }]),
      );
      Object.assign(stored, values);
      emit(changes);
    },
  };
  globalThis.chrome = {
    storage: {
      local,
      onChanged: {
        addListener: (listener: (changes: Change, area: string) => void) => listeners.add(listener),
        removeListener: (listener: (changes: Change, area: string) => void) => listeners.delete(listener),
      },
    },
  } as unknown as typeof chrome;
  return { stored, emit, local, listeners };
}
test.afterEach(() => {
  if (originalChrome) globalThis.chrome = originalChrome;
  else Reflect.deleteProperty(globalThis, 'chrome');
});

test('design storage leaves legacy settings untouched and notifies multiple subscribers', async () => {
  const storage = fakeStorage({ 'webWorldThemes.enabled': true, 'webWorldThemes.strength': 37 });
  const a: Array<DesignDocument | undefined> = [];
  const b: Array<DesignDocument | undefined> = [];
  const errors: unknown[] = [];
  const stopA = watchDesign(
    'youtube',
    (value) => a.push(value),
    (value) => errors.push(value),
  );
  const stopB = watchDesign(
    'youtube',
    (value) => b.push(value),
    (value) => errors.push(value),
  );
  await saveDesign(sample());
  await Promise.resolve();
  expect(a.at(-1)).toEqual(parseDesign(sample()));
  expect(b.at(-1)).toEqual(parseDesign(sample()));
  expect(await readDesign('youtube')).toEqual(parseDesign(sample()));
  expect(storage.stored['webWorldThemes.strength']).toBe(37);
  expect(storage.stored['webWorldThemes.enabled']).toBe(true);
  expect(errors).toEqual([]);
  stopA();
  stopB();
  expect(storage.listeners.size).toBe(0);
});

test('a storage event wins over a stale initial read, and deletion resets the design', async () => {
  const storage = fakeStorage();
  let finish!: (value: Record<string, unknown>) => void;
  storage.local.get = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const values: Array<DesignDocument | undefined> = [];
  const stop = watchDesign(
    'youtube',
    (value) => values.push(value),
    () => {
      throw new Error('Unexpected error');
    },
  );
  storage.emit({ [designKey('youtube')]: { newValue: sample() } });
  finish({});
  await Promise.resolve();
  await Promise.resolve();
  expect(values).toEqual([parseDesign(sample())]);
  storage.emit({ [designKey('youtube')]: { newValue: undefined } }, 'sync');
  expect(values).toHaveLength(1);
  storage.emit({ [designKey('youtube')]: { newValue: undefined } });
  expect(values.at(-1)).toBeUndefined();
  stop();
});

test('unknown versions remain on disk and write failures propagate without changing saved data', async () => {
  const key = designKey('youtube');
  const unknown = { ...sample(), schemaVersion: 129 };
  const storage = fakeStorage({ [key]: unknown });
  await expect(readDesign('youtube')).rejects.toThrow('バージョン');
  expect(storage.stored[key]).toBe(unknown);
  storage.local.set = async () => {
    throw new Error('quota');
  };
  await expect(saveDesign(sample())).rejects.toThrow('quota');
  expect(storage.stored[key]).toBe(unknown);
  expect(() => designKey('../settings')).toThrow();
});
