import {
  DEFAULT_SETTINGS,
  readSettings,
  mergeSettings,
  updateSettings,
  watchSettings,
  type UserSettings,
  type SettingsPatch,
} from '../storage/settings';

/** Both the extension popup and the in-page panel share this storage binding. */
export function bindSettingsForm(root: ParentNode): () => void {
  function required<T extends HTMLElement>(selector: string): T {
    const element = root.querySelector<T>(selector);
    if (!element) throw new Error(`Missing settings element: ${selector}`);
    return element;
  }

  const enabled = required<HTMLInputElement>('#theme-enabled');
  const strength = required<HTMLInputElement>('#effect-strength');
  const themeState = required<HTMLOutputElement>('#theme-state');
  const strengthValue = required<HTMLOutputElement>('#strength-value');
  const featureControls = root.querySelectorAll<HTMLInputElement>('input[data-feature-id]');
  const controls = [enabled, strength, ...featureControls];
  const setDisabled = (disabled: boolean) => controls.forEach((control) => { control.disabled = disabled; });
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
    enabled.checked = settings.enabled;
    strength.value = String(settings.strength);
    themeState.value = settings.enabled ? 'ON' : 'OFF';
    strengthValue.value = `${settings.strength}%`;
    featureControls.forEach((control) => {
      const id = control.dataset.featureId;
      control.checked = id ? settings.features[id] === true : false;
    });
  };
  setDisabled(true);
  setStatus('設定を読み込んでいます…');

  const unwatch = watchSettings((stored) => {
    storageRevision++;
    // Keep the current slider gesture stable while its writes are completing.
    if (savesInFlight === 0) {
      settings = stored;
      render();
    }
    setDisabled(false);
    if (revision === 0) setStatus('設定は自動保存されます。');
  }, () => {
    setDisabled(true);
    setStatus('設定を読み込めません。拡張機能を再読み込みしてください。', true);
  });

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
    void updateSettings(patch).then(() => finishSave(false), () => finishSave(true));
  };
  const onToggle = () => commit({ enabled: enabled.checked });
  const onStrength = () => commit({ strength: Number(strength.value) });
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
  strength.addEventListener('input', onStrength);
  featureControls.forEach((control) => control.addEventListener('change', onFeature));
  focusButtons.forEach((button) => button.addEventListener('click', onFocusControl));

  return () => {
    active = false;
    unwatch();
    enabled.removeEventListener('change', onToggle);
    strength.removeEventListener('input', onStrength);
    featureControls.forEach((control) => control.removeEventListener('change', onFeature));
    focusButtons.forEach((button) => button.removeEventListener('click', onFocusControl));
  };
}

