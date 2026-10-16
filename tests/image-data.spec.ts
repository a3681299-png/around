import { test, expect } from '@playwright/test';
import { ASSET_LIMITS, inspectImage, base64ToBytes, bytesToBase64 } from '../src/assets/validation';
import { emptyDesign, parseDesign } from '../src/design/schema';
import { movePlacement, resizePlacement, rotatePlacement, centre } from '../src/design/geometry';
import type { ImageDecoration } from '../src/design/types';

const png = () => new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64'));
const image = (): ImageDecoration => ({ kind: 'image', id: 'image-example', assetId: `asset-${'a'.repeat(64)}`, name: 'flower.png',
  placement: { anchor: { kind: 'viewport' }, x: .5, y: .5, widthPx: 100, heightPx: 80, rotationDeg: 0 }, opacity: .8, zIndex: 1, visible: true, locked: false });

test('v1 migration preserves card rules and base theme without embedding any image bytes', () => {
  const legacy = { schemaVersion: 1, id: 'legacy', siteId: 'youtube', baseThemeId: 'retro', rules: [
    { kind: 'surface-style', target: 'video-card', style: { borderRadiusPx: 12 } },
  ] };
  const parsed = parseDesign(legacy);
  expect(parsed).toMatchObject({ schemaVersion: 6, baseThemeId: 'retro', rules: legacy.rules, decorations: [] });
  expect(legacy.schemaVersion).toBe(1);
  const withImage = { ...parsed, decorations: [image()] };
  expect(parseDesign(withImage)).toEqual(withImage);
  expect(JSON.stringify(withImage)).not.toMatch(/data:image|base64|blob:/);
});

test('v2 layers migrate unlocked; v3 locks are validated and retained without modifying the input', () => {
  const { locked: _locked, ...legacyImage } = image();
  const legacy = { ...emptyDesign('youtube', null), schemaVersion: 2, decorations: [legacyImage] };
  expect(parseDesign(legacy).decorations[0]?.locked).toBe(false);
  expect(legacyImage).not.toHaveProperty('locked');
  const next = { ...emptyDesign('youtube', null), decorations: [{ ...image(), locked: true }] };
  expect(parseDesign(next).decorations[0]?.locked).toBe(true);
  expect(() => parseDesign({ ...next, decorations: [{ ...image(), locked: 'true' }] })).toThrow();
});

test('image data rejects script fields, arbitrary URLs, duplicate IDs and non-finite geometry', () => {
  const document = { ...emptyDesign('youtube', null), decorations: [image()] };
  for (const decoration of [
    { ...image(), assetId: 'https://example.com/file.png' }, { ...image(), script: 'alert(1)' },
    { ...image(), opacity: 2 }, { ...image(), zIndex: 1.2 },
    { ...image(), placement: { ...image().placement, x: NaN } },
    { ...image(), placement: { ...image().placement, widthPx: Infinity } },
    { ...image(), placement: { ...image().placement, anchor: { kind: 'selector', selector: '*' } } },
    { ...image(), placement: { ...image().placement, anchor: { kind: 'surface', target: 'bad"] *' } } },
  ]) expect(() => parseDesign({ ...document, decorations: [decoration] })).toThrow();
  expect(() => parseDesign({ ...document, decorations: [image(), image()] })).toThrow();
  expect(() => parseDesign({ ...document, decorations: Array.from({ length: 33 }, (_, index) => ({ ...image(), id: `image-${index}` })) })).toThrow();
});

test('raster validation checks bytes, MIME, dimensions, chunk lengths and transfer bounds', () => {
  expect(inspectImage(png(), 'image/png')).toEqual({ mime: 'image/png', width: 1, height: 1 });
  expect(base64ToBytes(bytesToBase64(png()))).toEqual(png());
  expect(() => inspectImage(new TextEncoder().encode('<svg onload="alert(1)"></svg>'), 'image/png')).toThrow();
  expect(() => inspectImage(png(), 'image/webp')).toThrow();
  expect(() => inspectImage(new Uint8Array(ASSET_LIMITS.fileBytes + 1))).toThrow('4MB');
  const giant = png(); new DataView(giant.buffer).setUint32(16, 10_000);
  expect(() => inspectImage(giant)).toThrow('4096');
  expect(() => inspectImage(png().subarray(0, 40))).toThrow();
  expect(() => base64ToBytes('data:image/png;base64,123')).toThrow();
});

test('viewport positions survive resizing and scroll-independent movement uses the anchor frame', () => {
  const start = image().placement;
  expect(centre(start, { left: 0, top: 0, width: 1000, height: 800 })).toEqual({ x: 500, y: 400 });
  expect(centre(start, { left: 0, top: 0, width: 1400, height: 900 })).toEqual({ x: 700, y: 450 });
  expect(centre(start, { left: 100, top: -200, width: 600, height: 400 })).toEqual({ x: 400, y: 0 });
  expect(movePlacement(start, { left: 0, top: 0, width: 1000, height: 800 }, { x: 100, y: 80 })).toMatchObject({ x: .6, y: .6, widthPx: 100, heightPx: 80 });
});

test('resize preserves proportions and the opposite corner even after rotation; rotation is normalized', () => {
  const start = image().placement, frame = { left: 0, top: 0, width: 1000, height: 800 };
  expect(resizePlacement(start, frame, { x: 50, y: 40 }, 1, 1)).toMatchObject({ widthPx: 150, heightPx: 120, x: .525, y: .525 });
  expect(resizePlacement({ ...start, rotationDeg: 90 }, frame, { x: -40, y: 50 }, 1, 1)).toMatchObject({ widthPx: 150, heightPx: 120, x: .48, y: .53125 });
  expect(rotatePlacement(start, frame, { x: 500, y: 300 }, { x: 600, y: 400 }).rotationDeg).toBe(90);
  expect(rotatePlacement({ ...start, rotationDeg: 170 }, frame, { x: 500, y: 300 }, { x: 600, y: 400 }).rotationDeg).toBe(-100);
});
