import { test, type Page } from '@playwright/test';

/** Failure-only inspection of the opt-in measurement build; never changes a verdict or reads
 * fresh DOM geometry. The renderer recorded the snapshot and bounds that produced an empty clip. */
export async function attachOperationDiagnostics(page: Page) {
  const session = await page.context().newCDPSession(page);
  const contexts: { id: number; auxData?: { type?: string } }[] = [];
  session.on('Runtime.executionContextCreated', ({ context }) => contexts.push(context));
  try {
    await session.send('Runtime.enable');
    for (const context of contexts.filter((context) => context.auxData?.type === 'isolated')) {
      const result = await session.send('Runtime.evaluate', {
        contextId: context.id,
        expression: 'globalThis.__g11Probe?.pageMisses',
        returnByValue: true,
      });
      const misses: unknown = result.result.value;
      if (!Array.isArray(misses)) continue;
      await test.info().attach('operation-page-misses.json', {
        body: JSON.stringify(misses, null, 2),
        contentType: 'application/json',
      });
      break;
    }
  } catch (error) {
    await test.info().attach('operation-diagnostic-error.txt', {
      body: String(error),
      contentType: 'text/plain',
    });
  } finally {
    await session.detach().catch(() => undefined);
  }
}
