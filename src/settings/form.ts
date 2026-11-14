import { DEFAULT_SETTINGS, mergeSettings, type UserSettings, type SettingsPatch } from '../storage/settings';
import { readSettings, updateSettings, watchSettings } from '../browser/settings-store';
import { extensionPageUrl } from '../browser/side-panel';
import { mountSafetyControls } from './safety-controls';

/** Both the extension popup and the in-page panel share this storage binding. */
export function bindSettingsForm(root: ParentNode): () => void {
  const safetyRoot = root.querySelector<HTMLElement>('.around-editor-body');
  const unmountSafety = safetyRoot ? mountSafetyControls(safetyRoot) : undefined;
  const backup = root.querySelector<HTMLAnchorElement>('.backup-open');
  if (backup) backup.href = extensionPageUrl('backup/index.html');
  function required<T extends HTMLElement>(selector: string): T {
    const element = root.querySelector<T>(selector);
    if (!element) throw new Error(`Missing settings element: ${selector}`);
    return element;
  }

  const enabled = required<HTMLInputElement>('#show-artwork');
  const creatorMode = required<HTMLInputElement>('#creator-mode');
  const enabledState = required<HTMLOutputElement>('#show-artwork-state');
  const controls = [creatorMode, enabled];
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
    enabledState.value = settings.enabled ? 'ON' : 'OFF';
  };
  setDisabled(true);
  setStatus('設定を読み込んでいます…');

  const unwatch = watchSettings(
    (stored) => {
      storageRevision++;
      // Keep the current gesture stable while its writes are completing.
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
  enabled.addEventListener('change', onToggle);
  creatorMode.addEventListener('change', onCreatorMode);

  return () => {
    unmountSafety?.();
    active = false;
    unwatch();
    enabled.removeEventListener('change', onToggle);
    creatorMode.removeEventListener('change', onCreatorMode);
  };
}
