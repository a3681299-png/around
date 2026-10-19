import type { EditorLayer, ImagePatch } from '../design/types';
/** Shared by the sidebar, standalone Studio and quick editor. */
export function createModelPanel(doc: Document, change: (patch: ImagePatch) => void, begin: () => void, end: () => void) {
  const fieldset = doc.createElement('fieldset'); fieldset.className = 'model-panel'; fieldset.hidden = true;
  fieldset.setAttribute('aria-label', '3Dモデル');
  fieldset.innerHTML = `<details open><summary>3Dモデルの向き</summary><div class="property row">${['X', 'Y', 'Z'].map((axis) => `<label>${axis} <input type="number" data-model="rotation${axis}" aria-label="3D回転${axis}" min="-180" max="180" step="1">°</label>`).join('')}</div><p class="hint model-note">モデルごとに透明な面へ描画します。モデル同士の立体的な交差は行いません。</p></details>`;
  fieldset.addEventListener('input', (event) => {
    const input = event.target as HTMLInputElement; if (input.dataset.model && input.checkValidity() && input.value !== '') change({ model: { [input.dataset.model]: Number(input.value) } });
  });
  fieldset.querySelectorAll('input').forEach((input) => { input.addEventListener('focus', begin); input.addEventListener('blur', () => end()); });
  return { fieldset, render(layer: EditorLayer | undefined) {
    fieldset.hidden = layer?.kind !== 'model3d'; if (layer?.kind !== 'model3d') return;
    fieldset.querySelectorAll<HTMLInputElement>('[data-model]').forEach((input) => { if (fieldset.getRootNode() instanceof ShadowRoot && (fieldset.getRootNode() as ShadowRoot).activeElement === input) return; input.value = String(layer.model[input.dataset.model as 'rotationX']); });
  } };
}
