import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { inspectAsset } from '../src/assets/inspect';
import { inspectLottie } from '../src/assets/lottie';
import { emptyDesign, parseDesign } from '../src/design/schema';
import type { AnimationDecoration } from '../src/design/types';
import { validateDesignAssets } from '../src/assets/design-assets';
import type { AssetMetadata } from '../src/assets/validation';

const input = async () => JSON.parse(await readFile('tests/fixtures/motion/petal.json', 'utf8'));
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const layer = (): AnimationDecoration => ({ kind: 'animation', format: 'gif', id: 'animation-test', assetId: `asset-${'0'.repeat(64)}`, name: 'petal.gif', visible: true, locked: false, opacity: 1, zIndex: 0,
  placement: { anchor: { kind: 'viewport' }, x: .5, y: .5, widthPx: 64, heightPx: 48, rotationDeg: 0 }, playback: { playing: true, loop: true, speed: 1 } });

test('real GIF/WebP containers are detected, timed and bounded before decoding', async () => {
  for (const [file, mime, format] of [['petal.gif', 'image/gif', 'gif'], ['petal.webp', 'image/webp', 'animated-webp']] as const) {
    const data = new Uint8Array(await readFile(`tests/fixtures/motion/${file}`));
    expect(inspectAsset(data, mime)).toMatchObject({ mime, width: 64, height: 48, animation: { format, frameCount: 3, durationMs: 360, frameDurationsMs: [120, 120, 120] } });
    expect(() => inspectAsset(data.subarray(0, data.length - 3), mime)).toThrow();
    expect(() => inspectAsset(data, 'image/png')).toThrow();
    const giant = data.slice();
    if (format === 'gif') new DataView(giant.buffer).setUint16(6, 8192, true);
    else { giant[24] = 255; giant[25] = 255; }
    expect(() => inspectAsset(giant, mime)).toThrow();
  }
});

test('Lottie vector data is accepted and executable/external/expensive content is rejected', async () => {
  const source = await input(); expect(inspectLottie(bytes(source)).info.animation).toMatchObject({ format: 'lottie', frameCount: 24, durationMs: 1000 });
  const variants = [
    { ...source, assets: [{ id: 'external', u: 'https://example.com/', p: 'image.png' }] },
    { ...source, assets: [{ id: 'embedded', p: 'data:image/png;base64,AAAA' }] },
    { ...source, fonts: { list: [] } }, { ...source, segments: [] }, { ...source, ddd: 1 },
    { ...source, layers: [{ ...source.layers[0], ks: { ...source.layers[0].ks, o: { a: 0, k: 100, x: 'alert(1)' } } }] },
    { ...source, layers: [{ ...source.layers[0], ef: [{ ty: 5 }] }] },
    { ...source, layers: [{ ...source.layers[0], shapes: [{ ty: 'rp', c: { k: 1000000 } }] }] },
    { ...source, layers: [{ ...source.layers[0], ty: 5 }] },
    { ...source, layers: [{ ...source.layers[0], ty: 1, sc: 'url(/external-paint.svg)' }] },
    { ...source, layers: [{ ...source.layers[0], parent: 1 }] },
    { ...source, assets: [{ id: 'cycle', layers: [{ ...source.layers[0], ty: 0, refId: 'cycle' }] }] },
    JSON.parse('{"v":"5.13.0","w":64,"h":48,"ip":0,"op":24,"fr":24,"layers":[],"__proto__":{}}'),
  ];
  for (const value of variants) expect(() => inspectLottie(bytes(value))).toThrow();
  expect(() => inspectLottie(new Uint8Array(1024 * 1024 + 1))).toThrow('1MB');
});

test('asset references preserve large animations without counting every frame as resident memory', () => {
  const layers = Array.from({ length: 3 }, (_, i) => ({ ...layer(), id: `animation-${i}`, assetId: `asset-${String(i).repeat(64)}` }));
  const assets = new Map<string, AssetMetadata>(layers.map((l) => [l.assetId, { id: l.assetId, name: 'big.gif', byteLength: 1024, mime: 'image/gif', width: 512, height: 512,
    animation: { format: 'gif', frameCount: 32, durationMs: 3200, frameDurationsMs: Array(32).fill(100) } }]));
  expect(() => validateDesignAssets(layers.slice(0, 2), assets)).not.toThrow();
  expect(() => validateDesignAssets(layers, assets)).not.toThrow();
  expect(() => validateDesignAssets(layers.map((l) => ({ ...l, assetId: layers[0]!.assetId })), assets)).not.toThrow();
  expect(() => validateDesignAssets([{ ...layers[0]!, format: 'lottie' }], assets)).toThrow('一致');
  expect(() => validateDesignAssets(layers, new Map())).toThrow('見つかりません');
});

test('v4 playback settings coexist with old locked image layers and reject invalid layer/media combinations', () => {
  const legacy = { ...emptyDesign('youtube', null), schemaVersion: 3, decorations: [{ ...layer(), kind: 'image' }] };
  const old = legacy.decorations[0]!; delete (old as Partial<AnimationDecoration>).format; delete (old as Partial<AnimationDecoration>).playback;
  expect(parseDesign(legacy)).toMatchObject({ schemaVersion: 8, decorations: [{ kind: 'image', locked: false }] });
  const doc = { ...emptyDesign('youtube', 'retro'), decorations: [layer()] };
  expect(parseDesign(doc)).toEqual(doc);
  for (const decoration of [{ ...layer(), playback: { playing: true, loop: true, speed: Infinity } }, { ...layer(), format: 'video' }, { ...layer(), playback: { playing: 'yes', loop: true, speed: 1 } },
    { ...layer(), format: 'lottie', playback: { playing: true, loop: true, speed: 4 } }]) expect(() => parseDesign({ ...doc, decorations: [decoration] })).toThrow();
  expect(() => parseDesign({ ...doc, schemaVersion: 6, decorations: Array.from({ length: 9 }, (_, i) => ({ ...layer(), id: `animation-${i}` })) })).toThrow('8');
  expect(parseDesign({ ...doc, decorations: [{ ...layer(), format: 'lottie', playback: { playing: false, loop: false, speed: .5 } }] }).decorations[0]).toMatchObject({ playback: { speed: .5 } });
});

test('pinned Lottie light player is reproducible, has no dynamic code evaluation and does not scan the page', async () => {
  const code = await readFile('src/vendor/lottie-light.js');
  const source = JSON.parse(await readFile('src/vendor/lottie-source.json', 'utf8'));
  expect(createHash('sha256').update(code).digest('hex')).toBe(source.sha256);
  expect(code.toString()).not.toMatch(/\beval\s*\(|\bnew\s+Function\s*\(/);
  expect(code.toString()).toContain('var Nt=null;');
  const manifest = JSON.parse(await readFile('dist/manifest.json', 'utf8'));
  expect(manifest.permissions).toEqual(['storage', 'sidePanel']);
  expect(manifest.content_security_policy.extension_pages).toBe("script-src 'self'; object-src 'none'");
});
