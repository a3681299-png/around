import { test, expect } from '@playwright/test';
import { FEATURE_REGISTRY, defaultFeaturePreferences, type FeatureDefinition } from '../src/features';
import { createFeatureController } from '../src/features/controller';
import { bindSettingsForm } from '../src/settings/form';
import { createThemeController } from '../src/themes/controller';
import type { SiteAdapter } from '../src/sites/types';
import {
  DEFAULT_SETTINGS,
  FEATURE_SETTINGS_KEYS,
  SETTINGS_KEYS,
  mergeSettings,
  readSettings,
  updateSettings,
  watchSettings,
  type UserSettings,
} from '../src/storage/settings';

const chromeKey = FEATURE_SETTINGS_KEYS['window-chrome']!;
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
    get: async (keys: string[]): Promise<StorageData> => Object.fromEntries(keys.map((key) => [key, stored[key]])),
    set: async (values: StorageData): Promise<void> => {
      writes.push({ ...values });
      const changes = Object.fromEntries(Object.entries(values).map(([key, value]) => [
        key, { oldValue: stored[key], newValue: value },
      ]));
      Object.assign(stored, values);
      emit(changes);
    },
  };
  globalThis.chrome = {
    storage: { local, onChanged: {
      addListener: (listener: StorageListener) => listeners.add(listener),
      removeListener: (listener: StorageListener) => listeners.delete(listener),
    } },
  } as unknown as typeof chrome;
  return { stored, writes, local, emit, listeners };
}

function fakeSite(overrides: Partial<SiteAdapter> = {}): SiteAdapter {
  return {
    id: 'fixture', stylesheet: '',
    connect: () => () => {},
    mountSettings: () => () => {},
    ...overrides,
  };
}

test.afterEach(() => {
  if (originalChrome) globalThis.chrome = originalChrome;
  else Reflect.deleteProperty(globalThis, 'chrome');
});

test('old global keys migrate by default without rewriting any saved preferences', async () => {
  const storage = fakeStorage({ [SETTINGS_KEYS.enabled]: true, [SETTINGS_KEYS.strength]: 37 });
  expect(await readSettings()).toEqual({ enabled: true, strength: 37, features: { 'window-chrome': true } });
  expect(storage.writes).toEqual([]);
  storage.stored[chromeKey] = false;
  expect((await readSettings()).features).toEqual({ 'window-chrome': false });
  storage.stored[chromeKey] = 'invalid';
  expect((await readSettings()).features).toEqual({ 'window-chrome': true });
  delete storage.stored[chromeKey];
  expect((await readSettings()).features).toEqual({ 'window-chrome': true });
});

test('feature writes use their own keys and ignore unknown feature IDs', async () => {
  const storage = fakeStorage({ [SETTINGS_KEYS.enabled]: true, [SETTINGS_KEYS.strength]: 37 });
  await Promise.all([
    updateSettings({ strength: 88 }),
    updateSettings({ features: { 'window-chrome': false, 'unregistered-feature': true } }),
  ]);
  expect(storage.writes).toEqual([
    { [SETTINGS_KEYS.strength]: 88 },
    { [chromeKey]: false },
  ]);
  expect(await readSettings()).toEqual({ enabled: true, strength: 88, features: { 'window-chrome': false } });
  await updateSettings({ features: { 'unknown-only': true } });
  expect(storage.writes).toHaveLength(2);
});

test('settings merge retains unrelated feature values and never mutates defaults', () => {
  const settings = { ...DEFAULT_SETTINGS, features: { 'window-chrome': true, another: true } };
  const merged = mergeSettings(settings, { features: { 'window-chrome': false } });
  expect(merged.features).toEqual({ 'window-chrome': false, another: true });
  expect(settings.features['window-chrome']).toBe(true);
  expect(defaultFeaturePreferences()).toEqual({ 'window-chrome': true });
  expect(defaultFeaturePreferences()).not.toBe(defaultFeaturePreferences());
});

test('initial read merges intervening feature and global changes and ignores foreign keys', async () => {
  const storage = fakeStorage();
  let finishRead!: (value: StorageData) => void;
  storage.local.get = () => new Promise((resolve) => { finishRead = resolve; });
  const snapshots: UserSettings[] = [];
  const errors: unknown[] = [];
  const stop = watchSettings((settings) => snapshots.push(settings), (error) => errors.push(error));
  storage.emit({ [chromeKey]: { newValue: false } });
  storage.emit({ [SETTINGS_KEYS.enabled]: { newValue: true } });
  storage.emit({ [SETTINGS_KEYS.strength]: { newValue: 91 } });
  storage.emit({ 'webWorldThemes.features.not-installed': { newValue: true } });
  storage.emit({ [chromeKey]: { newValue: true } }, 'sync');
  finishRead({ [SETTINGS_KEYS.enabled]: false, [SETTINGS_KEYS.strength]: 12, [chromeKey]: true });
  await expect.poll(() => snapshots.length).toBe(1);
  expect(snapshots[0]).toEqual({ enabled: true, strength: 91, features: { 'window-chrome': false } });
  storage.emit({ [SETTINGS_KEYS.strength]: { newValue: 45 } });
  expect(snapshots[1]).toEqual({ enabled: true, strength: 45, features: { 'window-chrome': false } });
  // The consumer cannot accidentally mutate the watcher's feature snapshot.
  Object.assign(snapshots[1]!.features, { 'window-chrome': true });
  storage.emit({ [SETTINGS_KEYS.strength]: { newValue: 46 } });
  expect(snapshots[2]!.features['window-chrome']).toBe(false);
  storage.emit({ [chromeKey]: { oldValue: false } });
  expect(snapshots[3]!.features['window-chrome']).toBe(true);
  stop();
  stop();
  expect(storage.listeners.size).toBe(0);
  storage.emit({ [chromeKey]: { newValue: false } });
  expect(snapshots).toHaveLength(4);
  expect(errors).toEqual([]);
});

test('unsubscribing before the initial read resolves prevents late application', async () => {
  const storage = fakeStorage();
  let finishRead!: (value: StorageData) => void;
  storage.local.get = () => new Promise((resolve) => { finishRead = resolve; });
  const snapshots: UserSettings[] = [];
  const stop = watchSettings((settings) => snapshots.push(settings), () => {});
  stop();
  finishRead({ [SETTINGS_KEYS.enabled]: true });
  await Promise.resolve();
  await Promise.resolve();
  expect(snapshots).toEqual([]);
  expect(storage.listeners.size).toBe(0);
});

test('registry lifecycle mounts once, independently toggles modules, and cleans up once', () => {
  const counts: Record<string, { mounts: number; refreshes: number; destroys: number }> = {};
  const definitions: FeatureDefinition[] = ['first', 'second'].map((id) => {
    const count = counts[id] = { mounts: 0, refreshes: 0, destroys: 0 };
    return {
      id, label: id, description: id, defaultEnabled: true,
      mount: () => {
        count.mounts++;
        return { refresh: () => { count.refreshes++; }, destroy: () => { count.destroys++; } };
      },
    };
  });
  const controller = createFeatureController({ document: {} as Document, site: fakeSite() }, definitions);
  controller.update({ first: true, second: true, unknown: true });
  controller.update({ first: true, second: true });
  controller.refresh();
  expect(counts).toEqual({
    first: { mounts: 1, refreshes: 1, destroys: 0 },
    second: { mounts: 1, refreshes: 1, destroys: 0 },
  });
  controller.update({ first: false, second: true });
  controller.refresh();
  expect(counts.first).toEqual({ mounts: 1, refreshes: 1, destroys: 1 });
  expect(counts.second).toEqual({ mounts: 1, refreshes: 2, destroys: 0 });
  controller.update({ first: true, second: true });
  controller.destroy();
  controller.destroy();
  controller.refresh();
  expect(counts.first).toEqual({ mounts: 2, refreshes: 1, destroys: 2 });
  expect(counts.second).toEqual({ mounts: 1, refreshes: 2, destroys: 1 });
});

test('the registered feature defaults on and gracefully skips an unsupported adapter', () => {
  const unsupported = createFeatureController({ document: {} as Document, site: fakeSite() });
  expect(() => { unsupported.update(); unsupported.refresh(); unsupported.destroy(); }).not.toThrow();
  let mounts = 0;
  let destroys = 0;
  const site = fakeSite({ features: { 'window-chrome': { mount: () => {
    mounts++;
    return { destroy: () => { destroys++; } };
  } } } });
  const supported = createFeatureController({ document: {} as Document, site });
  supported.update({ 'window-chrome': false });
  expect(mounts).toBe(0);
  supported.update();
  supported.update();
  expect(mounts).toBe(1);
  supported.destroy();
  expect(destroys).toBe(1);
  expect(FEATURE_REGISTRY.map(({ id }) => id)).toEqual(['window-chrome']);
});

/** Minimal DOM model keeps controller ownership tests independent of a browser binary. */
function fakeDocument() {
  const attributes = new Map<string, string>();
  const properties = new Map<string, string>();
  const styles: Array<{ isConnected: boolean; remove(): void }> = [];
  const root = {
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    removeAttribute: (name: string) => attributes.delete(name),
    style: {
      setProperty: (name: string, value: string) => properties.set(name, value),
      removeProperty: (name: string) => properties.delete(name),
    },
  };
  const doc = {
    documentElement: root,
    head: { append: (style: { isConnected: boolean }) => { style.isConnected = true; } },
    createElement: () => {
      const style = { isConnected: false, remove() { this.isConnected = false; } };
      styles.push(style);
      return style;
    },
  } as unknown as Document;
  return { doc, attributes, properties, styles };
}

test('theme OFF, zero, and repeated destroy clean feature and adapter lifetimes', () => {
  const { doc, attributes, properties, styles } = fakeDocument();
  let mounts = 0;
  let destroys = 0;
  let connections = 0;
  let disconnections = 0;
  let refreshes = 0;
  let onPageChange: (() => void) | undefined;
  const site = fakeSite({
    connect: (callback) => {
      connections++;
      onPageChange = callback;
      return () => { disconnections++; onPageChange = undefined; };
    },
    features: { 'window-chrome': { mount: () => {
      mounts++;
      return { refresh: () => { refreshes++; }, destroy: () => { destroys++; } };
    } } },
  });
  const controller = createThemeController(doc, site, { id: 'fixture', name: 'Fixture', stylesheets: [], editorStylesheets: [] });
  const active = { ...DEFAULT_SETTINGS, enabled: true };
  controller.update(active);
  controller.update({ ...active, strength: 90 });
  expect(mounts).toBe(1);
  expect(connections).toBe(1);
  expect(properties.get('--ww-strength')).toBe('0.9');
  styles[0]!.remove();
  onPageChange?.();
  expect(styles[0]!.isConnected).toBe(true);
  expect(refreshes).toBe(3);
  controller.update({ ...active, strength: 0 });
  expect(destroys).toBe(1);
  expect(disconnections).toBe(1);
  expect(attributes.size).toBe(0);
  expect(properties.size).toBe(0);
  expect(styles[0]!.isConnected).toBe(false);
  controller.update({ ...active, features: { 'window-chrome': false } });
  expect(connections).toBe(2);
  expect(mounts).toBe(1);
  controller.update(active);
  expect(mounts).toBe(2);
  controller.update({ ...active, enabled: false });
  controller.destroy();
  expect(destroys).toBe(2);
  expect(disconnections).toBe(2);
  expect(attributes.size).toBe(0);
  expect(properties.size).toBe(0);
  expect(styles.every((style) => !style.isConnected)).toBe(true);
});


function fakeForm() {
  const control = () => {
    const listeners = new Map<string, Set<(event: Event) => void>>();
    const element = {
      checked: false, disabled: true, value: '', textContent: '', dataset: {} as Record<string, string>,
      addEventListener: (type: string, listener: (event: Event) => void) => {
        const entries = listeners.get(type) ?? new Set();
        entries.add(listener);
        listeners.set(type, entries);
      },
      removeEventListener: (type: string, listener: (event: Event) => void) => listeners.get(type)?.delete(listener),
      dispatch: (type: string) => listeners.get(type)?.forEach((listener) => listener({ currentTarget: element } as unknown as Event)),
      listenerCount: () => [...listeners.values()].reduce((count, entries) => count + entries.size, 0),
    };
    return element;
  };
  const enabled = control();
  const strength = control();
  const chrome = control();
  const themeState = control();
  const strengthValue = control();
  const status = control();
  chrome.dataset.featureId = 'window-chrome';
  const elements = new Map([
    ['#theme-enabled', enabled], ['#effect-strength', strength], ['#theme-state', themeState],
    ['#strength-value', strengthValue], ['#save-status', status],
  ]);
  const root = {
    querySelector: (selector: string) => elements.get(selector),
    querySelectorAll: (selector: string) => selector === 'input[data-feature-id]' ? [chrome] : [],
  } as unknown as ParentNode;
  return { root, enabled, strength, chrome, status };
}

test('shared editor reconciles independent changes when older saves finish last', async () => {
  const storage = fakeStorage();
  const form = fakeForm();
  const unbind = bindSettingsForm(form.root);
  await expect.poll(() => form.enabled.disabled).toBe(false);
  expect(form.chrome.checked).toBe(true);
  const finish: Array<() => void> = [];
  storage.local.set = (values) => new Promise((resolve) => {
    Object.assign(storage.stored, values);
    finish.push(resolve);
  });
  form.chrome.checked = false;
  form.chrome.dispatch('change');
  form.strength.value = '33';
  form.strength.dispatch('input');
  // A second editor updates a third key while these two writes are in flight.
  storage.stored[SETTINGS_KEYS.enabled] = true;
  storage.emit({ [SETTINGS_KEYS.enabled]: { newValue: true } });
  finish[1]!();
  await Promise.resolve();
  expect(form.status.textContent).toBe('保存しています…');
  finish[0]!();
  await expect.poll(() => form.status.textContent).toBe('保存しました。');
  expect(form.enabled.checked).toBe(true);
  expect(form.strength.value).toBe('33');
  expect(form.chrome.checked).toBe(false);
  unbind();
  expect(storage.listeners.size).toBe(0);
  expect(form.chrome.listenerCount()).toBe(0);
  expect(form.enabled.listenerCount()).toBe(0);
  expect(form.strength.listenerCount()).toBe(0);
});

test('an earlier feature save failure is visible even when the later slider save succeeds', async () => {
  const storage = fakeStorage();
  const form = fakeForm();
  const unbind = bindSettingsForm(form.root);
  await expect.poll(() => form.enabled.disabled).toBe(false);
  let failFeature!: () => void;
  let finishStrength!: () => void;
  storage.local.set = (values) => new Promise((resolve, reject) => {
    if (chromeKey in values) failFeature = () => reject(new Error('Injected failure'));
    else {
      Object.assign(storage.stored, values);
      finishStrength = resolve;
    }
  });
  form.chrome.checked = false;
  form.chrome.dispatch('change');
  form.strength.value = '44';
  form.strength.dispatch('input');
  finishStrength();
  failFeature();
  await expect.poll(() => form.status.textContent).toBe('保存できませんでした。もう一度操作してください。');
  expect(form.chrome.checked).toBe(true);
  expect(form.strength.value).toBe('44');
  expect(form.status.dataset.error).toBe('true');
  unbind();
});


test('a slow final read cannot rewind a newer cross-editor storage update', async () => {
  const storage = fakeStorage();
  const form = fakeForm();
  const unbind = bindSettingsForm(form.root);
  await expect.poll(() => form.enabled.disabled).toBe(false);
  let finishRead: ((value: StorageData) => void) | undefined;
  storage.local.get = () => new Promise((resolve) => { finishRead = resolve; });
  form.chrome.checked = false;
  form.chrome.dispatch('change');
  await expect.poll(() => Boolean(finishRead)).toBe(true);
  storage.stored[SETTINGS_KEYS.strength] = 78;
  storage.emit({ [SETTINGS_KEYS.strength]: { newValue: 78 } });
  expect(form.strength.value).toBe('78');
  finishRead!({ [chromeKey]: false, [SETTINGS_KEYS.strength]: 60 });
  await expect.poll(() => form.status.textContent).toBe('保存しました。');
  expect(form.strength.value).toBe('78');
  expect(form.chrome.checked).toBe(false);
  unbind();
});
