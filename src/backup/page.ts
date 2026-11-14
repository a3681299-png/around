import { BACKUP_MESSAGE, type BackupReply, type BackupSummary } from './protocol';
import { BACKUP_LIMITS, BACKUP_MESSAGES } from './schema';
import settingsStyles from '../settings/settings.css';
import tokens from '../editor/studio-tokens.css';

// The same Around Studio sheet as the settings; here the page itself is the token host.
const style = document.createElement('style');
style.textContent = tokens.replaceAll(':host', ':root') + settingsStyles;
document.head.append(style);
const get = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
get('.identity').textContent = '拡張ID: ' + chrome.runtime.id + ' / 読み込み先: ' + chrome.runtime.getURL('');
const fileInput = get<HTMLInputElement>('#backup-file'),
  settings = get<HTMLInputElement>('#backup-settings'),
  restore = get<HTMLButtonElement>('#backup-restore'),
  output = get<HTMLAnchorElement>('#backup-download'),
  status = get('.backup-status'),
  info = get('.backup-summary');
const controls = [...document.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button,input')];
let busy = false,
  checkedFile: File | undefined,
  checkedSettings = false,
  downloadURL: string | undefined;
async function request(action: string, file?: File): Promise<BackupReply> {
  // postMessage wakes the registered worker without a JSON copy of the file.
  const worker = (await navigator.serviceWorker.getRegistration())?.active;
  if (!worker) throw new Error('Service Workerへ接続できません。拡張を再読み込みしてください。');
  const channel = new MessageChannel();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      channel.port1.close();
      reject(
        new Error('処理の応答がありません。ファイルを保持したまま、拡張を再読み込みしてもう一度操作してください。'),
      );
    }, 60_000);
    channel.port1.onmessage = (event: MessageEvent<BackupReply>) => {
      clearTimeout(timer);
      channel.port1.close();
      if (!event.data?.ok) reject(new Error(event.data?.error ?? 'バックアップに失敗しました。'));
      else resolve(event.data);
    };
    worker.postMessage({ type: BACKUP_MESSAGE, action, ...(file ? { file, applySettings: settings.checked } : {}) }, [
      channel.port2,
    ]);
  });
}
function describe(value: BackupSummary) {
  return (
    '作品 ' +
    value.designs +
    '件 / 素材 ' +
    value.assets +
    '個（' +
    (value.assetBytes / 1024 / 1024).toFixed(2) +
    'MiB）/ テイク ' +
    value.takes +
    '個 / 作成: ' +
    new Date(value.createdAt).toLocaleString('ja-JP')
  );
}
async function run(operation: () => Promise<void>) {
  if (busy) return;
  busy = true;
  controls.forEach((control) => {
    control.disabled = true;
  });
  status.dataset.error = 'false';
  status.textContent = '検証・処理中です。このページを閉じないでください。';
  try {
    await operation();
  } catch (error) {
    checkedFile = undefined;
    status.dataset.error = 'true';
    status.textContent = error instanceof Error ? error.message : 'バックアップに失敗しました。';
  } finally {
    busy = false;
    controls.forEach((control) => {
      control.disabled = false;
    });
    restore.disabled = !checkedFile;
  }
}
get('#backup-export').addEventListener('click', () => {
  void run(async () => {
    const result = await request('export');
    if (!result.file || !result.summary) throw new Error('書き出し結果が不正です。');
    if (downloadURL) URL.revokeObjectURL(downloadURL);
    downloadURL = URL.createObjectURL(result.file);
    output.href = downloadURL;
    output.download =
      'around-' +
      chrome.runtime.id.slice(0, 8) +
      '-' +
      new Date().toISOString().replace(/[:.]/g, '-') +
      '.aroundbackup';
    output.hidden = false;
    output.textContent = '検証済みバックアップを保存（' + describe(result.summary) + '）';
    status.textContent = '書き出しが完了しました。「バックアップを保存」のリンクからファイルを保存してください。';
    output.click();
  });
});
const invalidate = () => {
  checkedFile = undefined;
  restore.disabled = true;
  info.textContent = '';
};
fileInput.addEventListener('change', invalidate);
settings.addEventListener('change', invalidate);
get('#backup-inspect').addEventListener('click', () => {
  void run(async () => {
    const file = fileInput.files?.[0];
    if (!file) throw new Error('バックアップファイルを選んでください。');
    if (file.size > BACKUP_LIMITS.fileBytes) throw new Error(BACKUP_MESSAGES.fileSize);
    const result = await request('inspect', file);
    if (!result.summary) throw new Error('確認結果が不正です。');
    checkedFile = file;
    checkedSettings = settings.checked;
    info.textContent = describe(result.summary);
    status.textContent =
      '形式・SHA-256・素材・テイク・衝突・上限の検証が完了しました。確認してから読み込んでください。';
  });
});
restore.addEventListener('click', () => {
  void run(async () => {
    if (!checkedFile || checkedSettings !== settings.checked || fileInput.files?.[0] !== checkedFile)
      throw new Error('ファイルの内容を先に確認してください。');
    await request('restore', checkedFile);
    invalidate();
    status.textContent =
      '読み込みが完了しました。YouTubeとエディターを再読み込みして、作品と保存テイクを確認してください。';
  });
});
window.addEventListener('pagehide', () => {
  if (downloadURL) URL.revokeObjectURL(downloadURL);
});
