import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { canReuseImportInspection } from '../src/assets/import-validation';
import { inspectAsset } from '../src/assets/inspect';
import { vrmFixture } from './helpers/vrm-fixture';
import { modelFixture } from './helpers/model-fixture';

for (const [name, bytes, reusableMimes] of [
  ['png', readFileSync('tests/fixtures/motion/petal.png'), ['', 'image/png']],
  ['gif', readFileSync('tests/fixtures/motion/petal.gif'), ['', 'image/gif']],
  ['apng', readFileSync('tests/fixtures/motion/petal.apng'), ['', 'image/png']],
  ['webm', readFileSync('tests/fixtures/motion/long.webm'), ['', 'video/webm']],
  ['lottie', readFileSync('tests/fixtures/motion/petal.json'), ['', 'application/json']],
] as const) {
  test(`worker import receipts preserve the ${name} MIME boundary`, () => {
    const cached = inspectAsset(bytes);
    expect(canReuseImportInspection(undefined, cached.mime)).toBe(false);
    for (const mime of [
      '',
      cached.mime,
      'image/png',
      'image/gif',
      'image/apng',
      'video/webm',
      'application/json',
      'text/plain',
      'model/gltf-binary',
      'application/octet-stream',
      'model/vrm',
      'model/vrml',
      'application/vrm',
      'text/html',
    ]) {
      const reusable = canReuseImportInspection(cached, mime);
      const expected = (reusableMimes as readonly string[]).includes(mime);
      expect(reusable, mime).toBe(expected);
      if (reusable) expect(inspectAsset(bytes, mime)).toEqual(cached);
    }
    // These accepted aliases deliberately take the full inspector path.
    if (cached.mime === 'application/json') {
      expect(canReuseImportInspection(cached, 'text/plain')).toBe(false);
      expect(inspectAsset(bytes, 'text/plain')).toEqual(cached);
    }
    if (cached.animation?.format === 'apng') {
      expect(canReuseImportInspection(cached, 'image/apng')).toBe(false);
      expect(inspectAsset(bytes, 'image/apng')).toEqual(cached);
    }
    expect(() => inspectAsset(bytes, 'text/html')).toThrow();
    // A model declaration must never turn non-model bytes into a model receipt.
    for (const mime of ['model/gltf-binary', 'model/vrm', 'model/vrml', 'application/octet-stream']) {
      expect(canReuseImportInspection(cached, mime), mime).toBe(false);
      expect(() => inspectAsset(bytes, mime), mime).toThrow();
    }
  });
}

for (const [name, bytes] of [
  ['glb', modelFixture()],
  ['vrm', vrmFixture()],
] as const) {
  test(`worker reuses structurally validated ${name} regardless of the declared MIME`, () => {
    const cached = inspectAsset(bytes);
    for (const mime of [
      '',
      'model/gltf-binary',
      'model/vrm',
      'application/vrm',
      'model/vrml',
      'application/octet-stream',
      'image/png',
      'text/html',
    ]) {
      expect(canReuseImportInspection(undefined, mime), mime).toBe(false);
      expect(canReuseImportInspection(cached, mime), mime).toBe(true);
      expect(inspectAsset(bytes, mime), mime).toEqual(cached);
      expect(() => inspectAsset(bytes.subarray(0, -4), mime), mime).toThrow();
    }
  });
}
