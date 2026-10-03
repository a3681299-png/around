import {
  DEFAULT_SETTINGS,
  readSettings,
  updateSettings,
  watchSettings,
  type UserSettings,
} from '../storage/settings';

function required<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing popup element: ${selector}`);
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

function setStatus(message: string, error = false): void {
  status.textContent = message;
  status.dataset.error = String(error);
}

function render(): void {
  enabled.checked = settings.enabled;
  strength.value = String(settings.strength);
  themeState.value = settings.enabled ? 'ON' : 'OFF';
  strengthValue.value = `${settings.strength}%`;
}

const unwatch = watchSettings((stored) => {
  // Keep the current slider gesture stable while its writes are completing.
  if (savesInFlight === 0) {
    settings = stored;
    render();
  }
  enabled.disabled = false;
  strength.disabled = false;
  if (revision === 0) setStatus('設定は自動保存されます。');
}, () => {
  enabled.disabled = true;
  strength.disabled = true;
  setStatus('設定を読み込めません。拡張機能を再読み込みしてください。', true);
});

function commit(patch: Partial<UserSettings>): void {
  const edit = ++revision;
  settings = { ...settings, ...patch };
  render();
  savesInFlight++;
  setStatus('保存しています…');

  // Start every write immediately: no debounce timer is lost when the popup closes.
  void updateSettings(patch).then(() => {
    savesInFlight--;
    if (edit === revision) setStatus('保存しました。');
  }).catch(async () => {
    savesInFlight--;
    if (edit !== revision) return;
    try {
      settings = await readSettings();
      render();
    } catch {
      enabled.disabled = true;
      strength.disabled = true;
    }
    setStatus('保存できませんでした。もう一度操作してください。', true);
  });
}

enabled.addEventListener('change', () => commit({ enabled: enabled.checked }));
strength.addEventListener('input', () => commit({ strength: Number(strength.value) }));
window.addEventListener('unload', unwatch, { once: true });
