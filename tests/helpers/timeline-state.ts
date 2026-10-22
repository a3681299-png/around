import { createSignalTimeline } from '../../src/studio/signal-timeline';
import { defaultScrollOpacityRule } from '../../src/signals/keyframes';
import { createEditorSession } from '../../src/editor-core/session';
import type { EditorAsset } from '../../src/editor-core/types';
import type { PanelActions } from '../../src/editor/panel';
import { transientPreferences } from '../../src/studio/preferences';

/** Test the UI boundary with acknowledgements whose object insertion order differs. */
export async function mount(doc: Document) {
  const reorder = (value: unknown): any =>
    Array.isArray(value)
      ? value.map(reorder)
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.entries(value)
              .reverse()
              .map(([key, item]) => [key, reorder(item)]),
          )
        : value;
  let serial = 0;
  const editor = createEditorSession<readonly EditorAsset[]>({
    siteId: 'youtube',
    baseThemeId: 'retro',
    targets: [],
    makeId: (kind) => `${kind}-${++serial}`,
    validate() {},
    geometry: {
      frameFor: () => ({ left: 0, top: 0, width: 1000, height: 800 }),
      samples: () => [],
      importFrame: () => ({ width: 1000, height: 800, origin: { x: 500, y: 400 } }),
    },
    storage: {
      read: async () => undefined,
      watch(accept) {
        queueMicrotask(() => accept(undefined));
        return () => {};
      },
      retain: async () => {},
      release: async () => {},
      validate: async () => {},
      save: async () => {},
      import: async (assets) => assets,
      cancelImport() {},
    },
  });
  await Promise.resolve();
  editor.setEnabled(true);
  editor.open();
  await editor.import([{ id: `asset-${'a'.repeat(64)}`, name: 'Image A', width: 100, height: 100 }]);
  await editor.execute({ type: 'signal-rule', rule: defaultScrollOpacityRule(editor.snapshot().view.image!.id) });
  const render = () => {
    const view = editor.snapshot().view;
    timeline.render({ ...view, signalRules: view.signalRules!.map(reorder) });
  };
  const timeline = createSignalTimeline(
    doc,
    {
      signalRule(next) {
        // Real port replies arrive after commit() returns and have crossed serialization.
        void editor.execute({ type: 'signal-rule', rule: next }).then(render);
      },
      beginEdit() {
        void editor.execute({ type: 'begin' });
      },
      endEdit() {
        void editor.execute({ type: 'end' });
      },
    } as PanelActions,
    transientPreferences,
  );
  const undo = doc.createElement('button');
  undo.textContent = 'Undo';
  undo.addEventListener('click', () => {
    void editor.execute({ type: 'undo' }).then(render);
  });
  doc.body.append(undo, timeline.root);
  // The edit begins in canonical order; only later acknowledgements reorder it.
  timeline.render(editor.snapshot().view);
}
