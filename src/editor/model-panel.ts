import type { EditorLayer, ImagePatch, ModelDecoration } from '../design/types';
import type { ModelSettings } from '../models/types';

/** The same controls/commands in every Studio surface. Metadata is worker-verified. */
export function createModelPanel(doc: Document, change: (patch: ImagePatch) => void, begin: () => void, end: () => void) {
  const fieldset = doc.createElement('fieldset'); fieldset.className = 'model-panel'; fieldset.hidden = true; fieldset.setAttribute('aria-label', '3Dモデル');
  fieldset.innerHTML = `<details open><summary>3Dモデルの向き</summary><div class="property row">${['X', 'Y', 'Z'].map((axis) => `<label>${axis} <input type="number" data-model="rotation${axis}" aria-label="3D回転${axis}" min="-180" max="180" step="1">°</label>`).join('')}</div></details>
    <details open><summary>3Dアニメーション</summary>
      <div class="property"><label>クリップ <select data-model="clip" aria-label="3Dクリップ"></select></label></div>
      <div class="property"><label><input type="checkbox" data-model="playing">3Dアニメーションを再生</label><label><input type="checkbox" data-model="loop">3Dループ再生</label></div>
      <div class="property row"><label>速度 <input type="number" aria-label="3D再生速度" data-model="speed" min="0.1" max="4" step="0.1">倍</label><label>フェード <input type="number" aria-label="3Dクロスフェード" data-model="crossFadeMs" min="0" max="5000" step="10">ms</label></div>
      <div class="property"><label title="ルートと骨格ルートのX/Z移動を抑え、上下動は残します。移動はWorld Runtimeが担当します。"><input type="checkbox" data-model="inPlace">In-place（素材内の水平移動を抑える）</label></div>
      <p class="model-empty" role="status"></p>
    </details>`;
  let current: ModelDecoration | undefined;
  fieldset.addEventListener('input', (event) => {
    const input = event.target as HTMLInputElement | HTMLSelectElement, key = input.dataset.model as keyof ModelSettings | undefined;
    if (!key || !current || !input.checkValidity() || input.value === '') return;
    const value = input instanceof HTMLInputElement && input.type === 'checkbox' ? input.checked : key === 'clip' && input.value === 'none' ? null : Number(input.value);
    change({ model: { [key]: value } });
  });
  fieldset.querySelectorAll('input[type="number"]').forEach((input) => { input.addEventListener('focus', begin); input.addEventListener('blur', () => end()); });
  return { fieldset, render(layer: EditorLayer | undefined) {
    fieldset.hidden = layer?.kind !== 'model3d'; current = layer?.kind === 'model3d' ? layer : undefined; if (!current) return;
    const model = current.model, clip = fieldset.querySelector<HTMLSelectElement>('[data-model="clip"]')!;
    const signature = JSON.stringify(current.source.clips); if (clip.dataset.source !== signature) {
      clip.dataset.source = signature; clip.replaceChildren(); const empty = doc.createElement('option'); empty.value = 'none'; empty.textContent = '静止ポーズ'; clip.append(empty);
      current.source.clips.forEach((c, i) => { const option = doc.createElement('option'); option.value = String(i); option.textContent = `${c.name || `Clip ${i + 1}`} · ${c.duration.toFixed(2)}s`; clip.append(option); });
    }
    fieldset.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-model]').forEach((input) => {
      if ((fieldset.getRootNode() as ShadowRoot).activeElement === input && input.tagName === 'INPUT' && (input as HTMLInputElement).type === 'number') return;
      const value = model[input.dataset.model as keyof ModelSettings]; if (input instanceof HTMLInputElement && input.type === 'checkbox') input.checked = Boolean(value); else input.value = value === null ? 'none' : String(value);
    });
    fieldset.querySelector('.model-empty')!.textContent = current.source.clips.length ? '' : 'このGLBにはアニメーションクリップがありません。';
  } };
}
