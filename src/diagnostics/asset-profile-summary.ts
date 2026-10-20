import type { AssetSpan } from './asset-profile';

/** Only local timestamps may be merged. Durations from different clocks may be listed, never unioned. */
export function localSpanUnion(spans: readonly AssetSpan[]): number {
  if (new Set(spans.map((s) => s.contextInstance ?? s.context)).size > 1)
    throw new Error('Cannot merge different performance clocks.');
  const intervals = spans.map((s) => [s.startMs, s.startMs + s.durationMs] as const).sort((a, b) => a[0] - b[0]);
  let end = -Infinity,
    sum = 0;
  for (const [a, b] of intervals) {
    sum += Math.max(0, b - Math.max(end, a));
    end = Math.max(end, b);
  }
  return sum;
}
export function summarizeAssetSpans(spans: readonly AssetSpan[]) {
  const stages: Record<string, { ms: number; samples: number; bytes: number; wireChars: number }> = {};
  for (const span of spans) {
    const entry = (stages[span.context + ':' + span.name] ??= { ms: 0, samples: 0, bytes: 0, wireChars: 0 });
    entry.ms += span.durationMs;
    entry.samples++;
    entry.bytes += span.bytes ?? 0;
    entry.wireChars += span.wireChars ?? 0;
  }
  const textures = spans.filter((s) => s.name === 'parse.texture');
  return {
    stages,
    parseTextureUnionMs: localSpanUnion(textures),
    bulkRpcCount: spans.filter((s) => /^rpc\.(upload-start|upload-part|upload-finish|get|get-part)$/.test(s.name))
      .length,
    binaryPayloadRpcCount: spans.filter((s) => /^rpc\.(upload-part|get-part)$/.test(s.name)).length,
    base64PayloadChars: spans
      .filter((s) => /^rpc\.(upload-part|get-part)$/.test(s.name))
      .reduce((n, s) => n + (s.wireChars ?? 0), 0),
  };
}
