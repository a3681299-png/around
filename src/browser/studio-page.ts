import { mountStudio } from '../studio/app';
import { createStudioClient } from './studio-client';
import { createStudioRecovery } from './studio-recovery';
import { browserStudioPreferences } from './preferences';

async function start() {
  const tab = await chrome.tabs.getCurrent();
  if (tab?.id === undefined) throw new Error('Studioのタブを取得できません。');
  const app = mountStudio(document, document.querySelector<HTMLElement>('#studio')!, {
    hostName: 'YouTube', connect: createStudioClient, recovery: createStudioRecovery(tab.id), preferences: browserStudioPreferences,
  });
  const value = new URL(location.href).searchParams.get('target');
  await app.start(value && /^\d+$/.test(value) ? Number(value) : undefined);
  window.addEventListener('pagehide', () => app.destroy(), { once: true });
}
void start().catch((error: unknown) => { document.querySelector('#studio')!.textContent = error instanceof Error ? error.message : 'Studioを起動できませんでした。'; });
