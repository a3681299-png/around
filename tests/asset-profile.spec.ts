import { test, expect } from '@playwright/test';
import { localSpanUnion, summarizeAssetSpans } from '../src/diagnostics/asset-profile-summary';
import { profileSync, profileIngest, profileSnapshot, validProfile } from '../src/diagnostics/asset-profile';
import type { AssetSpan } from '../src/diagnostics/asset-profile';
const span = (startMs: number, durationMs: number, contextInstance = 'one'): AssetSpan => ({ id: 'ap-test', context: 'content', contextInstance, name: 'parse.texture', startMs, durationMs });
test('concurrent texture spans use their local union, not an additive parse estimate', () => {
  const spans = [span(0, 20), span(5, 30), span(50, 10)]; expect(localSpanUnion(spans)).toBe(45);
  const result = summarizeAssetSpans(spans); expect(result.stages['content:parse.texture']!.ms).toBe(60); expect(result.parseTextureUnionMs).toBe(45);
});
test('independent clocks cannot be unioned even when their context labels match', () => {
  expect(() => localSpanUnion([span(0, 1), span(0, 1, 'other-worker')])).toThrow('different performance clocks');
});
test('bulk RPC counts and Base64 characters are distinct from raw model bytes', () => {
  const result = summarizeAssetSpans([{ ...span(0, 4), name: 'rpc.upload-part', wireChars: 8, bytes: 6 }, { ...span(6, 5), name: 'rpc.get-part', wireChars: 8 }, { ...span(0, 20), name: 'rpc.upload-finish' }]);
  expect(result.bulkRpcCount).toBe(3); expect(result.binaryPayloadRpcCount).toBe(2); expect(result.base64PayloadChars).toBe(16);
});
test('profiling is inert in ordinary builds and does not accept arbitrary identifiers', () => {
  expect(profileSync(undefined, 'test', () => 42)).toBe(42); profileIngest([{ id: 'private-file-name.vrm', durationMs: 0 }]); expect(profileSnapshot()).toEqual([]);
  expect(validProfile('ap-123')).toBe(true); expect(validProfile('file.vrm')).toBe(false); expect(validProfile('ap-' + 'x'.repeat(65))).toBe(false);
});
