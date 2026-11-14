import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, resolve } from 'node:path';

/** The deploy probe (scripts/build-deploy-probe.mjs) on a local static server, with small files. */
const out = resolve('.work/deploy-probe-e2e');
let server: Server, origin: string;
/** When set, the server flips one byte of this file, as a host that rewrites files would. */
let corrupt: string | undefined;
test.use({ channel: 'chromium', headless: true });

test.beforeAll(async () => {
  execFileSync(process.execPath, ['scripts/build-deploy-probe.mjs'], {
    env: { ...process.env, AROUND_PROBE_OUT: '.work/deploy-probe-e2e', AROUND_PROBE_MB: '1' },
    stdio: 'pipe',
  });
  server = createServer((request, response) => {
    const name = decodeURIComponent(new URL(request.url!, 'http://x').pathname);
    const file = normalize(join(out, name === '/' ? 'index.html' : name));
    if (!file.startsWith(out) || !statSync(file, { throwIfNoEntry: false })?.isFile()) {
      response.writeHead(404).end();
      return;
    }
    const body = readFileSync(file);
    if (corrupt && name.endsWith(corrupt)) body[100] = body[100]! ^ 0xff;
    const type = file.endsWith('.html')
      ? 'text/html'
      : file.endsWith('.js')
        ? 'text/javascript'
        : 'application/octet-stream';
    response.writeHead(200, { 'content-type': type });
    response.end(body);
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
test.afterAll(() => new Promise<void>((done) => server.close(() => done())));

test('the probe page reads every file and shows its type, size and time', async ({ page }) => {
  corrupt = undefined;
  const errors: string[] = [];
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
  await page.goto(origin + '/');
  await expect(page.locator('html')).toHaveAttribute('data-done', 'true');
  await expect(page.locator('#rows tr')).toHaveCount(3);
  await expect(page.locator('#rows')).toContainText('files/dummy.vrm');
  await expect(page.locator('#rows')).toContainText('application/octet-stream');
  await expect(page.locator('#rows')).toContainText(' ms');
  expect(errors).toEqual([]);
});

test('a host that changes the bytes is shown as a mismatch', async ({ page }) => {
  corrupt = 'dummy.glb';
  await page.goto(origin + '/');
  await expect(page.locator('html')).toHaveAttribute('data-done', 'false');
  await expect(page.locator('#rows tr', { hasText: 'dummy.glb' })).toContainText('中身が違う');
  await expect(page.locator('#rows tr', { hasText: 'dummy.vrm' })).toContainText('中身一致');
});
