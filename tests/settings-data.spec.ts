import { test, expect } from '@playwright/test';
import { bindSettingsForm } from '../src/settings/form';
import { createPageController } from '../src/host/page-controller';
import { createMemoryTakeStorage } from '../src/timeline/memory-takes';
import type { SiteAdapter } from '../src/sites/types';
import {
  DEFAULT_SETTINGS,
  LEGACY_SETTINGS_KEYS,
  SETTINGS_KEYS,
  mergeSettings,
  type UserSettings,
} from '../src/storage/settings';
import { readSettings, updateSettings, watchSettings } from '../src/browser/settings-store';

/*
 * The settings after the retro theme's removal: 作品を表示する (ON by default) and 制作モード. The
 * strength slider is gone; someone who had turned the theme off with it at 0% is moved to OFF once,
 * on the first read (docs/theme-removal.md).
 */
const show = SETTINGS_KEYS.enabled;
const legacyEnabled = LEGACY_SETTINGS_KEYS.enabled;
const legacyStrength = LEGACY_SETTINGS_KEYS.strength;
const originalChrome = globalThis.chrome;

type StorageData = Record<string, unknown>;
type StorageListener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => void;

function fakeStorage(initial: StorageData = {}) {
  const stored = { ...initial };
  const writes: StorageData[] = [];
  const listeners = new Set<StorageListener>();
  const emit = (changes: Record<string, chrome.storage.StorageChange>, area = 'local') => {
    listeners.forEach((listener) => listener(changes, area));
  };
  const local = {
    get: async (keys: string[]): Promise<StorageData> =>
      Object.fromEntries(keys.filter((key) => Object.hasOwn(stored, key)).map((key) => [key, stored[key]])),
    set: async (values: StorageData): Promise<void> => {
      writes.push({ ...values });
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
        addListener: (listener: StorageListener) => listeners.add(listener),
        removeListener: (listener: StorageListener) => listeners.delete(listener),
      },
    },
  } as unknown as typeof chrome;
  return { stored, writes, local, emit, listeners };
}

function fakeSite(overrides: Partial<SiteAdapter> = {}): SiteAdapter {
  return {
    id: 'fixture',
    connect: () => () => {},
    mountSettings: () => () => {},
    ...overrides,
  };
}

test.afterEach(() => {
  if (originalChrome) globalThis.chrome = originalChrome;
  else Reflect.deleteProperty(globalThis, 'chrome');
});

test('a new creator starts with 作品を表示する ON and 制作モード OFF, and nothing is written', async () => {
  const storage = fakeStorage();
  expect(await readSettings()).toEqual({ creatorMode: false, enabled: true });
  expect(DEFAULT_SETTINGS).toEqual({ creatorMode: false, enabled: true });
  expect(storage.writes).toEqual([]);
});

test('the retro switch carries over while 作品を表示する is unsaved, without any write', async () => {
  for (const [enabled, strength] of [
    [true, 37],
    [true, 100],
    [false, 37],
    [true, undefined],
  ] as const) {
    const storage = fakeStorage({
      [legacyEnabled]: enabled,
      ...(strength === undefined ? {} : { [legacyStrength]: strength }),
    });
    expect((await readSettings()).enabled, `${enabled}/${strength}`).toBe(enabled);
    expect(storage.writes).toEqual([]);
  }
});

test('the strength at 0% saves OFF once; later reads change nothing and give the same result', async () => {
  for (const strength of [0, -3, 0.4]) {
    const storage = fakeStorage({ [legacyEnabled]: true, [legacyStrength]: strength });
    expect((await readSettings()).enabled, String(strength)).toBe(false);
    expect(storage.writes).toEqual([{ [show]: false }]);
    for (let read = 0; read < 3; read++) expect((await readSettings()).enabled).toBe(false);
    expect(storage.writes).toHaveLength(1);
    // The legacy keys stay as they were (decision 4: they are kept).
    expect(storage.stored[legacyStrength]).toBe(strength);
    expect(storage.stored[legacyEnabled]).toBe(true);
  }
  // Anything that was not a number at 0% never moved anyone to OFF.
  for (const strength of ['0', null, 0.6, NaN]) {
    const storage = fakeStorage({ [legacyEnabled]: true, [legacyStrength]: strength });
    expect((await readSettings()).enabled, String(strength)).toBe(true);
    expect(storage.writes).toEqual([]);
  }
});

test('a saved 作品を表示する is never changed by the legacy keys', async () => {
  for (const saved of [true, false]) {
    const storage = fakeStorage({ [show]: saved, [legacyEnabled]: !saved, [legacyStrength]: 0 });
    expect((await readSettings()).enabled).toBe(saved);
    expect(storage.writes).toEqual([]);
  }
});

test('writes use their own keys only', async () => {
  const storage = fakeStorage({ [legacyEnabled]: true, [legacyStrength]: 37 });
  await Promise.all([updateSettings({ enabled: false }), updateSettings({ creatorMode: true })]);
  expect(storage.writes).toEqual([{ [show]: false }, { [SETTINGS_KEYS.creatorMode]: true }]);
  expect(await readSettings()).toEqual({ creatorMode: true, enabled: false });
  await updateSettings({});
  expect(storage.writes).toHaveLength(2);
  expect(mergeSettings(DEFAULT_SETTINGS, { creatorMode: true })).toEqual({ creatorMode: true, enabled: true });
  expect(DEFAULT_SETTINGS.creatorMode).toBe(false);
});

test('the initial read merges intervening changes and ignores other areas and foreign keys', async () => {
  const storage = fakeStorage();
  let finishRead!: (value: StorageData) => void;
  storage.local.get = () =>
    new Promise((resolve) => {
      finishRead = resolve;
    });
  const snapshots: UserSettings[] = [];
  const errors: unknown[] = [];
  const stop = watchSettings(
    (settings) => snapshots.push(settings),
    (error) => errors.push(error),
  );
  storage.emit({ [SETTINGS_KEYS.creatorMode]: { newValue: true } });
  storage.emit({ [show]: { newValue: false } }, 'sync');
  storage.emit({ 'webWorldThemes.features.window-chrome': { newValue: true } });
  finishRead({ [show]: true, [SETTINGS_KEYS.creatorMode]: false });
  await expect.poll(() => snapshots.length).toBe(1);
  expect(snapshots[0]).toEqual({ creatorMode: true, enabled: true });
  storage.emit({ [show]: { newValue: false } });
  expect(snapshots[1]).toEqual({ creatorMode: true, enabled: false });
  // The consumer cannot accidentally mutate the watcher's snapshot.
  Object.assign(snapshots[1]!, { creatorMode: false });
  storage.emit({ [show]: { newValue: true } });
  expect(snapshots[2]).toEqual({ creatorMode: true, enabled: true });
  stop();
  stop();
  expect(storage.listeners.size).toBe(0);
  storage.emit({ [show]: { newValue: false } });
  expect(snapshots).toHaveLength(3);
  expect(errors).toEqual([]);
});

test('a legacy key that changes while 作品を表示する is unsaved is followed; once saved, it is not', async () => {
  const storage = fakeStorage({ [legacyEnabled]: true, [legacyStrength]: 60 });
  const snapshots: UserSettings[] = [];
  const stop = watchSettings(
    (settings) => snapshots.push(settings),
    () => {},
  );
  await expect.poll(() => snapshots.length).toBe(1);
  expect(snapshots[0]!.enabled).toBe(true);
  await storage.local.set({ [legacyStrength]: 0 });
  await expect.poll(() => snapshots.at(-1)!.enabled).toBe(false);
  expect(storage.stored[show]).toBe(false);
  const settled = snapshots.length;
  await storage.local.set({ [legacyStrength]: 50, [legacyEnabled]: true });
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(snapshots.slice(settled).every((settings) => settings.enabled === false)).toBe(true);
  expect((await readSettings()).enabled).toBe(false);
  stop();
});

test('unsubscribing before the initial read resolves prevents late application', async () => {
  const storage = fakeStorage();
  let finishRead!: (value: StorageData) => void;
  storage.local.get = () =>
    new Promise((resolve) => {
      finishRead = resolve;
    });
  const snapshots: UserSettings[] = [];
  const stop = watchSettings(
    (settings) => snapshots.push(settings),
    () => {},
  );
  stop();
  finishRead({ [show]: true });
  await Promise.resolve();
  await Promise.resolve();
  expect(snapshots).toEqual([]);
  expect(storage.listeners.size).toBe(0);
});

/** Minimal DOM model keeps controller ownership tests independent of a browser binary. */
function fakeDocument() {
  const attributes = new Map<string, string>();
  const properties = new Map<string, string>();
  const styles: Array<{ isConnected: boolean; remove(): void }> = [];
  const root = {
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    removeAttribute: (name: string) => attributes.delete(name),
    hasAttribute: (name: string) => attributes.has(name),
    style: {
      setProperty: (name: string, value: string) => properties.set(name, value),
      removeProperty: (name: string) => properties.delete(name),
    },
  };
  const doc = {
    documentElement: root,
    head: {
      append: (style: { isConnected: boolean }) => {
        style.isConnected = true;
      },
    },
    createElement: () => {
      const style = {
        isConnected: false,
        remove() {
          this.isConnected = false;
        },
      };
      styles.push(style);
      return style;
    },
  } as unknown as Document;
  return { doc, attributes, properties, styles };
}

test('OFF, 緊急OFF and repeated destroy disconnect the page once and leave nothing on the root', () => {
  const { doc, attributes, properties, styles } = fakeDocument();
  let connections = 0;
  let disconnections = 0;
  let onPageChange: (() => void) | undefined;
  const site = fakeSite({
    connect: (callback) => {
      connections++;
      onPageChange = callback;
      return () => {
        disconnections++;
        onPageChange = undefined;
      };
    },
  });
  const controller = createPageController(doc, site, {
    assets: { load: () => Promise.reject(new Error('No assets in this test')), clear() {} },
    takes: createMemoryTakeStorage(),
  });
  const shown = { ...DEFAULT_SETTINGS, enabled: true };
  controller.update(shown);
  controller.update({ ...shown, creatorMode: true });
  // Another setting changing while shown is not a second connection.
  expect(connections).toBe(1);
  expect(() => onPageChange?.()).not.toThrow();
  controller.suspend(true);
  expect(disconnections).toBe(1);
  expect(onPageChange).toBeUndefined();
  controller.update(shown);
  expect(connections).toBe(1);
  controller.suspend(false);
  expect(connections).toBe(2);
  controller.update({ ...shown, enabled: false });
  expect(disconnections).toBe(2);
  controller.destroy();
  controller.destroy();
  expect(disconnections).toBe(2);
  expect(attributes.size).toBe(0);
  expect(properties.size).toBe(0);
  expect(styles.every((style) => !style.isConnected)).toBe(true);
});

function fakeForm() {
  const control = () => {
    const listeners = new Map<string, Set<(event: Event) => void>>();
    const element = {
      checked: false,
      disabled: true,
      value: '',
      textContent: '',
      dataset: {} as Record<string, string>,
      addEventListener: (type: string, listener: (event: Event) => void) => {
        const entries = listeners.get(type) ?? new Set();
        entries.add(listener);
        listeners.set(type, entries);
      },
      removeEventListener: (type: string, listener: (event: Event) => void) => listeners.get(type)?.delete(listener),
      dispatch: (type: string) =>
        listeners.get(type)?.forEach((listener) => listener({ currentTarget: element } as unknown as Event)),
      listenerCount: () => [...listeners.values()].reduce((count, entries) => count + entries.size, 0),
    };
    return element;
  };
  const enabled = control();
  const creatorMode = control();
  const state = control();
  const status = control();
  const elements = new Map([
    ['#creator-mode', creatorMode],
    ['#show-artwork', enabled],
    ['#show-artwork-state', state],
    ['#save-status', status],
  ]);
  const root = {
    querySelector: (selector: string) => elements.get(selector),
    querySelectorAll: () => [],
  } as unknown as ParentNode;
  return { root, enabled, creatorMode, state, status };
}

test('both switches are shared between forms and unbind their listeners', async () => {
  const storage = fakeStorage();
  const a = fakeForm(),
    b = fakeForm(),
    stopA = bindSettingsForm(a.root),
    stopB = bindSettingsForm(b.root);
  await expect.poll(() => a.creatorMode.disabled).toBe(false);
  expect(a.creatorMode.checked).toBe(false);
  expect(a.enabled.checked).toBe(true);
  expect(a.state.value).toBe('ON');
  a.creatorMode.checked = true;
  a.creatorMode.dispatch('change');
  a.enabled.checked = false;
  a.enabled.dispatch('change');
  await expect.poll(() => [b.creatorMode.checked, b.enabled.checked]).toEqual([true, false]);
  expect(b.state.value).toBe('OFF');
  expect(storage.writes).toEqual([{ [SETTINGS_KEYS.creatorMode]: true }, { [show]: false }]);
  stopA();
  stopB();
  expect(a.creatorMode.listenerCount() + a.enabled.listenerCount()).toBe(0);
  expect(storage.listeners.size).toBe(0);
});

test('the form reconciles independent changes when older saves finish last', async () => {
  const storage = fakeStorage();
  const form = fakeForm();
  const unbind = bindSettingsForm(form.root);
  await expect.poll(() => form.enabled.disabled).toBe(false);
  const finish: Array<() => void> = [];
  storage.local.set = (values) =>
    new Promise((resolve) => {
      Object.assign(storage.stored, values);
      finish.push(resolve);
    });
  form.enabled.checked = false;
  form.enabled.dispatch('change');
  form.creatorMode.checked = true;
  form.creatorMode.dispatch('change');
  finish[1]!();
  await Promise.resolve();
  expect(form.status.textContent).toBe('保存しています…');
  finish[0]!();
  await expect.poll(() => form.status.textContent).toBe('保存しました。');
  expect(form.enabled.checked).toBe(false);
  expect(form.creatorMode.checked).toBe(true);
  unbind();
});

test('an earlier save failure is visible even when the later save succeeds, and restores the saved value', async () => {
  const storage = fakeStorage();
  const form = fakeForm();
  const unbind = bindSettingsForm(form.root);
  await expect.poll(() => form.enabled.disabled).toBe(false);
  let failShow!: () => void;
  let finishCreator!: () => void;
  storage.local.set = (values) =>
    new Promise((resolve, reject) => {
      if (show in values) failShow = () => reject(new Error('Injected failure'));
      else {
        Object.assign(storage.stored, values);
        finishCreator = resolve;
      }
    });
  form.enabled.checked = false;
  form.enabled.dispatch('change');
  form.creatorMode.checked = true;
  form.creatorMode.dispatch('change');
  finishCreator();
  failShow();
  await expect.poll(() => form.status.textContent).toBe('保存できませんでした。もう一度操作してください。');
  expect(form.enabled.checked).toBe(true);
  expect(form.creatorMode.checked).toBe(true);
  expect(form.status.dataset.error).toBe('true');
  unbind();
});

test('a slow final read cannot rewind a newer cross-editor storage update', async () => {
  const storage = fakeStorage();
  const form = fakeForm();
  const unbind = bindSettingsForm(form.root);
  await expect.poll(() => form.enabled.disabled).toBe(false);
  let finishRead: ((value: StorageData) => void) | undefined;
  storage.local.get = () =>
    new Promise((resolve) => {
      finishRead = resolve;
    });
  form.creatorMode.checked = true;
  form.creatorMode.dispatch('change');
  await expect.poll(() => Boolean(finishRead)).toBe(true);
  storage.stored[show] = false;
  storage.emit({ [show]: { newValue: false } });
  expect(form.enabled.checked).toBe(false);
  finishRead!({ [SETTINGS_KEYS.creatorMode]: true, [show]: true });
  await expect.poll(() => form.status.textContent).toBe('保存しました。');
  expect(form.enabled.checked).toBe(false);
  expect(form.creatorMode.checked).toBe(true);
  unbind();
});
