import { test, expect } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { launchExtension } from './fixtures';
import { initialWorldState } from '../src/world/evaluate';
import { WORLD_RUNTIME_VERSION } from '../src/world/types';
import { worldScenario } from './helpers/world-scenario';

test('take IndexedDB survives browser restart, budgets are atomic, and invalid data never touches saved artwork', async () => {
  test.setTimeout(90_000);
  const profile = await mkdtemp(path.join(tmpdir(), 'around-signal-take-store-'));
  const inputs = worldScenario(1)
    .inputs.slice(0, 3)
    .map((input) => ({
      ...input,
      signals: { ...input.signals, scroll: { x: 0, y: input.timeMs, maxX: 0, maxY: 2000 } },
    }));
  const take = {
    format: 'around-signal-take',
    formatVersion: 1,
    runtimeVersion: WORLD_RUNTIME_VERSION,
    id: 'take-restart',
    name: 'Take 1',
    siteId: 'youtube',
    initialState: initialWorldState(),
    inputs,
  };
  for (const pass of [0, 1]) {
    const context = await launchExtension(profile);
    try {
      const manager = await context.newPage();
      await manager.goto('chrome://extensions/');
      const item = manager.locator('extensions-item').filter({ hasText: 'Around' });
      await item.waitFor();
      const id = await item.evaluate((node) => (node as HTMLElement & { data?: { id: string } }).data?.id ?? node.id);
      const popup = await context.newPage();
      await popup.goto(`chrome-extension://${id}/popup/index.html`);
      const send = (action: string, extra: Record<string, unknown> = {}) =>
        popup.evaluate((request) => chrome.runtime.sendMessage(request), {
          type: 'around:signal-takes',
          action,
          siteId: 'youtube',
          ...extra,
        });
      if (pass === 0) {
        expect(await send('put', { take })).toMatchObject({ ok: true });
        expect(await send('put', { take: { ...take, id: 'take-private', cookie: 'secret' } })).toMatchObject({
          ok: false,
        });
        expect(
          await send('put', {
            take: {
              ...take,
              id: 'take-malformed',
              inputs: [{ ...inputs[0], signals: { ...inputs[0]!.signals, form: 'secret' } }],
            },
          }),
        ).toMatchObject({ ok: false });
        for (let index = 1; index < 8; index++)
          expect(await send('put', { take: { ...take, id: `take-${index}` } })).toMatchObject({ ok: true });
        expect(await send('put', { take: { ...take, id: 'take-over-budget' } })).toMatchObject({
          ok: false,
          error: expect.stringContaining('8個'),
        });
      } else {
        expect(await send('get', { id: take.id })).toMatchObject({
          ok: true,
          value: { id: take.id, inputs: JSON.parse(JSON.stringify(inputs)) },
        });
        expect((await send('list')).value).toHaveLength(8);
        expect(await send('delete', { id: 'take-1' })).toMatchObject({ ok: true });
        expect(await send('put', { take: { ...take, id: 'take-after-delete' } })).toMatchObject({ ok: true });
        expect(
          await popup.evaluate(
            async () => (await chrome.storage.local.get('around.design.youtube'))['around.design.youtube'],
          ),
        ).toBeUndefined();
      }
    } finally {
      await context.close();
    }
  }
});
