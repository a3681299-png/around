import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { canReuseImportInspection } from '../src/assets/import-validation';
import { inspectAsset } from '../src/assets/inspect';
import { vrmFixture } from './helpers/vrm-fixture';

for (const [name, bytes] of [
  ['png', readFileSync('tests/fixtures/motion/petal.png')],
  ['gif', readFileSync('tests/fixtures/motion/petal.gif')],
  ['apng', readFileSync('tests/fixtures/motion/petal.apng')],
  ['webm', readFileSync('tests/fixtures/motion/long.webm')],
  ['lottie', readFileSync('tests/fixtures/motion/petal.json')],
  ['vrm', vrmFixture()],
] as const) {
  test(`worker import receipts preserve the ${name} MIME boundary`, () => {
    const cached = inspectAsset(bytes);
    expect(canReuseImportInspection(undefined, cached.mime)).toBe(false);
    for (const mime of ['', cached.mime, 'image/png', 'image/gif', 'image/apng', 'video/webm', 'application/json', 'text/plain', 'model/gltf-binary', 'application/octet-stream', 'model/vrm', 'application/vrm', 'text/html']) {
      const reusable = canReuseImportInspection(cached, mime);
      const expected = !mime || mime === cached.mime || Boolean(cached.model && ['application/octet-stream', 'model/vrm', 'application/vrm'].includes(mime));
      expect(reusable, mime).toBe(expected);
      if (reusable) expect(inspectAsset(bytes, mime)).toEqual(cached);
    }
    // These accepted aliases deliberately take the full inspector path.
    if (cached.mime === 'application/json') { expect(canReuseImportInspection(cached, 'text/plain')).toBe(false); expect(inspectAsset(bytes, 'text/plain')).toEqual(cached); }
    if (cached.animation?.format === 'apng') { expect(canReuseImportInspection(cached, 'image/apng')).toBe(false); expect(inspectAsset(bytes, 'image/apng')).toEqual(cached); }
    expect(() => inspectAsset(bytes, 'text/html')).toThrow();
  });
}
