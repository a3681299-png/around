import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { parseDesign } from '../src/design/schema';
import { evaluateWorld, initialWorldState } from '../src/world/evaluate';

for (let version = 1; version <= 9; version++) test(`historical v${version} test data migrates purely to v11 and evaluates without changing assets`, async () => {
  const input = JSON.parse(await readFile(`tests/fixtures/designs/v${version}.json`, 'utf8'));
  const before = JSON.stringify(input), parsed = parseDesign(input);
  expect(input.schemaVersion).toBe(version); expect(parsed.schemaVersion).toBe(11); expect(JSON.stringify(input)).toBe(before);
  expect(parsed.rules).toEqual(input.rules.map((rule: { style: { backgroundColor?: string } }) => rule.style.backgroundColor
    ? { ...rule, style: { ...rule.style, backgroundColor: rule.style.backgroundColor.toLowerCase() } } : rule));
  expect(parsed.decorations.map((layer) => layer.assetId)).toEqual((input.decorations ?? []).map((layer: { assetId: string }) => layer.assetId));
  expect(parseDesign(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
  if (version === 2) expect(parsed.decorations[0]!.locked).toBe(false);
  if (version === 3) expect(parsed.decorations[0]!.locked).toBe(true);
  if (version === 4) expect(parsed.decorations[0]!.kind).toBe('animation');
  if (version === 5) expect(parsed.decorations[0]!.effects).toHaveLength(1);
  if (version === 6) expect(parsed.groups![0]!.children).toEqual(['image-0', 'image-1', 'image-2']);
  const inputFrame = { timeMs: 0, deltaMs: 0, viewport: { width: 1100, height: 760 }, anchors: { 'video-player': { left: 80, top: 100, width: 720, height: 400 } },
    signals: { pointer: undefined, playing: false }, events: [], environment: { hidden: false, reducedMotion: false } };
  expect(evaluateWorld(parsed, initialWorldState(), inputFrame)).toEqual(evaluateWorld(parsed, initialWorldState(), inputFrame));
});

test('unknown future DesignDocument remains unchanged and v12 remains unsupported', async () => {
  const input = JSON.parse(await readFile('tests/fixtures/designs/v6.json', 'utf8')); input.schemaVersion = 12;
  const before = JSON.stringify(input); expect(() => parseDesign(input)).toThrow(/バージョン/); expect(JSON.stringify(input)).toBe(before);
});
