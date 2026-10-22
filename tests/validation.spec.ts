import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { oneOf } from '../src/validation';
import { parseDesign } from '../src/design/schema';
import { defaultScrollOpacityRule } from '../src/signals/keyframes';
import { parseModelInfo } from '../src/models/types';
import { parseModelStates, type ModelState } from '../src/world/models';
import { installTakeStorage } from '../src/browser/take-repository';
import { TAKE_MESSAGE } from '../src/browser/take-storage';
import { installSidePanelHost } from '../src/browser/side-panel';
import { CLOSE_SIDE_PANEL, OPEN_SIDE_PANEL, OPEN_STUDIO_WINDOW, PREPARE_SIDE_PANEL } from '../src/editor/messages';

const load = (file: string): any => JSON.parse(readFileSync(`tests/fixtures/designs/${file}.json`, 'utf8'));

test('string membership never coerces arrays, objects or primitive types', () => {
  const choices = ['opacity', 'linear', 'vrm', '1.0', 'idle'] as const;
  for (const value of choices) {
    expect(oneOf(value, choices)).toBe(true);
    expect(oneOf([value], choices)).toBe(false);
    expect(
      oneOf(
        {
          toString: () => {
            throw new Error('must not coerce');
          },
        },
        choices,
      ),
    ).toBe(false);
  }
  for (const value of [null, undefined, true, 1, {}, 'unknown']) expect(oneOf(value, choices)).toBe(false);
});

test('saved signal target properties reject arrays even when additive blending would otherwise allow them', () => {
  const design = parseDesign(load('v3')),
    rule = defaultScrollOpacityRule(design.decorations[0]!.id);
  const valid = { ...rule, target: { ...rule.target, property: 'position.x' }, blend: { mode: 'add', priority: 0 } };
  expect(() => parseDesign({ ...design, signalRules: [valid] })).not.toThrow();
  expect(() =>
    parseDesign({ ...design, signalRules: [{ ...valid, target: { ...valid.target, property: ['opacity'] } }] }),
  ).toThrow();
});

test('saved signal key easing rejects a string in an array', () => {
  const design = parseDesign(load('v3')),
    rule = defaultScrollOpacityRule(design.decorations[0]!.id);
  expect(() => parseDesign({ ...design, signalRules: [rule] })).not.toThrow();
  const keyframes = rule.keyframes.map((key) => ({ ...key, easing: ['linear'] }));
  expect(() => parseDesign({ ...design, signalRules: [{ ...rule, keyframes }] })).toThrow();
});

test('model format rejects arrays with no VRM metadata to mask the type error', () => {
  const source = load('history-v10').decorations[0].source;
  expect(parseModelInfo(source).format).toBe('glb');
  for (const format of [['vrm'], ['glb']]) expect(() => parseModelInfo({ ...source, format })).toThrow();
});

test('VRM version rejects arrays at both the metadata and saved design boundaries', () => {
  const design = load('history-v11'),
    layer = design.decorations[0],
    source = layer.source;
  expect(parseModelInfo(source).vrm!.version).toBe('1.0');
  expect(parseModelInfo({ ...source, vrm: { ...source.vrm, version: '0.x' } }).vrm!.version).toBe('0.x');
  const malformed = { ...source, vrm: { ...source.vrm, version: ['1.0'] } };
  expect(() => parseModelInfo(malformed)).toThrow();
  expect(() => parseDesign({ ...design, decorations: [{ ...layer, source: malformed }] })).toThrow();
});

test('recorded model phase rejects arrays while preserving every supported phase', () => {
  const state: ModelState = {
    clip: null,
    timeMs: 0,
    previousClip: null,
    previousTimeMs: 0,
    fadeElapsedMs: 0,
    fadeDurationMs: 0,
    yawDeg: 0,
    lookYaw: 0,
    lookPitch: 0,
    suspended: false,
    phase: 'idle',
  };
  for (const phase of ['manual', 'idle', 'walk', 'run'])
    expect(parseModelStates({ avatar: { ...state, phase } })['avatar']!.phase).toBe(phase);
  expect(() => parseModelStates({ avatar: { ...state, phase: ['idle'] } })).toThrow();
});

type Listener = Parameters<typeof chrome.runtime.onMessage.addListener>[0];
const originalChrome = globalThis.chrome;
test.afterEach(() => {
  if (originalChrome) globalThis.chrome = originalChrome;
  else Reflect.deleteProperty(globalThis, 'chrome');
});

test('take message actions reject arrays before opening storage', async () => {
  let listener: Listener | undefined;
  globalThis.chrome = {
    runtime: {
      id: 'extension',
      getURL: (path: string) => `chrome-extension://extension/${path}`,
      onMessage: {
        addListener: (next: Listener) => {
          listener = next;
        },
      },
    },
  } as unknown as typeof chrome;
  installTakeStorage();
  // Node has no indexedDB: an accidental storage access fails this expected validation error.
  for (const action of ['list', 'get', 'put', 'delete']) {
    const result = await new Promise<unknown>((respond) => {
      expect(
        listener!(
          { type: TAKE_MESSAGE, siteId: 'youtube', id: 'take-a', action: [action] },
          { id: 'extension', url: 'chrome-extension://extension/studio/index.html' },
          respond,
        ),
      ).toBe(true);
    });
    expect(result).toEqual({ ok: false, error: 'テイク操作が不正です。' });
  }
});

test('side panel messages reject array types before opening any Chrome surface', async () => {
  let listener: Listener | undefined,
    calls = 0;
  const called = async () => {
    calls++;
  };
  globalThis.chrome = {
    runtime: {
      id: 'extension',
      getURL: (path: string) => `chrome-extension://extension/${path}`,
      onMessage: {
        addListener: (next: Listener) => {
          listener = next;
        },
      },
    },
    sidePanel: { setOptions: called, open: called },
    windows: { create: called },
  } as unknown as typeof chrome;
  installSidePanelHost();
  const sender = { id: 'extension', url: 'chrome-extension://extension/popup/index.html' };
  for (const type of [PREPARE_SIDE_PANEL, OPEN_SIDE_PANEL, CLOSE_SIDE_PANEL, OPEN_STUDIO_WINDOW]) {
    expect(
      listener!({ type: [type], tabId: 12 }, sender, () => {
        calls++;
      }),
    ).toBe(false);
  }
  expect(calls).toBe(0);
  expect(
    await new Promise<unknown>((respond) => {
      expect(listener!({ type: PREPARE_SIDE_PANEL, tabId: 12 }, sender, respond)).toBe(true);
    }),
  ).toEqual({ ok: true });
  expect(calls).toBe(1);
});
