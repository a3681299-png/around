import {
  DEFAULT_SETTINGS,
  readSettings,
  mergeSettings,
  updateSettings,
  watchSettings,
  type UserSettings,
  type SettingsPatch,
} from '../storage/settings';
import { PALETTE_CHANNELS, PALETTE_PRESETS, type PaletteChannel } from '../themes/retro/palette';
import { mountSafetyControls } from './safety-controls';

/** Both the extension popup and the in-page panel share this storage binding. */
export function bindSettingsForm(root: ParentNode): () => void {
  const safetyRoot = root.querySelector<HTMLElement>('.ww-editor-body');
  const unmountSafety = safetyRoot ? mountSafetyControls(safetyRoot) : undefined;
  const backup = root.querySelector<HTMLAnchorElement>('.backup-open');
  if (backup) backup.href = chrome.runtime.getURL('backup/index.html');
  function required<T extends HTMLElement>(selector: string): T {
    const element = root.querySelector<T>(selector);
    if (!element) throw new Error(`Missing settings element: ${selector}`);
    return element;
  }

  const enabled = required<HTMLInputElement>('#theme-enabled');
  const creatorMode = required<HTMLInputElement>('#creator-mode');
  const strength = required<HTMLInputElement>('#effect-strength');
  const themeState = required<HTMLOutputElement>('#theme-state');
  const strengthValue = required<HTMLOutputElement>('#strength-value');
  const noise = required<HTMLInputElement>('#noise-strength');
  const noiseValue = required<HTMLOutputElement>('#noise-strength-value');
  const paletteControls = PALETTE_CHANNELS.map((channel) => ({
    channel,
    input: required<HTMLInputElement>(`#palette-${channel}`),
    output: required<HTMLOutputElement>(`#palette-${channel}-value`),
  }));
  const presetButtons = root.querySelectorAll<HTMLButtonElement>('[data-palette-preset]');
  const featureControls = root.querySelectorAll<HTMLInputElement>('input[data-feature-id]');
  const controls = [
    creatorMode,
    enabled,
    strength,
    noise,
    ...paletteControls.map(({ input }) => input),
    ...presetButtons,
    ...featureControls,
  ];
  const setDisabled = (disabled: boolean) =>
    controls.forEach((control) => {
      control.disabled = disabled;
    });
  const status = required<HTMLParagraphElement>('#save-status');
  let settings: UserSettings = mergeSettings(DEFAULT_SETTINGS, {});
  let savesInFlight = 0;
  let batchFailed = false;
  let revision = 0;
  let storageRevision = 0;
  let active = true;

  const setStatus = (message: string, error = false) => {
    status.textContent = message;
    status.dataset.error = String(error);
  };
  const render = () => {
    creatorMode.checked = settings.creatorMode;
    enabled.checked = settings.enabled;
    strength.value = String(settings.strength);
    themeState.value = settings.enabled ? 'ON' : 'OFF';
    strengthValue.value = `${settings.strength}%`;
    noise.value = String(settings.noiseStrength);
    noiseValue.value = `${settings.noiseStrength}%`;
    paletteControls.forEach(({ channel, input, output }) => {
      input.value = String(settings.palette[channel]);
      output.value = `${settings.palette[channel]}${channel === 'hue' ? '°' : '%'}`;
    });
    presetButtons.forEach((button) => {
      const preset = PALETTE_PRESETS[button.dataset.palettePreset as keyof typeof PALETTE_PRESETS];
      button.setAttribute(
        'aria-pressed',
        String(Boolean(preset) && PALETTE_CHANNELS.every((channel) => settings.palette[channel] === preset[channel])),
      );
    });
    featureControls.forEach((control) => {
      const id = control.dataset.featureId;
      control.checked = id ? settings.features[id] === true : false;
    });
  };
  setDisabled(true);
  setStatus('設定を読み込んでいます…');

  const unwatch = watchSettings(
    (stored) => {
      storageRevision++;
      // Keep the current slider gesture stable while its writes are completing.
      if (savesInFlight === 0) {
        settings = stored;
        render();
      }
      setDisabled(false);
      if (revision === 0) setStatus('設定は自動保存されます。');
    },
    () => {
      setDisabled(true);
      setStatus('設定を読み込めません。拡張機能を再読み込みしてください。', true);
    },
  );

  const finishSave = async (failed: boolean) => {
    savesInFlight--;
    batchFailed ||= failed;
    if (!active || savesInFlight > 0) return;
    const settledRevision = revision;
    const hadFailure = batchFailed;
    const readRevision = storageRevision;
    // Read once every overlapping burst settles, even if an older write finishes last.
    // This also catches another editor's changes that arrived during this gesture.
    try {
      const saved = await readSettings();
      if (!active || settledRevision !== revision) return;
      // A newer storage event already rendered its values while this read waited.
      if (readRevision === storageRevision) {
        settings = saved;
        render();
      }
    } catch {
      if (!active || settledRevision !== revision) return;
      if (hadFailure) setDisabled(true);
    }
    setStatus(hadFailure ? '保存できませんでした。もう一度操作してください。' : '保存しました。', hadFailure);
  };

  const commit = (patch: SettingsPatch) => {
    revision++;
    settings = mergeSettings(settings, patch);
    render();
    if (savesInFlight === 0) batchFailed = false;
    savesInFlight++;
    setStatus('保存しています…');
    // Start every write immediately, including when the panel closes mid-gesture.
    void updateSettings(patch).then(
      () => finishSave(false),
      () => finishSave(true),
    );
  };
  const onToggle = () => commit({ enabled: enabled.checked });
  const onCreatorMode = () => commit({ creatorMode: creatorMode.checked });
  const onStrength = () => commit({ strength: Number(strength.value) });
  const onNoise = () => commit({ noiseStrength: Number(noise.value) });
  const onPalette = (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    const channel = input.dataset.paletteChannel as PaletteChannel;
    if (PALETTE_CHANNELS.includes(channel)) commit({ palette: { [channel]: Number(input.value) } });
  };
  const onPreset = (event: Event) => {
    const button = event.currentTarget as HTMLButtonElement;
    const preset = PALETTE_PRESETS[button.dataset.palettePreset as keyof typeof PALETTE_PRESETS];
    if (preset) commit({ palette: preset });
  };
  const onFeature = (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    const id = input.dataset.featureId;
    if (id) commit({ features: { [id]: input.checked } });
  };
  const focusButtons = root.querySelectorAll<HTMLButtonElement>('[data-settings-focus]');
  const onFocusControl = (event: Event) => {
    const target = (event.currentTarget as HTMLButtonElement).dataset.settingsFocus;
    if (target) root.querySelector<HTMLInputElement>(`#${target}`)?.focus();
  };
  enabled.addEventListener('change', onToggle);
  creatorMode.addEventListener('change', onCreatorMode);
  strength.addEventListener('input', onStrength);
  noise.addEventListener('input', onNoise);
  paletteControls.forEach(({ input }) => input.addEventListener('input', onPalette));
  presetButtons.forEach((button) => button.addEventListener('click', onPreset));
  featureControls.forEach((control) => control.addEventListener('change', onFeature));
  focusButtons.forEach((button) => button.addEventListener('click', onFocusControl));

  return () => {
    unmountSafety?.();
    active = false;
    unwatch();
    enabled.removeEventListener('change', onToggle);
    creatorMode.removeEventListener('change', onCreatorMode);
    strength.removeEventListener('input', onStrength);
    noise.removeEventListener('input', onNoise);
    paletteControls.forEach(({ input }) => input.removeEventListener('input', onPalette));
    presetButtons.forEach((button) => button.removeEventListener('click', onPreset));
    featureControls.forEach((control) => control.removeEventListener('change', onFeature));
    focusButtons.forEach((button) => button.removeEventListener('click', onFocusControl));
  };
}
