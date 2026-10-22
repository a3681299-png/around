import { test, expect } from '@playwright/test';
import { FEATURE_REGISTRY, defaultFeaturePreferences, type FeatureDefinition } from '../src/features';
import { createFeatureController } from '../src/features/controller';
import { bindSettingsForm } from '../src/settings/form';
import { createThemeController } from '../src/themes/controller';
import { DEFAULT_PALETTE, PALETTE_CHANNELS, PALETTE_PRESETS, PALETTE_VARIABLES } from '../src/themes/retro/palette';
import { retroVariables } from '../src/themes/retro/variables';
import type { SiteAdapter } from '../src/sites/types';
import {
  DEFAULT_SETTINGS,
  FEATURE_SETTINGS_KEYS,
  SETTINGS_KEYS,
  PALETTE_SETTINGS_KEYS,
  normalizeNoiseStrength,
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
    stylesheet: '',
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
  expect(await readSettings()).toEqual(mergeSettings(DEFAULT_SETTINGS, { enabled: true, strength: 37 }));
  expect(storage.writes).toEqual([]);
  storage.stored[chromeKey] = false;
  expect((await readSettings()).features).toEqual({ ...defaultFeaturePreferences(), 'window-chrome': false });
  storage.stored[chromeKey] = 'invalid';
  expect((await readSettings()).features).toEqual({ ...defaultFeaturePreferences(), 'window-chrome': true });
  delete storage.stored[chromeKey];
  expect((await readSettings()).features).toEqual({ ...defaultFeaturePreferences(), 'window-chrome': true });
});

test('feature writes use their own keys and ignore unknown feature IDs', async () => {
  const storage = fakeStorage({ [SETTINGS_KEYS.enabled]: true, [SETTINGS_KEYS.strength]: 37 });
  await Promise.all([
    updateSettings({ strength: 88 }),
    updateSettings({ features: { 'window-chrome': false, 'unregistered-feature': true } }),
  ]);
  expect(storage.writes).toEqual([{ [SETTINGS_KEYS.strength]: 88 }, { [chromeKey]: false }]);
  expect(await readSettings()).toEqual(
    mergeSettings(DEFAULT_SETTINGS, { enabled: true, strength: 88, features: { 'window-chrome': false } }),
  );
  await updateSettings({ features: { 'unknown-only': true } });
  expect(storage.writes).toHaveLength(2);
});

test('settings merge retains unrelated feature values and never mutates defaults', () => {
  const settings = { ...DEFAULT_SETTINGS, features: { 'window-chrome': true, another: true } };
  const merged = mergeSettings(settings, { features: { 'window-chrome': false } });
  expect(merged.features).toEqual({ 'window-chrome': false, another: true });
  expect(settings.features['window-chrome']).toBe(true);
  expect(defaultFeaturePreferences()['window-chrome']).toBe(true);
  expect(defaultFeaturePreferences()).not.toBe(defaultFeaturePreferences());
});

test('initial read merges intervening feature and global changes and ignores foreign keys', async () => {
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
  storage.emit({ [chromeKey]: { newValue: false } });
  storage.emit({ [SETTINGS_KEYS.enabled]: { newValue: true } });
  storage.emit({ [SETTINGS_KEYS.strength]: { newValue: 91 } });
  storage.emit({ 'webWorldThemes.features.not-installed': { newValue: true } });
  storage.emit({ [chromeKey]: { newValue: true } }, 'sync');
  finishRead({ [SETTINGS_KEYS.enabled]: false, [SETTINGS_KEYS.strength]: 12, [chromeKey]: true });
  await expect.poll(() => snapshots.length).toBe(1);
  expect(snapshots[0]).toEqual(
    mergeSettings(DEFAULT_SETTINGS, { enabled: true, strength: 91, features: { 'window-chrome': false } }),
  );
  storage.emit({ [SETTINGS_KEYS.strength]: { newValue: 45 } });
  expect(snapshots[1]).toEqual(
    mergeSettings(DEFAULT_SETTINGS, { enabled: true, strength: 45, features: { 'window-chrome': false } }),
  );
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
  finishRead({ [SETTINGS_KEYS.enabled]: true });
  await Promise.resolve();
  await Promise.resolve();
  expect(snapshots).toEqual([]);
  expect(storage.listeners.size).toBe(0);
});

test('registry lifecycle mounts once, independently toggles modules, and cleans up once', () => {
  const counts: Record<string, { mounts: number; refreshes: number; destroys: number }> = {};
  const definitions: FeatureDefinition[] = ['first', 'second'].map((id) => {
    const count = (counts[id] = { mounts: 0, refreshes: 0, destroys: 0 });
    return {
      id,
      label: id,
      description: id,
      defaultEnabled: true,
      mount: () => {
        count.mounts++;
        return {
          refresh: () => {
            count.refreshes++;
          },
          destroy: () => {
            count.destroys++;
          },
        };
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
  const unsupported = createFeatureController({ document: fakeDocument().doc, site: fakeSite() });
  expect(() => {
    unsupported.update();
    unsupported.refresh();
    unsupported.destroy();
  }).not.toThrow();
  let mounts = 0;
  let destroys = 0;
  const site = fakeSite({
    features: {
      'window-chrome': {
        mount: () => {
          mounts++;
          return {
            destroy: () => {
              destroys++;
            },
          };
        },
      },
    },
  });
  const supported = createFeatureController({ document: fakeDocument().doc, site });
  supported.update({ 'window-chrome': false });
  expect(mounts).toBe(0);
  supported.update();
  supported.update();
  expect(mounts).toBe(1);
  supported.destroy();
  expect(destroys).toBe(1);
  expect(FEATURE_REGISTRY.map(({ id }) => id)).toEqual([
    'window-chrome',
    'palette',
    'glossy-titlebars',
    'focus-titlebars',
    'daily-details',
    'surface-noise',
    'bbs-comments',
    'transparent-background',
    'lcd-durations',
    'readable-votes',
  ]);
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
      return () => {
        disconnections++;
        onPageChange = undefined;
      };
    },
    features: {
      'window-chrome': {
        mount: () => {
          mounts++;
          return {
            refresh: () => {
              refreshes++;
            },
            destroy: () => {
              destroys++;
            },
          };
        },
      },
    },
  });
  const controller = createThemeController(doc, site, {
    id: 'fixture',
    name: 'Fixture',
    stylesheets: [],
    editorStylesheets: [],
  });
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
      checked: false,
      disabled: true,
      value: '',
      textContent: '',
      dataset: {} as Record<string, string>,
      attributes: {} as Record<string, string>,
      setAttribute(name: string, value: string) {
        this.attributes[name] = value;
      },
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
  const strength = control();
  const chrome = control();
  const themeState = control();
  const strengthValue = control();
  const status = control();
  const noise = control();
  const palettes = Object.fromEntries(
    PALETTE_CHANNELS.map((channel) => {
      const input = control();
      input.dataset.paletteChannel = channel;
      return [channel, input];
    }),
  ) as Record<(typeof PALETTE_CHANNELS)[number], ReturnType<typeof control>>;
  const presets = Object.fromEntries(
    Object.keys(PALETTE_PRESETS).map((preset) => {
      const button = control();
      button.dataset.palettePreset = preset;
      return [preset, button];
    }),
  ) as Record<keyof typeof PALETTE_PRESETS, ReturnType<typeof control>>;
  chrome.dataset.featureId = 'window-chrome';
  const elements = new Map([
    ['#creator-mode', creatorMode],
    ['#theme-enabled', enabled],
    ['#effect-strength', strength],
    ['#theme-state', themeState],
    ['#strength-value', strengthValue],
    ['#save-status', status],
    ['#noise-strength', noise],
    ['#noise-strength-value', control()],
    ...PALETTE_CHANNELS.flatMap(
      (channel) =>
        [
          [`#palette-${channel}`, palettes[channel]],
          [`#palette-${channel}-value`, control()],
        ] as Array<[string, ReturnType<typeof control>]>,
    ),
  ]);
  const root = {
    querySelector: (selector: string) => elements.get(selector),
    querySelectorAll: (selector: string) =>
      selector === 'input[data-feature-id]'
        ? [chrome]
        : selector === '[data-palette-preset]'
          ? Object.values(presets)
          : [],
  } as unknown as ParentNode;
  return { root, enabled, creatorMode, strength, chrome, status, palettes, presets, noise };
}

test('creator mode defaults OFF, is shared between forms, and unbinds its change listener', async () => {
  const storage = fakeStorage();
  const a = fakeForm(),
    b = fakeForm(),
    stopA = bindSettingsForm(a.root),
    stopB = bindSettingsForm(b.root);
  await expect.poll(() => a.creatorMode.disabled).toBe(false);
  expect(a.creatorMode.checked).toBe(false);
  a.creatorMode.checked = true;
  a.creatorMode.dispatch('change');
  await expect.poll(() => b.creatorMode.checked).toBe(true);
  expect(storage.writes).toContainEqual({ [SETTINGS_KEYS.creatorMode]: true });
  stopA();
  stopB();
  expect(a.creatorMode.listenerCount()).toBe(0);
});

test('shared editor reconciles independent changes when older saves finish last', async () => {
  const storage = fakeStorage();
  const form = fakeForm();
  const unbind = bindSettingsForm(form.root);
  await expect.poll(() => form.enabled.disabled).toBe(false);
  expect(form.chrome.checked).toBe(true);
  const finish: Array<() => void> = [];
  storage.local.set = (values) =>
    new Promise((resolve) => {
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
  storage.local.set = (values) =>
    new Promise((resolve, reject) => {
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
  storage.local.get = () =>
    new Promise((resolve) => {
      finishRead = resolve;
    });
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

test('palette and noise writes are granular and preserve global, feature, and unrelated settings', async () => {
  const storage = fakeStorage({
    [SETTINGS_KEYS.enabled]: true,
    [SETTINGS_KEYS.strength]: 37,
    [chromeKey]: false,
    [PALETTE_SETTINGS_KEYS.brightness]: 63,
    'anotherExtension.preference': 'keep',
  });
  await Promise.all([
    updateSettings({ palette: { hue: 140 } }),
    updateSettings({ palette: { saturation: 28 } }),
    updateSettings({ noiseStrength: 74 }),
  ]);
  expect(storage.writes).toEqual([
    { [PALETTE_SETTINGS_KEYS.hue]: 140 },
    { [PALETTE_SETTINGS_KEYS.saturation]: 28 },
    { [SETTINGS_KEYS.noiseStrength]: 74 },
  ]);
  expect(await readSettings()).toEqual(
    mergeSettings(DEFAULT_SETTINGS, {
      enabled: true,
      strength: 37,
      features: { 'window-chrome': false },
      palette: { hue: 140, saturation: 28, brightness: 63 },
      noiseStrength: 74,
    }),
  );
  expect(storage.stored['anotherExtension.preference']).toBe('keep');
  await updateSettings({ enabled: false });
  expect((await readSettings()).palette).toEqual({ hue: 140, saturation: 28, brightness: 63 });
});

test('palette, noise, and feature changes during initial read merge independently', async () => {
  const storage = fakeStorage();
  let finishRead!: (value: StorageData) => void;
  storage.local.get = () =>
    new Promise((resolve) => {
      finishRead = resolve;
    });
  const snapshots: UserSettings[] = [];
  const stop = watchSettings(
    (value) => snapshots.push(value),
    () => {},
  );
  storage.emit({ [PALETTE_SETTINGS_KEYS.hue]: { newValue: 99 } });
  storage.emit({ [PALETTE_SETTINGS_KEYS.saturation]: { newValue: 22 } });
  storage.emit({ [SETTINGS_KEYS.noiseStrength]: { newValue: 36 } });
  storage.emit({ [chromeKey]: { newValue: false } });
  finishRead({ [PALETTE_SETTINGS_KEYS.brightness]: 77 });
  await expect.poll(() => snapshots.length).toBe(1);
  expect(snapshots[0]!.palette).toEqual({ hue: 99, saturation: 22, brightness: 77 });
  expect(snapshots[0]!.noiseStrength).toBe(36);
  expect(snapshots[0]!.features['window-chrome']).toBe(false);
  snapshots[0]!.palette.hue = 0;
  storage.emit({ [PALETTE_SETTINGS_KEYS.saturation]: { oldValue: 22 } });
  expect(snapshots[1]!.palette).toEqual({ hue: 99, saturation: DEFAULT_PALETTE.saturation, brightness: 77 });
  stop();
});

test('invalid stored channels and noise use bounded defaults without rewriting storage', async () => {
  const storage = fakeStorage({
    [PALETTE_SETTINGS_KEYS.hue]: Infinity,
    [PALETTE_SETTINGS_KEYS.saturation]: -50,
    [PALETTE_SETTINGS_KEYS.brightness]: 101,
    [SETTINGS_KEYS.noiseStrength]: '42',
  });
  expect((await readSettings()).palette).toEqual({ hue: DEFAULT_PALETTE.hue, saturation: 0, brightness: 100 });
  expect((await readSettings()).noiseStrength).toBe(DEFAULT_SETTINGS.noiseStrength);
  expect(storage.writes).toEqual([]);
  expect(normalizeNoiseStrength(500)).toBe(100);
  expect(normalizeNoiseStrength(-3)).toBe(0);
  expect(normalizeNoiseStrength(NaN)).toBe(DEFAULT_SETTINGS.noiseStrength);
});

test('palette and noise variables follow independent toggles and leave nothing after OFF or zero', () => {
  const { doc, properties } = fakeDocument();
  const controller = createThemeController(doc, fakeSite(), {
    id: 'fixture',
    name: 'Fixture',
    stylesheets: [],
    editorStylesheets: [],
    variables: retroVariables,
  });
  const active = mergeSettings(DEFAULT_SETTINGS, {
    enabled: true,
    palette: PALETTE_PRESETS.mint,
    noiseStrength: 41,
    features: { palette: true, 'surface-noise': true },
  });
  controller.update(active);
  expect(PALETTE_VARIABLES.every((name) => properties.has(name))).toBe(true);
  expect(properties.get('--ww-noise-strength')).toBe('0.41');
  controller.update(mergeSettings(active, { features: { palette: false } }));
  expect(PALETTE_VARIABLES.every((name) => !properties.has(name))).toBe(true);
  expect(properties.get('--ww-noise-strength')).toBe('0.41');
  controller.update(mergeSettings(active, { features: { 'surface-noise': false } }));
  expect(properties.has('--ww-noise-strength')).toBe(false);
  expect(PALETTE_VARIABLES.every((name) => properties.has(name))).toBe(true);
  controller.update(mergeSettings(active, { enabled: false }));
  expect(properties.size).toBe(0);
  controller.update(active);
  controller.update(mergeSettings(active, { strength: 0 }));
  expect(properties.size).toBe(0);
  controller.destroy();
  expect(active.palette).toEqual(PALETTE_PRESETS.mint);
  expect(active.noiseStrength).toBe(41);
});

test('preset, palette, and noise controls save while the theme is OFF and fully unbind', async () => {
  const storage = fakeStorage();
  const form = fakeForm();
  const unbind = bindSettingsForm(form.root);
  await expect.poll(() => form.enabled.disabled).toBe(false);
  expect(form.presets.silver.attributes['aria-pressed']).toBe('true');
  form.presets.lavender.dispatch('click');
  await expect.poll(() => form.status.textContent).toBe('保存しました。');
  expect((await readSettings()).palette).toEqual(PALETTE_PRESETS.lavender);
  expect(form.presets.lavender.attributes['aria-pressed']).toBe('true');
  expect(storage.writes[0]).toEqual({
    [PALETTE_SETTINGS_KEYS.hue]: PALETTE_PRESETS.lavender.hue,
    [PALETTE_SETTINGS_KEYS.saturation]: PALETTE_PRESETS.lavender.saturation,
    [PALETTE_SETTINGS_KEYS.brightness]: PALETTE_PRESETS.lavender.brightness,
  });
  form.palettes.hue.value = '95';
  form.palettes.hue.dispatch('input');
  form.noise.value = '0';
  form.noise.dispatch('input');
  await expect.poll(() => form.status.textContent).toBe('保存しました。');
  expect(form.presets.lavender.attributes['aria-pressed']).toBe('false');
  expect((await readSettings()).enabled).toBe(false);
  expect((await readSettings()).palette.hue).toBe(95);
  expect((await readSettings()).noiseStrength).toBe(0);
  unbind();
  expect(storage.listeners.size).toBe(0);
  for (const control of [...Object.values(form.palettes), ...Object.values(form.presets), form.noise]) {
    expect(control.listenerCount()).toBe(0);
  }
});
