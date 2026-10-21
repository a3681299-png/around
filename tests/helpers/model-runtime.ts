import { createModelRenderer, type ModelSurface } from '../../src/renderers/three/models';
import { parseVerifiedModelSource, prepareVerifiedSource } from '../../src/assets/verified-source';
import { defaultModelSettings } from '../../src/models/types';
import type { ModelDecoration } from '../../src/design/types';

/** Test-only browser bundle. Exercises the production parser, postprocessing and first pose/render. */
export function mount(bytes: number[]) {
  const source = prepareVerifiedSource(Uint8Array.from(bytes)),
    modelBuffer = source.modelBuffer!;
  if (!source.info.model || !modelBuffer) throw new Error('Expected a model fixture');
  const metadata = { ...source.info, id: 'test-model', name: 'original fixture', byteLength: modelBuffer.byteLength };
  const host = document.body.appendChild(document.createElement('div')),
    shadow = host.attachShadow({ mode: 'open' });
  host.id = 'model-runtime-test';
  let surface: ModelSurface | undefined,
    stats: Record<string, unknown> = {};
  const errors: string[] = [];
  const renderer = createModelRenderer(
    document,
    (error) => errors.push(error),
    (value) => {
      stats = value;
    },
    shadow,
    async () => ({ metadata, modelBuffer }),
  );
  const layer: ModelDecoration = {
    id: 'test-layer',
    name: 'fixture',
    kind: 'model3d',
    assetId: metadata.id,
    source: source.info.model,
    model: defaultModelSettings(source.info.model),
    placement: { anchor: { kind: 'viewport' }, x: 0.5, y: 0.5, widthPx: 200, heightPx: 200, rotationDeg: 0 },
    opacity: 1,
    zIndex: 0,
    visible: true,
    locked: false,
  };
  return {
    show() {
      surface?.destroy();
      surface = renderer.attach(shadow.appendChild(document.createElement('div')));
      surface.update(layer, true);
    },
    hide() {
      surface?.destroy();
      surface = undefined;
    },
    destroy() {
      surface?.destroy();
      renderer.destroy();
    },
    stats: () => ({ ...stats, errors: [...errors] }),
    // This test parser reads a digest only; production consumers have no backing-buffer accessor.
    digest: () =>
      parseVerifiedModelSource(modelBuffer, {
        parseAsync: async (buffer) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))),
      }),
  };
}
