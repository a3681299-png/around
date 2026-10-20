import { mountStudio } from '../studio/app';
import { createStudioClient } from './studio-client';
import { createStudioRecovery } from './studio-recovery';
import { browserStudioPreferences } from './preferences';

async function start() {
  const params = new URL(location.href).searchParams,
    sidePanel = params.get('surface') === 'sidepanel';
  const value = params.get('target');
  const target = value && /^\d+$/.test(value) ? Number(value) : undefined;
  const tab = sidePanel ? { id: target } : await chrome.tabs.getCurrent();
  if (tab?.id === undefined) throw new Error('Studioのタブを取得できません。');
  const app = mountStudio(document, document.querySelector<HTMLElement>('#studio')!, {
    hostName: 'YouTube',
    sidePanel,
    connect: (notify, checkpoint) => createStudioClient(notify, checkpoint, sidePanel ? document : undefined),
    recovery: createStudioRecovery(tab.id),
    preferences: browserStudioPreferences,
  });
  document.body.toggleAttribute('data-sidepanel', sidePanel);
  await app.start(target);
  window.addEventListener('pagehide', () => app.destroy(), { once: true });
}
void start().catch((error: unknown) => {
  document.querySelector('#studio')!.textContent =
    error instanceof Error ? error.message : 'Studioを起動できませんでした。';
});
