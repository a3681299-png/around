import {
  DEFAULT_SETTINGS,
  readSettings,
  updateSettings,
  watchSettings,
  type UserSettings,
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
  const status = required<HTMLParagraphElement>('#save-status');
  let settings: UserSettings = { ...DEFAULT_SETTINGS };
  let savesInFlight = 0;
  let revision = 0;
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
  };
  enabled.disabled = strength.disabled = true;
  setStatus('設定を読み込んでいます…');

  const unwatch = watchSettings((stored) => {
    // Keep the current slider gesture stable while its writes are completing.
    if (savesInFlight === 0) {
      settings = stored;
      render();
    }
    enabled.disabled = strength.disabled = false;
    if (revision === 0) setStatus('設定は自動保存されます。');
  }, () => {
    enabled.disabled = strength.disabled = true;
    setStatus('設定を読み込めません。拡張機能を再読み込みしてください。', true);
  });

  const commit = (patch: Partial<UserSettings>) => {
    const edit = ++revision;
    settings = { ...settings, ...patch };
    render();
    savesInFlight++;
    setStatus('保存しています…');
    // Start every write immediately, including when the panel closes mid-gesture.
    void updateSettings(patch).then(() => {
      savesInFlight--;
      if (active && edit === revision) setStatus('保存しました。');
    }).catch(async () => {
      savesInFlight--;
      if (!active || edit !== revision) return;
      try {
        const saved = await readSettings();
        if (!active || edit !== revision) return;
        settings = saved;
        render();
      } catch {
        if (!active || edit !== revision) return;
        enabled.disabled = strength.disabled = true;
      }
      setStatus('保存できませんでした。もう一度操作してください。', true);
    });
  };
  const onToggle = () => commit({ enabled: enabled.checked });
  const onStrength = () => commit({ strength: Number(strength.value) });
  enabled.addEventListener('change', onToggle);
  strength.addEventListener('input', onStrength);

  return () => {
    active = false;
    unwatch();
    enabled.removeEventListener('change', onToggle);
    strength.removeEventListener('input', onStrength);
  };
}
