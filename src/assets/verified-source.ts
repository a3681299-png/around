import { inspectAssetResources } from './inspect';

declare const modelSource: unique symbol;
/** An opaque, read-only reference. Asset consumers never receive the inspected backing buffer. */
export interface VerifiedModelSource {
  readonly byteLength: number;
  readonly [modelSource]: true;
}
const models = new WeakMap<object, { buffer: ArrayBuffer; gpuBytes: number }>();

export function prepareVerifiedSource(data: Uint8Array<ArrayBuffer>, mime = '') {
  // Take ownership before inspection: existing caller views cannot change verified bytes later.
  // Transfers of complete buffers do not copy; a subview must own only its requested range.
  const buffer =
    data.byteOffset === 0 && data.byteLength === data.buffer.byteLength
      ? structuredClone(data.buffer, { transfer: [data.buffer] })
      : new Uint8Array(data).buffer;
  const bytes = new Uint8Array(buffer),
    { info, gpuBytes } = inspectAssetResources(bytes, mime);
  if (gpuBytes === undefined) return { info, bytes };
  const source = Object.freeze({ byteLength: buffer.byteLength }) as VerifiedModelSource;
  models.set(source, { buffer, gpuBytes });
  return { info, modelBuffer: source };
}

export const verifiedModelBytes = (source: object) => models.get(source)?.gpuBytes;

/** Only the trusted GLTF parser receives the buffer. It slices BIN/bufferViews before editing attributes. */
export function parseVerifiedModelSource<T>(
  source: VerifiedModelSource,
  parser: { parseAsync(data: ArrayBuffer, path: string): Promise<T> },
): Promise<T> {
  const value = models.get(source);
  if (!value) throw new Error('検証済みの3D原本ではありません。');
  return parser.parseAsync(value.buffer, '');
}
